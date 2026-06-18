use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SERVER_NAME: &str = "spine_companion";

#[derive(Clone, Debug)]
pub struct IntegrationEnv {
    pub home: PathBuf,
    pub appdata: PathBuf,
    pub local_appdata: PathBuf,
    pub config_home: PathBuf,
}

impl IntegrationEnv {
    pub fn current() -> Option<Self> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()
            .map(PathBuf::from)?;
        let appdata = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join("AppData").join("Roaming"));
        let local_appdata = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join("AppData").join("Local"));
        let config_home = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                if cfg!(target_os = "windows") {
                    appdata.clone()
                } else {
                    home.join(".config")
                }
            });
        Some(Self {
            home,
            appdata,
            local_appdata,
            config_home,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationFormat {
    CodexToml,
    McpServersJson,
    CommandArrayJson,
    OpenCodeJson,
    TemplateOnly,
}

#[derive(Clone, Debug)]
struct IntegrationDefinition {
    id: &'static str,
    name: &'static str,
    source: &'static str,
    source_label: &'static str,
    format: IntegrationFormat,
    config_paths: Vec<PathBuf>,
    app_probes: Vec<PathBuf>,
    note: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiIntegration {
    pub id: String,
    pub name: String,
    pub source: String,
    pub source_label: String,
    pub config_path: String,
    pub config_format: IntegrationFormat,
    pub installed: bool,
    pub config_found: bool,
    pub configured: bool,
    pub supported: bool,
    pub needs_restart: bool,
    pub status: String,
    pub note: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPreview {
    pub integration: AiIntegration,
    pub target_path: String,
    pub backup_path: String,
    pub server_name: String,
    pub command: Vec<String>,
    pub env: Value,
    pub preview: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationApplyResult {
    pub integration: AiIntegration,
    pub target_path: String,
    pub backup_path: String,
    pub configured: bool,
    pub needs_restart: bool,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn exe_command(exe_path: &Path) -> Vec<String> {
    vec![path_string(exe_path), "--mcp".to_string()]
}

fn source_env(api: &str, source: &str, source_label: &str) -> Value {
    json!({
        "COMPANION_API": api,
        "COMPANION_SOURCE": source,
        "COMPANION_SOURCE_LABEL": source_label
    })
}

fn generic_mcp_entry(exe_path: &Path, api: &str, source: &str, source_label: &str) -> Value {
    json!({
        "command": path_string(exe_path),
        "args": ["--mcp"],
        "env": source_env(api, source, source_label)
    })
}

fn command_array_entry(exe_path: &Path, api: &str, source: &str, source_label: &str) -> Value {
    json!({
        "command": exe_command(exe_path),
        "env": source_env(api, source, source_label)
    })
}

fn opencode_entry(exe_path: &Path, api: &str, source: &str, source_label: &str) -> Value {
    json!({
        "type": "local",
        "command": exe_command(exe_path),
        "enabled": true,
        "environment": source_env(api, source, source_label)
    })
}

fn definitions(env: &IntegrationEnv) -> Vec<IntegrationDefinition> {
    let vscode_user = env.appdata.join("Code").join("User");
    vec![
        IntegrationDefinition {
            id: "codex",
            name: "Codex",
            source: "codex-mcp",
            source_label: "Codex",
            format: IntegrationFormat::CodexToml,
            config_paths: vec![env.home.join(".codex").join("config.toml")],
            app_probes: vec![env.home.join(".codex")],
            note: "Writes ~/.codex/config.toml. Restart Codex or open a new session.",
        },
        IntegrationDefinition {
            id: "claude-desktop",
            name: "Claude Desktop",
            source: "claude-mcp",
            source_label: "Claude",
            format: IntegrationFormat::McpServersJson,
            config_paths: vec![env
                .appdata
                .join("Claude")
                .join("claude_desktop_config.json")],
            app_probes: vec![env.appdata.join("Claude")],
            note: "Writes Claude Desktop user MCP config. Restart Claude Desktop.",
        },
        IntegrationDefinition {
            id: "cursor",
            name: "Cursor",
            source: "cursor-mcp",
            source_label: "Cursor",
            format: IntegrationFormat::McpServersJson,
            config_paths: vec![env.home.join(".cursor").join("mcp.json")],
            app_probes: vec![env.appdata.join("Cursor"), env.local_appdata.join("Programs").join("cursor")],
            note: "Writes the global Cursor MCP config at ~/.cursor/mcp.json.",
        },
        IntegrationDefinition {
            id: "vscode",
            name: "VS Code",
            source: "vscode-mcp",
            source_label: "VS Code",
            format: IntegrationFormat::McpServersJson,
            config_paths: vec![vscode_user.join("mcp.json")],
            app_probes: vec![vscode_user],
            note: "Writes VS Code user mcp.json when present. Some extensions may use their own config.",
        },
        IntegrationDefinition {
            id: "roo-cline",
            name: "Roo / Cline",
            source: "roo-mcp",
            source_label: "Roo",
            format: IntegrationFormat::McpServersJson,
            config_paths: vec![
                env.appdata
                    .join("Code")
                    .join("User")
                    .join("globalStorage")
                    .join("rooveterinaryinc.roo-cline")
                    .join("settings")
                    .join("cline_mcp_settings.json"),
                env.appdata
                    .join("Code")
                    .join("User")
                    .join("globalStorage")
                    .join("saoudrizwan.claude-dev")
                    .join("settings")
                    .join("cline_mcp_settings.json"),
            ],
            app_probes: vec![env
                .appdata
                .join("Code")
                .join("User")
                .join("globalStorage")
                .join("rooveterinaryinc.roo-cline")],
            note: "Writes the Roo/Cline extension MCP settings file.",
        },
        IntegrationDefinition {
            id: "gemini-antigravity",
            name: "Gemini / Antigravity",
            source: "gemini-mcp",
            source_label: "Gemini",
            format: IntegrationFormat::McpServersJson,
            config_paths: vec![env
                .home
                .join(".gemini")
                .join("antigravity")
                .join("mcp_config.json")],
            app_probes: vec![env.home.join(".gemini")],
            note: "Writes the Gemini / Antigravity MCP config when available.",
        },
        IntegrationDefinition {
            id: "opencode",
            name: "OpenCode",
            source: "opencode-mcp",
            source_label: "OpenCode",
            format: IntegrationFormat::OpenCodeJson,
            config_paths: vec![
                env.home
                    .join(".config")
                    .join("opencode")
                    .join("opencode.jsonc"),
                env.home
                    .join(".config")
                    .join("opencode")
                    .join("opencode.json"),
                env.home
                    .join(".config")
                    .join("opencode")
                    .join("config.json"),
                env.home.join(".opencode.json"),
                env.config_home.join("opencode").join("opencode.jsonc"),
                env.config_home.join("opencode").join("opencode.json"),
                env.local_appdata.join("opencode").join(".opencode.json"),
            ],
            app_probes: vec![
                env.home.join(".config").join("opencode"),
                env.config_home.join("opencode"),
                env.appdata.join("ai.opencode.desktop"),
                env.local_appdata
                    .join("Programs")
                    .join("@opencode-aidesktop"),
            ],
            note: "Writes opencode.json under the official mcp field.",
        },
        IntegrationDefinition {
            id: "mimocode",
            name: "MiMoCode",
            source: "mimocode-mcp",
            source_label: "MiMoCode",
            format: IntegrationFormat::CommandArrayJson,
            config_paths: vec![
                env.home.join(".local").join("share").join("mimocode").join("config.json"),
                env.appdata.join("MiMoCode").join("config.json"),
                env.local_appdata.join("MiMoCode").join("config.json"),
            ],
            app_probes: vec![env.home.join(".local").join("share").join("mimocode")],
            note: "Best-effort support. MiMoCode MCP config is not publicly documented.",
        },
        IntegrationDefinition {
            id: "custom",
            name: "Custom MCP Client",
            source: "ai-mcp",
            source_label: "AI",
            format: IntegrationFormat::TemplateOnly,
            config_paths: vec![],
            app_probes: vec![],
            note: "Copy a template for any MCP-capable client that supports local stdio servers.",
        },
    ]
}

fn selected_config_path(def: &IntegrationDefinition) -> Option<PathBuf> {
    if def.format == IntegrationFormat::TemplateOnly {
        return None;
    }
    def.config_paths
        .iter()
        .find(|path| path.exists())
        .cloned()
        .or_else(|| def.config_paths.first().cloned())
}

fn read_text(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

fn is_configured(path: &Path) -> bool {
    read_text(path).contains(SERVER_NAME) || read_text(path).contains("spine-companion")
}

fn integration_status(
    installed: bool,
    config_found: bool,
    configured: bool,
    supported: bool,
) -> String {
    if !supported {
        "Unsupported".to_string()
    } else if configured {
        "Configured".to_string()
    } else if config_found {
        "Config found".to_string()
    } else if installed {
        "Installed".to_string()
    } else {
        "Not detected".to_string()
    }
}

fn integration_from_def(def: &IntegrationDefinition) -> AiIntegration {
    let config_path = selected_config_path(def);
    let config_found = config_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let configured = config_path
        .as_ref()
        .map(|path| path.exists() && is_configured(path))
        .unwrap_or(false);
    let installed = config_found || def.app_probes.iter().any(|path| path.exists());
    let display_config_path = if installed || config_found || configured {
        config_path.clone()
    } else {
        None
    };
    let supported = def.format != IntegrationFormat::TemplateOnly || def.id == "custom";
    AiIntegration {
        id: def.id.to_string(),
        name: def.name.to_string(),
        source: def.source.to_string(),
        source_label: def.source_label.to_string(),
        config_path: display_config_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        config_format: def.format,
        installed,
        config_found,
        configured,
        supported,
        needs_restart: configured,
        status: integration_status(installed, config_found, configured, supported),
        note: def.note.to_string(),
    }
}

pub fn list_ai_integrations_with_env(env: &IntegrationEnv) -> Vec<AiIntegration> {
    definitions(env).iter().map(integration_from_def).collect()
}

pub fn list_ai_integrations() -> Vec<AiIntegration> {
    IntegrationEnv::current()
        .map(|env| list_ai_integrations_with_env(&env))
        .unwrap_or_default()
}

fn json_entry_for_format(
    format: IntegrationFormat,
    exe_path: &Path,
    api: &str,
    source: &str,
    source_label: &str,
) -> Value {
    match format {
        IntegrationFormat::OpenCodeJson => opencode_entry(exe_path, api, source, source_label),
        IntegrationFormat::CommandArrayJson => {
            command_array_entry(exe_path, api, source, source_label)
        }
        _ => generic_mcp_entry(exe_path, api, source, source_label),
    }
}

fn upsert_json_value(
    existing: Value,
    format: IntegrationFormat,
    exe_path: &Path,
    api: &str,
    source: &str,
    source_label: &str,
) -> Value {
    let mut root = if existing.is_object() {
        existing
    } else {
        json!({})
    };
    if format == IntegrationFormat::OpenCodeJson {
        if root
            .get("mcp")
            .and_then(|value| value.as_object())
            .is_none()
        {
            root["mcp"] = json!({});
        }
        root["mcp"][SERVER_NAME] =
            json_entry_for_format(format, exe_path, api, source, source_label);
        if root.get("$schema").is_none() {
            root["$schema"] = json!("https://opencode.ai/config.json");
        }
        return root;
    }
    let key = if format == IntegrationFormat::CommandArrayJson {
        "mcp"
    } else {
        "mcpServers"
    };
    if root.get(key).and_then(|value| value.as_object()).is_none() {
        root[key] = json!({});
    }
    root[key][SERVER_NAME] = json_entry_for_format(format, exe_path, api, source, source_label);
    root
}

fn codex_toml_block(exe_path: &Path, api: &str, source: &str, source_label: &str) -> String {
    format!(
        "# Spine Companion local MCP bridge.\n[mcp_servers.{SERVER_NAME}]\ncommand = \"{}\"\nargs = [\"--mcp\"]\nenv = {{ COMPANION_API = \"{}\", COMPANION_SOURCE = \"{}\", COMPANION_SOURCE_LABEL = \"{}\" }}",
        path_string(exe_path),
        api,
        source,
        source_label
    )
}

fn upsert_codex_toml(current: &str, block: &str) -> String {
    let marker = format!("[mcp_servers.{SERVER_NAME}]");
    if let Some(start) = current.find(&marker) {
        let prefix_start = current[..start]
            .rfind("# Spine Companion local MCP bridge.")
            .unwrap_or(start);
        let after_marker = start + marker.len();
        let rest = &current[after_marker..];
        let next_section = rest.find("\n[").map(|offset| after_marker + offset + 1);
        let end = next_section.unwrap_or(current.len());
        format!(
            "{}\n\n{}\n\n{}",
            current[..prefix_start].trim_end(),
            block.trim(),
            current[end..].trim_start()
        )
    } else {
        format!("{}\n\n{}\n", current.trim_end(), block.trim())
    }
}

fn render_config_text(
    def: &IntegrationDefinition,
    current: &str,
    exe_path: &Path,
    api: &str,
) -> Result<String, String> {
    match def.format {
        IntegrationFormat::CodexToml => {
            let block = codex_toml_block(exe_path, api, def.source, def.source_label);
            Ok(upsert_codex_toml(current, &block))
        }
        IntegrationFormat::McpServersJson
        | IntegrationFormat::CommandArrayJson
        | IntegrationFormat::OpenCodeJson => {
            let value = if current.trim().is_empty() {
                json!({})
            } else {
                parse_json_or_jsonc(current)
                    .map_err(|error| format!("Config is not valid JSON: {error}"))?
            };
            let next = upsert_json_value(
                value,
                def.format,
                exe_path,
                api,
                def.source,
                def.source_label,
            );
            serde_json::to_string_pretty(&next).map_err(|error| error.to_string())
        }
        IntegrationFormat::TemplateOnly => {
            Ok(template_bundle(exe_path, api, def.source, def.source_label))
        }
    }
}

fn strip_jsonc_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\n' {
                    out.push('\n');
                    break;
                }
            }
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut prev = '\0';
            for next in chars.by_ref() {
                if prev == '*' && next == '/' {
                    break;
                }
                prev = next;
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn remove_trailing_commas(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars = input.chars().collect::<Vec<_>>();
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;
    while i < chars.len() {
        let ch = chars[i];
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            i += 1;
            continue;
        }
        if ch == ',' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                i += 1;
                continue;
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

fn parse_json_or_jsonc(input: &str) -> serde_json::Result<Value> {
    serde_json::from_str(input).or_else(|_| {
        let stripped = remove_trailing_commas(&strip_jsonc_comments(input));
        serde_json::from_str(&stripped)
    })
}

fn backup_path(path: &Path) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{}.bak-{}", path.to_string_lossy(), ts)
}

fn find_definition(env: &IntegrationEnv, id: &str) -> Result<IntegrationDefinition, String> {
    definitions(env)
        .into_iter()
        .find(|def| def.id == id)
        .ok_or_else(|| format!("Unknown AI integration: {id}"))
}

pub fn preview_ai_integration_config(
    id: &str,
    exe_path: &Path,
    api: &str,
) -> Result<IntegrationPreview, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    let def = find_definition(&env, id)?;
    let integration = integration_from_def(&def);
    if def.format == IntegrationFormat::TemplateOnly {
        return Ok(IntegrationPreview {
            integration,
            target_path: String::new(),
            backup_path: String::new(),
            server_name: SERVER_NAME.to_string(),
            command: exe_command(exe_path),
            env: source_env(api, def.source, def.source_label),
            preview: template_bundle(exe_path, api, def.source, def.source_label),
        });
    }
    let target =
        selected_config_path(&def).ok_or_else(|| "No config path available".to_string())?;
    let current = read_text(&target);
    let preview = render_config_text(&def, &current, exe_path, api)?;
    Ok(IntegrationPreview {
        integration,
        target_path: target.to_string_lossy().to_string(),
        backup_path: backup_path(&target),
        server_name: SERVER_NAME.to_string(),
        command: exe_command(exe_path),
        env: source_env(api, def.source, def.source_label),
        preview,
    })
}

pub fn configure_ai_integration(
    id: &str,
    exe_path: &Path,
    api: &str,
) -> Result<IntegrationApplyResult, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    let def = find_definition(&env, id)?;
    if def.format == IntegrationFormat::TemplateOnly {
        return Err("Custom integrations are template-only.".to_string());
    }
    let target =
        selected_config_path(&def).ok_or_else(|| "No config path available".to_string())?;
    let current = read_text(&target);
    let next = render_config_text(&def, &current, exe_path, api)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let backup = backup_path(&target);
    if target.exists() {
        std::fs::copy(&target, &backup).map_err(|error| error.to_string())?;
    } else {
        std::fs::write(&backup, "").map_err(|error| error.to_string())?;
    }
    std::fs::write(&target, format!("{}\n", next.trim_end())).map_err(|error| error.to_string())?;
    let integration = integration_from_def(&def);
    Ok(IntegrationApplyResult {
        integration,
        target_path: target.to_string_lossy().to_string(),
        backup_path: backup,
        configured: true,
        needs_restart: true,
    })
}

pub fn template_bundle(exe_path: &Path, api: &str, source: &str, source_label: &str) -> String {
    let mut generic_servers = serde_json::Map::new();
    generic_servers.insert(
        SERVER_NAME.to_string(),
        generic_mcp_entry(exe_path, api, source, source_label),
    );
    let generic = json!({ "mcpServers": Value::Object(generic_servers) });

    let mut command_servers = serde_json::Map::new();
    command_servers.insert(
        SERVER_NAME.to_string(),
        command_array_entry(exe_path, api, source, source_label),
    );
    let command_array = json!({ "mcp": Value::Object(command_servers) });

    let mut opencode_servers = serde_json::Map::new();
    opencode_servers.insert(
        SERVER_NAME.to_string(),
        opencode_entry(exe_path, api, source, source_label),
    );
    let opencode = json!({
        "$schema": "https://opencode.ai/config.json",
        "mcp": Value::Object(opencode_servers)
    });
    format!(
        "Standard mcpServers JSON:\n{}\n\nCommand-array JSON:\n{}\n\nOpenCode opencode.json:\n{}",
        serde_json::to_string_pretty(&generic).unwrap_or_default(),
        serde_json::to_string_pretty(&command_array).unwrap_or_default(),
        serde_json::to_string_pretty(&opencode).unwrap_or_default()
    )
}

pub fn templates_for_custom(exe_path: &Path, api: &str) -> String {
    template_bundle(exe_path, api, "ai-mcp", "AI")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture_env(root: &Path) -> IntegrationEnv {
        IntegrationEnv {
            home: root.join("home"),
            appdata: root.join("appdata"),
            local_appdata: root.join("localappdata"),
            config_home: root.join("config"),
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-ai-integrations-{}-{}",
            name,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn detects_configured_tools_from_fixture_paths() {
        let root = temp_root("detect");
        let env = fixture_env(&root);
        let codex = env.home.join(".codex").join("config.toml");
        fs::create_dir_all(codex.parent().unwrap()).unwrap();
        fs::write(&codex, "[mcp_servers.spine_companion]\ncommand = \"x\"\n").unwrap();

        let items = list_ai_integrations_with_env(&env);
        let codex_item = items.iter().find(|item| item.id == "codex").unwrap();
        assert!(codex_item.config_found);
        assert!(codex_item.configured);
        assert_eq!(codex_item.status, "Configured");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_preview_is_idempotent() {
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");
        let def = IntegrationDefinition {
            id: "codex",
            name: "Codex",
            source: "codex-mcp",
            source_label: "Codex",
            format: IntegrationFormat::CodexToml,
            config_paths: vec![],
            app_probes: vec![],
            note: "",
        };
        let first = render_config_text(&def, "", &exe, "http://127.0.0.1:17388").unwrap();
        let second = render_config_text(&def, &first, &exe, "http://127.0.0.1:17388").unwrap();
        assert_eq!(second.matches("[mcp_servers.spine_companion]").count(), 1);
    }

    #[test]
    fn mimocode_command_array_writes_source_env() {
        let exe = PathBuf::from("C:/Spine/spine-companion.exe");
        let value = upsert_json_value(
            json!({}),
            IntegrationFormat::CommandArrayJson,
            &exe,
            "http://127.0.0.1:17388",
            "mimocode-mcp",
            "MiMoCode",
        );
        assert_eq!(
            value["mcp"]["spine_companion"]["command"][1],
            serde_json::Value::String("--mcp".to_string())
        );
        assert_eq!(
            value["mcp"]["spine_companion"]["env"]["COMPANION_SOURCE"],
            serde_json::Value::String("mimocode-mcp".to_string())
        );
    }

    #[test]
    fn opencode_uses_official_mcp_shape() {
        let exe = PathBuf::from("/Applications/Spine Companion.app/Contents/MacOS/spine-companion");
        let value = upsert_json_value(
            json!({}),
            IntegrationFormat::OpenCodeJson,
            &exe,
            "http://127.0.0.1:17388",
            "opencode-mcp",
            "OpenCode",
        );
        assert_eq!(value["mcp"]["spine_companion"]["type"], "local");
        assert_eq!(
            value["mcp"]["spine_companion"]["environment"]["COMPANION_SOURCE"],
            "opencode-mcp"
        );
    }

    #[test]
    fn opencode_prefers_config_dir_jsonc_over_legacy_appdata_path() {
        let root = temp_root("opencode-paths");
        let env = fixture_env(&root);
        let opencode_jsonc = env
            .home
            .join(".config")
            .join("opencode")
            .join("opencode.jsonc");
        let legacy = env.config_home.join("opencode").join("opencode.json");
        fs::create_dir_all(opencode_jsonc.parent().unwrap()).unwrap();
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&opencode_jsonc, "{}").unwrap();
        fs::write(&legacy, "{\"mcp\":{\"spine_companion\":{}}}").unwrap();

        let def = definitions(&env)
            .into_iter()
            .find(|def| def.id == "opencode")
            .unwrap();
        assert_eq!(selected_config_path(&def), Some(opencode_jsonc));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn undetected_integration_does_not_expose_candidate_config_path() {
        let root = temp_root("hidden-candidate");
        let env = fixture_env(&root);
        let items = list_ai_integrations_with_env(&env);
        let claude = items
            .iter()
            .find(|item| item.id == "claude-desktop")
            .unwrap();
        assert_eq!(claude.status, "Not detected");
        assert_eq!(claude.config_path, "");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_jsonc_with_comments_and_trailing_commas() {
        let parsed = parse_json_or_jsonc(
            r#"{
              // OpenCode allows JSONC
              "mcp": {
                "existing": {
                  "type": "local",
                },
              },
            }"#,
        )
        .unwrap();
        assert_eq!(parsed["mcp"]["existing"]["type"], "local");
    }
}
