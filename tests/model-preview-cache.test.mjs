import { describe, expect, it } from "vitest";
import {
  modelPreviewSignature,
  readCachedModelPreview,
  writeCachedModelPreview
} from "../src/renderer/model-preview-cache.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  };
}

describe("model preview cache", () => {
  const model = {
    id: "amiya",
    skel: "amiya.skel",
    files: [{ name: "amiya.skel", sha256: "abc" }]
  };

  it("persists previews only while the model signature matches", () => {
    const storage = memoryStorage();
    writeCachedModelPreview(model, "data:image/png;base64,preview", storage);
    expect(readCachedModelPreview(model, storage)).toBe("data:image/png;base64,preview");
    expect(readCachedModelPreview({ ...model, files: [{ name: "amiya.skel", sha256: "changed" }] }, storage)).toBe("");
  });

  it("derives stable signatures from sorted file metadata", () => {
    expect(modelPreviewSignature({ ...model, files: [...model.files].reverse() })).toBe(modelPreviewSignature(model));
  });
});
