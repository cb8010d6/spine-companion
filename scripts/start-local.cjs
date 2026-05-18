const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const localConfigPath = path.join(rootDir, "companion.local.json");
const defaultAssetDirs = [
  path.join(
    process.env.USERPROFILE || "",
    "Documents",
    "Codex",
    "2026-05-05",
    "hatch-pet-c-users-index-codex",
    "assets",
    "amiya_spine"
  )
].filter(Boolean);

function log(message = "") {
  console.log(`[spine-companion] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function hasNodeModules() {
  return fs.existsSync(path.join(rootDir, "node_modules", "electron"))
    && fs.existsSync(path.join(rootDir, "node_modules", "vite"))
    && fs.existsSync(path.join(rootDir, "node_modules", "pixi-spine"));
}

function hasConfiguredAsset() {
  if (process.env.SPINE_ASSET_DIR) return true;
  if (!fs.existsSync(localConfigPath)) return false;
  try {
    const config = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
    return Boolean(config?.spine?.assetDir && fs.existsSync(config.spine.assetDir));
  } catch {
    return false;
  }
}

function findSkel(assetDir) {
  if (!fs.existsSync(assetDir)) return "";
  return fs.readdirSync(assetDir).find((file) => file.toLowerCase().endsWith(".skel")) || "";
}

function configureDefaultAssetIfPossible() {
  if (hasConfiguredAsset()) return;

  for (const assetDir of defaultAssetDirs) {
    const skel = findSkel(assetDir);
    if (!skel) continue;
    fs.writeFileSync(localConfigPath, JSON.stringify({ spine: { assetDir, skel } }, null, 2) + "\n");
    log(`auto-configured local Spine asset: ${path.join(assetDir, skel)}`);
    return;
  }

  log("no local Spine asset is configured yet.");
  log("the app will still start, but the window will show a missing asset message.");
    log('to configure assets later, run: bun run setup:assets -- "C:\\path\\to\\spine_model_folder"');
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function main() {
  log("starting local desktop companion");

  if (!hasNodeModules()) {
    log("dependencies are missing; running bun install once");
    run("bun", ["install"]);
  }

  configureDefaultAssetIfPossible();

  const rendererPortFree = await checkPort(17389);
  if (!rendererPortFree) {
    log("renderer port 17389 is already in use. If the app is already open, use that window.");
    log("otherwise close the old node/electron process and run npm start again.");
    process.exit(1);
  }

  log("launching Electron + renderer. Keep this terminal open while the app is running.");
  const child = spawn("bun", ["run", "dev"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("exit", (code) => process.exit(code || 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
