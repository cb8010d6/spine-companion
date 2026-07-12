import "./panel.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { modelPreview } from "./model-preview.js";
import { renderSpinePreview } from "./spine-preview.js";
import { createI18n, t } from "../shared/i18n.js";
import { defaultMessageForState, sourceDisplayName } from "../shared/notification-policy.js";
import { applyThemePreference } from "./theme.js";

let config = null;
let panelPinned = false;
let currentDiagnostics = null;
let unsubscribeReminders = null;
let interactionUnlockTimer = 0;
const quickStates = ["idle", "working", "running", "reviewing", "success", "failed"];

function stateLabel(id) {
  return t(`state.${id}`);
}

function updateStaticLabels() {
  const pin = document.getElementById("panel-pin");
  if (pin) {
    pin.textContent = panelPinned ? t("panel.pin.pinned") : t("panel.pin.pin");
    pin.title = pin.textContent;
  }
  document.getElementById("panel-source-label").textContent = t("panel.runtime.source");
  document.getElementById("panel-api-label").textContent = t("panel.runtime.bridge");
  document.getElementById("panel-task-title").textContent = t("panel.task.title");
  document.getElementById("scale-label").textContent = t("panel.control.scale");
  document.getElementById("bubble-toggle-label").textContent = t("panel.control.progressBubble");
  document.getElementById("bubble-theme-label").textContent = t("panel.control.bubbleTheme");
  document.getElementById("hud-toggle-label").textContent = t("panel.control.desktopHud");
  document.getElementById("reminders-title").textContent = t("panel.section.reminders");
  document.getElementById("updates-title").textContent = t("panel.section.updates");
  document.getElementById("ai-bridge-title").textContent = t("panel.aiBridge");
  document.getElementById("btn-manager-label").textContent = t("panel.actions.openManager");
  document.getElementById("btn-quit-label").textContent = t("panel.actions.quit");
}

function isDebugPanelEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.has("debug") || config?.ui?.debugPanel === true || config?.ui?.devMode === true;
}

function renderQuickStates() {
  const quickStateSection = document.getElementById("quick-state-section");
  const enabled = isDebugPanelEnabled();
  quickStateSection.hidden = !enabled;
  if (!enabled) {
    quickStateSection.replaceChildren();
    return;
  }
  quickStateSection.replaceChildren(...quickStates.map((state) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = stateLabel(state);
    button.setAttribute("aria-label", stateLabel(state));
    button.addEventListener("click", () => window.companion?.setState?.({ state, source: "debug-panel" }));
    return button;
  }));
}

function renderPreview(previewEl, preview) {
  previewEl.replaceChildren();
  previewEl.classList.toggle("has-image", Boolean(preview.imageUrl));
  previewEl.classList.remove("has-spine-preview");
  Object.assign(previewEl.style, preview.style);

  const fallback = document.createElement("span");
  fallback.textContent = preview.initials;
  if (preview.imageUrl) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = preview.imageUrl;
    image.addEventListener("error", () => {
      image.remove();
      previewEl.classList.remove("has-image");
    });
    previewEl.appendChild(image);
  }
  previewEl.appendChild(fallback);
  if (!preview.imageUrl && preview.canRenderSpinePreview) {
    window.requestAnimationFrame(() => {
      if (previewEl.isConnected) renderSpinePreview(previewEl, preview, { width: 74, height: 74 });
    });
  }
}

async function closePanel(force = false) {
  if (panelPinned && !force) return;
  if (isTauri()) {
    await window.companion?.closePanel?.();
    return;
  }
  window.close();
}

function setNativeInteractionLock(locked) {
  window.clearTimeout(interactionUnlockTimer);
  if (!isTauri()) return;
  if (locked) {
    window.companion?.setPanelInteractionLock?.(true);
    return;
  }
  interactionUnlockTimer = window.setTimeout(() => {
    window.companion?.setPanelInteractionLock?.(false);
  }, 220);
}

function renderReminderList(reminders = []) {
  const list = document.getElementById("reminder-list");
  const badge = document.getElementById("reminder-badge");
  if (badge) {
    badge.textContent = `⏱ ${reminders.length}`;
    badge.title = t("panel.section.reminders");
  }
  if (!reminders.length) {
    list.textContent = t("panel.reminders.none");
    return;
  }
  list.replaceChildren(...reminders.slice().sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).map((reminder) => {
    const item = document.createElement("div");
    item.className = "reminder-item";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = reminder.text || t("panel.reminders.defaultTitle");
    const meta = document.createElement("span");
    meta.textContent = `${reminder.fired ? t("panel.reminders.fired") : t("panel.reminders.due")} ${reminder.dueAt || ""}`;
    info.append(title, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button";
    remove.textContent = t("manager.actions.delete");
    remove.addEventListener("click", async () => {
      await window.companion?.deleteReminder?.(reminder.id);
      await refreshReminders();
    });
    item.append(info, remove);
    return item;
  }));
}

async function refreshReminders() {
  if (!window.companion?.listReminders) return;
  renderReminderList(await window.companion.listReminders());
}

async function updateState() {
  try {
    if (window.companion?.getConfig) {
      config = await window.companion.getConfig();
    }
  } catch(e) { console.warn(e); return; }

  if (!config) return;
  createI18n(config);
  updateStaticLabels();
  renderQuickStates();

  const spine = config.spine || {};
  const ui = config.ui || {};
  applyThemePreference(ui.theme || "system");

  document.getElementById("scale-slider").value = spine.scale || 1;
  document.getElementById("scale-val").textContent = parseFloat(spine.scale || 1).toFixed(2) + "x";

  document.getElementById("bubble-toggle").checked = ui.bubbleVisible !== false;
  document.getElementById("hud-toggle").checked = ui.hudVisible !== false;
  document.getElementById("bubble-theme").value = ui.bubbleBackground || "solid";

  // Active Model Info
  if (spine.skel) {
    const catalog = config.models?.catalog || [];
    const activeModel = catalog.find(m => m.skel && spine.skel.includes(m.skel)) || {
      name: spine.skel.split(/[\\/]/).pop(),
      skel: spine.skel
    };
    document.getElementById("panel-model-name").textContent = activeModel.name;
    document.getElementById("panel-model-skel").textContent = spine.skel;
    const preview = modelPreview(activeModel, config);
    const previewEl = document.getElementById("panel-model-preview");
    renderPreview(previewEl, preview);
  } else {
    document.getElementById("panel-model-name").textContent = t("panel.model.none");
    document.getElementById("panel-model-skel").textContent = t("panel.model.noModel");
  }

  if (window.companion?.getState) {
    try {
      applyCompanionState(await window.companion.getState());
    } catch (e) {
      console.warn(e);
    }
  }

  // Diagnostics for AI
  if (window.companion?.getDiagnostics) {
    const diag = await window.companion.getDiagnostics();
    currentDiagnostics = diag;
    document.querySelector(".codex-dot").classList.toggle("on", diag.mcpConfigured);
    document.querySelector(".claude-dot").classList.toggle("on", Boolean((diag.mcpMatches || []).find((m) => m.tool === "Claude" && m.configured)));
    document.querySelector(".cursor-dot").classList.toggle("on", Boolean((diag.mcpMatches || []).find((m) => m.tool === "Roo / Cline" && m.configured)));
    document.querySelector(".local-dot").classList.toggle("on", diag.apiOk);
    updateBridgeSummary(diag);
  }

  await refreshReminders();

  if (window.companion?.checkUpdates) {
    const update = await window.companion.checkUpdates().catch((error) => ({ error: error.message }));
    const updateBadge = document.getElementById("update-badge");
    if (updateBadge) {
      updateBadge.textContent = update.updateAvailable ? `↑ ${update.latestVersion || ""}` : "✓";
      updateBadge.title = update.error || t("panel.section.updates");
      updateBadge.dataset.status = update.error ? "warn" : update.updateAvailable ? "update" : "ok";
    }
    document.getElementById("update-status").textContent = update.error
      ? update.error
      : t("panel.update.currentLatest", {
        channel: update.channel || "stable",
        current: update.currentVersion || "",
        latest: update.latestVersion || ""
      });
  }
}

function updateBridgeSummary(diag = currentDiagnostics || {}) {
  const value = document.getElementById("panel-api-value");
  const apiOk = Boolean(diag.apiOk);
  const aiOk = Boolean(diag.mcpConfigured || (diag.mcpMatches || []).some((m) => m.configured));
  value.dataset.status = apiOk ? "ok" : "warn";
  value.textContent = apiOk && aiOk
    ? t("panel.bridge.connected")
    : apiOk
      ? t("panel.bridge.apiOnly")
      : t("panel.bridge.offline");
}

function applyCompanionState(state = {}) {
  const dot = document.getElementById("global-status-dot");
  const text = document.getElementById("global-status-text");
  const id = state.state || "idle";
  text.textContent = stateLabel(id);
  dot.title = stateLabel(id);
  dot.className = "dot";
  if (id === "working" || id === "thinking" || id === "running" || id === "reviewing") dot.classList.add("working");
  if (id === "failed") dot.classList.add("failed");
  if (id === "success") dot.classList.add("success");

  const source = state.source || "local";
  document.getElementById("panel-source-value").textContent = sourceDisplayName(source);
  const message = String(state.message || defaultMessageForState(id, source) || "").trim();
  document.getElementById("panel-task-message").textContent = id === "idle"
    ? t("panel.task.none")
    : message || stateLabel(id);
}

async function boot() {
  if (isTauri()) {
    await initTauriBridge();
  }

  await updateState();

  window.companion?.onState?.(applyCompanionState);

  window.companion?.onConfigChanged?.((newConfig) => {
    config = newConfig;
    updateState();
  });
  unsubscribeReminders?.();
  unsubscribeReminders = window.companion?.onReminders?.((reminders) => {
    renderReminderList(reminders || []);
  }) || null;

  document.getElementById("panel-pin").addEventListener("click", async (event) => {
    panelPinned = !panelPinned;
    event.currentTarget.setAttribute("aria-pressed", String(panelPinned));
    event.currentTarget.textContent = panelPinned ? t("panel.pin.pinned") : t("panel.pin.pin");
    await window.companion?.setPanelPinned?.(panelPinned);
  });

  // Controls
  const scaleSlider = document.getElementById("scale-slider");
  scaleSlider.addEventListener("input", (e) => {
    document.getElementById("scale-val").textContent = parseFloat(e.target.value).toFixed(2) + "x";
  });
  scaleSlider.addEventListener("change", (e) => {
    window.companion?.saveSettings?.({ spine: { scale: parseFloat(e.target.value) } });
  });

  document.getElementById("bubble-toggle").addEventListener("change", (e) => {
    window.companion?.saveSettings?.({ ui: { bubbleVisible: e.target.checked } });
  });

  document.getElementById("hud-toggle").addEventListener("change", (e) => {
    window.companion?.saveSettings?.({ ui: { hudVisible: e.target.checked } });
  });

  document.getElementById("bubble-theme").addEventListener("change", (e) => {
    window.companion?.saveSettings?.({ ui: { bubbleBackground: e.target.value } });
    setNativeInteractionLock(false);
  });
  document.querySelectorAll("select").forEach((select) => {
    select.addEventListener("pointerdown", () => setNativeInteractionLock(true));
    select.addEventListener("focus", () => setNativeInteractionLock(true));
    select.addEventListener("focusout", () => setNativeInteractionLock(false));
  });

  // Actions
  document.getElementById("btn-manager").addEventListener("click", () => {
    window.companion?.openManager?.();
    closePanel(true);
  });

  document.getElementById("btn-quit").addEventListener("click", () => {
    window.companion?.quitApp?.();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
  window.addEventListener("focus", () => {
    refreshReminders().catch(console.warn);
  });

  // Tauri owns blur-to-close in Rust so it still works when the WebView itself
  // is not receiving events. Native selects temporarily hold an interaction lock.
  window.addEventListener("blur", () => {
    if (!isTauri() && !panelPinned) {
      closePanel();
    }
  });
}

boot().catch(console.error);
