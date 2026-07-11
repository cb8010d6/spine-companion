use crate::avatar;
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
            "source": { "type": "string" },
            "autoReturnMs": { "type": "integer", "minimum": 0 },
            "returnTo": { "type": "string", "enum": STATES }
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

fn avatar_pack_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": { "type": "string" }
        },
        "required": ["path"]
    })
}

fn avatar_job_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "jobId": { "type": "string" },
            "phase": { "type": "string" },
            "message": { "type": "string" },
            "packPath": { "type": "string" },
            "motions": { "type": "array", "items": { "type": "string" } }
        }
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
        },
        {
            "name": "companion_avatar_requirements",
            "title": "Get avatar pack requirements",
            "description": "Read the local Avatar Studio pack contract and current limits.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "companion_create_avatar_job",
            "title": "Create avatar job",
            "description": "Create a structured Avatar Studio planning job for AI-assisted layer, rig, motion and export work.",
            "inputSchema": avatar_job_schema()
        },
        {
            "name": "companion_update_avatar_job",
            "title": "Update avatar job",
            "description": "Report Avatar Studio job progress. This records planning/progress only and does not claim a finished rig.",
            "inputSchema": avatar_job_schema()
        },
        {
            "name": "companion_validate_avatar_pack",
            "title": "Validate avatar pack",
            "description": "Validate a local avatar pack folder without importing it.",
            "inputSchema": avatar_pack_schema()
        },
        {
            "name": "companion_import_avatar_pack",
            "title": "Import avatar pack",
            "description": "Record a valid local avatar pack in Spine Companion. This does not claim to create Spine runtime exports.",
            "inputSchema": avatar_pack_schema()
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
    let mut payload = json!({
        "state": phase_to_state(phase),
        "source": payload_source(arguments, source),
        "message": arguments.get("message").and_then(|value| value.as_str()).unwrap_or(phase)
    });
    if let Some(value) = arguments.get("autoReturnMs").and_then(|value| value.as_u64()) {
        payload["autoReturnMs"] = json!(value);
    }
    if let Some(value) = arguments.get("returnTo").and_then(|value| value.as_str()) {
        payload["returnTo"] = json!(value);
    }
    payload
}

fn mcp_config_dir() -> std::path::PathBuf {
    crate::user_config_dir().unwrap_or_else(std::env::temp_dir)
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
        "companion_avatar_requirements" => Ok(text_result(avatar::requirements(), source)),
        "companion_create_avatar_job" => {
            let job_id = arguments
                .get("jobId")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("avatar-job");
            Ok(text_result(json!({
                "jobId": job_id,
                "created": true,
                "requirements": avatar::requirements(),
                "message": "Avatar job created. Produce a local avatar pack and validate it before import."
            }), source))
        }
        "companion_update_avatar_job" => Ok(text_result(json!({
            "jobId": arguments.get("jobId").and_then(|value| value.as_str()).unwrap_or("avatar-job"),
            "phase": arguments.get("phase").and_then(|value| value.as_str()).unwrap_or("working"),
            "message": arguments.get("message").and_then(|value| value.as_str()).unwrap_or("Avatar job updated."),
            "packPath": arguments.get("packPath").and_then(|value| value.as_str()).unwrap_or(""),
            "note": "Progress recorded for the AI tool. Validate/import the avatar pack when files exist."
        }), source)),
        "companion_validate_avatar_pack" => {
            let path = arguments.get("path").and_then(|value| value.as_str()).unwrap_or("");
            let result = avatar::validate_pack(std::path::Path::new(path));
            Ok(text_result(serde_json::to_value(result).unwrap_or_else(|_| json!({})), source))
        }
        "companion_import_avatar_pack" => {
            let path = arguments.get("path").and_then(|value| value.as_str()).unwrap_or("");
            let path = std::path::Path::new(path);
            let validation = avatar::validate_pack(path);
            let value = if validation.runtime_ready {
                let result = avatar::install_runtime_pack(path, &mcp_config_dir())?;
                json!({
                    "imported": true,
                    "installed": result.installed,
                    "activated": false,
                    "validation": result.validation,
                    "registryPath": result.registry_path,
                    "runtimePath": result.runtime_path,
                    "note": "Runtime assets were installed. Activate the model in Spine Companion Manager."
                })
            } else {
                let result = avatar::register_pack(path, &mcp_config_dir())?;
                json!({
                    "imported": result.imported,
                    "installed": false,
                    "activated": false,
                    "validation": result.validation,
                    "registryPath": result.registry_path,
                    "note": "Draft pack saved. A valid Spine runtime export is required before activation."
                })
            };
            Ok(text_result(value, source))
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

    #[test]
    fn phase_payload_preserves_explicit_auto_return() {
        let source = SourceInfo {
            source: "opencode-mcp".to_string(),
            label: "OpenCode".to_string(),
        };
        let payload = phase_payload(
            &json!({
                "phase": "thinking",
                "message": "Testing the connection",
                "autoReturnMs": 2200
            }),
            &source,
        );
        assert_eq!(payload["state"], "working");
        assert_eq!(payload["source"], "opencode-mcp");
        assert_eq!(payload["autoReturnMs"], 2200);
    }

    #[test]
    fn avatar_import_uses_the_tauri_config_directory() {
        assert_eq!(
            mcp_config_dir(),
            crate::user_config_dir().unwrap_or_else(std::env::temp_dir)
        );
    }
}
