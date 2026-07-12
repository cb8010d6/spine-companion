import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Tauri tray interaction contract", () => {
  it("reserves the left click for the Quick Panel", () => {
    const source = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
    expect(source).toContain('.show_menu_on_left_click(false)');
    expect(source).toMatch(/TrayIconEvent::DoubleClick[\s\S]*?open_manager_from_tray\(app\)/);
    expect(source).toMatch(/MouseButton::Right[\s\S]*?hide_panel_window_inner\(app\)/);
  });
});
