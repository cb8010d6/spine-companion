import { describe, expect, it } from "vitest";
import { addLayer, issueFieldId, moveLayer, normalizeAvatarManifest, removeLayer, setMotion, updateLayer } from "../src/renderer/avatar-editor-model.js";

describe("Avatar editor model", () => {
  it("normalizes, adds, removes and reorders layers", () => {
    let manifest = normalizeAvatarManifest({ id: "demo", layers: [{ id: "body", file: "layers/body.png" }] });
    manifest = addLayer(manifest, { id: "head", file: "layers/head.png" });
    manifest = moveLayer(manifest, "head", -1);
    expect(manifest.layers.map((layer) => layer.id)).toEqual(["head", "body"]);
    manifest = removeLayer(manifest, "body");
    expect(manifest.layers).toHaveLength(1);
    expect(manifest.layers[0].order).toBe(0);
  });

  it("updates transform and visibility without losing defaults", () => {
    const manifest = updateLayer({ layers: [{ id: "head" }] }, "head", { visible: false, offset: { x: 12 }, scale: { x: 0.8 } });
    expect(manifest.layers[0]).toMatchObject({ visible: false, offset: { x: 12, y: 0 }, scale: { x: 0.8, y: 1 }, anchor: { x: 0.5, y: 0.5 } });
  });

  it("updates motion mappings and creates stable issue anchors", () => {
    let manifest = setMotion({ motions: {} }, "idle", "Relax");
    expect(manifest.motions.idle).toBe("Relax");
    manifest = setMotion(manifest, "idle", "");
    expect(manifest.motions.idle).toBeUndefined();
    expect(issueFieldId("layers[2].file")).toBe("avatar-field-layers-2-file");
  });
});
