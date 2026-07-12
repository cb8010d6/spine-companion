import { describe, expect, it } from "vitest";
import { normalizedCrop } from "../src/renderer/avatar-editor-view.js";

describe("Avatar editor crop preview", () => {
  it("uses the complete image when crop is not enabled", () => {
    expect(normalizedCrop(null, 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });

  it("clips the crop rectangle to the image instead of mirroring offsets", () => {
    expect(normalizedCrop({ x: 600, y: 450, width: 100, height: 100 }, 640, 480))
      .toEqual({ x: 600, y: 450, width: 40, height: 30 });
  });
});
