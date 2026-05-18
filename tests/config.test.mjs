import { describe, expect, it } from "vitest";

const { mergeDeep, localConfigCandidates, userConfigDir } = require("../src/main/config.cjs");

describe("config helpers", () => {
  it("deep merges nested objects without replacing sibling keys", () => {
    const merged = mergeDeep(
      {
        window: { width: 320, height: 420 },
        spine: { scale: 1, offsetX: 0 }
      },
      {
        window: { width: 480 },
        spine: { offsetX: 12 }
      }
    );

    expect(merged.window).toEqual({ width: 480, height: 420 });
    expect(merged.spine).toEqual({ scale: 1, offsetX: 12 });
  });

  it("does not duplicate local config candidates", () => {
    const candidates = localConfigCandidates();
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates.some((file) => file.endsWith("companion.local.json"))).toBe(true);
  });

  it("returns a stable user config directory", () => {
    expect(userConfigDir()).toContain("spine-companion");
  });
});
