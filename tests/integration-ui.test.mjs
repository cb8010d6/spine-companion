import { describe, expect, it } from "vitest";
import {
  integrationCompletion,
  integrationErrorKey,
  integrationMatchesFilter,
  integrationPrimaryAction,
  integrationSummaryKey,
  integrationTestResult,
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
    expect(integrationCompletion(ready, { ok: true })).toEqual({ completed: 4, total: 4, state: "ready" });
    expect(integrationMatchesFilter(ready, "attention", { ok: true })).toBe(false);
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
    expect(integrationCompletion(kimi, { ok: true })).toEqual({ completed: 3, total: 3, state: "ready" });
  });

  it("does not select an unrelated integration when a filter is empty", () => {
    expect(selectFilteredIntegration([], "codex")).toBeNull();
    expect(selectFilteredIntegration([{ id: "vscode" }], "codex")).toEqual({ id: "vscode" });
  });

  it("uses persisted test state after the Manager is reopened", () => {
    const item = { ...base, configured: true, instructionsFound: true, lastTestOk: true, lastTestedAt: 42 };
    expect(integrationTestResult(item)).toEqual({ ok: true, testedAt: 42, error: "" });
    expect(integrationPrimaryAction(item)).toBe("retest");
    expect(integrationCompletion(item)).toEqual({ completed: 4, total: 4, state: "ready" });
  });

  it("requires restart acknowledgement before a connection test", () => {
    const item = { ...base, configured: true, instructionsFound: true, needsRestart: true, lastTestOk: true };
    expect(integrationPrimaryAction(item)).toBe("restart");
    expect(integrationSummaryKey(item)).toBe("manager.integrations.summaryRestart");
    expect(integrationMatchesFilter(item, "attention")).toBe(true);
    expect(integrationCompletion(item)).toEqual({ completed: 3, total: 4, state: "setup" });
  });

  it("keeps persisted test errors available for recovery UI", () => {
    const item = { ...base, configured: true, instructionsFound: true, lastTestOk: false, lastTestError: "MCP timed out" };
    expect(integrationTestResult(item)).toEqual({ ok: false, testedAt: 0, error: "MCP timed out" });
    expect(integrationPrimaryAction(item)).toBe("test");
    expect(integrationErrorKey("MCP initialize response timed out")).toBe("manager.integrations.error.timeout");
    expect(integrationErrorKey("Failed to start MCP server")).toBe("manager.integrations.error.start");
  });
});
