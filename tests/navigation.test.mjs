import { describe, expect, it } from "vitest";
import { createNavigationGuard } from "../src/renderer/navigation.js";

describe("Manager navigation guard", () => {
  it("rejects a slow view after the user navigates elsewhere", () => {
    const guard = createNavigationGuard();
    const library = guard.begin("library");
    const settings = guard.begin("settings");
    expect(guard.isCurrent(library, "settings")).toBe(false);
    expect(guard.isCurrent(settings, "settings")).toBe(true);
  });
});
