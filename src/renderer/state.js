import stateMachine from "../shared/state-machine.json";

const allowedStates = new Set(stateMachine.states);

export function normalizeStateId(value) {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = stateMachine.aliases[raw] || raw;
  return allowedStates.has(normalized) ? normalized : "idle";
}

export function animationForState(state, config) {
  const id = normalizeStateId(state?.state || state?.id || state);
  const base = stateMachine.animationMap[id] || stateMachine.animationMap.idle;
  const override = config?.animationMap?.[id] || {};
  return {
    state: id,
    label: stateMachine.labels[id] || id,
    ...base,
    ...override
  };
}

export function stateLabels() {
  return stateMachine.states.map((id) => ({
    id,
    label: stateMachine.labels[id] || id
  }));
}

export function displayEventKind(state = {}) {
  const kind = String(state.eventKind || "").trim().toLowerCase();
  if (kind === "demo" || kind === "self-test") return kind;
  return String(state.message || "").trimStart().startsWith("[Spine Companion self-test]") ? "self-test" : "";
}

export { stateMachine };
