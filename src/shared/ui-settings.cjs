const DEFAULT_UI_SETTINGS = Object.freeze({
  hudVisible: false,
  bubbleVisible: true,
  bubbleShadow: true,
  bubbleBackground: "solid",
  bubbleHoldMs: 8000,
  dragMode: "compatible",
  autoRevealOnMcp: true,
  systemNotifications: true
});

const BUBBLE_BACKGROUNDS = new Set(["solid", "soft", "clear", "light"]);
const DRAG_MODES = new Set(["compatible", "smooth"]);

function normalizeUiSettings(input = {}, defaults = DEFAULT_UI_SETTINGS) {
  const source = input && typeof input === "object" ? input : {};
  return {
    hudVisible: typeof source.hudVisible === "boolean" ? source.hudVisible : defaults.hudVisible,
    bubbleVisible: typeof source.bubbleVisible === "boolean" ? source.bubbleVisible : defaults.bubbleVisible,
    bubbleShadow: typeof source.bubbleShadow === "boolean" ? source.bubbleShadow : defaults.bubbleShadow,
    bubbleBackground: BUBBLE_BACKGROUNDS.has(source.bubbleBackground)
      ? source.bubbleBackground
      : defaults.bubbleBackground,
    bubbleHoldMs: Number.isFinite(Number(source.bubbleHoldMs))
      ? Math.min(60000, Math.max(1500, Number(source.bubbleHoldMs)))
      : defaults.bubbleHoldMs,
    dragMode: DRAG_MODES.has(source.dragMode) ? source.dragMode : defaults.dragMode,
    autoRevealOnMcp: typeof source.autoRevealOnMcp === "boolean" ? source.autoRevealOnMcp : defaults.autoRevealOnMcp,
    systemNotifications: typeof source.systemNotifications === "boolean" ? source.systemNotifications : defaults.systemNotifications
  };
}

function applyUiSettingsPatch(current = DEFAULT_UI_SETTINGS, patch = {}) {
  const next = { ...current };
  if (typeof patch.hudVisible === "boolean") next.hudVisible = patch.hudVisible;
  if (typeof patch.bubbleVisible === "boolean") next.bubbleVisible = patch.bubbleVisible;
  if (typeof patch.bubbleShadow === "boolean") next.bubbleShadow = patch.bubbleShadow;
  if (BUBBLE_BACKGROUNDS.has(patch.bubbleBackground)) next.bubbleBackground = patch.bubbleBackground;
  if (Number.isFinite(Number(patch.bubbleHoldMs))) {
    next.bubbleHoldMs = Math.min(60000, Math.max(1500, Number(patch.bubbleHoldMs)));
  }
  if (DRAG_MODES.has(patch.dragMode)) next.dragMode = patch.dragMode;
  if (typeof patch.autoRevealOnMcp === "boolean") next.autoRevealOnMcp = patch.autoRevealOnMcp;
  if (typeof patch.systemNotifications === "boolean") next.systemNotifications = patch.systemNotifications;
  return normalizeUiSettings(next, current);
}

module.exports = {
  DEFAULT_UI_SETTINGS,
  BUBBLE_BACKGROUNDS,
  DRAG_MODES,
  normalizeUiSettings,
  applyUiSettingsPatch
};
