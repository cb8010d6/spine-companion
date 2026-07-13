import { describe, expect, it } from "vitest";
import { pinchScaleDelta, pointerDistance, shouldUseNativeWindowDrag } from "../src/renderer/input-gesture.js";

describe("input gestures", () => {
  it("measures two-pointer distance for pinch gestures", () => {
    expect(pointerDistance([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
    expect(pointerDistance([{ x: 0, y: 0 }])).toBe(0);
  });

  it("converts pinch distance into a bounded scale delta", () => {
    expect(pinchScaleDelta(100, 124)).toBeCloseTo(0.1);
    expect(pinchScaleDelta(100, 1000)).toBe(0.12);
    expect(pinchScaleDelta(100, 0)).toBe(-0.12);
  });

  it("uses native window dragging only for mouse input", () => {
    expect(shouldUseNativeWindowDrag("mouse")).toBe(true);
    expect(shouldUseNativeWindowDrag("touch")).toBe(false);
    expect(shouldUseNativeWindowDrag("pen")).toBe(false);
  });
});
