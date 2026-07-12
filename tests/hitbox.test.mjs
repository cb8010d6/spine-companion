import { describe, expect, it } from "vitest";
import { calculateInteractiveBounds, expandBounds } from "../src/renderer/hitbox.js";

describe("interactive hitbox", () => {
  it("keeps small models clickable without claiming the whole window", () => {
    const bounds = calculateInteractiveBounds({ width: 30, height: 50, modelX: 100, modelY: 180, userScale: 0.35, hitboxPadding: 8 });
    expect(bounds.right - bounds.left).toBeGreaterThanOrEqual(52);
    expect(bounds.bottom - bounds.top).toBeGreaterThanOrEqual(80);
    expect(bounds.left).toBeGreaterThan(60);
  });

  it("tracks most of the visible model instead of a narrow center slice", () => {
    const bounds = calculateInteractiveBounds({ width: 200, height: 400, modelX: 180, modelY: 440, userScale: 1, hitboxPadding: 8 });
    expect(bounds.right - bounds.left).toBeGreaterThan(176);
    expect(bounds.bottom - bounds.top).toBeGreaterThan(368);
  });

  it("expands recovery bounds symmetrically", () => {
    expect(expandBounds({ left: 10, right: 20, top: 30, bottom: 40 }, 18)).toEqual({ left: -8, right: 38, top: 12, bottom: 58 });
  });
});
