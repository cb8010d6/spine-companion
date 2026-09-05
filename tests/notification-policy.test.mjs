import { describe, expect, it } from "vitest";

const {
  defaultMessageForState,
  isAiSource,
  notificationForState,
  shouldNotifyState,
  sourceDisplayName
} = require("../src/shared/notification-policy.cjs");

const esmPolicy = await import("../src/shared/notification-policy.js");

describe("notification policy", () => {
  it("recognizes supported AI task sources", () => {
    expect(isAiSource("codex-mcp")).toBe(true);
    expect(isAiSource("claude-code")).toBe(true);
    expect(isAiSource("cursor-mcp")).toBe(true);
    expect(isAiSource("gemini")).toBe(true);
    expect(isAiSource("mimocode-mcp")).toBe(true);
    expect(isAiSource("opencode-mcp")).toBe(true);
    expect(isAiSource("my-new-agent-mcp")).toBe(true);
    expect(isAiSource("tray")).toBe(false);
    expect(sourceDisplayName("claude-code")).toBe("Claude");
    expect(sourceDisplayName("mimocode-mcp")).toBe("MiMoCode");
  });

  it("only notifies completion for AI sources or explicit notify", () => {
    expect(shouldNotifyState({ state: "success", source: "hud" })).toBe(false);
    expect(shouldNotifyState({ state: "failed", source: "tray" })).toBe(false);
    expect(shouldNotifyState({ state: "success", source: "codex-mcp" })).toBe(true);
    expect(shouldNotifyState({ state: "success", source: "mimocode-mcp" })).toBe(true);
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

  it("honors explicit suppression for restored states and demonstration events", () => {
    for (const policy of [{ shouldNotifyState }, esmPolicy]) {
      expect(policy.shouldNotifyState({ state: "success", source: "codex-mcp", notify: false })).toBe(false);
      expect(policy.shouldNotifyState({ state: "reminder", notify: false })).toBe(false);
      expect(policy.shouldNotifyState({ state: "success", source: "codex-mcp", eventKind: "demo" })).toBe(false);
      expect(policy.shouldNotifyState({ state: "failed", source: "codex-mcp", eventKind: "self-test" })).toBe(false);
    }
  });

  it("keeps the renderer ESM wrapper aligned with the CommonJS policy", () => {
    expect(esmPolicy.shouldNotifyState({ state: "success", source: "codex-mcp" })).toBe(
      shouldNotifyState({ state: "success", source: "codex-mcp" })
    );
    expect(esmPolicy.notificationForState({ state: "failed", source: "cursor-mcp" })).toMatchObject({
      title: "Cursor task failed",
      body: "Needs attention"
    });
  });
});
