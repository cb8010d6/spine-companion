import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { atlasTextureRefs, validateSpineAssetDir, validateSpineAssetSelection } = require("../src/shared/spine-assets.cjs");

function tempAssetDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "spine-asset-test-"));
}

describe("spine asset validation", () => {
  it("accepts a skel folder with atlas and png files", () => {
    const dir = tempAssetDir();
    try {
      fs.writeFileSync(path.join(dir, "model.skel"), "skel");
      fs.writeFileSync(path.join(dir, "model.atlas"), "model.png");
      fs.writeFileSync(path.join(dir, "model.png"), "");
      expect(validateSpineAssetSelection(path.join(dir, "model.skel"))).toMatchObject({
        assetDir: dir,
        skel: "model.skel"
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing atlas or texture files before saving config", () => {
    const dir = tempAssetDir();
    try {
      fs.writeFileSync(path.join(dir, "model.skel"), "skel");
      expect(() => validateSpineAssetDir(dir, "model.skel")).toThrow(/atlas file and one .png/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts top-level atlas texture references", () => {
    expect(atlasTextureRefs("model.png\nsize: 1,1\nslot\n  rotate: true\nother.webp")).toEqual([
      "model.png",
      "other.webp"
    ]);
  });

  it("rejects missing textures referenced by atlas files", () => {
    const dir = tempAssetDir();
    try {
      fs.writeFileSync(path.join(dir, "model.skel"), "skel");
      fs.writeFileSync(path.join(dir, "model.atlas"), "missing.png\nsize: 1,1\n");
      fs.writeFileSync(path.join(dir, "unreferenced.png"), "");
      expect(() => validateSpineAssetDir(dir, "model.skel")).toThrow(/Missing atlas texture/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
