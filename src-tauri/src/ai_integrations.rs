use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

const SERVER_NAME: &str = "spine_companion";
const INSTRUCTION_BLOCK_START: &str = "<!-- spine-companion-status -->";
const INSTRUCTION_BLOCK_END: &str = "<!-- /spine-companion-status -->";

#[derive(Clone, Debug)]
pub struct IntegrationEnv {
    pub home: PathBuf,
    pub appdata: PathBuf,
    pub local_appdata: PathBuf,
    pub config_home: PathBuf,
    pub kimi_share_dir: PathBuf,
}

impl IntegrationEnv {
    pub fn current() -> Option<Self> {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()
            .map(PathBuf::from)?;
        let appdata_override = std::env::var("APPDATA").ok().map(PathBuf::from);
        let config_home = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                if cfg!(target_os = "windows") {
                    appdata_override
                        .clone()
                        .unwrap_or_else(|| home.join("AppData").join("Roaming"))
                } else {
                    home.join(".config")
                }
            });
        let data_home = std::env::var("XDG_DATA_HOME").ok().map(PathBuf::from);
        let (default_appdata, default_local_appdata) =
            platform_data_dirs(&home, &config_home, data_home.as_deref());
        let appdata = appdata_override.unwrap_or(default_appdata);
        let local_appdata = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or(default_local_appdata);
        let kimi_share_dir = std::env::var("KIMI_SHARE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".kimi"));
        Some(Self {
            home,
            appdata,
            local_appdata,
            config_home,
            kimi_share_dir,
        })
    }
}

fn platform_data_dirs(
    home: &Path,
    config_home: &Path,
    data_home: Option<&Path>,
) -> (PathBuf, PathBuf) {
    if cfg!(target_os = "windows") {
        (
            home.join("AppData").join("Roaming"),
            home.join("AppData").join("Local"),
        )
    } else if cfg!(target_os = "macos") {
        let application_support = home.join("Library").join("Application Support");
        (application_support.clone(), application_support)
    } else {
        let data_home = data_home
            .map(Path::to_path_buf)
            .unwrap_or_else(|| home.join(".local").join("share"));
        (config_home.to_path_buf(), data_home)
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
    pub instructions_found: bool,
    pub instructions_path: String,
    pub status: String,
    pub note: String,
    pub last_tested_at: Option<u64>,
    pub last_test_ok: Option<bool>,
    pub last_test_error: String,
    pub last_configured_at: Option<u64>,
    pub last_reported_at: Option<u64>,
    pub last_backup_path: String,
    pub restore_available: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomIntegrationInput {
    pub tool_name: Option<String>,
    pub source: Option<String>,
    pub source_label: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstructions {
    pub integration: AiIntegration,
    pub target_path: String,
    pub exists: bool,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstructionInstallResult {
    pub integration: AiIntegration,
    pub target_path: String,
    pub backup_path: String,
    pub created: bool,
    pub updated: bool,
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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct IntegrationRuntimeState {
    revision: u64,
    last_transaction_id: String,
    last_tested_at: Option<u64>,
    last_test_ok: Option<bool>,
    last_test_error: String,
    last_configured_at: Option<u64>,
    last_reported_at: Option<u64>,
    needs_restart: bool,
    config_restore: Option<IntegrationRestorePoint>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationRestorePoint {
    target_path: String,
    backup_path: Option<String>,
    backup_sha256: Option<String>,
    applied_sha256: String,
    target_created: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingIntegrationOperation {
    transaction_id: String,
    tool_id: String,
    kind: String,
    target_path: String,
    before_sha256: Option<String>,
    after_sha256: Option<String>,
    final_restore: Option<IntegrationRestorePoint>,
    last_configured_at: Option<u64>,
    safety_backup_path: String,
    restored_from: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct IntegrationStateFile {
    version: u32,
    tools: BTreeMap<String, IntegrationRuntimeState>,
}

impl Default for IntegrationStateFile {
    fn default() -> Self {
        Self {
            version: 1,
            tools: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRestoreResult {
    pub integration: AiIntegration,
    pub target_path: String,
    pub restored_from: String,
    pub safety_backup_path: String,
    pub needs_restart: bool,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
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
            id: "kimi-code",
            name: "Kimi Code CLI",
            source: "kimi-mcp",
            source_label: "Kimi",
            format: IntegrationFormat::McpServersJson,
            config_paths: vec![env.kimi_share_dir.join("mcp.json")],
            app_probes: vec![
                env.kimi_share_dir.clone(),
                env.home.join(".local").join("bin").join("kimi"),
                env.home.join(".local").join("bin").join("kimi.exe"),
            ],
            note: "Writes the official Kimi Code CLI MCP config. Project AGENTS.md guidance remains copy-only because Kimi loads instructions per workspace.",
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

fn read_text_if_exists(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Cannot read {}: {error}", path.display())),
    }
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

fn instructions_path_for_def(env: &IntegrationEnv, def: &IntegrationDefinition) -> Option<PathBuf> {
    match def.id {
        "codex" => Some(env.home.join(".codex").join("AGENTS.md")),
        "vscode" => Some(env.home.join(".github").join("copilot-instructions.md")),
        "cursor" => Some(
            env.home
                .join(".cursor")
                .join("rules")
                .join("spine-companion.md"),
        ),
        "claude-desktop" => Some(env.home.join(".claude").join("CLAUDE.md")),
        "opencode" => Some(env.home.join(".config").join("opencode").join("AGENTS.md")),
        "mimocode" => Some(
            env.home
                .join(".local")
                .join("share")
                .join("mimocode")
                .join("AGENTS.md"),
        ),
        "roo-cline" => Some(env.home.join(".cline").join("spine-companion.md")),
        "gemini-antigravity" => Some(env.home.join(".gemini").join("GEMINI.md")),
        _ => None,
    }
}

fn integration_from_def(env: &IntegrationEnv, def: &IntegrationDefinition) -> AiIntegration {
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
    let instructions_target = instructions_path_for_def(env, def);
    let instructions_found = instructions_target
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let instructions_path = if installed || config_found || configured {
        instructions_target
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };
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
        needs_restart: false,
        instructions_found,
        instructions_path,
        status: integration_status(installed, config_found, configured, supported),
        note: def.note.to_string(),
        last_tested_at: None,
        last_test_ok: None,
        last_test_error: String::new(),
        last_configured_at: None,
        last_reported_at: None,
        last_backup_path: String::new(),
        restore_available: false,
    }
}

fn instruction_title(def: &IntegrationDefinition) -> String {
    format!("Spine Companion integration for {}", def.name)
}

fn instruction_body(def: &IntegrationDefinition) -> String {
    let tool = def.name;
    let source = def.source;
    let label = def.source_label;
    format!(
        r#"# Spine Companion Status Reporting

When the `spine_companion` MCP tools are available in {tool}, proactively report visible work phases to the local Spine Companion desktop app.

Use `companion_report_ai_phase` with a short human-readable message:

- `thinking`: reading context, planning, or deciding next steps.
- `editing`: changing files or applying patches.
- `running`: running commands, tests, builds, installs, or long local tasks.
- `reviewing`: checking diffs, logs, screenshots, or test output.
- `waiting`: waiting for user input or an external process.
- `succeeded`: final successful completion.
- `failed`: blocker or failed completion.

Prefer the configured MCP source `{source}` / `{label}`. If only the compatibility alias exists, `companion_report_codex_phase` is acceptable, but it must use the configured source from the MCP environment.

Do not spam updates for tiny steps. Report at meaningful phase boundaries and continue the user task if the companion app is unavailable.
"#
    )
}

pub fn generate_agent_instructions(id: &str) -> Result<AgentInstructions, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    generate_agent_instructions_with_env(&env, id)
}

fn generate_agent_instructions_with_env(
    env: &IntegrationEnv,
    id: &str,
) -> Result<AgentInstructions, String> {
    let def = find_definition(env, id)?;
    if def.format == IntegrationFormat::TemplateOnly {
        return Err(
            "Custom integrations use editable templates instead of agent files.".to_string(),
        );
    }
    let integration = integration_from_def(env, &def);
    let target = instructions_path_for_def(env, &def);
    let body = instruction_body(&def);
    Ok(AgentInstructions {
        integration,
        target_path: target
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        exists: target.as_ref().map(|path| path.exists()).unwrap_or(false),
        title: instruction_title(&def),
        body,
    })
}

pub fn list_ai_integrations_with_env(env: &IntegrationEnv) -> Vec<AiIntegration> {
    definitions(env)
        .iter()
        .map(|def| integration_from_def(env, def))
        .collect()
}

pub fn list_ai_integrations() -> Vec<AiIntegration> {
    IntegrationEnv::current()
        .map(|env| list_ai_integrations_with_env(&env))
        .unwrap_or_default()
}

fn managed_instruction_block(def: &IntegrationDefinition) -> String {
    format!(
        "{INSTRUCTION_BLOCK_START}\n{}\n{INSTRUCTION_BLOCK_END}",
        instruction_body(def).trim_end()
    )
}

fn upsert_managed_instruction_block(current: &str, block: &str) -> String {
    if let Some(start) = current.find(INSTRUCTION_BLOCK_START) {
        let search_start = start + INSTRUCTION_BLOCK_START.len();
        if let Some(end_offset) = current[search_start..].find(INSTRUCTION_BLOCK_END) {
            let end = search_start + end_offset + INSTRUCTION_BLOCK_END.len();
            return format!("{}{}{}", &current[..start], block, &current[end..]);
        }
    }

    if current.is_empty() {
        return format!("{block}\n");
    }

    let separator = if current.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    format!("{current}{separator}{block}\n")
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn instruction_backup_path(path: &Path) -> PathBuf {
    PathBuf::from(format!(
        "{}.bak-{}",
        path.to_string_lossy(),
        timestamp_nanos()
    ))
}

fn write_backup_text(path: &Path, contents: &str) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn replace_file_atomically(temporary: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        return std::fs::rename(temporary, target).map_err(|error| error.to_string());
    }
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_file_atomically(temporary: &Path, target: &Path) -> Result<(), String> {
    std::fs::rename(temporary, target).map_err(|error| error.to_string())
}

fn atomic_write_text(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Instruction path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("instructions");
    let temporary = parent.join(format!(
        ".{file_name}.tmp-{}-{}",
        timestamp_nanos(),
        std::process::id()
    ));

    let result = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        replace_file_atomically(&temporary, path)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn integration_state_path(config_dir: &Path) -> PathBuf {
    config_dir.join("ai-integration-state.json")
}

fn pending_integration_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("ai-integration-pending")
}

fn pending_integration_path(config_dir: &Path, id: &str) -> PathBuf {
    pending_integration_dir(config_dir).join(format!("{id}.json"))
}

fn load_integration_state(config_dir: &Path) -> Result<IntegrationStateFile, String> {
    let path = integration_state_path(config_dir);
    if !path.exists() {
        return Ok(IntegrationStateFile::default());
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("Cannot parse {}: {error}", path.display()))
}

fn save_integration_state(config_dir: &Path, state: &IntegrationStateFile) -> Result<(), String> {
    std::fs::create_dir_all(config_dir).map_err(|error| error.to_string())?;
    let text = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    atomic_write_text(&integration_state_path(config_dir), &format!("{text}\n"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Cannot read {} for verification: {error}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn current_sha256(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(sha256_bytes(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Cannot read {} for verification: {error}",
            path.display()
        )),
    }
}

fn is_safe_sibling_backup(target: &Path, candidate: &Path) -> bool {
    if target.parent() != candidate.parent() {
        return false;
    }
    let Some(target_name) = target.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(candidate_name) = candidate.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    candidate_name.starts_with(&format!("{target_name}.bak-"))
}

fn write_pending_operation(
    config_dir: &Path,
    operation: &PendingIntegrationOperation,
) -> Result<(), String> {
    let directory = pending_integration_dir(config_dir);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let text = serde_json::to_string_pretty(operation).map_err(|error| error.to_string())?;
    atomic_write_text(
        &pending_integration_path(config_dir, &operation.tool_id),
        &format!("{text}\n"),
    )
}

fn remove_pending_operation(config_dir: &Path, id: &str) -> Result<(), String> {
    let path = pending_integration_path(config_dir, id);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot remove {}: {error}", path.display())),
    }
}

fn commit_pending_operation(
    config_dir: &Path,
    operation: &PendingIntegrationOperation,
) -> Result<(), String> {
    let mut state_file = load_integration_state(config_dir)?;
    let state = state_file
        .tools
        .entry(operation.tool_id.clone())
        .or_default();
    if state.last_transaction_id == operation.transaction_id {
        return Ok(());
    }
    state.last_transaction_id = operation.transaction_id.clone();
    state.revision = state.revision.saturating_add(1);
    state.needs_restart = true;
    state.config_restore = operation.final_restore.clone();
    if let Some(configured_at) = operation.last_configured_at {
        state.last_configured_at = Some(configured_at);
    }
    state.last_reported_at = None;
    clear_test_state(state);
    save_integration_state(config_dir, &state_file)
}

fn reconcile_pending_integrations_with_env(
    env: &IntegrationEnv,
    config_dir: &Path,
) -> Result<(), String> {
    let directory = pending_integration_dir(config_dir);
    if !directory.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(&directory).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text = std::fs::read_to_string(entry.path()).map_err(|error| error.to_string())?;
        let operation: PendingIntegrationOperation = serde_json::from_str(&text)
            .map_err(|error| format!("Cannot parse {}: {error}", entry.path().display()))?;
        let def = find_definition(env, &operation.tool_id)?;
        let allowed_target =
            selected_config_path(&def).ok_or_else(|| "No config path available".to_string())?;
        let target = PathBuf::from(&operation.target_path);
        if target != allowed_target {
            return Err(format!(
                "Pending integration target no longer matches {}.",
                operation.tool_id
            ));
        }
        if !operation.safety_backup_path.is_empty()
            && !is_safe_sibling_backup(&target, Path::new(&operation.safety_backup_path))
        {
            return Err("Pending integration safety backup path is invalid.".to_string());
        }
        if let Some(restore) = &operation.final_restore {
            if PathBuf::from(&restore.target_path) != target {
                return Err("Pending integration restore target is invalid.".to_string());
            }
            if let Some(backup) = &restore.backup_path {
                let backup = Path::new(backup);
                if !is_safe_sibling_backup(&target, backup) {
                    return Err("Pending integration restore backup path is invalid.".to_string());
                }
                if current_sha256(backup)?.as_deref() != restore.backup_sha256.as_deref() {
                    return Err(
                        "Pending integration restore backup failed verification.".to_string()
                    );
                }
            }
        }
        let current = current_sha256(&target)?;
        if current == operation.after_sha256 {
            commit_pending_operation(config_dir, &operation)?;
            remove_pending_operation(config_dir, &operation.tool_id)?;
        } else if current == operation.before_sha256 {
            if !operation.safety_backup_path.is_empty() {
                let _ = std::fs::remove_file(&operation.safety_backup_path);
            }
            remove_pending_operation(config_dir, &operation.tool_id)?;
        } else {
            return Err(format!(
                "Pending {} operation for {} needs manual review: {}",
                operation.kind,
                operation.tool_id,
                entry.path().display()
            ));
        }
    }
    Ok(())
}

fn bounded_error(error: &str) -> String {
    error.chars().take(600).collect()
}

fn clear_test_state(state: &mut IntegrationRuntimeState) {
    state.last_tested_at = None;
    state.last_test_ok = None;
    state.last_test_error.clear();
}

fn update_integration_state<F>(
    config_dir: &Path,
    id: &str,
    update: F,
) -> Result<IntegrationRuntimeState, String>
where
    F: FnOnce(&mut IntegrationRuntimeState) -> Result<(), String>,
{
    let mut state_file = load_integration_state(config_dir)?;
    let state = state_file.tools.entry(id.to_string()).or_default();
    update(state)?;
    let result = state.clone();
    save_integration_state(config_dir, &state_file)?;
    Ok(result)
}

fn apply_runtime_state(item: &mut AiIntegration, state: &IntegrationRuntimeState) {
    item.needs_restart = state.needs_restart;
    item.last_tested_at = state.last_tested_at;
    item.last_test_ok = state.last_test_ok;
    item.last_test_error = state.last_test_error.clone();
    item.last_configured_at = state.last_configured_at;
    item.last_reported_at = state.last_reported_at;
    item.restore_available = state.config_restore.is_some();
    item.last_backup_path = state
        .config_restore
        .as_ref()
        .and_then(|restore| restore.backup_path.clone())
        .unwrap_or_default();
}

pub fn list_ai_integrations_with_state(config_dir: &Path) -> Result<Vec<AiIntegration>, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    reconcile_pending_integrations_with_env(&env, config_dir)?;
    let state = load_integration_state(config_dir)?;
    let mut items = list_ai_integrations_with_env(&env);
    for item in &mut items {
        if let Some(runtime) = state.tools.get(&item.id) {
            apply_runtime_state(item, runtime);
        }
    }
    Ok(items)
}

#[cfg(test)]
fn record_config_applied(
    config_dir: &Path,
    id: &str,
    result: &IntegrationApplyResult,
) -> Result<(), String> {
    if !result.needs_restart {
        return Ok(());
    }
    let target = PathBuf::from(&result.target_path);
    let applied_sha256 = sha256_file(&target)?;
    let backup_path =
        (!result.backup_path.trim().is_empty()).then(|| PathBuf::from(&result.backup_path));
    let backup_sha256 = backup_path
        .as_ref()
        .map(|path| sha256_file(path))
        .transpose()?;
    update_integration_state(config_dir, id, |state| {
        state.last_configured_at = Some(timestamp_millis());
        state.last_reported_at = None;
        state.revision = state.revision.saturating_add(1);
        state.needs_restart = true;
        state.config_restore = Some(IntegrationRestorePoint {
            target_path: target.to_string_lossy().to_string(),
            backup_path: backup_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            backup_sha256,
            applied_sha256,
            target_created: backup_path.is_none(),
        });
        clear_test_state(state);
        Ok(())
    })?;
    Ok(())
}

pub fn record_instruction_change(config_dir: &Path, id: &str, changed: bool) -> Result<(), String> {
    if !changed {
        return Ok(());
    }
    update_integration_state(config_dir, id, |state| {
        state.needs_restart = true;
        state.revision = state.revision.saturating_add(1);
        state.last_reported_at = None;
        clear_test_state(state);
        Ok(())
    })?;
    Ok(())
}

#[cfg(test)]
fn record_test_result(
    config_dir: &Path,
    id: &str,
    result: &Result<Value, String>,
) -> Result<(), String> {
    update_integration_state(config_dir, id, |state| {
        state.last_tested_at = Some(timestamp_millis());
        match result {
            Ok(_) => {
                state.last_test_ok = Some(true);
                state.last_test_error.clear();
            }
            Err(error) => {
                state.last_test_ok = Some(false);
                state.last_test_error = bounded_error(error);
            }
        }
        Ok(())
    })?;
    Ok(())
}

pub fn integration_revision(config_dir: &Path, id: &str) -> Result<u64, String> {
    Ok(load_integration_state(config_dir)?
        .tools
        .get(id)
        .map(|state| state.revision)
        .unwrap_or(0))
}

pub fn record_test_result_if_revision(
    config_dir: &Path,
    id: &str,
    expected_revision: u64,
    result: &Result<Value, String>,
) -> Result<bool, String> {
    let mut state_file = load_integration_state(config_dir)?;
    let state = state_file.tools.entry(id.to_string()).or_default();
    if state.revision != expected_revision {
        return Ok(false);
    }
    state.last_tested_at = Some(timestamp_millis());
    match result {
        Ok(_) => {
            state.last_test_ok = Some(true);
            state.last_test_error.clear();
        }
        Err(error) => {
            state.last_test_ok = Some(false);
            state.last_test_error = bounded_error(error);
        }
    }
    save_integration_state(config_dir, &state_file)?;
    Ok(true)
}

pub fn record_source_report(
    config_dir: &Path,
    source: &str,
    message: &str,
) -> Result<bool, String> {
    let env = match IntegrationEnv::current() {
        Some(env) => env,
        None => return Ok(false),
    };
    record_source_report_with_env(&env, config_dir, source, message)
}

fn record_source_report_with_env(
    env: &IntegrationEnv,
    config_dir: &Path,
    source: &str,
    message: &str,
) -> Result<bool, String> {
    let source = source.trim();
    if source.is_empty() || message.starts_with("[Spine Companion self-test]") {
        return Ok(false);
    }
    let source_id = crate::source_registry::canonical_source_id(source);
    let Some(definition) = definitions(env).into_iter().find(|definition| {
        if definition.source.eq_ignore_ascii_case(source) {
            return true;
        }
        match (definition.id, source_id) {
            ("roo-cline", Some("roo" | "cline")) => true,
            ("gemini-antigravity", Some("gemini" | "antigravity")) => true,
            ("claude-desktop", Some("claude")) => true,
            ("kimi-code", Some("kimi")) => true,
            (_, Some(id)) => crate::source_registry::canonical_source_id(definition.source)
                .is_some_and(|definition_id| definition_id == id),
            _ => false,
        }
    }) else {
        return Ok(false);
    };
    let mut state_file = load_integration_state(config_dir)?;
    let state = state_file
        .tools
        .entry(definition.id.to_string())
        .or_default();
    if state.last_reported_at.is_some() {
        return Ok(false);
    }
    state.last_reported_at = Some(timestamp_millis());
    save_integration_state(config_dir, &state_file)?;
    Ok(true)
}

pub fn acknowledge_restart(config_dir: &Path, id: &str) -> Result<(), String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    find_definition(&env, id)?;
    update_integration_state(config_dir, id, |state| {
        state.needs_restart = false;
        Ok(())
    })?;
    Ok(())
}

fn read_verified_restore_backup(
    target: &Path,
    restore: &IntegrationRestorePoint,
) -> Result<Vec<u8>, String> {
    let backup = restore
        .backup_path
        .as_ref()
        .ok_or_else(|| "This setup created a new config and has no original backup.".to_string())?;
    let backup = PathBuf::from(backup);
    if !is_safe_sibling_backup(target, &backup) {
        return Err("The recorded integration backup path is invalid.".to_string());
    }
    let metadata = std::fs::symlink_metadata(&backup).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("The recorded integration backup is not a regular file.".to_string());
    }
    let target_parent = target
        .parent()
        .ok_or_else(|| "Integration target has no parent directory.".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let backup_parent = backup
        .parent()
        .ok_or_else(|| "Integration backup has no parent directory.".to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if target_parent != backup_parent {
        return Err("The recorded integration backup is outside the config directory.".to_string());
    }
    let expected = restore
        .backup_sha256
        .as_deref()
        .ok_or_else(|| "The recorded integration backup has no verification hash.".to_string())?;
    let bytes = std::fs::read(&backup).map_err(|error| error.to_string())?;
    if sha256_bytes(&bytes) != expected {
        return Err("The integration backup has changed since it was created.".to_string());
    }
    Ok(bytes)
}

pub fn restore_ai_integration(
    config_dir: &Path,
    id: &str,
) -> Result<IntegrationRestoreResult, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    restore_ai_integration_with_env(&env, config_dir, id)
}

fn restore_ai_integration_with_env(
    env: &IntegrationEnv,
    config_dir: &Path,
    id: &str,
) -> Result<IntegrationRestoreResult, String> {
    reconcile_pending_integrations_with_env(env, config_dir)?;
    let def = find_definition(&env, id)?;
    if def.format == IntegrationFormat::TemplateOnly {
        return Err("Custom integrations do not have a managed backup.".to_string());
    }
    let target =
        selected_config_path(&def).ok_or_else(|| "No config path available".to_string())?;
    let state_file = load_integration_state(config_dir)?;
    let runtime = state_file
        .tools
        .get(id)
        .ok_or_else(|| "No saved integration setup is available to restore.".to_string())?;
    let restore = runtime
        .config_restore
        .clone()
        .ok_or_else(|| "No saved integration setup is available to restore.".to_string())?;
    if PathBuf::from(&restore.target_path) != target {
        return Err("The saved integration target no longer matches this tool.".to_string());
    }
    let current_bytes = std::fs::read(&target).map_err(|error| error.to_string())?;
    let current_hash = sha256_bytes(&current_bytes);
    if current_hash != restore.applied_sha256 {
        return Err(
            "The integration config changed after setup. Restore was stopped to protect those edits."
                .to_string(),
        );
    }

    let safety_backup = PathBuf::from(backup_path(&target));
    write_backup_text(
        &safety_backup,
        std::str::from_utf8(&current_bytes).map_err(|error| error.to_string())?,
    )?;
    let (restored_bytes, final_restore, after_sha256) = if restore.target_created {
        (None, None, None)
    } else {
        let original = read_verified_restore_backup(&target, &restore)?;
        let restored_hash = sha256_bytes(&original);
        let next_restore = IntegrationRestorePoint {
            target_path: target.to_string_lossy().to_string(),
            backup_path: Some(safety_backup.to_string_lossy().to_string()),
            backup_sha256: Some(current_hash.clone()),
            applied_sha256: restored_hash.clone(),
            target_created: false,
        };
        (Some(original), Some(next_restore), Some(restored_hash))
    };
    let operation = PendingIntegrationOperation {
        transaction_id: format!("restore-{}-{}", timestamp_nanos(), std::process::id()),
        tool_id: id.to_string(),
        kind: "restore".to_string(),
        target_path: target.to_string_lossy().to_string(),
        before_sha256: Some(current_hash.clone()),
        after_sha256,
        final_restore,
        last_configured_at: None,
        safety_backup_path: safety_backup.to_string_lossy().to_string(),
        restored_from: restore.backup_path.clone().unwrap_or_default(),
    };
    write_pending_operation(config_dir, &operation)?;
    if current_sha256(&target)? != Some(current_hash) {
        let _ = remove_pending_operation(config_dir, id);
        let _ = std::fs::remove_file(&safety_backup);
        return Err(
            "The integration config changed while restore was being prepared. No changes were made."
                .to_string(),
        );
    }
    let applied = if let Some(bytes) = restored_bytes {
        let text = String::from_utf8(bytes).map_err(|error| error.to_string())?;
        atomic_write_text(&target, &text)
    } else {
        std::fs::remove_file(&target).map_err(|error| error.to_string())
    };
    if let Err(error) = applied {
        let _ = remove_pending_operation(config_dir, id);
        let _ = std::fs::remove_file(&safety_backup);
        return Err(error);
    }
    commit_pending_operation(config_dir, &operation).map_err(|error| {
        format!(
            "Configuration was restored, but recovery metadata is pending reconciliation: {error}"
        )
    })?;
    remove_pending_operation(config_dir, id)?;

    let state_file = load_integration_state(config_dir)?;
    let mut integration = integration_from_def(&env, &def);
    if let Some(runtime) = state_file.tools.get(id) {
        apply_runtime_state(&mut integration, runtime);
    }
    Ok(IntegrationRestoreResult {
        integration,
        target_path: target.to_string_lossy().to_string(),
        restored_from: operation.restored_from,
        safety_backup_path: safety_backup.to_string_lossy().to_string(),
        needs_restart: true,
    })
}

pub fn install_agent_instructions(id: &str) -> Result<AgentInstructionInstallResult, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    install_agent_instructions_with_env(&env, id)
}

fn install_agent_instructions_with_env(
    env: &IntegrationEnv,
    id: &str,
) -> Result<AgentInstructionInstallResult, String> {
    let def = find_definition(env, id)?;
    if def.format == IntegrationFormat::TemplateOnly {
        return Err("Custom integrations are template-only.".to_string());
    }
    let target = instructions_path_for_def(env, &def)
        .ok_or_else(|| "No instruction target is defined for this tool".to_string())?;
    let existed = target.exists();
    let current = if existed {
        std::fs::read_to_string(&target).map_err(|error| error.to_string())?
    } else {
        String::new()
    };
    let next = upsert_managed_instruction_block(&current, &managed_instruction_block(&def));

    if next == current {
        return Ok(AgentInstructionInstallResult {
            integration: integration_from_def(env, &def),
            target_path: target.to_string_lossy().to_string(),
            backup_path: String::new(),
            created: false,
            updated: false,
        });
    }

    let parent = target
        .parent()
        .ok_or_else(|| format!("Instruction path has no parent: {}", target.display()))?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let backup = if existed {
        let path = instruction_backup_path(&target);
        write_backup_text(&path, &current)?;
        Some(path)
    } else {
        None
    };
    atomic_write_text(&target, &next)?;

    Ok(AgentInstructionInstallResult {
        integration: integration_from_def(env, &def),
        target_path: target.to_string_lossy().to_string(),
        backup_path: backup
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        created: !existed,
        updated: existed,
    })
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
    format!(
        "{}.bak-{}-{}",
        path.to_string_lossy(),
        timestamp_nanos(),
        std::process::id()
    )
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
    let integration = integration_from_def(&env, &def);
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
    let current = read_text_if_exists(&target)?;
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

pub fn configure_ai_integration_managed(
    config_dir: &Path,
    id: &str,
    exe_path: &Path,
    api: &str,
) -> Result<IntegrationApplyResult, String> {
    let env =
        IntegrationEnv::current().ok_or_else(|| "Cannot locate user home directory".to_string())?;
    configure_ai_integration_managed_with_env(&env, config_dir, id, exe_path, api)
}

fn configure_ai_integration_managed_with_env(
    env: &IntegrationEnv,
    config_dir: &Path,
    id: &str,
    exe_path: &Path,
    api: &str,
) -> Result<IntegrationApplyResult, String> {
    reconcile_pending_integrations_with_env(env, config_dir)?;
    let def = find_definition(&env, id)?;
    if def.format == IntegrationFormat::TemplateOnly {
        return Err("Custom integrations are template-only.".to_string());
    }
    let target =
        selected_config_path(&def).ok_or_else(|| "No config path available".to_string())?;
    let target_existed = target.exists();
    let current = read_text_if_exists(&target)?;
    let next = format!(
        "{}\n",
        render_config_text(&def, &current, exe_path, api)?.trim_end()
    );
    let integration = integration_from_def(&env, &def);
    if next == current {
        return Ok(IntegrationApplyResult {
            integration,
            target_path: target.to_string_lossy().to_string(),
            backup_path: String::new(),
            configured: true,
            needs_restart: false,
        });
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let backup = if target_existed {
        let path = PathBuf::from(backup_path(&target));
        write_backup_text(&path, &current)?;
        Some(path)
    } else {
        None
    };
    let restore = IntegrationRestorePoint {
        target_path: target.to_string_lossy().to_string(),
        backup_path: backup
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        backup_sha256: backup.as_ref().map(|path| sha256_file(path)).transpose()?,
        applied_sha256: sha256_bytes(next.as_bytes()),
        target_created: !target_existed,
    };
    let operation = PendingIntegrationOperation {
        transaction_id: format!("configure-{}-{}", timestamp_nanos(), std::process::id()),
        tool_id: id.to_string(),
        kind: "configure".to_string(),
        target_path: target.to_string_lossy().to_string(),
        before_sha256: target_existed.then(|| sha256_bytes(current.as_bytes())),
        after_sha256: Some(restore.applied_sha256.clone()),
        final_restore: Some(restore),
        last_configured_at: Some(timestamp_millis()),
        safety_backup_path: String::new(),
        restored_from: backup
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
    };
    write_pending_operation(config_dir, &operation)?;
    if current_sha256(&target)? != operation.before_sha256 {
        let _ = remove_pending_operation(config_dir, id);
        return Err(
            "The integration config changed while setup was being prepared. No changes were made."
                .to_string(),
        );
    }
    if let Err(error) = atomic_write_text(&target, &next) {
        let _ = remove_pending_operation(config_dir, id);
        return Err(error);
    }
    commit_pending_operation(config_dir, &operation).map_err(|error| {
        format!(
            "Configuration was updated, but recovery metadata is pending reconciliation: {error}"
        )
    })?;
    remove_pending_operation(config_dir, id)?;
    Ok(IntegrationApplyResult {
        integration,
        target_path: target.to_string_lossy().to_string(),
        backup_path: operation.restored_from,
        configured: true,
        needs_restart: true,
    })
}

#[cfg(test)]
fn configure_ai_integration_with_env(
    env: &IntegrationEnv,
    id: &str,
    exe_path: &Path,
    api: &str,
) -> Result<IntegrationApplyResult, String> {
    let def = find_definition(&env, id)?;
    if def.format == IntegrationFormat::TemplateOnly {
        return Err("Custom integrations are template-only.".to_string());
    }
    let target =
        selected_config_path(&def).ok_or_else(|| "No config path available".to_string())?;
    let current = read_text_if_exists(&target)?;
    let next = format!(
        "{}\n",
        render_config_text(&def, &current, exe_path, api)?.trim_end()
    );
    let integration = integration_from_def(&env, &def);
    if next == current {
        return Ok(IntegrationApplyResult {
            integration,
            target_path: target.to_string_lossy().to_string(),
            backup_path: String::new(),
            configured: true,
            needs_restart: false,
        });
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let backup = if target.exists() {
        let path = PathBuf::from(backup_path(&target));
        write_backup_text(&path, &current)?;
        path.to_string_lossy().to_string()
    } else {
        String::new()
    };
    atomic_write_text(&target, &next)?;
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

pub fn templates_for_custom_input(
    exe_path: &Path,
    api: &str,
    input: CustomIntegrationInput,
) -> String {
    let label = input
        .source_label
        .or(input.tool_name.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "AI".to_string());
    let source = input
        .source
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            let base = input.tool_name.unwrap_or_else(|| label.clone());
            let slug = slug(&base);
            if slug.is_empty() {
                "ai-mcp".to_string()
            } else if slug.ends_with("-mcp") {
                slug
            } else {
                format!("{slug}-mcp")
            }
        });
    template_bundle(exe_path, api, source.trim(), label.trim())
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
            kimi_share_dir: root.join("home").join(".kimi"),
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
    fn records_only_the_first_real_report_after_setup() {
        let root = temp_root("first-report");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");

        assert!(!record_source_report_with_env(
            &env,
            &config_dir,
            "codex-mcp",
            "[Spine Companion self-test] Codex"
        )
        .unwrap());
        assert!(
            record_source_report_with_env(&env, &config_dir, "open-code-mcp", "Alias report")
                .unwrap()
        );
        assert!(
            load_integration_state(&config_dir).unwrap().tools["opencode"]
                .last_reported_at
                .is_some()
        );
        assert!(record_source_report_with_env(
            &env,
            &config_dir,
            "codex-mcp",
            "Reviewing the patch"
        )
        .unwrap());
        let first = load_integration_state(&config_dir).unwrap().tools["codex"]
            .last_reported_at
            .unwrap();
        assert!(
            !record_source_report_with_env(&env, &config_dir, "codex-mcp", "Running tests")
                .unwrap()
        );
        assert_eq!(
            load_integration_state(&config_dir).unwrap().tools["codex"].last_reported_at,
            Some(first)
        );

        record_instruction_change(&config_dir, "codex", true).unwrap();
        assert_eq!(
            load_integration_state(&config_dir).unwrap().tools["codex"].last_reported_at,
            None
        );
        assert!(!record_source_report_with_env(
            &env,
            &config_dir,
            "unknown-source",
            "Should be ignored"
        )
        .unwrap());
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
    fn kimi_uses_official_mcp_path_and_source_metadata() {
        let root = temp_root("kimi");
        let env = fixture_env(&root);
        fs::create_dir_all(&env.kimi_share_dir).unwrap();
        let def = definitions(&env)
            .into_iter()
            .find(|item| item.id == "kimi-code")
            .unwrap();
        assert_eq!(
            selected_config_path(&def),
            Some(env.kimi_share_dir.join("mcp.json"))
        );

        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");
        let rendered = render_config_text(&def, "{}", &exe, "http://127.0.0.1:17388").unwrap();
        let value: Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(
            value["mcpServers"]["spine_companion"]["env"]["COMPANION_SOURCE"],
            "kimi-mcp"
        );
        assert_eq!(
            value["mcpServers"]["spine_companion"]["env"]["COMPANION_SOURCE_LABEL"],
            "Kimi"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn kimi_instructions_are_copy_only_for_project_agents_md() {
        let root = temp_root("kimi-instructions");
        let env = fixture_env(&root);
        let result = generate_agent_instructions_with_env(&env, "kimi-code").unwrap();
        assert!(result.target_path.is_empty());
        assert!(!result.exists);
        assert!(result.body.contains("kimi-mcp"));
        assert!(install_agent_instructions_with_env(&env, "kimi-code").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn configure_is_idempotent_and_preserves_the_original_backup() {
        let root = temp_root("configure-idempotent");
        let env = fixture_env(&root);
        let target = env.home.join(".codex").join("config.toml");
        let original = "model = \"gpt-test\"\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, original).unwrap();
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");

        let first =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();
        let installed = fs::read_to_string(&target).unwrap();
        let second =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();

        assert!(first.needs_restart);
        assert_eq!(fs::read_to_string(&first.backup_path).unwrap(), original);
        assert!(!second.needs_restart);
        assert!(second.backup_path.is_empty());
        assert_eq!(fs::read_to_string(&target).unwrap(), installed);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn configure_new_file_does_not_create_an_empty_backup() {
        let root = temp_root("configure-new");
        let env = fixture_env(&root);
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");

        let result =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();

        assert!(result.needs_restart);
        assert!(result.backup_path.is_empty());
        assert!(Path::new(&result.target_path).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn managed_configure_commits_state_and_removes_its_journal() {
        let root = temp_root("managed-configure");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "model = \"gpt-test\"\n").unwrap();
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");

        let result = configure_ai_integration_managed_with_env(
            &env,
            &config_dir,
            "codex",
            &exe,
            "http://127.0.0.1:17388",
        )
        .unwrap();

        assert!(result.needs_restart);
        assert!(!pending_integration_path(&config_dir, "codex").exists());
        let state = load_integration_state(&config_dir).unwrap();
        let codex = state.tools.get("codex").unwrap();
        assert!(codex.config_restore.is_some());
        assert!(!codex.last_transaction_id.is_empty());
        assert_eq!(codex.revision, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reconciliation_finalizes_a_config_written_before_state_commit() {
        let root = temp_root("reconcile-config");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        let original = "model = \"gpt-test\"\n";
        let configured =
            "model = \"gpt-test\"\n\n[mcp_servers.spine_companion]\ncommand = \"companion.exe\"\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, configured).unwrap();
        let backup = PathBuf::from(backup_path(&target));
        fs::write(&backup, original).unwrap();
        let operation = PendingIntegrationOperation {
            transaction_id: "tx-reconcile".to_string(),
            tool_id: "codex".to_string(),
            kind: "configure".to_string(),
            target_path: target.to_string_lossy().to_string(),
            before_sha256: Some(sha256_bytes(original.as_bytes())),
            after_sha256: Some(sha256_bytes(configured.as_bytes())),
            final_restore: Some(IntegrationRestorePoint {
                target_path: target.to_string_lossy().to_string(),
                backup_path: Some(backup.to_string_lossy().to_string()),
                backup_sha256: Some(sha256_bytes(original.as_bytes())),
                applied_sha256: sha256_bytes(configured.as_bytes()),
                target_created: false,
            }),
            last_configured_at: Some(42),
            safety_backup_path: String::new(),
            restored_from: backup.to_string_lossy().to_string(),
        };
        write_pending_operation(&config_dir, &operation).unwrap();

        reconcile_pending_integrations_with_env(&env, &config_dir).unwrap();

        assert!(!pending_integration_path(&config_dir, "codex").exists());
        let state = load_integration_state(&config_dir).unwrap();
        let codex = state.tools.get("codex").unwrap();
        assert_eq!(codex.last_transaction_id, "tx-reconcile");
        assert_eq!(codex.last_configured_at, Some(42));
        assert!(codex.config_restore.is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reconciliation_finalizes_a_restore_written_before_state_commit() {
        let root = temp_root("reconcile-restore");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        let original = "model = \"gpt-test\"\n";
        let configured =
            "model = \"gpt-test\"\n[mcp_servers.spine_companion]\ncommand = \"companion.exe\"\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, original).unwrap();
        let original_backup = target.with_file_name("config.toml.bak-original");
        let safety_backup = target.with_file_name("config.toml.bak-restore");
        fs::write(&original_backup, original).unwrap();
        fs::write(&safety_backup, configured).unwrap();

        let mut state = IntegrationStateFile::default();
        state.tools.insert(
            "codex".to_string(),
            IntegrationRuntimeState {
                revision: 3,
                config_restore: Some(IntegrationRestorePoint {
                    target_path: target.to_string_lossy().to_string(),
                    backup_path: Some(original_backup.to_string_lossy().to_string()),
                    backup_sha256: Some(sha256_bytes(original.as_bytes())),
                    applied_sha256: sha256_bytes(configured.as_bytes()),
                    target_created: false,
                }),
                ..IntegrationRuntimeState::default()
            },
        );
        save_integration_state(&config_dir, &state).unwrap();

        let operation = PendingIntegrationOperation {
            transaction_id: "tx-restore-reconcile".to_string(),
            tool_id: "codex".to_string(),
            kind: "restore".to_string(),
            target_path: target.to_string_lossy().to_string(),
            before_sha256: Some(sha256_bytes(configured.as_bytes())),
            after_sha256: Some(sha256_bytes(original.as_bytes())),
            final_restore: Some(IntegrationRestorePoint {
                target_path: target.to_string_lossy().to_string(),
                backup_path: Some(safety_backup.to_string_lossy().to_string()),
                backup_sha256: Some(sha256_bytes(configured.as_bytes())),
                applied_sha256: sha256_bytes(original.as_bytes()),
                target_created: false,
            }),
            last_configured_at: None,
            safety_backup_path: safety_backup.to_string_lossy().to_string(),
            restored_from: original_backup.to_string_lossy().to_string(),
        };
        write_pending_operation(&config_dir, &operation).unwrap();

        reconcile_pending_integrations_with_env(&env, &config_dir).unwrap();

        assert!(!pending_integration_path(&config_dir, "codex").exists());
        assert_eq!(fs::read_to_string(&target).unwrap(), original);
        assert_eq!(fs::read_to_string(&safety_backup).unwrap(), configured);
        let state = load_integration_state(&config_dir).unwrap();
        let codex = state.tools.get("codex").unwrap();
        assert_eq!(codex.last_transaction_id, "tx-restore-reconcile");
        assert_eq!(codex.revision, 4);
        assert!(codex.needs_restart);
        let restore = codex.config_restore.as_ref().unwrap();
        assert_eq!(
            restore.backup_path.as_deref(),
            Some(safety_backup.to_string_lossy().as_ref())
        );
        assert_eq!(restore.applied_sha256, sha256_bytes(original.as_bytes()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reconciliation_rejects_unsafe_journal_backup_paths() {
        let root = temp_root("reconcile-unsafe");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        let original = "model = \"gpt-test\"\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, original).unwrap();
        let outside = root.join("must-not-delete.txt");
        fs::write(&outside, "keep").unwrap();
        let operation = PendingIntegrationOperation {
            transaction_id: "tx-unsafe".to_string(),
            tool_id: "codex".to_string(),
            kind: "restore".to_string(),
            target_path: target.to_string_lossy().to_string(),
            before_sha256: Some(sha256_bytes(original.as_bytes())),
            after_sha256: None,
            final_restore: None,
            last_configured_at: None,
            safety_backup_path: outside.to_string_lossy().to_string(),
            restored_from: String::new(),
        };
        write_pending_operation(&config_dir, &operation).unwrap();

        let error = reconcile_pending_integrations_with_env(&env, &config_dir).unwrap_err();

        assert!(error.contains("safety backup path is invalid"));
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_connection_test_cannot_overwrite_a_newer_integration_revision() {
        let root = temp_root("stale-test");
        let config_dir = root.join("companion-config");
        record_instruction_change(&config_dir, "codex", true).unwrap();

        let recorded =
            record_test_result_if_revision(&config_dir, "codex", 0, &Ok(json!({ "ok": true })))
                .unwrap();

        assert!(!recorded);
        let state = load_integration_state(&config_dir).unwrap();
        assert!(state.tools.get("codex").unwrap().last_tested_at.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn integration_runtime_state_persists_restart_and_test_results() {
        let root = temp_root("runtime-state");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "model = \"gpt-test\"\n").unwrap();
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");
        let applied =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();

        record_config_applied(&config_dir, "codex", &applied).unwrap();
        let stored_text = fs::read_to_string(integration_state_path(&config_dir)).unwrap();
        assert!(!stored_text.contains("gpt-test"));
        let state = load_integration_state(&config_dir).unwrap();
        let codex = state.tools.get("codex").unwrap();
        assert!(codex.needs_restart);
        assert!(codex.config_restore.is_some());
        assert!(codex.last_tested_at.is_none());

        record_test_result(&config_dir, "codex", &Ok(json!({ "ok": true }))).unwrap();
        let state = load_integration_state(&config_dir).unwrap();
        let codex = state.tools.get("codex").unwrap();
        assert_eq!(codex.last_test_ok, Some(true));
        assert!(codex.last_tested_at.is_some());
        assert!(codex.needs_restart);

        let long_error = "x".repeat(900);
        record_test_result(&config_dir, "codex", &Err(long_error)).unwrap();
        let state = load_integration_state(&config_dir).unwrap();
        assert_eq!(
            state
                .tools
                .get("codex")
                .unwrap()
                .last_test_error
                .chars()
                .count(),
            600
        );

        record_instruction_change(&config_dir, "codex", true).unwrap();
        let state = load_integration_state(&config_dir).unwrap();
        let codex = state.tools.get("codex").unwrap();
        assert!(codex.last_tested_at.is_none());
        assert_eq!(codex.last_test_ok, None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_reinstates_verified_original_and_keeps_an_undo_backup() {
        let root = temp_root("restore-original");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        let original = "model = \"gpt-test\"\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, original).unwrap();
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");
        let applied =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();
        record_config_applied(&config_dir, "codex", &applied).unwrap();
        let configured = fs::read_to_string(&target).unwrap();

        let restored = restore_ai_integration_with_env(&env, &config_dir, "codex").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), original);
        assert_eq!(
            fs::read_to_string(&restored.safety_backup_path).unwrap(),
            configured
        );
        assert!(restored.integration.restore_available);
        assert!(restored.needs_restart);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_refuses_to_overwrite_external_config_edits() {
        let root = temp_root("restore-edited");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let target = env.home.join(".codex").join("config.toml");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "model = \"gpt-test\"\n").unwrap();
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");
        let applied =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();
        record_config_applied(&config_dir, "codex", &applied).unwrap();
        fs::write(&target, "# user changed this after setup\n").unwrap();

        let error = restore_ai_integration_with_env(&env, &config_dir, "codex").unwrap_err();

        assert!(error.contains("changed after setup"));
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "# user changed this after setup\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_removes_a_newly_created_config_after_hash_verification() {
        let root = temp_root("restore-created");
        let env = fixture_env(&root);
        let config_dir = root.join("companion-config");
        let exe = PathBuf::from("C:/Program Files/Spine Companion/spine-companion.exe");
        let applied =
            configure_ai_integration_with_env(&env, "codex", &exe, "http://127.0.0.1:17388")
                .unwrap();
        let target = PathBuf::from(&applied.target_path);
        let configured = fs::read_to_string(&target).unwrap();
        record_config_applied(&config_dir, "codex", &applied).unwrap();

        let restored = restore_ai_integration_with_env(&env, &config_dir, "codex").unwrap();

        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(&restored.safety_backup_path).unwrap(),
            configured
        );
        assert!(!restored.integration.restore_available);
        let _ = fs::remove_dir_all(root);
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
    fn custom_template_uses_user_source_and_label() {
        let exe = PathBuf::from("C:/Spine/spine-companion.exe");
        let text = templates_for_custom_input(
            &exe,
            "http://127.0.0.1:17388",
            CustomIntegrationInput {
                tool_name: Some("Future Agent".to_string()),
                source: Some("future-agent-mcp".to_string()),
                source_label: Some("Future Agent".to_string()),
            },
        );
        assert!(text.contains("future-agent-mcp"));
        assert!(text.contains("Future Agent"));
    }

    #[test]
    fn agent_instruction_body_names_source() {
        let root = temp_root("instructions");
        let env = fixture_env(&root);
        let def = definitions(&env)
            .into_iter()
            .find(|item| item.id == "mimocode")
            .unwrap();
        let body = instruction_body(&def);
        assert!(body.contains("mimocode-mcp"));
        assert!(body.contains("MiMoCode"));
        assert!(body.contains("companion_report_ai_phase"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installs_instruction_file_for_new_target() {
        let root = temp_root("instruction-new");
        let env = fixture_env(&root);

        let result = install_agent_instructions_with_env(&env, "codex").unwrap();
        let target = PathBuf::from(&result.target_path);

        assert!(result.created);
        assert!(!result.updated);
        assert!(target.exists());
        assert!(result.backup_path.is_empty());
        let installed = fs::read_to_string(target).unwrap();
        assert!(installed.contains(INSTRUCTION_BLOCK_START));
        assert!(installed.contains(INSTRUCTION_BLOCK_END));
        assert!(installed.contains("codex-mcp"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_install_is_idempotent() {
        let root = temp_root("instruction-idempotent");
        let env = fixture_env(&root);

        let first = install_agent_instructions_with_env(&env, "codex").unwrap();
        let first_contents = fs::read_to_string(&first.target_path).unwrap();
        let second = install_agent_instructions_with_env(&env, "codex").unwrap();

        assert!(!second.created);
        assert!(!second.updated);
        assert!(second.backup_path.is_empty());
        assert_eq!(
            fs::read_to_string(&second.target_path).unwrap(),
            first_contents
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_install_preserves_unrelated_content() {
        let root = temp_root("instruction-preserve");
        let env = fixture_env(&root);
        let target = env.home.join(".codex").join("AGENTS.md");
        let unrelated = "# Team instructions\n\nKeep this paragraph exactly.\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, unrelated).unwrap();

        let result = install_agent_instructions_with_env(&env, "codex").unwrap();
        let installed = fs::read_to_string(&target).unwrap();

        assert!(!result.created);
        assert!(result.updated);
        assert!(installed.starts_with(unrelated));
        assert!(installed.contains(INSTRUCTION_BLOCK_START));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_install_updates_prior_managed_block() {
        let root = temp_root("instruction-update");
        let env = fixture_env(&root);
        let target = env.home.join(".codex").join("AGENTS.md");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(
            &target,
            format!(
                "# Existing instructions\n\n{INSTRUCTION_BLOCK_START}\nold managed text\n{INSTRUCTION_BLOCK_END}\n"
            ),
        )
        .unwrap();

        let result = install_agent_instructions_with_env(&env, "codex").unwrap();
        let installed = fs::read_to_string(&target).unwrap();

        assert!(result.updated);
        assert!(installed.contains("# Existing instructions"));
        assert!(!installed.contains("old managed text"));
        assert!(installed.contains("codex-mcp"));
        assert_eq!(installed.matches(INSTRUCTION_BLOCK_START).count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_install_backs_up_existing_content_before_update() {
        let root = temp_root("instruction-backup");
        let env = fixture_env(&root);
        let target = env.home.join(".codex").join("AGENTS.md");
        let original = "# Existing instructions\n";
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, original).unwrap();

        let result = install_agent_instructions_with_env(&env, "codex").unwrap();

        assert!(result.backup_path.contains("AGENTS.md.bak-"));
        assert_eq!(fs::read_to_string(&result.backup_path).unwrap(), original);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn instruction_install_rejects_invalid_and_template_only_tools() {
        let root = temp_root("instruction-rejected");
        let env = fixture_env(&root);

        assert!(install_agent_instructions_with_env(&env, "missing-tool").is_err());
        assert!(install_agent_instructions_with_env(&env, "custom").is_err());
        let _ = fs::remove_dir_all(root);
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
        assert_eq!(claude.instructions_path, "");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn platform_data_directories_follow_host_conventions() {
        let home = PathBuf::from("home");
        let config_home = home.join(".config");
        let (appdata, local_appdata) = platform_data_dirs(&home, &config_home, None);

        if cfg!(target_os = "windows") {
            assert_eq!(appdata, home.join("AppData").join("Roaming"));
            assert_eq!(local_appdata, home.join("AppData").join("Local"));
        } else if cfg!(target_os = "macos") {
            let expected = home.join("Library").join("Application Support");
            assert_eq!(appdata, expected);
            assert_eq!(local_appdata, expected);
        } else {
            assert_eq!(appdata, config_home);
            assert!(local_appdata.ends_with(Path::new(".local").join("share")));
        }
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
