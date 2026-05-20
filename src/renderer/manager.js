import "./manager.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { h, render } from "./lib/dom.js";
import { createI18n, t } from "../shared/i18n.js";
import { modelPreview } from "./model-preview.js";

const viewContainer = document.getElementById("view-container");
const navButtons = document.querySelectorAll("nav button");
const topbarStatus = document.getElementById("topbar-status");
const modalContainer = document.getElementById("modal-container");

let activeView = "library";
let config = { models: { catalog: [] }, ui: {}, spine: {} };
let installedModels = [];
let diagnostics = null;
let history = [];
let updateStatus = null;
const downloads = {};

function setStatus(text) {
  topbarStatus.textContent = text;
}

function closeModal() {
  modalContainer.classList.add("hidden");
  document.getElementById("modal-actions").replaceChildren();
}

function showModal(title, bodyText, actions = []) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").textContent = bodyText;
  document.getElementById("modal-actions").replaceChildren(...actions);
  modalContainer.classList.remove("hidden");
}

function navTo(viewName) {
  activeView = viewName;
  for (const button of navButtons) button.classList.toggle("active", button.dataset.view === viewName);
  renderView(viewName);
}

function catalogModel(id) {
  return (config.models?.catalog || []).find((model) => model.id === id) || {};
}

function mergedModel(model) {
  return { ...catalogModel(model.id), ...model };
}

function previewNode(model) {
  const preview = modelPreview(model, config);
  const fallback = h("span", {}, preview.initials);
  const children = [fallback];
  if (preview.imageUrl) {
    children.unshift(h("img", {
      src: preview.imageUrl,
      alt: "",
      loading: "lazy",
      onError: (event) => {
        event.currentTarget.parentElement?.classList.remove("has-image");
        event.currentTarget.remove();
      }
    }));
  }
  return h("div", { class: `model-preview ${preview.imageUrl ? "has-image" : ""}`, style: preview.style, "aria-label": `Preview for ${preview.label}` },
    children
  );
}

function badge(label, tone = "") {
  return h("span", { class: `badge ${tone}`.trim() }, label);
}

async function refreshConfig() {
  config = await window.companion?.getConfig?.() || config;
  createI18n(config);
  document.body.dataset.theme = config.ui?.theme || "dark";
  for (const button of navButtons) {
    button.textContent = t(`manager.nav.${button.dataset.view}`);
  }
  installedModels = await window.companion?.getInstalledModels?.() || [];
}

async function refreshUpdateStatus({ silent = false } = {}) {
  try {
    updateStatus = await window.companion?.checkUpdates?.();
    if (!silent) {
      setStatus(updateStatus?.updateAvailable
        ? t("manager.status.updateAvailable", { version: updateStatus.latestVersion })
        : t("manager.status.upToDate", { version: updateStatus?.currentVersion || "" }));
    }
  } catch (error) {
    updateStatus = { error: error.message || "Update check failed" };
    if (!silent) setStatus(updateStatus.error);
  }
  return updateStatus;
}

async function openUpdateTarget() {
  const url = updateStatus?.downloadUrl || updateStatus?.recommendedAsset?.url || updateStatus?.url;
  if (!url) return;
  await window.companion?.openExternal?.(url);
}

function isInstalled(id) {
  return installedModels.some((model) => model.id === id);
}

function activeInstalledId() {
  const active = String(config.spine?.assetDir || "").replace(/\\/g, "/");
  return installedModels.find((model) => active.endsWith(`/${model.id}`) || active.endsWith(model.id))?.id || "";
}

async function startDownload(id) {
  downloads[id] = { status: "pending", current: 0, total: 1, file: "Initializing..." };
  renderView(activeView);
  try {
    const result = await window.companion?.importModel?.({ id });
    downloads[id] = { status: "succeeded", current: 1, total: 1, file: "Done" };
    await refreshConfig();
    setStatus(t("manager.status.loadedModel", { name: result.name || id }));
  } catch (error) {
    downloads[id] = { status: "failed", error: error.message || "Download failed", current: 0, total: 1 };
    setStatus(t("manager.status.downloadFailed", { id }));
  }
  if (activeView === "library" || activeView === "downloads" || activeView === "installed") renderView(activeView);
}

function libraryView() {
  const catalog = config.models?.catalog || [];
  const search = h("input", {
    class: "input",
    type: "search",
    placeholder: t("manager.search.placeholder"),
    "aria-label": t("manager.search.placeholder"),
    onInput: () => renderCards(search.value)
  });
  const grid = h("div", { class: "grid-2" });

  function renderCards(query = "") {
    const normalized = query.trim().toLowerCase();
    const cards = catalog
      .filter((model) => !normalized || `${model.name} ${model.id} ${model.source}`.toLowerCase().includes(normalized))
      .map((model) => {
        const download = downloads[model.id];
        const installed = isInstalled(model.id);
        const active = activeInstalledId() === model.id;
        const button = installed
          ? h("button", {
              class: "btn",
              type: "button",
              disabled: active,
              onClick: () => activateModel(model.id)
            }, active ? "Active" : t("manager.actions.setActive"))
          : h("button", {
              class: "btn btn-primary",
              type: "button",
              disabled: download?.status === "downloading",
              onClick: () => confirmDownload(model)
            }, download?.status === "downloading" ? "Downloading..." : t("manager.actions.download"));
        return h("article", { class: "model-card fade-in" },
          previewNode(model),
          h("div", { class: "model-info" },
            h("div", { class: "model-title", title: model.name || model.id }, model.name || model.id),
            h("div", { class: "model-meta" }, t("manager.model.source", { source: model.source || "Unknown" })),
            h("div", { class: "model-actions" },
              installed ? badge(t("manager.status.installed"), "badge-success") : null,
              active ? badge(t("manager.status.active"), "badge-warning") : null,
              h("div", { style: { flex: "1" } }),
              button
            )
          )
        );
      });
    grid.replaceChildren(...cards);
  }

  renderCards();
  return h("section", {},
    h("div", { class: "view-header" },
      h("h2", { class: "view-title" }, t("manager.library.title")),
      search
    ),
    grid
  );
}

function confirmDownload(model) {
  const proceed = h("button", { class: "btn btn-primary", type: "button", onClick: () => {
    closeModal();
    startDownload(model.id);
  } }, t("manager.actions.acceptDownload"));
  const cancel = h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel"));
  if (model.licenseNote) showModal(t("manager.modal.licenseTitle"), t("manager.modal.licensePrompt", { note: model.licenseNote }), [cancel, proceed]);
  else startDownload(model.id);
}

async function activateModel(id) {
  setStatus(t("manager.status.activating", { id }));
  await window.companion?.setActiveModel?.(id);
  await refreshConfig();
  renderView(activeView);
}

async function importLocalModel() {
  if (!window.companion?.importLocalModel) {
    setStatus(t("manager.status.localImportUnavailable"));
    return;
  }
  try {
    const result = await window.companion.importLocalModel();
    if (result?.canceled) return;
    await refreshConfig();
    setStatus(t("manager.status.localModelLoaded", { name: result.skel || result.name }));
    renderView(activeView);
  } catch (error) {
    const message = error.message || "Local import failed";
    setStatus(message);
    showModal(t("manager.modal.importFailed"), message, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

function installedView() {
  const active = activeInstalledId();
  const content = installedModels.length
    ? installedModels.map((model) => h("article", { class: "model-card fade-in" },
        previewNode(mergedModel(model)),
        h("div", { class: "model-info" },
          h("div", { class: "model-title", title: model.id }, model.id),
          h("div", { class: "model-meta", title: model.dir }, model.dir),
          h("div", { class: "model-actions" },
            model.id === active ? badge(t("manager.status.active"), "badge-warning") : null,
            h("div", { style: { flex: "1" } }),
            h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(model.dir) }, t("manager.actions.openFolder")),
            h("button", { class: "btn", type: "button", disabled: model.id === active, onClick: () => activateModel(model.id) }, t("manager.actions.setActive")),
            h("button", { class: "btn btn-danger", type: "button", disabled: model.id === active, onClick: () => confirmRemove(model.id) }, t("manager.actions.remove"))
          )
        )
      ))
    : [h("p", { class: "empty-text" }, t("manager.empty.noModels"))];
  return h("section", {},
    h("h2", { class: "view-title" }, t("manager.installed.title")),
    h("div", { class: "grid-2" }, content)
  );
}

function confirmRemove(id) {
  showModal(t("manager.modal.removeTitle"), t("manager.modal.removePrompt", { id }), [
    h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
    h("button", { class: "btn btn-danger", type: "button", onClick: async () => {
      closeModal();
      await window.companion?.removeModel?.(id);
      await refreshConfig();
      renderView("installed");
    } }, "Remove")
  ]);
}

function downloadsView() {
  const keys = Object.keys(downloads);
  const cards = keys.length ? keys.map((id) => {
    const dl = downloads[id];
    const total = Number(dl.total || 1);
    const percent = Math.max(0, Math.min(100, Math.round((Number(dl.current || 0) / total) * 100)));
    return h("article", { class: "download-card fade-in" },
      h("div", { class: "download-title" }, id),
      h("div", { class: "download-meta" }, `${String(dl.status || "pending").toUpperCase()} ${dl.file || ""}`),
      h("div", { class: "progress-bar" }, h("div", { class: "progress-fill", style: { width: `${percent}%` } })),
      dl.error ? h("div", { class: "error-text" }, dl.error) : null,
      dl.status === "failed" ? h("button", { class: "btn", type: "button", onClick: () => startDownload(id) }, t("manager.actions.retry")) : null
    );
  }) : [h("p", { class: "empty-text" }, t("manager.empty.noDownloads"))];
  return h("section", {}, h("h2", { class: "view-title" }, t("manager.downloads.title")), h("div", { class: "grid-2" }, cards));
}

function settingsView() {
  const ui = config.ui || {};
  const spine = config.spine || {};
  const saveSpine = async () => {
    await window.companion?.saveSettings?.({
      spine: {
        scale: Number(document.getElementById("set-scale").value || 1),
        offsetX: Number(document.getElementById("set-offset-x").value || 0),
        offsetY: Number(document.getElementById("set-offset-y").value || 0)
      }
    });
    config = await window.companion?.getConfig?.() || config;
    setStatus(t("manager.status.settingsSaved"));
  };
  const saveUi = (patch) => window.companion?.saveSettings?.({ ui: patch });
  return h("section", {},
    h("h2", { class: "view-title" }, t("manager.settings.title")),
    h("div", { class: "settings-grid" },
      h("article", { class: "card form-card" },
        h("h3", {}, t("manager.section.spine")),
        h("button", { class: "btn", type: "button", onClick: importLocalModel }, t("manager.actions.importLocal")),
        field(t("manager.field.scale"), h("input", { class: "input", id: "set-scale", type: "number", step: "0.05", value: spine.scale || 1 })),
        field(t("manager.field.offsetX"), h("input", { class: "input", id: "set-offset-x", type: "number", value: spine.offsetX || 0 })),
        field(t("manager.field.offsetY"), h("input", { class: "input", id: "set-offset-y", type: "number", value: spine.offsetY || 0 })),
        h("button", { class: "btn btn-primary", type: "button", onClick: saveSpine }, t("manager.actions.saveConfiguration"))
      ),
      h("article", { class: "card form-card" },
        h("h3", {}, t("manager.section.interface")),
        check(t("manager.field.showStatusPanel"), ui.hudVisible !== false, (checked) => saveUi({ hudVisible: checked })),
        check(t("manager.field.showProgressBubble"), ui.bubbleVisible !== false, (checked) => saveUi({ bubbleVisible: checked })),
        check(t("manager.field.autoShowCodex"), ui.autoRevealOnMcp !== false, (checked) => saveUi({ autoRevealOnMcp: checked })),
        check(t("manager.field.bubbleShadow"), ui.bubbleShadow !== false, (checked) => saveUi({ bubbleShadow: checked })),
        field(t("manager.field.bubbleTheme"), h("select", { class: "select", value: ui.bubbleBackground || "solid", onChange: (e) => saveUi({ bubbleBackground: e.target.value }) },
          ["solid", "soft", "clear", "light"].map((value) => h("option", { value, selected: (ui.bubbleBackground || "solid") === value }, value))
        )),
        field(t("manager.field.theme"), h("select", { class: "select", value: ui.theme || "dark", onChange: (e) => saveUi({ theme: e.target.value }) },
          h("option", { value: "dark" }, t("manager.option.dark")),
          h("option", { value: "light" }, t("manager.option.light"))
        )),
        field(t("manager.field.locale"), h("select", { class: "select", value: ui.locale || "auto", onChange: (e) => saveUi({ locale: e.target.value }) },
          h("option", { value: "auto" }, t("manager.option.auto")),
          h("option", { value: "en" }, "English"),
          h("option", { value: "zh-CN" }, "中文")
        ))
      )
    )
  );
}

function field(label, control) {
  return h("label", { class: "form-group" }, h("span", {}, label), control);
}

function check(label, checked, onChange) {
  return h("label", { class: "checkbox-label" },
    h("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked) }),
    h("span", {}, label)
  );
}

async function diagnosticsView() {
  diagnostics = await window.companion?.getDiagnostics?.() || {};
  history = await window.companion?.getHistory?.() || [];
  if (!updateStatus) await refreshUpdateStatus({ silent: true });
  const row = (label, ok, value) => h("div", { class: "status-row" },
    h("span", { class: "status-label" }, label),
    h("span", { class: ok ? "status-value status-ok" : "status-value status-err" }, value || (ok ? "OK" : "Needs attention"))
  );
  return h("section", {},
    h("h2", { class: "view-title" }, t("manager.diagnostics.title")),
    h("div", { class: "grid-2" },
      h("article", { class: "card diag-card" },
        row(t("manager.diagnostics.localApi"), diagnostics.apiOk, diagnostics.apiOk ? "ONLINE" : "UNREACHABLE"),
        row(t("manager.diagnostics.mcpConfigured"), diagnostics.mcpConfigured, diagnostics.mcpConfigured ? "YES" : "NO"),
        row(t("manager.diagnostics.localConfig"), diagnostics.localConfigExists, diagnostics.localConfigExists ? "FOUND" : "MISSING"),
        diagnostics.localConfigPath ? h("p", { class: "model-meta", title: diagnostics.localConfigPath }, diagnostics.localConfigPath) : null,
        ...(diagnostics.configWarnings || []).map((warning) => h("p", { class: "error-text", title: warning.file }, `Config warning: ${warning.message}`)),
        row(t("manager.diagnostics.spineAssets"), diagnostics.assetDirExists && diagnostics.hasSkel && diagnostics.hasAtlas && diagnostics.hasPng, "skel / atlas / png"),
        h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(config.paths?.configDir) }, "Open Config Folder")
      ),
      h("article", { class: "card diag-card" },
        h("h3", {}, t("manager.diagnostics.updates")),
        h("p", { class: "model-meta" }, updateStatus?.error || `Current ${updateStatus?.currentVersion || ""}, latest ${updateStatus?.latestVersion || ""}`),
        updateStatus?.recommendedAsset
          ? h("p", { class: "model-meta" }, t("manager.diagnostics.recommended", { name: updateStatus.recommendedAsset.name }))
          : null,
        h("div", { class: "model-actions" },
          h("button", { class: "btn", type: "button", onClick: async () => {
            await refreshUpdateStatus();
            renderView("diagnostics");
          } }, t("manager.actions.checkAgain")),
          updateStatus?.downloadUrl || updateStatus?.url
            ? h("button", { class: "btn btn-primary", type: "button", onClick: openUpdateTarget },
                updateStatus?.recommendedAsset ? t("manager.actions.downloadForDevice") : t("manager.actions.openRelease"))
            : null
        )
      ),
      h("article", { class: "card diag-card wide" },
        h("h3", {}, t("manager.diagnostics.history")),
        h("div", { class: "history-list" }, history.slice(-10).reverse().map((item) => h("div", { class: "history-row" },
          h("span", {}, item.state),
          h("span", {}, item.source || "local"),
          h("span", {}, item.updatedAt || "")
        )))
      )
    )
  );
}

async function renderView(viewName) {
  viewContainer.replaceChildren(h("p", { class: "empty-text" }, t("manager.status.loading")));
  setStatus(t("manager.status.viewing", { view: viewName }));
  if (viewName === "library") render(libraryView(), viewContainer);
  else if (viewName === "installed") render(installedView(), viewContainer);
  else if (viewName === "downloads") render(downloadsView(), viewContainer);
  else if (viewName === "settings") render(settingsView(), viewContainer);
  else if (viewName === "diagnostics") render(await diagnosticsView(), viewContainer);
}

async function boot() {
  if (isTauri()) await initTauriBridge();
  await refreshConfig();
  refreshUpdateStatus({ silent: true }).then((status) => {
    if (status?.updateAvailable) {
      setStatus(t("manager.status.updateAvailable", { version: status.latestVersion }));
    }
    if (activeView === "diagnostics") renderView("diagnostics");
  });
  for (const button of navButtons) button.addEventListener("click", () => navTo(button.dataset.view));
  modalContainer.addEventListener("click", (event) => {
    if (event.target === modalContainer) closeModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
  window.companion?.onDownloadProgress?.((p) => {
    downloads[p.id] = { ...(downloads[p.id] || {}), ...p, status: p.status || "downloading" };
    if (activeView === "downloads" || activeView === "library") renderView(activeView);
  });
  window.companion?.onConfigChanged?.(async (nextConfig) => {
    config = nextConfig || await window.companion?.getConfig?.() || config;
    createI18n(config);
    if (activeView === "settings" || activeView === "installed" || activeView === "library") renderView(activeView);
  });
  navTo("library");
}

boot().catch((error) => {
  setStatus(error.message);
  render(h("section", { class: "card form-card", role: "alert" }, h("strong", {}, "Manager failed"), h("p", {}, error.message)), viewContainer);
});
