// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { createErrorCard, friendlyError } from "../src/renderer/error-boundary.js";
import { setLocale } from "../src/shared/i18n.js";

describe("createErrorCard", () => {
  afterEach(() => setLocale("en"));

  it("localizes the clean-install model guidance", () => {
    setLocale("zh-CN");
    expect(friendlyError(new Error("Missing Spine asset"), { spine: { assetDirConfigured: false } }))
      .toBe("尚未配置模型。请打开管理器下载或启用一个模型。");
  });

  it("shows pending and failure states for the manager button", async () => {
    const card = createErrorCard({
      error: new Error("No model"),
      onManager: async () => {
        throw new Error("Window failed");
      }
    });

    const managerButton = [...card.querySelectorAll("button")]
      .find((button) => button.textContent === "Open Manager");
    const click = new MouseEvent("click", { bubbles: true });
    managerButton.dispatchEvent(click);

    expect(managerButton.textContent).toBe("Opening Manager...");
    await Promise.resolve();
    await Promise.resolve();

    expect(managerButton.textContent).toBe("Unable to open Manager");
    expect(card.textContent).toContain("Window failed");
    expect(managerButton.disabled).toBe(false);
  });
});
