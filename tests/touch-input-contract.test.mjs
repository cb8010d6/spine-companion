import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const mainSource = readFileSync(new URL("../src/renderer/main.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const nativeSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

describe("touch input contract", () => {
  it("handles touch scaling and cancelled pointers", () => {
    expect(mainSource).toMatch(/pointerType === "touch"/);
    expect(mainSource).toMatch(/pinchScaleDelta/);
    expect(mainSource).toMatch(/addEventListener\("pointercancel"/);
    expect(styles).toMatch(/touch-action:\s*none/);
  });

  it("does not strand non-Windows users in global cursor passthrough", () => {
    expect(nativeSource).toMatch(/cfg\(not\(target_os = "windows"\)\)[\s\S]*?set_ignore_cursor_events\(false\)/);
  });
});
