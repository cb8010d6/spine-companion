import "./panel.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { modelPreview } from "./model-preview.js";

let config = null;
let panelPinned = false;
const quickStates = ["idle", "working", "running", "reviewing", "success", "failed"];

function renderPreview(previewEl, preview) {
  previewEl.replaceChildren();
  previewEl.classList.toggle("has-image", Boolean(preview.imageUrl));
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
}

async function closePanel(force = false) {
  if (panelPinned && !force) return;
  if (isTauri()) {
    await window.companion?.closePanel?.();
    return;
  }
  window.close();
}

function renderReminderList(reminders = []) {
  const list = document.getElementById("reminder-list");
  if (!reminders.length) {
    list.textContent = "No reminders";
    return;
  }
  list.replaceChildren(...reminders.slice().sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).map((reminder) => {
    const item = document.createElement("div");
    item.className = "reminder-item";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = reminder.text || "Reminder";
    const meta = document.createElement("span");
    meta.textContent = `${reminder.fired ? "Fired" : "Due"} ${reminder.dueAt || ""}`;
    info.append(title, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      await window.companion?.deleteReminder?.(reminder.id);
      renderReminderList(await window.companion?.listReminders?.() || []);
    });
    item.append(info, remove);
    return item;
  }));
}

async function updateState() {
  try {
    if (window.companion?.getConfig) {
      config = await window.companion.getConfig();
    }
  } catch(e) { console.warn(e); return; }

  if (!config) return;

  const spine = config.spine || {};
  const ui = config.ui || {};

  document.getElementById("scale-slider").value = spine.scale || 1;
  document.getElementById("scale-val").textContent = parseFloat(spine.scale || 1).toFixed(2) + "x";

  document.getElementById("bubble-toggle").checked = ui.bubbleVisible !== false;
  document.getElementById("hud-toggle").checked = ui.hudVisible !== false;
  document.getElementById("bubble-theme").value = ui.bubbleBackground || "solid";

  // Active Model Info
  if (spine.skel) {
    const catalog = config.models?.catalog || [];
    const activeModel = catalog.find(m => spine.skel.includes(m.skel)) || { name: spine.skel.split('/').pop() };
    document.getElementById("panel-model-name").textContent = activeModel.name;
    document.getElementById("panel-model-skel").textContent = spine.skel;
    const preview = modelPreview(activeModel, config);
    const previewEl = document.getElementById("panel-model-preview");
    renderPreview(previewEl, preview);
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
    document.querySelector(".codex-dot").classList.toggle("on", diag.mcpConfigured);
    document.querySelector(".claude-dot").classList.toggle("on", Boolean((diag.mcpMatches || []).find((m) => m.tool === "Claude" && m.configured)));
    document.querySelector(".cursor-dot").classList.toggle("on", Boolean((diag.mcpMatches || []).find((m) => m.tool === "Roo / Cline" && m.configured)));
    document.querySelector(".local-dot").classList.toggle("on", diag.apiOk);
  }

  if (window.companion?.listReminders) {
    renderReminderList(await window.companion.listReminders());
  }

  if (window.companion?.checkUpdates) {
    const update = await window.companion.checkUpdates().catch((error) => ({ error: error.message }));
    document.getElementById("update-status").textContent = update.error
      ? update.error
      : `Current ${update.currentVersion || ""}, latest ${update.latestVersion || ""}`;
  }
}

function applyCompanionState(state = {}) {
  const dot = document.getElementById("global-status-dot");
  const text = document.getElementById("global-status-text");
  const id = state.state || "idle";
  text.textContent = id;
  dot.className = "dot";
  if (id === "working" || id === "thinking" || id === "running" || id === "reviewing") dot.classList.add("working");
  if (id === "failed") dot.classList.add("failed");
}

async function boot() {
  if (isTauri()) {
    await initTauriBridge();
  }

  await updateState();

  const quickStateSection = document.getElementById("quick-state-section");
  quickStateSection.replaceChildren(...quickStates.map((state) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = state;
    button.addEventListener("click", () => window.companion?.setState?.({ state, source: "quick-panel" }));
    return button;
  }));

  window.companion?.onState?.(applyCompanionState);

  window.companion?.onConfigChanged?.((newConfig) => {
    config = newConfig;
    updateState();
  });

  document.getElementById("panel-pin").addEventListener("click", async (event) => {
    panelPinned = !panelPinned;
    event.currentTarget.setAttribute("aria-pressed", String(panelPinned));
    event.currentTarget.textContent = panelPinned ? "Pinned" : "Pin";
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

  // Close panel on blur so it behaves like a tray flyout.
  window.addEventListener("blur", () => {
    if (isTauri() && !panelPinned) {
      closePanel();
    }
  });
}

boot().catch(console.error);
