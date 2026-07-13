import { describe, expect, it } from "vitest";
import {
  LIBRARY_PAGE_SIZE,
  LIBRARY_PREVIEW_BATCH_SIZE,
  beginDownloadRecord,
  canRemoveCatalogSource,
  catalogDisplayName,
  catalogDownloadRequest,
  catalogInstallState,
  catalogModelSizeBytes,
  catalogModelSourceId,
  catalogSpineDisplayVersion,
  enabledCatalogSources,
  filterCatalog,
  mergeCatalogSources,
  mergeInstalledModelMetadata,
  normalizeCatalogEntries,
  resolveCatalogSourceId,
  retryCatalogEntry,
  selectPreviewBatch,
  upsertInstalledModel
} from "../src/renderer/catalog-model.js";

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
    expect(model.versionVerified).toBe(true);
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

  it("resolves enabled sources before a catalog refresh", () => {
    const sources = [
      { id: "operators", enabled: false },
      { id: "enemies", enabled: true }
    ];
    expect(enabledCatalogSources(sources).map((source) => source.id)).toEqual(["enemies"]);
    expect(resolveCatalogSourceId(sources, "operators")).toBe("enemies");
    expect(resolveCatalogSourceId([{ id: "operators", enabled: false }], "operators")).toBe("");
  });

  it("keeps installed catalog metadata attached to its original source", () => {
    expect(catalogModelSourceId({ catalogSourceId: "ark-enemies" })).toBe("ark-enemies");
    expect(catalogModelSourceId({})).toBe("ark-models");
  });

  it("reports remote size and limits bulk preview work", () => {
    const model = { files: [{ sizeBytes: 1024 }, { sizeBytes: 2048 }, { sizeBytes: -1 }] };
    expect(catalogModelSizeBytes(model)).toBe(3072);
    expect(LIBRARY_PAGE_SIZE).toBe(12);
    expect(LIBRARY_PREVIEW_BATCH_SIZE).toBe(6);
    expect(selectPreviewBatch(Array.from({ length: 12 }, (_, id) => ({ id })))).toHaveLength(6);
  });

  it("does not present an unverified patch floor as an exact Spine version", () => {
    expect(catalogSpineDisplayVersion({
      spine: { min: "3.8.0", max: "3.8.99" },
      versionVerified: false
    })).toBe("3.8");
    expect(catalogSpineDisplayVersion({
      spine: { min: "3.8.84", max: "3.8.84" },
      versionVerified: true
    })).toBe("3.8.84");
    expect(catalogSpineDisplayVersion({ spineVersion: "Spine 3.8" })).toBe("3.8");
  });

  it("immediately merges a completed install into the local library state", () => {
    expect(upsertInstalledModel(
      [{ id: "local", name: "Local" }],
      { id: "amiya", name: "amiya", dir: "C:/models/amiya", activated: false },
      { id: "amiya", name: "Amiya", source: "Ark-Models", skel: "amiya.skel" }
    )).toEqual([
      { id: "local", name: "Local" },
      expect.objectContaining({ id: "amiya", name: "Amiya", source: "Ark-Models", dir: "C:/models/amiya" })
    ]);
  });

  it("keeps official sources disable-only", () => {
    expect(canRemoveCatalogSource({ kind: "official" })).toBe(false);
    expect(canRemoveCatalogSource({ kind: "customRaw" })).toBe(true);
  });

  it("keeps the remote catalog entry available for a failed download retry", () => {
    const entry = { catalogSourceId: "ark-enemies", model: { id: "enemy" } };
    const record = beginDownloadRecord(entry, "Preparing download...");
    const failed = { ...record, status: "failed", error: "offline" };
    expect(retryCatalogEntry(failed)).toBe(entry);
  });
});
