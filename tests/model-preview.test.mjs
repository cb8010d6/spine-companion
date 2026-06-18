import { describe, expect, it } from "vitest";
import { modelPreview } from "../src/renderer/model-preview.js";

const amiyaModel = {
  id: "ark-1001-amiya2-sale-16",
  name: "Amiya Guard Skin #16",
  skel: "build_char_1001_amiya2_sale#16.skel",
  files: [
    {
      name: "build_char_1001_amiya2_sale#16.png",
      url: "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/1001_amiya2_sale%2316/build_char_1001_amiya2_sale%2316.png"
    }
  ]
};

describe("modelPreview", () => {
  it("uses the local Spine asset path for the active model preview", () => {
    const preview = modelPreview(amiyaModel, {
      server: { origin: "http://127.0.0.1:17388" },
      spine: {
        skel: "build_char_1001_amiya2_sale#16.skel",
        assetDir: "C:/example/spine-companion/models/ark-1001-amiya2-sale-16"
      }
    });

    expect(preview.imageUrl).toBe("");
    expect(preview.canRenderSpinePreview).toBe(true);
    expect(preview.spinePreviewUrl).toBe("http://127.0.0.1:17388/assets/spine/build_char_1001_amiya2_sale%2316.skel");
  });

  it("does not use catalog atlas textures as inactive model previews", () => {
    const preview = modelPreview(amiyaModel, {
      server: { origin: "http://127.0.0.1:17388" },
      spine: { skel: "other.skel", assetDir: "" }
    });

    expect(preview.imageUrl).toBe("");
    expect(preview.canRenderSpinePreview).toBe(false);
    expect(preview.initials).toBe("AG");
  });

  it("still uses explicit preview images when the catalog provides one", () => {
    const preview = modelPreview({
      ...amiyaModel,
      previewUrl: "https://example.test/preview.png"
    }, {});

    expect(preview.imageUrl).toBe("https://example.test/preview.png");
  });
});
