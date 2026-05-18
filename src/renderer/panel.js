import "./panel.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { modelPreview } from "./model-preview.js";

let config = null;
const quickStates = ["idle", "working", "running", "reviewing", "success", "failed"];

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
    const preview = modelPreview(activeModel);
    const previewEl = document.getElementById("panel-model-preview");
    previewEl.textContent = preview.initials;
    Object.assign(previewEl.style, preview.style);
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

  if (window.companion?.getHistory) {
    const history = await window.companion.getHistory();
    document.getElementById("reminder-list").textContent = history.slice(-1)[0]?.message || "No active reminder";
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
    window.close(); // Close panel
  });

  document.getElementById("btn-quit").addEventListener("click", () => {
    window.companion?.quitApp?.();
  });

  // Close panel on blur
  window.addEventListener("blur", () => {
    if (isTauri()) {
       // Only close in production or explicitly requested, otherwise DevTools might close it
       // window.close();
    }
  });
}

boot().catch(console.error);
