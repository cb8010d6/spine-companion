const path = require("node:path");
const fs = require("node:fs");
const { Menu, Tray, nativeImage, app, shell, BrowserWindow, ipcMain, Notification, globalShortcut, dialog, screen } = require("electron");
const os = require("os");
const { loadConfig, getPublicConfig, readJsonIfExists } = require("./config.cjs");
const { createCompanionServer } = require("./state-server.cjs");
const { applyUiSettingsPatch: applySharedUiPatch, normalizeUiSettings } = require("../shared/ui-settings.cjs");
const { mcpConfigCandidates, detectMcpReferences } = require("../shared/diagnostics-paths.cjs");
const { trayMenuModel } = require("../shared/tray-menu-model.cjs");
const { checkGitHubRelease } = require("../shared/update-checker.cjs");
const { validateSpineAssetDir, validateSpineAssetSelection } = require("../shared/spine-assets.cjs");
const pkg = require("../../package.json");

const isDev = !app.isPackaged;
const trayPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACWSURBVFhH7dKxDYAwDERRRqGizEIMwXqUjMAuDBDkAsmJrnCcGCPk4lcxulcwzUvKngUgAP8DbOdRhG54wwD18BO65XUD0CgPfcPrAqDBa1+L0Hc8NQCNU68A0DBFb+YANEw97y4AdCetCTB6nBIDLMYpNQDdaBIB6nF3ALrR9n2A5TgVgCYAeu9N9BNaFoAABMAZkPINmrttQ5C/BxgAAAAASUVORK5CYII=";
let mainWindow = null;
let managerWindow = null;
let serverRuntime = null;
let publicConfigCache = null;
let dragState = null;
let pendingDragPoint = null;
let dragFrame = null;
let tray = null;
let mousePassthrough = false;
let uiSettings = {
  hudVisible: false,
  bubbleVisible: true,
  bubbleShadow: true,
  bubbleBackground: "solid",
  bubbleHoldMs: 8000,
  dragMode: "compatible",
  autoRevealOnMcp: true
};
let alwaysOnTop = true;
let isQuitting = false;
let panelWindow = null;
let windowBoundsTimer = null;

function rendererUrl() {
  if (isDev) return process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:17389";
  return `file://${path.join(__dirname, "..", "..", "dist", "index.html")}`;
}

function managerUrl() {
  if (isDev) return (process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:17389") + "/manager.html";
  return `file://${path.join(__dirname, "..", "..", "dist", "manager.html")}`;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function applyUiSettingsPatch(patch = {}) {
  uiSettings = applySharedUiPatch(uiSettings, patch);
  updateUiSettings();
  return uiSettings;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function intersectsWorkArea(bounds, workArea) {
  const minVisible = 40;
  const left = Math.max(bounds.x, workArea.x);
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  const top = Math.max(bounds.y, workArea.y);
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);
  return right - left >= minVisible && bottom - top >= minVisible;
}

function initialWindowBounds(config) {
  const bounds = {
    width: Number(config.window.width || 360),
    height: Number(config.window.height || 460)
  };
  if (isFiniteNumber(config.window.x) && isFiniteNumber(config.window.y)) {
    const saved = { ...bounds, x: Math.round(Number(config.window.x)), y: Math.round(Number(config.window.y)) };
    if (screen.getAllDisplays().some((display) => intersectsWorkArea(saved, display.workArea))) {
      return saved;
    }
  }
  return bounds;
}

function mergeDeepMutable(base, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!base[key] || typeof base[key] !== "object" || Array.isArray(base[key])) base[key] = {};
      mergeDeepMutable(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

async function importModel(input = {}) {
  const model = publicConfigCache?.models?.catalog?.find((item) => item.id === input.id);
  if (!model) throw new Error(`Unknown model id: ${input.id}`);
  const configDir = publicConfigCache.paths?.configDir || path.join(app.getPath("appData"), "spine-companion");
  const localConfigPath = publicConfigCache.paths?.localConfigPath || path.join(configDir, "companion.local.json");
  const modelDir = path.join(configDir, "models", model.id);
  fs.mkdirSync(modelDir, { recursive: true });
  const files = model.files || [];
  const total = files.length;
  for (let i = 0; i < total; i++) {
    const file = files[i];
    sendToRenderer("companion:download-progress", { id: model.id, file: file.name, current: i + 1, total, status: "downloading" });
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Failed to download ${file.name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(modelDir, file.name), bytes);
  }
  validateSpineAssetDir(modelDir, model.skel);
  const current = readJsonIfExists(localConfigPath);
  mergeDeepMutable(current, {
    spine: {
      assetDir: modelDir,
      skel: model.skel
    }
  });
  fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
  fs.writeFileSync(localConfigPath, `${JSON.stringify(current, null, 2)}\n`);
  serverRuntime?.setAssetRoot(modelDir);
  const origin = publicConfigCache?.server?.origin || `http://${publicConfigCache?.server?.host || "127.0.0.1"}:17388`;
  mergeDeepMutable(publicConfigCache, {
    spine: {
      assetDir: modelDir,
      assetDirConfigured: true,
      skel: model.skel,
      assetUrl: `${origin}/assets/spine/${encodeURIComponent(model.skel)}`
    }
  });
  return {
    id: model.id,
    name: model.name,
    assetDir: modelDir,
    skel: model.skel,
    assetUrl: `${origin}/assets/spine/${encodeURIComponent(model.skel)}`,
    localConfigPath,
    requiresRestart: false
  };
}

async function importLocalModel() {
  try {
    const result = await dialog.showOpenDialog({
      title: "Import local Spine model",
      properties: ["openFile"],
      filters: [
        { name: "Spine skeleton", extensions: ["skel"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

    const { assetDir, skel } = validateSpineAssetSelection(result.filePaths[0]);
    const localConfigPath = publicConfigCache.paths?.localConfigPath || path.join(app.getPath("appData"), "spine-companion", "companion.local.json");
    await saveSettings({
      spine: {
        assetDir,
        skel
      }
    }, { notify: false });
    serverRuntime?.setAssetRoot(assetDir);
    const origin = publicConfigCache?.server?.origin || `http://${publicConfigCache?.server?.host || "127.0.0.1"}:17388`;
    mergeDeepMutable(publicConfigCache, {
      spine: {
        assetDir,
        assetDirConfigured: true,
        skel,
        assetUrl: `${origin}/assets/spine/${encodeURIComponent(skel)}`
      }
    });
    const payload = {
      id: `local-${path.basename(assetDir)}`,
      name: skel,
      assetDir,
      skel,
      assetUrl: `${origin}/assets/spine/${encodeURIComponent(skel)}`,
      localConfigPath,
      requiresRestart: false
    };
    sendToRenderer("companion:model-imported", payload);
    sendToRenderer("companion:config-changed", publicConfigCache);
    return payload;
  } catch (error) {
    dialog.showErrorBox("Unable to import Spine model", error.message || String(error));
    throw error;
  }
}

async function saveSettings(patch, options = {}) {
  const notify = options.notify !== false;
  const localConfigPath = publicConfigCache.paths?.localConfigPath || path.join(app.getPath("appData"), "spine-companion", "companion.local.json");
  const current = readJsonIfExists(localConfigPath);
  mergeDeepMutable(current, patch);
  fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
  fs.writeFileSync(localConfigPath, `${JSON.stringify(current, null, 2)}\n`);

  mergeDeepMutable(publicConfigCache, patch);
  if (patch.ui) updateUiSettingsPatch(patch.ui);
  if (notify) sendToRenderer("companion:config-changed", publicConfigCache);
  return true;
}

function updateUiSettingsPatch(patch) {
  if (publicConfigCache) {
    publicConfigCache = {
      ...publicConfigCache,
      ui: { ...(publicConfigCache.ui || {}), ...patch }
    };
  }
  sendToRenderer("companion:ui", publicConfigCache.ui);
  updateTrayMenu();
}

async function getDiagnostics() {
  const origin = publicConfigCache?.server?.origin || "http://127.0.0.1:17388";
  let apiOk = false;
  try {
    const res = await fetch(`${origin}/state`);
    apiOk = res.ok;
  } catch {}

  const localConfigPath = publicConfigCache?.paths?.localConfigPath;
  const localConfigExists = localConfigPath ? fs.existsSync(localConfigPath) : false;

  let assetDirExists = false;
  let hasSkel = false;
  let hasAtlas = false;
  let hasPng = false;

  let rootDir = null;
  if (serverRuntime && serverRuntime.getAssetRoot) {
    rootDir = serverRuntime.getAssetRoot();
  }

  if (rootDir && fs.existsSync(rootDir)) {
    assetDirExists = true;
    const files = fs.readdirSync(rootDir);
    hasSkel = files.some(f => f.endsWith(".skel"));
    hasAtlas = files.some(f => f.endsWith(".atlas"));
    hasPng = files.some(f => f.endsWith(".png"));
  }

  const home = os.homedir();
  const mcp = detectMcpReferences(
    (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "",
    mcpConfigCandidates(home, process.platform, process.env)
  );

  return {
    apiOk,
    localConfigPath,
    localConfigExists,
    configWarnings: publicConfigCache?.paths?.warnings || [],
    assetDirExists,
    hasSkel,
    hasAtlas,
    hasPng,
    mcpConfigured: mcp.configured,
    mcpMatches: mcp.matches
  };
}

function getInstalledModels() {
  const configDir = publicConfigCache?.paths?.configDir || path.join(app.getPath("appData"), "spine-companion");
  const modelsDir = path.join(configDir, "models");
  if (!fs.existsSync(modelsDir)) return [];
  return fs.readdirSync(modelsDir).filter(name => {
    return fs.statSync(path.join(modelsDir, name)).isDirectory();
  }).map(id => {
    return { id, dir: path.join(modelsDir, id) };
  });
}

function findCatalogModelBySkel(skel) {
  return publicConfigCache?.models?.catalog?.find((model) => model.skel === skel);
}

async function setActiveModel(id) {
  const installed = getInstalledModels().find((model) => model.id === id);
  if (!installed) throw new Error(`Model is not installed: ${id}`);
  const model = publicConfigCache?.models?.catalog?.find((item) => item.id === id) || {};
  const files = fs.readdirSync(installed.dir);
  const skel = model.skel || files.find((file) => file.endsWith(".skel"));
  if (!skel) throw new Error(`No .skel file found for ${id}`);
  validateSpineAssetDir(installed.dir, skel);
  await saveSettings({ spine: { assetDir: installed.dir, skel } }, { notify: false });
  serverRuntime?.setAssetRoot(installed.dir);
  const origin = publicConfigCache?.server?.origin || "http://127.0.0.1:17388";
  mergeDeepMutable(publicConfigCache, {
    spine: {
      assetDir: installed.dir,
      assetDirConfigured: true,
      skel,
      assetUrl: `${origin}/assets/spine/${encodeURIComponent(skel)}`
    }
  });
  const result = {
    id,
    name: model.name || id,
    assetDir: installed.dir,
    skel,
    assetUrl: `${origin}/assets/spine/${encodeURIComponent(skel)}`,
    localConfigPath: publicConfigCache.paths?.localConfigPath,
    requiresRestart: false
  };
  sendToRenderer("companion:model-imported", result);
  sendToRenderer("companion:config-changed", publicConfigCache);
  return result;
}

function getCurrentModel() {
  const skel = publicConfigCache?.spine?.skel || "";
  const catalog = findCatalogModelBySkel(skel);
  return {
    id: catalog?.id || "",
    name: catalog?.name || skel || "None",
    skel,
    assetDir: publicConfigCache?.spine?.assetDir || "",
    source: catalog?.source || "Local"
  };
}

function getUpdateStatus() {
  return checkGitHubRelease({ currentVersion: pkg.version });
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return app.getLoginItemSettings();
}

function openExternalUrl(url) {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http(s) URLs can be opened externally.");
  }
  return shell.openExternal(parsed.toString());
}

function openExternalUrlFromWindow(url) {
  try {
    openExternalUrl(url);
  } catch (error) {
    console.warn("[spine-companion] Blocked external URL", url, error);
  }
}

function removeModel(id) {
  if (typeof id !== "string" || id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("Invalid model ID");
  }
  const configDir = publicConfigCache?.paths?.configDir || path.join(app.getPath("appData"), "spine-companion");
  const modelsDir = path.join(configDir, "models");
  const modelDir = path.join(modelsDir, id);
  const resolvedModelsDir = fs.existsSync(modelsDir) ? fs.realpathSync(modelsDir) : path.resolve(modelsDir);
  const resolvedModelDir = fs.existsSync(modelDir) ? fs.realpathSync(modelDir) : path.resolve(modelDir);
  if (!resolvedModelDir.startsWith(resolvedModelsDir)) throw new Error("Path traversal detected");
  const activeAssetDir = publicConfigCache?.spine?.assetDir;
  if (activeAssetDir && fs.existsSync(activeAssetDir) && fs.realpathSync(activeAssetDir) === resolvedModelDir) {
    throw new Error("Cannot remove the active model");
  }
  if (fs.existsSync(modelDir)) fs.rmSync(modelDir, { recursive: true, force: true });
}

function openLocalApi() {
  shell.openExternal(publicConfigCache?.server?.origin || "http://127.0.0.1:17388");
}

function openConfigDir() {
  const configDir = publicConfigCache?.paths?.configDir || path.join(app.getPath("appData"), "spine-companion");
  shell.openPath(configDir);
}

function openCompanionFolder(targetPath) {
  const configDir = publicConfigCache?.paths?.configDir || path.join(app.getPath("appData"), "spine-companion");
  const resolvedConfigDir = fs.realpathSync.native?.(configDir) || fs.realpathSync(configDir);
  const resolvedTarget = fs.realpathSync.native?.(targetPath) || fs.realpathSync(targetPath);
  if (!resolvedTarget.startsWith(resolvedConfigDir)) {
    throw new Error("Refusing to open a path outside the companion config directory");
  }
  return shell.openPath(resolvedTarget);
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
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function showCompanionWindowInactive() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) {
    if (typeof mainWindow.showInactive === "function") mainWindow.showInactive();
    else mainWindow.show();
  }
}

function shouldRevealForState(state = {}) {
  return uiSettings.autoRevealOnMcp !== false && state.source === "codex-mcp" && state.state && state.state !== "idle";
}

function hideCompanionWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

async function openManager() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    if (!managerWindow.isVisible()) managerWindow.show();
    managerWindow.focus();
    return;
  }

  managerWindow = new BrowserWindow({
    title: "Spine Companion - Manager",
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  managerWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    managerWindow.hide();
  });

  managerWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrlFromWindow(url);
    return { action: "deny" };
  });

  await managerWindow.loadURL(managerUrl());
  managerWindow.show();
}

async function openPanel(bounds) {
  if (!panelWindow || panelWindow.isDestroyed()) {
    panelWindow = new BrowserWindow({
      title: "Spine Companion - Quick Panel",
      width: 320,
      height: 480,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    panelWindow.on("blur", () => {
      panelWindow.hide();
    });

    const panelUrl = isDev
      ? `${publicConfigCache.server.origin.replace("17388", "17389")}/panel.html`
      : `file://${path.join(__dirname, "../../dist/panel.html")}`;
    await panelWindow.loadURL(panelUrl);
  }

  // Calculate position (bottom right generally)
  const x = Math.round(bounds.x - (320 / 2));
  let y = Math.round(bounds.y - 480 - 10);
  if (y < 0) y = Math.round(bounds.y + bounds.height + 10); // if taskbar on top

  panelWindow.setPosition(x, y);
  panelWindow.show();
  panelWindow.focus();
}

function createTrayIcon() {
  const icon = nativeImage.createFromBuffer(Buffer.from(trayPngBase64, "base64"));
  return icon.resize({ width: 16, height: 16 });
}

function buildTrayMenu() {
  const actions = {
    show_companion: focusWindow,
    hide_companion: hideCompanionWindow,
    open_panel: () => openPanel(tray?.getBounds?.() || { x: 0, y: 0, height: 0 }),
    open_manager: openManager,
    toggle_bubble: () => applyUiSettingsPatch({ bubbleVisible: uiSettings.bubbleVisible === false }),
    toggle_hud: () => applyUiSettingsPatch({ hudVisible: uiSettings.hudVisible === false }),
    toggle_click_through: () => setMousePassthrough(!mousePassthrough),
    diagnostics: openManager,
    open_config_dir: openConfigDir,
    open_local_api: openLocalApi,
    quit: () => app.quit()
  };
  const template = trayMenuModel(uiSettings, { mousePassthrough }).map((item) => {
    if (item.type === "separator") return { type: "separator" };
    if (item.submenu) {
      return {
        label: item.label,
        submenu: item.submenu.map(({ label, state, direction }) => ({
          label,
          click: () => serverRuntime?.store.setState({ state, direction, source: "tray" })
        }))
      };
    }
    return { label: item.label, click: actions[item.id] };
  });
  return Menu.buildFromTemplate(template);
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function saveMainWindowBoundsSoon(delayMs = 400) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  window.clearTimeout(windowBoundsTimer);
  windowBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    saveSettings({
      window: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      }
    }, { notify: false }).catch((error) => {
      console.warn("[spine-companion] Unable to save window bounds", error);
    });
  }, delayMs);
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Spine Companion");
  tray.on("click", (e, bounds) => openPanel(bounds));
  updateTrayMenu();
}

async function createWindow(config) {
  const bounds = initialWindowBounds(config);
  mainWindow = new BrowserWindow({
    ...bounds,
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
      sandbox: true
    }
  });

  alwaysOnTop = config.window.alwaysOnTop !== false;
  mainWindow.setAlwaysOnTop(alwaysOnTop, "floating");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("move", () => saveMainWindowBoundsSoon());
  mainWindow.on("resize", () => saveMainWindowBoundsSoon());
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrlFromWindow(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(rendererUrl());
}

function registerIpc(config) {
  ipcMain.handle("companion:get-config", () => publicConfigCache);
  ipcMain.handle("companion:get-state", () => serverRuntime.store.snapshot());
  ipcMain.handle("companion:set-state", (_event, state) => serverRuntime.store.setState(state));
  ipcMain.handle("companion:create-reminder", (_event, reminder) => serverRuntime.store.createReminder(reminder));
  ipcMain.handle("companion:set-ui-settings", (_event, settings) => applyUiSettingsPatch(settings));
  ipcMain.handle("companion:emit-scale", (_event, payload) => {
    sendToRenderer("companion:scale", payload);
    return true;
  });
  ipcMain.handle("companion:import-model", async (_event, input) => {
    const result = await importModel(input);
    sendToRenderer("companion:model-imported", result);
    return result;
  });
  ipcMain.handle("companion:import-local-model", () => importLocalModel());
  ipcMain.handle("companion:save-settings", (_event, patch) => saveSettings(patch));
  ipcMain.handle("companion:get-diagnostics", () => getDiagnostics());
  ipcMain.handle("companion:get-installed-models", () => getInstalledModels());
  ipcMain.handle("companion:get-history", () => serverRuntime.store.listHistory());
  ipcMain.handle("companion:get-current-model", () => getCurrentModel());
  ipcMain.handle("companion:set-active-model", (_event, id) => setActiveModel(id));
  ipcMain.handle("companion:check-updates", () => getUpdateStatus());
  ipcMain.handle("companion:open-external", (_event, url) => openExternalUrl(url));
  ipcMain.handle("companion:set-auto-launch", (_event, enabled) => setAutoLaunch(enabled));
  ipcMain.handle("companion:remove-model", (_event, id) => removeModel(id));
  ipcMain.handle("companion:open-folder", (_event, p) => openCompanionFolder(p));
  ipcMain.handle("companion:open-manager", () => {
    openManager();
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.hide();
  });
  ipcMain.handle("companion:quit-app", () => app.quit());

  serverRuntime.store.emitter.on("state", (state) => {
    if (shouldRevealForState(state)) showCompanionWindowInactive();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("companion:state", state);
    }
  });
  serverRuntime.store.emitter.on("reminder", (reminder) => {
    if (Notification.isSupported()) {
      new Notification({
        title: "Spine Companion Reminder",
        body: reminder.text || "Reminder"
      }).show();
    }
  });

  ipcMain.on("companion:drag-start", (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    setMousePassthrough(false, win);
    dragState = {
      win,
      startX: Number(point.screenX),
      startY: Number(point.screenY),
      bounds: win.getBounds()
    };
    pendingDragPoint = null;
  });

  ipcMain.on("companion:drag-move", (_event, point) => {
    if (!dragState) return;
    pendingDragPoint = point;
    if (dragFrame) return;
    const dragFrameMs = uiSettings.dragMode === "smooth" ? 16 : 34;
    dragFrame = setTimeout(() => {
      dragFrame = null;
      if (!dragState || !pendingDragPoint) return;
      const dx = Math.round(Number(pendingDragPoint.screenX) - dragState.startX);
      const dy = Math.round(Number(pendingDragPoint.screenY) - dragState.startY);
      dragState.win.setPosition(dragState.bounds.x + dx, dragState.bounds.y + dy, false);
    }, dragFrameMs);
  });

  ipcMain.on("companion:drag-end", () => {
    if (dragFrame) {
      clearTimeout(dragFrame);
      dragFrame = null;
    }
    if (dragState && pendingDragPoint) {
      const dx = Math.round(Number(pendingDragPoint.screenX) - dragState.startX);
      const dy = Math.round(Number(pendingDragPoint.screenY) - dragState.startY);
      dragState.win.setPosition(dragState.bounds.x + dx, dragState.bounds.y + dy, false);
    }
    saveMainWindowBoundsSoon(50);
    dragState = null;
    pendingDragPoint = null;
  });

  ipcMain.on("companion:mouse-passthrough", (event, enabled) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    setMousePassthrough(Boolean(enabled), win);
  });
}

function setMousePassthrough(enabled, win = mainWindow) {
  if (!win || win.isDestroyed() || dragState) return;
  if (mousePassthrough === enabled) return;
  mousePassthrough = enabled;
  win.setIgnoreMouseEvents(enabled, { forward: true });
  updateTrayMenu();
}

async function boot() {
  const config = loadConfig();
  uiSettings = normalizeUiSettings(config.ui);
  const origin = `http://${config.server.host}:${config.server.port}`;
  publicConfigCache = getPublicConfig(config, origin);
  serverRuntime = createCompanionServer(config, () => publicConfigCache);
  await serverRuntime.listen();
  registerIpc(config);
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    const state = serverRuntime.store.snapshot().state === "working" ? "idle" : "working";
    serverRuntime.store.setState({ state, source: "global-shortcut", message: state === "working" ? "Working" : "" });
  });
  createTray();
  await createWindow(config);
  if (!config.spine.assetDir) {
    await openManager();
  }
}

function handleFatalStartup(error) {
  console.error("[spine-companion] startup failed", error);
  const message = error?.code === "EADDRINUSE"
    ? "Spine Companion could not start because its local API port is already in use. Another instance may already be running."
    : (error?.message || String(error));
  if (app.isReady()) {
    dialog.showErrorBox("Spine Companion failed to start", message);
  }
  app.quit();
}

function registerProcessErrorHandlers() {
  process.on("uncaughtException", (error) => {
    console.error("[spine-companion] uncaught exception", error);
    if (app.isReady()) dialog.showErrorBox("Spine Companion error", error?.message || String(error));
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[spine-companion] unhandled rejection", reason);
  });
}

app.setAppUserModelId("dev.spine-companion.desktop");
registerProcessErrorHandlers();

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusWindow();
  });
  app.whenReady().then(boot).catch(handleFatalStartup);
}

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (windowBoundsTimer) clearTimeout(windowBoundsTimer);
  globalShortcut.unregisterAll();
  if (serverRuntime) serverRuntime.close();
});
