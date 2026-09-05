import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local model import IPC contract", () => {
  it("uses an explicit skeleton picker and does not invoke IPC on cancellation", () => {
    const bridge = readFileSync(resolve(process.cwd(), "src/renderer/tauri-bridge.js"), "utf8");
    expect(bridge).toMatch(/importLocalModel:\s*async\s*\(\)/);
    expect(bridge).toMatch(/filters:\s*\[\{\s*name:\s*["']Spine skeleton["'],\s*extensions:\s*\["skel"\]/);
    expect(bridge).toMatch(/if \(!selected \|\| Array\.isArray\(selected\)\) return \{ canceled: true \};[\s\S]*_tauriInvoke\("import_local_model"/);
  });

  it("registers the native command and keeps local metadata version-free", () => {
    const backend = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    expect(backend).toContain("async fn import_local_model(");
    expect(backend).toContain("import_local_model,");
    const command = backend.slice(backend.indexOf("async fn import_local_model("), backend.indexOf("async fn install_model_value("));
    expect(command).toContain("validate_spine_asset_dir");
    expect(command).toContain("replace_directory_atomically");
    expect(command).not.toContain("spineVersion");
  });
});
