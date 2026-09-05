// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { applyCompanionState, panelBridgeState } from "../src/renderer/panel.js";

afterEach(() => { document.body.replaceChildren(); });

describe("Panel report status", () => {
  it("recognizes a real report without requiring a Companion-managed config", () => {
    const now = Date.now();
    expect(panelBridgeState({ apiOk: true }, [], now, {
      lastReport: { source: "my-agent-mcp", state: "running", updatedAt: new Date(now).toISOString() }
    })).toBe("report");
  });

  it("uses the newest report across configured tools", () => {
    const now = Date.now();
    expect(panelBridgeState({ apiOk: true }, [
      { configured: true, lastTestOk: true, lastReportedAt: now - 600000 },
      { configured: true, lastReportedAt: now - 1000 }
    ], now)).toBe("report");
  });

  it("shows the selected working session when another session reports success", () => {
    document.body.innerHTML = `<span id="global-status-dot"></span><span id="global-status-text"></span>
      <span id="panel-source-value"></span><section><p id="panel-task-message"></p></section>
      <span id="panel-api-value"></span>`;
    applyCompanionState({
      state: "working", source: "codex-mcp", sessionId: "A", message: "A is working", revision: 3,
      lastReport: { state: "success", source: "claude-mcp", message: "B finished", updatedAt: new Date().toISOString() }
    });
    expect(document.getElementById("panel-task-message").textContent).toBe("A is working");
    expect(document.getElementById("panel-source-value").title).toContain("A");
    expect(document.getElementById("global-status-dot").classList.contains("working")).toBe(true);
  });
});
