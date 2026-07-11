import { describe, expect, it, vi } from "vitest";
import {
  createCoalescedRefresh,
  integrationLabelForState,
  latestCompanionState,
  rendererHealthCategory,
  rendererHealthFromDiagnostics
} from "../src/renderer/dashboard-model.js";

describe("dashboard model", () => {
  it("prefers live state over history and otherwise uses the latest history item", () => {
    const history = [
      { state: "idle", source: "system" },
      { state: "working", source: "codex-mcp" }
    ];
    expect(latestCompanionState(null, history)).toEqual(history[1]);
    expect(latestCompanionState({ state: "reviewing", source: "mimocode-mcp" }, history))
      .toEqual({ state: "reviewing", source: "mimocode-mcp" });
  });

  it("shows the configured integration label for a state source", () => {
    const integrations = [{ source: "mimocode-mcp", sourceLabel: "MiMoCode" }];
    expect(integrationLabelForState({ source: "mimocode-mcp" }, integrations)).toBe("MiMoCode");
    expect(integrationLabelForState({ source: "future-agent-mcp" }, integrations)).toBe("future-agent-mcp");
  });

  it("reads renderer health from the Tauri diagnostics shape", () => {
    expect(rendererHealthFromDiagnostics({
      gpu: {
        mode: "hardware",
        renderer: { status: "healthy", lastReason: "heartbeat", recoveryCount: 2 }
      }
    })).toEqual({ status: "healthy", reason: "heartbeat", recoveryCount: 2 });
    expect(rendererHealthCategory("ok")).toBe("healthy");
    expect(rendererHealthCategory("context-lost")).toBe("attention");
  });

  it("coalesces bursts of live updates into one dashboard refresh", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const refresh = createCoalescedRefresh(callback, 80);
    refresh.schedule();
    refresh.schedule();
    refresh.schedule();
    vi.advanceTimersByTime(79);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
