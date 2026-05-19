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
  it("uses the local asset server for the active model preview", () => {
    const preview = modelPreview(amiyaModel, {
      server: { origin: "http://127.0.0.1:17388" },
      spine: {
        skel: "build_char_1001_amiya2_sale#16.skel",
        assetDir: "C:/Users/INDEX/AppData/Roaming/spine-companion/models/ark-1001-amiya2-sale-16"
      }
    });

    expect(preview.imageUrl).toBe("http://127.0.0.1:17388/assets/spine/build_char_1001_amiya2_sale%2316.png");
  });

  it("falls back to catalog-hosted preview images for inactive models", () => {
    const preview = modelPreview(amiyaModel, {
      server: { origin: "http://127.0.0.1:17388" },
      spine: { skel: "other.skel", assetDir: "" }
    });

    expect(preview.imageUrl).toContain("raw.githubusercontent.com");
    expect(preview.initials).toBe("AG");
  });
});
