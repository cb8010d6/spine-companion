export function pointerDistance(points = []) {
  if (points.length < 2) return 0;
  const [first, second] = points;
  return Math.hypot(Number(second.x) - Number(first.x), Number(second.y) - Number(first.y));
}

export function pinchScaleDelta(previousDistance, nextDistance) {
  const previous = Number(previousDistance);
  const next = Number(nextDistance);
  if (!Number.isFinite(previous) || !Number.isFinite(next) || previous <= 0) return 0;
  return Math.max(-0.12, Math.min(0.12, (next - previous) / 240));
}

export function shouldUseNativeWindowDrag(pointerType = "mouse") {
  return !pointerType || pointerType === "mouse";
}
