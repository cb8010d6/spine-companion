mod server;
mod state;

use state::{
    create_reminder, create_reminder_store, create_state_store, set_state, CompanionState,
    CreateReminderInput, Reminder, ReminderStore, SetStateInput, StateBroadcast, StateStore,
};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindow,
};

struct AppData {
    store: StateStore,
    tx: StateBroadcast,
    reminders: ReminderStore,
    public_config: Arc<Mutex<serde_json::Value>>,
    ui_settings: Arc<Mutex<UiSettings>>,
    config_dir: PathBuf,
    local_config_path: PathBuf,
    asset_root: server::AssetRootStore,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiSettings {
    hud_visible: bool,
    bubble_visible: bool,
    bubble_shadow: bool,
    bubble_background: String,
    bubble_hold_ms: u64,
    drag_mode: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UiSettingsPatch {
    hud_visible: Option<bool>,
    bubble_visible: Option<bool>,
    bubble_shadow: Option<bool>,
    bubble_background: Option<String>,
    bubble_hold_ms: Option<u64>,
    drag_mode: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScalePayload {
    delta: Option<f64>,
    action: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportModelInput {
    id: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportModelResult {
    id: String,
    name: String,
    asset_dir: String,
    skel: String,
    asset_url: String,
    local_config_path: String,
    requires_restart: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSettingsInput {
    patch: serde_json::Value,
}

fn fallback_config() -> serde_json::Value {
    serde_json::json!({
        "window": { "width": 360, "height": 460, "alwaysOnTop": true, "transparent": true },
        "server": { "host": "127.0.0.1", "port": 17388 },
        "spine": {
            "assetDir": "",
            "skel": "amiya.skel",
            "scale": 0.86,
            "offsetX": 0,
            "offsetY": -18,
            "mixDurationMs": 520,
            "boundsSamples": 10,
            "framePadding": 1.08,
            "maxViewportFill": 0.72,
            "stageBottomInset": 154,
            "fitStates": ["idle", "working", "running", "waiting", "reviewing", "success", "reminder"]
        },
        "ui": {
            "hudVisible": false,
            "bubbleVisible": true,
            "bubbleShadow": true,
            "bubbleBackground": "solid",
            "bubbleHoldMs": 8000,
            "dragMode": "compatible"
        },
        "models": {
            "catalog": [
                {
                    "id": "ark-1001-amiya2-sale-16",
                    "name": "Amiya Guard Skin #16",
                    "source": "Ark-Models",
                    "licenseNote": "Downloaded from isHarryh/Ark-Models for local use only. Do not commit or redistribute the asset files in this repository.",
                    "repositoryUrl": "https://github.com/isHarryh/Ark-Models/tree/main/models/1001_amiya2_sale%2316",
                    "skel": "build_char_1001_amiya2_sale#16.skel",
                    "files": [
                        {
                            "name": "build_char_1001_amiya2_sale#16.atlas",
                            "url": "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.atlas"
                        },
                        {
                            "name": "build_char_1001_amiya2_sale#16.png",
                            "url": "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.png"
                        },
                        {
                            "name": "build_char_1001_amiya2_sale#16.skel",
                            "url": "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.skel"
                        }
                    ]
                }
            ]
        },
        "state": { "initial": "idle", "pollMs": 1000, "sources": [{ "type": "local-http" }] },
        "specialSegments": {
            "review": { "from": 2.6, "to": 4.35, "loop": true },
            "success": { "from": 4.4, "to": 7.2, "loop": false },
            "special": { "from": 0, "to": 14.433, "loop": true }
        }
    })
}

fn merge_json(base: &mut serde_json::Value, patch: serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(base), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(base.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (base, patch) => *base = patch,
    }
}

fn read_json_if_exists(path: &Path) -> Option<serde_json::Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn user_config_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("SPINE_COMPANION_CONFIG_DIR") {
        return Some(PathBuf::from(value));
    }
    #[cfg(target_os = "windows")]
    if let Ok(value) = std::env::var("APPDATA") {
        return Some(PathBuf::from(value).join("spine-companion"));
    }
    #[cfg(target_os = "macos")]
    if let Ok(value) = std::env::var("HOME") {
        return Some(PathBuf::from(value).join("Library/Application Support/spine-companion"));
    }
    if let Ok(value) = std::env::var("XDG_CONFIG_HOME") {
        return Some(PathBuf::from(value).join("spine-companion"));
    }
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(".config/spine-companion"))
}

fn local_config_candidates(root: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![root.join("companion.local.json")];
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("companion.local.json"));
    }
    if let Some(dir) = user_config_dir() {
        candidates.push(dir.join("companion.local.json"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("companion.local.json"));
        }
    }
    candidates
}

fn string_at<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn number_at(value: &serde_json::Value, path: &[&str], fallback: u16) -> u16 {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_u64().map(|n| n as u16).unwrap_or(fallback)
}

fn bool_at(value: &serde_json::Value, path: &[&str], fallback: bool) -> bool {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_bool().unwrap_or(fallback)
}

fn u64_at(value: &serde_json::Value, path: &[&str], fallback: u64) -> u64 {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_u64().unwrap_or(fallback)
}

fn resolve_asset_dir(root: &Path, value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path.to_string_lossy().to_string()
    } else {
        root.join(path).to_string_lossy().to_string()
    }
}

fn ui_settings_from_config(config: &serde_json::Value) -> UiSettings {
    let background = string_at(config, &["ui", "bubbleBackground"])
        .unwrap_or("solid")
        .to_string();
    let drag_mode = string_at(config, &["ui", "dragMode"])
        .unwrap_or("compatible")
        .to_string();
    UiSettings {
        hud_visible: bool_at(config, &["ui", "hudVisible"], false),
        bubble_visible: bool_at(config, &["ui", "bubbleVisible"], true),
        bubble_shadow: bool_at(config, &["ui", "bubbleShadow"], true),
        bubble_background: normalize_bubble_background(&background),
        bubble_hold_ms: u64_at(config, &["ui", "bubbleHoldMs"], 8000),
        drag_mode: normalize_drag_mode(&drag_mode),
    }
}

fn normalize_bubble_background(value: &str) -> String {
    match value {
        "soft" | "clear" | "light" => value.to_string(),
        _ => "solid".to_string(),
    }
}

fn normalize_drag_mode(value: &str) -> String {
    if value == "smooth" {
        "smooth".to_string()
    } else {
        "compatible".to_string()
    }
}

fn apply_ui_patch(settings: &mut UiSettings, patch: UiSettingsPatch) {
    if let Some(value) = patch.hud_visible {
        settings.hud_visible = value;
    }
    if let Some(value) = patch.bubble_visible {
        settings.bubble_visible = value;
    }
    if let Some(value) = patch.bubble_shadow {
        settings.bubble_shadow = value;
    }
    if let Some(value) = patch.bubble_background {
        settings.bubble_background = normalize_bubble_background(&value);
    }
    if let Some(value) = patch.bubble_hold_ms {
        settings.bubble_hold_ms = value.clamp(1500, 60000);
    }
    if let Some(value) = patch.drag_mode {
        settings.drag_mode = normalize_drag_mode(&value);
    }
}

fn current_ui_settings(data: &AppData) -> UiSettings {
    data.ui_settings
        .lock()
        .map(|settings| settings.clone())
        .unwrap_or_else(|_| {
            data.public_config
                .lock()
                .map(|config| ui_settings_from_config(&config))
                .unwrap_or_else(|_| ui_settings_from_config(&fallback_config()))
        })
}

fn public_config_with_ui(data: &AppData) -> serde_json::Value {
    let mut public = data
        .public_config
        .lock()
        .map(|config| config.clone())
        .unwrap_or_else(|_| fallback_config());
    if let Ok(value) = serde_json::to_value(current_ui_settings(data)) {
        public["ui"] = value;
    }
    public
}

fn update_ui_settings(app: &AppHandle, patch: UiSettingsPatch) -> Option<UiSettings> {
    let data = app.state::<AppData>();
    let next = {
        let Ok(mut settings) = data.ui_settings.lock() else {
            return None;
        };
        apply_ui_patch(&mut settings, patch);
        settings.clone()
    };
    let _ = app.emit("companion:ui", next.clone());
    Some(next)
}

fn open_external(target: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(target).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(target).spawn()?;
    }
    Ok(())
}

#[derive(Clone)]
struct RuntimeConfig {
    public: serde_json::Value,
    host: String,
    port: u16,
    initial_state: String,
    asset_root: Option<PathBuf>,
    ui_settings: UiSettings,
    config_dir: PathBuf,
    local_config_path: PathBuf,
}

fn load_runtime_config() -> RuntimeConfig {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let mut config = fallback_config();
    if let Some(committed) = read_json_if_exists(&root.join("companion.config.json")) {
        merge_json(&mut config, committed);
    }
    let mut resolved_local_config_path = String::new();
    let mut asset_base_dir = root.clone();
    for candidate in local_config_candidates(&root) {
        if let Some(local) = read_json_if_exists(&candidate) {
            merge_json(&mut config, local);
            resolved_local_config_path = candidate.to_string_lossy().to_string();
            if let Some(parent) = candidate.parent() {
                asset_base_dir = parent.to_path_buf();
            }
        }
    }
    if let Ok(asset_dir) = std::env::var("SPINE_ASSET_DIR") {
        config["spine"]["assetDir"] = serde_json::Value::String(asset_dir);
    }
    if let Ok(skel) = std::env::var("SPINE_SKEL") {
        config["spine"]["skel"] = serde_json::Value::String(skel);
    }
    if let Ok(port) = std::env::var("COMPANION_PORT") {
        if let Ok(port) = port.parse::<u16>() {
            config["server"]["port"] = serde_json::Value::Number(port.into());
        }
    }

    let host = string_at(&config, &["server", "host"])
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = number_at(&config, &["server", "port"], 17388);
    let origin = format!("http://{}:{}", host, port);
    let raw_asset_dir = string_at(&config, &["spine", "assetDir"]).unwrap_or("");
    let asset_dir = resolve_asset_dir(&asset_base_dir, raw_asset_dir);
    config["spine"]["assetDir"] = serde_json::Value::String(asset_dir.clone());
    let skel = string_at(&config, &["spine", "skel"]).unwrap_or("amiya.skel");
    let default_local_config_path = local_config_candidates(&root)
        .first()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            root.join("companion.local.json")
                .to_string_lossy()
                .to_string()
        });
    let config_dir_path = user_config_dir().unwrap_or_else(|| root.clone());
    let local_config_path = if resolved_local_config_path.is_empty() {
        PathBuf::from(&default_local_config_path)
    } else {
        PathBuf::from(&resolved_local_config_path)
    };
    let config_dir = config_dir_path.to_string_lossy().to_string();
    let ui_settings = ui_settings_from_config(&config);

    let public = serde_json::json!({
        "window": config["window"].clone(),
        "server": {
            "origin": origin,
            "stateUrl": format!("{}/state", origin),
            "eventsUrl": format!("{}/events", origin),
            "websocketUrl": format!("ws://{}:{}/ws", host, port)
        },
        "spine": {
            "skel": skel,
            "assetUrl": format!("{}/assets/spine/{}", origin, skel),
            "assetDirConfigured": !asset_dir.is_empty(),
            "scale": config["spine"]["scale"].clone(),
            "offsetX": config["spine"]["offsetX"].clone(),
            "offsetY": config["spine"]["offsetY"].clone(),
            "mixDurationMs": config["spine"]["mixDurationMs"].clone(),
            "boundsSamples": config["spine"]["boundsSamples"].clone(),
            "framePadding": config["spine"]["framePadding"].clone(),
            "maxViewportFill": config["spine"]["maxViewportFill"].clone(),
            "stageBottomInset": config["spine"]["stageBottomInset"].clone(),
            "fitStates": config["spine"]["fitStates"].clone()
        },
        "ui": config["ui"].clone(),
        "models": config["models"].clone(),
        "paths": {
            "configDir": config_dir,
            "localConfigPath": local_config_path.to_string_lossy().to_string(),
            "hasLocalConfig": !resolved_local_config_path.is_empty()
        },
        "state": config["state"].clone(),
        "specialSegments": config["specialSegments"].clone()
    });

    RuntimeConfig {
        public,
        host,
        port,
        initial_state: string_at(&config, &["state", "initial"])
            .unwrap_or("idle")
            .to_string(),
        asset_root: if asset_dir.is_empty() {
            None
        } else {
            Some(PathBuf::from(asset_dir))
        },
        ui_settings,
        config_dir: config_dir_path,
        local_config_path,
    }
}

#[tauri::command]
async fn get_config(data: State<'_, AppData>) -> Result<serde_json::Value, String> {
    Ok(public_config_with_ui(&data))
}

#[tauri::command]
async fn get_state(data: State<'_, AppData>) -> Result<CompanionState, String> {
    Ok(data.store.read().await.clone())
}

#[tauri::command]
async fn set_companion_state(
    data: State<'_, AppData>,
    input: SetStateInput,
) -> Result<CompanionState, String> {
    Ok(set_state(&data.store, &data.tx, input).await)
}

#[tauri::command]
async fn create_reminder_cmd(
    data: State<'_, AppData>,
    input: CreateReminderInput,
) -> Result<Reminder, String> {
    Ok(create_reminder(&data.store, &data.tx, &data.reminders, input).await)
}

#[tauri::command]
async fn set_ui_settings(
    window: WebviewWindow,
    data: State<'_, AppData>,
    input: UiSettingsPatch,
) -> Result<UiSettings, String> {
    let next = {
        let mut settings = data
            .ui_settings
            .lock()
            .map_err(|_| "UI settings lock is poisoned".to_string())?;
        apply_ui_patch(&mut settings, input);
        settings.clone()
    };
    window
        .app_handle()
        .emit("companion:ui", next.clone())
        .map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
async fn emit_scale_event(window: WebviewWindow, input: ScalePayload) -> Result<(), String> {
    window
        .emit("companion:scale", input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn import_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    input: ImportModelInput,
) -> Result<ImportModelResult, String> {
    let public_config = data
        .public_config
        .lock()
        .map(|config| config.clone())
        .map_err(|_| "Config lock is poisoned".to_string())?;
    let model = model_by_id(&public_config, &input.id)
        .ok_or_else(|| format!("Unknown model id: {}", input.id))?;
    let name = model
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or(&input.id)
        .to_string();
    let skel = model
        .get("skel")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Model catalog entry is missing skel".to_string())?
        .to_string();
    let files = model
        .get("files")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Model catalog entry is missing files".to_string())?;
    let model_dir = data.config_dir.join("models").join(&input.id);
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|error| error.to_string())?;
    let client = reqwest::Client::new();

    let total_files = files.len();
    for (i, file) in files.iter().enumerate() {
        let file_name = file
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Model file is missing name".to_string())?;
        let url = file
            .get("url")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Model file is missing url".to_string())?;

        let _ = app.emit("companion:download-progress", serde_json::json!({
            "id": input.id,
            "file": file_name,
            "current": i + 1,
            "total": total_files,
            "status": "downloading"
        }));

        let bytes = client
            .get(url)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .bytes()
            .await
            .map_err(|error| error.to_string())?;
        tokio::fs::write(model_dir.join(file_name), bytes)
            .await
            .map_err(|error| error.to_string())?;
    }

    write_local_model_config(&data.local_config_path, &model_dir, &skel)?;
    let canonical_model_dir = model_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if let Ok(mut public) = data.public_config.lock() {
        merge_json(
            &mut public,
            serde_json::json!({
                "spine": {
                    "assetDir": canonical_model_dir.to_string_lossy().to_string(),
                    "assetDirConfigured": true,
                    "skel": skel
                }
            }),
        );
    }
    {
        let mut asset_root = data.asset_root.write().await;
        *asset_root = Some(canonical_model_dir.clone());
    }
    let public = public_config_with_ui(&data);
    let origin = public
        .get("server")
        .and_then(|server| server.get("origin"))
        .and_then(|origin| origin.as_str())
        .unwrap_or("http://127.0.0.1:17388");

    let result = ImportModelResult {
        id: input.id,
        name,
        asset_dir: canonical_model_dir.to_string_lossy().to_string(),
        skel: skel.clone(),
        asset_url: format!("{}/assets/spine/{}", origin, url_encode_path_segment(&skel)),
        local_config_path: data.local_config_path.to_string_lossy().to_string(),
        requires_restart: false,
    };

    let _ = app.emit("companion:model-imported", result.clone());

    Ok(result)
}

#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    input: SaveSettingsInput,
) -> Result<(), String> {
    let path = &data.local_config_path;
    let patch = input.patch;
    let mut config = read_json_if_exists(path).unwrap_or_else(|| serde_json::json!({}));
    merge_json(&mut config, patch.clone());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{}\n", text)).map_err(|error| error.to_string())?;
    if let Ok(mut public) = data.public_config.lock() {
        merge_json(&mut public, patch.clone());
    }
    if let Some(ui_patch) = patch.get("ui").cloned() {
        if let Ok(patch) = serde_json::from_value::<UiSettingsPatch>(ui_patch) {
            let _ = update_ui_settings(&app, patch);
        }
    }
    let _ = app.emit("companion:config-changed", public_config_with_ui(&data));
    Ok(())
}

#[tauri::command]
async fn get_diagnostics(data: State<'_, AppData>) -> Result<serde_json::Value, String> {
    let public = public_config_with_ui(&data);
    let origin = public.get("server").and_then(|s| s.get("origin")).and_then(|o| o.as_str()).unwrap_or("http://127.0.0.1:17388");

    let state_ok = reqwest::get(&format!("{}/state", origin)).await.is_ok();

    let local_config_exists = data.local_config_path.exists();

    let mut asset_dir_exists = false;
    let mut has_skel = false;
    let mut has_atlas = false;
    let mut has_png = false;

    if let Some(asset_root) = &*data.asset_root.read().await {
        asset_dir_exists = asset_root.exists();
        if let Ok(mut entries) = tokio::fs::read_dir(asset_root).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if ext == "skel" { has_skel = true; }
                    if ext == "atlas" { has_atlas = true; }
                    if ext == "png" { has_png = true; }
                }
            }
        }
    }

    let mut mcp_matches = Vec::new();
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    if !home.is_empty() {
        let home_path = std::path::Path::new(&home);
        let mut mcp_paths = vec![
            ("Codex", home_path.join(".codex").join("config.toml")),
            ("Gemini / Antigravity", home_path.join(".gemini").join("antigravity").join("mcp_config.json")),
        ];
        #[cfg(target_os = "windows")]
        {
            let roaming = std::env::var("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| home_path.join("AppData").join("Roaming"));
            mcp_paths.push(("Claude", roaming.join("Claude").join("claude_desktop_config.json")));
            mcp_paths.push(("Roo / Cline", roaming.join("Code").join("User").join("globalStorage").join("rooveterinaryinc.roo-cline").join("settings").join("cline_mcp_settings.json")));
        }
        #[cfg(target_os = "macos")]
        {
            mcp_paths.push(("Claude", home_path.join("Library").join("Application Support").join("Claude").join("claude_desktop_config.json")));
            mcp_paths.push(("Roo / Cline", home_path.join("Library").join("Application Support").join("Code").join("User").join("globalStorage").join("rooveterinaryinc.roo-cline").join("settings").join("cline_mcp_settings.json")));
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            let config_home = std::env::var("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|_| home_path.join(".config"));
            mcp_paths.push(("Claude", config_home.join("Claude").join("claude_desktop_config.json")));
            mcp_paths.push(("Roo / Cline", config_home.join("Code").join("User").join("globalStorage").join("rooveterinaryinc.roo-cline").join("settings").join("cline_mcp_settings.json")));
        }

        for (tool, p) in mcp_paths {
            if let Ok(content) = std::fs::read_to_string(&p) {
                let configured = content.contains("spine_companion") || content.contains("spine-companion");
                mcp_matches.push(serde_json::json!({
                    "tool": tool,
                    "path": p.to_string_lossy(),
                    "exists": true,
                    "configured": configured
                }));
            }
        }
    }
    let mcp_configured = mcp_matches.iter().any(|item| {
        item.get("configured")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    });

    Ok(serde_json::json!({
        "apiOk": state_ok,
        "localConfigExists": local_config_exists,
        "assetDirExists": asset_dir_exists,
        "hasSkel": has_skel,
        "hasAtlas": has_atlas,
        "hasPng": has_png,
        "mcpConfigured": mcp_configured,
        "mcpMatches": mcp_matches
    }))
}

#[derive(serde::Serialize)]
struct InstalledModel {
    id: String,
    dir: String,
}

#[tauri::command]
fn get_installed_models(data: State<'_, AppData>) -> Result<Vec<InstalledModel>, String> {
    let models_dir = data.config_dir.join("models");
    let mut models = Vec::new();
    if let Ok(entries) = std::fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let id = entry.file_name().to_string_lossy().to_string();
                    let dir = entry.path().to_string_lossy().to_string();
                    models.push(InstalledModel { id, dir });
                }
            }
        }
    }
    Ok(models)
}

#[tauri::command]
fn remove_model(data: State<'_, AppData>, id: String) -> Result<(), String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid model ID".to_string());
    }
    let models_dir = data.config_dir.join("models");
    let model_dir = models_dir.join(&id);
    let resolved_models_dir = models_dir
        .canonicalize()
        .unwrap_or_else(|_| models_dir.clone());
    let resolved_model_dir = model_dir
        .canonicalize()
        .unwrap_or_else(|_| model_dir.clone());
    if !resolved_model_dir.starts_with(&resolved_models_dir) {
        return Err("Path traversal detected".to_string());
    }
    let active_asset_dir = data
        .public_config
        .lock()
        .ok()
        .and_then(|config| string_at(&config, &["spine", "assetDir"]).map(str::to_string));
    if let Some(active_asset_dir) = active_asset_dir {
        let active = PathBuf::from(active_asset_dir)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::new());
        if active == resolved_model_dir {
            return Err("Cannot remove the active model".to_string());
        }
    }
    if model_dir.exists() {
        std::fs::remove_dir_all(model_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_folder(app: tauri::AppHandle, p: String) -> Result<(), String> {
    let data = app.state::<AppData>();
    let requested = PathBuf::from(&p);
    let allowed_root = data.config_dir.canonicalize().unwrap_or_else(|_| data.config_dir.clone());
    let requested_canonical = requested.canonicalize().map_err(|error| error.to_string())?;
    if !requested_canonical.starts_with(&allowed_root) {
        return Err("Refusing to open a path outside the companion config directory".to_string());
    }
    open_external(&requested_canonical.to_string_lossy()).map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_mouse_passthrough(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())
}

fn show_companion_window(win: &WebviewWindow) {
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

#[tauri::command]
async fn reveal_window(window: WebviewWindow) -> Result<(), String> {
    show_companion_window(&window);
    Ok(())
}

#[tauri::command]
fn open_manager_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("manager") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn show_panel_window(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.unminimize();
        let _ = panel.show();
        let _ = panel.set_focus();
    }
}

fn hide_companion_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn set_tray_state(app: &AppHandle, state: &str, direction: Option<&str>) {
    let app_handle = app.clone();
    let state = state.to_string();
    let direction = direction.map(str::to_string);
    tauri::async_runtime::spawn(async move {
        let data = app_handle.state::<AppData>();
        let _ = set_state(
            &data.store,
            &data.tx,
            SetStateInput {
                state: Some(state),
                direction,
                source: Some("tray".to_string()),
                ..Default::default()
            },
        )
        .await;
    });
}

fn open_local_api(app: &AppHandle) {
    let data = app.state::<AppData>();
    let public = public_config_with_ui(&data);
    let url = public
        .get("server")
        .and_then(|server| server.get("origin"))
        .and_then(|origin| origin.as_str())
        .unwrap_or("http://127.0.0.1:17388");
    let _ = open_external(url);
}

fn open_config_dir(app: &AppHandle) {
    let data = app.state::<AppData>();
    let public = public_config_with_ui(&data);
    if let Some(path) = public
        .get("paths")
        .and_then(|paths| paths.get("configDir"))
        .and_then(|path| path.as_str())
    {
        let _ = open_external(path);
    }
}

fn model_by_id(public_config: &serde_json::Value, id: &str) -> Option<serde_json::Value> {
    public_config
        .get("models")
        .and_then(|models| models.get("catalog"))
        .and_then(|catalog| catalog.as_array())
        .and_then(|catalog| {
            catalog
                .iter()
                .find(|model| model.get("id").and_then(|value| value.as_str()) == Some(id))
                .cloned()
        })
}

fn write_local_model_config(path: &Path, asset_dir: &Path, skel: &str) -> Result<(), String> {
    let mut config = read_json_if_exists(path).unwrap_or_else(|| serde_json::json!({}));
    merge_json(
        &mut config,
        serde_json::json!({
            "spine": {
                "assetDir": asset_dir.to_string_lossy().to_string(),
                "skel": skel
            }
        }),
    );
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{}\n", text)).map_err(|error| error.to_string())
}

fn url_encode_path_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{:02X}", byte),
        })
        .collect::<Vec<_>>()
        .join("")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime_config = load_runtime_config();
    let (store, tx) = create_state_store(&runtime_config.initial_state);
    let reminders = create_reminder_store();
    let store_for_server = store.clone();
    let tx_for_server = tx.clone();
    let reminders_for_server = reminders.clone();
    let host_for_server = runtime_config.host.clone();
    let port_for_server = runtime_config.port;
    let asset_root_store: server::AssetRootStore = Arc::new(tokio::sync::RwLock::new(
        runtime_config
            .asset_root
            .clone()
            .and_then(|path| path.canonicalize().ok()),
    ));
    let asset_root_for_server = asset_root_store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                show_companion_window(&win);
            }
        }))
        .manage(AppData {
            store: store.clone(),
            tx: tx.clone(),
            reminders: reminders.clone(),
            public_config: Arc::new(Mutex::new(runtime_config.public.clone())),
            ui_settings: Arc::new(Mutex::new(runtime_config.ui_settings.clone())),
            config_dir: runtime_config.config_dir.clone(),
            local_config_path: runtime_config.local_config_path.clone(),
            asset_root: asset_root_store.clone(),
        })
        .setup(move |app| {
            // Bind the local API server before the hidden window is revealed.
            // The renderer loads Spine assets from this server on startup, so
            // racing the first PIXI load against server startup can leave the
            // transparent window visible with no model.
            if let Err(e) = tauri::async_runtime::block_on(server::start_api_server(
                store_for_server,
                tx_for_server,
                reminders_for_server,
                asset_root_for_server,
                &host_for_server,
                port_for_server,
            )) {
                eprintln!("Failed to start API server: {}", e);
            }

            let app_handle = app.handle().clone();
            let mut rx = tx.subscribe();
            tauri::async_runtime::spawn(async move {
                while let Ok(state) = rx.recv().await {
                    let _ = app_handle.emit("companion:state", state);
                }
            });

            // Build minimal tray menu
            let show_item = MenuItem::with_id(app, "show_companion", "Show Companion", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide_companion", "Hide Companion", true, None::<&str>)?;
            let panel_item = MenuItem::with_id(app, "open_panel", "Open Quick Panel", true, None::<&str>)?;
            let manager_item = MenuItem::with_id(app, "open_manager", "Open Manager", true, None::<&str>)?;
            let bubble_item = MenuItem::with_id(app, "toggle_bubble", "Toggle Progress Bubble", true, None::<&str>)?;
            let hud_item = MenuItem::with_id(app, "toggle_hud", "Toggle Status Panel", true, None::<&str>)?;
            let diagnostics_item = MenuItem::with_id(app, "diagnostics", "Diagnostics", true, None::<&str>)?;
            let config_item = MenuItem::with_id(app, "open_config_dir", "Open Config Folder", true, None::<&str>)?;
            let api_item = MenuItem::with_id(app, "open_local_api", "Open Local API", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let state_idle = MenuItem::with_id(app, "state_idle", "Idle", true, None::<&str>)?;
            let state_working = MenuItem::with_id(app, "state_working", "Working", true, None::<&str>)?;
            let state_reviewing = MenuItem::with_id(app, "state_reviewing", "Reviewing", true, None::<&str>)?;
            let state_running_left = MenuItem::with_id(app, "state_running_left", "Running Left", true, None::<&str>)?;
            let state_running_right = MenuItem::with_id(app, "state_running_right", "Running Right", true, None::<&str>)?;
            let state_success = MenuItem::with_id(app, "state_success", "Success", true, None::<&str>)?;
            let state_failed = MenuItem::with_id(app, "state_failed", "Failed", true, None::<&str>)?;
            let state_waiting = MenuItem::with_id(app, "state_waiting", "Waiting", true, None::<&str>)?;
            let state_sleeping = MenuItem::with_id(app, "state_sleeping", "Sleeping", true, None::<&str>)?;
            let state_reminder = MenuItem::with_id(app, "state_reminder", "Reminder", true, None::<&str>)?;
            let state_menu = Submenu::with_items(
                app,
                "Set State",
                true,
                &[
                    &state_idle,
                    &state_working,
                    &state_reviewing,
                    &state_running_left,
                    &state_running_right,
                    &state_success,
                    &state_failed,
                    &state_waiting,
                    &state_sleeping,
                    &state_reminder,
                ],
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let sep4 = PredefinedMenuItem::separator(app)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &hide_item,
                    &panel_item,
                    &manager_item,
                    &sep1,
                    &bubble_item,
                    &hud_item,
                    &sep2,
                    &state_menu,
                    &sep3,
                    &diagnostics_item,
                    &config_item,
                    &api_item,
                    &sep4,
                    &quit_item,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::new();
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon).icon_as_template(true);
            }
            tray_builder
                .tooltip("Spine Companion")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show_companion" => {
                        if let Some(win) = app.get_webview_window("main") {
                            show_companion_window(&win);
                        }
                    }
                    "hide_companion" => hide_companion_window(app),
                    "open_panel" => show_panel_window(app),
                    "open_manager" => {
                        if let Some(win) = app.get_webview_window("manager") {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "toggle_bubble" => {
                        let data = app.state::<AppData>();
                        let visible = current_ui_settings(&data).bubble_visible;
                        let _ = update_ui_settings(app, UiSettingsPatch {
                            bubble_visible: Some(!visible),
                            ..Default::default()
                        });
                    }
                    "toggle_hud" => {
                        let data = app.state::<AppData>();
                        let visible = current_ui_settings(&data).hud_visible;
                        let _ = update_ui_settings(app, UiSettingsPatch {
                            hud_visible: Some(!visible),
                            ..Default::default()
                        });
                    }
                    "state_idle" => set_tray_state(app, "idle", None),
                    "state_working" => set_tray_state(app, "working", None),
                    "state_reviewing" => set_tray_state(app, "reviewing", None),
                    "state_running_left" => set_tray_state(app, "running", Some("left")),
                    "state_running_right" => set_tray_state(app, "running", Some("right")),
                    "state_success" => set_tray_state(app, "success", None),
                    "state_failed" => set_tray_state(app, "failed", None),
                    "state_waiting" => set_tray_state(app, "waiting", None),
                    "state_sleeping" => set_tray_state(app, "sleeping", None),
                    "state_reminder" => set_tray_state(app, "reminder", None),
                    "diagnostics" => open_manager_window(app.clone()),
                    "open_config_dir" => open_config_dir(app),
                    "open_local_api" => open_local_api(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(panel) = app.get_webview_window("panel") {
                            let panel_size = panel.outer_size().unwrap_or(tauri::PhysicalSize::new(320, 480));

                            // Try to calculate position slightly offset from the tray icon
                            let (rect_x, rect_y) = match rect.position {
                                tauri::Position::Physical(p) => (p.x, p.y),
                                tauri::Position::Logical(p) => (p.x as i32, p.y as i32),
                            };
                            let (_rect_w, rect_h) = match rect.size {
                                tauri::Size::Physical(s) => (s.width as i32, s.height as i32),
                                tauri::Size::Logical(s) => (s.width as i32, s.height as i32),
                            };

                            let x = rect_x - (panel_size.width as i32) / 2;
                            let mut y = rect_y - (panel_size.height as i32) - 10;
                            if y < 0 {
                                y = rect_y + rect_h + 10; // If taskbar is on top
                            }

                            let _ = panel.set_position(tauri::PhysicalPosition::new(x, y));
                            let _ = panel.unminimize();
                            let _ = panel.show();
                            let _ = panel.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_state,
            set_companion_state,
            create_reminder_cmd,
            set_ui_settings,
            emit_scale_event,
            import_model,
            save_settings,
            get_diagnostics,
            get_installed_models,
            remove_model,
            open_folder,
            start_drag,
            set_mouse_passthrough,
            reveal_window,
            open_manager_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
