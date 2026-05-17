import "./manager.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";

const viewContainer = document.getElementById("view-container");
const navButtons = document.querySelectorAll("nav button");
const topbarStatus = document.getElementById("topbar-status");
const modalContainer = document.getElementById("modal-container");

let config = null;
let installedModels = [];
let diagnostics = null;

const downloads = {};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(text) {
  topbarStatus.textContent = text;
}

function showModal(title, bodyText, actionsHTML) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").textContent = bodyText;
  document.getElementById("modal-actions").innerHTML = actionsHTML;
  modalContainer.classList.remove("hidden");
}

function hideModal() {
  modalContainer.classList.add("hidden");
}

window.closeModal = hideModal;

function renderNav() {
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      navButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderView(btn.dataset.view);
    });
  });
}

async function renderView(viewName) {
  viewContainer.innerHTML = "";
  setStatus(`Navigating to ${viewName}...`);

  if (viewName === "library") await renderLibrary();
  else if (viewName === "installed") await renderInstalled();
  else if (viewName === "downloads") renderDownloads();
  else if (viewName === "settings") renderSettings();
  else if (viewName === "diagnostics") await renderDiagnostics();

  setStatus(`Viewing ${viewName}`);
}

async function renderLibrary() {
  const catalog = config?.models?.catalog || [];
  try {
    installedModels = await window.companion?.getInstalledModels?.() || [];
  } catch(e) { console.warn(e); }

  let html = `<h2 class="view-title">Library</h2><div class="grid-2">`;

  catalog.forEach(model => {
    const isInstalled = installedModels.some(m => m.id === model.id);
    const download = downloads[model.id];
    let badge = "";
    let btnHtml = "";

    if (isInstalled) {
      badge = `<span class="badge installed">Installed</span>`;
      btnHtml = `<button disabled>Installed</button>`;
    } else if (download && download.status === "downloading") {
      badge = `<span class="badge downloading">Downloading</span>`;
      btnHtml = `<button disabled>Downloading...</button>`;
    } else {
      btnHtml = `<button class="primary dl-btn" data-id="${model.id}">Download</button>`;
    }

    html += `
      <div class="model-card">
        <div class="model-preview">NO PREVIEW</div>
        <div class="model-info">
          <div class="model-title" title="${escapeHtml(model.name || model.id)}">${escapeHtml(model.name || model.id)}</div>
          <div class="model-meta">Source: ${escapeHtml(model.source || 'Unknown')}</div>
          <div class="model-actions">
            ${badge}
            <div style="flex:1"></div>
            ${btnHtml}
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  viewContainer.innerHTML = html;

  viewContainer.querySelectorAll(".dl-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.dataset.id;
      const model = catalog.find(m => m.id === id);

      if (model.licenseNote) {
        window.confirmDownload = () => {
          hideModal();
          startDownload(id);
        };
        showModal("License Information", model.licenseNote + "\n\nDo you want to proceed?", `
          <button onclick="closeModal()">Cancel</button>
          <button class="primary" onclick="confirmDownload()">Accept & Download</button>
        `);
      } else {
        startDownload(id);
      }
    });
  });
}

async function startDownload(id) {
  downloads[id] = { status: "pending", current: 0, total: 1, file: "Initializing..." };
  renderView(document.querySelector("nav button.active").dataset.view); // re-render current view

  try {
    const result = await window.companion?.importModel?.({ id });
    downloads[id] = { status: "succeeded", current: 1, total: 1, file: "Done" };
    // Reload config to get new active skel if it applies
    config = await window.companion?.getConfig?.() || config;
  } catch (err) {
    downloads[id] = { status: "failed", error: err.message || "Download Failed" };
  }

  // Re-render if we are still on library or downloads
  const activeView = document.querySelector("nav button.active").dataset.view;
  if (activeView === "library" || activeView === "downloads") {
    renderView(activeView);
  }
}

async function renderInstalled() {
  try {
    installedModels = await window.companion?.getInstalledModels?.() || [];
  } catch(e) { console.warn(e); }

  const activeAssetDir = config?.spine?.assetDir || "";

  let html = `<h2 class="view-title">Installed Models</h2><div class="grid-2">`;

  if (installedModels.length === 0) {
    html += `<div style="color:var(--text-muted);font-size:13px;">No models installed.</div>`;
  }

  installedModels.forEach(m => {
    // Normalizing paths is tricky, just check if it ends with the id
    const isActive = activeAssetDir.replace(/\\/g, '/').endsWith(m.id);

    html += `
      <div class="model-card">
        <div class="model-preview">NO PREVIEW</div>
        <div class="model-info">
          <div class="model-title" title="${escapeHtml(m.id)}">${escapeHtml(m.id)}</div>
          <div class="model-meta" title="${escapeHtml(m.dir)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(m.dir)}
          </div>
          <div class="model-actions">
            ${isActive ? `<span class="badge installed">Active</span>` : ''}
            <div style="flex:1"></div>
            <button class="open-btn" data-path="${escapeHtml(m.dir.replace(/\\/g, '\\\\'))}">Open Folder</button>
            <button class="danger rm-btn" data-id="${escapeHtml(m.id)}" ${isActive ? 'disabled title="Cannot remove active model"' : ''}>Remove</button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  viewContainer.innerHTML = html;

  viewContainer.querySelectorAll(".open-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      await window.companion?.openFolder?.(e.target.dataset.path);
    });
  });

  viewContainer.querySelectorAll(".rm-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      window.confirmRemove = async () => {
        hideModal();
        setStatus(`Removing ${id}...`);
        await window.companion?.removeModel?.(id);
        renderView("installed");
      };
      showModal("Remove Model", `Are you sure you want to completely remove the model '${id}' from your disk?`, `
        <button onclick="closeModal()">Cancel</button>
        <button class="danger" onclick="confirmRemove()">Remove</button>
      `);
    });
  });
}

function renderDownloads() {
  let html = `<h2 class="view-title">Downloads</h2><div class="grid-2">`;
  const dlKeys = Object.keys(downloads);

  if (dlKeys.length === 0) {
    html += `<div style="color:var(--text-muted);font-size:13px;">No active downloads.</div>`;
  }

  dlKeys.forEach(id => {
    const dl = downloads[id];
    let percent = 0;
    if (dl.total > 0) percent = Math.round((dl.current / dl.total) * 100);

    let statusColor = "var(--text-muted)";
    if (dl.status === "succeeded") statusColor = "var(--accent)";
    if (dl.status === "failed") statusColor = "var(--danger)";

    html += `
      <div class="download-card">
        <div class="download-title">${escapeHtml(id)}</div>
        <div class="download-meta">
          <span style="color:${statusColor}">${escapeHtml(dl.status.toUpperCase())}</span>
          <span>${escapeHtml(dl.file || '')}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${percent}%; background: ${statusColor}"></div>
        </div>
        ${dl.error ? `<div style="color:var(--danger);font-size:11px;margin-top:8px;">${escapeHtml(dl.error)}</div>` : ''}
        ${dl.status === "failed" ? `<div style="margin-top:8px;text-align:right;"><button class="retry-btn" data-id="${escapeHtml(id)}">Retry</button></div>` : ''}
      </div>
    `;
  });

  html += `</div>`;
  viewContainer.innerHTML = html;

  viewContainer.querySelectorAll(".retry-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      startDownload(e.target.dataset.id);
    });
  });
}

function renderSettings() {
  const ui = config.ui || {};
  const spine = config.spine || {};

  viewContainer.innerHTML = `
    <h2 class="view-title">Settings</h2>

    <div class="card">
      <h3 class="modal-title">Spine Rendering</h3>
      <div class="form-group">
        <label>Scale</label>
        <input type="number" id="set-scale" value="${spine.scale || 1}" step="0.05">
      </div>
      <div class="form-group">
        <label>Offset X</label>
        <input type="number" id="set-offset-x" value="${spine.offsetX || 0}">
      </div>
      <div class="form-group">
        <label>Offset Y</label>
        <input type="number" id="set-offset-y" value="${spine.offsetY || 0}">
      </div>
      <div style="margin-top: 8px;">
        <button id="save-spine-settings" class="primary">Save Configuration</button>
      </div>
    </div>

    <div class="card">
      <h3 class="modal-title">User Interface</h3>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="set-hud" ${ui.hudVisible !== false ? 'checked' : ''}>
          Show Status Panel
        </label>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="set-bubble" ${ui.bubbleVisible !== false ? 'checked' : ''}>
          Show Progress Bubble
        </label>
      </div>
      <div class="form-group">
        <label>Bubble Theme</label>
        <select id="set-bubble-bg">
          <option value="solid" ${ui.bubbleBackground === 'solid' ? 'selected' : ''}>Solid</option>
          <option value="soft" ${ui.bubbleBackground === 'soft' ? 'selected' : ''}>Soft</option>
          <option value="clear" ${ui.bubbleBackground === 'clear' ? 'selected' : ''}>Clear</option>
          <option value="light" ${ui.bubbleBackground === 'light' ? 'selected' : ''}>Light</option>
        </select>
      </div>
    </div>
  `;

  const hudCheck = document.getElementById("set-hud");
  const bubbleCheck = document.getElementById("set-bubble");
  const bgSelect = document.getElementById("set-bubble-bg");

  hudCheck.addEventListener("change", () => window.companion?.saveSettings?.({ ui: { hudVisible: hudCheck.checked } }));
  bubbleCheck.addEventListener("change", () => window.companion?.saveSettings?.({ ui: { bubbleVisible: bubbleCheck.checked } }));
  bgSelect.addEventListener("change", () => window.companion?.saveSettings?.({ ui: { bubbleBackground: bgSelect.value } }));

  document.getElementById("save-spine-settings").addEventListener("click", async () => {
    const scale = parseFloat(document.getElementById("set-scale").value) || 1;
    const offsetX = parseFloat(document.getElementById("set-offset-x").value) || 0;
    const offsetY = parseFloat(document.getElementById("set-offset-y").value) || 0;
    try {
      setStatus("Saving settings...");
      await window.companion?.saveSettings?.({ spine: { scale, offsetX, offsetY } });
      setStatus("Settings saved and hot-reloaded.");
    } catch (e) {
      console.error(e);
      setStatus("Failed to save settings.");
    }
  });
}

async function renderDiagnostics() {
  viewContainer.innerHTML = `<h2 class="view-title">Diagnostics</h2><div style="color:var(--text-muted);font-size:13px;">Running checks...</div>`;

  try {
    diagnostics = await window.companion?.getDiagnostics?.() || {};
  } catch(e) {
    console.error(e);
    diagnostics = { error: e.message };
  }

  const diag = diagnostics;

  const makeStatus = (cond, okText, errText) =>
    `<span class="status-value ${cond ? 'status-ok' : 'status-err'}">${cond ? okText : errText}</span>`;

  viewContainer.innerHTML = `
    <h2 class="view-title">Diagnostics</h2>
    <div class="card">
      <div class="status-row">
        <span class="status-label">Local API Health</span>
        ${makeStatus(diag.apiOk, "ONLINE", "UNREACHABLE")}
      </div>
      <div class="status-row">
        <span class="status-label">Codex MCP Configured</span>
        ${makeStatus(diag.mcpConfigured, "YES", "NO")}
      </div>
      <div class="status-row">
        <span class="status-label">Local Config (companion.local.json)</span>
        ${makeStatus(diag.localConfigExists, "FOUND", "MISSING")}
      </div>
      <div class="status-row">
        <span class="status-label">Asset Directory Validity</span>
        ${makeStatus(diag.assetDirExists, "VALID", "INVALID OR MISSING")}
      </div>
      <div class="status-row">
        <span class="status-label">Skeleton (.skel)</span>
        ${makeStatus(diag.hasSkel, "FOUND", "MISSING")}
      </div>
      <div class="status-row">
        <span class="status-label">Atlas (.atlas)</span>
        ${makeStatus(diag.hasAtlas, "FOUND", "MISSING")}
      </div>
      <div class="status-row">
        <span class="status-label">Texture (.png)</span>
        ${makeStatus(diag.hasPng, "FOUND", "MISSING")}
      </div>
    </div>
  `;
}

async function boot() {
  if (isTauri()) {
    await initTauriBridge();
  }

  try {
    if (window.companion?.getConfig) {
      config = await window.companion.getConfig();
    } else {
      config = { models: { catalog: [] } };
    }
  } catch (e) {
    console.error("Failed to get config", e);
    config = { models: { catalog: [] } };
  }

  // Listen for download progress
  window.companion?.onDownloadProgress?.((p) => {
    if (!downloads[p.id]) downloads[p.id] = { status: "downloading" };
    downloads[p.id].current = p.current;
    downloads[p.id].total = p.total;
    downloads[p.id].file = p.file;
    downloads[p.id].status = "downloading";

    const activeView = document.querySelector("nav button.active")?.dataset.view;
    if (activeView === "downloads") renderView("downloads");
  });

  renderNav();
  renderView("library");
}

boot().catch(console.error);
