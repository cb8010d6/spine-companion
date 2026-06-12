use crate::source_registry::{source_from_client_name, source_from_env_or_client, SourceInfo};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

const STATES: &[&str] = &[
    "idle",
    "working",
    "reviewing",
    "running",
    "success",
    "failed",
    "waiting",
    "sleeping",
    "reminder",
];

fn api_base() -> String {
    std::env::var("COMPANION_API")
        .unwrap_or_else(|_| "http://127.0.0.1:17388".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn text_result(value: Value, source: &SourceInfo) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
        }],
        "structuredContent": {
            "value": value,
            "source": source.source,
            "sourceLabel": source.label
        }
    })
}

async fn api_json(path: &str, options: Option<Value>) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", api_base(), path);
    let request = if let Some(body) = options {
        client
            .post(url)
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&body).map_err(|error| error.to_string())?)
    } else {
        client.get(url)
    };
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text).unwrap_or_else(|_| json!({ "text": text }))
    };
    if !status.is_success() {
        return Err(value
            .get("error")
            .and_then(|error| error.as_str())
            .unwrap_or("Companion API request failed")
            .to_string());
    }
    Ok(value)
}

fn state_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "state": { "type": "string", "enum": STATES },
            "source": { "type": "string" },
            "message": { "type": "string" },
            "direction": { "type": "string", "enum": ["left", "right"] },
            "autoReturnMs": { "type": "integer", "minimum": 0 },
            "returnTo": { "type": "string", "enum": STATES },
            "notify": { "type": "boolean" },
            "preserveMessage": { "type": "boolean" }
        },
        "required": ["state"]
    })
}

fn phase_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "phase": {
                "type": "string",
                "enum": ["thinking", "editing", "running", "reviewing", "succeeded", "failed", "waiting"]
            },
            "message": { "type": "string" },
            "source": { "type": "string" }
        },
        "required": ["phase"]
    })
}

fn reminder_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "text": { "type": "string" },
            "inSeconds": { "type": "number", "minimum": 0 },
            "delayMs": { "type": "integer", "minimum": 0 },
            "dueAt": { "type": "string" },
            "durationMs": { "type": "integer", "minimum": 0 },
            "returnTo": { "type": "string", "enum": STATES }
        },
        "required": ["text"]
    })
}

fn tools() -> Value {
    json!([
        {
            "name": "companion_get_state",
            "title": "Get companion state",
            "description": "Read the current Spine Companion state from the local companion API.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "companion_set_state",
            "title": "Set companion state",
            "description": "Set the desktop Spine Companion state.",
            "inputSchema": state_schema()
        },
        {
            "name": "companion_reminder",
            "title": "Create companion reminder",
            "description": "Schedule a local reminder that switches the companion into reminder animation when due.",
            "inputSchema": reminder_schema()
        },
        {
            "name": "companion_report_ai_phase",
            "title": "Report AI work phase",
            "description": "Map an AI coding tool work phase to a companion state.",
            "inputSchema": phase_schema()
        },
        {
            "name": "companion_report_codex_phase",
            "title": "Report Codex phase",
            "description": "Compatibility alias for older Codex instructions. Uses the configured MCP source.",
            "inputSchema": phase_schema()
        }
    ])
}

fn phase_to_state(phase: &str) -> &'static str {
    match phase {
        "thinking" | "editing" => "working",
        "running" => "running",
        "reviewing" => "reviewing",
        "succeeded" => "success",
        "failed" => "failed",
        "waiting" => "waiting",
        _ => "working",
    }
}

fn payload_source(arguments: &Value, source: &SourceInfo) -> String {
    arguments
        .get("source")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&source.source)
        .to_string()
}

fn phase_payload(arguments: &Value, source: &SourceInfo) -> Value {
    let phase = arguments
        .get("phase")
        .and_then(|value| value.as_str())
        .unwrap_or("thinking");
    json!({
        "state": phase_to_state(phase),
        "source": payload_source(arguments, source),
        "message": arguments.get("message").and_then(|value| value.as_str()).unwrap_or(phase)
    })
}

async fn call_tool(name: &str, arguments: Value, source: &SourceInfo) -> Result<Value, String> {
    match name {
        "companion_get_state" => api_json("/state", None)
            .await
            .map(|value| text_result(value, source)),
        "companion_set_state" => {
            let mut payload = arguments.as_object().cloned().unwrap_or_default();
            if !payload.contains_key("source") {
                payload.insert("source".to_string(), Value::String(source.source.clone()));
            }
            api_json("/state", Some(Value::Object(payload)))
                .await
                .map(|value| text_result(value, source))
        }
        "companion_reminder" => api_json("/reminders", Some(arguments))
            .await
            .map(|value| text_result(value, source)),
        "companion_report_ai_phase" | "companion_report_codex_phase" => {
            api_json("/state", Some(phase_payload(&arguments, source)))
                .await
                .map(|value| text_result(value, source))
        }
        _ => Err(format!("Unknown MCP tool: {name}")),
    }
}

fn response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

async fn handle_message(message: Value, source: &mut SourceInfo) -> Option<Value> {
    let method = message.get("method").and_then(|value| value.as_str())?;
    let id = message.get("id").cloned();
    match method {
        "initialize" => {
            if std::env::var("COMPANION_SOURCE")
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                if let Some(name) = message
                    .get("params")
                    .and_then(|params| params.get("clientInfo"))
                    .and_then(|info| info.get("name"))
                    .and_then(|name| name.as_str())
                {
                    if let Some(next) = source_from_client_name(name) {
                        *source = next;
                    }
                }
            }
            id.map(|id| {
                response(id, json!({
                    "protocolVersion": message
                        .get("params")
                        .and_then(|params| params.get("protocolVersion"))
                        .and_then(|version| version.as_str())
                        .unwrap_or("2025-06-18"),
                    "capabilities": { "tools": { "listChanged": true } },
                    "serverInfo": { "name": "spine-companion", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Use companion_report_ai_phase to report coding work phases to the local Spine Companion desktop app."
                }))
            })
        }
        "notifications/initialized" => None,
        "ping" => id.map(|id| response(id, json!({}))),
        "tools/list" => id.map(|id| response(id, json!({ "tools": tools() }))),
        "tools/call" => {
            let id = id.unwrap_or(Value::Null);
            let name = message
                .get("params")
                .and_then(|params| params.get("name"))
                .and_then(|name| name.as_str())
                .unwrap_or("");
            let arguments = message
                .get("params")
                .and_then(|params| params.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            Some(match call_tool(name, arguments, source).await {
                Ok(result) => response(id, result),
                Err(error) => error_response(id, -32000, error),
            })
        }
        _ => id.map(|id| error_response(id, -32601, format!("Method not found: {method}"))),
    }
}

pub fn run_stdio() -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new().map_err(|error| error.to_string())?;
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut source = source_from_env_or_client(None);
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Invalid MCP JSON: {error}");
                continue;
            }
        };
        if let Some(reply) = runtime.block_on(handle_message(message, &mut source)) {
            let text = serde_json::to_string(&reply).map_err(|error| error.to_string())?;
            stdout
                .write_all(text.as_bytes())
                .and_then(|_| stdout.write_all(b"\n"))
                .and_then(|_| stdout.flush())
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_phase_alias_uses_configured_source() {
        let source = SourceInfo {
            source: "mimocode-mcp".to_string(),
            label: "MiMoCode".to_string(),
        };
        let payload = phase_payload(&json!({ "phase": "reviewing" }), &source);
        assert_eq!(payload["state"], "reviewing");
        assert_eq!(payload["source"], "mimocode-mcp");
    }
}
