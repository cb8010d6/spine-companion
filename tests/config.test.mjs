import { describe, expect, it } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { mergeDeep, localConfigCandidates, canonicalConfigPath, userConfigDir, readJsonIfExists } = require("../src/backend/config.cjs");

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
    expect(candidates.at(-1)).toBe(canonicalConfigPath());
  });

  it("returns a stable user config directory", () => {
    expect(userConfigDir()).toContain("spine-companion");
  });

  it("ignores invalid JSON and records a warning", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-config-"));
    const file = path.join(dir, "companion.local.json");
    const warnings = [];
    fs.writeFileSync(file, "{ bad json");
    try {
      expect(readJsonIfExists(file, warnings)).toEqual({});
      expect(warnings).toHaveLength(1);
      expect(warnings[0].file).toBe(file);
      expect(warnings[0].type).toBe("json-parse");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
