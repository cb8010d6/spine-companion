const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  getConfig: () => ipcRenderer.invoke("companion:get-config"),
  getState: () => ipcRenderer.invoke("companion:get-state"),
  setState: (state) => ipcRenderer.invoke("companion:set-state", state),
  createReminder: (reminder) => ipcRenderer.invoke("companion:create-reminder", reminder),
  setUiSettings: (settings) => ipcRenderer.invoke("companion:set-ui-settings", settings),
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
  dragStart: (point) => ipcRenderer.send("companion:drag-start", point),
  dragMove: (point) => ipcRenderer.send("companion:drag-move", point),
  dragEnd: () => ipcRenderer.send("companion:drag-end"),
  setMousePassthrough: (enabled) => ipcRenderer.send("companion:mouse-passthrough", Boolean(enabled))
});
