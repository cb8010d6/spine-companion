mod server;
mod state;

use state::{create_state_store, set_state, CompanionState, SetStateInput, StateBroadcast, StateStore};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

struct AppData {
    store: StateStore,
    tx: StateBroadcast,
}

#[tauri::command]
async fn get_config() -> Result<serde_json::Value, String> {
    // Return minimal config for the renderer
    Ok(serde_json::json!({
        "window": { "width": 360, "height": 460, "alwaysOnTop": true, "transparent": true },
        "server": {
            "origin": "http://127.0.0.1:17388",
            "stateUrl": "http://127.0.0.1:17388/state",
            "eventsUrl": "http://127.0.0.1:17388/events",
            "websocketUrl": "ws://127.0.0.1:17388/ws"
        },
        "spine": {
            "skel": "amiya.skel",
            "assetUrl": "http://127.0.0.1:17388/assets/spine/amiya.skel",
            "assetDirConfigured": false,
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
        "state": { "initial": "idle", "pollMs": 1000 },
        "specialSegments": {
            "review": { "from": 2.6, "to": 4.35, "loop": true },
            "success": { "from": 4.4, "to": 7.2, "loop": false },
            "special": { "from": 0, "to": 14.433, "loop": true }
        }
    }))
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
    let (store, tx) = create_state_store("idle");
    let store_for_server = store.clone();
    let tx_for_server = tx.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppData {
            store: store.clone(),
            tx: tx.clone(),
        })
        .setup(move |app| {
            // Start the local API server on a background task
            let rt = tokio::runtime::Handle::current();
            rt.spawn(async move {
                if let Err(e) =
                    server::start_api_server(store_for_server, tx_for_server, "127.0.0.1", 17388)
                        .await
                {
                    eprintln!("Failed to start API server: {}", e);
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
            start_drag,
            set_mouse_passthrough,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
