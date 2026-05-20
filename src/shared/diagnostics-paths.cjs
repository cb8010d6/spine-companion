const path = require("node:path");

function mcpConfigCandidates(home, platform = process.platform, env = process.env) {
  if (!home) return [];
  const candidates = [
    { tool: "Codex", path: path.join(home, ".codex", "config.toml") },
    { tool: "Gemini / Antigravity", path: path.join(home, ".gemini", "antigravity", "mcp_config.json") }
  ];

  if (platform === "win32") {
    const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
    candidates.push(
      { tool: "Claude", path: path.join(roaming, "Claude", "claude_desktop_config.json") },
      {
        tool: "Roo / Cline",
        path: path.join(
          roaming,
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "cline_mcp_settings.json"
        )
      }
    );
  } else if (platform === "darwin") {
    candidates.push(
      {
        tool: "Claude",
        path: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      },
      {
        tool: "Roo / Cline",
        path: path.join(
          home,
          "Library",
          "Application Support",
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "cline_mcp_settings.json"
        )
      }
    );
  } else {
    const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
    candidates.push(
      { tool: "Claude", path: path.join(configHome, "Claude", "claude_desktop_config.json") },
      {
        tool: "Roo / Cline",
        path: path.join(
          configHome,
          "Code",
          "User",
          "globalStorage",
          "rooveterinaryinc.roo-cline",
          "settings",
          "cline_mcp_settings.json"
        )
      }
    );
  }

  return candidates;
}

function detectMcpReferences(readText, candidates) {
  const matches = [];
  for (const candidate of candidates) {
    const content = readText(candidate.path);
    if (!content) continue;
    const configured = content.includes("spine_companion") || content.includes("spine-companion");
    matches.push({ ...candidate, exists: true, configured });
  }
  return {
    configured: matches.some((match) => match.configured),
    matches
  };
}

module.exports = {
  mcpConfigCandidates,
  detectMcpReferences
};
