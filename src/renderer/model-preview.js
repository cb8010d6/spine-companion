function encodedAssetUrl(origin, fileName) {
  if (!origin || !fileName) return "";
  return `${String(origin).replace(/\/$/, "")}/assets/spine/${encodeURIComponent(fileName)}`;
}

function modelPngFile(model = {}) {
  return (model.files || []).find((file) => {
    const name = String(file?.name || file?.url || "").toLowerCase();
    return name.endsWith(".png");
  }) || null;
}

function activeModelMatches(model = {}, config = {}) {
  const activeSkel = String(config.spine?.skel || "");
  const activeDir = String(config.spine?.assetDir || "").replace(/\\/g, "/");
  return Boolean(
    model.skel && activeSkel === model.skel
    || model.id && (activeDir.endsWith(`/${model.id}`) || activeDir.endsWith(model.id))
  );
}

export function modelPreview(model = {}, config = {}) {
  const label = model.name || model.id || model.skel || "Spine";
  const png = modelPngFile(model);
  const localImageUrl = activeModelMatches(model, config)
    ? encodedAssetUrl(config.server?.origin, png?.name)
    : "";
  const imageUrl = model.previewUrl || model.thumbnailUrl || localImageUrl || png?.url || "";
  const initials = label
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SC";
  const hue = Math.abs([...label].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % 360;
  return {
    initials,
    label,
    imageUrl,
    style: {
      background: `linear-gradient(135deg, hsl(${hue} 56% 24%), hsl(${(hue + 42) % 360} 52% 36%))`
    }
  };
}
