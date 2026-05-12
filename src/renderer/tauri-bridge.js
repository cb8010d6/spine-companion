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
    dragStart: () => _tauriInvoke("start_drag"),
    dragMove: () => { /* Tauri handles drag natively */ },
    dragEnd: () => { /* Tauri handles drag natively */ },
    revealWindow: () => _tauriInvoke("reveal_window"),
    rendererReady: () => _tauriInvoke("reveal_window"),
    setMousePassthrough: (enabled) => _tauriInvoke("set_mouse_passthrough", { enabled: Boolean(enabled) })
  };
}
