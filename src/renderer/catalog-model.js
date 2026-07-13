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
      versionVerified: model.versionVerified !== false,
      _catalogEntry: entry
    }];
  });
}

export const LIBRARY_PAGE_SIZE = 12;
export const LIBRARY_PREVIEW_BATCH_SIZE = 6;
export const LIBRARY_PREVIEW_CONFIRM_BYTES = 30 * 1024 * 1024;

export function enabledCatalogSources(sources = []) {
  return (sources || []).filter((source) => source?.enabled !== false && source?.id);
}

export function resolveCatalogSourceId(sources = [], selected = "") {
  const enabled = enabledCatalogSources(sources);
  if (!enabled.length) return "";
  return enabled.some((source) => source.id === selected) ? selected : enabled[0].id;
}

export function catalogModelSourceId(model = {}, fallback = "ark-models") {
  return model.sourceId || model.catalogSourceId || fallback;
}

export function catalogModelSizeBytes(model = {}) {
  return (model.files || []).reduce((total, file) => total + Math.max(0, Number(file?.sizeBytes) || 0), 0);
}

export function catalogSpineDisplayVersion(model = {}) {
  const normalizeVersion = (value, fallback = "3.8") => String(value || fallback)
    .trim()
    .replace(/^(?:spine\s*)+/i, "")
    .replace(/^v(?=\d)/i, "") || fallback;
  const minimum = normalizeVersion(model.spine?.min || model.spineVersion);
  const maximum = normalizeVersion(model.spine?.max, minimum);
  if (model.versionVerified !== false) return minimum;
  const minimumLine = minimum.match(/^(\d+)\.(\d+)/);
  const maximumLine = maximum.match(/^(\d+)\.(\d+)/);
  if (minimumLine && maximumLine && minimumLine[1] === maximumLine[1] && minimumLine[2] === maximumLine[2]) {
    return `${minimumLine[1]}.${minimumLine[2]}`;
  }
  return minimum === maximum ? minimum : `${minimum}-${maximum}`;
}

export function selectPreviewBatch(tasks = [], limit = LIBRARY_PREVIEW_BATCH_SIZE) {
  return (tasks || []).slice(0, Math.max(0, Number(limit) || 0));
}

export function canRemoveCatalogSource(source = {}) {
  return source.kind !== "official";
}

export function catalogDisplayName(model = {}) {
  const explicit = String(model.name || "").trim();
  if (explicit) return explicit;
  const id = String(model.id || "").trim();
  if (!id) return "Spine model";
  return id
    .replace(/^ark-models-/, "")
    .replace(/^\d+-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => /^\d+$/.test(part) ? `#${part}` : `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
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

export function upsertInstalledModel(models = [], installedModel = {}, catalogModel = {}) {
  const id = installedModel.id || catalogModel.id;
  if (!id) return models;
  const existing = (models || []).find((model) => model.id === id) || {};
  const merged = mergeInstalledModelMetadata(
    { ...catalogModel, id },
    { ...existing, ...installedModel, id }
  );
  const index = (models || []).findIndex((model) => model.id === id);
  if (index < 0) return [...(models || []), merged];
  const next = [...models];
  next[index] = merged;
  return next;
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
