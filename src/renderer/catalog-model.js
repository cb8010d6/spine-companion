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
