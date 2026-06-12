#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const repoRoot = path.resolve(argValue("--repo", process.cwd()));
const target = argValue("--target", "all");
const api = argValue("--api", "http://127.0.0.1:17388");
const runtime = argValue("--runtime", process.env.SPINE_COMPANION_MCP_RUNTIME || "bun");
const mcpServer = path.join(repoRoot, "scripts", "mcp-companion-server.mjs");
const reportScript = path.join(repoRoot, "scripts", "report-status.cjs");

if (!fs.existsSync(mcpServer)) {
  throw new Error(`Spine Companion MCP server not found: ${mcpServer}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function backup(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  backup(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendBlock(file, marker, block) {
  ensureDir(path.dirname(file));
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current.includes(marker)) return false;
  backup(file);
  fs.writeFileSync(file, `${current.trimEnd()}\n\n${block.trim()}\n`);
  return true;
}

function sourceEnv(source, label) {
  return {
    COMPANION_API: api,
    COMPANION_SOURCE: source,
    COMPANION_SOURCE_LABEL: label
  };
}

function mcpJsonEntry(source = "ai-mcp", label = "AI") {
  return {
    command: runtime,
    args: [mcpServer.replace(/\\/g, "/")],
    env: sourceEnv(source, label)
  };
}

function codexMcpBlock(source = "codex-mcp", label = "Codex") {
  return `# Spine Companion local MCP bridge.
[mcp_servers.spine_companion]
command = "${runtime}"
args = ["${mcpServer.replace(/\\/g, "/")}"]
env = { COMPANION_API = "${api}", COMPANION_SOURCE = "${source}", COMPANION_SOURCE_LABEL = "${label}" }`;
}

function upsertBlock(file, marker, block) {
  ensureDir(path.dirname(file));
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const start = current.indexOf(marker);
  backup(file);
  if (start === -1) {
    fs.writeFileSync(file, `${current.trimEnd()}\n\n${block.trim()}\n`);
    return "added";
  }

  const prefixStart = current.lastIndexOf("# Spine Companion local MCP bridge.", start);
  const blockStart = prefixStart === -1 ? start : prefixStart;
  const nextSection = current.slice(start + marker.length).search(/\n\[[^\]]+\]/);
  const blockEnd = nextSection === -1
    ? current.length
    : start + marker.length + nextSection + 1;
  fs.writeFileSync(file, `${current.slice(0, blockStart).trimEnd()}\n\n${block.trim()}\n\n${current.slice(blockEnd).trimStart()}`);
  return "updated";
}

const policy = `<!-- spine-companion-status -->
# Spine Companion Status Reporting

When the spine_companion MCP tools are available, proactively report work phases:
- thinking: reasoning, planning, or reading context.
- editing: changing files.
- running: running commands, tests, builds, or long local tasks.
- reviewing: checking results, diffs, screenshots, or test output.
- succeeded: final successful completion.
- failed: blocker or failed completion.
- waiting: waiting for user input or an external process.

Use companion_report_ai_phase with a short message. companion_report_codex_phase
is a compatibility alias only. If the MCP server is not
available but the local companion app is running, report the same phase with:
\`bun ${reportScript.replace(/\\/g, "/")} <phase> "<short message>"\`. Continue the user task
if status reporting is unavailable.`;

function installCodex() {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  const marker = "[mcp_servers.spine_companion]";
  if (!fs.existsSync(configPath)) {
    console.log(`skip codex config, not found: ${configPath}`);
  } else {
    const result = upsertBlock(configPath, marker, codexMcpBlock());
    console.log(`${result} Codex MCP (${runtime}): ${configPath}`);
  }
  const agentsPath = path.join(os.homedir(), ".codex", "AGENTS.md");
  console.log(appendBlock(agentsPath, "spine-companion-status", policy) ? `updated ${agentsPath}` : "Codex AGENTS policy already exists.");
}

function installCursor() {
  const mcpPath = path.join(repoRoot, ".cursor", "mcp.json");
  const json = readJson(mcpPath);
  json.mcpServers = json.mcpServers || {};
  json.mcpServers.spine_companion = mcpJsonEntry("cursor-mcp", "Cursor");
  writeJson(mcpPath, json);
  const rulePath = path.join(repoRoot, ".cursor", "rules", "spine-companion-status.mdc");
  appendBlock(rulePath, "spine-companion-status", policy);
  console.log(`configured Cursor workspace: ${mcpPath}`);
}

function installClaudeDesktop() {
  const base =
    process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Claude")
        : path.join(os.homedir(), ".config", "Claude");
  const configPath = path.join(base, "claude_desktop_config.json");
  const json = readJson(configPath);
  json.mcpServers = json.mcpServers || {};
  json.mcpServers.spine_companion = mcpJsonEntry("claude-mcp", "Claude");
  writeJson(configPath, json);
  console.log(`configured Claude Desktop: ${configPath}`);
}

function installClaudeCode() {
  const mcpPath = path.join(repoRoot, ".mcp.json");
  const json = readJson(mcpPath);
  json.mcpServers = json.mcpServers || {};
  json.mcpServers.spine_companion = mcpJsonEntry("claude-code-mcp", "Claude Code");
  writeJson(mcpPath, json);
  const claudePath = path.join(repoRoot, "CLAUDE.md");
  appendBlock(claudePath, "spine-companion-status", policy);
  console.log(`configured Claude Code workspace: ${mcpPath}`);
}

function installClaudeCli() {
  installClaudeCode();
  const payload = JSON.stringify({
    type: "stdio",
    command: runtime,
    args: [mcpServer.replace(/\\/g, "/")],
    env: sourceEnv("claude-cli-mcp", "Claude CLI")
  });
  try {
    childProcess.execFileSync("claude", ["mcp", "add-json", "spine_companion", payload, "--scope", "user"], {
      stdio: "inherit"
    });
  } catch (_error) {
    console.log("Claude CLI command was not available; workspace .mcp.json was written instead.");
  }
}

const installers = {
  codex: installCodex,
  "codex-cli": installCodex,
  cursor: installCursor,
  "claude-desktop": installClaudeDesktop,
  "claude-code": installClaudeCode,
  "claude-cli": installClaudeCli
};
const defaultTargets = ["codex", "cursor", "claude-desktop", "claude-cli"];

if (hasFlag("--help")) {
  console.log("Usage: bun scripts/configure-ai-tools.cjs --repo <spine-companion-repo> --target all|codex|codex-cli|cursor|claude-desktop|claude-code|claude-cli [--api http://127.0.0.1:17388] [--runtime bun|node]");
  process.exit(0);
}

const selected = target === "all" ? defaultTargets : target.split(",").map((item) => item.trim()).filter(Boolean);
for (const name of selected) {
  if (!installers[name]) throw new Error(`Unknown target: ${name}`);
  installers[name]();
}

console.log("Restart configured AI tools so they can load the MCP server.");
