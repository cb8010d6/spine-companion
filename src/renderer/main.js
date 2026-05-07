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
const reminderForm = document.getElementById("reminder-form");
const reminderText = document.getElementById("reminder-text");
const reminderDelay = document.getElementById("reminder-delay");
const emptyState = document.getElementById("empty-state");

let provider = null;
let player = null;
let drag = null;
let currentState = { state: "idle", source: "system" };
let lastDragRunAt = 0;

function applyUiSettings(settings = {}) {
  document.body.classList.toggle("hud-hidden", settings.hudVisible === false);
  player?.setHudVisible(settings.hudVisible !== false);
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

function wireDragging() {
  shell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".hud")) return;
    drag = {
      moved: false,
      x: event.screenX,
      y: event.screenY,
      lastX: event.screenX,
      returnTo: currentState.state || "idle"
    };
    window.companion?.dragStart({ screenX: event.screenX, screenY: event.screenY });
    shell.setPointerCapture(event.pointerId);
  });

  shell.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const distance = Math.abs(event.screenX - drag.x) + Math.abs(event.screenY - drag.y);
    if (distance > 3) drag.moved = true;
    const dx = event.screenX - drag.lastX;
    const now = performance.now();
    if (drag.moved && Math.abs(dx) >= 2 && provider && now - lastDragRunAt > 140) {
      lastDragRunAt = now;
      provider.setState({
        state: "running",
        direction: dx < 0 ? "left" : "right",
        source: "drag"
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
    shell.releasePointerCapture(event.pointerId);
  });
}

async function boot() {
  const config = await loadRuntimeConfig();
  applyUiSettings(config.ui);
  provider = createStateProvider(config);
  renderStateControls((state) => provider.setState(state));
  wireDragging();

  try {
    player = new SpinePlayer(stage, config);
    await player.init();
    player.onAutoReturn = (state) => provider.setState({ state, source: "renderer" });
  } catch (error) {
    emptyState.hidden = false;
    emptyState.querySelector("span").textContent = error.message;
  }

  await provider.start((state) => {
    updateHud(state);
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
}

boot().catch((error) => {
  emptyState.hidden = false;
  emptyState.querySelector("strong").textContent = "Startup failed";
  emptyState.querySelector("span").textContent = error.message;
});
