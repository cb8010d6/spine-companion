mod ai_integrations;
mod avatar;
mod catalog;
mod config;
mod mcp;
mod server;
mod source_registry;
mod state;

use config::{
    fallback_config, first_recoverable_model, load_runtime_config, merge_json,
    normalize_bubble_background, normalize_drag_mode, normalize_frame_rate_mode,
    normalize_gpu_mode, normalize_update_channel, read_json_if_exists, resolved_update_channel,
    string_at, ui_settings_from_config, user_config_dir, validate_spine_asset_dir,
    verify_local_model_config, write_local_model_config, UiSettings,
};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use state::{
    create_reminder, create_reminder_broadcast, create_reminder_store, create_state_store,
    delete_reminder, list_reminders, set_state, CompanionState, CreateReminderInput, Reminder,
    ReminderBroadcast, ReminderStore, SetStateInput, StateBroadcast, StateStore,
};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_notification::NotificationExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE, POINT},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        RemoteDesktop::ProcessIdToSessionId,
        Threading::GetCurrentProcessId,
    },
    UI::WindowsAndMessaging::GetCursorPos,
};

const MAX_MODEL_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MODEL_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const PARTIAL_DOWNLOAD_MARKER: &str = ".companion-partial-download";
const DOWNLOAD_ACTIVE: u8 = 0;
const DOWNLOAD_CANCELLED: u8 = 1;
const DOWNLOAD_COMMITTING: u8 = 2;
static NEXT_DOWNLOAD_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

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
    pointer_regions: Arc<Mutex<Vec<PointerBounds>>>,
    panel_pinned: Arc<AtomicBool>,
    panel_interaction_locked: Arc<AtomicBool>,
    renderer_health: Arc<Mutex<RendererHealth>>,
    catalog_cache: Arc<Mutex<catalog::CatalogCache>>,
    ai_integration_lock: Arc<Mutex<()>>,
    model_mutation_lock: tokio::sync::Mutex<()>,
    model_trial_previous: Arc<Mutex<Option<CurrentModel>>>,
    download_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicU8>>>>,
}

#[derive(Clone, Debug)]
struct DragState {
    start_x: f64,
    start_y: f64,
    window_x: i32,
    window_y: i32,
    scale_factor: f64,
}

fn physical_drag_delta(logical_delta: f64, scale_factor: f64) -> i32 {
    if !logical_delta.is_finite() {
        return 0;
    }
    let normalized_scale = if scale_factor.is_finite() {
        scale_factor.clamp(0.5, 4.0)
    } else {
        1.0
    };
    (logical_delta * normalized_scale)
        .round()
        .clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererHealth {
    status: String,
    last_reason: String,
    recovery_count: u64,
    last_recovery_at: u64,
    last_heartbeat_at: u64,
    #[serde(default)]
    ticker_started: bool,
    #[serde(default)]
    frame_counter: u64,
    #[serde(default)]
    animation_name: String,
    #[serde(default)]
    track_time: f64,
    #[serde(default)]
    animation_end: f64,
    #[serde(default, rename = "loop")]
    is_looping: bool,
    #[serde(default = "default_time_scale")]
    time_scale: f64,
    #[serde(default)]
    last_track_progress_at: u64,
    #[serde(default)]
    animation_recovery_count: u64,
    #[serde(default)]
    animation_recovery_exhausted: bool,
    #[serde(default)]
    status_changed_at: u64,
}

impl Default for RendererHealth {
    fn default() -> Self {
        Self {
            status: "starting".to_string(),
            last_reason: String::new(),
            recovery_count: 0,
            last_recovery_at: 0,
            last_heartbeat_at: 0,
            ticker_started: false,
            frame_counter: 0,
            animation_name: String::new(),
            track_time: -1.0,
            animation_end: 0.0,
            is_looping: false,
            time_scale: 1.0,
            last_track_progress_at: 0,
            animation_recovery_count: 0,
            animation_recovery_exhausted: false,
            status_changed_at: now_ms(),
        }
    }
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
    frame_rate_mode: Option<String>,
    auto_reveal_on_mcp: Option<bool>,
    system_notifications: Option<bool>,
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

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(untagged)]
enum PointerBoundsInput {
    Single(PointerBounds),
    Multiple(Vec<PointerBounds>),
}

fn normalize_pointer_regions(input: Option<PointerBoundsInput>) -> Vec<PointerBounds> {
    let candidates = match input {
        Some(PointerBoundsInput::Single(bounds)) => vec![bounds],
        Some(PointerBoundsInput::Multiple(bounds)) => bounds,
        None => Vec::new(),
    };
    candidates
        .into_iter()
        .filter(|bounds| {
            bounds.left.is_finite()
                && bounds.right.is_finite()
                && bounds.top.is_finite()
                && bounds.bottom.is_finite()
                && bounds.right > bounds.left
                && bounds.bottom > bounds.top
        })
        .take(16)
        .collect()
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
fn cursor_inside_pointer_regions(
    window: &WebviewWindow,
    regions: &[PointerBounds],
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
    regions.iter().any(|bounds| {
        let left = position.x as f64 + bounds.left * scale_factor - padding;
        let right = position.x as f64 + bounds.right * scale_factor + padding;
        let top = position.y as f64 + bounds.top * scale_factor - padding;
        let bottom = position.y as f64 + bounds.bottom * scale_factor + padding;
        cursor_x >= left && cursor_x <= right && cursor_y >= top && cursor_y <= bottom
    })
}

fn default_time_scale() -> f64 {
    1.0
}

#[cfg(any(target_os = "windows", test))]
fn should_ignore_cursor(
    enabled: bool,
    dragging: bool,
    currently_ignored: bool,
    inside_enter_bounds: bool,
    inside_exit_bounds: bool,
    outside_for: Duration,
) -> bool {
    if !enabled || dragging {
        return false;
    }
    let inside_active_bounds = if currently_ignored {
        inside_enter_bounds
    } else {
        inside_exit_bounds
    };
    if inside_active_bounds {
        return false;
    }
    currently_ignored || outside_for >= Duration::from_millis(80)
}

#[cfg(target_os = "windows")]
fn start_pointer_passthrough_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut outside_since: Option<Instant> = None;
        let mut last_ignore_state: Option<bool> = None;
        let mut last_proximity_state: Option<bool> = None;
        loop {
            tokio::time::sleep(Duration::from_millis(16)).await;
            let data = app.state::<AppData>();
            let enabled = data.passthrough_enabled.load(Ordering::Relaxed);
            let regions = data
                .pointer_regions
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            let dragging = data
                .drag_state
                .lock()
                .map(|state| state.is_some())
                .unwrap_or(false);
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };

            let inside_enter = cursor_inside_pointer_regions(&window, &regions, 4.0);
            let inside_exit = cursor_inside_pointer_regions(&window, &regions, 10.0);
            let proximity = cursor_inside_pointer_regions(&window, &regions, 48.0);
            if last_proximity_state != Some(proximity) {
                let _ = app.emit("companion:pointer-proximity", proximity);
                last_proximity_state = Some(proximity);
            }

            let currently_ignored = last_ignore_state.unwrap_or(false);
            let inside_active_bounds = if currently_ignored {
                inside_enter
            } else {
                inside_exit
            };
            if !enabled || dragging || inside_active_bounds {
                outside_since = None;
            } else {
                outside_since.get_or_insert_with(Instant::now);
            }
            let ignore = should_ignore_cursor(
                enabled,
                dragging,
                currently_ignored,
                inside_enter,
                inside_exit,
                outside_since
                    .map(|started| started.elapsed())
                    .unwrap_or_default(),
            );

            if last_ignore_state != Some(ignore) {
                let _ = window.set_ignore_cursor_events(ignore);
                last_ignore_state = Some(ignore);
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn start_pointer_passthrough_monitor(_app: AppHandle) {}

#[allow(unreachable_code)]
fn pointer_passthrough_capability() -> serde_json::Value {
    #[cfg(target_os = "windows")]
    {
        return serde_json::json!({
            "platform": "windows",
            "backend": "native-regions",
            "supported": true,
            "maxRegions": 16,
            "fallback": false
        });
    }
    #[cfg(target_os = "macos")]
    {
        return serde_json::json!({
            "platform": "macos",
            "backend": "interactive-fallback",
            "supported": false,
            "maxRegions": 0,
            "fallback": true,
            "reason": "Native dynamic input regions are not enabled until they pass real-device validation."
        });
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let session = std::env::var("XDG_SESSION_TYPE")
            .unwrap_or_else(|_| "unknown".to_string())
            .to_ascii_lowercase();
        let platform = if session == "wayland" {
            "linux-wayland"
        } else if session == "x11" {
            "linux-x11"
        } else {
            "linux"
        };
        return serde_json::json!({
            "platform": platform,
            "backend": "interactive-fallback",
            "supported": false,
            "maxRegions": 0,
            "fallback": true,
            "reason": "Native dynamic input regions are not enabled until this display backend passes real-device validation."
        });
    }
    serde_json::json!({
        "platform": std::env::consts::OS,
        "backend": "interactive-fallback",
        "supported": false,
        "maxRegions": 0,
        "fallback": true
    })
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportModelInput {
    id: String,
    #[serde(default = "default_model_activation")]
    activate: bool,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportLocalModelInput {
    skel_path: String,
    #[serde(default = "default_model_activation")]
    activate: bool,
}

fn default_model_activation() -> bool {
    true
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
    activated: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSettingsInput {
    patch: serde_json::Value,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelPresentationInput {
    model_id: String,
    scale: f64,
    offset_x: f64,
    offset_y: f64,
    fit_mode: String,
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
    if let Some(value) = patch.frame_rate_mode {
        settings.frame_rate_mode = normalize_frame_rate_mode(&value);
    }
    if let Some(value) = patch.auto_reveal_on_mcp {
        settings.auto_reveal_on_mcp = value;
    }
    if let Some(value) = patch.system_notifications {
        settings.system_notifications = value;
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

    let metadata = if asset_dir.is_empty() {
        None
    } else {
        std::fs::read_to_string(PathBuf::from(&asset_dir).join(".companion-model.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    }
    .or_else(|| model_by_skel(public, &skel));
    let model_id = metadata
        .as_ref()
        .and_then(|model| model.get("id"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let defaults = public
        .get("spine")
        .and_then(|spine| spine.get("presentationDefaults"))
        .cloned()
        .unwrap_or_else(|| {
            serde_json::json!({
                "scale": public["spine"]["scale"].clone(),
                "offsetX": public["spine"]["offsetX"].clone(),
                "offsetY": public["spine"]["offsetY"].clone(),
                "fitMode": "legacy"
            })
        });
    let presentation = public
        .get("models")
        .and_then(|models| models.get("presentations"))
        .and_then(|presentations| presentations.get(&model_id))
        .cloned()
        .unwrap_or(defaults);
    for key in ["scale", "offsetX", "offsetY", "fitMode"] {
        if let Some(value) = presentation.get(key) {
            public["spine"][key] = value.clone();
        }
    }
    public["spine"]["modelId"] = serde_json::Value::String(model_id);
    if let Some(value) = metadata.as_ref().and_then(|model| model.get("category")) {
        public["spine"]["modelCategory"] = value.clone();
    }
    if let Some(value) = metadata
        .as_ref()
        .and_then(|model| model.get("compatibilityProfile"))
    {
        public["spine"]["compatibilityProfile"] = value.clone();
    }
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

fn public_server_config(origin: &str) -> serde_json::Value {
    let origin = origin.trim_end_matches('/');
    serde_json::json!({
        "origin": origin,
        "stateUrl": format!("{origin}/state"),
        "eventsUrl": format!("{origin}/events")
    })
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
    create_reminder(
        &data.store,
        &data.tx,
        &data.reminders,
        &data.reminder_tx,
        input,
    )
    .await
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
    install_model_value(&app, &data, input, model).await
}

fn local_model_name(asset_dir: &Path, skel: &str) -> String {
    asset_dir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .or_else(|| Path::new(skel).file_stem().and_then(|name| name.to_str()))
        .unwrap_or("Local model")
        .trim()
        .to_string()
}

fn local_model_id(asset_dir: &Path, name: &str, skel: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() {
            slug.push(byte.to_ascii_lowercase() as char);
            separator = false;
        } else if !slug.is_empty() && !separator {
            slug.push('-');
            separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        slug.push_str("model");
    }
    slug.truncate(40);
    while slug.ends_with('-') {
        slug.pop();
    }
    let mut digest = Sha1::new();
    digest.update(asset_dir.to_string_lossy().as_bytes());
    digest.update([0]);
    digest.update(skel.as_bytes());
    let hash = format!("{:x}", digest.finalize());
    format!("local-{slug}-{}", &hash[..12])
}

fn is_local_import_staging_name(name: &str) -> bool {
    name.starts_with(".local-")
        && name
            .strip_suffix(".staging")
            .and_then(|stem| stem.rsplit_once("-local-import-"))
            .is_some_and(|(_, request)| {
                !request.is_empty() && request.bytes().all(|byte| byte.is_ascii_digit())
            })
}

fn normalized_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Asset file cannot be read: {error}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Asset directory cannot be read: {error}"))?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(format!(
            "Asset file must stay inside the selected folder: {}",
            path.to_string_lossy()
        ));
    }
    let relative = canonical
        .strip_prefix(&canonical_root)
        .map_err(|_| "Asset file is outside the selected folder.".to_string())?;
    let relative = avatar::spine_assets::safe_relative_path(&relative.to_string_lossy())?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn validate_local_skeleton_header(path: &Path) -> Result<String, String> {
    let version = avatar::read_spine_binary_version(path)
        .ok_or_else(|| "Selected .skel file is not a valid Spine binary skeleton.".to_string())?;
    if version.trim().is_empty() {
        return Err("Selected .skel file has no Spine runtime version.".to_string());
    }
    if version != "3.8" && !version.starts_with("3.8.") {
        return Err(format!(
            "Unsupported Spine runtime version {version}; expected Spine 3.8."
        ));
    }
    Ok(version)
}

#[derive(Debug)]
struct LocalRuntimeSelection {
    #[cfg(test)]
    atlas_source: String,
    atlas_destination: String,
    atlas_text: String,
    texture_sources: Vec<String>,
}

fn select_local_atlas(asset_dir: &Path, skel: &str) -> Result<String, String> {
    let skeleton_stem = Path::new(skel)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let atlas_files = avatar::spine_assets::list_atlas_files(asset_dir)?;
    if atlas_files.is_empty() {
        return Err("The selected .skel folder must also contain an .atlas file.".to_string());
    }
    let atlas_candidates = atlas_files
        .iter()
        .filter(|atlas| {
            Path::new(atlas)
                .file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|stem| stem.eq_ignore_ascii_case(skeleton_stem))
        })
        .collect::<Vec<_>>();
    if atlas_files.len() == 1 {
        Ok(atlas_files[0].clone())
    } else {
        match atlas_candidates.as_slice() {
            [atlas] => Ok((*atlas).clone()),
            [] => Err(format!(
                "Multiple atlas files were found. Add one named for the selected skeleton ({skeleton_stem}.atlas)."
            )),
            _ => Err(format!(
                "Multiple atlas files match the selected skeleton ({skeleton_stem}). Select a folder with one matching atlas."
            )),
        }
    }
}

fn read_local_atlas(asset_dir: &Path, atlas: &str) -> Result<(String, Vec<String>), String> {
    let atlas_path = asset_dir.join(
        avatar::spine_assets::safe_relative_path(atlas)
            .map_err(|error| format!("Invalid atlas path: {error}"))?,
    );
    let mut atlas_file = File::open(&atlas_path)
        .map_err(|error| format!("Unable to read Spine atlas file {atlas}: {error}"))?;
    let mut atlas_bytes = Vec::new();
    std::io::Read::by_ref(&mut atlas_file)
        .take(MAX_MODEL_FILE_BYTES + 1)
        .read_to_end(&mut atlas_bytes)
        .map_err(|error| format!("Unable to read Spine atlas file {atlas}: {error}"))?;
    if atlas_bytes.len() as u64 > MAX_MODEL_FILE_BYTES {
        return Err(format!("Atlas {atlas} exceeds the 64 MiB per-file limit."));
    }
    let atlas_text = String::from_utf8(atlas_bytes)
        .map_err(|_| format!("Spine atlas {atlas} is not valid UTF-8."))?;
    let references = avatar::spine_assets::atlas_texture_refs(&atlas_text);
    if references.is_empty() {
        return Err(format!(
            "Spine atlas {atlas} does not reference a texture page."
        ));
    }
    let mut texture_files = Vec::new();
    for texture in references {
        let relative = avatar::spine_assets::safe_relative_path(&texture)
            .map_err(|error| format!("Invalid atlas texture reference: {error}"))?;
        let texture_path = atlas_path.parent().unwrap_or(asset_dir).join(relative);
        texture_files.push(normalized_relative_path(asset_dir, &texture_path)?);
    }
    Ok((atlas_text, texture_files))
}

fn local_runtime_selection(asset_dir: &Path, skel: &str) -> Result<LocalRuntimeSelection, String> {
    let atlas_source = select_local_atlas(asset_dir, skel)?;
    let (atlas_text, texture_sources) = read_local_atlas(asset_dir, &atlas_source)?;
    let skeleton_stem = Path::new(skel)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Selected skeleton has an invalid file name.".to_string())?;
    let atlas_destination = format!("{skeleton_stem}.atlas");
    Ok(LocalRuntimeSelection {
        #[cfg(test)]
        atlas_source,
        atlas_destination,
        atlas_text,
        texture_sources,
    })
}

/// Selects one skeleton's atlas and referenced pages, avoiding unrelated files in a shared folder.
#[cfg(test)]
fn local_runtime_files(asset_dir: &Path, skel: &str) -> Result<Vec<String>, String> {
    let selection = local_runtime_selection(asset_dir, skel)?;
    let mut files = vec![skel.to_string(), selection.atlas_source];
    files.extend(selection.texture_sources);
    files.sort_by_key(|path| path.to_ascii_lowercase());
    files.dedup();
    Ok(files)
}

fn rewrite_local_atlas(atlas_text: &str, texture_destinations: &[String]) -> String {
    let mut texture_index = 0;
    let mut rewritten = String::with_capacity(atlas_text.len());
    for line in atlas_text.split_inclusive('\n') {
        let content = line.strip_suffix('\n').unwrap_or(line);
        let content_without_cr = content.strip_suffix('\r').unwrap_or(content);
        let trimmed = content_without_cr.trim();
        let is_top_level_texture = !content_without_cr
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
            && Path::new(trimmed)
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    ["png", "jpg", "jpeg", "webp"]
                        .iter()
                        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
                });
        if is_top_level_texture && texture_index < texture_destinations.len() {
            rewritten.push_str(&texture_destinations[texture_index]);
            rewritten.push_str(&line[content_without_cr.len()..]);
            texture_index += 1;
        } else {
            rewritten.push_str(line);
        }
    }
    rewritten
}

fn copy_local_asset_file(
    source_root: &Path,
    relative: &str,
    destination_root: &Path,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let relative = avatar::spine_assets::safe_relative_path(relative)?;
    let source = source_root.join(&relative);
    let file_type = fs::symlink_metadata(&source)
        .map_err(|error| format!("Unable to inspect asset {}: {error}", relative.display()))?;
    if !file_type.is_file() {
        return Err(format!(
            "Asset is not a regular file: {}",
            relative.display()
        ));
    }
    let canonical_source = source
        .canonicalize()
        .map_err(|error| format!("Unable to resolve asset {}: {error}", relative.display()))?;
    let canonical_root = source_root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve asset directory: {error}"))?;
    if !canonical_source.starts_with(&canonical_root) {
        return Err(format!(
            "Asset escapes the selected folder: {}",
            relative.display()
        ));
    }
    let declared_size = file_type.len();
    if declared_size > MAX_MODEL_FILE_BYTES {
        return Err(format!(
            "Asset {} exceeds the 64 MiB per-file limit.",
            relative.display()
        ));
    }
    *total_bytes = total_bytes
        .checked_add(declared_size)
        .ok_or_else(|| "Local model size overflowed.".to_string())?;
    if *total_bytes > MAX_MODEL_TOTAL_BYTES {
        return Err("Local model exceeds the 256 MiB total size limit.".to_string());
    }

    let destination = destination_root.join(&relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut input = File::open(&canonical_source).map_err(|error| error.to_string())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| error.to_string())?;
    let copied = std::io::copy(
        &mut std::io::Read::by_ref(&mut input).take(MAX_MODEL_FILE_BYTES + 1),
        &mut output,
    )
    .map_err(|error| error.to_string())?;
    if copied > MAX_MODEL_FILE_BYTES || copied != declared_size {
        return Err(format!(
            "Asset {} changed while it was being imported.",
            relative.display()
        ));
    }
    output.sync_all().map_err(|error| error.to_string())?;
    Ok(())
}

fn write_local_atlas_file(
    destination_root: &Path,
    relative: &str,
    contents: &str,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let relative = avatar::spine_assets::safe_relative_path(relative)?;
    let bytes = contents.as_bytes();
    if bytes.len() as u64 > MAX_MODEL_FILE_BYTES {
        return Err(format!(
            "Atlas {} exceeds the 64 MiB per-file limit.",
            relative.display()
        ));
    }
    *total_bytes = total_bytes
        .checked_add(bytes.len() as u64)
        .ok_or_else(|| "Local model size overflowed.".to_string())?;
    if *total_bytes > MAX_MODEL_TOTAL_BYTES {
        return Err("Local model exceeds the 256 MiB total size limit.".to_string());
    }
    let destination = destination_root.join(&relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| error.to_string())?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|error| error.to_string())
}

fn write_local_import_metadata(
    destination_root: &Path,
    id: &str,
    name: &str,
    skel: &str,
    files: &[String],
) -> Result<(), String> {
    write_model_metadata(
        destination_root,
        &serde_json::json!({
            "id": id,
            "name": name,
            "source": "Local",
            "license": "UNVERIFIED",
            "licenseNote": "Rights and redistribution terms were not verified for this local asset.",
            "skel": skel,
            "files": files,
            "category": "operator",
            "compatibilityProfile": "companion"
        }),
    )
}

fn local_import_result(
    data: &AppData,
    id: &str,
    name: &str,
    skel: &str,
    asset_dir: &Path,
    activated: bool,
) -> ImportModelResult {
    let public = public_config_with_ui(data);
    let origin = public
        .get("server")
        .and_then(|server| server.get("origin"))
        .and_then(|origin| origin.as_str())
        .unwrap_or("http://127.0.0.1:17388");
    ImportModelResult {
        id: id.to_string(),
        name: name.to_string(),
        asset_dir: asset_dir.to_string_lossy().to_string(),
        skel: skel.to_string(),
        asset_url: format!("{origin}/assets/spine/{}", url_encode_path_segment(skel)),
        local_config_path: data.local_config_path.to_string_lossy().to_string(),
        requires_restart: false,
        activated,
    }
}

#[tauri::command]
async fn import_local_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    input: ImportLocalModelInput,
) -> Result<ImportModelResult, String> {
    let requested = input.skel_path.trim();
    if requested.is_empty() {
        return Err("Choose a Spine .skel file to import.".to_string());
    }
    let selected = PathBuf::from(requested);
    let selected_type = fs::symlink_metadata(&selected)
        .map_err(|error| format!("Unable to inspect selected skeleton: {error}"))?;
    if !selected_type.is_file() {
        return Err("The selected skeleton must be a regular file.".to_string());
    }
    if !selected
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("skel"))
    {
        return Err("Choose a Spine .skel file to import.".to_string());
    }
    let selected = selected
        .canonicalize()
        .map_err(|error| format!("Unable to resolve selected skeleton: {error}"))?;
    let asset_dir = selected
        .parent()
        .ok_or_else(|| "Selected skeleton has no containing folder.".to_string())?
        .canonicalize()
        .map_err(|error| format!("Unable to resolve selected asset folder: {error}"))?;
    let skel = selected
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Selected skeleton has an invalid file name.".to_string())?
        .to_string();
    let _spine_version = validate_local_skeleton_header(&selected)?;
    let selection = local_runtime_selection(&asset_dir, &skel)?;
    let mut files = vec![skel.clone()];
    files.extend(selection.texture_sources.iter().cloned());
    files.push(selection.atlas_destination.clone());
    files.sort_by_key(|path| path.to_ascii_lowercase());
    files.dedup();
    let name = local_model_name(&asset_dir, &skel);
    let id = local_model_id(&asset_dir, &name, &skel);
    let models_root = data.config_dir.join("models");
    fs::create_dir_all(&models_root).map_err(|error| error.to_string())?;
    let request_id = NEXT_DOWNLOAD_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let staging = models_root.join(format!(".{id}-local-import-{request_id}.staging"));
    remove_dir_if_exists_blocking(&staging)?;
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let copy_result = (|| {
        let mut total_bytes = 0;
        for relative in &files {
            if relative == &selection.atlas_destination {
                continue;
            }
            copy_local_asset_file(&asset_dir, relative, &staging, &mut total_bytes)?;
        }
        let atlas_text = rewrite_local_atlas(&selection.atlas_text, &selection.texture_sources);
        write_local_atlas_file(
            &staging,
            &selection.atlas_destination,
            &atlas_text,
            &mut total_bytes,
        )?;
        write_local_import_metadata(&staging, &id, &name, &skel, &files)?;
        validate_spine_asset_dir(&staging, &skel)
    })();
    if let Err(error) = copy_result {
        let _ = remove_dir_if_exists_blocking(&staging);
        return Err(format!("Local model import failed: {error}"));
    }

    let mutation = data.model_mutation_lock.lock().await;
    let model_dir = models_root.join(&id);
    let backup = match avatar::replace_directory_atomically(&staging, &model_dir) {
        Ok(backup) => backup,
        Err(error) => {
            let _ = remove_dir_if_exists_blocking(&staging);
            return Err(format!("Local model import failed: {error}"));
        }
    };
    let canonical_model_dir = match model_dir.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            let _ = avatar::rollback_directory_replace(&model_dir, backup.as_deref());
            return Err(format!("Local model import failed: {error}"));
        }
    };
    let result = if input.activate {
        activate_installed_model(&app, &data, &id, &mutation).await
    } else {
        Ok(local_import_result(
            &data,
            &id,
            &name,
            &skel,
            &canonical_model_dir,
            false,
        ))
    };
    match result {
        Ok(result) => {
            if result.activated {
                clear_model_trial(&data);
            }
            if let Some(backup) = backup {
                let _ = fs::remove_dir_all(backup);
            }
            if !input.activate {
                let _ = app.emit("companion:model-imported", result.clone());
            }
            Ok(result)
        }
        Err(error) => {
            if let Some(backup) = backup {
                let _ = fs::remove_dir_all(backup);
            }
            if input.activate {
                let imported =
                    local_import_result(&data, &id, &name, &skel, &canonical_model_dir, false);
                let _ = app.emit("companion:model-imported", imported);
                Err(format!(
                    "Local model imported but could not be activated: {error}"
                ))
            } else {
                Err(error)
            }
        }
    }
}

async fn install_model_value(
    app: &tauri::AppHandle,
    data: &AppData,
    input: ImportModelInput,
    model: serde_json::Value,
) -> Result<ImportModelResult, String> {
    let cancellation = Arc::new(AtomicU8::new(DOWNLOAD_ACTIVE));
    {
        let mut downloads = data
            .download_cancellations
            .lock()
            .map_err(|_| "Download cancellation lock is poisoned".to_string())?;
        register_model_download(&mut downloads, &input.id, cancellation.clone())?;
    }
    let id = input.id.clone();
    let result = install_model_value_inner(app, data, input, model, cancellation.clone()).await;
    if let Ok(mut downloads) = data.download_cancellations.lock() {
        if downloads
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current, &cancellation))
        {
            downloads.remove(&id);
        }
    }
    result
}

fn write_model_metadata(model_dir: &Path, model: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(model).map_err(|error| error.to_string())?;
    std::fs::write(model_dir.join(".companion-model.json"), bytes)
        .map_err(|error| format!("Model metadata could not be saved: {error}"))
}

fn download_is_cancelled(cancellation: &AtomicU8) -> bool {
    cancellation.load(Ordering::Acquire) == DOWNLOAD_CANCELLED
}

fn cancel_download_state(cancellation: &AtomicU8) -> bool {
    cancellation
        .compare_exchange(
            DOWNLOAD_ACTIVE,
            DOWNLOAD_CANCELLED,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

fn register_model_download(
    downloads: &mut HashMap<String, Arc<AtomicU8>>,
    id: &str,
    cancellation: Arc<AtomicU8>,
) -> Result<(), String> {
    if let Some(previous) = downloads.get(id) {
        if !cancel_download_state(previous.as_ref()) {
            return Err("This model installation is already finishing.".to_string());
        }
    }
    downloads.insert(id.to_string(), cancellation);
    Ok(())
}

fn begin_download_commit(cancellation: &AtomicU8) -> Result<(), String> {
    cancellation
        .compare_exchange(
            DOWNLOAD_ACTIVE,
            DOWNLOAD_COMMITTING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .map(|_| ())
        .map_err(|_| "Download cancelled.".to_string())
}

fn model_download_temp_dir(models_root: &Path, id: &str, request_id: u64) -> PathBuf {
    models_root.join(format!(
        "{}.{}-{}.download",
        id,
        std::process::id(),
        request_id
    ))
}

async fn install_model_value_inner(
    app: &tauri::AppHandle,
    data: &AppData,
    input: ImportModelInput,
    model: serde_json::Value,
    cancellation: Arc<AtomicU8>,
) -> Result<ImportModelResult, String> {
    validate_model_download_file_name(&input.id)?;
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
    let declared_total = files.iter().try_fold(0u64, |total, file| {
        let size = file
            .get("sizeBytes")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        if size > MAX_MODEL_FILE_BYTES {
            return Err(format!(
                "Model file declares {size} bytes, exceeding the 64 MiB limit."
            ));
        }
        total
            .checked_add(size)
            .ok_or_else(|| "Declared model size overflowed.".to_string())
    })?;
    if declared_total > MAX_MODEL_TOTAL_BYTES {
        return Err("Model declares more than the 256 MiB download limit.".to_string());
    }
    let models_root = data.config_dir.join("models");
    let model_dir = models_root.join(&input.id);
    let request_id = NEXT_DOWNLOAD_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let temp_model_dir = model_download_temp_dir(&models_root, &input.id, request_id);
    remove_dir_if_exists(&temp_model_dir).await?;
    tokio::fs::create_dir_all(&temp_model_dir)
        .await
        .map_err(|error| error.to_string())?;
    tokio::fs::write(temp_model_dir.join(PARTIAL_DOWNLOAD_MARKER), b"")
        .await
        .map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(safe_download_redirect_policy())
        .build()
        .map_err(|error| error.to_string())?;

    let total_files = files.len();
    let mut model_bytes_written = 0u64;
    for (i, file) in files.iter().enumerate() {
        let file_name = file
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Model file is missing name".to_string())?;
        validate_model_download_file_name(file_name)?;
        let urls = download_url_candidates(file)?;
        let destination = temp_model_dir.join(file_name);
        let remaining_model_bytes = MAX_MODEL_TOTAL_BYTES.saturating_sub(model_bytes_written);
        if remaining_model_bytes == 0 {
            let _ = remove_dir_if_exists_blocking(&temp_model_dir);
            return Err("Model download exceeded the 256 MiB limit.".to_string());
        }
        let file_limit = MAX_MODEL_FILE_BYTES.min(remaining_model_bytes);

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

        let downloaded = download_model_file_to_path(
            &client,
            file_name,
            &urls,
            &destination,
            file_limit,
            Some(cancellation.as_ref()),
            |file_bytes, declared_bytes| {
                let _ = app.emit(
                    "companion:download-progress",
                    serde_json::json!({
                        "id": input.id,
                        "file": file_name,
                        "current": i + 1,
                        "total": total_files,
                        "status": "downloading",
                        "fileBytes": file_bytes,
                        "fileBytesTotal": declared_bytes,
                        "modelBytes": model_bytes_written.saturating_add(file_bytes)
                    }),
                );
            },
        )
        .await
        .map_err(|error| {
            let _ = remove_dir_if_exists_blocking(&temp_model_dir);
            let cancelled = error.contains("cancelled");
            let status = if cancelled { "cancelled" } else { "failed" };
            let message = if cancelled {
                "Download cancelled.".to_string()
            } else {
                format!("Failed to download {}", error)
            };
            let _ = app.emit(
                "companion:download-progress",
                serde_json::json!({
                    "id": input.id,
                    "file": file_name,
                    "current": i + 1,
                    "total": total_files,
                    "status": status,
                    "error": message
                }),
            );
            message
        })?;
        model_bytes_written = model_bytes_written
            .checked_add(downloaded.bytes_written)
            .ok_or_else(|| "Model download size overflowed.".to_string())?;
        if model_bytes_written > MAX_MODEL_TOTAL_BYTES {
            let _ = remove_dir_if_exists_blocking(&temp_model_dir);
            return Err("Model download exceeded the 256 MiB limit.".to_string());
        }
        if let Some(expected_size) = file.get("sizeBytes").and_then(|value| value.as_u64()) {
            if expected_size != downloaded.bytes_written {
                let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                return Err(format!(
                    "Size check failed for {file_name}: expected {expected_size}, got {}",
                    downloaded.bytes_written
                ));
            }
        }
        if let Some(expected) = file
            .get("sha256")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
        {
            let actual = &downloaded.sha256;
            if !actual.eq_ignore_ascii_case(expected) {
                let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                return Err(format!(
                    "Integrity check failed for {file_name}: expected {expected}, got {actual}"
                ));
            }
        } else if let Some(expected) = file.get("githubBlobSha").and_then(|value| value.as_str()) {
            verify_git_blob_sha_path(&destination, expected)
                .await
                .map_err(|error| {
                    let _ = remove_dir_if_exists_blocking(&temp_model_dir);
                    format!("Integrity check failed for {file_name}: {error}")
                })?;
        }
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
    let mutation = data.model_mutation_lock.lock().await;
    begin_download_commit(cancellation.as_ref()).inspect_err(|_| {
        let _ = remove_dir_if_exists_blocking(&temp_model_dir);
    })?;
    write_model_metadata(&temp_model_dir, &model).inspect_err(|_| {
        let _ = remove_dir_if_exists_blocking(&temp_model_dir);
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
    let _ = tokio::fs::remove_file(model_dir.join(PARTIAL_DOWNLOAD_MARKER)).await;
    let canonical_model_dir = model_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if input.activate {
        commit_model_selection(data, &canonical_model_dir, &skel, Some(&model), &mutation)
            .await
            .map_err(|error| {
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
        clear_model_trial(data);
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

    let public = public_config_with_ui(data);
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
        activated: input.activate,
    };

    let _ = app.emit("companion:model-imported", result.clone());
    if result.activated {
        let _ = app.emit("companion:config-changed", public_config_with_ui(data));
    }

    Ok(result)
}

#[tauri::command]
async fn import_catalog_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    source_id: String,
    model_id: String,
    activate: Option<bool>,
    acknowledgement: bool,
) -> Result<ImportModelResult, String> {
    let entry = resolve_catalog_model(&data, &source_id, &model_id)?;
    entry.model.require_acknowledgement(acknowledgement)?;
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
    install_model_value(
        &app,
        &data,
        ImportModelInput {
            id,
            activate: activate.unwrap_or(true),
        },
        value.clone(),
    )
    .await
}

#[tauri::command]
async fn prepare_model_preview(
    window: WebviewWindow,
    data: State<'_, AppData>,
    source_id: String,
    model_id: String,
    acknowledgement: bool,
) -> Result<serde_json::Value, String> {
    require_manager_window(&window)?;
    let entry = resolve_catalog_model(&data, &source_id, &model_id)?;
    entry.model.require_acknowledgement(acknowledgement)?;
    let id = entry.model.id.clone();
    let skel = entry.model.skel.clone();
    let preview_root = data.config_dir.join("preview-assets");
    let preview_dir = preview_root.join(&id);
    let temp_dir = preview_root.join(format!("{}.preview-download", id));
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
        tokio::fs::write(temp_dir.join(PARTIAL_DOWNLOAD_MARKER), b"")
            .await
            .map_err(|error| error.to_string())?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(safe_download_redirect_policy())
            .build()
            .map_err(|error| error.to_string())?;
        let value = serde_json::to_value(&entry.model).map_err(|error| error.to_string())?;
        let files = value
            .get("files")
            .and_then(|files| files.as_array())
            .ok_or_else(|| "Model preview entry is missing files".to_string())?;
        let declared_total = files.iter().try_fold(0u64, |total, file| {
            let size = file
                .get("sizeBytes")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            if size > MAX_MODEL_FILE_BYTES {
                return Err("Preview file exceeds the 64 MiB limit.".to_string());
            }
            total
                .checked_add(size)
                .ok_or_else(|| "Preview size overflowed.".to_string())
        })?;
        if declared_total > MAX_MODEL_TOTAL_BYTES {
            return Err("Preview model exceeds the 256 MiB limit.".to_string());
        }
        let mut model_bytes_written = 0u64;
        for file in files {
            let file_name = file
                .get("name")
                .and_then(|name| name.as_str())
                .ok_or_else(|| "Model preview file is missing name".to_string())?;
            validate_model_download_file_name(file_name)?;
            let destination = temp_dir.join(file_name);
            let remaining = MAX_MODEL_TOTAL_BYTES.saturating_sub(model_bytes_written);
            if remaining == 0 {
                let _ = remove_dir_if_exists_blocking(&temp_dir);
                return Err("Preview model exceeds the 256 MiB limit.".to_string());
            }
            let downloaded = download_model_file_to_path(
                &client,
                file_name,
                &download_url_candidates(file)?,
                &destination,
                MAX_MODEL_FILE_BYTES.min(remaining),
                None,
                |_downloaded, _declared| {},
            )
            .await
            .map_err(|error| {
                let _ = remove_dir_if_exists_blocking(&temp_dir);
                format!("Failed to prepare preview: {error}")
            })?;
            model_bytes_written = model_bytes_written
                .checked_add(downloaded.bytes_written)
                .ok_or_else(|| "Preview model size overflowed.".to_string())?;
            if let Some(expected_size) = file.get("sizeBytes").and_then(|value| value.as_u64()) {
                if expected_size != downloaded.bytes_written {
                    let _ = remove_dir_if_exists_blocking(&temp_dir);
                    return Err(format!("Preview size check failed for {file_name}"));
                }
            }
            if let Some(expected) = file
                .get("sha256")
                .and_then(|hash| hash.as_str())
                .filter(|value| !value.is_empty())
            {
                let actual = &downloaded.sha256;
                if !actual.eq_ignore_ascii_case(expected) {
                    let _ = remove_dir_if_exists_blocking(&temp_dir);
                    return Err(format!("Preview integrity check failed for {file_name}"));
                }
            } else if let Some(expected) = file.get("githubBlobSha").and_then(|hash| hash.as_str())
            {
                verify_git_blob_sha_path(&destination, expected)
                    .await
                    .map_err(|error| {
                        let _ = remove_dir_if_exists_blocking(&temp_dir);
                        format!("Preview integrity check failed for {file_name}: {error}")
                    })?;
            }
        }
        validate_spine_asset_dir(&temp_dir, &skel).inspect_err(|_| {
            let _ = remove_dir_if_exists_blocking(&temp_dir);
        })?;
        tokio::fs::write(temp_dir.join(".catalog-signature"), &signature)
            .await
            .map_err(|error| error.to_string())?;
        replace_model_dir(&temp_dir, &preview_dir).await?;
        let _ = tokio::fs::remove_file(preview_dir.join(PARTIAL_DOWNLOAD_MARKER)).await;
    }
    tokio::fs::write(&signature_path, &signature)
        .await
        .map_err(|error| error.to_string())?;
    prune_preview_asset_cache(&preview_root, &id, 24, 256 * 1024 * 1024);

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
        "https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}"
    ))
}

fn validate_model_download_file_name(file_name: &str) -> Result<(), String> {
    let path = Path::new(file_name);
    let mut components = path.components();
    let single_normal = matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none();
    if !single_normal || file_name.contains(['/', '\\']) || file_name.trim().is_empty() {
        return Err(format!("Unsafe model file name: {file_name}"));
    }
    Ok(())
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

struct DownloadedModelFile {
    bytes_written: u64,
    sha256: String,
}

fn validate_https_download_url(url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|error| format!("Invalid download URL: {error}"))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("Model downloads require HTTPS.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Model download URLs must not contain credentials.".to_string());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(is_private_or_local_ip)
    {
        return Err("Model download URLs cannot target a private or local host.".to_string());
    }
    Ok(())
}

fn is_private_or_local_ipv4(ip: std::net::Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
}

fn is_private_or_local_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => is_private_or_local_ipv4(ip),
        std::net::IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4() {
                return is_private_or_local_ipv4(ipv4);
            }
            let first = ip.segments()[0];
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || first & 0xfe00 == 0xfc00
                || first & 0xffc0 == 0xfe80
        }
    }
}

fn validate_download_redirect(
    url: &str,
    previous_count: usize,
    original_host: Option<&str>,
) -> Result<(), String> {
    if previous_count >= 5 {
        return Err("Download redirected too many times.".to_string());
    }
    validate_https_download_url(url)?;
    let redirected = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    let redirected_host = redirected.host_str().unwrap_or_default();
    if original_host.is_some_and(|host| !host.eq_ignore_ascii_case(redirected_host)) {
        return Err("Download redirects must stay on the original host.".to_string());
    }
    Ok(())
}

fn safe_download_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let original_host = attempt.previous().first().and_then(|url| url.host_str());
        match validate_download_redirect(
            attempt.url().as_str(),
            attempt.previous().len(),
            original_host,
        ) {
            Ok(()) => attempt.follow(),
            Err(error) => attempt.error(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                error,
            )),
        }
    })
}

fn checked_download_size(current: u64, chunk: usize, limit: u64) -> Result<u64, String> {
    let next = current
        .checked_add(chunk as u64)
        .ok_or_else(|| "Model file size overflowed.".to_string())?;
    if next > limit {
        return Err(format!("download exceeded the {limit} byte limit"));
    }
    Ok(next)
}

async fn download_model_file_to_path<F>(
    client: &reqwest::Client,
    file_name: &str,
    urls: &[String],
    destination: &Path,
    byte_limit: u64,
    cancellation: Option<&AtomicU8>,
    mut on_progress: F,
) -> Result<DownloadedModelFile, String>
where
    F: FnMut(u64, Option<u64>),
{
    let mut attempts = Vec::new();
    for url in urls {
        if cancellation.is_some_and(download_is_cancelled) {
            return Err("Download cancelled.".to_string());
        }
        if let Err(error) = validate_https_download_url(url) {
            attempts.push(format!("{} ({})", url, error));
            continue;
        }
        for retry in 0..2 {
            if cancellation.is_some_and(download_is_cancelled) {
                return Err("Download cancelled.".to_string());
            }
            match client.get(url).send().await {
                Ok(mut response) => {
                    let status = response.status();
                    if !status.is_success() {
                        attempts.push(format!("{} (HTTP {})", url, status.as_u16()));
                        if !status.is_server_error() {
                            break;
                        }
                    } else if let Err(error) = validate_https_download_url(response.url().as_str())
                    {
                        attempts.push(format!("{} (redirect rejected: {})", url, error));
                        break;
                    } else if response
                        .content_length()
                        .is_some_and(|length| length > byte_limit)
                    {
                        attempts.push(format!(
                            "{} (declared size exceeds {} bytes)",
                            url, byte_limit
                        ));
                        break;
                    } else {
                        let declared = response.content_length();
                        let mut output = match tokio::fs::File::create(destination).await {
                            Ok(output) => output,
                            Err(error) => {
                                return Err(format!("Cannot create {file_name}: {error}"))
                            }
                        };
                        let mut written = 0u64;
                        let mut digest = Sha256::new();
                        let stream_result: Result<(), String> = async {
                            while let Some(chunk) =
                                response.chunk().await.map_err(|error| error.to_string())?
                            {
                                if cancellation.is_some_and(download_is_cancelled) {
                                    return Err("Download cancelled.".to_string());
                                }
                                written = checked_download_size(written, chunk.len(), byte_limit)?;
                                output
                                    .write_all(&chunk)
                                    .await
                                    .map_err(|error| error.to_string())?;
                                digest.update(&chunk);
                                on_progress(written, declared);
                            }
                            output.flush().await.map_err(|error| error.to_string())?;
                            Ok(())
                        }
                        .await;
                        drop(output);
                        match stream_result {
                            Ok(()) => {
                                return Ok(DownloadedModelFile {
                                    bytes_written: written,
                                    sha256: format!("{:x}", digest.finalize()),
                                });
                            }
                            Err(error) => {
                                let _ = tokio::fs::remove_file(destination).await;
                                if error.contains("cancelled") {
                                    return Err("Download cancelled.".to_string());
                                }
                                attempts.push(format!("{} ({})", url, error));
                            }
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

async fn verify_git_blob_sha_path(path: &Path, expected: &str) -> Result<(), String> {
    let length = tokio::fs::metadata(path)
        .await
        .map_err(|error| error.to_string())?
        .len();
    let mut digest = Sha1::new();
    digest.update(format!("blob {}\0", length).as_bytes());
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("expected {expected}, got {actual}"))
    }
}

#[cfg(test)]
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

fn directory_size_bytes(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => directory_size_bytes(&entry.path()),
            Ok(file_type) if file_type.is_file() => {
                entry.metadata().map(|value| value.len()).unwrap_or(0)
            }
            _ => 0,
        })
        .sum()
}

fn prune_preview_asset_cache(root: &Path, keep_id: &str, max_entries: usize, max_bytes: u64) {
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
            let size = directory_size_bytes(&entry.path());
            Some((name, entry.path(), modified, size))
        })
        .collect::<Vec<_>>();
    cached.sort_by_key(|right| std::cmp::Reverse(right.2));
    let mut retained_entries = cached.len();
    let mut retained_bytes = cached.iter().map(|entry| entry.3).sum::<u64>();
    for (name, path, _, size) in cached.into_iter().rev() {
        if retained_entries <= max_entries.max(1) && retained_bytes <= max_bytes {
            break;
        }
        if name == keep_id {
            continue;
        }
        if std::fs::remove_dir_all(path).is_ok() {
            retained_entries = retained_entries.saturating_sub(1);
            retained_bytes = retained_bytes.saturating_sub(size);
        }
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
            "Failed to install downloaded model directory: {}",
            error
        ));
    }
    remove_dir_if_exists(&backup_dir).await?;
    Ok(())
}

#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    input: SaveSettingsInput,
) -> Result<(), String> {
    let _mutation = data.model_mutation_lock.lock().await;
    let path = &data.local_config_path;
    let mut patch = input.patch;
    if let Some(spine) = patch.get("spine").and_then(serde_json::Value::as_object) {
        let mut defaults = serde_json::Map::new();
        for key in ["scale", "offsetX", "offsetY", "fitMode"] {
            if let Some(value) = spine.get(key) {
                defaults.insert(key.to_string(), value.clone());
            }
        }
        if !defaults.is_empty() {
            patch["spine"]["presentationDefaults"] = serde_json::Value::Object(defaults);
        }
    }
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

fn validate_model_presentation(input: &ModelPresentationInput) -> Result<(), String> {
    validate_model_download_file_name(&input.model_id)?;
    if !(0.2..=2.5).contains(&input.scale) {
        return Err("Model scale must be between 0.2 and 2.5.".to_string());
    }
    if !(-240.0..=240.0).contains(&input.offset_x) || !(-240.0..=240.0).contains(&input.offset_y) {
        return Err("Model offsets must be between -240 and 240.".to_string());
    }
    if !matches!(input.fit_mode.as_str(), "legacy" | "character" | "full") {
        return Err("Model fit mode must be legacy, character, or full.".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn save_model_presentation(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    input: ModelPresentationInput,
) -> Result<serde_json::Value, String> {
    validate_model_presentation(&input)?;
    let _mutation = data.model_mutation_lock.lock().await;
    let presentation = serde_json::json!({
        "scale": input.scale,
        "offsetX": input.offset_x,
        "offsetY": input.offset_y,
        "fitMode": input.fit_mode
    });
    let patch = serde_json::json!({
        "models": {
            "presentations": {
                (input.model_id.clone()): presentation.clone()
            }
        }
    });
    let mut local =
        read_json_if_exists(&data.local_config_path).unwrap_or_else(|| serde_json::json!({}));
    merge_json(&mut local, patch.clone());
    if let Some(parent) = data.local_config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&local).map_err(|error| error.to_string())?;
    std::fs::write(&data.local_config_path, format!("{}\n", text))
        .map_err(|error| error.to_string())?;
    if let Ok(mut public) = data.public_config.lock() {
        merge_json(&mut public, patch);
    }
    let public = public_config_with_ui(&data);
    let active = string_at(&public, &["spine", "modelId"]) == Some(input.model_id.as_str());
    let payload = serde_json::json!({
        "modelId": input.model_id,
        "presentation": presentation,
        "active": active
    });
    let _ = app.emit("companion:model-presentation", payload.clone());
    Ok(payload)
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
    let config_paths = public
        .get("paths")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    Ok(serde_json::json!({
        "apiOk": state_ok,
        "localConfigExists": local_config_exists,
        "localConfigPath": config_paths.get("localConfigPath").cloned().unwrap_or_default(),
        "canonicalConfigPath": config_paths.get("canonicalConfigPath").cloned().unwrap_or_default(),
        "configPaths": config_paths,
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
            "experimental": !cfg!(target_os = "windows"),
            "pointerPassthrough": pointer_passthrough_capability()
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
    catalog_source_id: String,
    version: String,
    license: String,
}

#[tauri::command]
fn get_installed_models(data: State<'_, AppData>) -> Result<Vec<InstalledModel>, String> {
    installed_models_in(&data.config_dir.join("models"))
}

fn installed_models_in(models_dir: &Path) -> Result<Vec<InstalledModel>, String> {
    let mut models = Vec::new();
    if let Ok(entries) = std::fs::read_dir(models_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let id = entry.file_name().to_string_lossy().to_string();
                    if is_local_import_staging_name(&id) {
                        continue;
                    }
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
                        catalog_source_id: metadata
                            .get("catalogSourceId")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
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
async fn remove_model(data: State<'_, AppData>, id: String) -> Result<(), String> {
    let _mutation = data.model_mutation_lock.lock().await;
    validate_model_download_file_name(&id).map_err(|_| "Invalid model ID".to_string())?;
    if id.contains("..")
        || id.contains('/')
        || id.contains('\\')
        || is_local_import_staging_name(&id)
    {
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
    if data
        .model_trial_previous
        .lock()
        .map_err(|_| "Model trial lock is poisoned".to_string())?
        .as_ref()
        .is_some_and(|model| {
            PathBuf::from(&model.asset_dir).canonicalize().ok().as_ref()
                == Some(&resolved_model_dir)
        })
    {
        return Err("Finish the model trial before removing the previous model".to_string());
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
    mutation: &tokio::sync::MutexGuard<'_, ()>,
) -> Result<ImportModelResult, String> {
    let result = select_installed_model(data, id, mutation).await?;
    let _ = app.emit("companion:model-imported", result.clone());
    let _ = app.emit("companion:config-changed", public_config_with_ui(data));
    Ok(result)
}

async fn select_installed_model(
    data: &AppData,
    id: &str,
    mutation: &tokio::sync::MutexGuard<'_, ()>,
) -> Result<ImportModelResult, String> {
    validate_model_download_file_name(id).map_err(|_| "Invalid model ID".to_string())?;
    if id.contains("..")
        || id.contains('/')
        || id.contains('\\')
        || is_local_import_staging_name(id)
    {
        return Err("Invalid model ID".to_string());
    }
    let public = public_config_with_ui(data);
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
    commit_model_selection(data, &canonical_model_dir, &skel, model.as_ref(), mutation).await?;
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
        activated: true,
    };
    Ok(result)
}

async fn commit_model_selection(
    data: &AppData,
    asset_dir: &Path,
    skel: &str,
    model: Option<&serde_json::Value>,
    _mutation: &tokio::sync::MutexGuard<'_, ()>,
) -> Result<(), String> {
    // Acquire the asynchronous resource guard before publishing any part of the selection.
    let mut asset_root = data.asset_root.write().await;
    let mut public = data
        .public_config
        .lock()
        .map_err(|_| "Config lock is poisoned".to_string())?;
    write_local_model_config(&data.local_config_path, asset_dir, skel)?;
    verify_local_model_config(&data.local_config_path, asset_dir, skel)?;
    merge_json(
        &mut public,
        serde_json::json!({
            "spine": {
                "assetDir": asset_dir.to_string_lossy().to_string(),
                "assetDirConfigured": !asset_dir.as_os_str().is_empty(),
                "skel": skel,
                "modelCategory": model.and_then(|value| value.get("category")).cloned().unwrap_or_else(|| serde_json::json!("operator")),
                "compatibilityProfile": model.and_then(|value| value.get("compatibilityProfile")).cloned().unwrap_or_else(|| serde_json::json!("companion"))
            }
        }),
    );
    *asset_root = if asset_dir.as_os_str().is_empty() {
        None
    } else {
        Some(asset_dir.to_path_buf())
    };
    Ok(())
}

#[tauri::command]
async fn set_active_model(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    id: String,
) -> Result<ImportModelResult, String> {
    let mutation = data.model_mutation_lock.lock().await;
    let result = activate_installed_model(&app, &data, &id, &mutation).await?;
    clear_model_trial(&data);
    Ok(result)
}

#[tauri::command]
async fn begin_model_trial(
    app: tauri::AppHandle,
    data: State<'_, AppData>,
    id: String,
) -> Result<ImportModelResult, String> {
    let mutation = data.model_mutation_lock.lock().await;
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
    match activate_installed_model(&app, &data, &id, &mutation).await {
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
async fn confirm_model_trial(data: State<'_, AppData>) -> Result<(), String> {
    let _mutation = data.model_mutation_lock.lock().await;
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
    let mutation = data.model_mutation_lock.lock().await;
    let previous = data
        .model_trial_previous
        .lock()
        .map_err(|_| "Model trial lock is poisoned".to_string())?
        .clone();
    let result = match previous {
        Some(model) if !model.id.is_empty() => {
            activate_installed_model(&app, &data, &model.id, &mutation)
                .await
                .map(Some)
        }
        Some(model) => {
            let asset_dir = PathBuf::from(&model.asset_dir);
            if !model.asset_dir.is_empty() || !model.skel.is_empty() {
                validate_spine_asset_dir(&asset_dir, &model.skel)?;
            }
            let asset_dir = if asset_dir.as_os_str().is_empty() {
                asset_dir
            } else {
                asset_dir.canonicalize().unwrap_or(asset_dir)
            };
            commit_model_selection(&data, &asset_dir, &model.skel, None, &mutation).await?;
            let _ = app.emit("companion:config-changed", public_config_with_ui(&data));
            Ok(None)
        }
        None => Ok(None),
    };
    if result.is_ok() {
        clear_model_trial(&data);
    }
    result
}

fn clear_model_trial(data: &AppData) {
    if let Ok(mut previous) = data.model_trial_previous.lock() {
        *previous = None;
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

fn configured_catalog_sources(data: &AppData) -> Result<Vec<catalog::CatalogSource>, String> {
    let public = data
        .public_config
        .lock()
        .map(|config| config.clone())
        .map_err(|_| "Config lock is poisoned".to_string())?;
    let sources = public
        .get("models")
        .and_then(|models| models.get("sources"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    serde_json::from_value(sources).map_err(|error| format!("Model sources are invalid: {error}"))
}

fn load_catalog_cache(config_dir: &Path) -> Result<catalog::CatalogCache, String> {
    let cache_path = config_dir.join("catalog-cache.json");
    if !cache_path.exists() {
        return Ok(catalog::CatalogCache::default());
    }
    let metadata = std::fs::metadata(&cache_path).map_err(|error| error.to_string())?;
    if metadata.len() > 16 * 1024 * 1024 {
        return Err("Cached model catalog exceeds the 16 MiB safety limit.".to_string());
    }
    let bytes = std::fs::read(&cache_path).map_err(|error| error.to_string())?;
    serde_json::from_slice::<catalog::CatalogCache>(&bytes)
        .map_err(|error| format!("Cached model catalog is invalid: {error}"))
}

fn read_catalog_cache(data: &AppData) -> Result<catalog::CatalogCache, String> {
    data.catalog_cache
        .lock()
        .map(|cache| cache.clone())
        .map_err(|_| "Catalog cache lock is poisoned".to_string())
}

fn resolve_catalog_model(
    data: &AppData,
    source_id: &str,
    model_id: &str,
) -> Result<catalog::CatalogModelEntry, String> {
    let sources = configured_catalog_sources(data)?;
    let cache = read_catalog_cache(data)?;
    catalog::resolve_cached_model_entry(&sources, &cache, source_id, model_id)
}

#[tauri::command]
fn get_cached_model_catalogs(
    window: WebviewWindow,
    data: State<'_, AppData>,
) -> Result<catalog::CatalogRefreshResult, String> {
    require_manager_window(&window)?;
    let sources = configured_catalog_sources(&data)?;
    let cache = read_catalog_cache(&data)?;
    Ok(catalog::CatalogRefreshResult {
        models: Vec::new(),
        sources: sources
            .iter()
            .filter(|source| source.enabled)
            .map(|source| catalog::CatalogSourceStatus {
                source_id: source.id.clone(),
                state: if cache.entries.contains_key(&source.id) {
                    catalog::CatalogSourceState::Fresh
                } else {
                    catalog::CatalogSourceState::Failed
                },
                model_count: cache
                    .entries
                    .get(&source.id)
                    .map(|entry| entry.document.models.len())
                    .unwrap_or(0),
                error: None,
            })
            .collect(),
    })
}

fn cleanup_stale_model_downloads(config_dir: &Path) -> u64 {
    let mut removed = 0u64;
    for root in [config_dir.join("models"), config_dir.join("preview-assets")] {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let is_download_dir =
                name.ends_with(".download") || name.ends_with(".preview-download");
            let is_local_staging = is_local_import_staging_name(&name);
            let is_marked_partial = path.join(PARTIAL_DOWNLOAD_MARKER).exists();
            let has_committed_manifest = path.join(".companion-model.json").exists()
                || path.join(".catalog-signature").exists();
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                && (is_local_staging
                    || (is_download_dir && (is_marked_partial || !has_committed_manifest)))
                && std::fs::remove_dir_all(path).is_ok()
            {
                removed += 1;
            }
        }
    }
    removed
}

#[tauri::command]
async fn refresh_model_catalogs(
    window: WebviewWindow,
    data: State<'_, AppData>,
) -> Result<catalog::CatalogRefreshResult, String> {
    require_manager_window(&window)?;
    let sources = configured_catalog_sources(&data)?;
    let cache_path = data.config_dir.join("catalog-cache.json");
    let mut cache = read_catalog_cache(&data)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(safe_download_redirect_policy())
        .build()
        .map_err(|error| error.to_string())?;
    let mut result = catalog::refresh_catalogs(&client, &sources, &mut cache).await;
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
        &cache_path,
        serde_json::to_vec_pretty(&cache).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if let Ok(mut stored) = data.catalog_cache.lock() {
        *stored = cache;
    }
    result.models.clear();
    Ok(result)
}

#[tauri::command]
fn search_model_catalog(
    window: WebviewWindow,
    data: State<'_, AppData>,
    request: catalog::CatalogSearchRequest,
) -> Result<catalog::CatalogSearchResult, String> {
    require_manager_window(&window)?;
    let sources = configured_catalog_sources(&data)?;
    let cache = read_catalog_cache(&data)?;
    let mut models = catalog::cached_enabled_models(&sources, &cache);
    match request.installation_filter.as_str() {
        "installed" => models.retain(|entry| {
            data.config_dir
                .join("models")
                .join(&entry.model.id)
                .is_dir()
        }),
        "available" => models.retain(|entry| {
            !data
                .config_dir
                .join("models")
                .join(&entry.model.id)
                .is_dir()
        }),
        "" | "all" => {}
        _ => return Err("Unknown model installation filter.".to_string()),
    }
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
    let _mutation = data.model_mutation_lock.lock().await;
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
    let integration = ai_integrations::list_ai_integrations_with_state(&data.config_dir)?
        .into_iter()
        .find(|integration| integration.id == tool_id)
        .ok_or_else(|| format!("Unknown AI integration: {tool_id}"))?;
    validate_ai_integration_self_test(
        &integration.name,
        integration.configured,
        integration.needs_restart,
    )?;
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
            "MCP self-test passed, but its result could not be saved: {error}"
        )),
        (Err(error), _) => Err(error),
    }
}

fn validate_ai_integration_self_test(
    name: &str,
    configured: bool,
    needs_restart: bool,
) -> Result<(), String> {
    if !configured {
        return Err(format!(
            "Configure {} before running the Spine Companion MCP self-test.",
            name
        ));
    }
    if needs_restart {
        return Err(format!(
            "Confirm that {} was restarted before running the Spine Companion MCP self-test.",
            name
        ));
    }
    Ok(())
}

async fn test_ai_integration_inner(
    data: &AppData,
    tool_id: &str,
) -> Result<serde_json::Value, String> {
    use tokio::io::AsyncBufReadExt;

    let exe = current_mcp_exe_path()?;
    let api = companion_api_origin_from_data(data);
    let preview = ai_integrations::preview_ai_integration_config(tool_id, &exe, &api)?;
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
                "message": format!("[Spine Companion self-test] {source_label}"),
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
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    *data.drag_state.lock().unwrap() = Some(DragState {
        start_x: point.screen_x,
        start_y: point.screen_y,
        window_x: position.x,
        window_y: position.y,
        scale_factor,
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
        let logical_dx = point
            .total_x
            .or(Some(point.screen_x - drag.start_x))
            .unwrap_or(point.screen_x - drag.start_x);
        let logical_dy = point
            .total_y
            .or(Some(point.screen_y - drag.start_y))
            .unwrap_or(point.screen_y - drag.start_y);
        let dx = physical_drag_delta(logical_dx, drag.scale_factor);
        let dy = physical_drag_delta(logical_dy, drag.scale_factor);
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
#[serde(rename_all = "camelCase")]
struct WindowPosition {
    x: i32,
    y: i32,
    work_area_top: i32,
    height: u32,
}

#[cfg(any(target_os = "windows", test))]
fn dwm_process_changed(previous: Option<u32>, current: Option<u32>) -> bool {
    matches!((previous, current), (Some(previous), Some(current)) if previous != current)
}

#[cfg(target_os = "windows")]
fn current_session_dwm_process_id() -> Option<u32> {
    let mut current_session = 0u32;
    if unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut current_session) } == 0 {
        return None;
    }
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }

    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut result = None;
    let mut fallback = None;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        let name_end = entry
            .szExeFile
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(entry.szExeFile.len());
        let process_name = String::from_utf16_lossy(&entry.szExeFile[..name_end]);
        if process_name.eq_ignore_ascii_case("dwm.exe") {
            fallback.get_or_insert(entry.th32ProcessID);
            let mut process_session = 0u32;
            if unsafe { ProcessIdToSessionId(entry.th32ProcessID, &mut process_session) } != 0
                && process_session == current_session
            {
                result = Some(entry.th32ProcessID);
                break;
            }
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe {
        CloseHandle(snapshot);
    }
    result.or(fallback)
}

#[tauri::command]
fn get_window_position(window: tauri::Window) -> Result<WindowPosition, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let work_area_top = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.work_area().position.y)
        .unwrap_or(0);
    Ok(WindowPosition {
        x: position.x,
        y: position.y,
        work_area_top,
        height: size.height,
    })
}

#[tauri::command]
async fn set_mouse_passthrough(
    window: WebviewWindow,
    data: State<'_, AppData>,
    enabled: bool,
    bounds: Option<PointerBoundsInput>,
) -> Result<(), String> {
    data.passthrough_enabled.store(enabled, Ordering::Relaxed);
    if let Ok(mut current) = data.pointer_regions.lock() {
        *current = normalize_pointer_regions(bounds);
    }
    // macOS and Linux do not yet have the native bounds monitor used on Windows.
    // Keep the window interactive there instead of making touch and pointer input
    // impossible to recover after the WebView starts ignoring cursor events.
    #[cfg(not(target_os = "windows"))]
    if enabled {
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
    }
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
    bounds: Option<PointerBoundsInput>,
) -> Result<(), String> {
    let mut current = data
        .pointer_regions
        .lock()
        .map_err(|_| "Pointer bounds lock is poisoned".to_string())?;
    *current = normalize_pointer_regions(bounds);
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
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
}

fn restore_companion_window_surface(win: &WebviewWindow) {
    let _ = win.set_skip_taskbar(true);
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
        .skip_taskbar(true)
        .visible(false)
        .shadow(false)
        .build()
        .map_err(|error| error.to_string())
        .inspect(|win| {
            let _ = win.set_skip_taskbar(true);
        })
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
    health.status_changed_at = health.last_recovery_at;
    Ok(())
}

fn start_renderer_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut visible_since: Option<Instant> = None;
        let mut last_probe = Instant::now();
        #[cfg(target_os = "windows")]
        let mut last_dwm_process_id = current_session_dwm_process_id();
        #[cfg(target_os = "windows")]
        let mut dwm_probe_tick = 0u8;
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let probe_at = Instant::now();
            let resumed_after_sleep = probe_at.duration_since(last_probe) > Duration::from_secs(6);
            last_probe = probe_at;
            #[cfg(target_os = "windows")]
            {
                dwm_probe_tick = dwm_probe_tick.wrapping_add(1);
                if dwm_probe_tick.is_multiple_of(2) {
                    let current_dwm_process_id = current_session_dwm_process_id();
                    if dwm_process_changed(last_dwm_process_id, current_dwm_process_id) {
                        last_dwm_process_id = current_dwm_process_id;
                        tokio::time::sleep(Duration::from_millis(800)).await;
                        let _ = recreate_main_window(&app, "native-dwm-process-restarted");
                        visible_since = Some(Instant::now());
                        last_probe = Instant::now();
                        continue;
                    }
                    if current_dwm_process_id.is_some() {
                        last_dwm_process_id = current_dwm_process_id;
                    }
                }
            }
            let Some(window) = app.get_webview_window("main") else {
                visible_since = None;
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                visible_since = None;
                continue;
            }
            if resumed_after_sleep {
                visible_since = Some(probe_at);
                let data = app.state::<AppData>();
                let mut health = data.renderer_health.lock().unwrap();
                health.status = "resuming".to_string();
                health.last_reason = "native-resume-grace".to_string();
                health.status_changed_at = now_ms();
                continue;
            }
            let became_visible_at = visible_since.get_or_insert(probe_at);
            if probe_at.duration_since(*became_visible_at) < Duration::from_secs(10) {
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
    if health.last_recovery_at > 0 && now.saturating_sub(health.last_recovery_at) <= 30_000 {
        return false;
    }
    let transition_grace = match health.status.as_str() {
        "starting" => 20_000,
        "suspended" | "resuming" => 12_000,
        _ => 0,
    };
    if transition_grace > 0
        && health.status_changed_at > 0
        && now.saturating_sub(health.status_changed_at) <= transition_grace
    {
        return false;
    }
    if health.last_heartbeat_at == 0 {
        return health.status_changed_at > 0
            && now.saturating_sub(health.status_changed_at) > transition_grace.max(20_000);
    }
    now.saturating_sub(health.last_heartbeat_at) > 8_000
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
    health.status_changed_at = health.last_recovery_at;
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
    let mut health = data.renderer_health.lock().unwrap();
    let mut next = input;
    next.recovery_count = next.recovery_count.max(health.recovery_count);
    next.last_recovery_at = next.last_recovery_at.max(health.last_recovery_at);
    next.status_changed_at = if next.status != health.status {
        now_ms()
    } else if next.status_changed_at > 0 {
        next.status_changed_at
    } else {
        health.status_changed_at
    };
    *health = next;
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
fn cancel_model_download(
    window: WebviewWindow,
    data: State<'_, AppData>,
    id: String,
) -> Result<bool, String> {
    require_manager_window(&window)?;
    let downloads = data
        .download_cancellations
        .lock()
        .map_err(|_| "Download cancellation lock is poisoned".to_string())?;
    let Some(cancellation) = downloads.get(&id) else {
        return Ok(false);
    };
    Ok(cancel_download_state(cancellation.as_ref()))
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    let data = app.state::<AppData>();
    if let Ok(downloads) = data.download_cancellations.lock() {
        for cancellation in downloads.values() {
            cancellation.store(DOWNLOAD_CANCELLED, Ordering::Release);
        }
    }
    cleanup_stale_model_downloads(&data.config_dir);
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
    let normalized = configured.trim().to_ascii_lowercase();
    if normalized.starts_with("zh") {
        return true;
    }
    if !normalized.is_empty() && normalized != "auto" && normalized != "system" {
        return false;
    }
    sys_locale::get_locale()
        .map(|locale| locale.to_ascii_lowercase().starts_with("zh"))
        .unwrap_or(false)
}

fn tray_label(app: &AppHandle, key: &str) -> &'static str {
    tray_text(tray_uses_chinese(app), key)
}

fn tray_text(zh: bool, key: &str) -> &'static str {
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
        (true, "state_idle") => "空闲",
        (true, "state_working") => "工作中",
        (true, "state_reviewing") => "检查中",
        (true, "state_success") => "已完成",
        (true, "state_failed") => "失败",
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
        (false, "state_idle") => "Idle",
        (false, "state_working") => "Working",
        (false, "state_reviewing") => "Reviewing",
        (false, "state_success") => "Success",
        (false, "state_failed") => "Failed",
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
    let state_idle = MenuItem::with_id(
        app,
        "state_idle",
        tray_label(app, "state_idle"),
        true,
        None::<&str>,
    )?;
    let state_working = MenuItem::with_id(
        app,
        "state_working",
        tray_label(app, "state_working"),
        true,
        None::<&str>,
    )?;
    let state_reviewing = MenuItem::with_id(
        app,
        "state_reviewing",
        tray_label(app, "state_reviewing"),
        true,
        None::<&str>,
    )?;
    let state_success = MenuItem::with_id(
        app,
        "state_success",
        tray_label(app, "state_success"),
        true,
        None::<&str>,
    )?;
    let state_failed = MenuItem::with_id(
        app,
        "state_failed",
        tray_label(app, "state_failed"),
        true,
        None::<&str>,
    )?;
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
            !asset
                .get("url")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .is_empty()
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
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--mcp") {
        if let Err(error) = mcp::run_stdio() {
            eprintln!("Spine Companion MCP server failed: {}", error);
            std::process::exit(1);
        }
        return;
    }
    if let Some(command) = read_only_cli_command(&args) {
        match mcp::run_read_only_cli(command, args.iter().any(|arg| arg == "--json")) {
            Ok(true) => {}
            Ok(false) => std::process::exit(2),
            Err(error) => {
                eprintln!("Spine Companion {command} failed: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    let runtime_config = load_runtime_config();
    cleanup_stale_model_downloads(&runtime_config.config_dir);
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
    let catalog_cache_store = Arc::new(Mutex::new(
        load_catalog_cache(&runtime_config.config_dir).unwrap_or_default(),
    ));

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
            pointer_regions: Arc::new(Mutex::new(Vec::new())),
            panel_pinned: Arc::new(AtomicBool::new(false)),
            panel_interaction_locked: Arc::new(AtomicBool::new(false)),
            renderer_health: Arc::new(Mutex::new(RendererHealth::default())),
            catalog_cache: catalog_cache_store,
            ai_integration_lock: Arc::new(Mutex::new(())),
            model_mutation_lock: tokio::sync::Mutex::new(()),
            model_trial_previous: Arc::new(Mutex::new(None)),
            download_cancellations: Arc::new(Mutex::new(HashMap::new())),
        })
        .setup(move |app| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_skip_taskbar(true);
            }
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
            // Subscribe before binding so a state posted as soon as the API is
            // reachable cannot be lost during renderer setup.
            let mut rx = tx.subscribe();
            // Bind the local API server before the hidden window is revealed.
            // The renderer loads Spine assets from this server on startup, so
            // racing the first PIXI load against server startup can leave the
            // transparent window visible with no model.
            if let Err(e) = tauri::async_runtime::block_on(server::start_api_server(
                server::AppState {
                    store: store_for_server,
                    tx: tx_for_server,
                    reminders: reminders_for_server,
                    reminder_tx: reminder_tx_for_server,
                    asset_root: asset_root_for_server,
                    preview_root: preview_root_for_server,
                    public_config: public_config_for_server,
                    history: history_for_server,
                },
                &host_for_server,
                port_for_server,
            )) {
                eprintln!("Failed to start API server: {}", e);
                return Err(e);
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let state = match rx.recv().await {
                        Ok(state) => state,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    };
                    let data = app_handle.state::<AppData>();
                    if let Ok(_guard) = data.ai_integration_lock.lock() {
                        let _ = ai_integrations::record_source_report(
                            &data.config_dir,
                            &state.source,
                            &state.message,
                        );
                    }
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
                loop {
                    let reminders = match reminder_rx.recv().await {
                        Ok(reminders) => reminders,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    };
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
            import_local_model,
            import_catalog_model,
            cancel_model_download,
            prepare_model_preview,
            save_settings,
            save_model_presentation,
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
            get_cached_model_catalogs,
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

fn read_only_cli_command(args: &[String]) -> Option<&'static str> {
    if args.iter().any(|arg| arg == "--doctor") {
        Some("doctor")
    } else if args.iter().any(|arg| arg == "--status") {
        Some("status")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_test_data() -> AppData {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-model-selection-{}-{}",
            std::process::id(),
            NEXT_DOWNLOAD_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let (store, tx) = create_state_store("idle");
        let config = fallback_config();
        let local_config_path = root.join("companion.local.json");
        fs::write(
            &local_config_path,
            br#"{"ui":{"theme":"light"},"spine":{"scale":1.37}}"#,
        )
        .unwrap();
        AppData {
            store,
            tx,
            reminders: create_reminder_store(),
            reminder_tx: create_reminder_broadcast(),
            ui_settings: Arc::new(Mutex::new(ui_settings_from_config(&config))),
            public_config: Arc::new(Mutex::new(config)),
            config_dir: root,
            local_config_path,
            asset_root: Arc::new(tokio::sync::RwLock::new(None)),
            history: Arc::new(Mutex::new(Vec::new())),
            drag_state: Arc::new(Mutex::new(None)),
            passthrough_enabled: Arc::new(AtomicBool::new(false)),
            pointer_regions: Arc::new(Mutex::new(Vec::new())),
            panel_pinned: Arc::new(AtomicBool::new(false)),
            panel_interaction_locked: Arc::new(AtomicBool::new(false)),
            renderer_health: Arc::new(Mutex::new(RendererHealth::default())),
            catalog_cache: Arc::new(Mutex::new(catalog::CatalogCache::default())),
            ai_integration_lock: Arc::new(Mutex::new(())),
            model_mutation_lock: tokio::sync::Mutex::new(()),
            model_trial_previous: Arc::new(Mutex::new(None)),
            download_cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn install_test_model(data: &AppData, id: &str) -> PathBuf {
        let dir = data.config_dir.join("models").join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("model.skel"), b"skeleton").unwrap();
        fs::write(dir.join("model.atlas"), "model.png\nsize: 1,1\n").unwrap();
        fs::write(dir.join("model.png"), b"texture").unwrap();
        dir.canonicalize().unwrap()
    }

    #[tokio::test]
    async fn model_selection_waits_for_asset_root_before_publishing_config() {
        let data = model_test_data();
        let dir = install_test_model(&data, "first");
        let before = fs::read(&data.local_config_path).unwrap();
        let public_before = data.public_config.lock().unwrap().clone();
        let asset_reader = data.asset_root.read().await;
        let mutation = data.model_mutation_lock.lock().await;
        let mut selection = Box::pin(select_installed_model(&data, "first", &mutation));
        // Poll the real selection until it waits for the outstanding asset reader.
        tokio::select! {
            biased;
            result = &mut selection => panic!("Selection should be waiting: {result:?}"),
            () = std::future::ready(()) => {}
        }
        assert_eq!(fs::read(&data.local_config_path).unwrap(), before);
        assert_eq!(*data.public_config.lock().unwrap(), public_before);
        drop(asset_reader);
        selection.await.unwrap();
        verify_local_model_config(&data.local_config_path, &dir, "model.skel").unwrap();
        assert_eq!(*data.asset_root.read().await, Some(dir));
        fs::remove_dir_all(&data.config_dir).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_model_selections_keep_disk_public_config_and_assets_consistent() {
        let data = Arc::new(model_test_data());
        for id in ["first", "second"] {
            install_test_model(&data, id);
        }
        let mut tasks = tokio::task::JoinSet::new();
        for index in 0..16 {
            let data = data.clone();
            tasks.spawn(async move {
                let mutation = data.model_mutation_lock.lock().await;
                let id = if index % 2 == 0 { "first" } else { "second" };
                let selected = select_installed_model(&data, id, &mutation).await.unwrap();
                tokio::task::yield_now().await;
                let dir = PathBuf::from(&selected.asset_dir);
                verify_local_model_config(&data.local_config_path, &dir, &selected.skel).unwrap();
                assert_eq!(*data.asset_root.read().await, Some(dir));
                let public = data.public_config.lock().unwrap();
                assert_eq!(public["spine"]["assetDir"], selected.asset_dir);
                assert_eq!(public["spine"]["skel"], selected.skel);
            });
        }
        while let Some(result) = tasks.join_next().await {
            result.unwrap();
        }
        let saved = read_json_if_exists(&data.local_config_path).unwrap();
        assert_eq!(saved["ui"]["theme"], "light");
        assert_eq!(saved["spine"]["scale"], 1.37);
        fs::remove_dir_all(&data.config_dir).unwrap();
    }

    #[tokio::test]
    async fn failed_model_selection_preserves_the_current_model() {
        let data = model_test_data();
        let dir = install_test_model(&data, "first");
        let mutation = data.model_mutation_lock.lock().await;
        select_installed_model(&data, "first", &mutation)
            .await
            .unwrap();
        let before = fs::read(&data.local_config_path).unwrap();
        let public_before = data.public_config.lock().unwrap().clone();
        for invalid in ["", ".", "..", "../first", "first/other"] {
            assert!(select_installed_model(&data, invalid, &mutation)
                .await
                .is_err());
        }
        assert!(select_installed_model(&data, "missing", &mutation)
            .await
            .is_err());
        assert_eq!(fs::read(&data.local_config_path).unwrap(), before);
        assert_eq!(*data.public_config.lock().unwrap(), public_before);
        assert_eq!(*data.asset_root.read().await, Some(dir));
        fs::remove_dir_all(&data.config_dir).unwrap();
    }

    #[tokio::test]
    async fn model_selection_can_restore_an_unconfigured_profile() {
        let data = model_test_data();
        install_test_model(&data, "first");
        let mutation = data.model_mutation_lock.lock().await;
        select_installed_model(&data, "first", &mutation)
            .await
            .unwrap();
        commit_model_selection(&data, Path::new(""), "", None, &mutation)
            .await
            .unwrap();
        assert_eq!(*data.asset_root.read().await, None);
        let public = data.public_config.lock().unwrap().clone();
        assert_eq!(public["spine"]["assetDirConfigured"], false);
        assert_eq!(public["spine"]["assetDir"], "");
        verify_local_model_config(&data.local_config_path, Path::new(""), "").unwrap();
        fs::remove_dir_all(&data.config_dir).unwrap();
    }

    #[tokio::test]
    async fn local_import_staging_is_never_listed_or_selected_as_a_model() {
        let data = model_test_data();
        install_test_model(&data, "first");
        let temporary_id = ".local-first-0123456789ab-local-import-42.staging";
        install_test_model(&data, temporary_id);
        let models = installed_models_in(&data.config_dir.join("models")).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "first");
        let mutation = data.model_mutation_lock.lock().await;
        assert!(select_installed_model(&data, temporary_id, &mutation)
            .await
            .is_err());
        assert_eq!(*data.asset_root.read().await, None);
        fs::remove_dir_all(&data.config_dir).unwrap();
    }

    #[test]
    fn interrupted_local_import_cleanup_preserves_unrelated_staging_directories() {
        let data = model_test_data();
        let temporary_id = ".local-first-0123456789ab-local-import-42.staging";
        let temporary = install_test_model(&data, temporary_id);
        fs::write(temporary.join(".companion-model.json"), b"{}").unwrap();
        let ordinary = install_test_model(&data, "first");
        let unrelated = install_test_model(&data, "user.staging");
        let malformed = install_test_model(&data, ".local-first-local-import-not-a-number.staging");
        assert_eq!(cleanup_stale_model_downloads(&data.config_dir), 1);
        assert!(!temporary.exists());
        assert!(ordinary.exists());
        assert!(unrelated.exists());
        assert!(malformed.exists());
        fs::remove_dir_all(&data.config_dir).unwrap();
    }

    #[test]
    fn packaged_server_config_advertises_sse_without_websocket() {
        let server = public_server_config("http://127.0.0.1:17388");
        assert_eq!(server["eventsUrl"], "http://127.0.0.1:17388/events");
        assert!(server.get("websocketUrl").is_none());
    }

    #[test]
    fn model_import_activation_is_explicitly_overridable() {
        let legacy: ImportModelInput =
            serde_json::from_value(serde_json::json!({ "id": "model" })).unwrap();
        let install_only: ImportModelInput = serde_json::from_value(serde_json::json!({
            "id": "model",
            "activate": false
        }))
        .unwrap();
        assert!(legacy.activate);
        assert!(!install_only.activate);
    }

    #[test]
    fn verifies_immutable_git_blob_digests() {
        assert!(
            verify_git_blob_sha(b"hello\n", "ce013625030ba8dba906f756967f9e9ca394464a").is_ok()
        );
        assert!(
            verify_git_blob_sha(b"changed", "ce013625030ba8dba906f756967f9e9ca394464a").is_err()
        );
    }

    #[test]
    fn renderer_watchdog_requires_timeout_and_recovery_cooldown() {
        let mut health = RendererHealth {
            status: "ok".to_string(),
            last_heartbeat_at: 1_000,
            status_changed_at: 1_000,
            ..RendererHealth::default()
        };
        assert!(!renderer_heartbeat_stale(&health, 8_999));
        assert!(renderer_heartbeat_stale(&health, 20_000));
        health.last_recovery_at = 18_000;
        assert!(!renderer_heartbeat_stale(&health, 20_000));
        health.status = "suspended".to_string();
        health.last_recovery_at = 0;
        health.status_changed_at = 18_000;
        assert!(!renderer_heartbeat_stale(&health, 20_000));
        assert!(renderer_heartbeat_stale(&health, 31_000));
        health.status = "starting".to_string();
        health.last_heartbeat_at = 0;
        health.status_changed_at = 1_000;
        assert!(!renderer_heartbeat_stale(&health, 20_000));
        assert!(renderer_heartbeat_stale(&health, 22_000));
    }

    #[test]
    fn renderer_watchdog_only_treats_confirmed_dwm_pid_changes_as_restarts() {
        assert!(!dwm_process_changed(None, None));
        assert!(!dwm_process_changed(None, Some(100)));
        assert!(!dwm_process_changed(Some(100), None));
        assert!(!dwm_process_changed(Some(100), Some(100)));
        assert!(dwm_process_changed(Some(100), Some(101)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn renderer_watchdog_finds_the_current_session_dwm_process() {
        assert!(current_session_dwm_process_id().is_some());
    }

    #[test]
    fn pointer_passthrough_uses_tight_entry_and_delayed_exit() {
        assert!(!should_ignore_cursor(
            true,
            false,
            true,
            true,
            true,
            Duration::ZERO
        ));
        assert!(!should_ignore_cursor(
            true,
            false,
            false,
            false,
            false,
            Duration::from_millis(79)
        ));
        assert!(should_ignore_cursor(
            true,
            false,
            false,
            false,
            false,
            Duration::from_millis(80)
        ));
        assert!(!should_ignore_cursor(
            true,
            true,
            true,
            false,
            false,
            Duration::from_secs(1)
        ));
    }

    #[test]
    fn pointer_regions_accept_legacy_payloads_and_cap_multi_region_updates() {
        let legacy = PointerBounds {
            left: 10.0,
            right: 20.0,
            top: 30.0,
            bottom: 40.0,
        };
        assert_eq!(
            normalize_pointer_regions(Some(PointerBoundsInput::Single(legacy))).len(),
            1
        );

        let mut regions = vec![legacy; 20];
        regions.push(PointerBounds {
            left: 10.0,
            right: 10.0,
            top: 30.0,
            bottom: 40.0,
        });
        assert_eq!(
            normalize_pointer_regions(Some(PointerBoundsInput::Multiple(regions))).len(),
            16
        );
    }

    #[test]
    fn drag_deltas_convert_css_pixels_to_physical_pixels() {
        assert_eq!(physical_drag_delta(80.0, 1.0), 80);
        assert_eq!(physical_drag_delta(80.0, 1.25), 100);
        assert_eq!(physical_drag_delta(80.0, 1.5), 120);
        assert_eq!(physical_drag_delta(-40.0, 2.0), -80);
        assert_eq!(physical_drag_delta(f64::NAN, 1.5), 0);
        assert_eq!(physical_drag_delta(80.0, f64::NAN), 80);
    }

    #[test]
    fn active_model_presentation_overlays_defaults_without_leaking_to_the_next_model() {
        let mut public = serde_json::json!({
            "server": { "origin": "http://127.0.0.1:17388" },
            "spine": {
                "assetDir": "",
                "skel": "alpha.skel",
                "scale": 0.86,
                "offsetX": 0,
                "offsetY": -18,
                "presentationDefaults": { "scale": 0.86, "offsetX": 0, "offsetY": -18, "fitMode": "legacy" }
            },
            "models": {
                "catalog": [
                    { "id": "alpha", "skel": "alpha.skel", "category": "illustration", "compatibilityProfile": "idle-only" },
                    { "id": "beta", "skel": "beta.skel", "category": "operator", "compatibilityProfile": "companion" }
                ],
                "presentations": {
                    "alpha": { "scale": 1.2, "offsetX": 12, "offsetY": -30, "fitMode": "full" }
                }
            }
        });
        refresh_public_asset_fields(&mut public);
        assert_eq!(public["spine"]["modelId"], "alpha");
        assert_eq!(public["spine"]["scale"], 1.2);
        assert_eq!(public["spine"]["fitMode"], "full");

        public["spine"]["skel"] = serde_json::json!("beta.skel");
        refresh_public_asset_fields(&mut public);
        assert_eq!(public["spine"]["modelId"], "beta");
        assert_eq!(public["spine"]["scale"], 0.86);
        assert_eq!(public["spine"]["offsetY"], -18);
        assert_eq!(public["spine"]["fitMode"], "legacy");
    }

    #[test]
    fn model_presentation_validation_is_bounded_and_explicit() {
        let valid = ModelPresentationInput {
            model_id: "alpha".to_string(),
            scale: 1.0,
            offset_x: 0.0,
            offset_y: -18.0,
            fit_mode: "character".to_string(),
        };
        assert!(validate_model_presentation(&valid).is_ok());
        assert!(validate_model_presentation(&ModelPresentationInput {
            scale: 3.0,
            ..valid.clone()
        })
        .is_err());
        assert!(validate_model_presentation(&ModelPresentationInput {
            fit_mode: "crop".to_string(),
            ..valid
        })
        .is_err());
    }

    #[test]
    fn tray_description_localizes_native_state_items() {
        assert_eq!(tray_text(false, "state_reviewing"), "Reviewing");
        assert_eq!(tray_text(true, "state_reviewing"), "检查中");
        assert_eq!(tray_text(true, "restart"), "重启渲染器");
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
    fn model_download_limits_cover_chunked_responses_and_safe_paths() {
        assert_eq!(checked_download_size(60, 4, 64).unwrap(), 64);
        assert!(checked_download_size(60, 5, 64).is_err());
        assert!(validate_https_download_url("https://example.com/model.skel").is_ok());
        assert!(validate_https_download_url("http://example.com/model.skel").is_err());
        assert!(validate_download_redirect(
            "https://example.com/model.skel",
            4,
            Some("example.com")
        )
        .is_ok());
        assert!(
            validate_download_redirect("https://127.0.0.1/model.skel", 0, Some("127.0.0.1"))
                .is_err()
        );
        assert!(validate_download_redirect(
            "https://192.168.1.20/model.skel",
            0,
            Some("192.168.1.20")
        )
        .is_err());
        assert!(validate_download_redirect(
            "http://example.com/model.skel",
            0,
            Some("example.com")
        )
        .is_err());
        assert!(validate_download_redirect(
            "https://cdn.example.com/model.skel",
            0,
            Some("example.com")
        )
        .is_err());
        assert!(validate_download_redirect(
            "https://example.com/model.skel",
            5,
            Some("example.com")
        )
        .is_err());
        assert!(validate_model_download_file_name("model.skel").is_ok());
        assert!(validate_model_download_file_name("../model.skel").is_err());
        assert!(validate_model_download_file_name("nested/model.skel").is_err());
    }

    #[test]
    fn model_download_cancellation_and_commit_are_mutually_exclusive() {
        let cancelled = AtomicU8::new(DOWNLOAD_ACTIVE);
        assert!(cancel_download_state(&cancelled));
        assert!(begin_download_commit(&cancelled).is_err());

        let committing = AtomicU8::new(DOWNLOAD_ACTIVE);
        begin_download_commit(&committing).unwrap();
        assert!(!cancel_download_state(&committing));

        let previous = Arc::new(AtomicU8::new(DOWNLOAD_COMMITTING));
        let next = Arc::new(AtomicU8::new(DOWNLOAD_ACTIVE));
        let mut downloads = HashMap::from([("amiya".to_string(), previous.clone())]);
        assert!(register_model_download(&mut downloads, "amiya", next).is_err());
        assert!(Arc::ptr_eq(downloads.get("amiya").unwrap(), &previous));
    }

    #[test]
    fn concurrent_model_downloads_use_distinct_staging_directories() {
        let root = Path::new("model-cache");
        let first = model_download_temp_dir(root, "amiya", 1);
        let second = model_download_temp_dir(root, "amiya", 2);
        assert_ne!(first, second);
        assert!(first.to_string_lossy().ends_with(".download"));
        assert!(second.to_string_lossy().ends_with(".download"));
    }

    #[test]
    fn stale_download_cleanup_only_removes_download_directories() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-download-cleanup-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let models = root.join("models");
        let previews = root.join("preview-assets");
        std::fs::create_dir_all(models.join("keep-model")).unwrap();
        std::fs::create_dir_all(models.join("old.download")).unwrap();
        std::fs::create_dir_all(previews.join("old.preview-download")).unwrap();
        std::fs::create_dir_all(models.join("valid.download")).unwrap();
        std::fs::write(models.join("valid.download/.companion-model.json"), b"{}").unwrap();
        std::fs::create_dir_all(models.join("marked.download")).unwrap();
        std::fs::write(models.join("marked.download/.companion-model.json"), b"{}").unwrap();
        std::fs::write(
            models.join("marked.download/.companion-partial-download"),
            b"",
        )
        .unwrap();
        std::fs::create_dir_all(previews.join("valid.preview-download")).unwrap();
        std::fs::write(
            previews.join("valid.preview-download/.catalog-signature"),
            b"saved",
        )
        .unwrap();
        std::fs::create_dir_all(previews.join("marked.preview-download")).unwrap();
        std::fs::write(
            previews.join("marked.preview-download/.catalog-signature"),
            b"partial",
        )
        .unwrap();
        std::fs::write(
            previews.join("marked.preview-download/.companion-partial-download"),
            b"",
        )
        .unwrap();
        assert_eq!(cleanup_stale_model_downloads(&root), 4);
        assert!(models.join("keep-model").exists());
        assert!(!models.join("old.download").exists());
        assert!(!previews.join("old.preview-download").exists());
        assert!(models.join("valid.download").exists());
        assert!(previews.join("valid.preview-download").exists());
        assert!(!models.join("marked.download").exists());
        assert!(!previews.join("marked.preview-download").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn downloaded_model_metadata_is_written_before_directory_activation() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-model-metadata-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let model = serde_json::json!({
            "id": "illustration-amiya",
            "name": "Amiya Illustration",
            "category": "illustration",
            "skel": "amiya.skel"
        });

        write_model_metadata(&root, &model).unwrap();

        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join(".companion-model.json")).unwrap())
                .unwrap();
        assert_eq!(
            saved.get("category").and_then(|value| value.as_str()),
            Some("illustration")
        );
        let _ = std::fs::remove_dir_all(root);
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
    fn preview_cache_pruning_keeps_current_model_and_limits_completed_entries() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("spine-companion-preview-test-{}", suffix));
        for name in ["current", "older-a", "older-b", "pending.preview-download"] {
            std::fs::create_dir_all(root.join(name)).unwrap();
        }
        prune_preview_asset_cache(&root, "current", 2, u64::MAX);
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
    fn preview_cache_pruning_limits_total_bytes_without_removing_current_model() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("spine-companion-preview-size-test-{}", suffix));
        for name in ["current", "older-a", "older-b"] {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("model.bin"), [0_u8; 4]).unwrap();
        }
        prune_preview_asset_cache(&root, "current", 10, 5);
        assert!(root.join("current").exists());
        assert_eq!(directory_size_bytes(&root), 4);
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
    fn ai_integration_self_test_requires_configured_restarted_client() {
        assert!(validate_ai_integration_self_test("Codex", true, false).is_ok());
        assert!(validate_ai_integration_self_test("Codex", false, false)
            .unwrap_err()
            .contains("Configure Codex"));
        assert!(validate_ai_integration_self_test("Codex", true, true)
            .unwrap_err()
            .contains("Confirm that Codex was restarted"));
    }

    #[test]
    fn selects_read_only_cli_without_starting_the_desktop_runtime() {
        assert_eq!(
            read_only_cli_command(&["--status".to_string(), "--json".to_string()]),
            Some("status")
        );
        assert_eq!(
            read_only_cli_command(&["--doctor".to_string()]),
            Some("doctor")
        );
        assert_eq!(read_only_cli_command(&["--mcp".to_string()]), None);
    }

    #[test]
    fn local_import_selects_matching_atlas_and_referenced_pages_only() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-local-import-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("amiya.skel"), b"skeleton").unwrap();
        std::fs::write(root.join("amiya.atlas"), b"amiya.png\nsize: 1,1\n").unwrap();
        std::fs::write(root.join("other.atlas"), b"other.png\nsize: 1,1\n").unwrap();
        std::fs::write(root.join("amiya.png"), b"texture").unwrap();
        std::fs::write(root.join("other.png"), b"texture").unwrap();

        let files = local_runtime_files(&root, "amiya.skel").unwrap();
        assert_eq!(files, vec!["amiya.atlas", "amiya.png", "amiya.skel"]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn local_import_accepts_a_sole_atlas_with_a_different_name() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-local-import-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("character.skel"), b"skeleton").unwrap();
        std::fs::write(root.join("shared.atlas"), b"page.png\nsize: 1,1\n").unwrap();
        std::fs::write(root.join("page.png"), b"texture").unwrap();

        let files = local_runtime_files(&root, "character.skel").unwrap();
        assert_eq!(files, vec!["character.skel", "page.png", "shared.atlas"]);
        let selection = local_runtime_selection(&root, "character.skel").unwrap();
        assert_eq!(selection.atlas_destination, "character.atlas");
        assert_eq!(
            rewrite_local_atlas(&selection.atlas_text, &selection.texture_sources),
            "page.png\nsize: 1,1\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn local_import_rebases_nested_atlas_pages_to_the_staged_skeleton_root() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-local-import-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("atlases")).unwrap();
        std::fs::create_dir_all(root.join("atlases").join("pages")).unwrap();
        std::fs::write(root.join("character.skel"), b"skeleton").unwrap();
        std::fs::write(
            root.join("atlases").join("shared.atlas"),
            "pages/page.png\nsize: 1,1\n",
        )
        .unwrap();
        std::fs::write(
            root.join("atlases").join("pages").join("page.png"),
            b"texture",
        )
        .unwrap();

        let selection = local_runtime_selection(&root, "character.skel").unwrap();
        assert_eq!(selection.atlas_destination, "character.atlas");
        assert_eq!(
            selection.texture_sources,
            vec!["atlases/pages/page.png".to_string()]
        );
        assert_eq!(
            rewrite_local_atlas(&selection.atlas_text, &selection.texture_sources),
            "atlases/pages/page.png\nsize: 1,1\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn local_import_rejects_ambiguous_atlas_selection() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-local-import-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("amiya.skel"), b"skeleton").unwrap();
        std::fs::write(root.join("amiya.atlas"), b"amiya.png\nsize: 1,1\n").unwrap();
        std::fs::create_dir_all(root.join("alternate")).unwrap();
        std::fs::write(
            root.join("alternate").join("amiya.atlas"),
            b"amiya.png\nsize: 1,1\n",
        )
        .unwrap();
        std::fs::write(root.join("amiya.png"), b"texture").unwrap();
        std::fs::write(root.join("alternate").join("amiya.png"), b"texture").unwrap();

        let error = local_runtime_files(&root, "amiya.skel").unwrap_err();
        assert!(error.contains("Multiple atlas files"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn local_import_ids_are_stable_per_source_path() {
        let first = local_model_id(Path::new("C:/models/amiya"), "Amiya", "model.skel");
        let second = local_model_id(Path::new("C:/models/amiya"), "Amiya", "model.skel");
        let other = local_model_id(Path::new("C:/models/exusiai"), "Amiya", "model.skel");
        let sibling = local_model_id(Path::new("C:/models/amiya"), "Amiya", "alt.skel");
        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_ne!(first, sibling);
        assert!(first.starts_with("local-amiya-"));
    }

    #[test]
    fn local_import_rejects_invalid_or_unsupported_skeleton_headers() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-local-import-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let encode = |value: &str| {
            let mut bytes = Vec::with_capacity(value.len() + 2);
            bytes.push((value.len() as u8).saturating_add(1));
            bytes.extend_from_slice(value.as_bytes());
            bytes
        };
        let mut valid = encode("hash");
        valid.extend(encode("3.8.99"));
        valid.resize(128 * 1024, 0);
        let valid_path = root.join("valid.skel");
        std::fs::write(&valid_path, valid).unwrap();
        assert_eq!(
            validate_local_skeleton_header(&valid_path).unwrap(),
            "3.8.99"
        );

        let invalid_path = root.join("invalid.skel");
        std::fs::write(&invalid_path, b"not-spine").unwrap();
        assert!(validate_local_skeleton_header(&invalid_path)
            .unwrap_err()
            .contains("not a valid Spine binary"));

        let mut unsupported = encode("hash");
        unsupported.extend(encode("4.0.0"));
        let unsupported_path = root.join("unsupported.skel");
        std::fs::write(&unsupported_path, unsupported).unwrap();
        assert!(validate_local_skeleton_header(&unsupported_path)
            .unwrap_err()
            .contains("expected Spine 3.8"));

        let mut misleading = encode("hash");
        misleading.extend(encode("3.80.0"));
        std::fs::write(&unsupported_path, misleading).unwrap();
        assert!(validate_local_skeleton_header(&unsupported_path).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
