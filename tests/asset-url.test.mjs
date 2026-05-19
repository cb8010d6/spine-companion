import { describe, expect, it } from "vitest";
import { encodeSpineAssetUrl, spineAssetUrl } from "../src/shared/asset-url.js";

describe("asset-url", () => {
  it("encodes hash characters in explicit Spine asset URLs", () => {
    expect(encodeSpineAssetUrl("http://127.0.0.1/assets/spine/build_char#16.skel"))
      .toBe("http://127.0.0.1/assets/spine/build_char%2316.skel");
  });

  it("builds an encoded Spine asset URL from config when assetUrl is absent", () => {
    expect(spineAssetUrl({
      server: { origin: "http://127.0.0.1:17388" },
      spine: { skel: "build_char_1001_amiya2_sale#16.skel" }
    })).toBe("http://127.0.0.1:17388/assets/spine/build_char_1001_amiya2_sale%2316.skel");
  });
});
