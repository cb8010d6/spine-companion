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

fn public_api_endpoint() -> String {
    let base = api_base();
    let Ok(url) = reqwest::Url::parse(&base) else {
        return "configured loopback API".to_string();
    };
    let host = url.host_str().unwrap_or("127.0.0.1");
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let port = url
        .port()
        .map(|value| format!(":{value}"))
        .unwrap_or_default();
    format!("{}://{}{}", url.scheme(), host, port)
}

fn text_result(value: Value, _source: &SourceInfo) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
        }],
        "structuredContent": value
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

fn empty_schema() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
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

fn avatar_job_create_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "jobId": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" },
            "phase": { "type": "string", "maxLength": 64 },
            "message": { "type": "string", "maxLength": 2048 },
            "packPath": { "type": "string", "maxLength": 2048 },
            "motions": { "type": "array", "maxItems": 32, "items": { "type": "string", "maxLength": 64 } }
        },
        "required": ["jobId"]
    })
}

fn avatar_job_update_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "jobId": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" },
            "phase": { "type": "string", "maxLength": 64 },
            "message": { "type": "string", "maxLength": 2048 },
            "packPath": { "type": "string", "maxLength": 2048 },
            "motions": { "type": "array", "maxItems": 32, "items": { "type": "string", "maxLength": 64 } }
        },
        "required": ["jobId"]
    })
}

fn avatar_job_get_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "jobId": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }
        },
        "required": ["jobId"]
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
            "name": "companion_get_diagnostics",
            "title": "Get MCP diagnostics",
            "description": "Read API health, current state/source, and MCP connection metadata. Full GPU, model, and cache diagnostics remain in Manager > Diagnostics; no config paths or secrets are returned.",
            "inputSchema": empty_schema()
        },
        {
            "name": "companion_test_bridge",
            "title": "Test companion bridge",
            "description": "Verify that the local /health and /state endpoints are readable without changing companion state. Returns machine-readable ok and reason fields.",
            "inputSchema": empty_schema()
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
            "description": "Create a bounded Avatar Studio planning/progress record for AI-assisted layer, rig, motion and export work. This does not auto-rig or export Spine files.",
            "inputSchema": avatar_job_create_schema()
        },
        {
            "name": "companion_update_avatar_job",
            "title": "Update avatar job",
            "description": "Update a bounded Avatar Studio planning/progress record. Reading it later can provide context for an AI tool, but it does not resume execution or claim a finished rig.",
            "inputSchema": avatar_job_update_schema()
        },
        {
            "name": "companion_list_avatar_jobs",
            "title": "List avatar jobs",
            "description": "List persisted Avatar Studio planning/progress records. Records survive restart but do not represent automatic rigging or Spine export jobs.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "companion_get_avatar_job",
            "title": "Get avatar job",
            "description": "Read one persisted Avatar Studio planning/progress record so an AI tool can continue planning explicitly. This does not resume execution.",
            "inputSchema": avatar_job_get_schema()
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

struct BridgeProbe {
    health_ok: bool,
    state: Option<Value>,
}

impl BridgeProbe {
    fn state_ok(&self) -> bool {
        self.state.is_some()
    }

    fn ok(&self) -> bool {
        self.health_ok && self.state_ok()
    }

    fn reason(&self) -> &'static str {
        match (self.health_ok, self.state_ok()) {
            (true, true) => "ok",
            (false, true) => "health_unavailable",
            (true, false) => "state_unavailable",
            (false, false) => "bridge_unavailable",
        }
    }
}

async fn probe_bridge() -> BridgeProbe {
    let (health, state) = tokio::join!(api_json("/health", None), api_json("/state", None));
    let health_ok = health
        .as_ref()
        .is_ok_and(|value| value.get("ok").and_then(Value::as_bool) == Some(true));
    let state = state.ok().and_then(|value| {
        let state_id = value.get("state").and_then(Value::as_str)?;
        let source = value.get("source").and_then(Value::as_str)?;
        Some(json!({ "state": state_id, "source": source }))
    });
    BridgeProbe { health_ok, state }
}

fn bridge_result(probe: &BridgeProbe) -> Value {
    let mut state_check = json!({ "ok": probe.state_ok() });
    if let Some(state) = &probe.state {
        state_check["state"] = state["state"].clone();
        state_check["source"] = state["source"].clone();
    }
    json!({
        "ok": probe.ok(),
        "reason": probe.reason(),
        "checks": {
            "health": { "ok": probe.health_ok },
            "state": state_check
        },
        "mutated": false
    })
}

fn diagnostics_result(probe: &BridgeProbe, source: &SourceInfo) -> Value {
    json!({
        "ok": probe.ok(),
        "reason": probe.reason(),
        "api": {
            "endpoint": public_api_endpoint(),
            "health": { "ok": probe.health_ok }
        },
        "state": probe.state.clone().unwrap_or_else(|| json!({ "ok": false })),
        "mcp": {
            "server": "spine-companion",
            "version": env!("CARGO_PKG_VERSION"),
            "transport": "stdio",
            "source": source.source,
            "sourceLabel": source.label
        },
        "note": "Full GPU, model, and cache diagnostics are available in Manager > Diagnostics."
    })
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
    if let Some(value) = arguments
        .get("autoReturnMs")
        .and_then(|value| value.as_u64())
    {
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

fn required_string_argument(arguments: &Value, key: &str) -> Result<String, String> {
    match arguments.get(key) {
        Some(Value::String(value)) => Ok(value.clone()),
        Some(_) => Err(format!("Avatar job {key} must be a string.")),
        None => Err(format!("Avatar job {key} is required.")),
    }
}

fn optional_string_argument(arguments: &Value, key: &str) -> Result<Option<String>, String> {
    match arguments.get(key) {
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(format!("Avatar job {key} must be a string when provided.")),
        None => Ok(None),
    }
}

fn optional_string_array_argument(
    arguments: &Value,
    key: &str,
) -> Result<Option<Vec<String>>, String> {
    match arguments.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(ToString::to_string)
                    .ok_or_else(|| format!("Avatar job {key} must contain only strings."))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(format!(
            "Avatar job {key} must be an array of strings when provided."
        )),
        None => Ok(None),
    }
}

fn avatar_job_create_input(arguments: &Value) -> Result<avatar::AvatarJobCreateInput, String> {
    let phase = optional_string_argument(arguments, "phase")?;
    let message = optional_string_argument(arguments, "message")?;
    let pack_path = optional_string_argument(arguments, "packPath")?;
    let motions = optional_string_array_argument(arguments, "motions")?;
    Ok(avatar::AvatarJobCreateInput {
        job_id: required_string_argument(arguments, "jobId")?,
        phase: phase.unwrap_or_else(|| "planning".to_string()),
        message: message.unwrap_or_default(),
        pack_path,
        motions: motions.unwrap_or_default(),
    })
}

fn avatar_job_update_input(arguments: &Value) -> Result<avatar::AvatarJobUpdateInput, String> {
    Ok(avatar::AvatarJobUpdateInput {
        job_id: required_string_argument(arguments, "jobId")?,
        phase: optional_string_argument(arguments, "phase")?,
        message: optional_string_argument(arguments, "message")?,
        pack_path: optional_string_argument(arguments, "packPath")?,
        motions: optional_string_array_argument(arguments, "motions")?,
    })
}

fn avatar_job_result(value: Value) -> Value {
    json!({
        "recordType": "planning-progress",
        "note": "Avatar Jobs are bounded planning/progress records only. They do not auto-rig, resume execution, or export Spine runtime files.",
        "value": value
    })
}

async fn call_tool(name: &str, arguments: Value, source: &SourceInfo) -> Result<Value, String> {
    match name {
        "companion_get_state" => api_json("/state", None)
            .await
            .map(|value| text_result(value, source)),
        "companion_get_diagnostics" => {
            let probe = probe_bridge().await;
            Ok(text_result(diagnostics_result(&probe, source), source))
        }
        "companion_test_bridge" => {
            let probe = probe_bridge().await;
            Ok(text_result(bridge_result(&probe), source))
        }
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
            let job =
                avatar::create_avatar_job(&mcp_config_dir(), avatar_job_create_input(&arguments)?)?;
            Ok(text_result(
                avatar_job_result(json!({ "created": true, "job": job })),
                source,
            ))
        }
        "companion_update_avatar_job" => {
            let job =
                avatar::update_avatar_job(&mcp_config_dir(), avatar_job_update_input(&arguments)?)?;
            Ok(text_result(
                avatar_job_result(json!({ "updated": true, "job": job })),
                source,
            ))
        }
        "companion_list_avatar_jobs" => {
            let jobs = avatar::load_avatar_jobs(&mcp_config_dir())?;
            Ok(text_result(
                avatar_job_result(json!({ "jobs": jobs })),
                source,
            ))
        }
        "companion_get_avatar_job" => {
            let job_id = required_string_argument(&arguments, "jobId")?;
            let job = avatar::get_avatar_job(&mcp_config_dir(), &job_id)?;
            Ok(text_result(
                avatar_job_result(json!({ "job": job })),
                source,
            ))
        }
        "companion_validate_avatar_pack" => {
            let path = arguments
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let result = avatar::validate_pack(std::path::Path::new(path));
            Ok(text_result(
                serde_json::to_value(result).unwrap_or_else(|_| json!({})),
                source,
            ))
        }
        "companion_import_avatar_pack" => {
            let path = arguments
                .get("path")
                .and_then(|value| value.as_str())
                .unwrap_or("");
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
    fn diagnostics_contract_is_read_only_and_sanitized() {
        let source = SourceInfo {
            source: "kimi-mcp".to_string(),
            label: "Kimi".to_string(),
        };
        let probe = BridgeProbe {
            health_ok: true,
            state: Some(json!({ "state": "reviewing", "source": "kimi-mcp" })),
        };
        let diagnostics = diagnostics_result(&probe, &source);
        assert_eq!(diagnostics["ok"], true);
        assert_eq!(diagnostics["state"]["state"], "reviewing");
        assert_eq!(diagnostics["state"]["source"], "kimi-mcp");
        assert_eq!(diagnostics["mcp"]["transport"], "stdio");
        assert_eq!(diagnostics["mcp"]["sourceLabel"], "Kimi");
        assert!(diagnostics.get("gpu").is_none());
        assert!(diagnostics.get("cache").is_none());
        assert!(diagnostics.get("configPath").is_none());

        let bridge = bridge_result(&probe);
        assert_eq!(bridge["ok"], true);
        assert_eq!(bridge["reason"], "ok");
        assert_eq!(bridge["mutated"], false);
    }

    #[test]
    fn avatar_import_uses_the_tauri_config_directory() {
        assert_eq!(
            mcp_config_dir(),
            crate::user_config_dir().unwrap_or_else(std::env::temp_dir)
        );
    }

    #[test]
    fn avatar_job_tools_are_persistent_planning_contracts() {
        let tools = tools().as_array().unwrap().clone();
        for name in [
            "companion_create_avatar_job",
            "companion_update_avatar_job",
            "companion_list_avatar_jobs",
            "companion_get_avatar_job",
        ] {
            let tool = tools
                .iter()
                .find(|tool| tool["name"] == name)
                .unwrap_or_else(|| panic!("missing tool {name}"));
            assert!(tool["description"].as_str().unwrap().contains("planning"));
        }
        assert_eq!(
            tools
                .iter()
                .find(|tool| tool["name"] == "companion_create_avatar_job")
                .unwrap()["inputSchema"]["required"][0],
            "jobId"
        );
        assert_eq!(
            tools
                .iter()
                .find(|tool| tool["name"] == "companion_get_avatar_job")
                .unwrap()["inputSchema"]["required"][0],
            "jobId"
        );
    }

    #[test]
    fn avatar_job_arguments_require_an_identifier() {
        assert!(avatar_job_create_input(&json!({})).is_err());
        assert!(avatar_job_update_input(&json!({})).is_err());
    }

    #[test]
    fn avatar_job_optional_arguments_reject_wrong_types() {
        for arguments in [
            json!({ "jobId": "job", "phase": 1 }),
            json!({ "jobId": "job", "message": false }),
            json!({ "jobId": "job", "packPath": [] }),
            json!({ "jobId": "job", "motions": "idle" }),
            json!({ "jobId": "job", "motions": ["idle", 1] }),
        ] {
            assert!(avatar_job_create_input(&arguments).is_err());
            assert!(avatar_job_update_input(&arguments).is_err());
        }
        assert!(avatar_job_create_input(&json!({ "jobId": 1 })).is_err());
        assert!(avatar_job_update_input(&json!({ "jobId": 1 })).is_err());
    }

    #[test]
    fn avatar_job_schema_bounds_pack_paths() {
        assert_eq!(
            avatar_job_create_schema()["properties"]["packPath"]["maxLength"],
            2048
        );
        assert_eq!(
            avatar_job_update_schema()["properties"]["packPath"]["maxLength"],
            2048
        );
    }
}
