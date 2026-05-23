// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createErrorCard } from "../src/renderer/error-boundary.js";

describe("createErrorCard", () => {
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
