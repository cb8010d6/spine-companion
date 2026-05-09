mod server;
mod state;

use state::{
    create_reminder, create_reminder_store, create_state_store, set_state, CompanionState,
    CreateReminderInput, Reminder, ReminderStore, SetStateInput, StateBroadcast, StateStore,
};
use std::path::{Path, PathBuf};
use tauri::{
    Emitter,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

struct AppData {
    store: StateStore,
    tx: StateBroadcast,
    reminders: ReminderStore,
    public_config: serde_json::Value,
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
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("companion.local.json"));
        }
    }
    if let Some(dir) = user_config_dir() {
        candidates.push(dir.join("companion.local.json"));
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

#[derive(Clone)]
struct RuntimeConfig {
    public: serde_json::Value,
    host: String,
    port: u16,
    initial_state: String,
    asset_root: Option<PathBuf>,
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
    for candidate in local_config_candidates(&root) {
        if let Some(local) = read_json_if_exists(&candidate) {
            merge_json(&mut config, local);
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
    let asset_dir = resolve_asset_dir(&root, raw_asset_dir);
    config["spine"]["assetDir"] = serde_json::Value::String(asset_dir.clone());
    let skel = string_at(&config, &["spine", "skel"]).unwrap_or("amiya.skel");

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
    }
}

#[tauri::command]
async fn get_config(data: State<'_, AppData>) -> Result<serde_json::Value, String> {
    Ok(data.public_config.clone())
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
async fn start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_mouse_passthrough(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())
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
    let asset_root_for_server = runtime_config.asset_root.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppData {
            store: store.clone(),
            tx: tx.clone(),
            reminders: reminders.clone(),
            public_config: runtime_config.public.clone(),
        })
        .setup(move |app| {
            // Start the local API server on a background task
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    server::start_api_server(
                        store_for_server,
                        tx_for_server,
                        reminders_for_server,
                        asset_root_for_server,
                        &host_for_server,
                        port_for_server,
                    )
                        .await
                {
                    eprintln!("Failed to start API server: {}", e);
                }
            });

            let app_handle = app.handle().clone();
            let mut rx = tx.subscribe();
            tauri::async_runtime::spawn(async move {
                while let Ok(state) = rx.recv().await {
                    let _ = app_handle.emit("companion:state", state);
                }
            });

            // Build tray menu
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show_item, &sep, &quit_item])?;

            TrayIconBuilder::new()
                .tooltip("Spine Companion")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Show main window after setup
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            get_state,
            set_companion_state,
            create_reminder_cmd,
            start_drag,
            set_mouse_passthrough,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
