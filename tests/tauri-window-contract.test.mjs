import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Tauri companion window contract", () => {
  it("keeps the desktop companion out of the taskbar across startup and recovery", () => {
    const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    const main = config.app.windows.find((window) => !window.label || window.label === "main");
    const source = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

    expect(main?.skipTaskbar).toBe(true);
    expect(source).toMatch(/fn create_main_window[\s\S]*?\.skip_taskbar\(true\)/);
    expect(source).toMatch(/fn show_companion_window[\s\S]*?set_skip_taskbar\(true\)/);
    expect(source).toMatch(/\.setup\([\s\S]*?get_webview_window\("main"\)[\s\S]*?set_skip_taskbar\(true\)/);
  });
});
