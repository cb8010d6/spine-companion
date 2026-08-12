import { describe, expect, it } from "vitest";
import { getPublicConfig } from "../src/backend/config.cjs";

describe("public runtime config", () => {
  it("exposes the same fit mode and presentation defaults as the packaged runtime", () => {
    const config = {
      window: { width: 360, height: 460 },
      spine: {
        assetDir: "",
        skel: "amiya.skel",
        scale: 1.15,
        offsetX: 12,
        offsetY: -30,
        fitMode: "full",
        mixDurationMs: 520,
        boundsSamples: 10,
        framePadding: 1.08,
        maxViewportFill: 0.72,
        stageBottomInset: 154,
        fitStates: ["idle"]
      },
      ui: {},
      models: {},
      paths: {},
      state: {},
      specialSegments: {}
    };

    const publicConfig = getPublicConfig(config, "http://127.0.0.1:17388");

    expect(publicConfig.spine.fitMode).toBe("full");
    expect(publicConfig.spine.presentationDefaults).toEqual({
      scale: 1.15,
      offsetX: 12,
      offsetY: -30,
      fitMode: "full"
    });
  });

  it("defaults an older JS config to the legacy fit mode", () => {
    const publicConfig = getPublicConfig({
      window: {},
      spine: { skel: "amiya.skel", scale: 0.86, offsetX: 0, offsetY: -18 },
      ui: {},
      models: {},
      paths: {},
      state: {},
      specialSegments: {}
    }, "http://127.0.0.1:17388");

    expect(publicConfig.spine.fitMode).toBe("legacy");
    expect(publicConfig.spine.presentationDefaults.fitMode).toBe("legacy");
  });
});
