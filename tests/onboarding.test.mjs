// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createOnboarding, shouldShowOnboarding } from "../src/renderer/onboarding.js";

describe("onboarding", () => {
  it("shows when no local config or asset dir is present", () => {
    expect(shouldShowOnboarding({ paths: { hasLocalConfig: false }, spine: { assetDirConfigured: false } })).toBe(true);
  });

  it("hides when local config and asset dir are present", () => {
    expect(shouldShowOnboarding({ paths: { hasLocalConfig: true }, spine: { assetDirConfigured: true } })).toBe(false);
  });

  it("offers Manager Library and local import without a direct model download", () => {
    const onManager = vi.fn();
    const onboarding = createOnboarding({ onManager });
    const buttons = [...onboarding.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Open Manager Library",
      "Import your own model"
    ]);
    expect(onboarding.textContent).not.toMatch(/download (?:a )?test model/i);

    buttons[0].click();
    buttons[1].click();
    expect(onManager).toHaveBeenCalledTimes(2);
  });
});
