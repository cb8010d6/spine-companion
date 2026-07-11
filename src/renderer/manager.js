import "./manager.css";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { h, render } from "./lib/dom.js";
import { createI18n, t } from "../shared/i18n.js";
import { avatarActionKey, avatarResultToastKey, avatarStatusKey } from "./avatar-ui.js";
import { modelPreview } from "./model-preview.js";
import { renderSpinePreview } from "./spine-preview.js";
import {
  createCoalescedRefresh,
  integrationLabelForState,
  latestCompanionState,
  rendererHealthCategory,
  rendererHealthFromDiagnostics
} from "./dashboard-model.js";

const viewContainer = document.getElementById("view-container");
const navButtons = document.querySelectorAll("nav button");
const topbarStatus = document.getElementById("topbar-status");
const modalContainer = document.getElementById("modal-container");

let activeView = "dashboard";
let config = { models: { catalog: [] }, ui: {}, spine: {} };
let installedModels = [];
let diagnostics = null;
let history = [];
let reminders = [];
let integrations = [];
let updateStatus = null;
let liveState = null;
const downloads = {};
const integrationTestResults = new Map();
let dashboardRenderRevision = 0;

function setStatus(text) {
  topbarStatus.textContent = text;
}

function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = h("div", { class: "toast" }, message);
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function closeModal() {
  modalContainer.classList.add("hidden");
  document.getElementById("modal-actions").replaceChildren();
  document.removeEventListener("keydown", trapModalKeys);
}

function showModal(title, bodyText, actions = []) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").textContent = bodyText;
  document.getElementById("modal-actions").replaceChildren(...actions);
  modalContainer.classList.remove("hidden");
  document.addEventListener("keydown", trapModalKeys);
  window.setTimeout(() => modalContainer.querySelector("button")?.focus(), 0);
}

function trapModalKeys(event) {
  if (modalContainer.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...modalContainer.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
  const node = h("div", { class: `model-preview ${preview.imageUrl ? "has-image" : ""}`, style: preview.style, "aria-label": `Preview for ${preview.label}` },
    children
  );
  if (!preview.imageUrl && preview.canRenderSpinePreview) {
    window.requestAnimationFrame(() => {
      if (node.isConnected) renderSpinePreview(node, preview);
    });
  }
  return node;
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

async function refreshReminders() {
  reminders = await window.companion?.listReminders?.() || [];
  return reminders;
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

function activeModelLabel() {
  const id = activeInstalledId();
  const model = installedModels.find((item) => item.id === id) || catalogModel(id);
  return model?.name || id || config.spine?.skel || t("panel.model.noModel");
}

async function dashboardView({ refreshData = true } = {}) {
  if (refreshData) {
    diagnostics = await window.companion?.getDiagnostics?.() || diagnostics || {};
    history = await window.companion?.getHistory?.() || history || [];
    reminders = await window.companion?.listReminders?.() || reminders || [];
    integrations = await window.companion?.listAiIntegrations?.() || integrations || [];
    if (!updateStatus) await refreshUpdateStatus({ silent: true });
  }
  const lastState = latestCompanionState(liveState, history);
  const configuredIntegrations = integrations.filter((item) => item.configured);
  const sourceLabel = integrationLabelForState(lastState, integrations);
  const rendererHealth = rendererHealthFromDiagnostics(diagnostics);
  const rendererStatus = t(`manager.dashboard.rendererStatus.${rendererHealthCategory(rendererHealth.status)}`);
  const bridgeReady = diagnostics.apiOk && diagnostics.mcpConfigured;
  const bridgeValue = bridgeReady
    ? t("manager.dashboard.connectionReady")
    : diagnostics.apiOk
      ? t("manager.dashboard.connectionWaiting")
      : t("manager.dashboard.connectionOffline");
  const bridgeDetail = bridgeReady
    ? t("manager.dashboard.connectionReadyDetail")
    : diagnostics.apiOk
      ? t("manager.dashboard.connectionWaitingDetail")
      : t("manager.dashboard.connectionOfflineDetail");
  const card = (title, value, detail, actions = []) => h("article", { class: "card dashboard-card" },
    h("div", { class: "dashboard-card-title" }, title),
    h("div", { class: "dashboard-card-value" }, value || "-"),
    detail ? h("p", { class: "model-meta" }, detail) : null,
    actions.length ? h("div", { class: "model-actions" }, actions) : null
  );
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.dashboard.title")),
        h("p", { class: "empty-text" }, t("manager.dashboard.subtitle"))
      )
    ),
    h("div", { class: "grid-2" },
      card(t("manager.dashboard.model"), activeModelLabel(), config.spine?.assetDir || "", [
        h("button", { class: "btn", type: "button", onClick: () => navTo("library") }, t("manager.dashboard.openLibrary"))
      ]),
      card(t("manager.dashboard.ai"), sourceLabel || configuredIntegrations[0]?.sourceLabel || t("manager.dashboard.local"), lastState.message || t("manager.dashboard.noActiveTask"), [
        h("button", { class: "btn", type: "button", onClick: () => navTo("integrations") }, t("manager.dashboard.openIntegrations"))
      ]),
      card(t("manager.dashboard.bridge"), bridgeValue, bridgeDetail),
      card(t("manager.dashboard.reminders"), String(reminders.length), reminders[0]?.message || t("manager.empty.noReminders")),
      card(t("manager.dashboard.updates"), updateStatus?.updateAvailable ? t("manager.status.updateAvailable", { version: updateStatus.latestVersion }) : t("manager.status.upToDate", { version: updateStatus?.currentVersion || config.version || "" }), updateStatus?.channel || "stable"),
      card(t("manager.dashboard.renderer"), rendererStatus, rendererHealth.recoveryCount > 0
        ? t("manager.dashboard.rendererRecovered", { count: rendererHealth.recoveryCount })
        : t("manager.dashboard.rendererHealthyDetail"))
    )
  );
}

async function renderDashboard({ refreshData = true, showLoading = true } = {}) {
  const revision = ++dashboardRenderRevision;
  if (showLoading) {
    viewContainer.replaceChildren(h("p", { class: "empty-text" }, t("manager.status.loading")));
  }
  const content = await dashboardView({ refreshData });
  if (revision !== dashboardRenderRevision || activeView !== "dashboard") return;
  render(content, viewContainer);
}

const dashboardRefresh = createCoalescedRefresh(() => {
  if (activeView === "dashboard") {
    renderDashboard({ refreshData: false, showLoading: false });
  }
});

async function startDownload(id) {
  downloads[id] = { status: "pending", current: 0, total: 1, file: "Initializing..." };
  renderView(activeView);
  try {
    const result = await window.companion?.importModel?.({ id });
    downloads[id] = { ...(downloads[id] || {}), status: "succeeded", current: downloads[id]?.total || 1, total: downloads[id]?.total || 1, file: "Done" };
    await refreshConfig();
    setStatus(t("manager.status.loadedModel", { name: result.name || id }));
  } catch (error) {
    downloads[id] = { ...(downloads[id] || {}), status: "failed", error: error.message || "Download failed", current: 0, total: downloads[id]?.total || 1 };
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

async function refreshIntegrations() {
  integrations = await window.companion?.listAiIntegrations?.() || [];
  return integrations;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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
      h("div", { class: "download-meta" }, `${String(dl.status || "pending").toUpperCase()} ${dl.file || ""} ${dl.current || 0}/${dl.total || 1}`),
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
  const numeric = (id) => Number(document.getElementById(id).value || 0);
  const saveSpine = async () => {
    await window.companion?.saveSettings?.({
      spine: {
        scale: numeric("set-scale-number"),
        offsetX: numeric("set-offset-x-number"),
        offsetY: numeric("set-offset-y-number")
      }
    });
    config = await window.companion?.getConfig?.() || config;
    setStatus(t("manager.status.settingsSaved"));
    showToast(t("manager.status.settingsSaved"));
  };
  const resetExperience = async () => {
    await window.companion?.saveSettings?.({
      spine: { scale: 0.86, offsetX: 0, offsetY: -18 },
      ui: { maxDevicePixelRatio: 2, hitboxPadding: 8, gpuMode: "hardware", debugHitbox: false }
    });
    await refreshConfig();
    showToast(t("manager.status.settingsSaved"));
    renderView("settings");
  };
  const saveUi = async (patch) => {
    await window.companion?.saveSettings?.({ ui: patch });
    config.ui = { ...(config.ui || {}), ...patch };
    showToast(t("manager.status.settingsSaved"));
  };
  return h("section", {},
    h("h2", { class: "view-title" }, t("manager.settings.title")),
    h("div", { class: "settings-grid" },
      h("article", { class: "card form-card" },
        h("h3", {}, t("manager.section.spine")),
        h("button", { class: "btn", type: "button", onClick: importLocalModel }, t("manager.actions.importLocal")),
        rangeNumber(t("manager.field.scale"), "set-scale", Number(spine.scale || 1), 0.2, 2.5, 0.01, saveSpine),
        rangeNumber(t("manager.field.offsetX"), "set-offset-x", Number(spine.offsetX || 0), -240, 240, 1, saveSpine),
        rangeNumber(t("manager.field.offsetY"), "set-offset-y", Number(spine.offsetY || 0), -240, 240, 1, saveSpine),
        h("div", { class: "model-actions" },
          h("button", { class: "btn btn-primary", type: "button", onClick: saveSpine }, t("manager.actions.saveConfiguration")),
          h("button", { class: "btn", type: "button", onClick: resetExperience }, t("manager.actions.resetDefaults"))
        )
      ),
      h("article", { class: "card form-card" },
        h("h3", {}, t("manager.section.interface")),
        check(t("manager.field.showStatusPanel"), ui.hudVisible !== false, (checked) => saveUi({ hudVisible: checked })),
        check(t("manager.field.showProgressBubble"), ui.bubbleVisible !== false, (checked) => saveUi({ bubbleVisible: checked })),
        check(t("manager.field.autoShowCodex"), ui.autoRevealOnMcp !== false, (checked) => saveUi({ autoRevealOnMcp: checked })),
        check(t("manager.field.systemNotifications"), ui.systemNotifications !== false, (checked) => saveUi({ systemNotifications: checked })),
        check(t("manager.field.updateAutoCheck"), ui.updateAutoCheck !== false, (checked) => saveUi({ updateAutoCheck: checked })),
        check(t("manager.field.shortcutEnabled"), ui.shortcutEnabled !== false, (checked) => saveUi({ shortcutEnabled: checked })),
        field(t("manager.field.shortcutAccelerator"), h("input", {
          class: "input",
          value: ui.shortcutAccelerator || "CommandOrControl+Shift+S",
          onChange: (e) => saveUi({ shortcutAccelerator: e.target.value })
        })),
        rangeNumber(t("manager.field.maxDpr"), "set-max-dpr", Number(ui.maxDevicePixelRatio || 2), 1, 3, 0.25, () => saveUi({ maxDevicePixelRatio: numeric("set-max-dpr-number") })),
        rangeNumber(t("manager.field.hitboxPadding"), "set-hitbox-padding", Number(ui.hitboxPadding || 8), 0, 48, 1, () => saveUi({ hitboxPadding: numeric("set-hitbox-padding-number") })),
        check(t("manager.field.debugHitbox"), ui.debugHitbox === true, (checked) => saveUi({ debugHitbox: checked })),
        check(t("manager.field.hardwareAcceleration"), (ui.gpuMode || "hardware") !== "software", (checked) => {
          saveUi({ gpuMode: checked ? "hardware" : "software" });
          showToast(t("manager.status.restartRequired"));
        }, t("manager.hint.hardwareAcceleration")),
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
      ),
      h("article", { class: "card form-card" },
        h("h3", {}, t("manager.section.reminders")),
        reminders.length
          ? reminders.map((reminder) => h("div", { class: "reminder-row" },
              h("div", {},
                h("strong", { title: reminder.text }, reminder.text || "Reminder"),
                h("span", {}, `${reminder.fired ? t("manager.status.fired") : t("manager.status.pending")} ${reminder.dueAt || ""}`)
              ),
              h("button", { class: "btn", type: "button", onClick: async () => {
                await window.companion?.deleteReminder?.(reminder.id);
                await refreshReminders();
                renderView("settings");
              } }, t("manager.actions.delete"))
            ))
          : h("p", { class: "empty-text" }, t("manager.empty.noReminders"))
      )
    )
  );
}

function rangeNumber(label, id, value, min, max, step, onCommit = null) {
  const rangeId = `${id}-range`;
  const numberId = `${id}-number`;
  let commitTimer = 0;
  const sync = (source, target) => {
    const next = source.value;
    target.value = next;
    if (onCommit) {
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(() => onCommit(), 240);
    }
  };
  const range = h("input", { id: rangeId, type: "range", min, max, step, value });
  const number = h("input", { id: numberId, class: "input", type: "number", min, max, step, value });
  range.addEventListener("input", () => sync(range, number));
  number.addEventListener("input", () => sync(number, range));
  return field(label, h("div", { class: "setting-inline" }, range, number));
}

function field(label, control) {
  return h("label", { class: "form-group" }, h("span", {}, label), control);
}

function check(label, checked, onChange, hint = "") {
  return h("label", { class: "checkbox-label" },
    h("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked) }),
    h("span", {},
      label,
      hint ? h("small", {}, hint) : null
    )
  );
}

function integrationStatusBadges(item) {
  const badges = [];
  if (item.installed) badges.push(badge(t("manager.integrations.installed"), "badge-success"));
  if (item.configFound) badges.push(badge(t("manager.integrations.configFound"), ""));
  if (item.configured) badges.push(badge(t("manager.integrations.configured"), "badge-success"));
  if (item.needsRestart) badges.push(badge(t("manager.integrations.needsRestart"), "badge-warning"));
  if (item.configFormat !== "templateOnly" && item.instructionsFound) {
    badges.push(badge(t("manager.integrations.instructionsFound"), "badge-success"));
  } else if (item.configFormat !== "templateOnly" && item.configured) {
    badges.push(badge(t("manager.integrations.instructionsMissing"), "badge-warning"));
  }
  if (item.configFormat === "templateOnly") badges.push(badge(t("manager.integrations.templateOnly"), ""));
  if (integrationTestResults.get(item.id)?.ok) {
    badges.push(badge(t("manager.integrations.testPassed"), "badge-success"));
  } else if (integrationTestResults.has(item.id)) {
    badges.push(badge(t("manager.integrations.testFailed"), "badge-warning"));
  }
  if (!badges.length) badges.push(badge(t("manager.integrations.notDetected"), ""));
  return badges;
}

async function previewIntegration(id) {
  try {
    const preview = await window.companion?.previewAiIntegrationConfig?.(id);
    showModal(preview?.integration?.name || id, preview?.preview || "", [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
        await copyText(preview?.preview || "");
        showToast(t("manager.status.templateCopied"));
      } }, t("manager.actions.copyTemplate"))
    ]);
  } catch (error) {
    showModal(t("manager.integrations.title"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

async function copyIntegrationTemplate(id = null) {
  const text = await window.companion?.copyAiIntegrationTemplate?.(id);
  await copyText(text || "");
  showToast(t("manager.status.templateCopied"));
}

async function generateCustomTemplate(form) {
  const text = await window.companion?.copyCustomAiIntegrationTemplate?.({
    toolName: form.querySelector("[name=toolName]")?.value || "",
    source: form.querySelector("[name=source]")?.value || "",
    sourceLabel: form.querySelector("[name=sourceLabel]")?.value || ""
  });
  await copyText(text || "");
  showToast(t("manager.status.templateCopied"));
}

async function showAgentInstructions(id) {
  try {
    const result = await window.companion?.generateAiIntegrationInstructions?.(id);
    const pathLine = result?.targetPath ? `${t("manager.integrations.instructions")}: ${result.targetPath}\n\n` : "";
    showModal(result?.title || t("manager.actions.agentInstructions"), `${pathLine}${result?.body || ""}`, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
        await copyText(result?.body || "");
        showToast(t("manager.status.instructionsCopied"));
      } }, t("manager.actions.copyInstructions"))
    ]);
  } catch (error) {
    showModal(t("manager.actions.agentInstructions"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

async function configureIntegration(id) {
  try {
    const preview = await window.companion?.previewAiIntegrationConfig?.(id);
    const name = preview?.integration?.name || id;
    const body = t("manager.modal.integrationPrompt", {
      name,
      path: preview?.targetPath || "",
      backup: preview?.backupPath || "",
      source: `${preview?.integration?.source || ""} / ${preview?.integration?.sourceLabel || ""}`
    });
    showModal(t("manager.modal.integrationTitle", { name }), body, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
      h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
        closeModal();
        const result = await window.companion?.configureAiIntegration?.(id);
        await refreshIntegrations();
        showToast(t("manager.status.integrationConfigured", { name: result?.integration?.name || name }));
        renderView("integrations");
      } }, t("manager.actions.confirmConfigure"))
    ]);
  } catch (error) {
    showModal(t("manager.integrations.title"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

async function testIntegration(id) {
  try {
    const result = await window.companion?.testAiIntegration?.(id);
    integrationTestResults.set(id, { ok: true, testedAt: Date.now() });
    if (activeView === "integrations") await renderView("integrations");
    showModal(t("manager.integrations.testTitle"), t("manager.integrations.testOk", {
      label: result?.sourceLabel || result?.source || id,
      count: result?.toolCount || 0
    }), [
      h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  } catch (error) {
    integrationTestResults.set(id, { ok: false, testedAt: Date.now() });
    if (activeView === "integrations") await renderView("integrations");
    showModal(t("manager.integrations.testTitle"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

async function diagnosticsReportText() {
  const report = {
    version: config?.version || "",
    generatedAt: new Date().toISOString(),
    diagnostics,
    history,
    reminders,
    updateStatus
  };
  return JSON.stringify(report, null, 2);
}

async function integrationsView() {
  await refreshIntegrations();
  const available = typeof window.companion?.listAiIntegrations === "function";
  if (!available) {
    return h("section", {},
      h("h2", { class: "view-title" }, t("manager.integrations.title")),
      h("article", { class: "card" }, h("p", { class: "empty-text" }, "AI Integrations are available in the Tauri runtime."))
    );
  }
  const cards = integrations.map((item) => {
    const canConfigure = item.configFormat !== "templateOnly" && (item.installed || item.configFound || item.configured);
    const customForm = item.configFormat === "templateOnly" ? h("form", { class: "custom-integration-form", onSubmit: (event) => {
      event.preventDefault();
      generateCustomTemplate(event.currentTarget);
    } },
      h("input", { class: "input", name: "toolName", placeholder: t("manager.integrations.customTool") }),
      h("input", { class: "input", name: "source", placeholder: "my-tool-mcp" }),
      h("input", { class: "input", name: "sourceLabel", placeholder: t("manager.integrations.customLabel") }),
      h("button", { class: "btn btn-primary", type: "submit" }, t("manager.actions.generateCustomTemplate"))
    ) : null;
    return h("article", { class: "card integration-card" },
      h("div", { class: "integration-header" },
        h("div", {},
          h("h3", {}, item.name),
          h("p", { class: "model-meta" }, item.note || "")
        ),
        h("span", { class: item.configured ? "status-value status-ok" : "status-value" }, item.status)
      ),
      h("div", { class: "integration-badges" }, integrationStatusBadges(item)),
      item.configPath ? h("p", { class: "integration-path", title: item.configPath }, `${t("manager.integrations.config")}: ${item.configPath}`) : null,
      item.instructionsPath ? h("p", { class: "integration-path", title: item.instructionsPath }, `${t("manager.integrations.instructions")}: ${item.instructionsPath}`) : null,
      h("p", { class: "integration-path" }, `${t("manager.integrations.command")}: ${item.source} / ${item.sourceLabel}`),
      customForm,
      h("div", { class: "model-actions" },
        item.configFormat === "templateOnly"
          ? h("button", { class: "btn btn-primary", type: "button", onClick: () => copyIntegrationTemplate(null) }, t("manager.actions.copyTemplate"))
          : canConfigure
            ? h("button", { class: "btn btn-primary", type: "button", onClick: () => configureIntegration(item.id) }, t("manager.actions.configure"))
            : null,
        h("button", { class: "btn", type: "button", onClick: () => previewIntegration(item.id) }, t("manager.actions.preview")),
        item.configFormat !== "templateOnly" ? h("button", { class: "btn", type: "button", onClick: () => testIntegration(item.id) }, t("manager.actions.testMcp")) : null,
        item.configFormat !== "templateOnly" ? h("button", { class: "btn", type: "button", onClick: () => showAgentInstructions(item.id) }, t("manager.actions.agentInstructions")) : null,
        item.configPath ? h("button", { class: "btn", type: "button", onClick: () => window.companion?.openAiIntegrationConfig?.(item.id) }, t("manager.actions.openConfig")) : null,
        item.configFormat !== "templateOnly" ? h("button", { class: "btn", type: "button", onClick: () => copyIntegrationTemplate(item.id) }, t("manager.actions.copyTemplate")) : null
      )
    );
  });
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.integrations.title")),
        h("p", { class: "empty-text" }, t("manager.integrations.subtitle"))
      )
    ),
    h("div", { class: "grid-2" }, cards)
  );
}

async function diagnosticsView() {
  diagnostics = await window.companion?.getDiagnostics?.() || {};
  history = await window.companion?.getHistory?.() || [];
  await refreshReminders();
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
        row(t("manager.diagnostics.modelHealth"), diagnostics.modelHealth?.ok, diagnostics.modelHealth?.message),
        row(t("manager.diagnostics.shortcut"), diagnostics.shortcut?.registered || diagnostics.shortcut?.enabled === false,
          diagnostics.shortcut?.enabled === false
            ? t("manager.status.disabled")
            : diagnostics.shortcut?.error || diagnostics.shortcut?.accelerator),
        diagnostics.gpu ? row(t("manager.diagnostics.gpu"), true, diagnostics.gpu.message || diagnostics.gpu.mode) : null,
        diagnostics.gpu?.renderer ? row(t("manager.diagnostics.renderer"), diagnostics.gpu.renderer.status !== "context-lost", `${diagnostics.gpu.renderer.status}; recoveries ${diagnostics.gpu.renderer.recoveryCount || 0}`) : null,
        diagnostics.gpu?.webviewCacheDir ? h("p", { class: "model-meta", title: diagnostics.gpu.webviewCacheDir }, diagnostics.gpu.webviewCacheDir) : null,
        diagnostics.gpu?.tdrNote ? h("p", { class: "model-meta" }, diagnostics.gpu.tdrNote) : null,
        row(t("manager.diagnostics.runtime"), !isTauri(), isTauri() ? t("manager.status.tauriExperimental") : "Electron"),
        h("div", { class: "model-actions" },
          h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(config.paths?.configDir) }, t("manager.actions.openConfigFolder")),
          h("button", { class: "btn", type: "button", onClick: async () => {
            await window.companion?.restartRenderer?.({ reason: "manager-diagnostics" });
            showToast(t("manager.status.rendererRestarted"));
          } }, t("manager.actions.restartRenderer")),
          h("button", { class: "btn", type: "button", onClick: async () => {
            const result = await window.companion?.clearGpuCache?.();
            showToast(t("manager.status.gpuCacheCleared", { count: result?.removed || 0 }));
          } }, t("manager.actions.clearGpuCache")),
          h("button", { class: "btn", type: "button", onClick: async () => {
            await copyText(await diagnosticsReportText());
            showToast(t("manager.status.diagnosticsCopied"));
          } }, t("manager.actions.copyDiagnostics")),
          h("button", { class: "btn", type: "button", onClick: async () => {
            const result = await window.companion?.exportDiagnostics?.();
            showToast(t("manager.status.diagnosticsExported", { path: result?.file || "" }));
          } }, t("manager.actions.exportDiagnostics")),
          h("button", { class: "btn", type: "button", onClick: async () => {
            const result = await window.companion?.exportLogs?.();
            showToast(t("manager.status.logsExported", { path: result?.file || "" }));
          } }, t("manager.actions.exportLogs"))
        )
      ),
      h("article", { class: "card diag-card" },
        h("h3", {}, t("manager.diagnostics.updates")),
        h("p", { class: "model-meta" }, updateStatus?.error || `Channel ${updateStatus?.channel || "stable"} | Current ${updateStatus?.currentVersion || ""}, latest ${updateStatus?.latestVersion || ""}`),
        updateStatus?.source ? h("p", { class: "model-meta", title: updateStatus.source }, t("manager.diagnostics.updateSource", { source: updateStatus.source })) : null,
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

function avatarStudioView() {
  const pathInput = h("input", { class: "input", type: "text", placeholder: "C:/path/to/avatar-pack", "aria-label": t("manager.avatar.packPath") });
  const resultRoot = h("div", { class: "avatar-validation" });
  let latestValidation = null;
  const importButton = h("button", { class: "btn btn-primary", type: "button" }, t("manager.avatar.saveDraft"));
  const renderValidation = (result) => {
    latestValidation = result || null;
    const ok = result?.ok === true;
    importButton.textContent = t(avatarActionKey(result));
    importButton.disabled = !ok;
    resultRoot.replaceChildren(
      h("p", { class: ok ? "status-value status-ok" : "status-value status-err" }, t(avatarStatusKey(result))),
      result?.id || result?.name ? h("p", { class: "model-meta" }, `${result.name || result.id} (${result.id || ""})`) : null,
      ...(result?.errors || []).map((item) => h("p", { class: "error-text" }, item)),
      ...(result?.warnings || []).map((item) => h("p", { class: "model-meta" }, item))
    );
  };
  const validate = async () => {
    const result = await window.companion?.validateAvatarPack?.(pathInput.value.trim());
    renderValidation(result);
    return result;
  };
  importButton.disabled = true;
  pathInput.addEventListener("input", () => {
    latestValidation = null;
    importButton.disabled = true;
    importButton.textContent = t("manager.avatar.saveDraft");
    resultRoot.replaceChildren();
  });
  importButton.addEventListener("click", async () => {
    try {
      const validation = latestValidation || await validate();
      if (!validation?.ok) return;
      const result = await window.companion?.importAvatarPack?.(pathInput.value.trim());
      renderValidation(result?.validation);
      const name = result?.validation?.name || result?.validation?.id || "avatar pack";
      showToast(t(avatarResultToastKey(result), { name }));
    } catch (error) {
      resultRoot.replaceChildren(h("p", { class: "error-text" }, error?.message || String(error)));
      showToast(t("manager.avatar.importFailed"));
    }
  });
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.avatar.title")),
        h("p", { class: "empty-text" }, t("manager.avatar.subtitle"))
      )
    ),
    h("div", { class: "grid-2" },
      h("article", { class: "card" },
        h("h3", {}, t("manager.avatar.inputsTitle")),
        h("p", { class: "model-meta" }, t("manager.avatar.inputsBody"))
      ),
      h("article", { class: "card" },
        h("h3", {}, t("manager.avatar.packTitle")),
        h("p", { class: "model-meta" }, "avatar-pack.json, preview.png, layers/, rig/, exports/"),
        h("div", { class: "avatar-pack-form" },
          pathInput,
          h("button", { class: "btn", type: "button", onClick: validate }, t("manager.avatar.validate")),
          importButton
        ),
        resultRoot
      ),
      h("article", { class: "card" },
        h("h3", {}, t("manager.avatar.limitsTitle")),
        h("p", { class: "model-meta" }, t("manager.avatar.limitsBody"))
      ),
      h("article", { class: "card" },
        h("h3", {}, t("manager.avatar.docsTitle")),
        h("div", { class: "model-actions" },
          h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.("https://github.com/cb8010d6/spine-companion/blob/main/docs/avatar-studio.md") }, "English"),
          h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.("https://github.com/cb8010d6/spine-companion/blob/main/docs/avatar-studio.zh-CN.md") }, "中文")
        )
      )
    )
  );
}

async function renderView(viewName) {
  if (viewName === "dashboard") {
    setStatus(t("manager.status.viewing", { view: t("manager.nav.dashboard") }));
    await renderDashboard();
    return;
  }
  viewContainer.replaceChildren(h("p", { class: "empty-text" }, t("manager.status.loading")));
  setStatus(t("manager.status.viewing", { view: t(`manager.nav.${viewName}`) }));
  if (viewName === "library") render(libraryView(), viewContainer);
  else if (viewName === "installed") render(installedView(), viewContainer);
  else if (viewName === "downloads") render(downloadsView(), viewContainer);
  else if (viewName === "settings") {
    await refreshReminders();
    render(settingsView(), viewContainer);
  }
  else if (viewName === "integrations") render(await integrationsView(), viewContainer);
  else if (viewName === "avatar") render(avatarStudioView(), viewContainer);
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
    if (activeView === "settings" || activeView === "installed" || activeView === "library" || activeView === "dashboard") renderView(activeView);
  });
  window.companion?.onReminders?.((nextReminders) => {
    reminders = Array.isArray(nextReminders) ? nextReminders : [];
    if (activeView === "settings") renderView("settings");
    else if (activeView === "dashboard") dashboardRefresh.schedule();
  });
  window.companion?.onState?.((nextState) => {
    liveState = nextState || null;
    if (activeView === "dashboard") dashboardRefresh.schedule();
  });
  navTo("dashboard");
}

boot().catch((error) => {
  setStatus(error.message);
  render(h("section", { class: "card form-card", role: "alert" }, h("strong", {}, "Manager failed"), h("p", {}, error.message)), viewContainer);
});
