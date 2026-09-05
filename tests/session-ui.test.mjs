// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  createSessionController,
  normalizeSessionList,
  renderSessionList,
  sessionIsStale,
  sessionKey
} from "../src/renderer/session-ui.js";
const report = (overrides = {}) => ({
  source: "codex-mcp",
  sourceLabel: "Codex",
  state: "working",
  message: "Building",
  updatedAt: "2026-09-05T10:00:00.000Z",
  stale: false,
  ended: false,
  granularity: "source",
  ...overrides
});

describe("session presentation model", () => {
  it("normalizes the fixed list contract and preserves source granularity", () => {
    const value = normalizeSessionList({
      sessions: [report(), report({ sessionId: "build-2", granularity: "session" })],
      focused: { source: "codex-mcp", sessionId: "build-2" },
      staleAfterMs: 300000
    });
    expect(value).toMatchObject({ staleAfterMs: 300000, focused: { source: "codex-mcp", sessionId: "build-2" } });
    expect(value.sessions[0]).toMatchObject({ granularity: "source" });
    expect(value.sessions[1]).toMatchObject({ sessionId: "build-2", granularity: "session" });
  });

  it("keeps backend source granularity and explicit session rows distinct", () => {
    const sessions = normalizeSessionList({
      sessions: [
        report({ source: "codex-mcp", granularity: "source" }),
        report({ source: "cursor-mcp", sourceLabel: "Cursor", sessionId: "one", granularity: "session" })
      ]
    }).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].granularity).toBe("source");
    expect(sessionKey(sessions[0])).not.toBe(sessionKey(sessions[1]));
  });

  it("renders source and session rows with focus and stale hints", () => {
    let focused = null;
    const root = renderSessionList({
      sessions: [
        report({ sessionId: "build-1", granularity: "session" }),
        report({ source: "cursor-mcp", sourceLabel: "Cursor", stale: true, message: "Waiting" })
      ],
      focused: { source: "codex-mcp", sessionId: "build-1" },
      staleAfterMs: 300000
    }, {
      locale: "en-US",
      now: Date.parse("2026-09-05T10:01:00.000Z"),
      labels: {
        title: "Sessions",
        grouped: "Grouped by tool",
        stale: "May be out of date",
        focused: "Focused",
        focus: "Focus",
        state: (state) => state.toUpperCase()
      },
      onFocus: (selection) => { focused = selection; }
    });
    expect(root.querySelectorAll(".session-row")).toHaveLength(2);
    expect(root.querySelector('[data-granularity="session"]')).toBeTruthy();
    expect(root.textContent).toContain("Grouped by tool");
    expect(root.querySelector(".session-row.active")).toBeTruthy();
    expect(root.querySelector(".session-row.stale .session-row-stale").textContent).toBe("May be out of date");
    root.querySelector('[data-granularity="session"]').click();
    expect(focused).toEqual({ source: "codex-mcp", sessionId: "build-1" });
  });

  it("ages a non-stale backend record locally without marking it disconnected", () => {
    expect(sessionIsStale(report(), Date.parse("2026-09-05T10:06:00.001Z"), 300000)).toBe(true);
    expect(sessionIsStale(report({ stale: false }), Date.parse("2026-09-05T10:04:59.999Z"), 300000)).toBe(false);
  });
});

describe("session refresh controller", () => {
  it("refreshes on view entry and coalesces state events", async () => {
    vi.useFakeTimers();
    try {
      const listSessions = vi.fn().mockResolvedValue({ sessions: [report()], focused: null, staleAfterMs: 300000, revision: 2 });
      const changes = [];
      const controller = createSessionController({
        getBridge: () => ({ listSessions }),
        timers: globalThis,
        onChange: (snapshot, meta) => changes.push({ snapshot, meta }),
        staleTickMs: 0
      });
      const entered = controller.enter();
      await vi.runAllTimersAsync();
      await entered;
      expect(listSessions).toHaveBeenCalledTimes(1);
      controller.notifyState({ revision: 3 });
      controller.notifyState({ revision: 4 });
      await vi.advanceTimersByTimeAsync(80);
      expect(listSessions).toHaveBeenCalledTimes(2);
      expect(changes.at(-1).snapshot.revision).toBe(2);
      controller.leave();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a refresh that resolves after leaving the view", async () => {
    let resolve;
    const listSessions = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; }));
    const changes = [];
    const controller = createSessionController({
      getBridge: () => ({ listSessions }),
      onChange: (snapshot) => changes.push(snapshot)
    });
    const pending = controller.enter();
    controller.leave();
    resolve({ sessions: [report({ message: "late" })], revision: 7 });
    await pending;
    expect(controller.getSnapshot().sessions).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it("focuses a selected session and refreshes the focused marker", async () => {
    const focusSession = vi.fn().mockResolvedValue({ state: "working", source: "codex-mcp", sessionId: "build-1" });
    const listSessions = vi.fn()
      .mockResolvedValueOnce({ sessions: [report({ sessionId: "build-1", granularity: "session" })], focused: null, revision: 1 })
      .mockResolvedValueOnce({ sessions: [report({ sessionId: "build-1", granularity: "session" })], focused: { source: "codex-mcp", sessionId: "build-1" }, revision: 2 });
    const controller = createSessionController({ getBridge: () => ({ listSessions, focusSession }) });
    await controller.enter();
    await controller.focus({ source: "codex-mcp", sessionId: "build-1" });
    expect(focusSession).toHaveBeenCalledWith({ source: "codex-mcp", sessionId: "build-1" });
    expect(controller.getSnapshot().focused).toEqual({ source: "codex-mcp", sessionId: "build-1" });
  });
});
