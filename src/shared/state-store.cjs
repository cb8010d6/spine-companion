/**
 * Shared state store — extracted from state-server.cjs so it can be tested
 * independently and reused across Electron / Tauri / standalone server.
 */
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

function createStateMachine(stateMachineConfig) {
  const allowedStates = new Set(stateMachineConfig.states);
  const aliases = stateMachineConfig.aliases || {};

  function normalizeStateId(value) {
    const raw = String(value || "").trim().toLowerCase();
    const normalized = aliases[raw] || raw;
    return allowedStates.has(normalized) ? normalized : "idle";
  }

  return { allowedStates, normalizeStateId };
}

function createStateStore(config, stateMachineConfig) {
  const { normalizeStateId } = createStateMachine(stateMachineConfig);
  const emitter = new EventEmitter();
  const reminders = new Map();
  const autoReturnTimers = new Set();
  const historyLimit = Number(config.state?.historyLimit || 50);
  const history = [];
  const remindersPath = config.state?.remindersPath || "";
  const idleTimeoutMs = Number(config.state?.idleTimeoutMs || 0);
  let idleTimer = null;
  let current = {
    state: normalizeStateId(config.state?.initial || "idle"),
    message: "",
    source: "system",
    direction: "right",
    updatedAt: new Date().toISOString()
  };

  function snapshot() {
    return { ...current };
  }

  function persistReminders() {
    if (!remindersPath) return;
    const serializable = listReminders();
    fs.mkdirSync(path.dirname(remindersPath), { recursive: true });
    fs.writeFileSync(remindersPath, `${JSON.stringify(serializable, null, 2)}\n`);
  }

  function recordHistory(state) {
    history.push({ ...state });
    while (history.length > historyLimit) history.shift();
  }

  function clearAutoReturnTimers() {
    for (const timer of autoReturnTimers) clearTimeout(timer);
    autoReturnTimers.clear();
  }

  function setState(input = {}) {
    clearAutoReturnTimers();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    const previous = current;
    const requested = input.state || input.id || input.status;
    const nextState = requested ? normalizeStateId(requested) : previous.state;
    const direction = nextState === "running" ? (input.direction || previous.direction || "right") : "right";
    current = {
      ...previous,
      ...input,
      state: nextState,
      id: nextState,
      direction,
      updatedAt: new Date().toISOString(),
      source: input.source || previous.source || "local"
    };
    delete current.status;
    for (const key of ["reminderId", "autoReturnMs", "returnTo", "durationMs", "delayMs", "inSeconds", "dueAt", "at"]) {
      if (!(key in input)) delete current[key];
    }
    emitter.emit("state", snapshot());
    recordHistory(current);

    const autoReturnMs = Number(input.autoReturnMs || 0);
    if (autoReturnMs > 0) {
      const stateAtSchedule = current.updatedAt;
      const timer = setTimeout(() => {
        autoReturnTimers.delete(timer);
        if (current.updatedAt !== stateAtSchedule) return;
        setState({
          state: input.returnTo || previous.state || "idle",
          source: "auto-return",
          message: ""
        });
      }, autoReturnMs);
      autoReturnTimers.add(timer);
    }

    if (idleTimeoutMs > 0 && current.state !== "sleeping") {
      const stateAtSchedule = current.updatedAt;
      idleTimer = setTimeout(() => {
        if (current.updatedAt !== stateAtSchedule) return;
        setState({ state: "sleeping", source: "idle-timeout", message: "Idle timeout" });
      }, idleTimeoutMs);
    }

    return snapshot();
  }

  function scheduleReminder(input = {}, existing = null) {
    const id = input.id || `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    let dueAtMs = input.dueAt ? Date.parse(input.dueAt) : NaN;
    if (!Number.isFinite(dueAtMs) && input.at) dueAtMs = Date.parse(input.at);
    if (!Number.isFinite(dueAtMs) && input.inSeconds) dueAtMs = now + Number(input.inSeconds) * 1000;
    if (!Number.isFinite(dueAtMs) && input.delayMs) dueAtMs = now + Number(input.delayMs);
    if (!Number.isFinite(dueAtMs)) dueAtMs = now + 10_000;

    const reminder = {
      id,
      text: String(input.text || input.message || "Reminder"),
      dueAt: new Date(dueAtMs).toISOString(),
      createdAt: existing?.createdAt || new Date(now).toISOString(),
      fired: Boolean(existing?.fired)
    };

    const timeout = setTimeout(() => {
      reminder.fired = true;
      reminder.firedAt = new Date().toISOString();
      setState({
        state: "reminder",
        source: "reminder",
        reminderId: id,
        message: reminder.text,
        autoReturnMs: Number(input.durationMs || 5000),
        returnTo: input.returnTo || "idle"
      });
      emitter.emit("reminder", { ...reminder });
      reminders.set(id, { ...reminder, timeout });
      persistReminders();
    }, Math.max(0, dueAtMs - now));

    reminders.set(id, { ...reminder, timeout });
    return reminder;
  }

  function createReminder(input = {}) {
    const reminder = scheduleReminder(input);
    persistReminders();
    return reminder;
  }

  function listReminders() {
    return [...reminders.values()].map(({ timeout, ...reminder }) => reminder);
  }

  function listHistory() {
    return history.map((item) => ({ ...item }));
  }

  function restoreReminders() {
    if (!remindersPath || !fs.existsSync(remindersPath)) return;
    let parsed = [];
    try {
      parsed = JSON.parse(fs.readFileSync(remindersPath, "utf8"));
    } catch (error) {
      console.warn(`[spine-companion] Ignoring invalid reminders file: ${remindersPath}`, error);
      return;
    }
    for (const reminder of Array.isArray(parsed) ? parsed : []) {
      if (!reminder.fired) scheduleReminder(reminder, reminder);
      else reminders.set(reminder.id, { ...reminder, timeout: null });
    }
  }

  restoreReminders();
  recordHistory(current);

  function destroy() {
    clearAutoReturnTimers();
    if (idleTimer) clearTimeout(idleTimer);
    for (const { timeout } of reminders.values()) clearTimeout(timeout);
    reminders.clear();
    emitter.removeAllListeners();
  }

  return {
    emitter,
    snapshot,
    setState,
    createReminder,
    listReminders,
    listHistory,
    normalizeStateId,
    destroy
  };
}

module.exports = { createStateStore, createStateMachine };
