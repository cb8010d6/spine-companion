// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANAGER_FRAME_RATE_MODES,
  MANAGER_PRIMARY_VIEWS,
  LIBRARY_TABS,
  catalogSourcesForSelection,
  managerInitialView,
  mergeRemoteCatalogs,
  resolveLibraryCatalogSource,
  resolveManagerNavigation
} from "../src/renderer/manager.js";

const sources = [
  { id: "operators", enabled: true },
  { id: "disabled", enabled: false },
  { id: "enemies", enabled: true }
];

describe("manager all-enabled-sources library view", () => {
  it("keeps the primary navigation focused while retaining library sections", () => {
    const managerHtml = readFileSync(resolve(process.cwd(), "manager.html"), "utf8");
    expect(MANAGER_PRIMARY_VIEWS).toEqual(["dashboard", "library", "integrations", "settings", "diagnostics"]);
    expect(LIBRARY_TABS).toEqual(["catalog", "installed", "downloads"]);
    for (const view of MANAGER_PRIMARY_VIEWS) expect(managerHtml).toContain(`data-view="${view}"`);
    expect(managerHtml).not.toContain('data-view="installed"');
    expect(managerHtml).not.toContain('data-view="downloads"');
    expect(managerHtml).not.toContain('data-view="avatar"');
  });

  it("redirects legacy installed and download routes into Library tabs", () => {
    expect(resolveManagerNavigation("installed")).toEqual({ view: "library", libraryTab: "installed" });
    expect(resolveManagerNavigation("downloads")).toEqual({ view: "library", libraryTab: "downloads" });
    expect(resolveManagerNavigation("library")).toEqual({ view: "library", libraryTab: null });
    expect(resolveManagerNavigation("avatar")).toEqual({ view: "avatar", libraryTab: null });
  });

  it("keeps hidden status badges out of the compact card layout", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/renderer/manager.css"), "utf8");
    expect(styles).toMatch(/\.badge\[hidden\][^{]*\{\s*display:\s*none/);
    expect(styles).toMatch(/\.library-grid\s*\{[\s\S]*?minmax\(300px, 1fr\)/);
    expect(styles).toMatch(/\.installed-grid\s*\{[\s\S]*?minmax\(280px, 1fr\)/);
  });

  it("exposes only the supported fixed frame-rate modes", () => {
    expect(MANAGER_FRAME_RATE_MODES).toEqual(["display", "60", "30"]);
  });

  it("opens Library first when no model is active", () => {
    expect(managerInitialView({ spine: {} })).toBe("library");
    expect(managerInitialView({ spine: { modelId: "local-model", assetDir: "C:/models/local-model", skel: "model.skel" } })).toBe("dashboard");
  });

  it("preserves the aggregate selection while excluding disabled sources", () => {
    expect(resolveLibraryCatalogSource(sources, "all")).toBe("all");
    expect(catalogSourcesForSelection("all", sources).map((source) => source.id)).toEqual(["operators", "enemies"]);
  });

  it("preserves source-specific selection and falls back when it is disabled", () => {
    expect(resolveLibraryCatalogSource(sources, "enemies")).toBe("enemies");
    expect(resolveLibraryCatalogSource(sources, "disabled")).toBe("operators");
  });

  it("merges cached source results without duplicating model ids", () => {
    const merged = mergeRemoteCatalogs([
      { models: [{ catalogSourceId: "operators", id: "shared" }], sources: [{ sourceId: "operators" }] },
      { models: [{ catalogSourceId: "enemies", id: "shared" }, { catalogSourceId: "enemies", id: "enemy" }], sources: [{ sourceId: "enemies" }] }
    ]);

    expect(merged.models.map((model) => model.id)).toEqual(["shared", "enemy"]);
    expect(merged.sources.map((source) => source.sourceId)).toEqual(["operators", "enemies"]);
  });
});
