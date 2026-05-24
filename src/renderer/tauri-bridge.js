/**
 * Tauri bridge — replaces Electron's preload.cjs / contextBridge.
 *
 * The renderer checks for `window.companion` (Electron) first.
 * When running under Tauri, `window.__TAURI__` is defined instead.
 * This module detects the runtime and provides a unified API.
 */

let _tauriInvoke = null;
let _tauriListen = null;

async function loadTauri() {
  if (_tauriInvoke) return;
  const core = await import("@tauri-apps/api/core");
  const event = await import("@tauri-apps/api/event");
  _tauriInvoke = core.invoke;
  _tauriListen = event.listen;
}

export function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function initTauriBridge() {
  if (!isTauri()) return;
  await loadTauri();

  // Expose the same `window.companion` API that the Electron preload provides
  window.companion = {
    getConfig: () => _tauriInvoke("get_config"),
    getState: () => _tauriInvoke("get_state"),
    setState: (state) => _tauriInvoke("set_companion_state", { input: state }),
    createReminder: (reminder) => _tauriInvoke("create_reminder_cmd", { input: reminder }),
    listReminders: () => _tauriInvoke("list_reminders_cmd"),
    deleteReminder: (id) => _tauriInvoke("delete_reminder_cmd", { id }),
    setUiSettings: (settings) => _tauriInvoke("set_ui_settings", { input: settings }),
    saveSettings: (patch) => _tauriInvoke("save_settings", { input: { patch } }),
    getDiagnostics: () => _tauriInvoke("get_diagnostics"),
    exportLogs: () => _tauriInvoke("export_logs"),
    getInstalledModels: () => _tauriInvoke("get_installed_models"),
    getHistory: () => _tauriInvoke("get_history"),
    getCurrentModel: () => _tauriInvoke("get_current_model"),
    setActiveModel: (id) => _tauriInvoke("set_active_model", { id }),
    checkUpdates: () => _tauriInvoke("check_updates"),
    openExternal: (url) => _tauriInvoke("open_url", { url }),
    setAutoLaunch: (enabled) => _tauriInvoke("set_auto_launch", { enabled: Boolean(enabled) }),
    removeModel: (id) => _tauriInvoke("remove_model", { id }),
    openFolder: (p) => _tauriInvoke("open_folder", { p }),
    openManager: () => _tauriInvoke("open_manager_window"),
    setPanelPinned: () => Promise.resolve(false),
    closePanel: () => _tauriInvoke("hide_panel_window"),
    quitApp: () => _tauriInvoke("quit_app"),
    emitScale: (payload) => _tauriInvoke("emit_scale_event", { input: payload }),
    importModel: (input) => _tauriInvoke("import_model", { input }),
    onState: (callback) => {
      // Listen for state updates from the Rust backend
      let unlisten = null;
      _tauriListen("companion:state", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onUi: (callback) => {
      let unlisten = null;
      _tauriListen("companion:ui", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onScale: (callback) => {
      let unlisten = null;
      _tauriListen("companion:scale", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onModelImported: (callback) => {
      let unlisten = null;
      _tauriListen("companion:model-imported", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onConfigChanged: (callback) => {
      let unlisten = null;
      _tauriListen("companion:config-changed", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onDownloadProgress: (callback) => {
      let unlisten = null;
      _tauriListen("companion:download-progress", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onNotificationDismiss: () => () => {},
    dragStart: (point) => _tauriInvoke("start_drag", { point }),
    dragMove: (point) => _tauriInvoke("move_drag", { point }).catch(() => {}),
    dragEnd: () => _tauriInvoke("end_drag").catch(() => {}),
    revealWindow: () => _tauriInvoke("reveal_window"),
    rendererReady: () => _tauriInvoke("reveal_window"),
    setMousePassthrough: (enabled, bounds) => _tauriInvoke("set_mouse_passthrough", {
      enabled: Boolean(enabled),
      bounds: bounds || null
    })
  };
}
