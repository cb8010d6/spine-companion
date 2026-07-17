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

export function shouldUseNativeWindowDrag(pointerType = "mouse", position = null) {
  if (pointerType && pointerType !== "mouse") return false;
  const windowY = Number(position?.y);
  const workAreaTop = Number(position?.workAreaTop);
  const windowHeight = Number(position?.height);
  if (Number.isFinite(windowY) && Number.isFinite(workAreaTop)) {
    const edgeZone = Number.isFinite(windowHeight)
      ? Math.max(96, Math.min(640, windowHeight))
      : 360;
    if (windowY <= workAreaTop + edgeZone) return false;
  }
  return true;
}
