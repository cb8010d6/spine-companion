const AI_SOURCE_PATTERNS = [
  /^codex(?:-|$)/i,
  /^claude(?:-|$)/i,
  /^cursor(?:-|$)/i,
  /^cline(?:-|$)/i,
  /^roo(?:-|$)/i,
  /^gemini(?:-|$)/i,
  /^antigravity(?:-|$)/i,
  /^local-ai(?:-|$)/i,
  /(?:^|-)mcp$/i
];

const AI_SOURCE_LABELS = [
  [/^codex/i, "Codex"],
  [/^claude/i, "Claude"],
  [/^cursor/i, "Cursor"],
  [/^cline/i, "Cline"],
  [/^roo/i, "Roo"],
  [/^gemini/i, "Gemini"],
  [/^antigravity/i, "Antigravity"],
  [/^local-ai/i, "Local AI"]
];

function normalizeSource(source) {
  return String(source || "").trim().toLowerCase();
}

function isAiSource(source) {
  const normalized = normalizeSource(source);
  return AI_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sourceDisplayName(source) {
  const normalized = normalizeSource(source);
  for (const [pattern, label] of AI_SOURCE_LABELS) {
    if (pattern.test(normalized)) return label;
  }
  if (isAiSource(normalized)) return "AI";
  return source ? String(source) : "Local";
}

function isCompletionState(state) {
  const id = typeof state === "string" ? state : state?.state;
  return id === "success" || id === "failed";
}

function shouldNotifyState(state = {}) {
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
  const source = sourceDisplayName(state.source);
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
