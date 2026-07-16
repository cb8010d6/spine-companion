const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");
const committedConfigPath = path.join(rootDir, "companion.config.json");
const localConfigPath = path.join(rootDir, "companion.local.json");

function userConfigDir() {
  if (process.env.SPINE_COMPANION_CONFIG_DIR) return process.env.SPINE_COMPANION_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "spine-companion");
  if (process.platform === "darwin" && process.env.HOME) {
    return path.join(process.env.HOME, "Library", "Application Support", "spine-companion");
  }
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "spine-companion");
  if (process.env.HOME) return path.join(process.env.HOME, ".config", "spine-companion");
  return rootDir;
}

function localConfigCandidates() {
  const candidates = [
    localConfigPath,
    path.join(process.cwd(), "companion.local.json"),
    path.join(userConfigDir(), "companion.local.json"),
    process.env.PORTABLE_EXECUTABLE_FILE
      ? path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "companion.local.json")
      : "",
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "companion.local.json")
      : "",
    path.join(path.dirname(process.execPath), "companion.local.json")
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
    catalog: [
      {
        id: "ark-1001-amiya2-sale-16",
        name: "Amiya Guard Skin #16",
        source: "Ark-Models",
        sourceId: "ark-models",
        catalogSourceId: "ark-models",
        catalogVisible: false,
        licenseNote: "Downloaded from isHarryh/Ark-Models for local use only. Do not commit or redistribute the asset files in this repository.",
        repositoryUrl: "https://github.com/isHarryh/Ark-Models/tree/2f3187f780108847d7327946e1906fc6b80bead3/models/1001_amiya2_sale%2316",
        skel: "build_char_1001_amiya2_sale#16.skel",
        files: [
          {
            name: "build_char_1001_amiya2_sale#16.atlas",
            url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/2f3187f780108847d7327946e1906fc6b80bead3/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.atlas"
          },
          {
            name: "build_char_1001_amiya2_sale#16.png",
            url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/2f3187f780108847d7327946e1906fc6b80bead3/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.png"
          },
          {
            name: "build_char_1001_amiya2_sale#16.skel",
            url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/2f3187f780108847d7327946e1906fc6b80bead3/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.skel"
          }
        ]
      }
    ]
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

function loadConfig() {
  const warnings = [];
  let config = mergeDeep(fallbackConfig, readJsonIfExists(committedConfigPath, warnings));
  let resolvedLocalConfigPath = "";
  let assetBaseDir = rootDir;
  for (const candidate of localConfigCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    const beforeWarnings = warnings.length;
    const localConfig = readJsonIfExists(candidate, warnings);
    if (warnings.length !== beforeWarnings) continue;
    config = mergeDeep(config, localConfig);
    resolvedLocalConfigPath = candidate;
    assetBaseDir = path.dirname(candidate);
  }

  if (process.env.SPINE_ASSET_DIR) {
    config.spine.assetDir = process.env.SPINE_ASSET_DIR;
  }
  if (process.env.SPINE_SKEL) {
    config.spine.skel = process.env.SPINE_SKEL;
  }
  if (process.env.COMPANION_PORT) {
    config.server.port = Number(process.env.COMPANION_PORT);
  }

  config.rootDir = rootDir;
  config.localConfigPath = resolvedLocalConfigPath || localConfigCandidates()[0];
  config.configWarnings = warnings;
  config.spine.assetDir = config.spine.assetDir
    ? path.resolve(assetBaseDir, config.spine.assetDir)
    : "";
  config.hasLocalConfig = Boolean(resolvedLocalConfigPath);
  config.state.remindersPath = config.state.remindersPath || path.join(userConfigDir(), "reminders.json");
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
      hasLocalConfig: config.hasLocalConfig,
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
  localConfigPath,
  localConfigCandidates,
  mergeDeep,
  userConfigDir,
  readJsonIfExists
};
