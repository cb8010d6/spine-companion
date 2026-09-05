/**
 * @typedef {object} UiSettings
 * @property {boolean} hudVisible
 * @property {boolean} bubbleVisible
 * @property {boolean} bubbleShadow
 * @property {string} bubbleBackground
 * @property {number} bubbleHoldMs
 * @property {string} dragMode
 * @property {string} frameRateMode
 * @property {boolean} autoRevealOnMcp
 * @property {boolean} systemNotifications
 * @property {boolean} updateAutoCheck
 * @property {string} updateChannel
 * @property {number} maxDevicePixelRatio
 * @property {number} hitboxPadding
 * @property {boolean} debugHitbox
 * @property {string} theme
 */

/** @type {Readonly<UiSettings>} */
const DEFAULT_UI_SETTINGS = Object.freeze({
  hudVisible: false,
  bubbleVisible: true,
  bubbleShadow: true,
  bubbleBackground: "solid",
  bubbleHoldMs: 8000,
  dragMode: "smooth",
  frameRateMode: "display",
  autoRevealOnMcp: true,
  systemNotifications: true,
  updateAutoCheck: true,
  updateChannel: "auto",
  maxDevicePixelRatio: 2,
  hitboxPadding: 8,
  debugHitbox: false,
  theme: "system"
});

const BUBBLE_BACKGROUNDS = new Set(["solid", "soft", "clear", "light"]);
const DRAG_MODES = new Set(["compatible", "smooth"]);
const FRAME_RATE_MODES = new Set(["display", "60", "30"]);
const THEMES = new Set(["system", "light", "dark"]);
const UPDATE_CHANNELS = new Set(["auto", "stable", "prerelease"]);

/** @param {Partial<UiSettings>} input */
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
    frameRateMode: FRAME_RATE_MODES.has(String(source.frameRateMode))
      ? String(source.frameRateMode)
      : defaults.frameRateMode,
    autoRevealOnMcp: typeof source.autoRevealOnMcp === "boolean" ? source.autoRevealOnMcp : defaults.autoRevealOnMcp,
    systemNotifications: typeof source.systemNotifications === "boolean" ? source.systemNotifications : defaults.systemNotifications,
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
  if (FRAME_RATE_MODES.has(String(patch.frameRateMode))) next.frameRateMode = String(patch.frameRateMode);
  if (typeof patch.autoRevealOnMcp === "boolean") next.autoRevealOnMcp = patch.autoRevealOnMcp;
  if (typeof patch.systemNotifications === "boolean") next.systemNotifications = patch.systemNotifications;
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
  FRAME_RATE_MODES,
  THEMES,
  UPDATE_CHANNELS,
  normalizeUiSettings,
  applyUiSettingsPatch
};
