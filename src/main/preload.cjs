const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  getConfig: () => ipcRenderer.invoke("companion:get-config"),
  getState: () => ipcRenderer.invoke("companion:get-state"),
  setState: (state) => ipcRenderer.invoke("companion:set-state", state),
  createReminder: (reminder) => ipcRenderer.invoke("companion:create-reminder", reminder),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("companion:state", handler);
    return () => ipcRenderer.off("companion:state", handler);
  },
  dragStart: (point) => ipcRenderer.send("companion:drag-start", point),
  dragMove: (point) => ipcRenderer.send("companion:drag-move", point),
  dragEnd: () => ipcRenderer.send("companion:drag-end")
});
