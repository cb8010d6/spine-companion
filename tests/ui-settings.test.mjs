import { describe, expect, it } from "vitest";

const {
  DEFAULT_UI_SETTINGS,
  normalizeUiSettings,
  applyUiSettingsPatch
} = require("../src/shared/ui-settings.cjs");

describe("ui-settings", () => {
  it("normalizes missing values to defaults", () => {
    expect(normalizeUiSettings({})).toEqual(DEFAULT_UI_SETTINGS);
  });

  it("preserves false values instead of treating them as missing", () => {
    const settings = normalizeUiSettings({
      hudVisible: false,
      bubbleVisible: false,
      bubbleShadow: false,
      autoRevealOnMcp: false,
      systemNotifications: false
    });
    expect(settings.hudVisible).toBe(false);
    expect(settings.bubbleVisible).toBe(false);
    expect(settings.bubbleShadow).toBe(false);
    expect(settings.autoRevealOnMcp).toBe(false);
    expect(settings.systemNotifications).toBe(false);
  });

  it("clamps bubble hold time", () => {
    expect(normalizeUiSettings({ bubbleHoldMs: 1 }).bubbleHoldMs).toBe(1500);
    expect(normalizeUiSettings({ bubbleHoldMs: 100000 }).bubbleHoldMs).toBe(60000);
  });

  it("rejects unknown enum values", () => {
    const settings = normalizeUiSettings({
      bubbleBackground: "unknown",
      dragMode: "fast"
    });
    expect(settings.bubbleBackground).toBe("solid");
    expect(settings.dragMode).toBe("compatible");
  });

  it("applies partial patches without resetting unrelated settings", () => {
    const current = normalizeUiSettings({
      hudVisible: true,
      bubbleVisible: true,
      bubbleBackground: "light",
      dragMode: "smooth",
      hitboxPadding: 12,
      maxDevicePixelRatio: 2.5,
      updateAutoCheck: false,
      updateChannel: "stable"
    });
    const next = applyUiSettingsPatch(current, { bubbleVisible: false });
    expect(next).toMatchObject({
      hudVisible: true,
      bubbleVisible: false,
      bubbleBackground: "light",
      dragMode: "smooth",
      hitboxPadding: 12,
      maxDevicePixelRatio: 2.5,
      updateAutoCheck: false,
      updateChannel: "stable",
      autoRevealOnMcp: true,
      systemNotifications: true
    });
  });

  it("applies the MCP auto reveal flag", () => {
    const next = applyUiSettingsPatch(DEFAULT_UI_SETTINGS, { autoRevealOnMcp: false });
    expect(next.autoRevealOnMcp).toBe(false);
  });

  it("applies the system notification flag", () => {
    const next = applyUiSettingsPatch(DEFAULT_UI_SETTINGS, { systemNotifications: false });
    expect(next.systemNotifications).toBe(false);
  });

  it("clamps DPI and hitbox settings", () => {
    expect(normalizeUiSettings({ maxDevicePixelRatio: 10 }).maxDevicePixelRatio).toBe(3);
    expect(normalizeUiSettings({ maxDevicePixelRatio: 0 }).maxDevicePixelRatio).toBe(1);
    expect(normalizeUiSettings({ hitboxPadding: 100 }).hitboxPadding).toBe(48);
    expect(normalizeUiSettings({ hitboxPadding: -4 }).hitboxPadding).toBe(0);
  });

  it("applies update settings", () => {
    const next = applyUiSettingsPatch(DEFAULT_UI_SETTINGS, {
      updateAutoCheck: false,
      updateChannel: "prerelease"
    });
    expect(next.updateAutoCheck).toBe(false);
    expect(next.updateChannel).toBe("prerelease");
  });

  it("normalizes the update channel", () => {
    expect(normalizeUiSettings({ updateChannel: "stable" }).updateChannel).toBe("stable");
    expect(normalizeUiSettings({ updateChannel: "nightly" }).updateChannel).toBe("auto");
  });
});
