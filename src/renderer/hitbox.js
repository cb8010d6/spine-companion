export function calculateInteractiveBounds({
  width,
  height,
  modelX,
  modelY,
  userScale = 1,
  hitboxPadding = 8
}) {
  const safeWidth = Math.max(1, Number(width) || 0);
  const safeHeight = Math.max(1, Number(height) || 0);
  const hitWidth = Math.max(44, safeWidth * 0.88);
  const hitHeight = Math.max(72, safeHeight * 0.92);
  const padding = Math.max(4, Math.min(24, Number(hitboxPadding || 0) * Math.max(0.7, Number(userScale) || 1)));
  const bottom = Number(modelY || 0) + padding * 0.35;
  return {
    left: Number(modelX || 0) - hitWidth / 2 - padding,
    right: Number(modelX || 0) + hitWidth / 2 + padding,
    top: bottom - hitHeight - padding,
    bottom: bottom + padding
  };
}

export function expandBounds(bounds, padding = 18) {
  if (!bounds) return null;
  const amount = Math.max(0, Number(padding) || 0);
  return {
    left: bounds.left - amount,
    right: bounds.right + amount,
    top: bounds.top - amount,
    bottom: bounds.bottom + amount
  };
}
