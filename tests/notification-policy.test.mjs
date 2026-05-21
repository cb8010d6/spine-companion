import { describe, expect, it } from "vitest";

const {
  defaultMessageForState,
  isAiSource,
  notificationForState,
  shouldNotifyState,
  sourceDisplayName
} = require("../src/shared/notification-policy.cjs");

describe("notification policy", () => {
  it("recognizes supported AI task sources", () => {
    expect(isAiSource("codex-mcp")).toBe(true);
    expect(isAiSource("claude-code")).toBe(true);
    expect(isAiSource("cursor-mcp")).toBe(true);
    expect(isAiSource("gemini")).toBe(true);
    expect(isAiSource("tray")).toBe(false);
    expect(sourceDisplayName("claude-code")).toBe("Claude");
  });

  it("only notifies completion for AI sources or explicit notify", () => {
    expect(shouldNotifyState({ state: "success", source: "hud" })).toBe(false);
    expect(shouldNotifyState({ state: "failed", source: "tray" })).toBe(false);
    expect(shouldNotifyState({ state: "success", source: "codex-mcp" })).toBe(true);
    expect(shouldNotifyState({ state: "failed", source: "local", notify: true })).toBe(true);
    expect(shouldNotifyState({ state: "reminder", source: "reminder" })).toBe(true);
  });

  it("creates default bubble and notification copy for AI states", () => {
    expect(defaultMessageForState("running", "cursor-mcp")).toBe("Running checks");
    expect(defaultMessageForState("running", "hud")).toBe("");
    expect(notificationForState({ state: "success", source: "codex-mcp" })).toMatchObject({
      title: "Codex task complete",
      body: "Finished successfully"
    });
  });
});
