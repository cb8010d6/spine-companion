const { spawnSync } = require("node:child_process");

const args = ["build"];
if (process.platform === "win32") {
  args.push("--bundles", "nsis");
}

const result = spawnSync("tauri", args, {
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) throw result.error;
process.exit(result.status || 0);
