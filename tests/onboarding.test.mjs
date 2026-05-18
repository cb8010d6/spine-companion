import { describe, expect, it } from "vitest";
import { shouldShowOnboarding } from "../src/renderer/onboarding.js";

describe("onboarding", () => {
  it("shows when no local config or asset dir is present", () => {
    expect(shouldShowOnboarding({ paths: { hasLocalConfig: false }, spine: { assetDirConfigured: false } })).toBe(true);
  });

  it("hides when local config and asset dir are present", () => {
    expect(shouldShowOnboarding({ paths: { hasLocalConfig: true }, spine: { assetDirConfigured: true } })).toBe(false);
  });
});
