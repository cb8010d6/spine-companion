const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");
const committedConfigPath = path.join(rootDir, "companion.config.json");
const legacyRootConfigPath = path.join(rootDir, "companion.local.json");

function userConfigDir() {
  if (process.env.SPINE_COMPANION_CONFIG_DIR?.trim()) return path.normalize(process.env.SPINE_COMPANION_CONFIG_DIR);
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "spine-companion");
  if (process.platform === "darwin" && process.env.HOME) {
    return path.join(process.env.HOME, "Library", "Application Support", "spine-companion");
  }
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "spine-companion");
  if (process.env.HOME) return path.join(process.env.HOME, ".config", "spine-companion");
  return rootDir;
}

function canonicalConfigPath() {
  return path.join(userConfigDir(), "companion.local.json");
}

function localConfigCandidates() {
  const candidates = [
    legacyRootConfigPath,
    path.join(process.cwd(), "companion.local.json"),
    process.env.PORTABLE_EXECUTABLE_FILE
      ? path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "companion.local.json")
      : "",
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "companion.local.json")
      : "",
    path.join(path.dirname(process.execPath), "companion.local.json"),
    canonicalConfigPath()
  ].filter(Boolean);
  return [...new Set(candidates.map((file) => path.normalize(file)))];
}

const fallbackConfig = {
  window: {
    width: 360,
    height: 460,
    x: null,
    y: null,
    alwaysOnTop: true,
    transparent: true
  },
  server: {
    host: "127.0.0.1",
    port: 17388
  },
  spine: {
    assetDir: "",
    skel: "amiya.skel",
    scale: 0.86,
    offsetX: 0,
    offsetY: -18,
    mixDurationMs: 520,
    boundsSamples: 10,
    framePadding: 1.08,
    maxViewportFill: 0.72,
    stageBottomInset: 154,
    fitStates: ["idle", "working", "running", "waiting", "reviewing", "success", "reminder"]
  },
  state: {
    initial: "idle",
    pollMs: 1000,
    sources: [{ type: "local-http" }],
    historyLimit: 50,
    idleTimeoutMs: 0
  },
  ui: {
    hudVisible: false,
    bubbleVisible: true,
    bubbleShadow: true,
    bubbleBackground: "solid",
    bubbleHoldMs: 8000,
    dragMode: "smooth",
    frameRateMode: "display",
    autoRevealOnMcp: true,
    systemNotifications: true,
    updateAutoCheck: true,
    updateChannel: "auto",
    maxDevicePixelRatio: 2,
    hitboxPadding: 8,
    debugHitbox: false
  },
  models: {
    catalog: []
  },
  specialSegments: {
    review: { from: 2.6, to: 4.35, loop: true },
    success: { from: 4.4, to: 14.433, loop: false },
    successLoop: { from: 9.2, to: 14.433, loop: true, mixDurationMs: 420 },
    special: { from: 0, to: 14.433, loop: true }
  }
};

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = mergeDeep(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function readJsonIfExists(file, warnings = []) {
  if (!fs.existsSync(file)) return {};
  try {
    const text = fs.readFileSync(file, "utf8");
    return JSON.parse(text);
  } catch (error) {
    warnings.push({
      type: "json-parse",
      file,
      message: error.message || String(error)
    });
    console.warn(`[spine-companion] Ignoring invalid JSON config: ${file}`, error);
    return {};
  }
}

function resolveMaybeRelative(value) {
  if (!value) return "";
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(rootDir, value);
}

function parseCompanionPort(value) {
  if (value === undefined || value === null || value === "") return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null;
}

function loadConfig() {
  const warnings = [];
  const environmentOverrides = [];
  const beforeCommittedWarnings = warnings.length;
  let config = mergeDeep(fallbackConfig, readJsonIfExists(committedConfigPath, warnings));
  const loadedConfigPaths = warnings.length === beforeCommittedWarnings && fs.existsSync(committedConfigPath)
    ? [committedConfigPath]
    : [];
  let assetBaseDir = rootDir;
  for (const candidate of localConfigCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    const beforeWarnings = warnings.length;
    const localConfig = readJsonIfExists(candidate, warnings);
    if (warnings.length !== beforeWarnings) continue;
    config = mergeDeep(config, localConfig);
    loadedConfigPaths.push(candidate);
    if (isObject(localConfig.spine) && Object.prototype.hasOwnProperty.call(localConfig.spine, "assetDir")) {
      assetBaseDir = path.dirname(candidate);
    }
  }

  if (process.env.SPINE_ASSET_DIR) {
    config.spine.assetDir = process.env.SPINE_ASSET_DIR;
    environmentOverrides.push("SPINE_ASSET_DIR");
  }
  if (process.env.SPINE_SKEL) {
    config.spine.skel = process.env.SPINE_SKEL;
    environmentOverrides.push("SPINE_SKEL");
  }
  const companionPort = parseCompanionPort(process.env.COMPANION_PORT);
  if (companionPort !== null) {
    config.server.port = companionPort;
    environmentOverrides.push("COMPANION_PORT");
  }

  const canonicalPath = canonicalConfigPath();
  config.rootDir = rootDir;
  config.localConfigPath = canonicalPath;
  config.canonicalConfigPath = canonicalPath;
  config.configWarnings = warnings;
  config.loadedConfigPaths = loadedConfigPaths;
  config.configLayers = {
    canonical: {
      path: canonicalPath,
      exists: fs.existsSync(canonicalPath),
      loaded: loadedConfigPaths.includes(canonicalPath),
      writable: true
    },
    legacy: localConfigCandidates()
      .filter((file) => file !== canonicalPath)
      .map((file) => ({
        path: file,
        exists: fs.existsSync(file),
        loaded: loadedConfigPaths.includes(file),
        writable: false
      })),
    loaded: loadedConfigPaths,
    environmentOverrides
  };
  config.spine.assetDir = config.spine.assetDir
    ? path.resolve(assetBaseDir, config.spine.assetDir)
    : "";
  config.hasLocalConfig = loadedConfigPaths.includes(canonicalPath);
  return config;
}

function getPublicConfig(config, serverOrigin) {
  return {
    window: config.window,
    server: {
      origin: serverOrigin,
      stateUrl: `${serverOrigin}/state`,
      eventsUrl: `${serverOrigin}/events`,
      websocketUrl: serverOrigin.replace(/^http/, "ws") + "/ws"
    },
    spine: {
      assetDir: config.spine.assetDir,
      skel: config.spine.skel,
      assetUrl: `${serverOrigin}/assets/spine/${encodeURIComponent(config.spine.skel)}`,
      assetDirConfigured: Boolean(config.spine.assetDir),
      scale: config.spine.scale,
      offsetX: config.spine.offsetX,
      offsetY: config.spine.offsetY,
      mixDurationMs: config.spine.mixDurationMs,
      boundsSamples: config.spine.boundsSamples,
      framePadding: config.spine.framePadding,
      maxViewportFill: config.spine.maxViewportFill,
      stageBottomInset: config.spine.stageBottomInset,
      fitStates: config.spine.fitStates
    },
    ui: config.ui,
    models: config.models,
    paths: {
      configDir: userConfigDir(),
      logsDir: path.join(userConfigDir(), "logs"),
      localConfigPath: config.localConfigPath,
      canonicalConfigPath: config.canonicalConfigPath,
      hasLocalConfig: config.hasLocalConfig,
      configLayers: config.configLayers,
      loadedConfigPaths: config.loadedConfigPaths,
      warnings: config.configWarnings || []
    },
    state: config.state,
    specialSegments: config.specialSegments
  };
}

module.exports = {
  loadConfig,
  getPublicConfig,
  rootDir,
  localConfigPath: canonicalConfigPath(),
  canonicalConfigPath,
  localConfigCandidates,
  mergeDeep,
  userConfigDir,
  parseCompanionPort,
  readJsonIfExists
};
