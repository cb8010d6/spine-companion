/**
 * Tauri bridge — replaces Electron's preload.cjs / contextBridge.
 *
 * The renderer checks for `window.companion` (Electron) first.
 * When running under Tauri, `window.__TAURI__` is defined instead.
 * This module detects the runtime and provides a unified API.
 */

let _tauriInvoke = null;
let _tauriListen = null;
let _tauriWindow = null;

async function loadTauri() {
  if (_tauriInvoke) return;
  const core = await import("@tauri-apps/api/core");
  const event = await import("@tauri-apps/api/event");
  const windowApi = await import("@tauri-apps/api/window");
  _tauriInvoke = core.invoke;
  _tauriListen = event.listen;
  _tauriWindow = windowApi.getCurrentWindow();
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
    exportDiagnostics: () => _tauriInvoke("export_diagnostics_report"),
    getInstalledModels: () => _tauriInvoke("get_installed_models"),
    getHistory: () => _tauriInvoke("get_history"),
    getCurrentModel: () => _tauriInvoke("get_current_model"),
    setActiveModel: (id) => _tauriInvoke("set_active_model", { id }),
    checkUpdates: () => _tauriInvoke("check_updates"),
    openExternal: (url) => _tauriInvoke("open_url", { url }),
    setAutoLaunch: (enabled) => _tauriInvoke("set_auto_launch", { enabled: Boolean(enabled) }),
    listAiIntegrations: () => _tauriInvoke("list_ai_integrations"),
    previewAiIntegrationConfig: (id) => _tauriInvoke("preview_ai_integration_config", { toolId: id }),
    configureAiIntegration: (id) => _tauriInvoke("configure_ai_integration", { toolId: id }),
    openAiIntegrationConfig: (id) => _tauriInvoke("open_ai_integration_config", { toolId: id }),
    copyAiIntegrationTemplate: (id = null) => _tauriInvoke("copy_ai_integration_template", { toolId: id }),
    copyCustomAiIntegrationTemplate: (input) => _tauriInvoke("copy_custom_ai_integration_template", { input }),
    generateAiIntegrationInstructions: (id) => _tauriInvoke("generate_ai_integration_instructions", { toolId: id }),
    installAiIntegrationInstructions: (id) => _tauriInvoke("install_ai_integration_instructions", { toolId: id }),
    acknowledgeAiIntegrationRestart: (id) => _tauriInvoke("acknowledge_ai_integration_restart", { toolId: id }),
    restoreAiIntegrationBackup: (id) => _tauriInvoke("restore_ai_integration_backup", { toolId: id }),
    testAiIntegration: (id) => _tauriInvoke("test_ai_integration", { toolId: id }),
    avatarRequirements: () => _tauriInvoke("avatar_requirements"),
    listAvatarPacks: () => _tauriInvoke("list_avatar_packs"),
    pickAvatarPackFolder: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      return open({ directory: true, multiple: false, title: "Select avatar pack folder" });
    },
    validateAvatarPack: (path) => _tauriInvoke("validate_avatar_pack", { input: { path } }),
    importAvatarPack: (path) => _tauriInvoke("import_avatar_pack", { input: { path } }),
    removeModel: (id) => _tauriInvoke("remove_model", { id }),
    openFolder: (p) => _tauriInvoke("open_folder", { p }),
    openManager: () => _tauriInvoke("open_manager_window"),
    setPanelPinned: (pinned) => _tauriInvoke("set_panel_pinned", { pinned: Boolean(pinned) }),
    setPanelInteractionLock: (locked) => _tauriInvoke("set_panel_interaction_lock", { locked: Boolean(locked) }),
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
    onNotification: (callback) => {
      let unlisten = null;
      _tauriListen("companion:notification", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    onReminders: (callback) => {
      let unlisten = null;
      _tauriListen("companion:reminders", (event) => {
        callback(event.payload);
      }).then((fn) => { unlisten = fn; });
      return () => { if (unlisten) unlisten(); };
    },
    dragStart: (point) => _tauriInvoke("start_drag", { point }),
    dragMove: (point) => _tauriInvoke("move_drag", { point }).catch(() => {}),
    dragEnd: () => _tauriInvoke("end_drag").catch(() => {}),
    nativeStartDrag: () => _tauriWindow.startDragging(),
    getWindowPosition: () => _tauriInvoke("get_window_position"),
    revealWindow: () => _tauriInvoke("reveal_window"),
    rendererReady: () => _tauriInvoke("reveal_window"),
    recoverGpuWindow: (payload = {}) => _tauriInvoke("recover_gpu_window", {
      reason: String(payload.reason || "")
    }).catch(() => {}),
    restartRenderer: (payload = {}) => _tauriInvoke("restart_renderer", {
      reason: String(payload.reason || "")
    }),
    clearGpuCache: () => _tauriInvoke("clear_webview_gpu_cache"),
    getRendererHealth: () => _tauriInvoke("get_renderer_health"),
    updateRendererHealth: (input) => _tauriInvoke("update_renderer_health", { input }),
    setMousePassthrough: (enabled, bounds) => _tauriInvoke("set_mouse_passthrough", {
      enabled: Boolean(enabled),
      bounds: bounds || null
    }),
    updatePointerBounds: (bounds) => _tauriInvoke("update_pointer_bounds", { bounds: bounds || null })
  };
}
