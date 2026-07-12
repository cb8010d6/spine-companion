import { spineAssetUrl } from "../shared/asset-url.js";

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
  const isActiveModel = activeModelMatches(model, config);
  const previewSkel = model.skel || config.spine?.skel || "";
  const spineConfig = {
    ...config,
    spine: {
      ...(config.spine || {}),
      skel: previewSkel
    }
  };
  const remoteSkel = (model.files || []).find((file) => file.name === previewSkel || /\.skel$/i.test(file.name || ""));
  const localSpinePreviewUrl = isActiveModel && previewSkel ? spineAssetUrl(spineConfig) : "";
  const spinePreviewUrl = localSpinePreviewUrl || model.preparedPreviewUrl || "";
  const imageUrl = model.previewUrl || model.thumbnailUrl || "";
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
    spinePreviewUrl,
    canRenderSpinePreview: Boolean(spinePreviewUrl),
    autoRenderSpinePreview: Boolean(localSpinePreviewUrl),
    canPrepareRemotePreview: Boolean(!spinePreviewUrl && remoteSkel?.url),
    style: {
      background: `linear-gradient(135deg, hsl(${hue} 56% 24%), hsl(${(hue + 42) % 360} 52% 36%))`
    }
  };
}
