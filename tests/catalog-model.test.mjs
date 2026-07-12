import { describe, expect, it } from "vitest";
import { catalogDisplayName, catalogDownloadRequest, catalogInstallState, filterCatalog, mergeCatalogSources, mergeInstalledModelMetadata, normalizeCatalogEntries } from "../src/renderer/catalog-model.js";

describe("catalog model", () => {
  it("keeps healthy sources usable when another source fails", () => {
    const merged = mergeCatalogSources([
      { id: "one", models: [{ id: "amiya", name: "Amiya", compatible: true }] },
      { id: "two", error: "offline", models: [] }
    ]);
    expect(merged.models).toHaveLength(1);
    expect(merged.sources.find((source) => source.id === "two")?.status).toBe("error");
  });

  it("filters by source, search and compatibility", () => {
    const models = [
      { id: "a", name: "Amiya", author: "Ark", sourceId: "ark", compatible: true },
      { id: "b", name: "Future", sourceId: "other", compatible: false }
    ];
    expect(filterCatalog(models, { query: "ami", source: "ark" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterCatalog(models).map((item) => item.id)).toEqual(["a"]);
  });

  it("detects installed updates", () => {
    expect(catalogInstallState({ id: "a", version: "2" }, new Map([["a", { version: "1" }]]))).toBe("update");
  });

  it("normalizes flattened Tauri catalog entries without losing model metadata", () => {
    const [model] = normalizeCatalogEntries([{
      catalogSourceId: "ark-models",
      id: "ark-models-002-amiya",
      name: "Amiya",
      source: "Ark-Models",
      spine: { min: "3.8.99", max: "3.8.99" },
      files: [{ name: "amiya.skel" }]
    }]);

    expect(model).toMatchObject({
      id: "ark-models-002-amiya",
      name: "Amiya",
      source: "Ark-Models",
      sourceId: "ark-models",
      spineVersion: "3.8.99"
    });
    expect(model._catalogEntry.catalogSourceId).toBe("ark-models");
    expect(catalogDownloadRequest(model)).toEqual({
      id: "ark-models-002-amiya",
      catalogEntry: model._catalogEntry
    });
  });

  it("keeps catalog names for legacy installs that only report their directory id", () => {
    expect(mergeInstalledModelMetadata(
      { id: "amiya", name: "Amiya Guard Skin #16", source: "Ark-Models", skel: "amiya.skel" },
      { id: "amiya", name: "amiya", source: "Local", dir: "C:/models/amiya" }
    )).toMatchObject({
      id: "amiya",
      name: "Amiya Guard Skin #16",
      source: "Ark-Models",
      skel: "amiya.skel"
    });
  });

  it("always provides a readable catalog display name", () => {
    expect(catalogDisplayName({ id: "ark-models-002-amiya", name: "Amiya" })).toBe("Amiya");
    expect(catalogDisplayName({ id: "ark-models-1001-amiya2-sale-16" })).toBe("Amiya2 Sale #16");
  });
});
