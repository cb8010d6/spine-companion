export function mergeCatalogSources(results = []) {
  const models = new Map();
  const sources = [];
  for (const result of results) {
    sources.push({
      id: result.id || result.sourceId || "unknown",
      name: result.name || result.sourceName || result.id || "Unknown source",
      status: result.error ? "error" : result.stale ? "stale" : "ready",
      error: result.error || "",
      updatedAt: result.updatedAt || 0
    });
    for (const model of result.models || []) {
      const key = `${result.id || result.sourceId || "source"}:${model.id}`;
      models.set(key, { ...model, sourceId: result.id || result.sourceId || "unknown", catalogKey: key });
    }
  }
  return { models: [...models.values()], sources };
}

export function normalizeCatalogEntries(entries = []) {
  return (entries || []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry.model && typeof entry.model === "object" ? entry.model : entry;
    if (!model.id) return [];
    const catalogSourceId = entry.catalogSourceId || model.catalogSourceId || "unknown";
    return [{
      ...model,
      catalogSourceId,
      sourceId: catalogSourceId,
      spineVersion: model.spineVersion || model.spine?.min || "3.8",
      _catalogEntry: entry
    }];
  });
}

export function catalogDownloadRequest(model) {
  return {
    id: model?.id || "",
    catalogEntry: model?._catalogEntry || null
  };
}

export function mergeInstalledModelMetadata(catalogModel = {}, installedModel = {}) {
  const installedName = String(installedModel.name || "").trim();
  const installedUsesIdAsName = !installedName || installedName === installedModel.id;
  return {
    ...catalogModel,
    ...installedModel,
    name: installedUsesIdAsName ? (catalogModel.name || installedName || installedModel.id) : installedName,
    source: installedModel.source === "Local" && catalogModel.source ? catalogModel.source : (installedModel.source || catalogModel.source || "Local")
  };
}

export function filterCatalog(models, { query = "", source = "all", installed = new Map(), compatibility = "compatible" } = {}) {
  const needle = query.trim().toLowerCase();
  return (models || []).filter((model) => {
    if (source !== "all" && model.sourceId !== source) return false;
    if (compatibility === "compatible" && model.compatible === false) return false;
    if (compatibility === "installed" && !installed.has(model.id)) return false;
    if (!needle) return true;
    return [model.name, model.id, model.author, model.license, ...(model.tags || [])]
      .filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
}

export function catalogInstallState(model, installed) {
  const current = installed?.get?.(model.id);
  if (!current) return "available";
  if (model.version && current.version && model.version !== current.version) return "update";
  return "installed";
}
