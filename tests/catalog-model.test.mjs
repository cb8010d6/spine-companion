import { describe, expect, it } from "vitest";
import { catalogInstallState, filterCatalog, mergeCatalogSources } from "../src/renderer/catalog-model.js";

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
});
