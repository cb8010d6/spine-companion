const {
  isAiSource,
  normalizeSource,
  sourceDisplayName
} = require("./source-registry.cjs");

function isCompletionState(state) {
  const id = typeof state === "string" ? state : state?.state;
  return id === "success" || id === "failed";
}

function shouldNotifyState(state = {}) {
  if (state.notify === false || state.eventKind === "demo" || state.eventKind === "self-test") return false;
  if (state.state === "reminder") return true;
  if (!isCompletionState(state)) return false;
  return state.notify === true || isAiSource(state.source);
}

function defaultMessageForState(id, source) {
  if (!isAiSource(source)) return "";
  const messages = {
    working: "Working on it",
    reviewing: "Reviewing changes",
    running: "Running checks",
    waiting: "Waiting",
    success: "Task complete",
    failed: "Task failed",
    reminder: "Reminder"
  };
  return messages[id] || "";
}

function notificationForState(state = {}) {
  const id = state.state || "idle";
  const source = sourceDisplayName(state.source, state.sourceLabel);
  if (id === "reminder") {
    return {
      kind: "reminder",
      title: "Spine Companion Reminder",
      body: String(state.message || "Reminder"),
      state: id
    };
  }
  if (id === "success") {
    return {
      kind: "completion",
      title: `${source} task complete`,
      body: String(state.message || "Finished successfully"),
      state: id
    };
  }
  if (id === "failed") {
    return {
      kind: "completion",
      title: `${source} task failed`,
      body: String(state.message || "Needs attention"),
      state: id
    };
  }
  return null;
}

module.exports = {
  defaultMessageForState,
  isAiSource,
  isCompletionState,
  notificationForState,
  normalizeSource,
  shouldNotifyState,
  sourceDisplayName
};
