import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Use dynamic require so vitest can handle CJS modules
const { createStateStore, createStateMachine } = require("../src/shared/state-store.cjs");
const stateMachine = require("../src/shared/state-machine.json");

describe("createStateMachine", () => {
  const { normalizeStateId } = createStateMachine(stateMachine);

  it("normalizes known state ids", () => {
    expect(normalizeStateId("idle")).toBe("idle");
    expect(normalizeStateId("working")).toBe("working");
    expect(normalizeStateId("reviewing")).toBe("reviewing");
    expect(normalizeStateId("running")).toBe("running");
    expect(normalizeStateId("success")).toBe("success");
    expect(normalizeStateId("failed")).toBe("failed");
    expect(normalizeStateId("waiting")).toBe("waiting");
    expect(normalizeStateId("sleeping")).toBe("sleeping");
    expect(normalizeStateId("reminder")).toBe("reminder");
  });

  it("resolves aliases", () => {
    expect(normalizeStateId("move")).toBe("running");
    expect(normalizeStateId("run")).toBe("running");
    expect(normalizeStateId("review")).toBe("reviewing");
    expect(normalizeStateId("special")).toBe("reviewing");
    expect(normalizeStateId("interact")).toBe("reminder");
    expect(normalizeStateId("sleep")).toBe("sleeping");
    expect(normalizeStateId("fail")).toBe("failed");
    expect(normalizeStateId("wait")).toBe("waiting");
  });

  it("is case-insensitive", () => {
    expect(normalizeStateId("IDLE")).toBe("idle");
    expect(normalizeStateId("Working")).toBe("working");
    expect(normalizeStateId("MOVE")).toBe("running");
  });

  it("trims whitespace", () => {
    expect(normalizeStateId("  idle  ")).toBe("idle");
    expect(normalizeStateId("\tworking\n")).toBe("working");
  });

  it("falls back to idle for unknown states", () => {
    expect(normalizeStateId("unknown")).toBe("idle");
    expect(normalizeStateId("")).toBe("idle");
    expect(normalizeStateId(null)).toBe("idle");
    expect(normalizeStateId(undefined)).toBe("idle");
    expect(normalizeStateId(42)).toBe("idle");
  });
});

describe("createStateStore", () => {
  let store;
  const config = { state: { initial: "idle" } };

  beforeEach(() => {
    store = createStateStore(config, stateMachine);
  });

  afterEach(() => {
    store.destroy();
  });

  describe("snapshot", () => {
    it("returns initial state", () => {
      const snap = store.snapshot();
      expect(snap.state).toBe("idle");
      expect(snap.source).toBe("system");
      expect(snap.direction).toBe("right");
      expect(snap.message).toBe("");
      expect(snap.updatedAt).toBeTruthy();
    });

    it("returns a copy, not a reference", () => {
      const a = store.snapshot();
      const b = store.snapshot();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("setState", () => {
    it("transitions to a valid state", () => {
      const result = store.setState({ state: "working", source: "test" });
      expect(result.state).toBe("working");
      expect(result.source).toBe("test");
    });

    it("normalizes state via aliases", () => {
      const result = store.setState({ state: "move" });
      expect(result.state).toBe("running");
    });

    it("normalizes unknown states to idle", () => {
      store.setState({ state: "working" });
      const result = store.setState({ state: "nonexistent" });
      expect(result.state).toBe("idle");
    });

    it("preserves direction for running state", () => {
      const result = store.setState({ state: "running", direction: "left" });
      expect(result.direction).toBe("left");
    });

    it("resets direction to right for non-running states", () => {
      store.setState({ state: "running", direction: "left" });
      const result = store.setState({ state: "working" });
      expect(result.direction).toBe("right");
    });

    it("accepts state via id property", () => {
      const result = store.setState({ id: "working" });
      expect(result.state).toBe("working");
    });

    it("accepts state via status property", () => {
      const result = store.setState({ status: "working" });
      expect(result.state).toBe("working");
    });

    it("updates the updatedAt timestamp", async () => {
      const before = store.snapshot().updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      const after = store.setState({ state: "working" }).updatedAt;
      expect(after).not.toBe(before);
    });

    it("emits state event", () => {
      const events = [];
      store.emitter.on("state", (state) => events.push(state));
      store.setState({ state: "working" });
      expect(events).toHaveLength(1);
      expect(events[0].state).toBe("working");
    });

    it("sets message", () => {
      const result = store.setState({ state: "working", message: "Building" });
      expect(result.message).toBe("Building");
    });

    it("clears old message when a state transition does not provide one", () => {
      store.setState({ state: "working", message: "Building" });
      const result = store.setState({ state: "running" });
      expect(result.message).toBe("");
    });

    it("preserves old message only when explicitly requested", () => {
      store.setState({ state: "working", message: "Building" });
      const result = store.setState({ state: "running", preserveMessage: true });
      expect(result.message).toBe("Building");
      expect(result.preserveMessage).toBeUndefined();
    });

    it("keeps message updates in the current state when no state is specified", () => {
      store.setState({ state: "working", message: "Building" });
      const result = store.setState({ source: "test" });
      expect(result.state).toBe("working");
      expect(result.message).toBe("Building");
    });

    it("clears transient keys not present in input", () => {
      store.setState({ state: "reminder", reminderId: "r1", autoReturnMs: 5000, notify: true });
      const next = store.setState({ state: "idle" });
      expect(next.reminderId).toBeUndefined();
      expect(next.autoReturnMs).toBeUndefined();
      expect(next.notify).toBeUndefined();
    });

    it("removes status key from output", () => {
      const result = store.setState({ status: "working" });
      expect(result.status).toBeUndefined();
      expect(result.state).toBe("working");
    });

    it("keeps previous state if no state specified", () => {
      store.setState({ state: "working" });
      const result = store.setState({ message: "hello" });
      expect(result.state).toBe("working");
    });
  });

  describe("createReminder", () => {
    it("creates a reminder with default delay", () => {
      const reminder = store.createReminder({ text: "Stand up" });
      expect(reminder.text).toBe("Stand up");
      expect(reminder.id).toMatch(/^rem_/);
      expect(reminder.fired).toBe(false);
      expect(reminder.dueAt).toBeTruthy();
    });

    it("creates a reminder with inSeconds", () => {
      const reminder = store.createReminder({ text: "Test", inSeconds: 60 });
      const dueAt = new Date(reminder.dueAt).getTime();
      const now = Date.now();
      // Should be roughly 60 seconds in the future
      expect(dueAt - now).toBeGreaterThan(59000);
      expect(dueAt - now).toBeLessThan(61000);
    });

    it("creates a reminder with delayMs", () => {
      const reminder = store.createReminder({ text: "Test", delayMs: 5000 });
      const dueAt = new Date(reminder.dueAt).getTime();
      const now = Date.now();
      expect(dueAt - now).toBeGreaterThan(4500);
      expect(dueAt - now).toBeLessThan(5500);
    });

    it("uses custom id if provided", () => {
      const reminder = store.createReminder({ id: "my-reminder", text: "Test" });
      expect(reminder.id).toBe("my-reminder");
    });

    it("uses message property as fallback for text", () => {
      const reminder = store.createReminder({ message: "Fallback" });
      expect(reminder.text).toBe("Fallback");
    });

    it("defaults text to Reminder", () => {
      const reminder = store.createReminder({});
      expect(reminder.text).toBe("Reminder");
    });

    it("honors a zero duration without applying the default return timer", async () => {
      vi.useFakeTimers();
      try {
        store.createReminder({ id: "zero-duration", text: "Now", delayMs: 100, durationMs: 0 });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot().state).toBe("reminder");
        await vi.advanceTimersByTimeAsync(5000);
        expect(store.snapshot().state).toBe("reminder");
        expect(store.listReminders()[0].fired).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits for a long due date instead of truncating it", async () => {
      vi.useFakeTimers();
      try {
        const maxTimeout = 0x7fffffff;
        store.createReminder({
          id: "long-date",
          text: "Long",
          dueAt: new Date(Date.now() + maxTimeout + 1000).toISOString(),
          durationMs: 0
        });
        await vi.advanceTimersByTimeAsync(maxTimeout);
        expect(store.snapshot().state).toBe("idle");
        await vi.advanceTimersByTimeAsync(1000);
        expect(store.snapshot().state).toBe("reminder");
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects a new reminder over the bounded capacity without cancelling existing timers", () => {
      vi.useFakeTimers();
      try {
        for (let index = 0; index < 128; index += 1) {
          store.createReminder({ id: `bounded-${index}`, delayMs: 60_000 });
        }
        expect(vi.getTimerCount()).toBe(128);
        expect(() => store.createReminder({ id: "overflow", delayMs: 60_000 })).toThrow(/limit/i);
        expect(store.listReminders()).toHaveLength(128);
        expect(vi.getTimerCount()).toBe(128);
      } finally {
        vi.useRealTimers();
      }
    });

    it("replaces an already-fired reminder without letting its old generation win", async () => {
      vi.useFakeTimers();
      try {
        store.createReminder({ id: "fired-replacement", text: "Old", delayMs: 100, durationMs: 1000 });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({ state: "reminder", message: "Old" });
        store.setState({ state: "working", source: "codex", message: "New report" });
        store.createReminder({ id: "fired-replacement", text: "New", delayMs: 200, durationMs: 0 });
        expect(store.snapshot()).toMatchObject({ state: "working", message: "New report" });
        await vi.advanceTimersByTimeAsync(200);
        expect(store.snapshot()).toMatchObject({ state: "reminder", message: "New" });
        expect(store.listReminders()).toHaveLength(1);
        expect(store.listReminders()[0]).toMatchObject({ text: "New", fired: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it("dismisses the replaced reminder overlay before scheduling its new generation", async () => {
      vi.useFakeTimers();
      try {
        store.createReminder({ id: "dismissed", text: "Old", delayMs: 100, durationMs: 1000 });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({ state: "reminder", message: "Old" });
        store.createReminder({ id: "dismissed", text: "New", delayMs: 200, durationMs: 0 });
        expect(store.snapshot()).toMatchObject({ state: "idle", message: "" });
        await vi.advanceTimersByTimeAsync(200);
        expect(store.snapshot()).toMatchObject({ state: "reminder", message: "New" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("listReminders", () => {
    it("lists all created reminders", () => {
      store.createReminder({ text: "A" });
      store.createReminder({ text: "B" });
      const list = store.listReminders();
      expect(list).toHaveLength(2);
      expect(list[0].text).toBe("A");
      expect(list[1].text).toBe("B");
    });

    it("does not expose timeout handle", () => {
      store.createReminder({ text: "A" });
      const list = store.listReminders();
      expect(list[0].timeout).toBeUndefined();
    });

    it("deletes pending reminders", () => {
      const reminder = store.createReminder({ text: "A", delayMs: 60000 });
      expect(store.deleteReminder(reminder.id)).toBe(true);
      expect(store.listReminders()).toEqual([]);
      expect(store.deleteReminder(reminder.id)).toBe(false);
    });

    it("does not fire a pending reminder after it is deleted", async () => {
      vi.useFakeTimers();
      try {
        const reminder = store.createReminder({ id: "cancelled", text: "Cancel", delayMs: 100 });
        expect(store.deleteReminder(reminder.id)).toBe(true);
        await vi.advanceTimersByTimeAsync(101);
        expect(store.snapshot().state).toBe("idle");
        expect(store.listReminders()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("replaces an existing id without allowing the old timer to fire", async () => {
      vi.useFakeTimers();
      try {
        store.createReminder({ id: "same-id", text: "Old", delayMs: 100 });
        const replacement = store.createReminder({ id: "same-id", text: "New", delayMs: 200 });
        expect(store.listReminders()).toEqual([
          expect.objectContaining({ id: replacement.id, text: "New", fired: false })
        ]);
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot().state).toBe("idle");
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot().state).toBe("reminder");
        expect(store.snapshot().message).toBe("New");
      } finally {
        vi.useRealTimers();
      }
    });

    it("restores the latest task details after a reminder overlay ends", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex", message: "Building" });
        store.createReminder({ id: "overlay", text: "Check", delayMs: 100, durationMs: 50, returnTo: "idle" });
        store.setState({ state: "running", source: "opencode", message: "Testing", direction: "left" });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({ state: "reminder", message: "Check" });
        await vi.advanceTimersByTimeAsync(50);
        expect(store.snapshot()).toMatchObject({
          state: "running",
          source: "opencode",
          message: "Testing",
          direction: "left"
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("history and persistence", () => {
    it("keeps bounded state history", () => {
      const s = createStateStore({ state: { initial: "idle", historyLimit: 3 } }, stateMachine);
      s.setState({ state: "working", source: "test" });
      s.setState({ state: "running", source: "test" });
      s.setState({ state: "success", source: "test" });
      expect(s.listHistory().map((item) => item.state)).toEqual(["working", "running", "success"]);
      s.destroy();
    });

    it("persists reminders and restores unfired reminders", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-reminders-"));
      const remindersPath = path.join(dir, "reminders.json");
      const s = createStateStore({ state: { initial: "idle", remindersPath } }, stateMachine);
      s.createReminder({ id: "persisted", text: "Persist me", delayMs: 60000 });
      s.destroy();

      const restored = createStateStore({ state: { initial: "idle", remindersPath } }, stateMachine);
      expect(restored.listReminders()).toHaveLength(1);
      expect(restored.listReminders()[0].id).toBe("persisted");
      restored.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("ignores a damaged reminders file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-reminders-"));
      const remindersPath = path.join(dir, "reminders.json");
      fs.writeFileSync(remindersPath, "{ bad json");
      try {
        const restored = createStateStore({ state: { initial: "idle", remindersPath } }, stateMachine);
        expect(restored.listReminders()).toEqual([]);
        restored.destroy();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("idle timeout", () => {
    it("switches to sleeping after configured idle timeout", async () => {
      vi.useFakeTimers();
      try {
        const s = createStateStore({ state: { initial: "idle", idleTimeoutMs: 100 } }, stateMachine);
        s.setState({ state: "working" });
        await vi.advanceTimersByTimeAsync(100);
        expect(s.snapshot().state).toBe("sleeping");
        s.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("auto-return", () => {
    it("returns to specified state after delay", async () => {
      const events = [];
      store.emitter.on("state", (s) => events.push(s));
      store.setState({
        state: "reminder",
        autoReturnMs: 50,
        returnTo: "working"
      });
      // Wait for auto-return
      await new Promise((r) => setTimeout(r, 100));
      const last = events[events.length - 1];
      expect(last.state).toBe("working");
      expect(last.source).toBe("auto-return");
    });

    it("returns to the previous state when returnTo is omitted", async () => {
      store.setState({ state: "working", source: "test" });
      store.setState({
        state: "reminder",
        message: "Temporary",
        autoReturnMs: 50
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(store.snapshot().state).toBe("working");
      expect(store.snapshot().message).toBe("");
    });

    it("does not auto-return if state changed in the meantime", async () => {
      store.setState({
        state: "reminder",
        autoReturnMs: 50,
        returnTo: "idle"
      });
      // Change state before auto-return fires — the new updatedAt
      // prevents the scheduled auto-return callback from executing
      await new Promise((r) => setTimeout(r, 5));
      store.setState({ state: "working", source: "user" });
      await new Promise((r) => setTimeout(r, 100));
      expect(store.snapshot().state).toBe("working");
    });

    it("clears superseded auto-return timers", () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "reminder", autoReturnMs: 1000, returnTo: "idle" });
        expect(vi.getTimerCount()).toBe(1);
        store.setState({ state: "working", source: "user" });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("removes auto-return timers after they fire", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "reminder", autoReturnMs: 1000, returnTo: "idle" });
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(store.snapshot().state).toBe("idle");
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a newer same-tick report after the old auto-return generation", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "reminder", autoReturnMs: 100, returnTo: "idle" });
        store.setState({ state: "working", source: "codex", message: "New report" });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({
          state: "working",
          source: "codex",
          message: "New report"
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not replace an active report when a stale timer reaches its deadline", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex", message: "Current" });
        store.setState({ state: "reminder", autoReturnMs: 100, returnTo: "idle" });
        store.setState({ state: "running", source: "opencode", message: "Latest" });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({
          state: "running",
          source: "opencode",
          message: "Latest"
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("v0.2.7 state lifecycle", () => {
    it("cancels a replaced reminder so an old timer cannot fire", async () => {
      vi.useFakeTimers();
      try {
        const events = [];
        store.emitter.on("state", (state) => events.push(state));
        store.createReminder({ id: "replace-me", text: "old", delayMs: 100 });
        store.createReminder({ id: "replace-me", text: "new", delayMs: 200 });

        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot().state).not.toBe("reminder");
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot().state).toBe("reminder");
        expect(events.filter((state) => state.state === "reminder")).toHaveLength(1);
        expect(store.listReminders()).toMatchObject([{ id: "replace-me", text: "new", fired: true }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("restores the latest live AI state after a temporary reminder display", async () => {
      vi.useFakeTimers();
      try {
        store.setState({
          state: "working",
          source: "codex-mcp",
          sourceLabel: "Codex",
          sessionId: "build-1",
          message: "Building",
          eventKind: "report"
        });
        store.createReminder({ id: "break", text: "Take a break", delayMs: 0, durationMs: 100 });
        await vi.advanceTimersByTimeAsync(0);
        expect(store.snapshot().state).toBe("reminder");

        store.setState({
          state: "running",
          source: "codex-mcp",
          sourceLabel: "Codex",
          sessionId: "build-1",
          message: "Running tests",
          eventKind: "report"
        });
        // A report updates business state while the temporary display remains visible.
        expect(store.snapshot().state).toBe("reminder");

        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({
          state: "running",
          source: "codex-mcp",
          sourceLabel: "Codex",
          sessionId: "build-1",
          message: "Running tests"
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores stale display dismissals by revision", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex-mcp", message: "Build", eventKind: "report" });
        store.createReminder({ id: "dismiss-me", text: "Pause", delayMs: 0, durationMs: 100 });
        await vi.advanceTimersByTimeAsync(0);
        const displayed = store.snapshot();
        store.setState({ state: "running", source: "codex-mcp", message: "Tests", eventKind: "report" });
        const latest = store.snapshot();
        expect(store.dismissDisplay(displayed.revision)).toMatchObject({ state: "reminder" });
        expect(store.snapshot().revision).toBe(latest.revision);
        expect(store.dismissDisplay(latest.revision)).toMatchObject({ state: "running", message: "Tests" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("tracks explicit sessions without inventing ids and aggregates no-id reports by source", () => {
      store.setState({ state: "working", source: "codex-mcp", sourceLabel: "Codex", sessionId: "one", message: "One", eventKind: "report" });
      store.setState({ state: "running", source: "codex-mcp", sourceLabel: "Codex", sessionId: "two", message: "Two", eventKind: "report" });
      store.setState({ state: "reviewing", source: "codex-mcp", sourceLabel: "Codex", message: "All", eventKind: "report" });

      const listed = store.listSessions();
      expect(listed).toMatchObject({ focused: null, staleAfterMs: 300000 });
      expect(listed.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "codex-mcp", sessionId: "one", granularity: "session", state: "working" }),
        expect.objectContaining({ source: "codex-mcp", sessionId: "two", granularity: "session", state: "running" }),
        expect.objectContaining({ source: "codex-mcp", granularity: "source", state: "reviewing" })
      ]));
      expect(listed.sessions.filter((item) => item.source === "codex-mcp")).toHaveLength(3);
      expect(listed.sessions.every((item) => item.sessionId || item.granularity === "source")).toBe(true);
    });

    it("deduplicates event ids and rejects out-of-order sequence numbers", () => {
      const events = [];
      store.emitter.on("state", (state) => events.push(state));
      const first = store.setState({ state: "working", source: "codex-mcp", sessionId: "one", eventId: "evt-1", sequence: 2, eventKind: "report" });
      const duplicate = store.setState({ state: "failed", source: "codex-mcp", sessionId: "one", eventId: "evt-1", sequence: 3, eventKind: "report" });
      const stale = store.setState({ state: "success", source: "codex-mcp", sessionId: "one", eventId: "evt-2", sequence: 1, eventKind: "report" });

      expect(duplicate).toMatchObject({ state: "working", revision: first.revision });
      expect(duplicate.lastReport).toBeUndefined();
      expect(stale).toMatchObject({ state: "working", revision: first.revision });
      expect(stale.lastReport).toBeUndefined();
      expect(events).toHaveLength(1);
      expect(store.getLastReport()).toMatchObject({ source: "codex-mcp", updatedAt: first.updatedAt });
    });

    it("does not treat demo/self-test or idle timeout as real reports", async () => {
      vi.useFakeTimers();
      try {
        const s = createStateStore({ state: { initial: "idle", idleTimeoutMs: 100 } }, stateMachine);
        s.setState({ state: "working", source: "demo", eventKind: "demo" });
        expect(s.getLastReport()).toBeNull();
        s.setState({ state: "working", source: "self-test", eventKind: "self-test" });
        expect(s.getLastReport()).toBeNull();
        await vi.advanceTimersByTimeAsync(100);
        expect(s.snapshot().state).toBe("working");
        expect(s.getLastReport()).toBeNull();
        s.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("marks stale sessions without changing their business state", () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex-mcp", sessionId: "old", eventKind: "report" });
        vi.advanceTimersByTime(300001);
        const session = store.listSessions().sessions.find((item) => item.sessionId === "old");
        expect(session).toMatchObject({ stale: true, state: "working", ended: false });
        expect(store.snapshot().state).toBe("working");
      } finally {
        vi.useRealTimers();
      }
    });

    it("supports explicit and automatic session focus", () => {
      store.setState({ state: "working", source: "codex-mcp", sessionId: "one", eventKind: "report" });
      store.setState({ state: "running", source: "codex-mcp", sessionId: "two", eventKind: "report" });
      expect(store.focusSession({ source: "codex-mcp", sessionId: "one" })).toMatchObject({ source: "codex-mcp", sessionId: "one" });
      expect(store.listSessions().focused).toEqual({ source: "codex-mcp", sessionId: "one" });
      expect(store.focusSession({ source: null })).toMatchObject({ state: "running" });
      expect(store.listSessions().focused).toBeNull();
    });

    it("dismissing a focused completion returns to another unfinished task", () => {
      store.setState({ state: "working", source: "codex-mcp", sessionId: "A" });
      store.setState({ state: "success", source: "codex-mcp", sessionId: "B" });
      const focused = store.focusSession({ source: "codex-mcp", sessionId: "B" });
      expect(store.dismissDisplay(focused.revision)).toMatchObject({ state: "working", sessionId: "A", notify: false });
      expect(store.listSessions().focused).toBeNull();
    });

    it("does not reopen an explicitly ended session on a late report", () => {
      store.setState({ state: "working", source: "codex-mcp", sessionId: "A" });
      const ended = store.setState({ source: "codex-mcp", sessionId: "A", sessionEnded: true, sequence: 2 });
      const events = [];
      store.emitter.on("state", (state) => events.push(state));
      const late = store.setState({ state: "running", source: "codex-mcp", sessionId: "A", sequence: 3 });
      expect(late.revision).toBe(ended.revision);
      expect(store.listSessions().sessions[0]).toMatchObject({ ended: true, state: "working" });
      expect(events).toHaveLength(0);
    });

    it("does not cancel an active reminder when focusing an unknown session", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex-mcp", message: "Building" });
        store.createReminder({ id: "focus-race", delayMs: 100, durationMs: 200 });
        await vi.advanceTimersByTimeAsync(100);
        expect(() => store.focusSession({ source: "missing-mcp" })).toThrow(/session/i);
        await vi.advanceTimersByTimeAsync(200);
        expect(store.snapshot()).toMatchObject({ state: "working", message: "Building" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("bounds retained session memory", () => {
      const s = createStateStore({ state: { initial: "idle", maxSessions: 2 } }, stateMachine);
      s.setState({ state: "success", source: "a-mcp", sessionId: "1", eventKind: "report" });
      s.setState({ state: "working", source: "b-mcp", sessionId: "1", eventKind: "report" });
      s.setState({ state: "working", source: "c-mcp", sessionId: "1", eventKind: "report" });
      expect(s.listSessions().sessions).toHaveLength(2);
      expect(s.listSessions().sessions.some((item) => item.source === "a-mcp")).toBe(false);
      s.destroy();
    });

    it("prefers waiting for input over a newer running session", () => {
      store.setState({ state: "waiting", source: "codex-mcp", sessionId: "approval" });
      store.setState({ state: "running", source: "codex-mcp", sessionId: "tests" });
      expect(store.snapshot()).toMatchObject({ state: "waiting", sessionId: "approval" });
    });

    it("rejects new sessions instead of evicting unfinished work at capacity", () => {
      const s = createStateStore({ state: { maxSessions: 2 } }, stateMachine);
      try {
        s.setState({ state: "working", source: "codex-mcp", sessionId: "a" });
        s.setState({ state: "running", source: "codex-mcp", sessionId: "b" });
        const before = s.snapshot();
        expect(() => s.setState({ state: "working", source: "codex-mcp", sessionId: "c" })).toThrow(/session limit/i);
        expect(s.snapshot()).toEqual(before);
        expect(s.listSessions().sessions.map((item) => item.sessionId).sort()).toEqual(["a", "b"]);
      } finally {
        s.destroy();
      }
    });

    it("does not inherit another session state or message on a partial first report", () => {
      store.setState({ state: "running", source: "codex-mcp", sessionId: "a", message: "A build" });
      store.setState({ source: "codex-mcp", sessionId: "b" });
      expect(store.listSessions().sessions.find((item) => item.sessionId === "b"))
        .toMatchObject({ state: "idle", message: "" });
    });

    it("keeps focused stale work past retention without inventing completion", () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex-mcp", sessionId: "focus" });
        store.focusSession({ source: "codex-mcp", sessionId: "focus" });
        vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
        const list = store.listSessions();
        expect(list.focused).toEqual({ source: "codex-mcp", sessionId: "focus" });
        expect(list.sessions).toEqual([expect.objectContaining({ state: "working", stale: true })]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("restores the current AI task even when a legacy reminder requests idle", async () => {
      vi.useFakeTimers();
      try {
        store.setState({ state: "working", source: "codex-mcp", message: "Build" });
        store.createReminder({ id: "legacy", delayMs: 100, durationMs: 200, returnTo: "idle" });
        await vi.advanceTimersByTimeAsync(100);
        store.setState({ state: "running", source: "codex-mcp", message: "Tests" });
        await vi.advanceTimersByTimeAsync(200);
        expect(store.snapshot()).toMatchObject({ state: "running", source: "codex-mcp", message: "Tests" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("restores another unfinished session when the overlaid session ends", async () => {
      vi.useFakeTimers();
      try {
        store.setState({
          state: "running",
          source: "codex-mcp",
          sessionId: "B",
          sequence: 1,
          message: "B task",
          eventKind: "report"
        });
        store.setState({
          state: "waiting",
          source: "codex-mcp",
          sessionId: "A",
          sequence: 1,
          message: "A approval",
          eventKind: "report"
        });
        store.createReminder({ id: "session-end-overlay", delayMs: 0, durationMs: 100 });
        await vi.advanceTimersByTimeAsync(0);
        expect(store.snapshot()).toMatchObject({ state: "reminder", message: "Reminder" });

        store.setState({
          source: "codex-mcp",
          sessionId: "A",
          sequence: 2,
          sessionEnded: true,
          eventKind: "report"
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(store.snapshot()).toMatchObject({
          state: "running",
          source: "codex-mcp",
          sessionId: "B",
          message: "B task",
          notify: false
        });

        const restored = store.snapshot();
        const late = store.setState({
          state: "failed",
          source: "codex-mcp",
          sessionId: "A",
          sequence: 3,
          eventKind: "report"
        });
        expect(late).toEqual(restored);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not inherit notify false from an earlier report", () => {
      store.setState({
        state: "working",
        source: "codex-mcp",
        sessionId: "notify",
        sequence: 1,
        eventKind: "report",
        notify: false
      });
      expect(store.snapshot().notify).toBe(false);
      const next = store.setState({
        state: "running",
        source: "codex-mcp",
        sessionId: "notify",
        sequence: 2,
        eventKind: "report"
      });
      expect(next.notify).toBeUndefined();
      expect(store.getLastReport().notify).toBeUndefined();
    });

    it("retains stale unfinished work even when it is unfocused", () => {
      vi.useFakeTimers();
      try {
        store.setState({
          state: "working",
          source: "codex-mcp",
          sessionId: "unfocused-stale",
          eventKind: "report"
        });
        vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
        expect(store.listSessions().sessions).toEqual([
          expect.objectContaining({ sessionId: "unfocused-stale", state: "working", stale: true, ended: false })
        ]);
        expect(store.snapshot()).toMatchObject({ state: "working", sessionId: "unfocused-stale" });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("initial state", () => {
    it("respects config initial state", () => {
      const s = createStateStore({ state: { initial: "working" } }, stateMachine);
      expect(s.snapshot().state).toBe("working");
      s.destroy();
    });

    it("normalizes invalid initial state to idle", () => {
      const s = createStateStore({ state: { initial: "nonexistent" } }, stateMachine);
      expect(s.snapshot().state).toBe("idle");
      s.destroy();
    });

    it("defaults to idle with empty config", () => {
      const s = createStateStore({}, stateMachine);
      expect(s.snapshot().state).toBe("idle");
      s.destroy();
    });
  });
});
