mod server;
mod state;

use state::{
    create_reminder, create_reminder_store, create_state_store, delete_reminder, list_reminders,
    set_state, CompanionState, CreateReminderInput, Reminder, ReminderStore, SetStateInput,
    StateBroadcast, StateStore,
};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
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
    history: Arc<Mutex<Vec<CompanionState>>>,
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
    auto_reveal_on_mcp: bool,
    system_notifications: bool,
    shortcut_enabled: bool,
    shortcut_accelerator: String,
    update_auto_check: bool,
    max_device_pixel_ratio: f64,
    hitbox_padding: f64,
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
    auto_reveal_on_mcp: Option<bool>,
    system_notifications: Option<bool>,
    shortcut_enabled: Option<bool>,
    shortcut_accelerator: Option<String>,
    update_auto_check: Option<bool>,
    max_device_pixel_ratio: Option<f64>,
    hitbox_padding: Option<f64>,
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
            "dragMode": "compatible",
            "autoRevealOnMcp": true,
            "systemNotifications": true,
            "shortcutEnabled": true,
            "shortcutAccelerator": "CommandOrControl+Shift+S",
            "updateAutoCheck": true,
            "maxDevicePixelRatio": 2,
            "hitboxPadding": 8
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
            "success": { "from": 4.4, "to": 14.433, "loop": false },
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

fn default_local_config_path(root: &Path) -> PathBuf {
    user_config_dir()
        .unwrap_or_else(|| root.to_path_buf())
        .join("companion.local.json")
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

fn f64_at(value: &serde_json::Value, path: &[&str], fallback: f64) -> f64 {
    let mut current = value;
    for key in path {
        if let Some(next) = current.get(*key) {
            current = next;
        } else {
            return fallback;
        }
    }
    current.as_f64().unwrap_or(fallback)
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

fn atlas_texture_refs(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let lower = trimmed.to_ascii_lowercase();
            let top_level = !line
                .chars()
                .next()
                .map(|ch| ch.is_whitespace())
                .unwrap_or(false);
            if top_level
                && !trimmed.is_empty()
                && (lower.ends_with(".png")
                    || lower.ends_with(".jpg")
                    || lower.ends_with(".jpeg")
                    || lower.ends_with(".webp"))
            {
                Some(trimmed.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn validate_spine_asset_dir(asset_dir: &Path, skel: &str) -> Result<(), String> {
    let skel_path = asset_dir.join(skel);
    if skel.is_empty()
        || skel_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("skel"))
            != Some(true)
    {
        return Err("Choose a Spine .skel file.".to_string());
    }
    if !skel_path.is_file() {
        return Err(format!(
            "Spine skeleton file does not exist: {}",
            skel_path.to_string_lossy()
        ));
    }
    let mut atlas_files = Vec::new();
    let mut has_png = false;
    for entry in std::fs::read_dir(asset_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
            if ext.eq_ignore_ascii_case("atlas") {
                atlas_files.push(path.clone());
            }
            if ext.eq_ignore_ascii_case("png") {
                has_png = true;
            }
        }
    }
    if atlas_files.is_empty() || !has_png {
        return Err("The selected .skel folder must also contain at least one .atlas file and one .png texture.".to_string());
    }
    let mut missing = Vec::new();
    for atlas in atlas_files {
        let text = std::fs::read_to_string(&atlas).map_err(|error| error.to_string())?;
        for texture in atlas_texture_refs(&text) {
            if !asset_dir.join(&texture).is_file() {
                missing.push(format!(
                    "{} -> {}",
                    atlas.file_name().and_then(|value| value.to_str()).unwrap_or("atlas"),
                    texture
                ));
            }
        }
    }
    if !missing.is_empty() {
        return Err(format!("Missing atlas texture file(s): {}", missing.join(", ")));
    }
    Ok(())
}

fn ui_settings_from_config(config: &serde_json::Value) -> UiSettings {
    let background = string_at(config, &["ui", "bubbleBackground"])
        .unwrap_or("solid")
        .to_string();
    let drag_mode = string_at(config, &["ui", "dragMode"])
        .unwrap_or("compatible")
        .to_string();
    let shortcut = string_at(config, &["ui", "shortcutAccelerator"])
        .unwrap_or("CommandOrControl+Shift+S")
        .to_string();
    UiSettings {
        hud_visible: bool_at(config, &["ui", "hudVisible"], false),
        bubble_visible: bool_at(config, &["ui", "bubbleVisible"], true),
        bubble_shadow: bool_at(config, &["ui", "bubbleShadow"], true),
        bubble_background: normalize_bubble_background(&background),
        bubble_hold_ms: u64_at(config, &["ui", "bubbleHoldMs"], 8000),
        drag_mode: normalize_drag_mode(&drag_mode),
        auto_reveal_on_mcp: bool_at(config, &["ui", "autoRevealOnMcp"], true),
        system_notifications: bool_at(config, &["ui", "systemNotifications"], true),
        shortcut_enabled: bool_at(config, &["ui", "shortcutEnabled"], true),
        shortcut_accelerator: if shortcut.trim().is_empty() {
            "CommandOrControl+Shift+S".to_string()
        } else {
            shortcut.trim().to_string()
        },
        update_auto_check: bool_at(config, &["ui", "updateAutoCheck"], true),
        max_device_pixel_ratio: f64_at(config, &["ui", "maxDevicePixelRatio"], 2.0).clamp(1.0, 3.0),
        hitbox_padding: f64_at(config, &["ui", "hitboxPadding"], 8.0).clamp(0.0, 48.0),
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
    if let Some(value) = patch.auto_reveal_on_mcp {
        settings.auto_reveal_on_mcp = value;
    }
    if let Some(value) = patch.system_notifications {
        settings.system_notifications = value;
    }
    if let Some(value) = patch.shortcut_enabled {
        settings.shortcut_enabled = value;
    }
    if let Some(value) = patch.shortcut_accelerator {
        if !value.trim().is_empty() {
            settings.shortcut_accelerator = value.trim().to_string();
        }
    }
    if let Some(value) = patch.update_auto_check {
        settings.update_auto_check = value;
    }
    if let Some(value) = patch.max_device_pixel_ratio {
        settings.max_device_pixel_ratio = value.clamp(1.0, 3.0);
    }
    if let Some(value) = patch.hitbox_padding {
        settings.hitbox_padding = value.clamp(0.0, 48.0);
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

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentModel {
    id: String,
    name: String,
    skel: String,
    asset_dir: String,
    source: String,
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
    refresh_public_asset_fields(&mut public);
    public
}

fn refresh_public_asset_fields(public: &mut serde_json::Value) {
    let origin = string_at(public, &["server", "origin"])
        .unwrap_or("http://127.0.0.1:17388")
        .to_string();
    let skel = string_at(public, &["spine", "skel"])
        .unwrap_or("")
        .to_string();
    let asset_dir = string_at(public, &["spine", "assetDir"])
        .unwrap_or("")
        .to_string();
    public["spine"]["assetUrl"] = serde_json::Value::String(format!(
        "{}/assets/spine/{}",
        origin.trim_end_matches('/'),
        url_encode_path_segment(&skel)
    ));
    public["spine"]["assetDirConfigured"] = serde_json::Value::Bool(!asset_dir.is_empty());
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

#[derive(Clone, Debug)]
struct RecoveredModel {
    asset_dir: PathBuf,
    skel: String,
}

fn first_recoverable_model(config_dir: &Path, config: &serde_json::Value) -> Option<RecoveredModel> {
    let catalog = config
        .get("models")
        .and_then(|models| models.get("catalog"))
        .and_then(|catalog| catalog.as_array())?;
    for model in catalog {
        let Some(id) = model.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(skel) = model.get("skel").and_then(|value| value.as_str()) else {
            continue;
        };
        let asset_dir = config_dir.join("models").join(id);
        if validate_spine_asset_dir(&asset_dir, skel).is_ok() {
            let canonical = asset_dir.canonicalize().unwrap_or(asset_dir);
            return Some(RecoveredModel {
                asset_dir: canonical,
                skel: skel.to_string(),
            });
        }
    }
    None
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
    let config_dir_path = user_config_dir().unwrap_or_else(|| root.clone());
    let local_config_path = if resolved_local_config_path.is_empty() {
        default_local_config_path(&root)
    } else {
        PathBuf::from(&resolved_local_config_path)
    };
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
    let mut asset_dir = resolve_asset_dir(&asset_base_dir, raw_asset_dir);
    config["spine"]["assetDir"] = serde_json::Value::String(asset_dir.clone());
    let mut skel = string_at(&config, &["spine", "skel"])
        .unwrap_or("amiya.skel")
        .to_string();
    if asset_dir.is_empty() {
        if let Some(recovered) = first_recoverable_model(&config_dir_path, &config) {
            if write_local_model_config(&local_config_path, &recovered.asset_dir, &recovered.skel)
                .and_then(|_| {
                    verify_local_model_config(&local_config_path, &recovered.asset_dir, &recovered.skel)
                })
                .is_ok()
            {
                asset_dir = recovered.asset_dir.to_string_lossy().to_string();
                skel = recovered.skel;
                config["spine"]["assetDir"] = serde_json::Value::String(asset_dir.clone());
                config["spine"]["skel"] = serde_json::Value::String(skel.clone());
                resolved_local_config_path = local_config_path.to_string_lossy().to_string();
            }
        }
    }
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
            "assetDir": asset_dir.clone(),
            "skel": skel.clone(),
            "assetUrl": format!("{}/assets/spine/{}", origin, url_encode_path_segment(&skel)),
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
async fn list_reminders_cmd(data: State<'_, AppData>) -> Result<Vec<Reminder>, String> {
    Ok(list_reminders(&data.reminders).await)
}

#[tauri::command]
async fn delete_reminder_cmd(data: State<'_, AppData>, id: String) -> Result<serde_json::Value, String> {
    let deleted = delete_reminder(&data.reminders, &id).await;
    Ok(serde_json::json!({ "deleted": deleted, "id": id }))
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
    let temp_model_dir = data
        .config_dir
        .join("models")
        .join(format!("{}.download", &input.id));
    remove_dir_if_exists(&temp_model_dir).await?;
    tokio::fs::create_dir_all(&temp_model_dir)
        .await
        .map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let total_files = files.len();
    for (i, file) in files.iter().enumerate() {
        let file_name = file
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Model file is missing name".to_string())?;
        let urls = download_url_candidates(file)?;

        let _ = app.emit(
            "companion:download-progress",
            serde_json::json!({
                "id": input.id,
                "file": file_name,
                "current": i + 1,
                "total": total_files,
                "status": "downloading"
            }),
        );

        let bytes = download_model_file(&client, file_name, &urls)
            .await
            .map_err(|error| {
                let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                let message = format!("Failed to download {}", error);
                let _ = app.emit(
                    "companion:download-progress",
                    serde_json::json!({
                        "id": input.id,
                        "file": file_name,
                        "current": i + 1,
                        "total": total_files,
                        "status": "failed",
                        "error": message
                    }),
                );
                message
            })?;
        tokio::fs::write(temp_model_dir.join(file_name), bytes)
            .await
            .map_err(|error| {
                let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                error.to_string()
            })?;
    }
    validate_spine_asset_dir(&temp_model_dir, &skel).map_err(|error| {
        let _ = remove_dir_if_exists_blocking(&temp_model_dir);
        let _ = app.emit(
            "companion:download-progress",
            serde_json::json!({
                "id": input.id,
                "file": "Validation",
                "current": total_files,
                "total": total_files,
                "status": "failed",
                "error": error
            }),
        );
        error
    })?;
    replace_model_dir(&temp_model_dir, &model_dir).await.map_err(|error| {
        let _ = app.emit(
            "companion:download-progress",
            serde_json::json!({
                "id": input.id,
                "file": "Activation",
                "current": total_files,
                "total": total_files,
                "status": "failed",
                "error": error
            }),
        );
        error
    })?;
    let canonical_model_dir = model_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    write_local_model_config(&data.local_config_path, &canonical_model_dir, &skel).map_err(|error| {
        let message = format!("Failed to activate downloaded model: {}", error);
        let _ = app.emit(
            "companion:download-progress",
            serde_json::json!({
                "id": input.id,
                "file": "Activation",
                "current": total_files,
                "total": total_files,
                "status": "failed",
                "error": message
            }),
        );
        message
    })?;
    verify_local_model_config(&data.local_config_path, &canonical_model_dir, &skel).map_err(|error| {
        let message = format!("Downloaded model was not activated: {}", error);
        let _ = app.emit(
            "companion:download-progress",
            serde_json::json!({
                "id": input.id,
                "file": "Activation",
                "current": total_files,
                "total": total_files,
                "status": "failed",
                "error": message
            }),
        );
        message
    })?;
    if let Ok(mut public) = data.public_config.lock() {
        merge_json(
            &mut public,
            serde_json::json!({
                "spine": {
                    "assetDir": canonical_model_dir.to_string_lossy().to_string(),
                    "assetDirConfigured": true,
                    "skel": skel.clone()
                }
            }),
        );
    }
    {
        let mut asset_root = data.asset_root.write().await;
        *asset_root = Some(canonical_model_dir.clone());
    }
    let public = public_config_with_ui(&data);
    if !public
        .get("spine")
        .and_then(|spine| spine.get("assetDirConfigured"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        let message = "Downloaded model was not activated in public config".to_string();
        let _ = app.emit(
            "companion:download-progress",
            serde_json::json!({
                "id": input.id,
                "file": "Activation",
                "current": total_files,
                "total": total_files,
                "status": "failed",
                "error": message
            }),
        );
        return Err(message);
    }
    let _ = app.emit(
        "companion:download-progress",
        serde_json::json!({
            "id": input.id,
            "file": "Done",
            "current": total_files,
            "total": total_files,
            "status": "succeeded"
        }),
    );

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
    let _ = app.emit("companion:config-changed", public_config_with_ui(&data));

    Ok(result)
}

fn github_raw_to_jsdelivr_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://raw.githubusercontent.com/")?;
    let mut parts = rest.splitn(4, '/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    let branch = parts.next()?;
    let path = parts.next()?;
    if owner.is_empty() || repo.is_empty() || branch.is_empty() || path.is_empty() {
        return None;
    }
    Some(format!(
        "https://cdn.jsdelivr.net/gh/{}@{}/{}",
        format!("{}/{}", owner, repo),
        branch,
        path
    ))
}

fn download_url_candidates(file: &serde_json::Value) -> Result<Vec<String>, String> {
    let primary = file
        .get("url")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Model file is missing url".to_string())?;
    let mut urls = vec![primary.to_string()];
    if let Some(fallbacks) = file.get("fallbackUrls").and_then(|value| value.as_array()) {
        for fallback in fallbacks {
            if let Some(url) = fallback.as_str() {
                urls.push(url.to_string());
            }
        }
    }
    if let Some(url) = github_raw_to_jsdelivr_url(primary) {
        urls.push(url);
    }
    let mut deduped = Vec::new();
    for url in urls {
        if !deduped.iter().any(|candidate| candidate == &url) {
            deduped.push(url);
        }
    }
    Ok(deduped)
}

async fn download_model_file(
    client: &reqwest::Client,
    file_name: &str,
    urls: &[String],
) -> Result<Vec<u8>, String> {
    let mut attempts = Vec::new();
    for url in urls {
        match client.get(url).send().await {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    attempts.push(format!("{} (HTTP {})", url, status.as_u16()));
                    continue;
                }
                match response.bytes().await {
                    Ok(bytes) => return Ok(bytes.to_vec()),
                    Err(error) => attempts.push(format!("{} ({})", url, error)),
                }
            }
            Err(error) => attempts.push(format!("{} ({})", url, error)),
        }
    }
    Err(format!("{}; tried {}", file_name, attempts.join("; ")))
}

async fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    match tokio::fs::remove_dir_all(path).await {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn remove_dir_if_exists_blocking(path: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn replace_model_dir(temp_dir: &Path, final_dir: &Path) -> Result<(), String> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let backup_dir = final_dir.with_extension(format!("previous-{}", suffix));
    remove_dir_if_exists(&backup_dir).await?;
    if tokio::fs::try_exists(final_dir)
        .await
        .map_err(|error| error.to_string())?
    {
        tokio::fs::rename(final_dir, &backup_dir)
            .await
            .map_err(|error| format!("Failed to stage previous model directory: {}", error))?;
    }
    if let Err(error) = tokio::fs::rename(temp_dir, final_dir).await {
        if tokio::fs::try_exists(&backup_dir).await.unwrap_or(false) {
            let _ = tokio::fs::rename(&backup_dir, final_dir).await;
        }
        return Err(format!("Failed to activate downloaded model directory: {}", error));
    }
    remove_dir_if_exists(&backup_dir).await?;
    Ok(())
}

fn verify_local_model_config(path: &Path, expected_asset_dir: &Path, expected_skel: &str) -> Result<(), String> {
    let config = read_json_if_exists(path)
        .ok_or_else(|| format!("{} was not written", path.to_string_lossy()))?;
    let spine = config
        .get("spine")
        .ok_or_else(|| "spine config section is missing".to_string())?;
    let asset_dir = spine
        .get("assetDir")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "spine.assetDir is missing".to_string())?;
    let skel = spine
        .get("skel")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "spine.skel is missing".to_string())?;
    if skel != expected_skel {
        return Err(format!("spine.skel is {}, expected {}", skel, expected_skel));
    }
    let written = PathBuf::from(asset_dir);
    if written != expected_asset_dir {
        return Err(format!(
            "spine.assetDir is {}, expected {}",
            asset_dir,
            expected_asset_dir.to_string_lossy()
        ));
    }
    Ok(())
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
    let origin = public
        .get("server")
        .and_then(|s| s.get("origin"))
        .and_then(|o| o.as_str())
        .unwrap_or("http://127.0.0.1:17388");

    let state_ok = reqwest::get(&format!("{}/state", origin)).await.is_ok();

    let local_config_exists = data.local_config_path.exists();

    let mut asset_dir_exists = false;
    let mut has_skel = false;
    let mut has_atlas = false;
    let mut has_png = false;
    let mut model_health = serde_json::json!({
        "ok": false,
        "message": "No active asset directory."
    });
    let recovery = first_recoverable_model(&data.config_dir, &public)
        .map(|model| {
            serde_json::json!({
                "available": true,
                "assetDir": model.asset_dir.to_string_lossy().to_string(),
                "skel": model.skel
            })
        })
        .unwrap_or_else(|| {
            serde_json::json!({
                "available": false,
                "message": "No recoverable downloaded catalog model was found."
            })
        });

    if let Some(asset_root) = &*data.asset_root.read().await {
        asset_dir_exists = asset_root.exists();
        if let Ok(mut entries) = tokio::fs::read_dir(asset_root).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if ext == "skel" {
                        has_skel = true;
                    }
                    if ext == "atlas" {
                        has_atlas = true;
                    }
                    if ext == "png" {
                        has_png = true;
                    }
                }
            }
        }
        let skel = string_at(&public, &["spine", "skel"]).unwrap_or("");
        model_health = match validate_spine_asset_dir(asset_root, skel) {
            Ok(()) => serde_json::json!({
                "ok": true,
                "message": "Spine asset set is healthy."
            }),
            Err(error) => serde_json::json!({
                "ok": false,
                "message": error
            }),
        };
    }

    let mut mcp_matches = Vec::new();
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if !home.is_empty() {
        let home_path = std::path::Path::new(&home);
        let mut mcp_paths = vec![
            ("Codex", home_path.join(".codex").join("config.toml")),
            (
                "Gemini / Antigravity",
                home_path
                    .join(".gemini")
                    .join("antigravity")
                    .join("mcp_config.json"),
            ),
        ];
        #[cfg(target_os = "windows")]
        {
            let roaming = std::env::var("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| home_path.join("AppData").join("Roaming"));
            mcp_paths.push((
                "Claude",
                roaming.join("Claude").join("claude_desktop_config.json"),
            ));
            mcp_paths.push((
                "Roo / Cline",
                roaming
                    .join("Code")
                    .join("User")
                    .join("globalStorage")
                    .join("rooveterinaryinc.roo-cline")
                    .join("settings")
                    .join("cline_mcp_settings.json"),
            ));
        }
        #[cfg(target_os = "macos")]
        {
            mcp_paths.push((
                "Claude",
                home_path
                    .join("Library")
                    .join("Application Support")
                    .join("Claude")
                    .join("claude_desktop_config.json"),
            ));
            mcp_paths.push((
                "Roo / Cline",
                home_path
                    .join("Library")
                    .join("Application Support")
                    .join("Code")
                    .join("User")
                    .join("globalStorage")
                    .join("rooveterinaryinc.roo-cline")
                    .join("settings")
                    .join("cline_mcp_settings.json"),
            ));
        }
        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            let config_home = std::env::var("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|_| home_path.join(".config"));
            mcp_paths.push((
                "Claude",
                config_home
                    .join("Claude")
                    .join("claude_desktop_config.json"),
            ));
            mcp_paths.push((
                "Roo / Cline",
                config_home
                    .join("Code")
                    .join("User")
                    .join("globalStorage")
                    .join("rooveterinaryinc.roo-cline")
                    .join("settings")
                    .join("cline_mcp_settings.json"),
            ));
        }

        for (tool, p) in mcp_paths {
            if let Ok(content) = std::fs::read_to_string(&p) {
                let configured =
                    content.contains("spine_companion") || content.contains("spine-companion");
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
        "modelHealth": model_health,
        "modelRecovery": recovery,
        "logsDir": data.config_dir.join("logs").to_string_lossy().to_string(),
        "shortcut": {
            "enabled": current_ui_settings(&data).shortcut_enabled,
            "registered": false,
            "accelerator": current_ui_settings(&data).shortcut_accelerator,
            "error": "Global shortcuts are not implemented in the Tauri runtime yet."
        },
        "runtime": {
            "name": "tauri",
            "experimental": true
        },
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
fn get_history(data: State<'_, AppData>) -> Result<Vec<CompanionState>, String> {
    data.history
        .lock()
        .map(|history| history.clone())
        .map_err(|_| "History lock is poisoned".to_string())
}

#[tauri::command]
fn get_current_model(data: State<'_, AppData>) -> Result<CurrentModel, String> {
    let public = public_config_with_ui(&data);
    let skel = string_at(&public, &["spine", "skel"])
        .unwrap_or("")
        .to_string();
    let model = model_by_skel(&public, &skel);
    Ok(CurrentModel {
        id: model
            .as_ref()
            .and_then(|m| m.get("id").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        name: model
            .as_ref()
            .and_then(|m| m.get("name").and_then(|v| v.as_str()))
            .unwrap_or(if skel.is_empty() { "None" } else { &skel })
            .to_string(),
        skel,
        asset_dir: string_at(&public, &["spine", "assetDir"])
            .unwrap_or("")
            .to_string(),
        source: model
            .as_ref()
            .and_then(|m| m.get("source").and_then(|v| v.as_str()))
            .unwrap_or("Local")
            .to_string(),
    })
}

#[tauri::command]
async fn set_active_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    id: String,
) -> Result<ImportModelResult, String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid model ID".to_string());
    }
    let public = public_config_with_ui(&data);
    let model = model_by_id(&public, &id);
    let model_dir = data.config_dir.join("models").join(&id);
    if !model_dir.exists() {
        return Err(format!("Model is not installed: {}", id));
    }
    let skel = model
        .as_ref()
        .and_then(|m| m.get("skel").and_then(|v| v.as_str()))
        .map(str::to_string)
        .or_else(|| {
            std::fs::read_dir(&model_dir).ok().and_then(|entries| {
                entries.flatten().find_map(|entry| {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.ends_with(".skel") {
                        Some(name)
                    } else {
                        None
                    }
                })
            })
        })
        .ok_or_else(|| "No .skel file found".to_string())?;
    validate_spine_asset_dir(&model_dir, &skel)?;
    let canonical_model_dir = model_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    write_local_model_config(&data.local_config_path, &canonical_model_dir, &skel)?;
    verify_local_model_config(&data.local_config_path, &canonical_model_dir, &skel)?;
    if let Ok(mut public) = data.public_config.lock() {
        merge_json(
            &mut public,
            serde_json::json!({
                "spine": {
                    "assetDir": canonical_model_dir.to_string_lossy().to_string(),
                    "assetDirConfigured": true,
                    "skel": skel.clone()
                }
            }),
        );
    }
    {
        let mut asset_root = data.asset_root.write().await;
        *asset_root = Some(canonical_model_dir.clone());
    }
    let origin = public
        .get("server")
        .and_then(|server| server.get("origin"))
        .and_then(|origin| origin.as_str())
        .unwrap_or("http://127.0.0.1:17388");
    let result = ImportModelResult {
        id: id.clone(),
        name: model
            .as_ref()
            .and_then(|m| m.get("name").and_then(|v| v.as_str()))
            .unwrap_or(&id)
            .to_string(),
        asset_dir: canonical_model_dir.to_string_lossy().to_string(),
        skel: skel.clone(),
        asset_url: format!("{}/assets/spine/{}", origin, url_encode_path_segment(&skel)),
        local_config_path: data.local_config_path.to_string_lossy().to_string(),
        requires_restart: false,
    };
    let _ = app.emit("companion:model-imported", result.clone());
    let _ = app.emit("companion:config-changed", public_config_with_ui(&data));
    Ok(result)
}

#[tauri::command]
async fn check_updates() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let current_version = env!("CARGO_PKG_VERSION");
    let endpoint = if is_prerelease_version(current_version) {
        "releases?per_page=20"
    } else {
        "releases/latest"
    };
    let text = client
        .get(format!(
            "https://api.github.com/repos/cb8010d6/spine-companion/{}",
            endpoint
        ))
        .header("User-Agent", "spine-companion")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    let payload: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let response = latest_release_from_payload(&payload)
        .ok_or_else(|| "GitHub release check failed: no releases found.".to_string())?;
    let assets = response
        .get("assets")
        .and_then(|value| value.as_array())
        .map(|assets| {
            assets
                .iter()
                .map(normalize_release_asset)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let recommended_asset = select_release_asset(&assets);
    let latest_version = response
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let release_url = response
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let download_url = recommended_asset
        .as_ref()
        .and_then(|asset| asset.get("url"))
        .and_then(|value| value.as_str())
        .unwrap_or(&release_url)
        .to_string();
    Ok(serde_json::json!({
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "updateAvailable": compare_versions(&latest_version, current_version) > 0,
        "url": release_url,
        "name": response.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        "assets": assets,
        "recommendedAsset": recommended_asset,
        "downloadUrl": download_url,
        "channel": if is_prerelease_version(current_version) { "prerelease" } else { "stable" },
        "source": format!("https://api.github.com/repos/cb8010d6/spine-companion/{}", endpoint)
    }))
}

#[tauri::command]
fn export_logs(data: State<'_, AppData>) -> Result<serde_json::Value, String> {
    let logs_dir = data.config_dir.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|error| error.to_string())?;
    let output = logs_dir.join(format!(
        "spine-companion-logs-{}.txt",
        chrono::Utc::now().to_rfc3339().replace([':', '.'], "-")
    ));
    let mut body = String::new();
    if let Ok(entries) = std::fs::read_dir(&logs_dir) {
        let mut files = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("log"))
            .collect::<Vec<_>>();
        files.sort();
        for file in files.into_iter().rev().take(7).collect::<Vec<_>>().into_iter().rev() {
            body.push_str(&format!(
                "===== {} =====\n",
                file.file_name().and_then(|name| name.to_str()).unwrap_or("log")
            ));
            if let Ok(text) = std::fs::read_to_string(&file) {
                body.push_str(&text);
            }
            body.push('\n');
        }
    }
    if body.is_empty() {
        body.push_str("No log entries yet.\n");
    }
    std::fs::write(&output, body).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "file": output.to_string_lossy().to_string(),
        "logsDir": logs_dir.to_string_lossy().to_string()
    }))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http(s) URLs can be opened externally".to_string());
    }
    open_external(&url).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_auto_launch(_enabled: bool) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "supported": false,
        "enabled": false,
        "reason": "Auto launch requires a platform startup plugin and is not enabled in the portable Tauri build."
    }))
}

#[tauri::command]
fn open_folder(app: tauri::AppHandle, p: String) -> Result<(), String> {
    let data = app.state::<AppData>();
    let requested = PathBuf::from(&p);
    let allowed_root = data
        .config_dir
        .canonicalize()
        .unwrap_or_else(|_| data.config_dir.clone());
    let requested_canonical = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
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
    if enabled {
        // Tauri does not support Electron's forward:true behavior here. If we
        // ignore cursor events, the transparent window stops receiving the
        // mousemove/wheel events needed to recover clickability and zoom.
        return Ok(());
    }
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())
}

fn show_companion_window(win: &WebviewWindow) {
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

fn should_reveal_for_state(settings: &UiSettings, state: &CompanionState) -> bool {
    settings.auto_reveal_on_mcp && is_ai_source(&state.source) && state.state != "idle"
}

fn is_ai_source(source: &str) -> bool {
    let source = source.to_ascii_lowercase();
    source.starts_with("codex")
        || source.starts_with("claude")
        || source.starts_with("cursor")
        || source.starts_with("cline")
        || source.starts_with("roo")
        || source.starts_with("gemini")
        || source.starts_with("antigravity")
        || source.starts_with("local-ai")
        || source.ends_with("-mcp")
}

#[tauri::command]
async fn reveal_window(window: WebviewWindow) -> Result<(), String> {
    show_companion_window(&window);
    Ok(())
}

#[tauri::command]
async fn open_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    show_manager_window(&app).map(|_| ())
}

fn create_manager_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    WebviewWindowBuilder::new(app, "manager", WebviewUrl::App("manager.html".into()))
        .title("Spine Companion - Manager")
        .inner_size(800.0, 600.0)
        .min_inner_size(600.0, 400.0)
        .decorations(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())
}

fn show_manager_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let win = if let Some(win) = app.get_webview_window("manager") {
        win
    } else {
        create_manager_window(app)?
    };
    if let Err(error) = win.unminimize() {
        eprintln!("Failed to unminimize Manager: {}", error);
    }
    win.show()
        .map_err(|error| format!("Failed to show Manager: {}", error))?;
    if let Err(error) = win.set_always_on_top(true) {
        eprintln!("Failed to raise Manager: {}", error);
    }
    if let Err(error) = win.set_focus() {
        eprintln!("Failed to focus Manager: {}", error);
    }
    let raised = win.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        let _ = raised.set_always_on_top(false);
    });
    Ok(win)
}

fn open_manager_from_tray(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = show_manager_window(&handle) {
            eprintln!("Failed to open Manager from tray: {}", error);
        }
    });
}

fn show_panel_window(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.unminimize();
        let _ = panel.show();
        let _ = panel.set_focus();
    }
}

fn hide_panel_window_inner(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.hide();
    }
}

fn hide_companion_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn hide_panel_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_panel_window_inner(&app);
    Ok(())
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

fn model_by_skel(public_config: &serde_json::Value, skel: &str) -> Option<serde_json::Value> {
    public_config
        .get("models")
        .and_then(|models| models.get("catalog"))
        .and_then(|catalog| catalog.as_array())
        .and_then(|catalog| {
            catalog
                .iter()
                .find(|model| model.get("skel").and_then(|value| value.as_str()) == Some(skel))
                .cloned()
        })
}

fn is_prerelease_version(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.contains("-alpha") || value.contains("-beta") || value.contains("-rc")
}

fn parse_version(value: &str) -> (Vec<i32>, Vec<String>) {
    let raw = value.trim_start_matches('v');
    let mut parts = raw.splitn(2, '-');
    let core = parts
        .next()
        .unwrap_or("0")
        .split('.')
        .map(|part| part.parse::<i32>().unwrap_or(0))
        .collect::<Vec<_>>();
    let prerelease = parts
        .next()
        .unwrap_or("")
        .split(['.', '-'])
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    (core, prerelease)
}

fn compare_prerelease_identifier(a: &str, b: &str) -> i8 {
    let left_number = a.parse::<i32>();
    let right_number = b.parse::<i32>();
    let ordering = match (left_number, right_number) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        (Ok(_), Err(_)) => return -1,
        (Err(_), Ok(_)) => return 1,
        (Err(_), Err(_)) => a.cmp(b),
    };
    match ordering {
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
    }
}

fn compare_versions(a: &str, b: &str) -> i8 {
    let (left_core, left_pre) = parse_version(a);
    let (right_core, right_pre) = parse_version(b);
    let len = left_core.len().max(right_core.len());
    for i in 0..len {
        let diff = left_core.get(i).copied().unwrap_or(0) - right_core.get(i).copied().unwrap_or(0);
        if diff > 0 {
            return 1;
        }
        if diff < 0 {
            return -1;
        }
    }
    if left_pre.is_empty() && !right_pre.is_empty() {
        return 1;
    }
    if !left_pre.is_empty() && right_pre.is_empty() {
        return -1;
    }
    let pre_len = left_pre.len().max(right_pre.len());
    for i in 0..pre_len {
        let Some(left) = left_pre.get(i) else {
            return -1;
        };
        let Some(right) = right_pre.get(i) else {
            return 1;
        };
        let diff = compare_prerelease_identifier(left, right);
        if diff > 0 {
            return 1;
        }
        if diff < 0 {
            return -1;
        }
    }
    0
}

fn latest_release_from_payload(payload: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(releases) = payload.as_array() {
        return releases
            .iter()
            .filter(|release| {
                !release
                    .get("draft")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
            })
            .max_by(|a, b| {
                let left = a
                    .get("tag_name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let right = b
                    .get("tag_name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                compare_versions(left, right).cmp(&0)
            })
            .cloned();
    }
    Some(payload.clone())
}

fn normalize_release_asset(asset: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "name": asset.get("name").and_then(|value| value.as_str()).unwrap_or(""),
        "url": asset
            .get("browser_download_url")
            .or_else(|| asset.get("url"))
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        "size": asset.get("size").and_then(|value| value.as_u64()).unwrap_or(0),
        "digest": asset.get("digest").and_then(|value| value.as_str()).unwrap_or("")
    })
}

fn release_asset_score(asset: &serde_json::Value) -> i32 {
    let name = asset
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let is_arm = arch == "aarch64" || arch == "arm64";
    let is_x64 = arch == "x86_64" || arch == "x64" || arch == "amd64";

    match os {
        "windows" => {
            if !name.ends_with(".exe") && !name.ends_with(".msi") {
                return 0;
            }
            let mut score = if name.ends_with(".exe") { 80 } else { 60 };
            if is_x64 && (name.contains("x64") || name.contains("amd64")) {
                score += 30;
            }
            if is_arm && (name.contains("arm64") || name.contains("aarch64")) {
                score += 30;
            }
            score
        }
        "macos" => {
            if !name.ends_with(".dmg") && !name.ends_with(".zip") {
                return 0;
            }
            let mut score = if name.ends_with(".dmg") { 80 } else { 45 };
            if is_arm && (name.contains("arm64") || name.contains("aarch64")) {
                score += 35;
            }
            if is_x64 && (name.contains("x64") || name.contains("x86_64") || name.contains("amd64"))
            {
                score += 35;
            }
            score
        }
        "linux" => {
            if !name.ends_with(".appimage") && !name.ends_with(".deb") {
                return 0;
            }
            let mut score = if name.ends_with(".appimage") { 80 } else { 55 };
            if is_x64 && (name.contains("x64") || name.contains("x86_64") || name.contains("amd64"))
            {
                score += 30;
            }
            if is_arm && (name.contains("arm64") || name.contains("aarch64")) {
                score += 30;
            }
            score
        }
        _ => 0,
    }
}

fn select_release_asset(assets: &[serde_json::Value]) -> Option<serde_json::Value> {
    assets
        .iter()
        .filter(|asset| {
            asset
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                != ""
        })
        .map(|asset| (release_asset_score(asset), asset))
        .filter(|(score, _)| *score > 0)
        .max_by(|(left_score, left), (right_score, right)| {
            left_score.cmp(right_score).then_with(|| {
                right
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .cmp(
                        left.get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or(""),
                    )
            })
        })
        .map(|(_, asset)| asset.clone())
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
    let history_store: Arc<Mutex<Vec<CompanionState>>> =
        Arc::new(Mutex::new(vec![store.blocking_read().clone()]));

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
            history: history_store.clone(),
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
                    let data = app_handle.state::<AppData>();
                    if let Ok(mut history) = data.history.lock() {
                        history.push(state.clone());
                        while history.len() > 50 {
                            history.remove(0);
                        }
                    }
                    if should_reveal_for_state(&current_ui_settings(&data), &state) {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            show_companion_window(&win);
                        }
                    }
                    let _ = app_handle.emit("companion:state", state);
                }
            });

            // Build minimal tray menu
            let show_item =
                MenuItem::with_id(app, "show_companion", "Show Companion", true, None::<&str>)?;
            let hide_item =
                MenuItem::with_id(app, "hide_companion", "Hide Companion", true, None::<&str>)?;
            let panel_item =
                MenuItem::with_id(app, "open_panel", "Open Quick Panel", true, None::<&str>)?;
            let manager_item =
                MenuItem::with_id(app, "open_manager", "Open Manager", true, None::<&str>)?;
            let bubble_item = MenuItem::with_id(
                app,
                "toggle_bubble",
                "Toggle Progress Bubble",
                true,
                None::<&str>,
            )?;
            let hud_item =
                MenuItem::with_id(app, "toggle_hud", "Toggle Status Panel", true, None::<&str>)?;
            let diagnostics_item =
                MenuItem::with_id(app, "diagnostics", "Diagnostics", true, None::<&str>)?;
            let config_item = MenuItem::with_id(
                app,
                "open_config_dir",
                "Open Config Folder",
                true,
                None::<&str>,
            )?;
            let api_item =
                MenuItem::with_id(app, "open_local_api", "Open Local API", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let state_idle = MenuItem::with_id(app, "state_idle", "Idle", true, None::<&str>)?;
            let state_working =
                MenuItem::with_id(app, "state_working", "Working", true, None::<&str>)?;
            let state_reviewing =
                MenuItem::with_id(app, "state_reviewing", "Reviewing", true, None::<&str>)?;
            let state_running_left = MenuItem::with_id(
                app,
                "state_running_left",
                "Running Left",
                true,
                None::<&str>,
            )?;
            let state_running_right = MenuItem::with_id(
                app,
                "state_running_right",
                "Running Right",
                true,
                None::<&str>,
            )?;
            let state_success =
                MenuItem::with_id(app, "state_success", "Success", true, None::<&str>)?;
            let state_failed =
                MenuItem::with_id(app, "state_failed", "Failed", true, None::<&str>)?;
            let state_waiting =
                MenuItem::with_id(app, "state_waiting", "Waiting", true, None::<&str>)?;
            let state_sleeping =
                MenuItem::with_id(app, "state_sleeping", "Sleeping", true, None::<&str>)?;
            let state_reminder =
                MenuItem::with_id(app, "state_reminder", "Reminder", true, None::<&str>)?;
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
                    "open_manager" => open_manager_from_tray(app),
                    "toggle_bubble" => {
                        let data = app.state::<AppData>();
                        let visible = current_ui_settings(&data).bubble_visible;
                        let _ = update_ui_settings(
                            app,
                            UiSettingsPatch {
                                bubble_visible: Some(!visible),
                                ..Default::default()
                            },
                        );
                    }
                    "toggle_hud" => {
                        let data = app.state::<AppData>();
                        let visible = current_ui_settings(&data).hud_visible;
                        let _ = update_ui_settings(
                            app,
                            UiSettingsPatch {
                                hud_visible: Some(!visible),
                                ..Default::default()
                            },
                        );
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
                    "diagnostics" => open_manager_from_tray(app),
                    "open_config_dir" => open_config_dir(app),
                    "open_local_api" => open_local_api(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                            if let Some(panel) = app.get_webview_window("panel") {
                                if panel.is_visible().unwrap_or(false) {
                                    let _ = panel.hide();
                                    return;
                                }
                                let panel_size = panel
                                    .outer_size()
                                    .unwrap_or(tauri::PhysicalSize::new(320, 480));

                                // Try to calculate position slightly offset from the tray icon.
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
                                    y = rect_y + rect_h + 10;
                                }

                                let _ = panel.set_position(tauri::PhysicalPosition::new(x, y));
                                let _ = panel.unminimize();
                                let _ = panel.show();
                                let _ = panel.set_focus();
                            }
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            button_state: MouseButtonState::Down,
                            ..
                        } => hide_panel_window_inner(app),
                        _ => {}
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
            list_reminders_cmd,
            delete_reminder_cmd,
            set_ui_settings,
            emit_scale_event,
            import_model,
            save_settings,
            get_diagnostics,
            export_logs,
            get_installed_models,
            get_history,
            get_current_model,
            set_active_model,
            check_updates,
            open_url,
            set_auto_launch,
            remove_model,
            open_folder,
            start_drag,
            set_mouse_passthrough,
            reveal_window,
            open_manager_window,
            hide_panel_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_spine_asset_file_names_for_urls() {
        assert_eq!(
            url_encode_path_segment("build_char_1001_amiya2_sale#16.skel"),
            "build_char_1001_amiya2_sale%2316.skel"
        );
    }

    #[test]
    fn derives_jsdelivr_fallback_from_github_raw_url() {
        let raw = "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.skel";
        assert_eq!(
            github_raw_to_jsdelivr_url(raw).as_deref(),
            Some("https://cdn.jsdelivr.net/gh/isHarryh/Ark-Models@main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.skel")
        );
    }

    #[test]
    fn download_candidates_keep_primary_then_explicit_then_derived_fallback() {
        let file = serde_json::json!({
            "name": "amiya.skel",
            "url": "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/amiya.skel",
            "fallbackUrls": [
                "https://example.test/amiya.skel",
                "https://example.test/amiya.skel"
            ]
        });
        let urls = download_url_candidates(&file).unwrap();
        assert_eq!(
            urls,
            vec![
                "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/amiya.skel",
                "https://example.test/amiya.skel",
                "https://cdn.jsdelivr.net/gh/isHarryh/Ark-Models@main/models/amiya.skel"
            ]
        );
    }

    #[test]
    fn verifies_written_local_model_config() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("spine-companion-config-test-{}", suffix));
        let config_path = root.join("companion.local.json");
        let asset_dir = root.join("models").join("ark-1001-amiya2-sale-16");
        std::fs::create_dir_all(&asset_dir).unwrap();
        write_local_model_config(&config_path, &asset_dir, "amiya.skel").unwrap();
        verify_local_model_config(&config_path, &asset_dir, "amiya.skel").unwrap();
        let public = read_json_if_exists(&config_path).unwrap();
        let expected_asset_dir = asset_dir.to_string_lossy().to_string();
        assert_eq!(
            public
                .get("spine")
                .and_then(|spine| spine.get("assetDir"))
                .and_then(|value| value.as_str()),
            Some(expected_asset_dir.as_str())
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn defaults_new_local_config_to_user_config_dir() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("spine-companion-root-test-{}", suffix));
        let user_config = root.join("user-config");
        let old = std::env::var("SPINE_COMPANION_CONFIG_DIR").ok();
        std::env::set_var("SPINE_COMPANION_CONFIG_DIR", &user_config);
        assert_eq!(
            default_local_config_path(&root),
            user_config.join("companion.local.json")
        );
        match old {
            Some(value) => std::env::set_var("SPINE_COMPANION_CONFIG_DIR", value),
            None => std::env::remove_var("SPINE_COMPANION_CONFIG_DIR"),
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn recovers_first_valid_downloaded_catalog_model() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("spine-companion-recovery-test-{}", suffix));
        let invalid_dir = root.join("models").join("invalid-model");
        let valid_dir = root.join("models").join("valid-model");
        std::fs::create_dir_all(&invalid_dir).unwrap();
        std::fs::create_dir_all(&valid_dir).unwrap();
        std::fs::write(valid_dir.join("valid.skel"), b"").unwrap();
        std::fs::write(valid_dir.join("valid.png"), b"").unwrap();
        std::fs::write(valid_dir.join("valid.atlas"), "valid.png\nsize: 1,1\n").unwrap();
        let config = serde_json::json!({
            "models": {
                "catalog": [
                    { "id": "invalid-model", "skel": "invalid.skel" },
                    { "id": "valid-model", "skel": "valid.skel" }
                ]
            }
        });
        let recovered = first_recoverable_model(&root, &config).unwrap();
        assert_eq!(recovered.skel, "valid.skel");
        assert_eq!(recovered.asset_dir, valid_dir.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn compares_semver_like_versions() {
        assert_eq!(compare_versions("0.2.2", "0.2.1"), 1);
        assert_eq!(compare_versions("v0.2.1", "0.2.1"), 0);
        assert_eq!(compare_versions("0.1.9", "0.2.0"), -1);
        assert_eq!(compare_versions("0.2.3-alpha.2", "0.2.3-alpha.1"), 1);
        assert_eq!(compare_versions("0.2.3-alpha.1", "0.2.2"), 1);
        assert_eq!(compare_versions("0.2.3", "0.2.3-alpha.2"), 1);
    }

    #[test]
    fn selects_latest_release_from_prerelease_payload() {
        let payload = serde_json::json!([
            { "tag_name": "v0.2.2", "draft": false },
            { "tag_name": "v0.2.3-alpha.2", "draft": false },
            { "tag_name": "v0.2.3-alpha.1", "draft": false }
        ]);
        let latest = latest_release_from_payload(&payload).unwrap();
        assert_eq!(
            latest.get("tag_name").and_then(|value| value.as_str()),
            Some("v0.2.3-alpha.2")
        );
    }
}
