import { describe, expect, it } from "vitest";
import {
  integrationCompletion,
  integrationMatchesFilter,
  integrationPrimaryAction,
  integrationSummaryKey,
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

  it("does not select an unrelated integration when a filter is empty", () => {
    expect(selectFilteredIntegration([], "codex")).toBeNull();
    expect(selectFilteredIntegration([{ id: "vscode" }], "codex")).toEqual({ id: "vscode" });
  });
});
