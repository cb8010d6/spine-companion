import { h } from "./lib/dom.js";

export const DEFAULT_SESSION_STALE_AFTER_MS = 5 * 60 * 1000;
export const SESSION_REFRESH_COALESCE_MS = 80;
export const SESSION_STALE_TICK_MS = 30 * 1000;

const trim = (value) => String(value ?? "").trim();
const sourceKey = (value) => trim(value).toLowerCase() || "local";
const timestamp = (value) => {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeSession(session = {}) {
  const sessionId = trim(session.sessionId);
  return {
    source: trim(session.source),
    sourceLabel: trim(session.sourceLabel),
    ...(sessionId ? { sessionId } : {}),
    state: trim(session.state) || "idle",
    message: trim(session.message),
    updatedAt: trim(session.updatedAt),
    stale: session.stale === true,
    ended: session.ended === true,
    granularity: session.granularity === "session" ? "session" : "source"
  };
}

export function normalizeSessionList(value = {}) {
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.slice(0, 64).map(normalizeSession)
    : [];
  const staleAfterMs = Number(value.staleAfterMs);
  const revision = Number(value.revision);
  const focused = value.focused && typeof value.focused === "object"
    ? { source: trim(value.focused.source), ...(trim(value.focused.sessionId) ? { sessionId: trim(value.focused.sessionId) } : {}) }
    : null;
  return {
    sessions,
    focused,
    staleAfterMs: Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : DEFAULT_SESSION_STALE_AFTER_MS,
    ...(Number.isFinite(revision) && revision >= 0 ? { revision } : {})
  };
}

export function sessionKey(session = {}) {
  return JSON.stringify([sourceKey(session.source), trim(session.sessionId) || null]);
}

export function sessionIsStale(session = {}, now = Date.now(), staleAfterMs = DEFAULT_SESSION_STALE_AFTER_MS) {
  if (session.stale === true) return true;
  const updatedAt = timestamp(session.updatedAt);
  const threshold = Number(staleAfterMs);
  return Boolean(updatedAt && Number.isFinite(Number(now)) && Number.isFinite(threshold) && threshold > 0
    && Number(now) - updatedAt > threshold);
}

export function formatSessionTime(value, locale = "en", now = Date.now()) {
  const parsed = timestamp(value);
  if (!parsed) return trim(value);
  try {
    const date = new Date(parsed);
    const sameDay = date.toDateString() === new Date(Number(now)).toDateString();
    return new Intl.DateTimeFormat(locale || "en", sameDay
      ? { timeStyle: "short" }
      : { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return new Date(parsed).toISOString();
  }
}

function label(labels, key, fallback, ...args) {
  const value = labels?.[key];
  return typeof value === "function" ? value(...args) : value ?? fallback;
}

export function renderSessionList(snapshot = {}, options = {}) {
  const normalized = normalizeSessionList(snapshot);
  const labels = options.labels || {};
  const now = options.now ?? Date.now();
  const locale = options.locale || "en";
  const root = h("div", {
    class: "session-list",
    role: "list",
    "aria-label": label(labels, "title", "Sessions"),
    dataset: { staleAfterMs: normalized.staleAfterMs }
  });
  if (!normalized.sessions.length) {
    root.appendChild(h("p", { class: "empty-text session-empty" }, label(labels, "empty", "No active AI sessions")));
    return root;
  }
  for (const session of normalized.sessions) {
    const stale = sessionIsStale(session, now, normalized.staleAfterMs);
    const focused = sessionKey(session) === sessionKey(normalized.focused || {});
    const sourceLabel = session.sourceLabel || session.source || label(labels, "automatic", "Automatic");
    const stateLabel = label(labels, "state", session.state, session.state);
    const message = session.message || stateLabel;
    const time = session.updatedAt
      ? formatSessionTime(session.updatedAt, locale, now)
      : label(labels, "unknownTime", "Time unavailable");
    const grouped = session.granularity === "source";
    const groupedText = label(labels, "grouped", "Grouped by tool");
    const staleText = label(labels, "stale", "May be out of date");
    const endedText = label(labels, "ended", "Ended");
    const focusedText = label(labels, "focused", "Focused");
    const selection = { source: session.source || null, ...(session.sessionId ? { sessionId: session.sessionId } : {}) };
    root.appendChild(h("button", {
      class: `session-row${focused ? " active" : ""}${stale ? " stale" : ""}`,
      type: "button",
      role: "listitem",
      "aria-label": [sourceLabel, grouped ? groupedText : "", stateLabel, message, time, stale ? staleText : "", session.ended ? endedText : ""].filter(Boolean).join(" · "),
      "aria-pressed": String(focused),
      title: focused ? focusedText : label(labels, "focus", "Focus"),
      dataset: { sessionKey: sessionKey(session), source: session.source, granularity: session.granularity },
      onClick: () => options.onFocus?.(selection, session)
    },
      h("span", { class: "session-row-copy" },
        h("span", { class: "session-row-source" }, sourceLabel),
        session.sessionId ? h("span", { class: "session-row-id" }, session.sessionId) : null,
        grouped ? h("span", { class: "session-row-granularity" }, groupedText) : null,
        h("span", { class: "session-row-message" }, message)
      ),
      h("span", { class: "session-row-meta" },
        h("span", { class: "session-row-state" }, stateLabel),
        h("span", { class: "session-row-time" }, time),
        stale ? h("span", { class: "session-row-stale", role: "status" }, staleText) : null,
        session.ended ? h("span", { class: "session-row-ended" }, endedText) : null,
        focused ? h("span", { class: "session-row-focused" }, focusedText) : null
      )
    ));
  }
  return root;
}

export function createSessionController({
  getBridge,
  onChange = () => {},
  timers = globalThis,
  clock = () => Date.now(),
  refreshDelayMs = SESSION_REFRESH_COALESCE_MS,
  staleTickMs = SESSION_STALE_TICK_MS
} = {}) {
  let snapshot = normalizeSessionList();
  let visible = false;
  let requestRevision = 0;
  let refreshTimer = 0;
  let staleTimer = 0;
  const bridge = () => (typeof getBridge === "function" ? getBridge() : null);
  const clear = (id) => id && (timers.clearTimeout || clearTimeout)(id);
  const emit = (reason, error = null) => onChange(snapshot, { reason, error, now: clock() });
  const scheduleStaleTick = () => {
    clear(staleTimer);
    if (!visible || staleTickMs <= 0) return;
    staleTimer = (timers.setTimeout || setTimeout)(() => {
      staleTimer = 0;
      if (!visible) return;
      emit("stale-tick");
      scheduleStaleTick();
    }, staleTickMs);
  };
  async function refresh() {
    const revision = ++requestRevision;
    const api = bridge();
    if (typeof api?.listSessions !== "function") {
      if (revision === requestRevision) emit("unavailable");
      return snapshot;
    }
    try {
      const result = await api.listSessions();
      if (revision !== requestRevision) return snapshot;
      snapshot = normalizeSessionList(result);
      emit("refresh");
    } catch (error) {
      if (revision !== requestRevision) return snapshot;
      snapshot = { ...snapshot, error: error?.message || String(error) };
      emit("error", error);
    }
    return snapshot;
  }
  function scheduleRefresh() {
    if (!visible) return;
    clear(refreshTimer);
    refreshTimer = (timers.setTimeout || setTimeout)(() => {
      refreshTimer = 0;
      refresh();
    }, refreshDelayMs);
  }
  async function enter() {
    if (visible) return snapshot;
    visible = true;
    scheduleStaleTick();
    return refresh();
  }
  function leave() {
    visible = false;
    requestRevision += 1;
    clear(refreshTimer);
    clear(staleTimer);
    refreshTimer = 0;
    staleTimer = 0;
  }
  function notifyState(state = {}) {
    if (!visible) return;
    const incomingRevision = Number(state.revision);
    const currentRevision = Number(snapshot.revision);
    if (Number.isFinite(incomingRevision) && Number.isFinite(currentRevision) && incomingRevision <= currentRevision) return;
    scheduleRefresh();
  }
  async function focus(selection = {}) {
    const api = bridge();
    if (typeof api?.focusSession !== "function") return null;
    const payload = { source: selection.source ?? null };
    if (trim(selection.sessionId)) payload.sessionId = trim(selection.sessionId);
    const result = await api.focusSession(payload);
    if (visible) await refresh();
    return result;
  }
  return { enter, leave, refresh, scheduleRefresh, notifyState, focus, getSnapshot: () => snapshot, dispose: leave };
}
