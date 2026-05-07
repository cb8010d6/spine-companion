const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(os.homedir(), ".codex", "config.toml");
const serverPath = path.join(rootDir, "scripts", "mcp-companion-server.mjs").replace(/\\/g, "/");
const marker = "[mcp_servers.spine_companion]";

if (!fs.existsSync(configPath)) {
  throw new Error(`Codex config not found: ${configPath}`);
}

const current = fs.readFileSync(configPath, "utf8");
if (current.includes(marker)) {
  console.log("Codex MCP entry already exists.");
  process.exit(0);
}

const entry = `

# Spine Companion local MCP bridge.
${marker}
command = "node"
args = ["${serverPath}"]
env = { COMPANION_API = "http://127.0.0.1:17388" }
`;

const backupPath = `${configPath}.bak-${Date.now()}`;
fs.copyFileSync(configPath, backupPath);
fs.writeFileSync(configPath, current.trimEnd() + entry + "\n");
console.log(`Added ${marker} to ${configPath}`);
console.log(`Backup written to ${backupPath}`);
console.log("Restart Codex or open a new session for the MCP server to be discovered.");
