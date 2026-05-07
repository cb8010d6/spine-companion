import "./styles.css";
import { createStateProvider, loadRuntimeConfig } from "./providers.js";
import { SpinePlayer } from "./spine-player.js";
import { stateLabels } from "./state.js";

const stage = document.getElementById("stage");
const shell = document.getElementById("stage-shell");
const stateDot = document.getElementById("state-dot");
const stateLabel = document.getElementById("state-label");
const sourceLabel = document.getElementById("source-label");
const stateControls = document.getElementById("state-controls");
const progressBubble = document.getElementById("progress-bubble");
const bubbleTitle = document.getElementById("bubble-title");
const bubbleMessage = document.getElementById("bubble-message");
const completionToast = document.getElementById("completion-toast");
const completionTitle = document.getElementById("completion-title");
const completionMessage = document.getElementById("completion-message");
const reminderForm = document.getElementById("reminder-form");
const reminderText = document.getElementById("reminder-text");
const reminderDelay = document.getElementById("reminder-delay");
const emptyState = document.getElementById("empty-state");

let provider = null;
let player = null;
let drag = null;
let currentState = { state: "idle", source: "system" };
let lastCompletionKey = "";
let currentUiSettings = {
  hudVisible: true,
  bubbleVisible: true,
  bubbleShadow: true,
  bubbleBackground: "solid",
  bubbleHoldMs: 8000,
  dragMode: "compatible"
};
let currentBubbleAnchor = { x: 20, y: 28, scale: 1, side: "left" };
let heldBubble = null;
let bubbleHoldTimer = null;
let completionToastTimer = null;
let mousePassthrough = false;

function applyUiSettings(settings = {}) {
  currentUiSettings = { ...currentUiSettings, ...settings };
  document.body.classList.toggle("hud-hidden", currentUiSettings.hudVisible === false);
  document.body.classList.toggle("bubble-hidden", currentUiSettings.bubbleVisible === false);
  document.body.classList.toggle("bubble-no-shadow", currentUiSettings.bubbleShadow === false);
  document.body.classList.toggle("dragging-compatible", currentUiSettings.dragMode !== "smooth");
  document.body.dataset.bubbleBackground = currentUiSettings.bubbleBackground || "solid";
  player?.setHudVisible(currentUiSettings.hudVisible !== false);
  player?.setDragMode(currentUiSettings.dragMode || "compatible");
  updateBubble(currentState);
}

function applyBubbleAnchor(anchor = currentBubbleAnchor) {
  currentBubbleAnchor = { ...currentBubbleAnchor, ...anchor };
  const scale = Number(currentBubbleAnchor.scale || 1);
  const rect = progressBubble.getBoundingClientRect();
  const naturalWidth = rect.width / scale || progressBubble.offsetWidth || 245;
  const naturalHeight = rect.height / scale || progressBubble.offsetHeight || 72;
  const visualWidth = naturalWidth * scale;
  const visualHeight = naturalHeight * scale;
  const inset = 8;
  const rawX = currentBubbleAnchor.side === "right"
    ? currentBubbleAnchor.x - visualWidth
    : currentBubbleAnchor.x;
  const maxX = Math.max(inset, window.innerWidth - visualWidth - inset);
  const maxY = Math.max(inset, window.innerHeight - visualHeight - inset);
  const x = Math.max(inset, Math.min(maxX, rawX));
  const y = Math.max(inset, Math.min(maxY, currentBubbleAnchor.y));
  progressBubble.style.left = `${Math.round(x)}px`;
  progressBubble.style.top = `${Math.round(y)}px`;
  progressBubble.style.setProperty("--bubble-scale", String(scale));
  progressBubble.dataset.side = currentBubbleAnchor.side || "left";
}

function renderStateControls(sendState) {
  stateControls.innerHTML = "";
  for (const item of stateLabels()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.state = item.id;
    button.textContent = item.label;
    button.addEventListener("click", () => sendState({ state: item.id, source: "hud" }));
    stateControls.appendChild(button);
  }
}

function rectContains(rect, x, y) {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function elementContainsPoint(element, x, y) {
  if (!element || element.hidden) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
  return rectContains(element.getBoundingClientRect(), x, y);
}

function setMousePassthrough(enabled) {
  if (!window.companion?.setMousePassthrough || mousePassthrough === enabled) return;
  mousePassthrough = enabled;
  window.companion.setMousePassthrough(enabled);
}

function updateMousePassthrough(event) {
  if (drag || !window.companion?.setMousePassthrough) {
    setMousePassthrough(false);
    return;
  }
  if (!completionToast.hidden) {
    setMousePassthrough(false);
    return;
  }

  const x = event.clientX;
  const y = event.clientY;
  const interactive = rectContains(player?.getInteractiveBounds?.(), x, y)
    || elementContainsPoint(document.getElementById("hud"), x, y)
    || elementContainsPoint(completionToast, x, y)
    || elementContainsPoint(emptyState, x, y);
  setMousePassthrough(!interactive);
}

function updateHud(state) {
  const id = state.state || "idle";
  currentState = state;
  stateLabel.textContent = id;
  sourceLabel.textContent = state.source || "local";
  stateDot.dataset.state = id;
  for (const button of stateControls.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.state === id);
  }
}

function updateBubble(state) {
  const id = state?.state || "idle";
  const message = String(state?.message || defaultMessageForState(id, state?.source)).trim();
  if (message && id !== "idle") {
    heldBubble = { ...state, state: id, message };
    window.clearTimeout(bubbleHoldTimer);
    bubbleHoldTimer = window.setTimeout(() => {
      heldBubble = null;
      updateBubble(currentState);
    }, Number(currentUiSettings.bubbleHoldMs || 8000));
  }
  const displayState = id === "idle" && heldBubble ? heldBubble : { ...state, state: id, message };
  const displayId = displayState?.state || "idle";
  const displayMessage = String(displayState?.message || "").trim();
  const shouldShow = currentUiSettings.bubbleVisible !== false && displayMessage && displayId !== "idle";
  progressBubble.hidden = !shouldShow;
  if (!shouldShow) return;
  bubbleTitle.textContent = displayState?.source === "codex-mcp"
    ? "Codex"
    : displayId[0].toUpperCase() + displayId.slice(1);
  bubbleMessage.textContent = displayMessage;
  progressBubble.dataset.state = displayId;
  applyBubbleAnchor(player?.getAnchor?.() || currentBubbleAnchor);
  window.requestAnimationFrame(() => {
    if (!progressBubble.hidden) applyBubbleAnchor(player?.getAnchor?.() || currentBubbleAnchor);
  });
}

function defaultMessageForState(id, source) {
  if (source !== "codex-mcp") return "";
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

function updateCompletionToast(state) {
  const id = state?.state || "idle";
  if (id !== "success" && id !== "failed") return;
  const key = `${id}:${state.updatedAt || ""}`;
  if (key === lastCompletionKey) return;
  lastCompletionKey = key;
  completionToast.hidden = false;
  setMousePassthrough(false);
  window.clearTimeout(completionToastTimer);
  completionToast.dataset.state = id;
  completionTitle.textContent = id === "success" ? "Task complete" : "Task failed";
  completionMessage.textContent = String(state.message || (id === "success" ? "Finished successfully" : "Needs attention"));
  completionToastTimer = window.setTimeout(() => {
    completionToast.hidden = true;
    setMousePassthrough(true);
  }, 10000);
}

function wireDragging() {
  shell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".hud")) return;
    drag = {
      moved: false,
      x: event.screenX,
      y: event.screenY,
      lastX: event.screenX,
      lastDirection: "",
      returnTo: currentState.state || "idle"
    };
    document.body.classList.add("is-dragging");
    player?.setDragActive(true);
    window.companion?.dragStart({ screenX: event.screenX, screenY: event.screenY });
    shell.setPointerCapture(event.pointerId);
  });

  shell.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const distance = Math.abs(event.screenX - drag.x) + Math.abs(event.screenY - drag.y);
    if (distance > 3) drag.moved = true;
    const dx = event.screenX - drag.lastX;
    if (drag.moved && Math.abs(dx) >= 6 && player) {
      const direction = dx < 0 ? "left" : "right";
      if (direction !== drag.lastDirection) {
        drag.lastDirection = direction;
        player.applyState({
          state: "running",
          direction,
          source: "drag"
        });
      } else {
        player.setDirection(direction);
      }
      updateHud({
        state: "running",
        direction,
        source: "drag",
        message: "Moving"
      });
    }
    drag.lastX = event.screenX;
    window.companion?.dragMove({ screenX: event.screenX, screenY: event.screenY });
  });

  shell.addEventListener("pointerup", async (event) => {
    if (!drag) return;
    const completedDrag = drag.moved;
    const returnTo = drag.returnTo || "idle";
    window.companion?.dragEnd();
    if (completedDrag && provider) {
      await provider.setState({
        state: returnTo,
        source: "drag-end"
      });
    } else if (provider) {
      await provider.setState({
        state: "reminder",
        source: "click",
        message: "Interaction",
        autoReturnMs: 2200,
        returnTo: "idle"
      });
    }
    drag = null;
    player?.setDragActive(false);
    document.body.classList.remove("is-dragging");
    shell.releasePointerCapture(event.pointerId);
  });
}

function wireMousePassthrough() {
  window.addEventListener("mousemove", updateMousePassthrough);
  window.addEventListener("mouseenter", updateMousePassthrough);
  window.addEventListener("mouseleave", () => setMousePassthrough(true));
}

async function boot() {
  const config = await loadRuntimeConfig();
  applyUiSettings(config.ui);
  provider = createStateProvider(config);
  renderStateControls((state) => provider.setState(state));
  wireDragging();
  wireMousePassthrough();

  try {
    player = new SpinePlayer(stage, config);
    await player.init();
    player.onAutoReturn = (state) => provider.setState({ state, source: "renderer" });
    player.onAnchorChange = (anchor) => {
      applyBubbleAnchor(anchor);
      updateBubble(currentState);
    };
    applyBubbleAnchor(player.getAnchor());
    setMousePassthrough(true);
  } catch (error) {
    emptyState.hidden = false;
    emptyState.querySelector("span").textContent = error.message;
  }

  await provider.start((state) => {
    updateHud(state);
    updateBubble(state);
    updateCompletionToast(state);
    player?.applyState(state);
  });

  window.companion?.onUi((settings) => applyUiSettings(settings));
  window.companion?.onScale((payload) => {
    if (payload?.action === "reset") {
      player?.resetUserScale();
      return;
    }
    player?.adjustUserScale(Number(payload?.delta || 0));
  });

  reminderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await provider.createReminder({
      text: reminderText.value || "Reminder",
      inSeconds: Number(reminderDelay.value || 10)
    });
    reminderText.value = "";
  });

  completionToast.addEventListener("click", () => {
    completionToast.hidden = true;
    window.clearTimeout(completionToastTimer);
    setMousePassthrough(true);
  });
}

boot().catch((error) => {
  emptyState.hidden = false;
  emptyState.querySelector("strong").textContent = "Startup failed";
  emptyState.querySelector("span").textContent = error.message;
});
