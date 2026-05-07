const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } = require("electron");
const { loadConfig, getPublicConfig } = require("./config.cjs");
const { createCompanionServer } = require("./state-server.cjs");

const isDev = !app.isPackaged;
const trayPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACWSURBVFhH7dKxDYAwDERRRqGizEIMwXqUjMAuDBDkAsmJrnCcGCPk4lcxulcwzUvKngUgAP8DbOdRhG54wwD18BO65XUD0CgPfcPrAqDBa1+L0Hc8NQCNU68A0DBFb+YANEw97y4AdCetCTB6nBIDLMYpNQDdaBIB6nF3ALrR9n2A5TgVgCYAeu9N9BNaFoAABMAZkPINmrttQ5C/BxgAAAAASUVORK5CYII=";
let mainWindow = null;
let serverRuntime = null;
let publicConfigCache = null;
let dragState = null;
let tray = null;
let uiSettings = { hudVisible: true, bubbleVisible: true };
let alwaysOnTop = true;
let isQuitting = false;

function rendererUrl() {
  if (isDev) return process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:17389";
  return `file://${path.join(__dirname, "..", "..", "dist", "index.html")}`;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setHudVisible(visible) {
  uiSettings = { ...uiSettings, hudVisible: Boolean(visible) };
  updateUiSettings();
}

function setBubbleVisible(visible) {
  uiSettings = { ...uiSettings, bubbleVisible: Boolean(visible) };
  updateUiSettings();
}

function updateUiSettings() {
  if (publicConfigCache) {
    publicConfigCache = {
      ...publicConfigCache,
      ui: { ...(publicConfigCache.ui || {}), ...uiSettings }
    };
  }
  sendToRenderer("companion:ui", uiSettings);
  updateTrayMenu();
}

function setAlwaysOnTop(enabled) {
  alwaysOnTop = Boolean(enabled);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(alwaysOnTop, "floating");
  }
  updateTrayMenu();
}

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTrayIcon() {
  const icon = nativeImage.createFromBuffer(Buffer.from(trayPngBase64, "base64"));
  return icon.resize({ width: 16, height: 16 });
}

function quickStateMenuItems() {
  const states = [
    ["Idle", "idle"],
    ["Working", "working"],
    ["Reviewing", "reviewing"],
    ["Running Left", "running", "left"],
    ["Running Right", "running", "right"],
    ["Success", "success"],
    ["Failed", "failed"],
    ["Waiting", "waiting"],
    ["Sleeping", "sleeping"],
    ["Reminder", "reminder"]
  ];
  return states.map(([label, state, direction]) => ({
    label,
    click: () => serverRuntime?.store.setState({ state, direction, source: "tray" })
  }));
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show Window", click: focusWindow },
    {
      label: "Show Status Panel",
      type: "checkbox",
      checked: uiSettings.hudVisible !== false,
      click: (item) => setHudVisible(item.checked)
    },
    {
      label: "Show Progress Bubble",
      type: "checkbox",
      checked: uiSettings.bubbleVisible !== false,
      click: (item) => setBubbleVisible(item.checked)
    },
    {
      label: "Always On Top",
      type: "checkbox",
      checked: alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked)
    },
    { type: "separator" },
    { label: "Zoom In", click: () => sendToRenderer("companion:scale", { delta: 0.08 }) },
    { label: "Zoom Out", click: () => sendToRenderer("companion:scale", { delta: -0.08 }) },
    { label: "Reset Size", click: () => sendToRenderer("companion:scale", { action: "reset" }) },
    { type: "separator" },
    { label: "State", submenu: quickStateMenuItems() },
    { type: "separator" },
    { label: "Open Local API", click: () => shell.openExternal(publicConfigCache?.server?.origin || "http://127.0.0.1:17388") },
    { label: "Quit", click: () => app.quit() }
  ]);
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Spine Companion");
  tray.on("click", focusWindow);
  tray.on("double-click", focusWindow);
  updateTrayMenu();
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

  alwaysOnTop = config.window.alwaysOnTop !== false;
  mainWindow.setAlwaysOnTop(alwaysOnTop, "floating");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
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
  uiSettings = {
    hudVisible: config.ui?.hudVisible !== false,
    bubbleVisible: config.ui?.bubbleVisible !== false
  };
  const origin = `http://${config.server.host}:${config.server.port}`;
  publicConfigCache = getPublicConfig(config, origin);
  serverRuntime = createCompanionServer(config, () => publicConfigCache);
  await serverRuntime.listen();
  registerIpc(config);
  createTray();
  await createWindow(config);
}

app.setAppUserModelId("dev.spine-companion.desktop");
app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (serverRuntime) serverRuntime.close();
});
