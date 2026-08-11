// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { bindManagerButton } from "../src/renderer/manager-action.js";
import { createOnboarding } from "../src/renderer/onboarding.js";

describe("manager button actions", () => {
  it("shows pending and failure states for any bound manager button", async () => {
    const button = document.createElement("button");
    button.textContent = "Open Manager";
    const status = document.createElement("small");
    bindManagerButton(button, status, async () => {
      throw new Error("Manager window failed");
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(button.textContent).toBe("Opening Manager...");
    await Promise.resolve();
    await Promise.resolve();

    expect(button.textContent).toBe("Unable to open Manager");
    expect(status.textContent).toBe("Manager window failed");
    expect(button.disabled).toBe(false);
  });

  it("uses the same manager feedback in onboarding", async () => {
    const node = createOnboarding({
      onManager: async () => {
        throw new Error("No bridge");
      }
    });
    const managerButton = [...node.querySelectorAll("button")]
      .find((button) => button.textContent === "Open Manager Library");

    managerButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(managerButton.textContent).toBe("Opening Manager...");
    await Promise.resolve();
    await Promise.resolve();

    expect(managerButton.textContent).toBe("Unable to open Manager");
    expect(node.textContent).toContain("No bridge");
  });
});
