const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(os.homedir(), ".codex", "config.toml");
const serverPath = path.join(rootDir, "scripts", "mcp-companion-server.mjs").replace(/\\/g, "/");
const marker = "[mcp_servers.spine_companion]";
const runtime = process.argv.includes("--runtime")
  ? process.argv[process.argv.indexOf("--runtime") + 1] || "bun"
  : process.env.SPINE_COMPANION_MCP_RUNTIME || "bun";

if (!fs.existsSync(configPath)) {
  throw new Error(`Codex config not found: ${configPath}`);
}

const current = fs.readFileSync(configPath, "utf8");
const entry = `
# Spine Companion local MCP bridge.
${marker}
command = "${runtime}"
args = ["${serverPath}"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
`;

const backupPath = `${configPath}.bak-${Date.now()}`;
fs.copyFileSync(configPath, backupPath);
if (current.includes(marker)) {
  const start = current.indexOf(marker);
  const prefixStart = current.lastIndexOf("# Spine Companion local MCP bridge.", start);
  const blockStart = prefixStart === -1 ? start : prefixStart;
  const nextSection = current.slice(start + marker.length).search(/\n\[[^\]]+\]/);
  const blockEnd = nextSection === -1
    ? current.length
    : start + marker.length + nextSection + 1;
  fs.writeFileSync(configPath, `${current.slice(0, blockStart).trimEnd()}\n\n${entry.trim()}\n\n${current.slice(blockEnd).trimStart()}`);
  console.log(`Updated ${marker} in ${configPath} to use ${runtime}`);
} else {
  fs.writeFileSync(configPath, current.trimEnd() + entry + "\n");
  console.log(`Added ${marker} to ${configPath} using ${runtime}`);
}
console.log(`Backup written to ${backupPath}`);
console.log("Restart Codex or open a new session for the MCP server to be discovered.");
