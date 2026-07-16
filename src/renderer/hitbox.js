export function calculateInteractiveBounds({
  width,
  height,
  left,
  top,
  modelX,
  modelY,
  userScale = 1,
  hitboxPadding = 8
}) {
  const safeWidth = Math.max(1, Number(width) || 0);
  const safeHeight = Math.max(1, Number(height) || 0);
  const hitWidth = Math.max(44, safeWidth);
  const hitHeight = Math.max(72, safeHeight);
  const padding = Math.max(4, Math.min(24, Number(hitboxPadding || 0) * Math.max(0.7, Number(userScale) || 1)));
  const exactLeft = Number(left);
  const exactTop = Number(top);
  const centerX = Number.isFinite(exactLeft) ? exactLeft + safeWidth / 2 : Number(modelX || 0);
  const centerY = Number.isFinite(exactTop) ? exactTop + safeHeight / 2 : Number(modelY || 0) - safeHeight / 2;
  return {
    left: centerX - hitWidth / 2 - padding,
    right: centerX + hitWidth / 2 + padding,
    top: centerY - hitHeight / 2 - padding,
    bottom: centerY + hitHeight / 2 + padding
  };
}

export function transformLocalBounds(bounds, transform = {}) {
  if (!bounds) return null;
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scaleX = Number.isFinite(Number(transform.scaleX)) ? Number(transform.scaleX) : 1;
  const scaleY = Number.isFinite(Number(transform.scaleY)) ? Number(transform.scaleY) : 1;
  const x = Number(bounds.x || 0) + Number(transform.childX || 0);
  const y = Number(bounds.y || 0) + Number(transform.childY || 0);
  const firstX = Number(transform.x || 0) + x * scaleX;
  const secondX = Number(transform.x || 0) + (x + width) * scaleX;
  const firstY = Number(transform.y || 0) + y * scaleY;
  const secondY = Number(transform.y || 0) + (y + height) * scaleY;
  return {
    left: Math.min(firstX, secondX),
    right: Math.max(firstX, secondX),
    top: Math.min(firstY, secondY),
    bottom: Math.max(firstY, secondY),
    width: Math.abs(secondX - firstX),
    height: Math.abs(secondY - firstY)
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
