/**
 * Shared state store extracted from the local API server so it can be tested
 * independently and reused by standalone tooling.
 *
 * The store keeps the state shown by the companion separate from the latest
 * live AI state. This is important for short-lived reminder/demo displays:
 * reports may arrive while the display is covered and must still be restored
 * when the temporary display ends.
 */
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { isAiSource, sourceDisplayName } = require("./source-registry.cjs");

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_LIMIT = 64;
const DEFAULT_EVENT_ID_LIMIT = 128;
const MAX_REMINDERS = 128;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 128;
const MAX_LABEL_BYTES = 128;
const MAX_SESSION_ID_BYTES = 128;
const MAX_EVENT_ID_BYTES = 128;
const MAX_MESSAGE_BYTES = 8 * 1024;
const ENDED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const REPORT_EVENT_KINDS = new Set(["report"]);
const DISPLAY_EVENT_KINDS = new Set(["demo", "self-test"]);
const INTERNAL_SOURCES = new Set(["system", "local", "tray", "reminder", "auto-return", "idle-timeout", "renderer"]);

function createStateMachine(stateMachineConfig = {}) {
  const allowedStates = new Set(Array.isArray(stateMachineConfig.states) ? stateMachineConfig.states : []);
  const aliases = stateMachineConfig.aliases || {};

  function normalizeStateId(value) {
    const raw = String(value || "").trim().toLowerCase();
    const normalized = aliases[raw] || raw;
    return allowedStates.has(normalized) ? normalized : "idle";
  }

  return { allowedStates, normalizeStateId };
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function clone(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = clone(item);
  return output;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function optionalText(value) {
  const result = text(value).trim();
  return result || undefined;
}

function normalizeSource(value) {
  return optionalText(value)?.toLowerCase();
}

function normalizeEventKind(value) {
  const result = optionalText(value)?.toLowerCase();
  return result && (REPORT_EVENT_KINDS.has(result) || DISPLAY_EVENT_KINDS.has(result)) ? result : "";
}

function finiteNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function byteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function validateStateInput(input) {
  const stringLimits = [
    ["source", MAX_SOURCE_BYTES, true],
    ["sourceLabel", MAX_LABEL_BYTES, true],
    ["sessionId", MAX_SESSION_ID_BYTES, true],
    ["eventId", MAX_EVENT_ID_BYTES, true],
    ["message", MAX_MESSAGE_BYTES, false],
    ["returnTo", 32, true],
    ["direction", 16, true]
  ];
  for (const [key, limit, nonEmpty] of stringLimits) {
    if (!own(input, key) || input[key] === null || input[key] === undefined) continue;
    if (typeof input[key] !== "string") throw new Error(`${key} must be a string`);
    if (nonEmpty && !input[key].trim()) throw new Error(`${key} must not be empty`);
    if (byteLength(input[key]) > limit) throw new Error(`${key} exceeds the ${limit} byte limit`);
    if (input[key].includes("\0")) throw new Error(`${key} contains a NUL byte`);
  }
  for (const key of ["state", "id", "status"]) {
    if (own(input, key) && input[key] !== null && input[key] !== undefined && typeof input[key] !== "string") {
      throw new Error(`${key} must be a string`);
    }
  }
  if (own(input, "sequence") && input.sequence !== null && input.sequence !== undefined
    && finiteNonNegativeInteger(input.sequence) === null) {
    throw new Error("sequence must be a non-negative safe integer");
  }
  for (const key of ["notify", "sessionEnded"]) {
    if (own(input, key) && input[key] !== null && input[key] !== undefined && typeof input[key] !== "boolean") {
      throw new Error(`${key} must be a boolean`);
    }
  }
  if (own(input, "eventKind") && input.eventKind !== null && input.eventKind !== undefined) {
    if (typeof input.eventKind !== "string" || !["report", "demo", "self-test"].includes(input.eventKind.trim().toLowerCase())) {
      throw new Error("eventKind must be report, demo, or self-test");
    }
  }
  if (own(input, "autoReturnMs") && input.autoReturnMs !== null && input.autoReturnMs !== undefined
    && (!Number.isSafeInteger(input.autoReturnMs) || input.autoReturnMs < 0 || input.autoReturnMs > MAX_DELAY_MS)) {
    throw new Error(`autoReturnMs exceeds the ${MAX_DELAY_MS}ms limit`);
  }
  if (own(input, "updatedAt") && input.updatedAt !== null && input.updatedAt !== undefined) {
    if (typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt))) {
      throw new Error("updatedAt must be an RFC3339 timestamp");
    }
  }
}

function createStateStore(config = {}, stateMachineConfig = {}) {
  const { normalizeStateId } = createStateMachine(stateMachineConfig);
  const emitter = new EventEmitter();
  const reminders = new Map();
  const autoReturnTimers = new Set();
  const sessions = new Map();
  const historyLimit = Math.max(1, Number(config.state?.historyLimit || 50));
  const history = [];
  const remindersPath = config.state?.remindersPath || "";
  const idleTimeoutMs = Math.max(0, Number(config.state?.idleTimeoutMs || 0));
  const staleAfterMs = Math.max(1, Number(config.state?.staleAfterMs || DEFAULT_STALE_AFTER_MS));
  const configuredSessionLimit = Number(config.state?.maxSessions ?? DEFAULT_SESSION_LIMIT);
  const sessionLimit = Math.min(
    DEFAULT_SESSION_LIMIT,
    Math.max(1, Number.isFinite(configuredSessionLimit) ? Math.floor(configuredSessionLimit) : DEFAULT_SESSION_LIMIT)
  );
  const configuredEventIdLimit = Number(config.state?.eventIdLimit ?? DEFAULT_EVENT_ID_LIMIT);
  const eventIdLimit = Math.min(
    DEFAULT_EVENT_ID_LIMIT,
    Math.max(1, Number.isFinite(configuredEventIdLimit) ? Math.floor(configuredEventIdLimit) : DEFAULT_EVENT_ID_LIMIT)
  );

  let idleTimer = null;
  let displayGeneration = 0;
  let displayOverlay = null;
  let focused = null;
  let latestReport = null;
  let liveReportState = null;
  let destroyed = false;
  let revision = 0;
  let sessionOrder = 0;

  let current = {
    state: normalizeStateId(config.state?.initial || "idle"),
    message: "",
    source: "system",
    direction: "right",
    updatedAt: new Date().toISOString(),
    revision
  };
  current.id = current.state;
  let businessState = clone(current);

  function snapshot() {
    const result = clone(current);
    delete result.lastReport;
    return result;
  }

  function getLastReport() {
    return clone(latestReport);
  }

  function persistReminders() {
    if (!remindersPath) return;
    const serializable = listReminders();
    fs.mkdirSync(path.dirname(remindersPath), { recursive: true });
    fs.writeFileSync(remindersPath, `${JSON.stringify(serializable, null, 2)}\n`);
  }

  function snapshotOf(state) {
    const result = clone(state);
    delete result.lastReport;
    return result;
  }

  function recordHistory(state) {
    history.push(snapshotOf(state));
    while (history.length > historyLimit) history.shift();
  }

  function emitState(lastReport = null, shouldRecord = true) {
    const value = snapshot();
    if (shouldRecord) recordHistory(value);
    const event = lastReport ? { ...value, lastReport: clone(lastReport) } : value;
    emitter.emit("state", event);
    return event;
  }

  function nextRevision() {
    revision += 1;
    current.revision = revision;
    return revision;
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearAutoReturnTimers() {
    for (const timer of autoReturnTimers) clearTimeout(timer);
    autoReturnTimers.clear();
  }

  function isInternalSource(source) {
    return INTERNAL_SOURCES.has(text(source).trim().toLowerCase());
  }

  function isLegacySelfTest(input, source) {
    const normalizedSource = text(source).trim().toLowerCase();
    const message = text(input?.message).trim().toLowerCase();
    return normalizedSource.includes("self-test")
      || normalizedSource.includes("self_test")
      || message.startsWith("[spine companion self-test]")
      || message.startsWith("[spine companion self test]");
  }

  function isRealReport(input, source, eventKind) {
    if (eventKind === "demo" || eventKind === "self-test" || isLegacySelfTest(input, source)) return false;
    if (eventKind === "report") return !isInternalSource(source) && isAiSource(source);
    if (eventKind) return false;
    return !isInternalSource(source) && isAiSource(source);
  }

  function reportKey(source, sessionId) {
    return sessionId === undefined ? `source:${source}` : `session:${source}\u0000${sessionId}`;
  }

  function normalizeReportIdentity(input, fallbackSource) {
    const source = own(input, "source") ? normalizeSource(input.source) : normalizeSource(fallbackSource);
    const resolvedSource = source || "local";
    const sessionId = own(input, "sessionId") ? optionalText(input.sessionId) : undefined;
    const eventId = own(input, "eventId") ? optionalText(input.eventId) : undefined;
    const sequence = own(input, "sequence") ? finiteNonNegativeInteger(input.sequence) : null;
    return { source: resolvedSource, sessionId, eventId, sequence, key: reportKey(resolvedSource, sessionId) };
  }

  function sessionRecordToState(record) {
    if (!record) return null;
    const value = {
      state: record.state,
      id: record.state,
      message: record.message || "",
      source: record.source,
      direction: record.state === "running" ? (record.direction || "right") : "right",
      updatedAt: record.updatedAt,
      revision
    };
    for (const key of ["sourceLabel", "sessionId", "eventId", "sequence", "sessionEnded", "eventKind", "notify"]) {
      if (record[key] !== undefined) value[key] = clone(record[key]);
    }
    return value;
  }

  function clearDisplayReportMetadata(value, { preserveSession = true } = {}) {
    const result = clone(value || {});
    delete result.lastReport;
    delete result.eventId;
    delete result.sequence;
    delete result.sessionEnded;
    delete result.eventKind;
    if (!preserveSession) delete result.sessionId;
    delete result.reminderId;
    delete result.autoReturnMs;
    delete result.returnTo;
    result.notify = false;
    return result;
  }

  function recordIsFinished(record) {
    return Boolean(record?.ended) || record?.state === "success" || record?.state === "failed";
  }

  function sessionPriority(record) {
    if (recordIsFinished(record)) return 0;
    if (record.state === "waiting") return 3;
    return ["working", "reviewing", "running"].includes(record.state) ? 2 : 1;
  }

  function findFocusedRecord() {
    if (!focused) return null;
    const direct = sessions.get(reportKey(focused.source, focused.sessionId));
    if (direct || focused.sessionId !== undefined) return direct || null;
    return [...sessions.values()]
      .filter((record) => record.source === focused.source)
      .sort((a, b) => {
        const updatedDifference = Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "");
        return updatedDifference || ((b.order || 0) - (a.order || 0));
      })[0] || null;
  }

  function cleanEndedSessions() {
    const now = Date.now();
    for (const [key, record] of sessions) {
      const updatedAtMs = Date.parse(record.updatedAt || "");
      if (!Number.isFinite(updatedAtMs)) continue;
      // Keep stale sessions available for inspection, but release all dormant
      // records after the same 24-hour retention window as the Rust runtime.
      const isFocused = focused && key === reportKey(focused.source, focused.sessionId);
      if (!isFocused && now - updatedAtMs > ENDED_SESSION_RETENTION_MS) sessions.delete(key);
    }
    if (focused && !findFocusedRecord()) focused = null;
  }

  function makeSessionRoom(key) {
    cleanEndedSessions();
    if (sessions.has(key)) return;
    while (sessions.size >= sessionLimit) {
      const candidates = [...sessions.entries()]
        .filter(([key, record]) => recordIsFinished(record)
          && (!focused || key !== reportKey(focused.source, focused.sessionId)))
        .sort(([, a], [, b]) => {
          return Date.parse(a.updatedAt || "") - Date.parse(b.updatedAt || "") || a.order - b.order;
        });
      if (!candidates.length) throw new Error("Session limit reached; end an existing session before reporting a new one.");
      sessions.delete(candidates[0][0]);
    }
  }

  function selectAutomaticRecord() {
    cleanEndedSessions();
    const values = [...sessions.values()];
    values.sort((a, b) => {
      const priority = sessionPriority(b) - sessionPriority(a);
      if (priority) return priority;
      const updatedDifference = Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "");
      return updatedDifference || ((b.order || 0) - (a.order || 0));
    });
    return values[0] || null;
  }

  function effectiveBusinessState() {
    const focusedRecord = findFocusedRecord();
    if (focused && focusedRecord) return sessionRecordToState(focusedRecord);
    if (!focused) {
      const automatic = selectAutomaticRecord();
      if (automatic) return sessionRecordToState(automatic);
    }
    return clone(liveReportState || businessState);
  }

  function buildState(input, base, options = {}) {
    const requested = input.state || input.id || input.status;
    const nextState = requested ? normalizeStateId(requested) : base.state;
    const direction = nextState === "running"
      ? (input.direction || base.direction || "right")
      : "right";
    const hasMessage = own(input, "message");
    const message = hasMessage
      ? text(input.message)
      : (requested
        ? (input.preserveMessage === true ? base.message || "" : "")
        : base.message || "");
    const source = own(input, "source") ? (normalizeSource(input.source) || base.source || "local") : (base.source || "local");
    const value = {
      ...snapshotOf(base),
      state: nextState,
      id: nextState,
      message,
      direction,
      source,
      updatedAt: options.updatedAt || new Date().toISOString()
    };

    const optionalKeys = [
      "sourceLabel", "sessionId", "eventId", "sequence", "sessionEnded", "eventKind",
      "reminderId", "autoReturnMs", "returnTo", "notify"
    ];
    for (const key of optionalKeys) {
      if (own(input, key)) {
        if (key === "sourceLabel" || key === "sessionId" || key === "eventId") {
          const normalized = optionalText(input[key]);
          if (normalized !== undefined) value[key] = normalized;
          else delete value[key];
        } else if (key === "sequence") {
          const sequence = finiteNonNegativeInteger(input[key]);
          if (sequence !== null) value[key] = sequence;
          else delete value[key];
        } else if (key === "eventKind") {
          const eventKind = normalizeEventKind(input[key]);
          if (eventKind) value[key] = eventKind;
          else delete value[key];
        } else {
          value[key] = clone(input[key]);
        }
      } else if (key === "sourceLabel"
        && base.sourceLabel !== undefined
        && normalizeSource(base.source) === source) {
        value.sourceLabel = clone(base.sourceLabel);
      } else if (requested || options.clearOptional) {
        delete value[key];
      }
    }
    if (options.eventKind) value.eventKind = options.eventKind;
    if (options.sessionEnded === true) value.sessionEnded = true;
    delete value.lastReport;
    delete value.revision;
    return value;
  }

  function commitDisplay(next, lastReport = null, options = {}) {
    current = {
      ...snapshotOf(next),
      revision: nextRevision()
    };
    return emitState(lastReport, options.record !== false);
  }

  function bumpDisplayWithoutChangingFields(lastReport = null) {
    current = { ...snapshotOf(current), revision: nextRevision() };
    return emitState(lastReport);
  }

  function cancelDisplayOverlay() {
    displayGeneration += 1;
    if (displayOverlay?.timer) {
      clearTimeout(displayOverlay.timer);
      autoReturnTimers.delete(displayOverlay.timer);
    }
    displayOverlay = null;
  }

  function restoreOverlay(generation) {
    if (destroyed || !displayOverlay || displayOverlay.generation !== generation) return null;
    const overlay = displayOverlay;
    displayOverlay = null;
    if (overlay.timer) autoReturnTimers.delete(overlay.timer);
    const restored = overlay.restore ? overlay.restore() : effectiveBusinessState();
    const next = restored || {
      state: "idle",
      id: "idle",
      message: "",
      source: "system",
      direction: "right",
      updatedAt: new Date().toISOString()
    };
    const value = clearDisplayReportMetadata(buildState({}, next, { clearOptional: true }));
    value.source = next.source || "system";
    value.message = next.message || "";
    value.state = normalizeStateId(next.state || "idle");
    value.id = value.state;
    value.direction = value.state === "running" ? (next.direction || "right") : "right";
    value.updatedAt = next.updatedAt;
    if (next.sourceLabel !== undefined) value.sourceLabel = next.sourceLabel;
    else delete value.sourceLabel;
    if (next.sessionId !== undefined) value.sessionId = clone(next.sessionId);
    else delete value.sessionId;
    delete value.reminderId;
    delete value.autoReturnMs;
    delete value.returnTo;
    clearIdleTimer();
    const result = commitDisplay(value);
    scheduleIdleTimer();
    return result;
  }

  function showTemporary(next, durationMs, restore, options = {}) {
    cancelDisplayOverlay();
    clearIdleTimer();
    const generation = ++displayGeneration;
    const value = buildState(next, current, { clearOptional: true });
    const result = commitDisplay(value);
    const timeoutMs = Math.max(0, Number(durationMs || 0));
    if (timeoutMs > 0) {
      const timer = setTimeout(() => {
        if (!displayOverlay || displayOverlay.generation !== generation) return;
        restoreOverlay(generation);
      }, timeoutMs);
      autoReturnTimers.add(timer);
      displayOverlay = { generation, timer, restore, kind: options.kind || "temporary", reminderId: options.reminderId };
    } else {
      displayOverlay = { generation, timer: null, restore, kind: options.kind || "temporary", reminderId: options.reminderId };
    }
    return result;
  }

  function scheduleIdleTimer() {
    clearIdleTimer();
    if (!idleTimeoutMs || displayOverlay || current.state === "sleeping") return;
    // A stale AI report is informational; inactivity must not invent a new AI
    // outcome. Local/manual state keeps the historical idle-timeout behavior.
    if (isAiSource(liveReportState?.source || current.source)
      || liveReportState?.eventKind === "report"
      || current.eventKind === "demo"
      || current.eventKind === "self-test") return;
    const expectedRevision = current.revision;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (destroyed || displayOverlay || current.revision !== expectedRevision) return;
      setState({ state: "sleeping", source: "idle-timeout", message: "Idle timeout" });
    }, idleTimeoutMs);
  }

  function updateSession(input, identity, reportState, now) {
    cleanEndedSessions();
    const previous = sessions.get(identity.key);
    if (previous?.ended) return { accepted: false, record: previous };
    if (identity.eventId && previous?.eventIds?.includes(identity.eventId)) {
      return { accepted: false, record: previous };
    }
    if (identity.sequence !== null
      && previous?.lastSequence !== undefined
      && identity.sequence <= previous.lastSequence) {
      return { accepted: false, record: previous };
    }

    const record = previous || {
      source: identity.source,
      sessionId: identity.sessionId,
      granularity: identity.sessionId === undefined ? "source" : "session",
      state: reportState.state,
      message: reportState.message || "",
      updatedAt: now,
      ended: false,
      eventIds: []
    };
    record.source = identity.source;
    if (identity.sessionId !== undefined) record.sessionId = identity.sessionId;
    record.state = reportState.state;
    record.message = reportState.message || "";
    record.direction = reportState.direction || "right";
    record.updatedAt = now;
    record.order = ++sessionOrder;
    record.ended = Boolean(record.ended || input.sessionEnded === true);
    if (record.ended && !record.endedAt) record.endedAt = Date.now();
    if (own(input, "sessionEnded") && input.sessionEnded !== undefined && input.sessionEnded !== null) {
      record.sessionEnded = Boolean(input.sessionEnded);
    } else {
      delete record.sessionEnded;
    }
    if (reportState.sourceLabel !== undefined) record.sourceLabel = reportState.sourceLabel;
    else delete record.sourceLabel;
    if (identity.eventId) {
      record.eventIds.push(identity.eventId);
      while (record.eventIds.length > eventIdLimit) record.eventIds.shift();
      record.eventId = identity.eventId;
    } else {
      delete record.eventId;
    }
    if (identity.sequence !== null) {
      record.sequence = identity.sequence;
      record.lastSequence = identity.sequence;
    } else {
      delete record.sequence;
    }
    record.eventKind = "report";
    if (reportState.notify !== undefined) record.notify = reportState.notify;
    else delete record.notify;
    sessions.set(identity.key, record);
    return { accepted: true, record };
  }

  function makeLastReport(input, reportState, identity, now) {
    const value = {
      source: identity.source,
      state: reportState.state,
      message: reportState.message || "",
      updatedAt: now,
      eventKind: "report"
    };
    for (const key of ["sourceLabel", "sessionId", "eventId", "sequence", "notify"]) {
      if (reportState[key] !== undefined) value[key] = clone(reportState[key]);
    }
    return value;
  }

  function acceptReport(input, source, eventKind) {
    const identity = normalizeReportIdentity(input, source);
    cleanEndedSessions();
    const keyRecord = sessions.get(identity.key);
    if (keyRecord?.ended) return snapshot();
    if (identity.eventId && keyRecord?.eventIds?.includes(identity.eventId)) return snapshot();
    if (identity.sequence !== null
      && keyRecord?.lastSequence !== undefined
      && identity.sequence <= keyRecord.lastSequence) return snapshot();

    const now = new Date().toISOString();
    makeSessionRoom(identity.key);
    const baseRecordState = keyRecord ? sessionRecordToState(keyRecord)
      : { state: "idle", message: "", source: identity.source, direction: "right" };
    const reportState = buildState(input, baseRecordState, {
      updatedAt: now,
      eventKind: eventKind || "report",
      clearOptional: true
    });
    reportState.source = identity.source;
    reportState.id = reportState.state;
    reportState.eventKind = "report";
    if (identity.sessionId !== undefined) reportState.sessionId = identity.sessionId;
    else delete reportState.sessionId;
    if (identity.eventId !== undefined) reportState.eventId = identity.eventId;
    else delete reportState.eventId;
    if (identity.sequence !== null) reportState.sequence = identity.sequence;
    else delete reportState.sequence;
    if (input.sourceLabel !== undefined) {
      const sourceLabel = optionalText(input.sourceLabel);
      if (sourceLabel !== undefined) reportState.sourceLabel = sourceLabel;
      else delete reportState.sourceLabel;
    } else if (keyRecord?.sourceLabel !== undefined) {
      reportState.sourceLabel = keyRecord.sourceLabel;
    } else {
      const derivedLabel = sourceDisplayName(identity.source);
      if (derivedLabel) reportState.sourceLabel = derivedLabel;
      else delete reportState.sourceLabel;
    }
    if (input.notify !== undefined) reportState.notify = Boolean(input.notify);
    else if (keyRecord?.notify !== undefined) reportState.notify = keyRecord.notify;

    const updated = updateSession(input, identity, reportState, now);
    if (!updated.accepted) return snapshot();

    liveReportState = clone(reportState);
    businessState = clone(effectiveBusinessState());
    latestReport = makeLastReport(input, reportState, identity, now);

    if (displayOverlay) {
      // Keep the reminder/demo visible, but still advance the revision so a
      // stale renderer dismissal cannot win over this accepted report.
      return bumpDisplayWithoutChangingFields(latestReport);
    }

    const focusedRecord = findFocusedRecord();
    const selected = focusedRecord || (!focused ? selectAutomaticRecord() : null);
    const selectedState = selected ? sessionRecordToState(selected) : clone(reportState);
    const result = commitDisplay(selectedState, latestReport);
    scheduleIdleTimer();
    return result;
  }

  function setState(input = {}) {
    if (destroyed) return snapshot();
    const payload = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    validateStateInput(payload);
    const source = own(payload, "source")
      ? (normalizeSource(payload.source) || current.source || "local")
      : (normalizeSource(liveReportState?.source) || current.source || "local");
    const eventKind = normalizeEventKind(payload.eventKind);
    if (isRealReport(payload, source, eventKind)) return acceptReport(payload, source, eventKind);

    clearIdleTimer();
    const previousBusiness = clone(effectiveBusinessState() || businessState || current);
    // A manual/display update must not carry a previous report's event
    // identity into a new state. Report metadata is accepted only through the
    // real-report path above (or explicit values in the new input).
    const next = buildState(payload, current, { clearOptional: true });
    if (eventKind) next.eventKind = eventKind;

    // A newer explicit/manual state supersedes a temporary display. Demo and
    // self-test states are themselves temporary display events when timed.
    if (displayOverlay) cancelDisplayOverlay();

    const isDisplayOnly = DISPLAY_EVENT_KINDS.has(eventKind) || next.state === "reminder";
    const duration = Number(payload.autoReturnMs || 0);
    if (duration > 0) {
      const returnTo = payload.returnTo ? normalizeStateId(payload.returnTo) : null;
      const restore = () => {
        const live = effectiveBusinessState() || previousBusiness;
        if (sessions.has(reportKey(live.source, live.sessionId))) return live;
        if (returnTo) {
          return {
            ...live,
            state: returnTo,
            id: returnTo,
            source: "auto-return",
            message: "",
            direction: returnTo === "running" ? (live.direction || "right") : "right"
          };
        }
        // Legacy manual auto-return uses the auto-return source, while a live
        // AI task keeps its source/message when a reminder is dismissed.
        if (isDisplayOnly && next.state === "reminder" && liveReportState) return live;
        return { ...live, source: "auto-return", message: "" };
      };
      if (!isDisplayOnly && next.state !== "reminder") businessState = clone(next);
      return showTemporary(next, duration, restore, { kind: "auto-return" });
    }

    if (!isDisplayOnly) {
      businessState = clone(next);
      if (!DISPLAY_EVENT_KINDS.has(eventKind)) {
        liveReportState = isAiSource(next.source) ? clone(next) : liveReportState;
      }
    }
    const result = commitDisplay(next);
    scheduleIdleTimer();
    return result;
  }

  function scheduleReminder(input = {}, existing = null) {
    if (input && typeof input !== "object") throw new Error("reminder input must be an object");
    const id = optionalText(input.id) || `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    let dueAtMs = input.dueAt ? Date.parse(input.dueAt) : NaN;
    if (!Number.isFinite(dueAtMs) && input.at) dueAtMs = Date.parse(input.at);
    if (!Number.isFinite(dueAtMs) && own(input, "inSeconds") && Number.isFinite(Number(input.inSeconds))) {
      dueAtMs = now + Number(input.inSeconds) * 1000;
    }
    if (!Number.isFinite(dueAtMs) && own(input, "delayMs") && Number.isFinite(Number(input.delayMs))) {
      dueAtMs = now + Number(input.delayMs);
    }
    if (!Number.isFinite(dueAtMs)) dueAtMs = now + 10_000;
    const reminderText = text(input.text || input.message || "Reminder");
    if (byteLength(reminderText) > MAX_MESSAGE_BYTES) throw new Error(`text exceeds the ${MAX_MESSAGE_BYTES} byte limit`);
    if (byteLength(id) > MAX_EVENT_ID_BYTES || id.includes("\0")) throw new Error("id exceeds the 128 byte limit");

    const old = reminders.get(id);
    if (old?.timeout) clearTimeout(old.timeout);
    if (old) reminders.delete(id);
    if (displayOverlay?.reminderId === id) restoreOverlay(displayOverlay.generation);

    const reminder = {
      id,
      text: reminderText,
      dueAt: new Date(dueAtMs).toISOString(),
      createdAt: existing?.createdAt || new Date(now).toISOString(),
      fired: Boolean(existing?.fired),
      snoozeAfterMs: own(input, "snoozeAfterMs")
        ? Math.min(MAX_DELAY_MS, Math.max(0, Number(input.snoozeAfterMs) || 0))
        : Math.min(MAX_DELAY_MS, Math.max(0, Number(existing?.snoozeAfterMs ?? 5 * 60 * 1000) || 0))
    };
    if (existing?.firedAt) reminder.firedAt = existing.firedAt;

    const generation = Symbol(id);
    const record = {
      ...reminder,
      generation,
      durationMs: Math.min(
        MAX_DELAY_MS,
        Math.max(0, Number(own(input, "durationMs") ? input.durationMs : (existing?.durationMs ?? 5000)) || 0)
      ),
      returnTo: input.returnTo || existing?.returnTo
    };
    const fire = () => {
      const currentRecord = reminders.get(id);
      if (destroyed || currentRecord !== record || record.fired) return;
      record.fired = true;
      record.firedAt = new Date().toISOString();
      record.timeout = null;

      const reminderState = {
        state: "reminder",
        source: "reminder",
        message: record.text,
        reminderId: id
      };
      const restore = () => {
        const live = effectiveBusinessState() || businessState || current;
        if (sessions.has(reportKey(live.source, live.sessionId))) return live;
        if (record.returnTo) {
          const state = normalizeStateId(record.returnTo);
          return { ...live, state, id: state, message: "", source: "auto-return" };
        }
        return live;
      };
      showTemporary(reminderState, record.durationMs, restore, { kind: "reminder", reminderId: id });
      emitter.emit("reminder", { ...listReminders().find((item) => item.id === id) });
      persistReminders();
      emitter.emit("reminders", listReminders());
    };
    if (!record.fired) {
      // Capture the bounded deadline before registering the callback so a
      // replacement cannot accidentally inherit a stale timer's due time.
      const delayMs = Math.min(MAX_DELAY_MS, Math.max(0, dueAtMs - now));
      record.timeout = setTimeout(fire, delayMs);
    } else {
      record.timeout = null;
    }
    reminders.set(id, record);
    while (reminders.size > MAX_REMINDERS) {
      const candidate = [...reminders.values()]
        .filter((item) => item.id !== id)
        .sort((a, b) => {
          const aFired = a.fired ? 0 : 1;
          const bFired = b.fired ? 0 : 1;
          if (aFired !== bFired) return aFired - bFired;
          return Date.parse(a.createdAt || "") - Date.parse(b.createdAt || "");
        })[0] || reminders.values().next().value;
      if (!candidate) break;
      if (candidate.timeout) clearTimeout(candidate.timeout);
      reminders.delete(candidate.id);
    }
    return reminder;
  }

  function createReminder(input = {}) {
    const reminder = scheduleReminder(input);
    persistReminders();
    emitter.emit("reminders", listReminders());
    return reminder;
  }

  function listReminders() {
    return [...reminders.values()].map(({ timeout, generation, durationMs, returnTo, ...reminder }) => reminder);
  }

  function deleteReminder(id) {
    const reminder = reminders.get(id);
    if (!reminder) return false;
    if (reminder.timeout) clearTimeout(reminder.timeout);
    reminders.delete(id);
    if (displayOverlay?.reminderId === id) restoreOverlay(displayOverlay.generation);
    persistReminders();
    emitter.emit("reminders", listReminders());
    return true;
  }

  function listHistory() {
    return history.map((item) => clone(item));
  }

  function listSessions() {
    cleanEndedSessions();
    const now = Date.now();
    const sessionValues = [...sessions.values()]
      .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
      .map((record) => {
        const item = {
          source: record.source,
          state: record.state,
          message: record.message || "",
          updatedAt: record.updatedAt,
          stale: now - Date.parse(record.updatedAt || "") > staleAfterMs,
          ended: Boolean(record.ended),
          granularity: record.granularity
        };
        for (const key of ["sourceLabel", "sessionId", "eventId", "sequence"]) {
          if (record[key] !== undefined) item[key] = clone(record[key]);
        }
        return item;
      });
    return {
      sessions: sessionValues,
      focused: focused ? clone(focused) : null,
      staleAfterMs
    };
  }

  function focusSession(input = {}) {
    if (destroyed) return snapshot();
    validateStateInput({ source: input.source, sessionId: input.sessionId });
    const source = own(input, "source") ? normalizeSource(input.source) : undefined;
    if (!source) {
      cancelDisplayOverlay();
      clearIdleTimer();
      focused = null;
      const selected = selectAutomaticRecord();
      const restored = selected ? sessionRecordToState(selected) : effectiveBusinessState();
      const next = restored ? clearDisplayReportMetadata(restored) : current;
      const result = commitDisplay(next || current);
      scheduleIdleTimer();
      return result;
    }

    const sessionId = own(input, "sessionId") ? optionalText(input.sessionId) : undefined;
    let record = sessions.get(reportKey(source, sessionId));
    if (!record && sessionId === undefined) {
      // Source focus may target the newest explicit session when no aggregate
      // record exists. Keep that concrete session in the focused descriptor.
      record = [...sessions.values()]
        .filter((item) => item.source === source)
        .sort((a, b) => {
          const updatedDifference = Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "");
          return updatedDifference || ((b.order || 0) - (a.order || 0));
        })[0];
    }
    if (!record) throw new Error(`Unknown AI session: ${source}${sessionId ? `/${sessionId}` : ""}`);
    cancelDisplayOverlay();
    clearIdleTimer();
    focused = { source, ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}) };
    const next = clearDisplayReportMetadata(sessionRecordToState(record));
    const result = commitDisplay(next);
    scheduleIdleTimer();
    return result;
  }

  function dismissDisplay(expectedRevision) {
    const expected = finiteNonNegativeInteger(expectedRevision);
    if (expected === null || expected !== current.revision) return snapshot();
    if (displayOverlay) {
      const generation = displayOverlay.generation;
      return restoreOverlay(generation) || snapshot();
    }
    if (current.state !== "success" && current.state !== "failed" && current.state !== "reminder") return snapshot();
    if (focused && recordIsFinished(findFocusedRecord())) focused = null;
    const selected = focused ? findFocusedRecord() : selectAutomaticRecord();
    const next = selected && !recordIsFinished(selected)
      ? sessionRecordToState(selected)
      : {
          state: "idle",
          id: "idle",
          message: "",
          source: "system",
          direction: "right",
          notify: false,
          updatedAt: new Date().toISOString()
        };
    const result = commitDisplay(selected ? clearDisplayReportMetadata(next) : next);
    scheduleIdleTimer();
    return result;
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
      if (!reminder || !reminder.id) continue;
      if (!reminder.fired) {
        scheduleReminder(reminder, reminder);
      } else {
        const restored = scheduleReminder(reminder, reminder);
        const stored = reminders.get(restored.id);
        if (stored?.timeout) clearTimeout(stored.timeout);
        if (stored) {
          stored.fired = true;
          stored.firedAt = reminder.firedAt;
          stored.timeout = null;
        }
      }
    }
  }

  restoreReminders();
  recordHistory(current);

  function destroy() {
    destroyed = true;
    clearAutoReturnTimers();
    clearIdleTimer();
    for (const { timeout } of reminders.values()) if (timeout) clearTimeout(timeout);
    reminders.clear();
    sessions.clear();
    displayOverlay = null;
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
    listSessions,
    focusSession,
    dismissDisplay,
    getLastReport,
    lastReport: getLastReport,
    normalizeStateId,
    destroy
  };
}

module.exports = { createStateStore, createStateMachine };
