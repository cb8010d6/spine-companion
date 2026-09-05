import { integrationMatchesSource } from "./integration-ui.js";

export function latestCompanionState(liveState, history = []) {
  if (liveState && typeof liveState === "object") return liveState;
  if (!Array.isArray(history) || history.length === 0) return {};
  return history[history.length - 1] || {};
}

export function integrationLabelForState(state = {}, integrations = []) {
  const label = String(state.sourceLabel || "").trim();
  if (label) return label;
  const source = String(state.source || "");
  const match = Array.isArray(integrations)
    ? integrations.find((item) => integrationMatchesSource(item, source))
    : null;
  return match?.sourceLabel || source;
}

export function rendererHealthFromDiagnostics(diagnostics = {}) {
  const renderer = diagnostics?.gpu?.renderer || diagnostics?.rendererHealth || {};
  return {
    status: renderer.status || diagnostics?.gpu?.effective || diagnostics?.gpu?.mode || "unknown",
    reason: renderer.lastReason || "",
    recoveryCount: Number(renderer.recoveryCount || 0),
    animationName: String(renderer.animationName || ""),
    trackTime: Number(renderer.trackTime || 0),
    animationRecoveryExhausted: renderer.animationRecoveryExhausted === true
  };
}

export function rendererHealthCategory(status = "") {
  if (["ok", "healthy", "hardware", "platform-default", "recovered", "recreated"].includes(status)) {
    return "healthy";
  }
  if (status === "starting") return "starting";
  if (["context-lost", "stale", "ticker-stopped", "invalid-canvas", "track-stale", "track-recovery-limited"].includes(status)) return "attention";
  return "unknown";
}

export function createCoalescedRefresh(callback, delayMs = 80, timers = globalThis) {
  let timer = 0;
  return {
    schedule() {
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = 0;
        callback();
      }, delayMs);
    },
    cancel() {
      if (timer) timers.clearTimeout(timer);
      timer = 0;
    }
  };
}
