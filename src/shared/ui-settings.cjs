const DEFAULT_UI_SETTINGS = Object.freeze({
  hudVisible: false,
  bubbleVisible: true,
  bubbleShadow: true,
  bubbleBackground: "solid",
  bubbleHoldMs: 8000,
  dragMode: "compatible",
  autoRevealOnMcp: true,
  systemNotifications: true,
  shortcutEnabled: true,
  shortcutAccelerator: "CommandOrControl+Shift+S",
  updateAutoCheck: true,
  updateChannel: "auto",
  maxDevicePixelRatio: 2,
  hitboxPadding: 8,
  debugHitbox: false,
  theme: "system"
});

const BUBBLE_BACKGROUNDS = new Set(["solid", "soft", "clear", "light"]);
const DRAG_MODES = new Set(["compatible", "smooth"]);
const THEMES = new Set(["system", "light", "dark"]);
const UPDATE_CHANNELS = new Set(["auto", "stable", "prerelease"]);

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
    systemNotifications: typeof source.systemNotifications === "boolean" ? source.systemNotifications : defaults.systemNotifications,
    shortcutEnabled: typeof source.shortcutEnabled === "boolean" ? source.shortcutEnabled : defaults.shortcutEnabled,
    shortcutAccelerator: typeof source.shortcutAccelerator === "string" && source.shortcutAccelerator.trim()
      ? source.shortcutAccelerator.trim()
      : defaults.shortcutAccelerator,
    updateAutoCheck: typeof source.updateAutoCheck === "boolean" ? source.updateAutoCheck : defaults.updateAutoCheck,
    updateChannel: UPDATE_CHANNELS.has(source.updateChannel) ? source.updateChannel : defaults.updateChannel,
    maxDevicePixelRatio: Number.isFinite(Number(source.maxDevicePixelRatio))
      ? Math.min(3, Math.max(1, Number(source.maxDevicePixelRatio)))
      : defaults.maxDevicePixelRatio,
    hitboxPadding: Number.isFinite(Number(source.hitboxPadding))
      ? Math.min(48, Math.max(0, Number(source.hitboxPadding)))
      : defaults.hitboxPadding,
    debugHitbox: typeof source.debugHitbox === "boolean" ? source.debugHitbox : defaults.debugHitbox,
    theme: THEMES.has(source.theme) ? source.theme : defaults.theme
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
  if (typeof patch.shortcutEnabled === "boolean") next.shortcutEnabled = patch.shortcutEnabled;
  if (typeof patch.shortcutAccelerator === "string" && patch.shortcutAccelerator.trim()) {
    next.shortcutAccelerator = patch.shortcutAccelerator.trim();
  }
  if (typeof patch.updateAutoCheck === "boolean") next.updateAutoCheck = patch.updateAutoCheck;
  if (UPDATE_CHANNELS.has(patch.updateChannel)) next.updateChannel = patch.updateChannel;
  if (Number.isFinite(Number(patch.maxDevicePixelRatio))) {
    next.maxDevicePixelRatio = Math.min(3, Math.max(1, Number(patch.maxDevicePixelRatio)));
  }
  if (Number.isFinite(Number(patch.hitboxPadding))) {
    next.hitboxPadding = Math.min(48, Math.max(0, Number(patch.hitboxPadding)));
  }
  if (typeof patch.debugHitbox === "boolean") next.debugHitbox = patch.debugHitbox;
  if (THEMES.has(patch.theme)) next.theme = patch.theme;
  return normalizeUiSettings(next, current);
}

module.exports = {
  DEFAULT_UI_SETTINGS,
  BUBBLE_BACKGROUNDS,
  DRAG_MODES,
  THEMES,
  UPDATE_CHANNELS,
  normalizeUiSettings,
  applyUiSettingsPatch
};
