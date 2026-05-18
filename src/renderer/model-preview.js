export function modelPreview(model = {}) {
  const label = model.name || model.id || model.skel || "Spine";
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
    style: {
      background: `linear-gradient(135deg, hsl(${hue} 56% 24%), hsl(${(hue + 42) % 360} 52% 36%))`
    }
  };
}
