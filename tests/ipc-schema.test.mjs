import { describe, expect, it } from "vitest";

const {
  validateImportModel,
  validateOpenFolderPath,
  validateReminder,
  validateSaveSettings,
  validateSetState
} = require("../src/main/ipc-schema.cjs");

describe("IPC schema validation", () => {
  it("accepts expected state and settings payloads", () => {
    expect(validateSetState({ state: "success", notify: true, source: "codex-mcp" })).toMatchObject({
      state: "success",
      notify: true
    });
    expect(validateSaveSettings({ spine: { scale: 1.2 }, ui: { bubbleVisible: false } })).toMatchObject({
      spine: { scale: 1.2 }
    });
    expect(validateSaveSettings({
      ui: {
        shortcutEnabled: false,
        shortcutAccelerator: "Alt+Shift+S",
        updateAutoCheck: false,
        maxDevicePixelRatio: 3,
        hitboxPadding: 12
      }
    }).ui).toMatchObject({ shortcutAccelerator: "Alt+Shift+S" });
    expect(validateReminder({ text: "Stand up", inSeconds: 30 })).toMatchObject({ text: "Stand up" });
  });

  it("rejects invalid model imports and settings roots", () => {
    expect(() => validateImportModel({ id: "../bad" })).toThrow(/Invalid model import payload/);
    expect(() => validateSaveSettings({ unexpectedRoot: true })).toThrow(/Invalid settings patch/);
    expect(() => validateSaveSettings({ ui: { maxDevicePixelRatio: 9 } })).toThrow(/Invalid settings patch/);
    expect(() => validateSaveSettings({ ui: { dragMode: "fast" } })).toThrow(/Invalid settings patch/);
    expect(() => validateOpenFolderPath("")).toThrow(/Invalid folder path/);
  });
});
