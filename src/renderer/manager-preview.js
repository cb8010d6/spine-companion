const previewIntegrations = [
  { id: "codex", name: "Codex", source: "codex-mcp", sourceLabel: "Codex", configFormat: "codexToml", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: false, lastTestOk: true, lastTestedAt: Date.now(), status: "Configured", note: "Codex CLI and desktop tasks", configPath: "~/.codex/config.toml", instructionsPath: "~/.codex/AGENTS.md" },
  { id: "vscode", name: "VS Code / Copilot", source: "vscode-mcp", sourceLabel: "VS Code", configFormat: "mcpServersJson", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: true, restoreAvailable: true, lastBackupPath: "User/mcp.json.bak-preview", status: "Configured", note: "GitHub Copilot agent mode", configPath: "User/mcp.json", instructionsPath: ".github/copilot-instructions.md" },
  { id: "opencode", name: "OpenCode", source: "opencode-mcp", sourceLabel: "OpenCode", configFormat: "openCodeJson", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: false, lastTestOk: false, lastTestError: "The MCP process exited before initialization completed.", status: "Configured", note: "OpenCode terminal agent", configPath: "~/.config/opencode/opencode.json" },
  { id: "mimocode", name: "MiMoCode", source: "mimocode-mcp", sourceLabel: "MiMoCode", configFormat: "commandArrayJson", installed: false, configFound: false, configured: false, instructionsFound: false, status: "Not detected", note: "Manual fallback is available" },
  { id: "custom", name: "Custom MCP Client", source: "ai-mcp", sourceLabel: "AI", configFormat: "templateOnly", installed: false, configFound: false, configured: false, instructionsFound: false, status: "Template only", note: "For future and unsupported MCP clients" }
];

export function installManagerPreviewBridge() {
  const params = new URLSearchParams(window.location.search);
  if (!import.meta.env.DEV || !["integrations", "manager"].includes(params.get("preview"))) return false;
  const previewConfig = {
    version: "preview",
    ui: {
      locale: params.get("locale") || "zh-CN",
      theme: params.get("theme") || "system"
    },
    models: { sources: [{ id: "ark-models", label: "Ark-Models (GitHub)", catalogUrl: "https://example.invalid/catalog.json", kind: "official", enabled: true }], catalog: [
      { id: "ark-1001-amiya2-sale-16", name: "Amiya Guard Skin #16", source: "Ark-Models", spineVersion: "Spine 3.8", licenseNote: "Third-party source; review before download.", repositoryUrl: "https://github.com/isHarryh/Ark-Models" },
      { id: "sample-local-avatar", name: "Sample Local Avatar", source: "Local preview", spineVersion: "Spine 3.8" }
    ] },
    spine: {}
  };
  window.companion = {
    getConfig: async () => previewConfig,
    saveSettings: async (patch = {}) => {
      previewConfig.ui = { ...previewConfig.ui, ...(patch.ui || {}) };
      previewConfig.spine = { ...previewConfig.spine, ...(patch.spine || {}) };
      return previewConfig;
    },
    getInstalledModels: async () => [{ id: "sample-local-avatar", name: "Sample Local Avatar", source: "Local preview", skel: "sample.skel" }],
    listReminders: async () => [],
    checkUpdates: async () => ({ currentVersion: "preview", updateAvailable: false, channel: previewConfig.ui?.updateChannel === "stable" ? "stable" : "prerelease" }),
    listAiIntegrations: async () => previewIntegrations,
    avatarRequirements: async () => ({ layout: ["avatar-pack.json", "preview.png", "layers/", "exports/"] }),
    listAvatarPacks: async () => [{ id: "sample-avatar", name: "Sample Avatar Draft", path: "C:/Avatars/sample-avatar", runtimeReady: false }],
    loadAvatarManifest: async () => ({ version: 1, id: "sample-avatar", name: "Sample Avatar Draft", source: "local", licenseNote: "User-owned", layers: [{ id: "body", name: "Body", file: "layers/body.png", visible: true, order: 0, anchor: { x: .5, y: .5 }, offset: { x: 0, y: 0 }, scale: { x: 1, y: 1 } }], motions: { idle: "Relax" } }),
    saveAvatarManifest: async () => ({ ok: true, issues: [], hasPreview: true, hasLayersDir: true, runtimeReady: false }),
    readAvatarAsset: async () => { throw new Error("Preview asset unavailable"); },
    importAvatarLayers: async () => [],
    pickAvatarLayerFiles: async () => [],
    createAvatarPack: async (input) => ({ path: input.path, id: input.id, created: true }),
    duplicateAvatarPack: async (input) => ({ path: `${input.destinationParent}/${input.id}`, id: input.id, duplicated: true }),
    deleteAvatarPack: async () => ({ deleted: true }),
    repackAvatarPack: async (path) => ({ path, repacked: true }),
    refreshModelCatalogs: async () => ({ models: [{ catalogSourceId: "ark-models", id: "ark-models-002-amiya", name: "Amiya", source: "Ark-Models", author: "isHarryh/Ark-Models contributors", license: "NOASSERTION", licenseNote: "Third-party source; review before download.", repositoryUrl: "https://github.com/isHarryh/Ark-Models/tree/main/models/002_amiya", skel: "build_char_002_amiya.skel", files: [], spine: { min: "3.8.99", max: "3.8.99" } }], sources: [{ sourceId: "ark-models", state: "stale", modelCount: 1, error: "Preview mode" }] }),
    importCatalogModel: async (entry) => ({ id: entry.id || entry.model?.id, name: entry.name || entry.model?.name }),
    getCurrentModel: async () => ({ id: "sample-local-avatar", name: "Sample Local Avatar" }),
    setActiveModel: async (id) => ({ id }),
    beginModelTrial: async (id) => ({ id }),
    confirmModelTrial: async () => null,
    cancelModelTrial: async () => null,
    pickAvatarPackFolder: async () => null,
    validateAvatarPack: async () => ({ ok: true, id: "sample-avatar", name: "Sample Avatar Draft", draft: true, runtimeReady: false, hasPreview: true, hasLayersDir: true, warnings: [], errors: [] }),
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
