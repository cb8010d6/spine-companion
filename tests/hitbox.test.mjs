import { describe, expect, it } from "vitest";
import {
  calculateInteractiveBounds,
  compactPointerRegions,
  expandBounds,
  normalizePointerRegions,
  transformLocalBounds,
  unionPointerRegions
} from "../src/renderer/hitbox.js";

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

  it("normalizes legacy and multi-region pointer payloads", () => {
    const region = { left: 10, right: 30, top: 20, bottom: 60 };
    expect(normalizePointerRegions(region)).toEqual([region]);
    expect(normalizePointerRegions([
      region,
      { left: 40, right: 70, top: 25, bottom: 80 },
      { left: 5, right: 5, top: 0, bottom: 10 }
    ])).toHaveLength(2);
    expect(normalizePointerRegions(Array.from({ length: 20 }, (_, index) => ({
      left: index,
      right: index + 1,
      top: 0,
      bottom: 1
    })))).toHaveLength(16);
  });

  it("keeps separated visible attachments as distinct pointer regions", () => {
    const regions = compactPointerRegions([
      { left: 10, right: 50, top: 20, bottom: 100 },
      { left: 48, right: 80, top: 35, bottom: 85 },
      { left: 130, right: 150, top: 30, bottom: 55 }
    ], { padding: 0, mergeGap: 2 });
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({ left: 10, right: 80, top: 20, bottom: 100 });
    expect(regions[1]).toEqual({ left: 130, right: 150, top: 30, bottom: 55 });
  });

  it("caps slot regions and computes a recovery union", () => {
    const regions = compactPointerRegions(Array.from({ length: 20 }, (_, index) => ({
      left: index * 20,
      right: index * 20 + 8,
      top: 0,
      bottom: 8
    })), { padding: 0, mergeGap: 0 });
    expect(regions).toHaveLength(16);
    expect(unionPointerRegions(regions)).toEqual({ left: 0, right: 308, top: 0, bottom: 8 });
  });
});
