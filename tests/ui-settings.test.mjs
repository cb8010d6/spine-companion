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
      bubbleShadow: false
    });
    expect(settings.hudVisible).toBe(false);
    expect(settings.bubbleVisible).toBe(false);
    expect(settings.bubbleShadow).toBe(false);
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
      dragMode: "smooth"
    });
    const next = applyUiSettingsPatch(current, { bubbleVisible: false });
    expect(next).toMatchObject({
      hudVisible: true,
      bubbleVisible: false,
      bubbleBackground: "light",
      dragMode: "smooth"
    });
  });
});
