const DEFAULT_ANCHOR = Object.freeze({ x: 0.5, y: 0.5 });
const DEFAULT_OFFSET = Object.freeze({ x: 0, y: 0 });
const DEFAULT_SCALE = Object.freeze({ x: 1, y: 1 });

export function normalizeAvatarManifest(input = {}) {
  const layers = Array.isArray(input.layers) ? input.layers : [];
  return {
    version: 1,
    id: String(input.id || ""),
    name: String(input.name || ""),
    source: String(input.source || "local"),
    licenseNote: String(input.licenseNote || ""),
    spineVersion: String(input.spineVersion || "3.8"),
    preview: String(input.preview || "preview.png"),
    layers: layers.map((layer, index) => normalizeLayer(layer, index)),
    motions: { ...(input.motions || {}) },
    states: { ...(input.states || {}) },
    runtimeSkel: String(input.runtimeSkel || ""),
    runtimeAtlas: String(input.runtimeAtlas || ""),
    runtimeReady: input.runtimeReady === true
  };
}

export function normalizeLayer(layer = {}, index = 0) {
  const id = String(layer.id || `layer_${index + 1}`);
  return {
    id,
    name: String(layer.name || id),
    file: String(layer.file || ""),
    visible: layer.visible !== false,
    order: Number.isFinite(Number(layer.order)) ? Number(layer.order) : index,
    anchor: point(layer.anchor, DEFAULT_ANCHOR),
    offset: point(layer.offset, DEFAULT_OFFSET),
    scale: point(layer.scale, DEFAULT_SCALE),
    crop: layer.crop ? {
      x: numberOr(layer.crop.x, 0), y: numberOr(layer.crop.y, 0),
      width: numberOr(layer.crop.width, 0), height: numberOr(layer.crop.height, 0)
    } : null
  };
}

export function addLayer(manifest, layer = {}) {
  const next = normalizeAvatarManifest(manifest);
  const used = new Set(next.layers.map((item) => item.id));
  let number = next.layers.length + 1;
  let id = String(layer.id || `layer_${number}`);
  while (used.has(id)) id = `layer_${++number}`;
  next.layers.push(normalizeLayer({ ...layer, id }, next.layers.length));
  return reorder(next, next.layers.map((item) => item.id));
}

export function updateLayer(manifest, id, patch) {
  const next = normalizeAvatarManifest(manifest);
  next.layers = next.layers.map((layer) => layer.id === id
    ? normalizeLayer({
      ...layer, ...patch,
      anchor: { ...layer.anchor, ...(patch.anchor || {}) },
      offset: { ...layer.offset, ...(patch.offset || {}) },
      scale: { ...layer.scale, ...(patch.scale || {}) },
      crop: patch.crop === null ? null : { ...(layer.crop || {}), ...(patch.crop || {}) }
    }, layer.order)
    : layer);
  return next;
}

export function removeLayer(manifest, id) {
  const next = normalizeAvatarManifest(manifest);
  next.layers = next.layers.filter((layer) => layer.id !== id);
  return reorder(next, next.layers.map((layer) => layer.id));
}

export function moveLayer(manifest, id, delta) {
  const next = normalizeAvatarManifest(manifest);
  const ids = next.layers.sort((a, b) => a.order - b.order).map((layer) => layer.id);
  const from = ids.indexOf(id);
  if (from < 0) return next;
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return reorder(next, ids);
}

export function setMotion(manifest, state, animation) {
  const next = normalizeAvatarManifest(manifest);
  const value = String(animation || "").trim();
  if (value) next.motions[state] = value;
  else delete next.motions[state];
  return next;
}

export function issueFieldId(path = "") {
  return `avatar-field-${String(path).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "")}`;
}

function reorder(manifest, ids) {
  const ranks = new Map(ids.map((id, index) => [id, index]));
  manifest.layers = manifest.layers
    .sort((a, b) => (ranks.get(a.id) ?? a.order) - (ranks.get(b.id) ?? b.order))
    .map((layer, order) => ({ ...layer, order }));
  return manifest;
}

function point(value, fallback) {
  return { x: numberOr(value?.x, fallback.x), y: numberOr(value?.y, fallback.y) };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
