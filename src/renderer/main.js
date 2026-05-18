import "./styles.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { createStateProvider, loadRuntimeConfig } from "./providers.js";
import { SpinePlayer } from "./spine-player.js";
import { stateLabels } from "./state.js";
import { createOnboarding, shouldShowOnboarding } from "./onboarding.js";
import { createErrorCard } from "./error-boundary.js";

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
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const settingHud = document.getElementById("setting-hud");
const settingBubble = document.getElementById("setting-bubble");
const settingShadow = document.getElementById("setting-shadow");
const settingBubbleBackground = document.getElementById("setting-bubble-background");
const settingDragMode = document.getElementById("setting-drag-mode");
const settingZoomIn = document.getElementById("setting-zoom-in");
const settingZoomOut = document.getElementById("setting-zoom-out");
const settingZoomReset = document.getElementById("setting-zoom-reset");
const modelSelect = document.getElementById("model-select");
const modelImport = document.getElementById("model-import");
const modelStatus = document.getElementById("model-status");
const reminderForm = document.getElementById("reminder-form");
const reminderText = document.getElementById("reminder-text");
const reminderDelay = document.getElementById("reminder-delay");
const emptyState = document.getElementById("empty-state");
const emptyStatePath = document.getElementById("empty-state-path");
const emptyImport = document.getElementById("empty-import");
const emptyRetry = document.getElementById("empty-retry");
const onboardingRoot = document.getElementById("onboarding-root");
const errorRoot = document.getElementById("error-root");

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
let pendingMousePassthroughEvent = null;
let mousePassthroughFrame = 0;
let runtimeConfig = null;

function applyUiSettings(settings = {}) {
  currentUiSettings = { ...currentUiSettings, ...settings };
  document.body.classList.toggle("hud-hidden", currentUiSettings.hudVisible === false);
  document.body.classList.toggle("bubble-hidden", currentUiSettings.bubbleVisible === false);
  document.body.classList.toggle("bubble-no-shadow", currentUiSettings.bubbleShadow === false);
  document.body.classList.toggle("dragging-compatible", currentUiSettings.dragMode !== "smooth");
  document.body.dataset.bubbleBackground = currentUiSettings.bubbleBackground || "solid";
  player?.setHudVisible(currentUiSettings.hudVisible !== false);
  player?.setDragMode(currentUiSettings.dragMode || "compatible");
  syncSettingsPanel();
  updateBubble(currentState);
}

function syncSettingsPanel() {
  if (!settingHud) return;
  settingHud.checked = currentUiSettings.hudVisible !== false;
  settingBubble.checked = currentUiSettings.bubbleVisible !== false;
  settingShadow.checked = currentUiSettings.bubbleShadow !== false;
  settingBubbleBackground.value = currentUiSettings.bubbleBackground || "solid";
  settingDragMode.value = currentUiSettings.dragMode || "compatible";
}

async function updateUiSettings(patch) {
  const next = { ...currentUiSettings, ...patch };
  applyUiSettings(next);
  try {
    const confirmed = await window.companion?.setUiSettings?.(patch);
    if (confirmed) applyUiSettings(confirmed);
  } catch (error) {
    console.warn("Unable to update UI settings", error);
  }
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
  const fragment = document.createDocumentFragment();
  for (const item of stateLabels()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.state = item.id;
    button.textContent = item.label;
    button.addEventListener("click", () => sendState({ state: item.id, source: "hud" }));
    fragment.appendChild(button);
  }
  stateControls.replaceChildren(fragment);
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

function scheduleMousePassthroughUpdate(event) {
  pendingMousePassthroughEvent = event;
  if (mousePassthroughFrame) return;
  mousePassthroughFrame = window.requestAnimationFrame(() => {
    mousePassthroughFrame = 0;
    const nextEvent = pendingMousePassthroughEvent;
    pendingMousePassthroughEvent = null;
    if (nextEvent) updateMousePassthrough(nextEvent);
  });
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

function renderModelCatalog(config) {
  const catalog = config.models?.catalog || [];
  const fragment = document.createDocumentFragment();
  for (const model of catalog) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name || model.id;
    fragment.appendChild(option);
  }
  modelSelect.replaceChildren(fragment);
  const hasModels = catalog.length > 0 && window.companion?.importModel;
  modelSelect.disabled = !hasModels;
  modelImport.disabled = !hasModels;
  emptyImport.hidden = !hasModels;
}

async function importSelectedModel(source = "settings") {
  const id = modelSelect.value || runtimeConfig?.models?.catalog?.[0]?.id;
  if (!id || !window.companion?.importModel) return;
  modelStatus.textContent = "Downloading model...";
  modelImport.disabled = true;
  emptyImport.disabled = true;
  try {
    const result = await window.companion.importModel({ id });
    runtimeConfig = {
      ...runtimeConfig,
      spine: {
        ...runtimeConfig.spine,
        skel: result.skel,
        assetUrl: `${result.assetUrl}?t=${Date.now()}`,
        assetDirConfigured: true
      }
    };
    await loadPlayer(runtimeConfig);
    modelStatus.textContent = `Imported and loaded from ${result.assetDir}.`;
    if (!emptyState.hidden) {
      emptyState.querySelector("span").textContent = "Model imported and loaded.";
      emptyStatePath.textContent = result.localConfigPath;
    }
    if (source === "empty") settingsPanel.hidden = false;
  } catch (error) {
    modelStatus.textContent = error.message;
    if (!emptyState.hidden) emptyState.querySelector("span").textContent = error.message;
  } finally {
    modelImport.disabled = false;
    emptyImport.disabled = false;
  }
}

function showEmptyState(error, config) {
  emptyState.hidden = false;
  emptyState.querySelector("span").textContent = error.message;
  const localPath = config?.paths?.localConfigPath;
  emptyStatePath.textContent = localPath
    ? `Put companion.local.json here: ${localPath}`
    : "";
}

function showOnboardingIfNeeded(config) {
  if (!shouldShowOnboarding(config)) {
    onboardingRoot.hidden = true;
    onboardingRoot.replaceChildren();
    return;
  }
  onboardingRoot.hidden = false;
  onboardingRoot.replaceChildren(createOnboarding({
    onManager: () => window.companion?.openManager?.(),
    onDownload: () => importSelectedModel("onboarding")
  }));
}

function showErrorBoundary(error, config) {
  errorRoot.hidden = false;
  errorRoot.replaceChildren(createErrorCard({
    title: "Unable to load model",
    error,
    config,
    onRetry: () => loadPlayer(runtimeConfig).then(() => {
      errorRoot.hidden = true;
      errorRoot.replaceChildren();
    }).catch((nextError) => showErrorBoundary(nextError, runtimeConfig)),
    onManager: () => window.companion?.openManager?.()
  }));
}

async function loadPlayer(config) {
  player?.destroy();
  stage.replaceChildren();
  player = new SpinePlayer(stage, config);
  await player.init();
  player.onAutoReturn = (state) => provider.setState({ state, source: "renderer" });
  player.onAnchorChange = (anchor) => {
    applyBubbleAnchor(anchor);
    updateBubble(currentState);
  };
  player.setHudVisible(currentUiSettings.hudVisible !== false);
  player.setDragMode(currentUiSettings.dragMode || "compatible");
  applyBubbleAnchor(player.getAnchor());
  player.applyState(currentState, true);
  emptyState.hidden = true;
  setMousePassthrough(true);
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
  window.addEventListener("mousemove", scheduleMousePassthroughUpdate);
  window.addEventListener("mouseenter", scheduleMousePassthroughUpdate);
  window.addEventListener("mouseleave", () => setMousePassthrough(true));
}

async function boot() {
  // Initialize Tauri bridge if running under Tauri (no-op under Electron)
  if (isTauri()) await initTauriBridge();
  const config = await loadRuntimeConfig();
  runtimeConfig = config;
  applyUiSettings(config.ui);
  provider = createStateProvider(config);
  renderStateControls((state) => provider.setState(state));
  renderModelCatalog(config);
  showOnboardingIfNeeded(config);
  wireDragging();
  wireMousePassthrough();

  try {
    await loadPlayer(config);
  } catch (error) {
    showEmptyState(error, config);
    showErrorBoundary(error, config);
  }
  await window.companion?.rendererReady?.();

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

  window.companion?.onModelImported?.(async (result) => {
    runtimeConfig = {
      ...runtimeConfig,
      spine: {
        ...runtimeConfig.spine,
        skel: result.skel,
        assetUrl: `${result.assetUrl}?t=${Date.now()}`,
        assetDirConfigured: true
      }
    };
    await loadPlayer(runtimeConfig);
  });

  window.companion?.onConfigChanged?.(async (config) => {
    runtimeConfig = {
      ...runtimeConfig,
      ui: config.ui || runtimeConfig.ui,
      spine: {
        ...runtimeConfig.spine,
        ...(config.spine || {})
      }
    };
    await loadPlayer(runtimeConfig);
  });

  settingsToggle.addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });
  settingHud.addEventListener("change", () => updateUiSettings({ hudVisible: settingHud.checked }));
  settingBubble.addEventListener("change", () => updateUiSettings({ bubbleVisible: settingBubble.checked }));
  settingShadow.addEventListener("change", () => updateUiSettings({ bubbleShadow: settingShadow.checked }));
  settingBubbleBackground.addEventListener("change", () => updateUiSettings({ bubbleBackground: settingBubbleBackground.value }));
  settingDragMode.addEventListener("change", () => updateUiSettings({ dragMode: settingDragMode.value }));
  settingZoomIn.addEventListener("click", () => window.companion?.emitScale?.({ delta: 0.08 }));
  settingZoomOut.addEventListener("click", () => window.companion?.emitScale?.({ delta: -0.08 }));
  settingZoomReset.addEventListener("click", () => window.companion?.emitScale?.({ action: "reset" }));
  modelImport.addEventListener("click", () => importSelectedModel("settings"));
  emptyImport.addEventListener("click", () => importSelectedModel("empty"));
  emptyRetry.addEventListener("click", () => loadPlayer(runtimeConfig).catch((error) => showErrorBoundary(error, runtimeConfig)));

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
  window.companion?.rendererReady?.();
});
