const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadConfig, getPublicConfig } = require("./config.cjs");
const { createCompanionServer } = require("./state-server.cjs");

const isDev = !app.isPackaged;
let mainWindow = null;
let serverRuntime = null;
let publicConfigCache = null;
let dragState = null;

function rendererUrl() {
  if (isDev) return process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:17389";
  return `file://${path.join(__dirname, "..", "..", "dist", "index.html")}`;
}

async function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: Number(config.window.width || 360),
    height: Number(config.window.height || 460),
    minWidth: 260,
    minHeight: 320,
    frame: false,
    transparent: config.window.transparent !== false,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    alwaysOnTop: config.window.alwaysOnTop !== false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setAlwaysOnTop(config.window.alwaysOnTop !== false, "floating");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(rendererUrl());
}

function registerIpc(config) {
  ipcMain.handle("companion:get-config", () => publicConfigCache);
  ipcMain.handle("companion:get-state", () => serverRuntime.store.snapshot());
  ipcMain.handle("companion:set-state", (_event, state) => serverRuntime.store.setState(state));
  ipcMain.handle("companion:create-reminder", (_event, reminder) => serverRuntime.store.createReminder(reminder));

  serverRuntime.store.emitter.on("state", (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("companion:state", state);
    }
  });

  ipcMain.on("companion:drag-start", (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    dragState = {
      win,
      startX: Number(point.screenX),
      startY: Number(point.screenY),
      bounds: win.getBounds()
    };
  });

  ipcMain.on("companion:drag-move", (_event, point) => {
    if (!dragState) return;
    const dx = Math.round(Number(point.screenX) - dragState.startX);
    const dy = Math.round(Number(point.screenY) - dragState.startY);
    dragState.win.setBounds({
      ...dragState.bounds,
      x: dragState.bounds.x + dx,
      y: dragState.bounds.y + dy
    });
  });

  ipcMain.on("companion:drag-end", () => {
    dragState = null;
  });
}

async function boot() {
  const config = loadConfig();
  const origin = `http://${config.server.host}:${config.server.port}`;
  publicConfigCache = getPublicConfig(config, origin);
  serverRuntime = createCompanionServer(config, () => publicConfigCache);
  await serverRuntime.listen();
  registerIpc(config);
  await createWindow(config);
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("before-quit", () => {
  if (serverRuntime) serverRuntime.close();
});
