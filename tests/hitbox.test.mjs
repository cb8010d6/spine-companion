import { describe, expect, it } from "vitest";
import { calculateInteractiveBounds, expandBounds, transformLocalBounds } from "../src/renderer/hitbox.js";

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

  it("uses exact off-center bounds when provided", () => {
    const bounds = calculateInteractiveBounds({ width: 120, height: 200, left: 210, top: 40, hitboxPadding: 4 });
    expect(bounds.left).toBe(206);
    expect(bounds.right).toBe(334);
    expect(bounds.top).toBe(36);
    expect(bounds.bottom).toBe(244);
  });

  it("transforms mirrored runtime bounds into window coordinates", () => {
    expect(transformLocalBounds(
      { x: 10, y: -80, width: 60, height: 100 },
      { x: 200, y: 300, childX: -40, childY: -20, scaleX: -2, scaleY: 2 }
    )).toEqual({ left: 140, right: 260, top: 100, bottom: 300, width: 120, height: 200 });
  });

  it("expands recovery bounds symmetrically", () => {
    expect(expandBounds({ left: 10, right: 20, top: 30, bottom: 40 }, 18)).toEqual({ left: -8, right: 38, top: 12, bottom: 58 });
  });
});
