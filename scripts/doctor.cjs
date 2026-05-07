const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");

function cmd(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  return {
    ok: result.status === 0,
    output: (result.stdout || result.stderr || "").trim()
  };
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function line(ok, label, detail = "") {
  console.log(`${ok ? "OK " : "ERR"} ${label}${detail ? ` - ${detail}` : ""}`);
}

(async () => {
  const node = cmd("node", ["--version"]);
  const npm = cmd("npm", ["--version"]);
  const deps = fs.existsSync(path.join(rootDir, "node_modules", "electron"));
  const localConfig = fs.existsSync(path.join(rootDir, "companion.local.json"));
  const apiFree = await portFree(17388);
  const rendererFree = await portFree(17389);

  line(node.ok, "Node.js", node.output);
  line(npm.ok, "npm", npm.output);
  line(deps, "dependencies", deps ? "installed" : "missing; run npm start");
  line(localConfig, "local asset config", localConfig ? "companion.local.json exists" : "missing; app can still start");
  line(apiFree, "API port 17388", apiFree ? "free" : "already in use");
  line(rendererFree, "renderer port 17389", rendererFree ? "free" : "already in use");
})();
