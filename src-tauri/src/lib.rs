mod ai_integrations;
mod avatar;
mod catalog;
mod mcp;
mod server;
mod source_registry;
mod state;

use sha1::Sha1;
use sha2::{Digest, Sha256};
use state::{
    create_reminder, create_reminder_broadcast, create_reminder_store, create_state_store,
    delete_reminder, list_reminders, set_state, CompanionState, CreateReminderInput, Reminder,
    ReminderBroadcast, ReminderStore, SetStateInput, StateBroadcast, StateStore,
};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_notification::NotificationExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};

struct AppData {
    store: StateStore,
    tx: StateBroadcast,
    reminders: ReminderStore,
    reminder_tx: ReminderBroadcast,
    public_config: Arc<Mutex<serde_json::Value>>,
    ui_settings: Arc<Mutex<UiSettings>>,
    config_dir: PathBuf,
    local_config_path: PathBuf,
    asset_root: server::AssetRootStore,
    history: Arc<Mutex<Vec<CompanionState>>>,
    drag_state: Arc<Mutex<Option<DragState>>>,
    passthrough_enabled: Arc<AtomicBool>,
    pointer_bounds: Arc<Mutex<Option<PointerBounds>>>,
    panel_pinned: Arc<AtomicBool>,
    panel_interaction_locked: Arc<AtomicBool>,
    renderer_health: Arc<Mutex<RendererHealth>>,
    ai_integration_lock: Arc<Mutex<()>>,
    model_trial_previous: Arc<Mutex<Option<CurrentModel>>>,
}

#[derive(Clone, Debug)]
struct DragState {
    start_x: f64,
    start_y: f64,
    window_x: i32,
    window_y: i32,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererHealth {
    status: String,
    last_reason: String,
    recovery_count: u64,
    last_recovery_at: u64,
    last_heartbeat_at: u64,
}

impl Default for RendererHealth {
    fn default() -> Self {
        Self {
            status: "starting".to_string(),
            last_reason: String::new(),
            recovery_count: 0,
            last_recovery_at: 0,
            last_heartbeat_at: 0,
        }
    }
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
    update_channel: String,
    max_device_pixel_ratio: f64,
    hitbox_padding: f64,
    gpu_mode: String,
    debug_hitbox: bool,
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
    update_channel: Option<String>,
    max_device_pixel_ratio: Option<f64>,
    hitbox_padding: Option<f64>,
    gpu_mode: Option<String>,
    debug_hitbox: Option<bool>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScalePayload {
    delta: Option<f64>,
    action: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DragPoint {
    screen_x: f64,
    screen_y: f64,
    total_x: Option<f64>,
    total_y: Option<f64>,
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PointerBounds {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

#[cfg(target_os = "windows")]
fn cursor_position_physical() -> Option<(f64, f64)> {
    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok == 0 {
        None
    } else {
        Some((point.x as f64, point.y as f64))
    }
}

#[cfg(target_os = "windows")]
fn cursor_inside_pointer_bounds(
    window: &WebviewWindow,
    bounds: &PointerBounds,
    logical_padding: f64,
) -> bool {
    let Some((cursor_x, cursor_y)) = cursor_position_physical() else {
        return false;
    };
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0).clamp(0.5, 4.0);
    let padding = logical_padding * scale_factor;
    let left = position.x as f64 + bounds.left * scale_factor - padding;
    let right = position.x as f64 + bounds.right * scale_factor + padding;
    let top = position.y as f64 + bounds.top * scale_factor - padding;
    let bottom = position.y as f64 + bounds.bottom * scale_factor + padding;
    cursor_x >= left && cursor_x <= right && cursor_y >= top && cursor_y <= bottom
}

#[cfg(target_os = "windows")]
fn start_pointer_passthrough_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut outside_since: Option<Instant> = None;
        let mut last_ignore_state: Option<bool> = None;
        loop {
            tokio::time::sleep(Duration::from_millis(16)).await;
            let data = app.state::<AppData>();
            let enabled = data.passthrough_enabled.load(Ordering::Relaxed);
            let bounds = data.pointer_bounds.lock().ok().and_then(|value| *value);
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };

            let cursor_inside = enabled
                && bounds
                    .as_ref()
                    .map(|bounds| cursor_inside_pointer_bounds(&window, bounds, 18.0))
                    .unwrap_or(false);
            let ignore = if !enabled || cursor_inside {
                outside_since = None;
                false
            } else {
                let started = outside_since.get_or_insert_with(Instant::now);
                last_ignore_state.unwrap_or(false) || started.elapsed() >= Duration::from_millis(80)
            };

            if last_ignore_state != Some(ignore) {
                let _ = window.set_ignore_cursor_events(ignore);
                last_ignore_state = Some(ignore);
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn start_pointer_passthrough_monitor(_app: AppHandle) {}

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
            "theme": "system",
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
            "updateChannel": "auto",
            "maxDevicePixelRatio": 2,
            "hitboxPadding": 8,
            "gpuMode": "hardware",
            "debugHitbox": false
        },
        "models": {
            "sources": [
                {
                    "id": "ark-models",
                    "label": "Operators / 基建小人",
                    "catalogUrl": "https://raw.githubusercontent.com/cb8010d6/spine-companion/main/catalog/catalog.json",
                    "kind": "official",
                    "enabled": true
                },
                {
                    "id": "ark-illustrations",
                    "label": "Dynamic illustrations / 动态立绘",
                    "catalogUrl": "https://raw.githubusercontent.com/cb8010d6/spine-companion/main/catalog/illustrations.json",
                    "kind": "official",
                    "enabled": true
                },
                {
                    "id": "ark-enemies",
                    "label": "Enemies / 敌人",
                    "catalogUrl": "https://raw.githubusercontent.com/cb8010d6/spine-companion/main/catalog/enemies.json",
                    "kind": "official",
                    "enabled": true
                }
            ],
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
            "successLoop": { "from": 9.2, "to": 14.433, "loop": true, "mixDurationMs": 420 },
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

pub(crate) fn user_config_dir() -> Option<PathBuf> {
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

fn validate_spine_asset_dir(asset_dir: &Path, skel: &str) -> Result<(), String> {
    avatar::spine_assets::validate_spine_asset_dir(asset_dir, skel).map(|_| ())
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
    let gpu_mode = string_at(config, &["ui", "gpuMode"])
        .unwrap_or("hardware")
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
        update_channel: normalize_update_channel(
            string_at(config, &["ui", "updateChannel"]).unwrap_or("auto"),
        ),
        max_device_pixel_ratio: f64_at(config, &["ui", "maxDevicePixelRatio"], 2.0).clamp(1.0, 3.0),
        hitbox_padding: f64_at(config, &["ui", "hitboxPadding"], 8.0).clamp(0.0, 48.0),
        gpu_mode: normalize_gpu_mode(&gpu_mode),
        debug_hitbox: bool_at(config, &["ui", "debugHitbox"], false),
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

fn normalize_gpu_mode(value: &str) -> String {
    if value == "software" {
        "software".to_string()
    } else {
        "hardware".to_string()
    }
}

fn normalize_update_channel(value: &str) -> String {
    match value {
        "stable" | "prerelease" => value.to_string(),
        _ => "auto".to_string(),
    }
}

fn resolved_update_channel(configured: &str, current_version: &str) -> &'static str {
    match configured {
        "stable" => "stable",
        "prerelease" => "prerelease",
        _ if is_prerelease_version(current_version) => "prerelease",
        _ => "stable",
    }
}

#[cfg(target_os = "windows")]
fn configure_webview_gpu_mode(settings: &UiSettings) {
    if settings.gpu_mode != "software" {
        return;
    }
    let flag = "--disable-gpu";
    let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    if existing.split_whitespace().any(|arg| arg == flag) {
        return;
    }
    let next = if existing.trim().is_empty() {
        flag.to_string()
    } else {
        format!("{} {}", existing.trim(), flag)
    };
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", next);
    eprintln!("Spine Companion: WebView2 GPU acceleration disabled by user setting.");
}

#[cfg(not(target_os = "windows"))]
fn configure_webview_gpu_mode(_settings: &UiSettings) {}

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
    if let Some(value) = patch.update_channel {
        settings.update_channel = normalize_update_channel(&value);
    }
    if let Some(value) = patch.max_device_pixel_ratio {
        settings.max_device_pixel_ratio = value.clamp(1.0, 3.0);
    }
    if let Some(value) = patch.hitbox_padding {
        settings.hitbox_padding = value.clamp(0.0, 48.0);
    }
    if let Some(value) = patch.gpu_mode {
        settings.gpu_mode = normalize_gpu_mode(&value);
    }
    if let Some(value) = patch.debug_hitbox {
        settings.debug_hitbox = value;
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
        if !public.get("ui").is_some_and(serde_json::Value::is_object) {
            public["ui"] = serde_json::json!({});
        }
        merge_json(&mut public["ui"], value);
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

fn first_recoverable_model(
    config_dir: &Path,
    config: &serde_json::Value,
) -> Option<RecoveredModel> {
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
    ensure_official_model_sources(&mut config);
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
                    verify_local_model_config(
                        &local_config_path,
                        &recovered.asset_dir,
                        &recovered.skel,
                    )
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
    Ok(create_reminder(
        &data.store,
        &data.tx,
        &data.reminders,
        &data.reminder_tx,
        input,
    )
    .await)
}

#[tauri::command]
async fn list_reminders_cmd(data: State<'_, AppData>) -> Result<Vec<Reminder>, String> {
    Ok(list_reminders(&data.reminders).await)
}

#[tauri::command]
async fn delete_reminder_cmd(
    data: State<'_, AppData>,
    id: String,
) -> Result<serde_json::Value, String> {
    let deleted = delete_reminder(&data.reminders, &data.reminder_tx, &id).await;
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
        if let Some(expected) = file.get("sha256").and_then(|value| value.as_str()).filter(|value| !value.is_empty()) {
            let actual = format!("{:x}", Sha256::digest(&bytes));
            if !actual.eq_ignore_ascii_case(expected) {
                let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                return Err(format!(
                    "Integrity check failed for {file_name}: expected {expected}, got {actual}"
                ));
            }
        } else if let Some(expected) = file.get("githubBlobSha").and_then(|value| value.as_str()) {
            verify_git_blob_sha(&bytes, expected).map_err(|error| {
                let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                format!("Integrity check failed for {file_name}: {error}")
            })?;
        }
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
    replace_model_dir(&temp_model_dir, &model_dir)
        .await
        .map_err(|error| {
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
    write_local_model_config(&data.local_config_path, &canonical_model_dir, &skel).map_err(
        |error| {
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
        },
    )?;
    verify_local_model_config(&data.local_config_path, &canonical_model_dir, &skel).map_err(
        |error| {
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
        },
    )?;
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

#[tauri::command]
async fn import_catalog_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    entry: catalog::CatalogModelEntry,
) -> Result<ImportModelResult, String> {
    entry.model.validate()?;
    let id = entry.model.id.clone();
    let mut value = serde_json::to_value(&entry.model).map_err(|error| error.to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "catalogSourceId".to_string(),
            serde_json::Value::String(entry.catalog_source_id),
        );
        object.insert(
            "spineVersion".to_string(),
            serde_json::Value::String(entry.model.spine.min.0.clone()),
        );
    }
    {
        let mut public = data
            .public_config
            .lock()
            .map_err(|_| "Config lock is poisoned".to_string())?;
        let catalog = public
            .get_mut("models")
            .and_then(|models| models.get_mut("catalog"))
            .and_then(|catalog| catalog.as_array_mut())
            .ok_or_else(|| "Model catalog config is unavailable".to_string())?;
        catalog
            .retain(|model| model.get("id").and_then(|value| value.as_str()) != Some(id.as_str()));
        catalog.push(value.clone());
    }
    let result = import_model(app, data, ImportModelInput { id }).await?;
    std::fs::write(
        PathBuf::from(&result.asset_dir).join(".companion-model.json"),
        serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Model installed but metadata could not be saved: {error}"))?;
    Ok(result)
}

#[tauri::command]
async fn prepare_model_preview(
    window: WebviewWindow,
    data: State<'_, AppData>,
    entry: catalog::CatalogModelEntry,
) -> Result<serde_json::Value, String> {
    require_manager_window(&window)?;
    entry.model.validate()?;
    let id = entry.model.id.clone();
    let skel = entry.model.skel.clone();
    let preview_root = data.config_dir.join("preview-assets");
    let preview_dir = preview_root.join(&id);
    let temp_dir = preview_root.join(format!("{}.preview-download", &id));
    let signature = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&entry.model).map_err(|error| error.to_string())?)
    );
    let signature_path = preview_dir.join(".catalog-signature");
    let cache_valid = std::fs::read_to_string(&signature_path)
        .map(|value| value == signature)
        .unwrap_or(false)
        && validate_spine_asset_dir(&preview_dir, &skel).is_ok();

    if !cache_valid {
        tokio::fs::create_dir_all(&preview_root)
            .await
            .map_err(|error| error.to_string())?;
        remove_dir_if_exists(&temp_dir).await?;
        tokio::fs::create_dir_all(&temp_dir)
            .await
            .map_err(|error| error.to_string())?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| error.to_string())?;
        let value = serde_json::to_value(&entry.model).map_err(|error| error.to_string())?;
        let files = value
            .get("files")
            .and_then(|files| files.as_array())
            .ok_or_else(|| "Model preview entry is missing files".to_string())?;
        for file in files {
            let file_name = file
                .get("name")
                .and_then(|name| name.as_str())
                .ok_or_else(|| "Model preview file is missing name".to_string())?;
            let bytes = download_model_file(&client, file_name, &download_url_candidates(file)?)
                .await
                .map_err(|error| {
                    let _ = remove_dir_if_exists_blocking(&temp_dir);
                    format!("Failed to prepare preview: {error}")
                })?;
            if let Some(expected) = file.get("sha256").and_then(|hash| hash.as_str()).filter(|value| !value.is_empty()) {
                let actual = format!("{:x}", Sha256::digest(&bytes));
                if !actual.eq_ignore_ascii_case(expected) {
                    let _ = remove_dir_if_exists_blocking(&temp_dir);
                    return Err(format!("Preview integrity check failed for {file_name}"));
                }
            } else if let Some(expected) = file.get("githubBlobSha").and_then(|hash| hash.as_str()) {
                verify_git_blob_sha(&bytes, expected).map_err(|error| {
                    let _ = remove_dir_if_exists_blocking(&temp_dir);
                    format!("Preview integrity check failed for {file_name}: {error}")
                })?;
            }
            tokio::fs::write(temp_dir.join(file_name), bytes)
                .await
                .map_err(|error| error.to_string())?;
        }
        validate_spine_asset_dir(&temp_dir, &skel).map_err(|error| {
            let _ = remove_dir_if_exists_blocking(&temp_dir);
            error
        })?;
        tokio::fs::write(temp_dir.join(".catalog-signature"), &signature)
            .await
            .map_err(|error| error.to_string())?;
        replace_model_dir(&temp_dir, &preview_dir).await?;
    }
    tokio::fs::write(&signature_path, &signature)
        .await
        .map_err(|error| error.to_string())?;
    prune_preview_asset_cache(&preview_root, &id, 48);

    let origin = public_config_with_ui(&data)
        .get("server")
        .and_then(|server| server.get("origin"))
        .and_then(|origin| origin.as_str())
        .unwrap_or("http://127.0.0.1:17388")
        .to_string();
    Ok(serde_json::json!({
        "id": id,
        "skel": skel,
        "assetUrl": format!(
            "{}/assets/previews/{}/{}",
            origin,
            url_encode_path_segment(&entry.model.id),
            url_encode_path_segment(&entry.model.skel)
        ),
        "cached": cache_valid
    }))
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
        for retry in 0..2 {
            match client.get(url).send().await {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        attempts.push(format!("{} (HTTP {})", url, status.as_u16()));
                        if !status.is_server_error() {
                            break;
                        }
                    } else {
                        match response.bytes().await {
                            Ok(bytes) => return Ok(bytes.to_vec()),
                            Err(error) => attempts.push(format!("{} ({})", url, error)),
                        }
                    }
                }
                Err(error) => attempts.push(format!("{} ({})", url, error)),
            }
            if retry == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
        }
    }
    Err(format!("{}; tried {}", file_name, attempts.join("; ")))
}

fn verify_git_blob_sha(bytes: &[u8], expected: &str) -> Result<(), String> {
    let mut digest = Sha1::new();
    digest.update(format!("blob {}\0", bytes.len()).as_bytes());
    digest.update(bytes);
    let actual = format!("{:x}", digest.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("expected {expected}, got {actual}"))
    }
}

fn ensure_official_model_sources(config: &mut serde_json::Value) {
    let defaults = fallback_config();
    let Some(default_sources) = defaults
        .get("models")
        .and_then(|models| models.get("sources"))
        .and_then(|sources| sources.as_array())
    else {
        return;
    };
    let Some(sources) = config
        .get_mut("models")
        .and_then(|models| models.get_mut("sources"))
        .and_then(|sources| sources.as_array_mut())
    else {
        return;
    };
    for source in default_sources {
        let id = source.get("id").and_then(|value| value.as_str());
        if !sources.iter().any(|current| current.get("id").and_then(|value| value.as_str()) == id) {
            sources.push(source.clone());
        }
    }
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

fn prune_preview_asset_cache(root: &Path, keep_id: &str, max_entries: usize) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut cached = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !file_type.is_dir() || name.ends_with(".preview-download") {
                return None;
            }
            let modified = entry
                .path()
                .join(".catalog-signature")
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH);
            Some((name, entry.path(), modified))
        })
        .collect::<Vec<_>>();
    cached.sort_by(|left, right| right.2.cmp(&left.2));
    let mut retained_others = 0usize;
    for (name, path, _) in cached {
        if name == keep_id {
            continue;
        }
        if retained_others < max_entries.saturating_sub(1) {
            retained_others += 1;
            continue;
        }
        let _ = std::fs::remove_dir_all(path);
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
        return Err(format!(
            "Failed to activate downloaded model directory: {}",
            error
        ));
    }
    remove_dir_if_exists(&backup_dir).await?;
    Ok(())
}

fn verify_local_model_config(
    path: &Path,
    expected_asset_dir: &Path,
    expected_skel: &str,
) -> Result<(), String> {
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
        return Err(format!(
            "spine.skel is {}, expected {}",
            skel, expected_skel
        ));
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
    refresh_tray_menu(&app);
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

    let ai_integrations = ai_integrations::list_ai_integrations();
    let mcp_matches = ai_integrations
        .iter()
        .filter(|item| item.config_found || item.configured)
        .map(|item| {
            serde_json::json!({
                "tool": item.name,
                "path": item.config_path,
                "exists": item.config_found,
                "configured": item.configured,
                "source": item.source,
                "sourceLabel": item.source_label,
                "status": item.status
            })
        })
        .collect::<Vec<_>>();
    let mcp_configured = ai_integrations.iter().any(|item| item.configured);
    let ui = current_ui_settings(&data);
    let gpu_mode = ui.gpu_mode.clone();
    let gpu_effective = if cfg!(target_os = "windows") {
        gpu_mode.clone()
    } else {
        "platform-default".to_string()
    };
    let gpu_message = if cfg!(target_os = "windows") && gpu_mode == "software" {
        "WebView2 starts with --disable-gpu after app restart."
    } else if cfg!(target_os = "windows") {
        "WebView2 uses hardware acceleration."
    } else {
        "GPU mode is only applied on Windows WebView2."
    };
    let renderer_health = data.renderer_health.lock().unwrap().clone();
    let models_cache_dir = data.config_dir.join("models");
    let preview_cache_dir = data.config_dir.join("preview-assets");
    let _ = std::fs::create_dir_all(&models_cache_dir);
    let _ = std::fs::create_dir_all(&preview_cache_dir);
    let cache_stats = |root: &Path| {
        let mut files = 0_u64;
        let mut bytes = 0_u64;
        let mut pending = vec![root.to_path_buf()];
        while let Some(dir) = pending.pop() {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if metadata.is_dir() {
                    pending.push(path);
                } else if metadata.is_file() {
                    files += 1;
                    bytes = bytes.saturating_add(metadata.len());
                }
            }
        }
        serde_json::json!({ "files": files, "bytes": bytes })
    };
    let webview_cache_dir = data
        .config_dir
        .parent()
        .map(|_| {
            std::env::var("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| data.config_dir.clone())
                .join("dev.spine-companion.desktop")
                .join("EBWebView")
        })
        .unwrap_or_else(|| data.config_dir.join("EBWebView"));

    Ok(serde_json::json!({
        "apiOk": state_ok,
        "localConfigExists": local_config_exists,
        "assetDirExists": asset_dir_exists,
        "hasSkel": has_skel,
        "hasAtlas": has_atlas,
        "hasPng": has_png,
        "modelHealth": model_health,
        "modelRecovery": recovery,
        "cache": {
            "modelsDir": models_cache_dir.to_string_lossy().to_string(),
            "models": cache_stats(&models_cache_dir),
            "previewsDir": preview_cache_dir.to_string_lossy().to_string(),
            "previews": cache_stats(&preview_cache_dir)
        },
        "logsDir": data.config_dir.join("logs").to_string_lossy().to_string(),
        "shortcut": {
            "enabled": ui.shortcut_enabled,
            "registered": false,
            "accelerator": ui.shortcut_accelerator,
            "error": "Global shortcuts are not implemented in the Tauri runtime yet."
        },
        "gpu": {
            "mode": gpu_mode,
            "effective": gpu_effective,
            "requiresRestart": true,
            "message": gpu_message,
            "renderer": renderer_health,
            "webviewCacheDir": webview_cache_dir.to_string_lossy().to_string(),
            "tdrNote": "If Windows reports LiveKernelEvent 141 or display driver reset, restart the renderer or clear WebView GPU cache."
        },
        "runtime": {
            "name": "tauri",
            "experimental": true
        },
        "mcpConfigured": mcp_configured,
        "mcpMatches": mcp_matches,
        "aiIntegrations": ai_integrations
    }))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledModel {
    id: String,
    dir: String,
    name: String,
    source: String,
    version: String,
    license: String,
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
                    let metadata =
                        std::fs::read_to_string(entry.path().join(".companion-model.json"))
                            .ok()
                            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                            .unwrap_or(serde_json::Value::Null);
                    models.push(InstalledModel {
                        name: metadata
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or(&id)
                            .to_string(),
                        source: metadata
                            .get("source")
                            .and_then(|value| value.as_str())
                            .unwrap_or("Local")
                            .to_string(),
                        version: metadata
                            .get("spine")
                            .and_then(|value| value.get("min"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        license: metadata
                            .get("license")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        id,
                        dir,
                    });
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
    let asset_dir = string_at(&public, &["spine", "assetDir"])
        .unwrap_or("")
        .to_string();
    let model = model_by_skel(&public, &skel).or_else(|| {
        std::fs::read_to_string(PathBuf::from(&asset_dir).join(".companion-model.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    });
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
        asset_dir,
        source: model
            .as_ref()
            .and_then(|m| m.get("source").and_then(|v| v.as_str()))
            .unwrap_or("Local")
            .to_string(),
    })
}

async fn activate_installed_model(
    app: &tauri::AppHandle,
    data: &AppData,
    id: &str,
) -> Result<ImportModelResult, String> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid model ID".to_string());
    }
    let public = public_config_with_ui(&data);
    let model_dir = data.config_dir.join("models").join(id);
    let model = model_by_id(&public, id).or_else(|| {
        std::fs::read_to_string(model_dir.join(".companion-model.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    });
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
        id: id.to_string(),
        name: model
            .as_ref()
            .and_then(|m| m.get("name").and_then(|v| v.as_str()))
            .unwrap_or(id)
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
async fn set_active_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    id: String,
) -> Result<ImportModelResult, String> {
    activate_installed_model(&app, &data, &id).await
}

#[tauri::command]
async fn begin_model_trial(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    id: String,
) -> Result<ImportModelResult, String> {
    let current = get_current_model(data.clone())?;
    {
        let mut previous = data
            .model_trial_previous
            .lock()
            .map_err(|_| "Model trial lock is poisoned".to_string())?;
        if previous.is_some() {
            return Err("Finish the current model trial before starting another one.".to_string());
        }
        *previous = Some(current);
    }
    match activate_installed_model(&app, &data, &id).await {
        Ok(result) => Ok(result),
        Err(error) => {
            if let Ok(mut previous) = data.model_trial_previous.lock() {
                *previous = None;
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn confirm_model_trial(data: State<'_, AppData>) -> Result<(), String> {
    let mut previous = data
        .model_trial_previous
        .lock()
        .map_err(|_| "Model trial lock is poisoned".to_string())?;
    *previous = None;
    Ok(())
}

#[tauri::command]
async fn cancel_model_trial(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
) -> Result<Option<ImportModelResult>, String> {
    let previous = data
        .model_trial_previous
        .lock()
        .map_err(|_| "Model trial lock is poisoned".to_string())?
        .take();
    match previous {
        Some(model) if !model.id.is_empty() => activate_installed_model(&app, &data, &model.id)
            .await
            .map(Some),
        Some(model) => {
            let asset_dir = PathBuf::from(&model.asset_dir);
            if !model.asset_dir.is_empty() || !model.skel.is_empty() {
                validate_spine_asset_dir(&asset_dir, &model.skel)?;
            }
            write_local_model_config(&data.local_config_path, &asset_dir, &model.skel)?;
            if let Ok(mut public) = data.public_config.lock() {
                merge_json(
                    &mut public,
                    serde_json::json!({"spine": {"assetDir": model.asset_dir.clone(), "assetDirConfigured": !model.asset_dir.is_empty(), "skel": model.skel.clone()}}),
                );
            }
            {
                let mut asset_root = data.asset_root.write().await;
                *asset_root = if asset_dir.as_os_str().is_empty() {
                    None
                } else {
                    Some(asset_dir.canonicalize().unwrap_or(asset_dir))
                };
            }
            let _ = app.emit("companion:config-changed", public_config_with_ui(&data));
            Ok(None)
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn check_updates(data: State<'_, AppData>) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let current_version = env!("CARGO_PKG_VERSION");
    let configured_channel = current_ui_settings(&data).update_channel;
    let channel = resolved_update_channel(&configured_channel, current_version);
    let endpoint = if channel == "prerelease" {
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
    let response = latest_release_from_payload(&payload, channel == "prerelease")
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
        "channel": channel,
        "configuredChannel": configured_channel,
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
        for file in files
            .into_iter()
            .rev()
            .take(7)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
        {
            body.push_str(&format!(
                "===== {} =====\n",
                file.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("log")
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
async fn export_diagnostics_report(data: State<'_, AppData>) -> Result<serde_json::Value, String> {
    let diagnostics = get_diagnostics(data.clone()).await?;
    let history = get_history(data.clone())?;
    let reminders = list_reminders_cmd(data.clone()).await?;
    let output_dir = data.config_dir.join("logs");
    std::fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let output = output_dir.join(format!(
        "spine-companion-diagnostics-{}.json",
        chrono::Utc::now().to_rfc3339().replace([':', '.'], "-")
    ));
    let report = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "diagnostics": diagnostics,
        "history": history,
        "reminders": reminders,
    });
    let text = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    std::fs::write(&output, &text).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "file": output.to_string_lossy().to_string(),
        "report": report,
        "text": text
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
fn list_ai_integrations(
    data: State<'_, AppData>,
) -> Result<Vec<ai_integrations::AiIntegration>, String> {
    let _guard = data
        .ai_integration_lock
        .lock()
        .map_err(|_| "AI integration state lock is poisoned".to_string())?;
    ai_integrations::list_ai_integrations_with_state(&data.config_dir)
}

fn require_manager_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "manager" {
        Ok(())
    } else {
        Err("This operation is only available from the Manager window.".to_string())
    }
}

#[tauri::command]
fn preview_ai_integration_config(
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<ai_integrations::IntegrationPreview, String> {
    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(&data);
    ai_integrations::preview_ai_integration_config(&tool_id, &exe, &api)
}

#[tauri::command]
fn configure_ai_integration(
    window: WebviewWindow,
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<ai_integrations::IntegrationApplyResult, String> {
    require_manager_window(&window)?;
    let _guard = data
        .ai_integration_lock
        .lock()
        .map_err(|_| "AI integration state lock is poisoned".to_string())?;
    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(&data);
    ai_integrations::configure_ai_integration_managed(&data.config_dir, &tool_id, &exe, &api)
}

#[tauri::command]
fn open_ai_integration_config(
    window: WebviewWindow,
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<(), String> {
    require_manager_window(&window)?;
    let _guard = data
        .ai_integration_lock
        .lock()
        .map_err(|_| "AI integration state lock is poisoned".to_string())?;
    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(&data);
    let preview = ai_integrations::preview_ai_integration_config(&tool_id, &exe, &api)?;
    if preview.target_path.trim().is_empty() {
        return Err("This integration only provides copyable templates.".to_string());
    }
    let path = PathBuf::from(preview.target_path);
    let target = if path.exists() {
        path
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "No parent folder for integration config".to_string())?
    };
    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    }
    open_external(&target.to_string_lossy()).map_err(|error| error.to_string())
}

#[tauri::command]
fn copy_ai_integration_template(
    data: State<'_, AppData>,
    tool_id: Option<String>,
) -> Result<String, String> {
    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(&data);
    if let Some(id) = tool_id {
        return ai_integrations::preview_ai_integration_config(&id, &exe, &api)
            .map(|preview| preview.preview);
    }
    Ok(ai_integrations::templates_for_custom(&exe, &api))
}

#[tauri::command]
fn copy_custom_ai_integration_template(
    data: State<'_, AppData>,
    input: ai_integrations::CustomIntegrationInput,
) -> Result<String, String> {
    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(&data);
    Ok(ai_integrations::templates_for_custom_input(
        &exe, &api, input,
    ))
}

#[tauri::command]
fn generate_ai_integration_instructions(
    tool_id: String,
) -> Result<ai_integrations::AgentInstructions, String> {
    ai_integrations::generate_agent_instructions(&tool_id)
}

#[tauri::command]
fn install_ai_integration_instructions(
    window: WebviewWindow,
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<ai_integrations::AgentInstructionInstallResult, String> {
    require_manager_window(&window)?;
    let _guard = data
        .ai_integration_lock
        .lock()
        .map_err(|_| "AI integration state lock is poisoned".to_string())?;
    let result = ai_integrations::install_agent_instructions(&tool_id)?;
    ai_integrations::record_instruction_change(
        &data.config_dir,
        &tool_id,
        result.created || result.updated,
    )?;
    Ok(result)
}

#[tauri::command]
fn acknowledge_ai_integration_restart(
    window: WebviewWindow,
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<(), String> {
    require_manager_window(&window)?;
    let _guard = data
        .ai_integration_lock
        .lock()
        .map_err(|_| "AI integration state lock is poisoned".to_string())?;
    ai_integrations::acknowledge_restart(&data.config_dir, &tool_id)
}

#[tauri::command]
fn restore_ai_integration_backup(
    window: WebviewWindow,
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<ai_integrations::IntegrationRestoreResult, String> {
    require_manager_window(&window)?;
    let _guard = data
        .ai_integration_lock
        .lock()
        .map_err(|_| "AI integration state lock is poisoned".to_string())?;
    ai_integrations::restore_ai_integration(&data.config_dir, &tool_id)
}

#[tauri::command]
fn avatar_requirements() -> Result<serde_json::Value, String> {
    Ok(avatar::requirements())
}

#[tauri::command]
fn list_avatar_packs(
    window: WebviewWindow,
    data: State<'_, AppData>,
) -> Result<Vec<serde_json::Value>, String> {
    require_manager_window(&window)?;
    avatar::load_registry(&data.config_dir)
}

#[tauri::command]
fn load_avatar_manifest(
    window: WebviewWindow,
    input: avatar::AvatarPackInput,
) -> Result<avatar::AvatarPackManifest, String> {
    require_manager_window(&window)?;
    avatar::load_manifest(&avatar::path_from_input(input))
}

#[tauri::command]
fn save_avatar_manifest(
    window: WebviewWindow,
    input: avatar::AvatarPackInput,
    manifest: avatar::AvatarPackManifest,
) -> Result<avatar::AvatarValidation, String> {
    require_manager_window(&window)?;
    avatar::save_manifest(&avatar::path_from_input(input), manifest)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarAssetBytes {
    bytes: Vec<u8>,
    mime: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvatarLayerImportInput {
    pack_path: String,
    files: Vec<String>,
}

#[tauri::command]
fn import_avatar_layers(
    window: WebviewWindow,
    input: AvatarLayerImportInput,
) -> Result<Vec<String>, String> {
    require_manager_window(&window)?;
    let root = PathBuf::from(&input.pack_path)
        .canonicalize()
        .map_err(|error| format!("Cannot open avatar pack: {error}"))?;
    let layers = root.join("layers");
    std::fs::create_dir_all(&layers).map_err(|error| error.to_string())?;
    let mut imported = Vec::new();
    for source in input.files {
        let source = PathBuf::from(source)
            .canonicalize()
            .map_err(|error| format!("Cannot read layer: {error}"))?;
        if !source.is_file() {
            return Err("Avatar layer must be an image file.".to_string());
        }
        let ext = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
            return Err("Avatar layers support PNG, JPEG, or WebP files.".to_string());
        }
        let base = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("layer")
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let mut name = format!("{base}.{ext}");
        let mut index = 2;
        while layers.join(&name).exists() {
            name = format!("{base}_{index}.{ext}");
            index += 1;
        }
        std::fs::copy(&source, layers.join(&name)).map_err(|error| error.to_string())?;
        imported.push(format!("layers/{name}"));
    }
    Ok(imported)
}

#[tauri::command]
fn read_avatar_asset(
    window: WebviewWindow,
    input: avatar::AvatarPackInput,
    relative_path: String,
) -> Result<AvatarAssetBytes, String> {
    require_manager_window(&window)?;
    let root = avatar::path_from_input(input)
        .canonicalize()
        .map_err(|error| format!("Cannot open avatar pack: {error}"))?;
    let relative = avatar::spine_assets::safe_relative_path(&relative_path)?;
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("Cannot read avatar asset: {error}"))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("Avatar asset must stay inside the pack directory.".to_string());
    }
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return Err("Avatar preview only supports PNG, JPEG, or WebP layers.".to_string()),
    };
    Ok(AvatarAssetBytes {
        bytes: std::fs::read(path).map_err(|error| error.to_string())?,
        mime: mime.to_string(),
    })
}

#[tauri::command]
fn create_avatar_pack(
    window: WebviewWindow,
    input: avatar::AvatarPackCreateInput,
) -> Result<avatar::AvatarPackLifecycleResult, String> {
    require_manager_window(&window)?;
    avatar::create_standard_pack(input)
}

#[tauri::command]
fn duplicate_avatar_pack(
    window: WebviewWindow,
    input: avatar::AvatarPackDuplicateInput,
) -> Result<avatar::AvatarPackLifecycleResult, String> {
    require_manager_window(&window)?;
    avatar::duplicate_pack(input)
}

#[tauri::command]
fn delete_avatar_pack(
    window: WebviewWindow,
    input: avatar::AvatarPackInput,
) -> Result<avatar::AvatarPackLifecycleResult, String> {
    require_manager_window(&window)?;
    avatar::delete_pack(&avatar::path_from_input(input))
}

#[tauri::command]
fn repack_avatar_pack(
    window: WebviewWindow,
    input: avatar::AvatarPackInput,
) -> Result<avatar::AvatarPackLifecycleResult, String> {
    require_manager_window(&window)?;
    avatar::repack_pack(&avatar::path_from_input(input))
}

#[tauri::command]
async fn refresh_model_catalogs(
    window: WebviewWindow,
    data: State<'_, AppData>,
    sources: Vec<catalog::CatalogSource>,
) -> Result<catalog::CatalogRefreshResult, String> {
    require_manager_window(&window)?;
    let cache_path = data.config_dir.join("catalog-cache.json");
    let mut cache = std::fs::read_to_string(&cache_path)
        .ok()
        .and_then(|text| serde_json::from_str::<catalog::CatalogCache>(&text).ok())
        .unwrap_or_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let result = catalog::refresh_catalogs(&client, &sources, &mut cache).await;
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
        &cache_path,
        serde_json::to_vec_pretty(&cache).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
fn search_model_catalog(
    window: WebviewWindow,
    models: Vec<catalog::CatalogModelEntry>,
    request: catalog::CatalogSearchRequest,
) -> Result<catalog::CatalogSearchResult, String> {
    require_manager_window(&window)?;
    Ok(catalog::search_catalog(&models, &request))
}

#[tauri::command]
fn validate_avatar_pack(
    input: avatar::AvatarPackInput,
) -> Result<avatar::AvatarValidation, String> {
    Ok(avatar::validate_pack(&avatar::path_from_input(input)))
}

#[tauri::command]
async fn import_avatar_pack(
    data: State<'_, AppData>,
    input: avatar::AvatarPackInput,
) -> Result<serde_json::Value, String> {
    let path = avatar::path_from_input(input);
    let validation = avatar::validate_pack(&path);
    if !validation.ok {
        return Err(format!(
            "Avatar pack is invalid: {}",
            validation.errors.join("; ")
        ));
    }
    if !validation.runtime_ready {
        let result = avatar::register_pack(&path, &data.config_dir)?;
        return Ok(serde_json::json!({
            "imported": result.imported,
            "installed": false,
            "activated": false,
            "validation": result.validation,
            "registryPath": result.registry_path
        }));
    }
    let installed = avatar::install_runtime_pack(&path, &data.config_dir)?;
    let model_id = installed.validation.id.clone();
    Ok(serde_json::json!({
        "imported": true,
        "installed": installed.installed,
        "activated": false,
        "validation": installed.validation,
        "registryPath": installed.registry_path,
        "runtimePath": installed.runtime_path,
        "modelId": model_id
    }))
}

#[tauri::command]
async fn test_ai_integration(
    window: WebviewWindow,
    data: State<'_, AppData>,
    tool_id: String,
) -> Result<serde_json::Value, String> {
    require_manager_window(&window)?;
    let revision = {
        let _guard = data
            .ai_integration_lock
            .lock()
            .map_err(|_| "AI integration state lock is poisoned".to_string())?;
        ai_integrations::integration_revision(&data.config_dir, &tool_id)?
    };
    let result = test_ai_integration_inner(&data, &tool_id).await;
    let persisted = {
        let _guard = data
            .ai_integration_lock
            .lock()
            .map_err(|_| "AI integration state lock is poisoned".to_string())?;
        ai_integrations::record_test_result_if_revision(
            &data.config_dir,
            &tool_id,
            revision,
            &result,
        )
    };
    match (result, persisted) {
        (Ok(value), Ok(_)) => Ok(value),
        (Ok(_), Err(error)) => Err(format!(
            "Connection test passed, but its result could not be saved: {error}"
        )),
        (Err(error), _) => Err(error),
    }
}

async fn test_ai_integration_inner(
    data: &AppData,
    tool_id: &str,
) -> Result<serde_json::Value, String> {
    use tokio::io::AsyncBufReadExt;

    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(data);
    let preview = ai_integrations::preview_ai_integration_config(&tool_id, &exe, &api)?;
    let mut child = tokio::process::Command::new(&exe)
        .arg("--mcp")
        .env("COMPANION_API", &api)
        .env("COMPANION_SOURCE", preview.integration.source.clone())
        .env(
            "COMPANION_SOURCE_LABEL",
            preview.integration.source_label.clone(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start MCP server: {error}"))?;

    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("MCP stdin unavailable".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("MCP stdout unavailable".to_string());
        }
    };
    let source_label = preview.integration.source_label.clone();
    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "clientInfo": { "name": preview.integration.name, "version": env!("CARGO_PKG_VERSION") }
        }
    });
    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    let list_tools = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });
    let report_phase = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "companion_report_ai_phase",
            "arguments": {
                "phase": "thinking",
                "message": format!("Connection test from {source_label}"),
                "autoReturnMs": 2200
            }
        }
    });

    let probe_result = async {
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        let timeout = Duration::from_secs(5);

        write_mcp_probe_request(&mut stdin, &initialize).await?;
        let init = read_mcp_probe_response(&mut lines, 1, "initialize", timeout).await?;
        if init.get("error").is_some() {
            return Err("The local AI connection rejected initialization.".to_string());
        }

        write_mcp_probe_request(&mut stdin, &initialized).await?;
        write_mcp_probe_request(&mut stdin, &list_tools).await?;
        let tools = read_mcp_probe_response(&mut lines, 2, "tools/list", timeout).await?;

        write_mcp_probe_request(&mut stdin, &report_phase).await?;
        let phase = read_mcp_probe_response(&mut lines, 3, "phase report", timeout).await?;
        drop(stdin);
        Ok::<_, String>((init, tools, phase))
    }
    .await;

    let _ = child.kill().await;
    let _ = child.wait().await;
    let (init, tools, phase) = probe_result?;
    let tool_count = tools
        .get("result")
        .and_then(|result| result.get("tools"))
        .and_then(|tools| tools.as_array())
        .map(|tools| tools.len())
        .unwrap_or(0);
    if init.get("error").is_some() || tools.get("error").is_some() || tool_count == 0 {
        return Err(
            "The local AI connection started but did not expose companion tools.".to_string(),
        );
    }
    if phase.get("error").is_some() {
        return Err(
            "The local AI connection started but could not send a live work update.".to_string(),
        );
    }
    Ok(serde_json::json!({
        "ok": true,
        "toolId": tool_id,
        "toolCount": tool_count,
        "source": preview.integration.source,
        "sourceLabel": preview.integration.source_label,
        "command": preview.command,
        "phaseReported": true
    }))
}

async fn read_mcp_probe_response<R>(
    lines: &mut tokio::io::Lines<R>,
    expected_id: i64,
    label: &str,
    timeout: Duration,
) -> Result<serde_json::Value, String>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!("MCP {label} response timed out"));
        }
        let line = tokio::time::timeout(remaining, lines.next_line())
            .await
            .map_err(|_| format!("MCP {label} response timed out"))?
            .map_err(|error| format!("Failed to read MCP {label} response: {error}"))?
            .ok_or_else(|| format!("MCP server did not return {label} response"))?;
        let response = serde_json::from_str::<serde_json::Value>(&line)
            .map_err(|error| format!("Invalid MCP {label} response: {error}"))?;
        if response.get("id").and_then(|value| value.as_i64()) == Some(expected_id) {
            return Ok(response);
        }
    }
}

async fn write_mcp_probe_request<W>(
    stdin: &mut W,
    request: &serde_json::Value,
) -> Result<(), String>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::AsyncWriteExt;

    stdin
        .write_all(format!("{request}\n").as_bytes())
        .await
        .map_err(|error| format!("Failed to write MCP request: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Failed to flush MCP request: {error}"))
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
async fn start_drag(
    window: tauri::Window,
    data: State<'_, AppData>,
    point: DragPoint,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    *data.drag_state.lock().unwrap() = Some(DragState {
        start_x: point.screen_x,
        start_y: point.screen_y,
        window_x: position.x,
        window_y: position.y,
    });
    Ok(())
}

#[tauri::command]
async fn move_drag(
    window: tauri::Window,
    data: State<'_, AppData>,
    point: DragPoint,
) -> Result<(), String> {
    let drag_state = data.drag_state.lock().unwrap().clone();
    if let Some(drag) = drag_state {
        let dx = point
            .total_x
            .or_else(|| Some(point.screen_x - drag.start_x))
            .unwrap_or(point.screen_x - drag.start_x)
            .round() as i32;
        let dy = point
            .total_y
            .or_else(|| Some(point.screen_y - drag.start_y))
            .unwrap_or(point.screen_y - drag.start_y)
            .round() as i32;
        window
            .set_position(tauri::PhysicalPosition::new(
                drag.window_x + dx,
                drag.window_y + dy,
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn end_drag(data: State<'_, AppData>) -> Result<(), String> {
    *data.drag_state.lock().unwrap() = None;
    Ok(())
}

#[derive(serde::Serialize)]
struct WindowPosition {
    x: i32,
    y: i32,
}

#[tauri::command]
fn get_window_position(window: tauri::Window) -> Result<WindowPosition, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok(WindowPosition {
        x: position.x,
        y: position.y,
    })
}

#[tauri::command]
async fn set_mouse_passthrough(
    window: WebviewWindow,
    data: State<'_, AppData>,
    enabled: bool,
    bounds: Option<PointerBounds>,
) -> Result<(), String> {
    data.passthrough_enabled.store(enabled, Ordering::Relaxed);
    if let Ok(mut current) = data.pointer_bounds.lock() {
        *current = bounds;
    }
    #[cfg(not(target_os = "windows"))]
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())?;
    if !enabled {
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_pointer_bounds(
    data: State<'_, AppData>,
    bounds: Option<PointerBounds>,
) -> Result<(), String> {
    let mut current = data
        .pointer_bounds
        .lock()
        .map_err(|_| "Pointer bounds lock is poisoned".to_string())?;
    *current = bounds;
    Ok(())
}

#[tauri::command]
fn set_panel_pinned(data: State<'_, AppData>, pinned: bool) -> Result<bool, String> {
    data.panel_pinned.store(pinned, Ordering::Relaxed);
    Ok(pinned)
}

#[tauri::command]
fn set_panel_interaction_lock(data: State<'_, AppData>, locked: bool) -> Result<(), String> {
    data.panel_interaction_locked
        .store(locked, Ordering::Relaxed);
    Ok(())
}

fn show_companion_window(win: &WebviewWindow) {
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

fn restore_companion_window_surface(win: &WebviewWindow) {
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_always_on_top(true);
}

fn create_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Spine Companion")
        .inner_size(360.0, 460.0)
        .min_inner_size(260.0, 320.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(false)
        .visible(false)
        .shadow(false)
        .build()
        .map_err(|error| error.to_string())
}

fn recreate_main_window(app: &AppHandle, reason: &str) -> Result<(), String> {
    let mut previous_position = None;
    let mut previous_size = None;
    let mut was_visible = true;
    if let Some(win) = app.get_webview_window("main") {
        previous_position = win.outer_position().ok();
        previous_size = win.outer_size().ok();
        was_visible = win.is_visible().unwrap_or(true);
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.close();
        std::thread::sleep(std::time::Duration::from_millis(140));
    }
    let win = create_main_window(app)?;
    if let Some(size) = previous_size {
        let _ = win.set_size(size);
    }
    if let Some(position) = previous_position {
        let _ = win.set_position(position);
    }
    if was_visible {
        show_companion_window(&win);
    }
    let data = app.state::<AppData>();
    let mut health = data.renderer_health.lock().unwrap();
    health.status = "recreated".to_string();
    health.last_reason = reason.to_string();
    health.recovery_count = health.recovery_count.saturating_add(1);
    health.last_recovery_at = now_ms();
    Ok(())
}

fn start_renderer_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let now = now_ms();
            let stale = {
                let data = app.state::<AppData>();
                let health = data.renderer_health.lock().unwrap();
                renderer_heartbeat_stale(&health, now)
            };
            if stale {
                let _ = recreate_main_window(&app, "native-heartbeat-timeout");
            }
        }
    });
}

fn renderer_heartbeat_stale(health: &RendererHealth, now: u64) -> bool {
    !matches!(health.status.as_str(), "starting" | "suspended" | "resuming")
        && health.last_heartbeat_at > 0
        && now.saturating_sub(health.last_heartbeat_at) > 8_000
        && now.saturating_sub(health.last_recovery_at) > 15_000
}

fn should_reveal_for_state(settings: &UiSettings, state: &CompanionState) -> bool {
    settings.auto_reveal_on_mcp && is_ai_source(&state.source) && state.state != "idle"
}

fn is_ai_source(source: &str) -> bool {
    source_registry::is_ai_source(source)
}

fn source_display_name(source: &str) -> String {
    source_registry::source_display_name(source, None)
}

fn should_notify_state(state: &CompanionState) -> bool {
    if state.state == "reminder" {
        return true;
    }
    if state.state != "success" && state.state != "failed" {
        return false;
    }
    state.notify == Some(true) || is_ai_source(&state.source)
}

fn notification_for_state(state: &CompanionState) -> Option<(String, String)> {
    match state.state.as_str() {
        "reminder" => Some((
            "Spine Companion Reminder".to_string(),
            if state.message.is_empty() {
                "Reminder".to_string()
            } else {
                state.message.clone()
            },
        )),
        "success" => Some((
            format!("{} task complete", source_display_name(&state.source)),
            if state.message.is_empty() {
                "Finished successfully".to_string()
            } else {
                state.message.clone()
            },
        )),
        "failed" => Some((
            format!("{} task failed", source_display_name(&state.source)),
            if state.message.is_empty() {
                "Needs attention".to_string()
            } else {
                state.message.clone()
            },
        )),
        _ => None,
    }
}

fn maybe_show_system_notification(app: &AppHandle, settings: &UiSettings, state: &CompanionState) {
    if !settings.system_notifications || !should_notify_state(state) {
        return;
    }
    let Some((title, body)) = notification_for_state(state) else {
        return;
    };
    let _ = app.emit(
        "companion:notification",
        serde_json::json!({
            "title": title,
            "body": body,
            "state": state.state,
            "source": state.source,
        }),
    );
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        eprintln!("Failed to show system notification: {}", error);
    }
}

#[tauri::command]
async fn reveal_window(window: WebviewWindow) -> Result<(), String> {
    show_companion_window(&window);
    Ok(())
}

#[tauri::command]
async fn recover_gpu_window(
    window: WebviewWindow,
    data: State<'_, AppData>,
    reason: String,
) -> Result<(), String> {
    eprintln!("Recovering companion GPU/window surface: {}", reason);
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.hide();
    tokio::time::sleep(Duration::from_millis(90)).await;
    restore_companion_window_surface(&window);
    let mut health = data.renderer_health.lock().unwrap();
    health.status = "recovered".to_string();
    health.last_reason = reason;
    health.recovery_count = health.recovery_count.saturating_add(1);
    health.last_recovery_at = now_ms();
    Ok(())
}

#[tauri::command]
async fn restart_renderer(app: tauri::AppHandle, reason: String) -> Result<(), String> {
    recreate_main_window(&app, &reason)
}

#[tauri::command]
fn get_renderer_health(data: State<'_, AppData>) -> Result<RendererHealth, String> {
    Ok(data.renderer_health.lock().unwrap().clone())
}

#[tauri::command]
fn update_renderer_health(data: State<'_, AppData>, input: RendererHealth) -> Result<(), String> {
    *data.renderer_health.lock().unwrap() = input;
    Ok(())
}

#[tauri::command]
fn clear_webview_gpu_cache(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut removed = 0u64;
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let webview_root = app_dir.join("EBWebView");
    let names = [
        "GPUCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "GrShaderCache",
        "ShaderCache",
    ];
    if webview_root.exists() {
        for name in names {
            for dir in find_cache_dirs(&webview_root, name) {
                if std::fs::remove_dir_all(&dir).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    Ok(serde_json::json!({
        "removed": removed,
        "path": webview_root.to_string_lossy()
    }))
}

fn find_cache_dirs(root: &Path, name: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()) == Some(name) {
            found.push(path);
        } else {
            found.extend(find_cache_dirs(&path, name));
        }
    }
    found
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

fn toggle_panel_near_tray(app: &AppHandle, rect: tauri::Rect) {
    let Some(panel) = app.get_webview_window("panel") else {
        return;
    };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    let panel_size = panel
        .outer_size()
        .unwrap_or(tauri::PhysicalSize::new(320, 480));
    let (rect_x, rect_y) = match rect.position {
        tauri::Position::Physical(position) => (position.x, position.y),
        tauri::Position::Logical(position) => (position.x as i32, position.y as i32),
    };
    let rect_height = match rect.size {
        tauri::Size::Physical(size) => size.height as i32,
        tauri::Size::Logical(size) => size.height as i32,
    };
    let x = rect_x - (panel_size.width as i32) / 2;
    let mut y = rect_y - (panel_size.height as i32) - 10;
    if y < 0 {
        y = rect_y + rect_height + 10;
    }
    let _ = panel.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = panel.unminimize();
    let _ = panel.show();
    let _ = panel.set_focus();
}

fn tray_uses_chinese(app: &AppHandle) -> bool {
    let configured = app
        .state::<AppData>()
        .public_config
        .lock()
        .ok()
        .and_then(|config| {
            config
                .get("ui")
                .and_then(|ui| ui.get("locale"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "auto".to_string());
    if configured.starts_with("zh") {
        return true;
    }
    if configured != "auto" {
        return false;
    }
    sys_locale::get_locale()
        .map(|locale| locale.to_ascii_lowercase().starts_with("zh"))
        .unwrap_or(false)
}

fn tray_label(app: &AppHandle, key: &str) -> &'static str {
    let zh = tray_uses_chinese(app);
    match (zh, key) {
        (true, "show") => "显示桌宠",
        (true, "hide") => "隐藏桌宠",
        (true, "panel") => "打开快捷面板",
        (true, "manager") => "打开管理器",
        (true, "bubble") => "切换任务气泡",
        (true, "notifications") => "暂停/恢复通知",
        (true, "advanced") => "高级与调试",
        (true, "diagnostics") => "诊断",
        (true, "restart") => "重启渲染器",
        (true, "gpu") => "清理 GPU 缓存",
        (true, "config") => "打开配置目录",
        (true, "api") => "打开本地 API",
        (true, "state") => "调试状态",
        (true, "quit") => "退出",
        (false, "show") => "Show Companion",
        (false, "hide") => "Hide Companion",
        (false, "panel") => "Open Quick Panel",
        (false, "manager") => "Open Manager",
        (false, "bubble") => "Toggle Progress Bubble",
        (false, "notifications") => "Pause / Resume Notifications",
        (false, "advanced") => "Advanced / Debug",
        (false, "diagnostics") => "Diagnostics",
        (false, "restart") => "Restart Renderer",
        (false, "gpu") => "Clear GPU Cache",
        (false, "config") => "Open Config Folder",
        (false, "api") => "Open Local API",
        (false, "state") => "Debug State",
        (false, "quit") => "Quit",
        _ => "Spine Companion",
    }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(
        app,
        "show_companion",
        tray_label(app, "show"),
        true,
        None::<&str>,
    )?;
    let hide = MenuItem::with_id(
        app,
        "hide_companion",
        tray_label(app, "hide"),
        true,
        None::<&str>,
    )?;
    let panel = MenuItem::with_id(
        app,
        "open_panel",
        tray_label(app, "panel"),
        true,
        None::<&str>,
    )?;
    let manager = MenuItem::with_id(
        app,
        "open_manager",
        tray_label(app, "manager"),
        true,
        None::<&str>,
    )?;
    let bubble = MenuItem::with_id(
        app,
        "toggle_bubble",
        tray_label(app, "bubble"),
        true,
        None::<&str>,
    )?;
    let notifications = MenuItem::with_id(
        app,
        "toggle_notifications",
        tray_label(app, "notifications"),
        true,
        None::<&str>,
    )?;
    let diagnostics = MenuItem::with_id(
        app,
        "diagnostics",
        tray_label(app, "diagnostics"),
        true,
        None::<&str>,
    )?;
    let restart = MenuItem::with_id(
        app,
        "restart_renderer",
        tray_label(app, "restart"),
        true,
        None::<&str>,
    )?;
    let gpu = MenuItem::with_id(
        app,
        "clear_gpu_cache",
        tray_label(app, "gpu"),
        true,
        None::<&str>,
    )?;
    let config = MenuItem::with_id(
        app,
        "open_config_dir",
        tray_label(app, "config"),
        true,
        None::<&str>,
    )?;
    let api = MenuItem::with_id(
        app,
        "open_local_api",
        tray_label(app, "api"),
        true,
        None::<&str>,
    )?;
    let state_idle = MenuItem::with_id(app, "state_idle", "Idle", true, None::<&str>)?;
    let state_working = MenuItem::with_id(app, "state_working", "Working", true, None::<&str>)?;
    let state_reviewing =
        MenuItem::with_id(app, "state_reviewing", "Reviewing", true, None::<&str>)?;
    let state_success = MenuItem::with_id(app, "state_success", "Success", true, None::<&str>)?;
    let state_failed = MenuItem::with_id(app, "state_failed", "Failed", true, None::<&str>)?;
    let state_menu = Submenu::with_items(
        app,
        tray_label(app, "state"),
        true,
        &[
            &state_idle,
            &state_working,
            &state_reviewing,
            &state_success,
            &state_failed,
        ],
    )?;
    let advanced = Submenu::with_items(
        app,
        tray_label(app, "advanced"),
        true,
        &[&diagnostics, &restart, &gpu, &config, &api, &state_menu],
    )?;
    let quit = MenuItem::with_id(app, "quit", tray_label(app, "quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &panel,
            &manager,
            &sep1,
            &bubble,
            &notifications,
            &sep2,
            &advanced,
            &sep3,
            &quit,
        ],
    )
}

fn refresh_tray_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    match build_tray_menu(app) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(error) => eprintln!("Failed to rebuild tray menu: {}", error),
    }
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

fn latest_release_from_payload(
    payload: &serde_json::Value,
    include_prereleases: bool,
) -> Option<serde_json::Value> {
    if let Some(releases) = payload.as_array() {
        return releases
            .iter()
            .filter(|release| {
                let is_draft = release
                    .get("draft")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                let is_prerelease = release
                    .get("prerelease")
                    .and_then(|value| value.as_bool())
                    .unwrap_or_else(|| {
                        release
                            .get("tag_name")
                            .and_then(|value| value.as_str())
                            .is_some_and(is_prerelease_version)
                    });
                !is_draft && (include_prereleases || !is_prerelease)
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
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!("tmp-{}-{suffix}", std::process::id()));
    let backup = path.with_extension(format!("previous-{}-{suffix}", std::process::id()));
    std::fs::write(&temporary, format!("{}\n", text)).map_err(|error| error.to_string())?;
    let had_previous = path.exists();
    if had_previous {
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(path, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        if had_previous {
            let _ = std::fs::rename(&backup, path);
        }
        let _ = std::fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    let _ = std::fs::remove_file(&backup);
    Ok(())
}

fn current_mcp_exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| error.to_string())
}

fn companion_api_origin_from_data(data: &AppData) -> String {
    let public = public_config_with_ui(data);
    public
        .get("server")
        .and_then(|server| server.get("origin"))
        .and_then(|origin| origin.as_str())
        .unwrap_or("http://127.0.0.1:17388")
        .to_string()
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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::args().any(|arg| arg == "--mcp") {
        if let Err(error) = mcp::run_stdio() {
            eprintln!("Spine Companion MCP server failed: {}", error);
            std::process::exit(1);
        }
        return;
    }

    let runtime_config = load_runtime_config();
    configure_webview_gpu_mode(&runtime_config.ui_settings);
    let (store, tx) = create_state_store(&runtime_config.initial_state);
    let reminders = create_reminder_store();
    let reminder_tx = create_reminder_broadcast();
    let store_for_server = store.clone();
    let tx_for_server = tx.clone();
    let reminders_for_server = reminders.clone();
    let reminder_tx_for_server = reminder_tx.clone();
    let host_for_server = runtime_config.host.clone();
    let port_for_server = runtime_config.port;
    let asset_root_store: server::AssetRootStore = Arc::new(tokio::sync::RwLock::new(
        runtime_config
            .asset_root
            .clone()
            .and_then(|path| path.canonicalize().ok()),
    ));
    let asset_root_for_server = asset_root_store.clone();
    let preview_root_for_server = runtime_config.config_dir.join("preview-assets");
    let history_store: Arc<Mutex<Vec<CompanionState>>> =
        Arc::new(Mutex::new(vec![store.blocking_read().clone()]));
    let public_config_store = Arc::new(Mutex::new(runtime_config.public.clone()));
    let public_config_for_server = public_config_store.clone();
    let history_for_server = history_store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                show_companion_window(&win);
            }
        }))
        .manage(AppData {
            store: store.clone(),
            tx: tx.clone(),
            reminders: reminders.clone(),
            reminder_tx: reminder_tx.clone(),
            public_config: public_config_store.clone(),
            ui_settings: Arc::new(Mutex::new(runtime_config.ui_settings.clone())),
            config_dir: runtime_config.config_dir.clone(),
            local_config_path: runtime_config.local_config_path.clone(),
            asset_root: asset_root_store.clone(),
            history: history_store.clone(),
            drag_state: Arc::new(Mutex::new(None)),
            passthrough_enabled: Arc::new(AtomicBool::new(false)),
            pointer_bounds: Arc::new(Mutex::new(None)),
            panel_pinned: Arc::new(AtomicBool::new(false)),
            panel_interaction_locked: Arc::new(AtomicBool::new(false)),
            renderer_health: Arc::new(Mutex::new(RendererHealth::default())),
            ai_integration_lock: Arc::new(Mutex::new(())),
            model_trial_previous: Arc::new(Mutex::new(None)),
        })
        .setup(move |app| {
            start_pointer_passthrough_monitor(app.handle().clone());
            start_renderer_watchdog(app.handle().clone());
            if let Some(panel) = app.get_webview_window("panel") {
                let panel_for_event = panel.clone();
                panel.on_window_event(move |event| {
                    if !matches!(event, tauri::WindowEvent::Focused(false)) {
                        return;
                    }
                    let panel = panel_for_event.clone();
                    let app = panel.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(160)).await;
                        let data = app.state::<AppData>();
                        if data.panel_pinned.load(Ordering::Relaxed)
                            || data.panel_interaction_locked.load(Ordering::Relaxed)
                            || panel.is_focused().unwrap_or(false)
                        {
                            return;
                        }
                        let _ = panel.hide();
                    });
                });
            }
            // Bind the local API server before the hidden window is revealed.
            // The renderer loads Spine assets from this server on startup, so
            // racing the first PIXI load against server startup can leave the
            // transparent window visible with no model.
            if let Err(e) = tauri::async_runtime::block_on(server::start_api_server(
                store_for_server,
                tx_for_server,
                reminders_for_server,
                reminder_tx_for_server,
                asset_root_for_server,
                preview_root_for_server,
                public_config_for_server,
                history_for_server,
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
                    let settings = current_ui_settings(&data);
                    maybe_show_system_notification(&app_handle, &settings, &state);
                    let _ = app_handle.emit("companion:state", state);
                }
            });
            let app_handle = app.handle().clone();
            let mut reminder_rx = reminder_tx.subscribe();
            tauri::async_runtime::spawn(async move {
                while let Ok(reminders) = reminder_rx.recv().await {
                    let _ = app_handle.emit("companion:reminders", reminders);
                }
            });

            if std::env::var("SPINE_COMPANION_OPEN_MANAGER").as_deref() == Ok("1") {
                let _ = show_manager_window(app.handle());
            }

            let menu = build_tray_menu(app.handle())?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray");
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon).icon_as_template(true);
            }
            tray_builder
                .tooltip("Spine Companion")
                .menu(&menu)
                .show_menu_on_left_click(false)
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
                    "toggle_notifications" => {
                        let data = app.state::<AppData>();
                        let enabled = current_ui_settings(&data).system_notifications;
                        let _ = update_ui_settings(
                            app,
                            UiSettingsPatch {
                                system_notifications: Some(!enabled),
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
                    "restart_renderer" => {
                        if let Err(error) = recreate_main_window(app, "tray-restart-renderer") {
                            eprintln!("Failed to restart renderer from tray: {}", error);
                        }
                    }
                    "clear_gpu_cache" => {
                        if let Err(error) = clear_webview_gpu_cache(app.clone()) {
                            eprintln!("Failed to clear GPU cache from tray: {}", error);
                        }
                    }
                    "open_config_dir" => open_config_dir(app),
                    "open_local_api" => open_local_api(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event({
                    let click_generation = Arc::new(AtomicU64::new(0));
                    move |tray, event| {
                        let app = tray.app_handle();
                        match event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                rect,
                                ..
                            } => {
                                let generation =
                                    click_generation.fetch_add(1, Ordering::SeqCst) + 1;
                                let generation_ref = click_generation.clone();
                                let app = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    tokio::time::sleep(Duration::from_millis(220)).await;
                                    if generation_ref.load(Ordering::SeqCst) == generation {
                                        toggle_panel_near_tray(&app, rect);
                                    }
                                });
                            }
                            TrayIconEvent::DoubleClick {
                                button: MouseButton::Left,
                                ..
                            } => {
                                click_generation.fetch_add(1, Ordering::SeqCst);
                                hide_panel_window_inner(app);
                                open_manager_from_tray(app);
                            }
                            TrayIconEvent::Click {
                                button: MouseButton::Right,
                                button_state: MouseButtonState::Down,
                                ..
                            } => {
                                click_generation.fetch_add(1, Ordering::SeqCst);
                                hide_panel_window_inner(app);
                            }
                            _ => {}
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
            list_reminders_cmd,
            delete_reminder_cmd,
            set_ui_settings,
            emit_scale_event,
            import_model,
            import_catalog_model,
            prepare_model_preview,
            save_settings,
            get_diagnostics,
            export_logs,
            export_diagnostics_report,
            get_installed_models,
            get_history,
            get_current_model,
            set_active_model,
            begin_model_trial,
            confirm_model_trial,
            cancel_model_trial,
            check_updates,
            open_url,
            set_auto_launch,
            list_ai_integrations,
            preview_ai_integration_config,
            configure_ai_integration,
            open_ai_integration_config,
            copy_ai_integration_template,
            copy_custom_ai_integration_template,
            generate_ai_integration_instructions,
            install_ai_integration_instructions,
            acknowledge_ai_integration_restart,
            restore_ai_integration_backup,
            avatar_requirements,
            list_avatar_packs,
            load_avatar_manifest,
            save_avatar_manifest,
            read_avatar_asset,
            import_avatar_layers,
            create_avatar_pack,
            duplicate_avatar_pack,
            delete_avatar_pack,
            repack_avatar_pack,
            refresh_model_catalogs,
            search_model_catalog,
            validate_avatar_pack,
            import_avatar_pack,
            test_ai_integration,
            remove_model,
            open_folder,
            start_drag,
            move_drag,
            end_drag,
            get_window_position,
            set_mouse_passthrough,
            update_pointer_bounds,
            set_panel_pinned,
            set_panel_interaction_lock,
            reveal_window,
            recover_gpu_window,
            restart_renderer,
            clear_webview_gpu_cache,
            get_renderer_health,
            update_renderer_health,
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
    fn verifies_immutable_git_blob_digests() {
        assert!(verify_git_blob_sha(b"hello\n", "ce013625030ba8dba906f756967f9e9ca394464a").is_ok());
        assert!(verify_git_blob_sha(b"changed", "ce013625030ba8dba906f756967f9e9ca394464a").is_err());
    }

    #[test]
    fn adds_new_official_catalogs_without_removing_user_sources() {
        let mut config = serde_json::json!({
            "models": { "sources": [{
                "id": "custom",
                "label": "Custom",
                "catalogUrl": "https://example.com/catalog.json",
                "kind": "customCdn",
                "enabled": true
            }] }
        });
        ensure_official_model_sources(&mut config);
        let ids = config["models"]["sources"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|source| source["id"].as_str())
            .collect::<Vec<_>>();
        assert!(ids.contains(&"custom"));
        assert!(ids.contains(&"ark-models"));
        assert!(ids.contains(&"ark-illustrations"));
        assert!(ids.contains(&"ark-enemies"));
    }

    #[test]
    fn renderer_watchdog_requires_timeout_and_recovery_cooldown() {
        let mut health = RendererHealth {
            status: "ok".to_string(),
            last_heartbeat_at: 1_000,
            ..RendererHealth::default()
        };
        assert!(!renderer_heartbeat_stale(&health, 8_999));
        assert!(renderer_heartbeat_stale(&health, 20_000));
        health.last_recovery_at = 18_000;
        assert!(!renderer_heartbeat_stale(&health, 20_000));
        health.status = "suspended".to_string();
        health.last_recovery_at = 0;
        assert!(!renderer_heartbeat_stale(&health, 20_000));
    }

    #[tokio::test]
    async fn mcp_probe_response_has_a_deadline() {
        use tokio::io::AsyncBufReadExt;

        let (_writer, reader) = tokio::io::duplex(64);
        let mut lines = tokio::io::BufReader::new(reader).lines();
        let error = read_mcp_probe_response(&mut lines, 1, "test", Duration::from_millis(10))
            .await
            .unwrap_err();
        assert!(error.contains("timed out"));
    }

    #[tokio::test]
    async fn mcp_probe_matches_responses_by_json_rpc_id() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

        let (mut writer, reader) = tokio::io::duplex(256);
        writer
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n")
            .await
            .unwrap();
        let mut lines = tokio::io::BufReader::new(reader).lines();
        let response =
            read_mcp_probe_response(&mut lines, 2, "tools/list", Duration::from_millis(50))
                .await
                .unwrap();
        assert_eq!(response["id"], 2);
    }

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
    fn preview_cache_pruning_keeps_current_model_and_limits_completed_entries() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("spine-companion-preview-test-{}", suffix));
        for name in ["current", "older-a", "older-b", "pending.preview-download"] {
            std::fs::create_dir_all(root.join(name)).unwrap();
        }
        prune_preview_asset_cache(&root, "current", 2);
        let completed = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                !entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".preview-download")
            })
            .count();
        assert_eq!(completed, 2);
        assert!(root.join("current").exists());
        assert!(root.join("pending.preview-download").exists());
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
    fn gpu_mode_defaults_to_hardware_and_allows_software() {
        let defaults = ui_settings_from_config(&fallback_config());
        assert_eq!(defaults.gpu_mode, "hardware");

        let config = serde_json::json!({
            "ui": {
                "gpuMode": "software"
            }
        });
        assert_eq!(ui_settings_from_config(&config).gpu_mode, "software");

        let invalid = serde_json::json!({
            "ui": {
                "gpuMode": "auto"
            }
        });
        assert_eq!(ui_settings_from_config(&invalid).gpu_mode, "hardware");
    }

    #[test]
    fn selects_latest_release_from_prerelease_payload() {
        let payload = serde_json::json!([
            { "tag_name": "v0.2.2", "draft": false },
            { "tag_name": "v0.2.3-alpha.2", "draft": false },
            { "tag_name": "v0.2.3-alpha.1", "draft": false }
        ]);
        let latest = latest_release_from_payload(&payload, true).unwrap();
        assert_eq!(
            latest.get("tag_name").and_then(|value| value.as_str()),
            Some("v0.2.3-alpha.2")
        );
    }

    #[test]
    fn stable_update_channel_ignores_prereleases() {
        let payload = serde_json::json!([
            { "tag_name": "v0.2.5", "draft": false, "prerelease": false },
            { "tag_name": "v0.2.6-rc.1", "draft": false, "prerelease": true }
        ]);
        let latest = latest_release_from_payload(&payload, false).unwrap();
        assert_eq!(
            latest.get("tag_name").and_then(|value| value.as_str()),
            Some("v0.2.5")
        );
    }

    #[test]
    fn automatic_update_channel_matches_the_installed_version() {
        assert_eq!(resolved_update_channel("auto", "0.2.6-rc.1"), "prerelease");
        assert_eq!(resolved_update_channel("auto", "0.2.6"), "stable");
        assert_eq!(resolved_update_channel("stable", "0.2.6-rc.1"), "stable");
    }
}
