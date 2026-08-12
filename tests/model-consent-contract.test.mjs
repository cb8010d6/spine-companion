import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("catalog acknowledgement IPC contract", () => {
  it("passes explicit acknowledgement for install and preview commands", () => {
    const bridge = readFileSync(resolve(process.cwd(), "src/renderer/tauri-bridge.js"), "utf8");
    const manager = readFileSync(resolve(process.cwd(), "src/renderer/manager.js"), "utf8");
    expect(bridge).toMatch(/installCatalogModel:[\s\S]*acknowledgement/);
    expect(bridge).toMatch(/prepareModelPreview:[\s\S]*acknowledgement/);
    expect(manager).toContain("installer(catalogEntry.catalogSourceId || catalogEntry.sourceId, id, acknowledgement)");
    expect(manager).toContain("prepareModelPreview(sourceId, model.id, acknowledgementRequired && acknowledgement)");
  });

  it("pins official catalogs to the released rc.10 snapshot", () => {
    const config = readFileSync(resolve(process.cwd(), "src-tauri/src/config.rs"), "utf8");
    const defaults = config.slice(config.indexOf("fn fallback_config"), config.indexOf("fn merge_json"));
    expect(defaults).toContain("/v0.2.6-rc.10/catalog/catalog.json");
    expect(defaults).toContain("/v0.2.6-rc.10/catalog/illustrations.json");
    expect(defaults).toContain("/v0.2.6-rc.10/catalog/enemies.json");
    expect(defaults).not.toContain("/v0.2.6-rc.7.1/catalog/");
    expect(defaults).not.toContain("/main/catalog/");
  });

  it("checks acknowledgement before install staging or preview cache work", () => {
    const backend = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const install = backend.slice(backend.indexOf("async fn import_catalog_model"), backend.indexOf("async fn prepare_model_preview"));
    const preview = backend.slice(backend.indexOf("async fn prepare_model_preview"), backend.indexOf("fn github_raw_to_jsdelivr_url"));

    expect(install.indexOf("require_acknowledgement")).toBeGreaterThan(0);
    expect(install.indexOf("require_acknowledgement")).toBeLessThan(install.indexOf("install_model_value"));
    expect(preview.indexOf("require_acknowledgement")).toBeGreaterThan(0);
    expect(preview.indexOf("require_acknowledgement")).toBeLessThan(preview.indexOf("preview_root"));
    expect(preview.indexOf("require_acknowledgement")).toBeLessThan(preview.indexOf("reqwest::Client::builder"));
  });
});
