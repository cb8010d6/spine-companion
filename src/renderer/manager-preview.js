const previewIntegrations = [
  { id: "codex", name: "Codex", source: "codex-mcp", sourceLabel: "Codex", configFormat: "codexToml", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: false, lastTestOk: true, lastTestedAt: Date.now(), status: "Configured", note: "Codex CLI and desktop tasks", configPath: "~/.codex/config.toml", instructionsPath: "~/.codex/AGENTS.md" },
  { id: "vscode", name: "VS Code / Copilot", source: "vscode-mcp", sourceLabel: "VS Code", configFormat: "mcpServersJson", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: true, restoreAvailable: true, lastBackupPath: "User/mcp.json.bak-preview", status: "Configured", note: "GitHub Copilot agent mode", configPath: "User/mcp.json", instructionsPath: ".github/copilot-instructions.md" },
  { id: "opencode", name: "OpenCode", source: "opencode-mcp", sourceLabel: "OpenCode", configFormat: "openCodeJson", installed: true, configFound: true, configured: true, instructionsFound: true, needsRestart: false, lastTestOk: false, lastTestError: "The MCP process exited before initialization completed.", status: "Configured", note: "OpenCode terminal agent", configPath: "~/.config/opencode/opencode.json" },
  { id: "mimocode", name: "MiMoCode", source: "mimocode-mcp", sourceLabel: "MiMoCode", configFormat: "commandArrayJson", installed: false, configFound: false, configured: false, instructionsFound: false, status: "Not detected", note: "Manual fallback is available" },
  { id: "kimi-code", name: "Kimi Code CLI", source: "kimi-mcp", sourceLabel: "Kimi", configFormat: "mcpServersJson", installed: true, configFound: true, configured: false, instructionsFound: false, instructionsPath: "", status: "Config found", note: "Official ~/.kimi/mcp.json integration" },
  { id: "custom", name: "Custom MCP Client", source: "ai-mcp", sourceLabel: "AI", configFormat: "templateOnly", installed: false, configFound: false, configured: false, instructionsFound: false, status: "Template only", note: "For future and unsupported MCP clients" }
];

const previewArkRevision = "2f3187f780108847d7327946e1906fc6b80bead3";
const previewArkRepository = `https://github.com/isHarryh/Ark-Models/tree/${previewArkRevision}`;
const previewArkLicenseWarning = "Upstream license and redistribution rights are not verified by this catalog.";

export function installManagerPreviewBridge() {
  const params = new URLSearchParams(window.location.search);
  if (!import.meta.env.DEV || !["integrations", "manager"].includes(params.get("preview"))) return false;
  const previewConfig = {
    version: "preview",
    ui: {
      locale: params.get("locale") || "zh-CN",
      theme: params.get("theme") || "system"
    },
    models: { sources: [
      { id: "ark-models", label: "Operators / 基建小人", catalogUrl: "https://example.invalid/operators.json", kind: "official", enabled: true },
      { id: "ark-illustrations", label: "Dynamic illustrations / 动态立绘", catalogUrl: "https://example.invalid/illustrations.json", kind: "official", enabled: true },
      { id: "ark-enemies", label: "Enemies / 敌人", catalogUrl: "https://example.invalid/enemies.json", kind: "official", enabled: true }
    ], catalog: [
      { id: "ark-1001-amiya2-sale-16", name: "Amiya Guard Skin #16", source: "Ark-Models", author: "isHarryh/Ark-Models contributors", license: "NOASSERTION", licenseWarning: previewArkLicenseWarning, spineVersion: "Spine 3.8", licenseNote: "Third-party source; review before download.", repositoryUrl: previewArkRepository },
      { id: "sample-local-avatar", name: "Sample Local Avatar", source: "Local preview", spineVersion: "Spine 3.8" }
    ] },
    spine: {}
  };
  let previewInstalledModels = [{ id: "sample-local-avatar", name: "Sample Local Avatar", source: "Local preview", skel: "sample.skel" }];
  const previewCatalogEntries = [
    { catalogSourceId: "ark-models", model: { id: "ark-models-002-amiya", name: "Amiya", category: "operator", compatibilityProfile: "companion", source: "Ark-Models", author: "isHarryh/Ark-Models contributors", license: "NOASSERTION", licenseWarning: previewArkLicenseWarning, licenseNote: "Third-party source; review before download.", repositoryUrl: previewArkRepository, skel: "model.skel", files: [], spine: { min: "3.8.99", max: "3.8.99" } } },
    { catalogSourceId: "ark-illustrations", model: { id: "ark-illustrations-amiya", name: "Amiya Dynamic Illustration", category: "illustration", compatibilityProfile: "idle-only", source: "Ark-Models", author: "isHarryh/Ark-Models contributors", license: "NOASSERTION", licenseWarning: previewArkLicenseWarning, licenseNote: "Third-party source; review before download.", repositoryUrl: previewArkRepository, skel: "model.skel", files: [], spine: { min: "3.8.99", max: "3.8.99" } } },
    { catalogSourceId: "ark-enemies", model: { id: "ark-enemies-gopro", name: "Gopro", category: "enemy", compatibilityProfile: "experimental", source: "Ark-Models", author: "isHarryh/Ark-Models contributors", license: "NOASSERTION", licenseWarning: previewArkLicenseWarning, licenseNote: "Third-party source; review before download.", repositoryUrl: previewArkRepository, skel: "model.skel", files: [], spine: { min: "3.8.99", max: "3.8.99" } } }
  ];
  const installPreviewModel = (entry, activated = false) => {
    const model = entry?.model || entry || {};
    const result = {
      id: model.id,
      name: model.name || model.id,
      source: model.source || "Preview",
      skel: model.skel || "model.skel",
      activated
    };
    previewInstalledModels = [
      ...previewInstalledModels.filter((installed) => installed.id !== result.id),
      result
    ];
    return result;
  };
  window.companion = {
    getConfig: async () => previewConfig,
    saveSettings: async (patch = {}) => {
      previewConfig.ui = { ...previewConfig.ui, ...(patch.ui || {}) };
      previewConfig.spine = { ...previewConfig.spine, ...(patch.spine || {}) };
      previewConfig.models = { ...previewConfig.models, ...(patch.models || {}) };
      return previewConfig;
    },
    saveModelPresentation: async (input) => {
      previewConfig.models.presentations = { ...(previewConfig.models.presentations || {}), [input.modelId]: { ...input, modelId: undefined } };
      previewConfig.spine = { ...previewConfig.spine, ...input };
      return { modelId: input.modelId, presentation: input, active: true };
    },
    getInstalledModels: async () => previewInstalledModels.map((model) => ({ ...model })),
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
    getCachedModelCatalogs: async () => ({ models: [], sources: [] }),
    refreshModelCatalogs: async () => ({ models: [], sources: previewConfig.models.sources.map((source) => ({ sourceId: source.id, state: "stale", modelCount: 1, error: "Preview mode" })) }),
    searchModelCatalog: async (request = {}) => {
      const sourceIds = new Set(request.sourceIds || []);
      const query = String(request.query || "").toLowerCase();
      const installed = new Set(previewInstalledModels.map((model) => model.id));
      const matches = previewCatalogEntries.filter((entry) => (!sourceIds.size || sourceIds.has(entry.catalogSourceId))
        && (!query || `${entry.model.name} ${entry.model.id}`.toLowerCase().includes(query))
        && (request.installationFilter === "installed" ? installed.has(entry.model.id) : request.installationFilter === "available" ? !installed.has(entry.model.id) : true));
      return { models: matches, page: 1, pageSize: request.pageSize || 24, total: matches.length, totalPages: matches.length ? 1 : 0 };
    },
    installModel: async (input) => installPreviewModel(input, false),
    importCatalogModel: async (sourceId, modelId, activate = true, acknowledgement = false) => installPreviewModel(previewCatalogEntries.find((entry) => entry.catalogSourceId === sourceId && entry.model.id === modelId), activate, acknowledgement),
    installCatalogModel: async (sourceId, modelId, acknowledgement = false) => installPreviewModel(previewCatalogEntries.find((entry) => entry.catalogSourceId === sourceId && entry.model.id === modelId), false, acknowledgement),
    prepareModelPreview: async (sourceId, modelId, acknowledgement = false) => ({ id: modelId, skel: "model.skel", assetUrl: "", cached: false, sourceId, acknowledgement }),
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
