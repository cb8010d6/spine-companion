/**
 * Shared state store extracted from the local API server so it can be tested
 * independently and reused by standalone tooling.
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
  const MAX_TIMEOUT_MS = 0x7fffffff;
  const MAX_REMINDERS = 128;
  const historyLimit = Number(config.state?.historyLimit || 50);
  const history = [];
  const remindersPath = config.state?.remindersPath || "";
  const idleTimeoutMs = Number(config.state?.idleTimeoutMs || 0);
  let idleTimer = null;
  let stateGeneration = 0;
  let reminderGeneration = 0;
  let overlay = null;
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

  function cloneState(state) {
    return state ? { ...state } : null;
  }

  function scheduleAt(deadlineMs, callback) {
    let timer = null;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        timer = null;
        callback();
        return;
      }
      timer = setTimeout(tick, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    tick();
    return {
      cancel() {
        cancelled = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
      }
    };
  }

  function applyState(input = {}, { isOverlay = false } = {}) {
    clearAutoReturnTimers();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    const previous = current;
    const requested = input.state || input.id || input.status;
    const nextState = requested ? normalizeStateId(requested) : previous.state;
    const direction = nextState === "running" ? (input.direction || previous.direction || "right") : "right";
    const hasMessage = Object.prototype.hasOwnProperty.call(input, "message");
    const message = hasMessage
      ? String(input.message || "")
      : (input.preserveMessage === true || !requested ? previous.message || "" : "");
    if (isOverlay) {
      overlay = overlay || cloneState(previous);
    } else if (nextState !== "reminder" || requested) {
      overlay = null;
    }
    stateGeneration += 1;
    current = {
      ...previous,
      ...input,
      state: nextState,
      id: nextState,
      message,
      direction,
      updatedAt: new Date().toISOString(),
      source: input.source || previous.source || "local"
    };
    delete current.status;
    delete current.preserveMessage;
    for (const key of ["reminderId", "autoReturnMs", "returnTo", "durationMs", "delayMs", "inSeconds", "dueAt", "at", "notify"]) {
      if (!(key in input)) delete current[key];
    }
    emitter.emit("state", snapshot());
    recordHistory(current);

    const autoReturnMs = input.autoReturnMs === undefined ? 0 : Number(input.autoReturnMs);
    if (autoReturnMs > 0) {
      const stateAtSchedule = current.updatedAt;
      const generationAtSchedule = stateGeneration;
      const timer = setTimeout(() => {
        autoReturnTimers.delete(timer);
        if (stateGeneration !== generationAtSchedule || current.updatedAt !== stateAtSchedule) return;
        if (isOverlay && current.state === "reminder" && overlay) {
          const underlying = overlay;
          overlay = null;
          const hasActiveTask = underlying.state !== "idle"
            || underlying.source !== "system"
            || Boolean(underlying.message);
          const returnState = input.returnTo && !hasActiveTask
            ? normalizeStateId(input.returnTo)
            : normalizeStateId(underlying.state);
          applyState({
            ...underlying,
            state: returnState,
            id: returnState,
            direction: returnState === "running" ? underlying.direction || "right" : "right",
            message: underlying.message || ""
          });
          return;
        }
        applyState({
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

  function setState(input = {}) {
    return applyState(input);
  }

  function scheduleReminder(input = {}, existing = null) {
    const id = input.id || `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    let dueAtMs = input.dueAt !== undefined ? Date.parse(input.dueAt) : NaN;
    if (!Number.isFinite(dueAtMs) && input.at !== undefined) dueAtMs = Date.parse(input.at);
    if (!Number.isFinite(dueAtMs) && input.inSeconds !== undefined) {
      const seconds = Number(input.inSeconds);
      if (Number.isFinite(seconds) && seconds >= 0) dueAtMs = now + seconds * 1000;
    }
    if (!Number.isFinite(dueAtMs) && input.delayMs !== undefined) {
      const delay = Number(input.delayMs);
      if (Number.isFinite(delay) && delay >= 0) dueAtMs = now + delay;
    }
    if (!Number.isFinite(dueAtMs)) dueAtMs = now + 10_000;

    const existingEntry = reminders.get(id);
    if (!existingEntry && reminders.size >= MAX_REMINDERS) {
      throw new Error(`Reminder limit reached (${MAX_REMINDERS}).`);
    }
    const replacingFired = existingEntry?.fired === true;

    const reminder = {
      id,
      text: String(input.text || input.message || "Reminder"),
      dueAt: new Date(dueAtMs).toISOString(),
      createdAt: existing?.createdAt || new Date(now).toISOString(),
      fired: Boolean(existing?.fired),
      snoozeAfterMs: input.snoozeAfterMs === undefined
        ? Number(existing?.snoozeAfterMs || 5 * 60 * 1000)
        : Number(input.snoozeAfterMs)
    };

    if (existingEntry?.timeout) existingEntry.timeout.cancel();
    const generation = ++reminderGeneration;
    const entry = { ...reminder, generation, timeout: null };
    reminders.set(id, entry);
    if (replacingFired
      && current.state === "reminder"
      && current.source === "reminder"
      && current.reminderId === id
      && overlay) {
      const underlying = overlay;
      overlay = null;
      applyState({
        ...underlying,
        state: normalizeStateId(underlying.state),
        id: normalizeStateId(underlying.state),
        direction: underlying.state === "running" ? underlying.direction || "right" : "right",
        message: underlying.message || ""
      });
    }
    entry.timeout = scheduleAt(dueAtMs, () => {
      const active = reminders.get(id);
      if (active !== entry || active.generation !== generation || active.fired) return;
      active.fired = true;
      active.firedAt = new Date().toISOString();
      applyState({
        state: "reminder",
        source: "reminder",
        reminderId: id,
        message: active.text,
        autoReturnMs: input.durationMs === undefined ? 5000 : Number(input.durationMs),
        ...(input.returnTo === undefined ? {} : { returnTo: input.returnTo })
      }, { isOverlay: true });
      emitter.emit("reminder", { ...active });
      persistReminders();
      emitter.emit("reminders", listReminders());
    });
    return reminder;
  }

  function createReminder(input = {}) {
    const reminder = scheduleReminder(input);
    persistReminders();
    emitter.emit("reminders", listReminders());
    return reminder;
  }

  function listReminders() {
    return [...reminders.values()].map(({ timeout, generation, ...reminder }) => reminder);
  }

  function deleteReminder(id) {
    const reminder = reminders.get(id);
    if (!reminder) return false;
    if (reminder.timeout) reminder.timeout.cancel();
    reminders.delete(id);
    persistReminders();
    emitter.emit("reminders", listReminders());
    return true;
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
    for (const { timeout } of reminders.values()) timeout?.cancel();
    reminders.clear();
    emitter.removeAllListeners();
  }

  return {
    emitter,
    snapshot,
    setState,
    createReminder,
    listReminders,
    deleteReminder,
    listHistory,
    normalizeStateId,
    destroy
  };
}

module.exports = { createStateStore, createStateMachine };
