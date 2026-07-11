const previewIntegrations = [
  { id: "codex", name: "Codex", source: "codex-mcp", sourceLabel: "Codex", configFormat: "codexToml", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: false, lastTestOk: true, lastTestedAt: Date.now(), status: "Configured", note: "Codex CLI and desktop tasks", configPath: "~/.codex/config.toml", instructionsPath: "~/.codex/AGENTS.md" },
  { id: "vscode", name: "VS Code / Copilot", source: "vscode-mcp", sourceLabel: "VS Code", configFormat: "mcpServersJson", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: true, restoreAvailable: true, lastBackupPath: "User/mcp.json.bak-preview", status: "Configured", note: "GitHub Copilot agent mode", configPath: "User/mcp.json", instructionsPath: ".github/copilot-instructions.md" },
  { id: "opencode", name: "OpenCode", source: "opencode-mcp", sourceLabel: "OpenCode", configFormat: "openCodeJson", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: false, lastTestOk: false, lastTestError: "The MCP process exited before initialization completed.", status: "Configured", note: "OpenCode terminal agent", configPath: "~/.config/opencode/opencode.json" },
  { id: "mimocode", name: "MiMoCode", source: "mimocode-mcp", sourceLabel: "MiMoCode", configFormat: "commandArrayJson", installed: false, configFound: false, configured: false, instructionsFound: false, status: "Not detected", note: "Manual fallback is available" },
  { id: "custom", name: "Custom MCP Client", source: "ai-mcp", sourceLabel: "AI", configFormat: "templateOnly", installed: false, configFound: false, configured: false, instructionsFound: false, status: "Template only", note: "For future and unsupported MCP clients" }
];

export function installManagerPreviewBridge() {
  if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("preview") !== "integrations") return false;
  window.companion = {
    getConfig: async () => ({ version: "preview", ui: { locale: "zh-CN" }, models: { catalog: [] }, spine: {} }),
    getInstalledModels: async () => [],
    listReminders: async () => [],
    checkUpdates: async () => ({ currentVersion: "preview", updateAvailable: false, channel: "prerelease" }),
    listAiIntegrations: async () => previewIntegrations,
    acknowledgeAiIntegrationRestart: async (id) => {
      const item = previewIntegrations.find((integration) => integration.id === id);
      if (item) item.needsRestart = false;
    },
    restoreAiIntegrationBackup: async (id) => ({ targetPath: id, safetyBackupPath: `${id}.bak-preview` }),
    getDiagnostics: async () => ({}),
    getHistory: async () => [],
    onDownloadProgress: () => () => {},
    onConfigChanged: () => () => {},
    onReminders: () => () => {},
    onState: () => () => {}
  };
  return true;
}
