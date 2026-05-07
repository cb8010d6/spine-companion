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
    process.env.PORTABLE_EXECUTABLE_FILE
      ? path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "companion.local.json")
      : "",
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "companion.local.json")
      : "",
    path.join(path.dirname(process.execPath), "companion.local.json"),
    path.join(userConfigDir(), "companion.local.json")
  ].filter(Boolean);
  return [...new Set(candidates.map((file) => path.normalize(file)))];
}

const fallbackConfig = {
  window: {
    width: 360,
    height: 460,
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
    stageBottomInset: 154,
    fitStates: ["idle", "working", "running", "waiting", "reviewing", "success", "reminder"]
  },
  state: {
    initial: "idle",
    pollMs: 1000,
    sources: [{ type: "local-http" }]
  },
  ui: {
    hudVisible: true
  },
  specialSegments: {
    review: { from: 2.6, to: 4.35, loop: true },
    success: { from: 4.4, to: 7.2, loop: false },
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

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text);
}

function resolveMaybeRelative(value) {
  if (!value) return "";
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(rootDir, value);
}

function loadConfig() {
  let config = mergeDeep(fallbackConfig, readJsonIfExists(committedConfigPath));
  let resolvedLocalConfigPath = "";
  for (const candidate of localConfigCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    config = mergeDeep(config, readJsonIfExists(candidate));
    resolvedLocalConfigPath = candidate;
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
  config.spine.assetDir = resolveMaybeRelative(config.spine.assetDir);
  config.hasLocalConfig = Boolean(resolvedLocalConfigPath);
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
      skel: config.spine.skel,
      assetUrl: `${serverOrigin}/assets/spine/${encodeURIComponent(config.spine.skel)}`,
      assetDirConfigured: Boolean(config.spine.assetDir),
      scale: config.spine.scale,
      offsetX: config.spine.offsetX,
      offsetY: config.spine.offsetY,
      mixDurationMs: config.spine.mixDurationMs,
      boundsSamples: config.spine.boundsSamples,
      framePadding: config.spine.framePadding,
      stageBottomInset: config.spine.stageBottomInset,
      fitStates: config.spine.fitStates
    },
    ui: config.ui,
    state: config.state,
    specialSegments: config.specialSegments
  };
}

module.exports = {
  loadConfig,
  getPublicConfig,
  rootDir,
  localConfigPath,
  localConfigCandidates
};
