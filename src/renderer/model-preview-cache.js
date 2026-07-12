const CACHE_PREFIX = "spine-companion:model-preview:v1:";
const MAX_ENTRIES = 80;

function storageOrDefault(storage) {
  try { return storage || globalThis.localStorage || null; }
  catch { return null; }
}

function modelKey(model = {}) {
  return String(model.id || model.skel || "").trim();
}

export function modelPreviewSignature(model = {}) {
  const files = (model.files || [])
    .map((file) => `${file.name || ""}:${file.sha256 || file.sizeBytes || ""}`)
    .sort()
    .join("|");
  return `${modelKey(model)}|${model.skel || ""}|${files}`;
}

function cacheKey(model) {
  const key = modelKey(model);
  return key ? `${CACHE_PREFIX}${key}` : "";
}

export function readCachedModelPreview(model, storage) {
  const target = storageOrDefault(storage);
  const key = cacheKey(model);
  if (!target || !key) return "";
  try {
    const cached = JSON.parse(target.getItem(key) || "null");
    if (cached?.signature !== modelPreviewSignature(model) || typeof cached?.dataUrl !== "string") return "";
    return cached.dataUrl.startsWith("data:image/") ? cached.dataUrl : "";
  } catch {
    return "";
  }
}

function prunePreviewCache(storage) {
  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      entries.push({ key, updatedAt: Number(value?.updatedAt || 0) });
    } catch {
      entries.push({ key, updatedAt: 0 });
    }
  }
  entries.sort((left, right) => right.updatedAt - left.updatedAt);
  for (const entry of entries.slice(MAX_ENTRIES)) storage.removeItem(entry.key);
}

export function writeCachedModelPreview(model, dataUrl, storage) {
  const target = storageOrDefault(storage);
  const key = cacheKey(model);
  if (!target || !key || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return false;
  try {
    target.setItem(key, JSON.stringify({
      signature: modelPreviewSignature(model),
      dataUrl,
      updatedAt: Date.now()
    }));
    prunePreviewCache(target);
    return true;
  } catch {
    return false;
  }
}
