const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  getConfig: () => ipcRenderer.invoke("companion:get-config"),
  getState: () => ipcRenderer.invoke("companion:get-state"),
  setState: (state) => ipcRenderer.invoke("companion:set-state", state),
  createReminder: (reminder) => ipcRenderer.invoke("companion:create-reminder", reminder),
  setUiSettings: (settings) => ipcRenderer.invoke("companion:set-ui-settings", settings),
  saveSettings: (patch) => ipcRenderer.invoke("companion:save-settings", patch),
  getDiagnostics: () => ipcRenderer.invoke("companion:get-diagnostics"),
  getInstalledModels: () => ipcRenderer.invoke("companion:get-installed-models"),
  getHistory: () => ipcRenderer.invoke("companion:get-history"),
  getCurrentModel: () => ipcRenderer.invoke("companion:get-current-model"),
  setActiveModel: (id) => ipcRenderer.invoke("companion:set-active-model", id),
  checkUpdates: () => ipcRenderer.invoke("companion:check-updates"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("companion:set-auto-launch", enabled),
  removeModel: (id) => ipcRenderer.invoke("companion:remove-model", id),
  openFolder: (p) => ipcRenderer.invoke("companion:open-folder", p),
  openManager: () => ipcRenderer.invoke("companion:open-manager"),
  quitApp: () => ipcRenderer.invoke("companion:quit-app"),
  emitScale: (payload) => ipcRenderer.invoke("companion:emit-scale", payload),
  importModel: (input) => ipcRenderer.invoke("companion:import-model", input),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("companion:state", handler);
    return () => ipcRenderer.off("companion:state", handler);
  },
  onUi: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on("companion:ui", handler);
    return () => ipcRenderer.off("companion:ui", handler);
  },
  onScale: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("companion:scale", handler);
    return () => ipcRenderer.off("companion:scale", handler);
  },
  onModelImported: (callback) => {
    const handler = (_event, result) => callback(result);
    ipcRenderer.on("companion:model-imported", handler);
    return () => ipcRenderer.off("companion:model-imported", handler);
  },
  onConfigChanged: (callback) => {
    const handler = (_event, config) => callback(config);
    ipcRenderer.on("companion:config-changed", handler);
    return () => ipcRenderer.off("companion:config-changed", handler);
  },
  onDownloadProgress: (callback) => {
    const handler = (_event, p) => callback(p);
    ipcRenderer.on("companion:download-progress", handler);
    return () => ipcRenderer.off("companion:download-progress", handler);
  },
  dragStart: (point) => ipcRenderer.send("companion:drag-start", point),
  dragMove: (point) => ipcRenderer.send("companion:drag-move", point),
  dragEnd: () => ipcRenderer.send("companion:drag-end"),
  setMousePassthrough: (enabled) => ipcRenderer.send("companion:mouse-passthrough", Boolean(enabled))
});
