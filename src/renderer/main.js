import "./styles.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { createStateProvider, loadRuntimeConfig } from "./providers.js";
import { SpinePlayer } from "./spine-player.js";
import { stateLabels } from "./state.js";
import { createOnboarding, shouldShowOnboarding } from "./onboarding.js";
import { createErrorCard } from "./error-boundary.js";
import { bindManagerButton } from "./manager-action.js";
import { defaultMessageForState, isAiSource, notificationForState, shouldNotifyState, sourceDisplayName } from "../shared/notification-policy.js";

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
const emptyManager = document.getElementById("empty-manager");
const emptyManagerStatus = document.getElementById("empty-manager-status");
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
  dragMode: "compatible",
  hitboxPadding: 8
};
let currentBubbleAnchor = { x: 20, y: 28, scale: 1, side: "left" };
let heldBubble = null;
let bubbleHoldTimer = null;
let completionToastTimer = null;
let mousePassthrough = false;
let pendingMousePassthroughEvent = null;
let mousePassthroughFrame = 0;
let runtimeConfig = null;
let providerErrorToastTimer = null;
let onboardingDismissedForSession = false;
let clickReturnTimer = 0;

function applyUiSettings(settings = {}) {
  currentUiSettings = { ...currentUiSettings, ...settings };
  document.body.classList.toggle("hud-hidden", currentUiSettings.hudVisible === false);
  document.body.classList.toggle("bubble-hidden", currentUiSettings.bubbleVisible === false);
  document.body.classList.toggle("bubble-no-shadow", currentUiSettings.bubbleShadow === false);
  document.body.classList.toggle("dragging-compatible", currentUiSettings.dragMode !== "smooth");
  document.body.dataset.bubbleBackground = currentUiSettings.bubbleBackground || "solid";
  player?.setHudVisible(currentUiSettings.hudVisible !== false);
  player?.setDragMode(currentUiSettings.dragMode || "compatible");
  player?.setHitboxPadding(currentUiSettings.hitboxPadding);
  syncSettingsPanel();
  updateBubble(currentState);
  refreshMousePassthroughSoon();
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
  let side = currentBubbleAnchor.side || "left";
  let x = Math.max(inset, Math.min(maxX, rawX));
  let y = Math.max(inset, Math.min(maxY, currentBubbleAnchor.y));
  const avoid = currentBubbleAnchor.avoid;
  if (avoid) {
    const gap = Math.max(8, 16 * scale);
    const overlaps = () => (
      x < avoid.right + gap
      && x + visualWidth > avoid.left - gap
      && y < avoid.bottom + gap
      && y + visualHeight > avoid.top - gap
    );
    if (overlaps()) {
      const rightX = avoid.right + gap;
      const leftX = avoid.left - visualWidth - gap;
      const roomRight = window.innerWidth - rightX - inset;
      const roomLeft = leftX - inset;
      if (roomRight >= visualWidth || roomRight >= roomLeft) {
        x = Math.max(inset, Math.min(maxX, rightX));
        side = "left";
      } else {
        x = Math.max(inset, Math.min(maxX, leftX));
        side = "right";
      }
    }
    if (overlaps()) {
      const aboveY = avoid.top - visualHeight - gap;
      const belowY = avoid.bottom + gap;
      y = aboveY >= inset
        ? aboveY
        : Math.max(inset, Math.min(maxY, belowY));
    }
  }
  progressBubble.style.left = `${Math.round(x)}px`;
  progressBubble.style.top = `${Math.round(y)}px`;
  progressBubble.style.setProperty("--bubble-scale", String(scale));
  progressBubble.dataset.side = side;
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

function setMousePassthrough(enabled, force = false) {
  if (!window.companion?.setMousePassthrough || (!force && mousePassthrough === enabled)) return;
  mousePassthrough = enabled;
  window.companion.setMousePassthrough(enabled, player?.getInteractiveBounds?.());
}

function refreshMousePassthroughSoon() {
  window.requestAnimationFrame(() => {
    if (pendingMousePassthroughEvent) scheduleMousePassthroughUpdate(pendingMousePassthroughEvent);
    if (mousePassthrough) setMousePassthrough(true, true);
  });
}

async function openManagerFromRenderer() {
  setMousePassthrough(false);
  if (!window.companion?.openManager) {
    throw new Error("Manager API is unavailable.");
  }
  onboardingDismissedForSession = true;
  onboardingRoot.hidden = true;
  onboardingRoot.replaceChildren();
  return window.companion.openManager();
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
    || elementContainsPoint(settingsPanel, x, y)
    || elementContainsPoint(progressBubble, x, y)
    || elementContainsPoint(completionToast, x, y)
    || elementContainsPoint(emptyState, x, y)
    || elementContainsPoint(errorRoot, x, y)
    || elementContainsPoint(onboardingRoot, x, y);
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
  if (state?.source === "drag" || state?.source === "click") {
    progressBubble.hidden = true;
    return;
  }
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
  bubbleTitle.textContent = isAiSource(displayState?.source)
    ? sourceDisplayName(displayState?.source)
    : displayId[0].toUpperCase() + displayId.slice(1);
  bubbleMessage.textContent = displayMessage;
  progressBubble.dataset.state = displayId;
  applyBubbleAnchor(player?.getAnchor?.() || currentBubbleAnchor);
  window.requestAnimationFrame(() => {
    if (!progressBubble.hidden) applyBubbleAnchor(player?.getAnchor?.() || currentBubbleAnchor);
  });
}

function updateCompletionToast(state) {
  const id = state?.state || "idle";
  if (id !== "success" && id !== "failed") return;
  if (!shouldNotifyState(state)) return;
  const key = `${id}:${state.updatedAt || ""}`;
  if (key === lastCompletionKey) return;
  lastCompletionKey = key;
  completionToast.hidden = false;
  setMousePassthrough(false);
  window.clearTimeout(completionToastTimer);
  completionToast.dataset.state = id;
  const notification = notificationForState(state);
  completionTitle.textContent = notification?.title || (id === "success" ? "Task complete" : "Task failed");
  completionMessage.textContent = notification?.body || String(state.message || (id === "success" ? "Finished successfully" : "Needs attention"));
  completionToastTimer = window.setTimeout(() => {
    completionToast.hidden = true;
    setMousePassthrough(true);
  }, 10000);
}

async function returnToIdle(source = "user") {
  const idleState = { state: "idle", source };
  window.clearTimeout(clickReturnTimer);
  player?.applyState(idleState, true);
  updateHud(idleState);
  completionToast.hidden = true;
  window.clearTimeout(completionToastTimer);
  setMousePassthrough(true);
  await provider?.setState?.(idleState).catch(() => {});
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
  emptyManager.hidden = !window.companion?.openManager;
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
  if (onboardingDismissedForSession || !shouldShowOnboarding(config)) {
    onboardingRoot.hidden = true;
    onboardingRoot.replaceChildren();
    return;
  }
  onboardingRoot.hidden = false;
  onboardingRoot.replaceChildren(createOnboarding({
    onManager: openManagerFromRenderer,
    onDownload: () => importSelectedModel("onboarding")
  }));
}

function showErrorBoundary(error, config) {
  errorRoot.hidden = false;
  setMousePassthrough(false);
  errorRoot.replaceChildren(createErrorCard({
    title: "Unable to load model",
    error,
    config,
    onRetry: () => loadPlayer(runtimeConfig).then(() => {
      errorRoot.hidden = true;
      errorRoot.replaceChildren();
    }).catch((nextError) => showErrorBoundary(nextError, runtimeConfig)),
    onManager: openManagerFromRenderer
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
  player.setHitboxPadding(currentUiSettings.hitboxPadding);
  applyBubbleAnchor(player.getAnchor());
  player.applyState(currentState, true);
  emptyState.hidden = true;
  onboardingDismissedForSession = true;
  onboardingRoot.hidden = true;
  onboardingRoot.replaceChildren();
  errorRoot.hidden = true;
  errorRoot.replaceChildren();
  setMousePassthrough(true);
}

function showProviderError(error, context = {}) {
  if ((context.consecutiveErrors || 0) < 3) return;
  window.clearTimeout(providerErrorToastTimer);
  const message = `State source connection issue: ${error.message || error}`;
  updateBubble({
    state: "waiting",
    source: context.provider || "provider",
    message
  });
  providerErrorToastTimer = window.setTimeout(() => updateBubble(currentState), 7000);
}

async function hotReloadPlayer(nextConfig, statusText = "") {
  try {
    await loadPlayer(nextConfig);
    if (statusText && modelStatus) modelStatus.textContent = statusText;
  } catch (error) {
    showEmptyState(error, nextConfig);
    showErrorBoundary(error, nextConfig);
    if (modelStatus) modelStatus.textContent = error.message;
  }
}

function wireDragging() {
  shell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".hud")) return;
    if (currentState.state === "success") {
      returnToIdle("success-click");
      return;
    }
    drag = {
      moved: false,
      x: event.screenX,
      y: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      lastRunX: event.screenX,
      totalX: 0,
      totalY: 0,
      lastDirection: "",
      returnTo: currentState.state || "idle"
    };
    document.body.classList.add("is-dragging");
    player?.setDragActive(true);
    progressBubble.hidden = true;
    window.clearTimeout(bubbleHoldTimer);
    heldBubble = null;
    window.companion?.dragStart({
      screenX: event.screenX,
      screenY: event.screenY,
      totalX: 0,
      totalY: 0,
      scaleFactor: window.devicePixelRatio || 1
    });
    shell.setPointerCapture(event.pointerId);
  });

  shell.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const fallbackDx = event.screenX - drag.lastX;
    const fallbackDy = event.screenY - drag.lastY;
    const movementX = Number.isFinite(event.movementX) && event.movementX !== 0 ? event.movementX : fallbackDx;
    const movementY = Number.isFinite(event.movementY) && event.movementY !== 0 ? event.movementY : fallbackDy;
    drag.totalX += movementX;
    drag.totalY += movementY;
    const distance = Math.abs(drag.totalX) + Math.abs(drag.totalY);
    if (distance > 3) drag.moved = true;
    const dx = Math.abs(movementX) >= 0.5 ? movementX : event.screenX - drag.lastRunX;
    if (drag.moved && Math.abs(dx) >= 2 && player) {
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
      drag.lastRunX = event.screenX;
      updateHud({
        state: "running",
        direction,
        source: "drag"
      });
    }
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    window.companion?.dragMove({
      screenX: event.screenX,
      screenY: event.screenY,
      totalX: drag.totalX,
      totalY: drag.totalY,
      scaleFactor: window.devicePixelRatio || 1
    });
  });

  shell.addEventListener("pointerup", async (event) => {
    if (!drag) return;
    const completedDrag = drag.moved;
    const returnTo = drag.returnTo || "idle";
    window.companion?.dragEnd();
    if (completedDrag) {
      player?.applyState({ state: returnTo, source: "drag-end" }, true);
      updateHud({ state: returnTo, source: "drag-end" });
    }
    drag = null;
    player?.setDragActive(false);
    document.body.classList.remove("is-dragging");
    shell.releasePointerCapture(event.pointerId);
    if (completedDrag) {
      if (provider) {
        await provider.setState({
          state: returnTo,
          source: "drag-end"
        });
      }
      return;
    }
    const previousState = { ...currentState };
    const clickState = {
      state: "reminder",
      source: "click",
      message: "",
      autoReturnMs: 2200,
      returnTo: "idle"
    };
    player?.applyState(clickState, true);
    updateBubble(previousState);
    window.clearTimeout(clickReturnTimer);
    clickReturnTimer = window.setTimeout(() => {
      player?.applyState(previousState, true);
      updateHud(previousState);
      updateBubble(previousState);
    }, Number(clickState.autoReturnMs));
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
  provider.onError = showProviderError;
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
      refreshMousePassthroughSoon();
      return;
    }
    player?.adjustUserScale(Number(payload?.delta || 0));
    refreshMousePassthroughSoon();
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
    await hotReloadPlayer(runtimeConfig, `Imported and loaded from ${result.assetDir}.`);
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
    await hotReloadPlayer(runtimeConfig);
  });

  window.companion?.onNotificationDismiss?.(() => {
    completionToast.hidden = true;
    window.clearTimeout(completionToastTimer);
    setMousePassthrough(true);
  });

  window.companion?.onUpdateAvailable?.((status) => {
    updateBubble({
      state: "reminder",
      source: "update-checker",
      message: `Spine Companion ${status.latestVersion} is available.`
    });
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
  bindManagerButton(emptyManager, emptyManagerStatus, openManagerFromRenderer);
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
    returnToIdle("completion-toast");
  });
}

window.addEventListener("error", (event) => {
  const error = event.error || new Error(event.message || "Renderer error");
  console.error("[spine-companion] renderer error", error);
  showErrorBoundary(error, runtimeConfig);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || "Unhandled rejection"));
  console.error("[spine-companion] renderer rejection", reason);
  showErrorBoundary(reason, runtimeConfig);
});

boot().catch((error) => {
  emptyState.hidden = false;
  emptyState.querySelector("strong").textContent = "Startup failed";
  emptyState.querySelector("span").textContent = error.message;
  window.companion?.rendererReady?.();
});
