import { describe, expect, it } from "vitest";
import {
  integrationCompletion,
  integrationCanTest,
  integrationErrorKey,
  integrationReportResult,
  integrationMatchesFilter,
  integrationMatchesSource,
  integrationPrimaryAction,
  integrationSummaryKey,
  integrationTestResult,
  isIntegrationSelfTest,
  selectFilteredIntegration
} from "../src/renderer/integration-ui.js";

const base = { configFormat: "mcpServersJson", installed: true, configFound: true };

describe("AI integration presentation model", () => {
  it("guides setup in configuration, instructions, and test order", () => {
    expect(integrationPrimaryAction(base)).toBe("configure");
    expect(integrationPrimaryAction({ ...base, configured: true })).toBe("instructions");
    expect(integrationPrimaryAction({ ...base, configured: true, instructionsFound: true })).toBe("test");
    expect(integrationPrimaryAction({ ...base, configured: true, instructionsFound: true }, { ok: true })).toBe("retest");
  });

  it("does not show an automatic setup action for undetected tools", () => {
    const item = { ...base, installed: false, configFound: false };
    expect(integrationPrimaryAction(item)).toBe("manual");
    expect(integrationSummaryKey(item)).toBe("manager.integrations.summaryUndetected");
  });

  it("computes setup completion and filters attention items", () => {
    const ready = { ...base, configured: true, instructionsFound: true };
    expect(integrationCompletion(ready, { ok: true }, true)).toEqual({ completed: 5, total: 5, state: "ready" });
    expect(integrationMatchesFilter(ready, "attention", { ok: true }, true)).toBe(false);
    expect(integrationMatchesFilter(base, "attention")).toBe(true);
  });

  it("keeps custom clients in their own template flow", () => {
    const custom = { configFormat: "templateOnly" };
    expect(integrationPrimaryAction(custom)).toBe("custom");
    expect(integrationCompletion(custom).state).toBe("custom");
  });

  it("supports copy-only project instructions without blocking Kimi MCP testing", () => {
    const kimi = { ...base, configured: true, instructionsPath: "", instructionsFound: false };
    expect(integrationPrimaryAction(kimi)).toBe("test");
    expect(integrationCompletion(kimi, { ok: true }, true)).toEqual({ completed: 4, total: 4, state: "ready" });
  });

  it("does not select an unrelated integration when a filter is empty", () => {
    expect(selectFilteredIntegration([], "codex")).toBeNull();
    expect(selectFilteredIntegration([{ id: "vscode" }], "codex")).toEqual({ id: "vscode" });
  });

  it("uses persisted test state after the Manager is reopened", () => {
    const item = { ...base, configured: true, instructionsFound: true, lastTestOk: true, lastTestedAt: 42 };
    expect(integrationTestResult(item)).toEqual({ ok: true, testedAt: 42, error: "" });
    expect(integrationPrimaryAction(item)).toBe("retest");
    expect(integrationCompletion(item)).toEqual({ completed: 4, total: 5, state: "awaitingReport" });
    expect(integrationSummaryKey(item)).toBe("manager.integrations.summaryAwaitingReport");
  });

  it("requires restart acknowledgement before a connection test", () => {
    const item = { ...base, configured: true, instructionsFound: true, needsRestart: true, lastTestOk: true };
    expect(integrationPrimaryAction(item)).toBe("restart");
    expect(integrationSummaryKey(item)).toBe("manager.integrations.summaryRestart");
    expect(integrationMatchesFilter(item, "attention")).toBe(true);
    expect(integrationCompletion(item)).toEqual({ completed: 3, total: 5, state: "setup" });
  });

  it("uses the persisted first real report marker", () => {
    expect(integrationReportResult({ ...base, lastReportedAt: 42 })).toEqual({ reportedAt: 42 });
    expect(integrationReportResult(base)).toBeNull();
    expect(isIntegrationSelfTest({ message: "[Spine Companion self-test] Codex" })).toBe(true);
    expect(isIntegrationSelfTest({ message: "Working on the real task" })).toBe(false);
  });

  it("matches canonical and legacy source aliases to the same integration", () => {
    expect(integrationMatchesSource({ id: "vscode", source: "vscode-mcp" }, "vs-code-mcp")).toBe(true);
    expect(integrationMatchesSource({ id: "opencode", source: "opencode-mcp" }, "open-code-mcp")).toBe(true);
    expect(integrationMatchesSource({ id: "kimi-code", source: "kimi-mcp" }, "moonshot-mcp")).toBe(true);
    expect(integrationMatchesSource({ id: "roo-cline", source: "roo-mcp" }, "cline-mcp")).toBe(true);
    expect(integrationMatchesSource({ id: "codex", source: "codex-mcp" }, "claude-mcp")).toBe(false);
  });

  it("tests only configured integrations that are ready for MCP", () => {
    expect(integrationCanTest({ ...base, configured: true, instructionsFound: true })).toBe(true);
    expect(integrationCanTest({ ...base, configured: true, instructionsFound: false })).toBe(true);
    expect(integrationCanTest({ ...base, configured: true, instructionsPath: "", instructionsFound: false })).toBe(true);
    expect(integrationCanTest({ ...base, configured: true, instructionsFound: true, needsRestart: true })).toBe(false);
  });

  it("keeps persisted test errors available for recovery UI", () => {
    const item = { ...base, configured: true, instructionsFound: true, lastTestOk: false, lastTestError: "MCP timed out" };
    expect(integrationTestResult(item)).toEqual({ ok: false, testedAt: 0, error: "MCP timed out" });
    expect(integrationPrimaryAction(item)).toBe("test");
    expect(integrationErrorKey("MCP initialize response timed out")).toBe("manager.integrations.error.timeout");
    expect(integrationErrorKey("Failed to start MCP server")).toBe("manager.integrations.error.start");
  });
});
