import { describe, expect, it } from "vitest";

const { trayMenuModel } = require("../src/shared/tray-menu-model.cjs");

describe("tray-menu-model", () => {
  it("keeps native tray menu useful instead of only manager and quit", () => {
    const menu = trayMenuModel({ bubbleVisible: true, hudVisible: false }, { mousePassthrough: true });
    const labels = menu.filter((item) => item.label).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Show Companion",
      "Hide Companion",
      "Open Quick Panel",
      "Open Manager",
      "Progress Bubble: On",
      "Debug HUD: Off",
      "Click-through: On",
      "Set State",
      "Diagnostics",
      "Quit"
    ]));
  });

  it("exposes expected state shortcuts", () => {
    const stateMenu = trayMenuModel().find((item) => item.id === "state_menu");
    expect(stateMenu.submenu.map((item) => item.state)).toEqual(expect.arrayContaining([
      "idle",
      "working",
      "running",
      "success",
      "failed",
      "waiting",
      "sleeping",
      "reminder"
    ]));
  });
});
