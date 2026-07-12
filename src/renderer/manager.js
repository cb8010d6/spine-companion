import "./manager.css";
import {
  Activity,
  Bot,
  Box,
  Download,
  House,
  Library,
  Languages,
  PackageCheck,
  Settings,
  Sparkles,
  createElement
} from "lucide";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { h, render } from "./lib/dom.js";
import { createI18n, getLocale, t } from "../shared/i18n.js";
import { avatarActionKey, avatarResultToastKey, avatarStatusKey } from "./avatar-ui.js";
import {
  INTEGRATION_FILTERS,
  integrationCompletion,
  integrationErrorKey,
  integrationMatchesFilter,
  integrationPrimaryAction,
  integrationSummaryKey,
  integrationTestResult,
  selectFilteredIntegration
} from "./integration-ui.js";
import { modelPreview } from "./model-preview.js";
import { readCachedModelPreview, writeCachedModelPreview } from "./model-preview-cache.js";
import { renderSpinePreview } from "./spine-preview.js";
import { installManagerPreviewBridge } from "./manager-preview.js";
import { applyThemePreference } from "./theme.js";
import { integrationBrand } from "./integration-icons.js";
import { catalogDownloadRequest, mergeInstalledModelMetadata, normalizeCatalogEntries } from "./catalog-model.js";
import { createAvatarEditor } from "./avatar-editor-view.js";
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
const topbarTitle = document.getElementById("topbar-title");
const modalContainer = document.getElementById("modal-container");
const runtimeLabel = document.getElementById("runtime-label");
const topbarRuntimeLabel = document.getElementById("topbar-runtime-label");
const topbarLocaleSelect = document.getElementById("topbar-locale-select");
const topbarLocaleLabel = document.getElementById("topbar-locale-label");
const topbarLocaleIcon = document.getElementById("topbar-locale-icon");

const NAV_ICONS = {
  dashboard: House,
  library: Library,
  installed: PackageCheck,
  downloads: Download,
  integrations: Bot,
  avatar: Sparkles,
  settings: Settings,
  diagnostics: Activity
};

let activeView = "dashboard";
let config = { models: { catalog: [] }, ui: {}, spine: {} };
let installedModels = [];
let diagnostics = null;
let history = [];
let reminders = [];
let integrations = [];
let avatarPacks = [];
let remoteCatalog = { models: [], sources: [] };
let updateStatus = null;
let liveState = null;
const downloads = {};
const integrationTestResults = new Map();
let integrationFilter = "all";
let selectedIntegrationId = "";
let dashboardRenderRevision = 0;
let modalReturnFocus = null;
let modalOnDismiss = null;

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

function closeModal({ dismissed = true } = {}) {
  if (modalContainer.classList.contains("hidden")) return;
  const onDismiss = modalOnDismiss;
  modalOnDismiss = null;
  modalContainer.classList.add("hidden");
  document.getElementById("modal-actions").replaceChildren();
  document.removeEventListener("keydown", trapModalKeys);
  const returnFocus = modalReturnFocus;
  modalReturnFocus = null;
  window.setTimeout(() => {
    if (returnFocus?.isConnected) returnFocus.focus();
  }, 0);
  if (dismissed) onDismiss?.();
}

function showModal(title, bodyText, actions = [], { onDismiss = null } = {}) {
  if (modalContainer.classList.contains("hidden")) modalReturnFocus = document.activeElement;
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").textContent = bodyText;
  document.getElementById("modal-actions").replaceChildren(...actions.filter(Boolean));
  modalOnDismiss = onDismiss;
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
  if (topbarTitle) topbarTitle.textContent = t(`manager.nav.${viewName}`);
  renderView(viewName);
}

function catalogModel(id) {
  return (config.models?.catalog || []).find((model) => model.id === id) || {};
}

function mergedModel(model) {
  return mergeInstalledModelMetadata(catalogModel(model.id), model);
}

function previewNode(model, onPreviewReady = null) {
  const cachedPreviewUrl = readCachedModelPreview(model);
  const preview = modelPreview(cachedPreviewUrl ? { ...model, thumbnailUrl: cachedPreviewUrl } : model, config);
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
  let previewButton = null;
  const renderAndCache = async () => {
    if (previewButton) {
      previewButton.disabled = true;
      previewButton.textContent = t("manager.model.previewLoading");
    }
    let dataUrl = "";
    try {
      if (!preview.spinePreviewUrl && preview.canPrepareRemotePreview) {
        if (!window.companion?.prepareModelPreview) throw new Error(t("manager.model.previewUnavailable"));
        const entry = model._catalogEntry || { ...model, catalogSourceId: model.catalogSourceId || model.sourceId || "catalog" };
        const prepared = await window.companion.prepareModelPreview(entry);
        preview.spinePreviewUrl = prepared?.assetUrl || "";
      }
      dataUrl = await renderSpinePreview(node, preview);
    } catch (error) {
      node.title = error?.message || String(error);
    }
    if (dataUrl) {
      writeCachedModelPreview(model, dataUrl);
      previewButton?.remove();
      return true;
    }
    if (previewButton) {
      previewButton.disabled = false;
      previewButton.textContent = t("manager.model.previewRetry");
    }
    return false;
  };
  if (!preview.imageUrl && !preview.autoRenderSpinePreview && (preview.canRenderSpinePreview || preview.canPrepareRemotePreview)) {
    previewButton = h("button", {
      class: "model-preview-button",
      type: "button",
      title: t("manager.model.previewOnDemandHint"),
      onClick: (event) => {
        event.stopPropagation();
        renderAndCache();
      }
    }, t("manager.model.preview"));
    children.push(previewButton);
  }
  const node = h("div", { class: `model-preview ${preview.imageUrl ? "has-image" : ""}`, style: preview.style, "aria-label": `Preview for ${preview.label}` },
    children
  );
  if (previewButton && typeof onPreviewReady === "function") onPreviewReady(renderAndCache);
  if (!preview.imageUrl && preview.autoRenderSpinePreview) {
    window.requestAnimationFrame(() => {
      if (node.isConnected) renderAndCache();
    });
  }
  return node;
}

function badge(label, tone = "") {
  return h("span", { class: `badge ${tone}`.trim() }, label);
}

function localizedDiagnosticMessage(message) {
  const keys = {
    "No active asset directory.": "manager.diagnostics.message.noAssetDirectory",
    "No recoverable downloaded catalog model was found.": "manager.diagnostics.message.noRecoverableModel",
    "Spine asset set is healthy.": "manager.diagnostics.message.assetsHealthy",
    "Global shortcuts are not implemented in the Tauri runtime yet.": "manager.diagnostics.message.shortcutUnavailable",
    "WebView2 uses hardware acceleration.": "manager.diagnostics.message.hardwareAcceleration",
    "WebView2 uses software rendering because hardware acceleration is disabled in Settings.": "manager.diagnostics.message.softwareRendering",
    "If Windows reports LiveKernelEvent 141 or display driver reset, restart the renderer or clear WebView GPU cache.": "manager.diagnostics.message.tdrAdvice"
  };
  return keys[message] ? t(keys[message]) : message || "";
}

function localizedRendererState(status) {
  const normalized = String(status || "unknown").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const key = `manager.diagnostics.rendererState.${normalized}`;
  const translated = t(key);
  return translated === key ? String(status || t("manager.diagnostics.rendererState.unknown")) : translated;
}

function runtimeName() {
  if (isTauri()) return "Tauri";
  return config.version === "preview" ? t("manager.status.previewRuntime") : t("manager.status.legacyRuntime");
}

function applyUiLocale() {
  createI18n(config);
  document.documentElement.lang = getLocale();
  applyThemePreference(config.ui?.theme || "system");
  const runtime = runtimeName();
  if (runtimeLabel) runtimeLabel.textContent = runtime;
  if (topbarRuntimeLabel) topbarRuntimeLabel.textContent = runtime;
  if (topbarLocaleSelect) {
    topbarLocaleSelect.value = config.ui?.locale || "auto";
    topbarLocaleSelect.setAttribute("aria-label", t("manager.field.locale"));
    topbarLocaleSelect.title = t("manager.field.locale");
  }
  if (topbarLocaleLabel) topbarLocaleLabel.textContent = t("manager.field.locale");
  if (topbarLocaleIcon) {
    const icon = createElement(Languages);
    icon.setAttribute("aria-hidden", "true");
    topbarLocaleIcon.replaceChildren(icon);
  }
  for (const button of navButtons) {
    const label = t(`manager.nav.${button.dataset.view}`);
    const Icon = NAV_ICONS[button.dataset.view] || Box;
    const icon = createElement(Icon);
    icon.classList.add("nav-icon");
    icon.setAttribute("aria-hidden", "true");
    button.replaceChildren(icon, h("span", { class: "nav-label" }, label));
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  if (topbarTitle) topbarTitle.textContent = t(`manager.nav.${activeView}`);
}

async function refreshConfig() {
  config = await window.companion?.getConfig?.() || config;
  applyUiLocale();
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
  const card = (title, value, detail, actions = [], tone = "neutral") => h("article", { class: "card dashboard-card", "data-tone": tone },
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
    h("div", { class: "dashboard-grid" },
      card(t("manager.dashboard.model"), activeModelLabel(), config.spine?.assetDir || "", [
        h("button", { class: "btn", type: "button", onClick: () => navTo("library") }, t("manager.dashboard.openLibrary"))
      ], "model"),
      card(t("manager.dashboard.ai"), sourceLabel || configuredIntegrations[0]?.sourceLabel || t("manager.dashboard.local"), lastState.message || t("manager.dashboard.noActiveTask"), [
        h("button", { class: "btn", type: "button", onClick: () => navTo("integrations") }, t("manager.dashboard.openIntegrations"))
      ], "ai"),
      card(t("manager.dashboard.bridge"), bridgeValue, bridgeDetail, [], bridgeReady ? "success" : "warning"),
      card(t("manager.dashboard.reminders"), String(reminders.length), reminders[0]?.message || t("manager.empty.noReminders"), [], "reminder"),
      card(t("manager.dashboard.updates"), updateStatus?.updateAvailable ? t("manager.status.updateAvailable", { version: updateStatus.latestVersion }) : t("manager.status.upToDate", { version: updateStatus?.currentVersion || config.version || "" }), updateStatus?.channel || "stable", [], "update"),
      card(t("manager.dashboard.renderer"), rendererStatus, rendererHealth.recoveryCount > 0
        ? t("manager.dashboard.rendererRecovered", { count: rendererHealth.recoveryCount })
        : t("manager.dashboard.rendererHealthyDetail"), [], rendererHealthCategory(rendererHealth.status) === "healthy" ? "success" : "neutral")
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

async function startDownload(id, catalogEntry = null) {
  downloads[id] = { status: "pending", current: 0, total: 1, file: t("manager.download.initializing") };
  renderView(activeView);
  try {
    const result = catalogEntry
      ? await window.companion?.importCatalogModel?.(catalogEntry)
      : await window.companion?.importModel?.({ id });
    downloads[id] = { ...(downloads[id] || {}), status: "succeeded", current: downloads[id]?.total || 1, total: downloads[id]?.total || 1, file: t("manager.download.done") };
    await refreshConfig();
    setStatus(t("manager.status.loadedModel", { name: result.name || id }));
  } catch (error) {
    const message = error.message || t("manager.error.downloadFailed");
    downloads[id] = { ...(downloads[id] || {}), status: "failed", error: message, current: 0, total: downloads[id]?.total || 1 };
    setStatus(t("manager.status.downloadFailed", { id }));
    showModal(t("manager.error.downloadFailed"), message, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      h("button", { class: "btn btn-primary", type: "button", onClick: () => {
        closeModal();
        startDownload(id, catalogEntry);
      } }, t("manager.actions.retry"))
    ]);
  }
  if (activeView === "library" || activeView === "downloads" || activeView === "installed") renderView(activeView);
}

async function refreshRemoteCatalog() {
  if (!window.companion?.refreshModelCatalogs) return remoteCatalog;
  const sources = config.models?.sources || [];
  if (!sources.length) return remoteCatalog;
  remoteCatalog = await window.companion.refreshModelCatalogs(sources);
  return remoteCatalog;
}

async function libraryView() {
  await refreshRemoteCatalog().catch((error) => {
    remoteCatalog = { models: [], sources: [{ sourceId: "remote", state: "failed", error: error?.message || String(error) }] };
  });
  const staticCatalog = (config.models?.catalog || []).map((model) => ({ ...model, _catalogEntry: null }));
  const remoteModels = normalizeCatalogEntries(remoteCatalog.models);
  const catalog = [...remoteModels, ...staticCatalog.filter((item) => !remoteModels.some((remote) => remote.id === item.id))];
  const installedIds = new Set(installedModels.map((model) => model.id));
  const activeId = activeInstalledId();
  let filterValue = "all";
  const enabledSources = (config.models?.sources || []).filter((source) => source.enabled !== false);
  let sourceValue = enabledSources.length === 1 ? enabledSources[0].id : "all";
  let catalogPage = 1;
  const pageSize = 24;
  const search = h("input", {
    class: "input",
    type: "search",
    placeholder: t("manager.search.placeholder"),
    "aria-label": t("manager.search.placeholder"),
    onInput: () => { catalogPage = 1; renderCards(search.value, filterValue); }
  });
  const filter = h("select", {
    class: "select library-filter",
    "aria-label": t("manager.library.filterLabel"),
    onChange: (event) => {
      filterValue = event.target.value;
      catalogPage = 1;
      renderCards(search.value, filterValue);
    }
  },
    h("option", { value: "all" }, t("manager.library.filter.all")),
    h("option", { value: "installed" }, t("manager.library.filter.installed")),
    h("option", { value: "available" }, t("manager.library.filter.available"))
  );
  const sourceFilter = h("select", {
    class: "select library-filter",
    "aria-label": t("manager.library.sourceFilterLabel"),
    onChange: (event) => {
      sourceValue = event.target.value;
      catalogPage = 1;
      renderCards(search.value, filterValue);
    }
  },
    enabledSources.length > 1 ? h("option", { value: "all" }, t("manager.library.allSources")) : null,
    ...enabledSources.map((source) => h("option", { value: source.id }, source.label))
  );
  const grid = h("div", { class: "grid-2 library-grid" });
  const pager = h("div", { class: "library-pager" });
  let currentPagePreviewTasks = [];
  const previewCurrentPageButton = h("button", {
    class: "btn",
    type: "button",
    onClick: async () => {
      const tasks = [...currentPagePreviewTasks];
      if (!tasks.length) {
        showToast(t("manager.library.previewPageEmpty"));
        return;
      }
      previewCurrentPageButton.disabled = true;
      previewCurrentPageButton.textContent = t("manager.library.previewingPage", { count: tasks.length });
      for (let index = 0; index < tasks.length; index += 3) {
        await Promise.all(tasks.slice(index, index + 3).map((task) => task()));
      }
      previewCurrentPageButton.disabled = false;
      previewCurrentPageButton.textContent = t("manager.library.previewCurrentPage");
      showToast(t("manager.library.previewPageDone"));
    }
  }, t("manager.library.previewCurrentPage"));
  const sourceLabelInput = h("input", { class: "input", placeholder: t("manager.library.sourceName") });
  const sourceUrlInput = h("input", { class: "input", placeholder: "https://raw.githubusercontent.com/.../catalog.json" });
  const addSource = async () => {
    const label = sourceLabelInput.value.trim();
    const catalogUrl = sourceUrlInput.value.trim();
    if (!label || !catalogUrl) return;
    let host;
    try { host = new URL(catalogUrl).hostname.toLowerCase(); }
    catch { showToast(t("manager.library.invalidSourceUrl")); return; }
    if (!catalogUrl.startsWith("https://")) { showToast(t("manager.library.invalidSourceUrl")); return; }
    const kind = host === "raw.githubusercontent.com" ? "customRaw" : "customCdn";
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const sources = [...(config.models?.sources || []).filter((source) => source.id !== id), { id, label, catalogUrl, kind, enabled: true }];
    await window.companion?.saveSettings?.({ models: { sources } });
    config.models = { ...(config.models || {}), sources };
    await renderView("library");
  };

  function renderCards(query = "", selectedFilter = "all") {
    const normalized = query.trim().toLowerCase();
    const filtered = catalog
      .filter((model) => !normalized || `${model.name} ${model.id} ${model.source}`.toLowerCase().includes(normalized))
      .filter((model) => sourceValue === "all" || model.sourceId === sourceValue || !model.sourceId)
      .filter((model) => selectedFilter === "all" || (selectedFilter === "installed" ? installedIds.has(model.id) : !installedIds.has(model.id)));
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    catalogPage = Math.min(catalogPage, pageCount);
    currentPagePreviewTasks = [];
    const cards = filtered
      .slice((catalogPage - 1) * pageSize, catalogPage * pageSize)
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
            }, active ? t("manager.status.active") : t("manager.actions.setActive"))
          : h("button", {
              class: "btn btn-primary",
              type: "button",
              disabled: download?.status === "downloading",
              onClick: () => confirmDownload(model)
            }, download?.status === "downloading" ? t("manager.status.downloading") : t("manager.actions.download"));
        const sourceUrl = model.repositoryUrl || model.sourceUrl || "";
        return h("article", { class: "model-card fade-in" },
          previewNode(model, (task) => currentPagePreviewTasks.push(task)),
          h("div", { class: "model-info" },
            h("div", { class: "model-title", title: model.name || model.id }, model.name || model.id),
            h("div", { class: "model-meta" }, t("manager.model.source", { source: model.source || t("manager.model.unknownSource") })),
            model.author ? h("div", { class: "model-meta" }, t("manager.library.author", { author: model.author })) : null,
            h("div", { class: "model-badges" },
              badge(model.spineVersion || "Spine 3.8"),
              model.license ? badge(model.license, model.license === "NOASSERTION" ? "badge-warning" : "") : null,
              model.licenseNote ? badge(t("manager.library.licenseNotice"), "badge-warning") : null
            ),
            h("div", { class: "model-actions" },
              installed ? badge(t("manager.status.installed"), "badge-success") : null,
              active ? badge(t("manager.status.active"), "badge-warning") : null,
              h("div", { style: { flex: "1" } }),
              sourceUrl ? h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.(sourceUrl) }, t("manager.actions.openSource")) : null,
              button
            )
          )
        );
      });
    grid.replaceChildren(...(cards.length ? cards : [h("div", { class: "library-empty" },
      h("strong", {}, t("manager.library.emptyTitle")),
      h("p", { class: "empty-text" }, t("manager.library.emptyBody"))
    )]));
    pager.replaceChildren(
      h("button", { class: "btn", type: "button", disabled: catalogPage <= 1, onClick: () => { catalogPage -= 1; renderCards(query, selectedFilter); } }, t("manager.library.previousPage")),
      h("span", {}, t("manager.library.page", { page: catalogPage, pages: pageCount, count: filtered.length })),
      h("button", { class: "btn", type: "button", disabled: catalogPage >= pageCount, onClick: () => { catalogPage += 1; renderCards(query, selectedFilter); } }, t("manager.library.nextPage"))
    );
  }

  renderCards();
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.library.title")),
        h("p", { class: "empty-text" }, t("manager.library.subtitle"))
      ),
      h("button", { class: "btn", type: "button", onClick: () => navTo("installed") }, t("manager.library.manageInstalled"))
    ),
    h("div", { class: "library-summary" },
      h("div", {}, h("strong", {}, String(catalog.length)), h("span", {}, t("manager.library.catalogCount"))),
      h("div", {}, h("strong", {}, String(installedModels.length)), h("span", {}, t("manager.library.installedCount"))),
      h("div", {}, h("strong", {}, activeId ? "1" : "0"), h("span", {}, t("manager.library.activeCount")))
    ),
    h("div", { class: "library-toolbar" }, sourceFilter, search, filter, previewCurrentPageButton),
    h("div", { class: "catalog-source-strip" }, ...(remoteCatalog.sources || []).map((source) => h("span", { class: `badge ${source.state === "failed" ? "badge-warning" : ""}`, title: source.error || "" }, `${source.sourceId}: ${source.state}`))),
    h("details", { class: "catalog-source-editor" }, h("summary", {}, t("manager.library.sources")),
      h("div", { class: "catalog-source-list" }, ...(config.models?.sources || []).map((source) => h("div", { class: "catalog-source-row" },
        h("span", {}, source.label), h("small", { title: source.catalogUrl }, source.catalogUrl),
        h("label", { class: "switch-row compact" }, h("input", { type: "checkbox", checked: source.enabled !== false, onChange: async (event) => {
          const sources = (config.models?.sources || []).map((item) => item.id === source.id ? { ...item, enabled: event.target.checked } : item);
          await window.companion?.saveSettings?.({ models: { sources } }); config.models.sources = sources; await renderView("library");
        } }), h("span", {}, t("manager.library.sourceEnabled"))),
        h("button", { class: "btn danger", type: "button", onClick: async () => {
          const sources = (config.models?.sources || []).filter((item) => item.id !== source.id);
          await window.companion?.saveSettings?.({ models: { sources } }); config.models.sources = sources; await renderView("library");
        } }, t("manager.actions.remove"))
      ))),
      h("div", { class: "catalog-source-add" }, sourceLabelInput, sourceUrlInput, h("button", { class: "btn", type: "button", onClick: addSource }, t("manager.library.addSource")))
    ),
    grid,
    pager
  );
}

function confirmDownload(model) {
  const request = catalogDownloadRequest(model);
  const proceed = h("button", { class: "btn btn-primary", type: "button", onClick: () => {
    closeModal();
    startDownload(request.id, request.catalogEntry);
  } }, t("manager.actions.acceptDownload"));
  const cancel = h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel"));
  if (model.licenseNote) showModal(t("manager.modal.licenseTitle"), t("manager.modal.licensePrompt", { note: model.licenseNote }), [cancel, proceed]);
  else startDownload(request.id, request.catalogEntry);
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
    const message = error.message || t("manager.error.localImportFailed");
    setStatus(message);
    showModal(t("manager.modal.importFailed"), message, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

async function refreshIntegrations() {
  integrations = await window.companion?.listAiIntegrations?.() || [];
  integrationTestResults.clear();
  for (const item of integrations) {
    const persisted = integrationTestResult(item);
    if (persisted) integrationTestResults.set(item.id, persisted);
  }
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
    ? installedModels.map((model) => {
      const displayModel = mergedModel(model);
      return h("article", { class: "model-card fade-in" },
        previewNode(displayModel),
        h("div", { class: "model-info" },
          h("div", { class: "model-title", title: displayModel.name || model.id }, displayModel.name || model.id),
          h("div", { class: "model-meta", title: model.dir }, model.dir),
          h("div", { class: "model-actions" },
            model.id === active ? badge(t("manager.status.active"), "badge-warning") : null,
            h("div", { style: { flex: "1" } }),
            h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(model.dir) }, t("manager.actions.openFolder")),
            h("button", { class: "btn", type: "button", disabled: model.id === active, onClick: () => activateModel(model.id) }, t("manager.actions.setActive")),
            h("button", { class: "btn btn-danger", type: "button", disabled: model.id === active, onClick: () => confirmRemove(model.id) }, t("manager.actions.remove"))
          )
        )
      );
    })
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
    } }, t("manager.actions.remove"))
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
  const section = (title, description, ...content) => h("section", { class: "settings-section" },
    h("div", { class: "settings-section-header" },
      h("div", {}, h("h3", {}, title), h("p", {}, description))
    ),
    h("div", { class: "settings-section-body" }, ...content)
  );
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.settings.title")),
        h("p", { class: "empty-text" }, t("manager.settings.subtitle"))
      ),
      h("button", { class: "btn", type: "button", onClick: resetExperience }, t("manager.actions.resetDisplayDefaults"))
    ),
    h("div", { class: "settings-shell" },
      section(t("manager.settings.appearance"), t("manager.settings.appearanceHelp"),
        h("button", { class: "btn", type: "button", onClick: importLocalModel }, t("manager.actions.importLocal")),
        rangeNumber(t("manager.field.scale"), "set-scale", Number(spine.scale || 1), 0.2, 2.5, 0.01, saveSpine),
        rangeNumber(t("manager.field.offsetX"), "set-offset-x", Number(spine.offsetX || 0), -240, 240, 1, saveSpine),
        rangeNumber(t("manager.field.offsetY"), "set-offset-y", Number(spine.offsetY || 0), -240, 240, 1, saveSpine),
        check(t("manager.field.bubbleShadow"), ui.bubbleShadow !== false, (checked) => saveUi({ bubbleShadow: checked })),
        field(t("manager.field.bubbleTheme"), h("select", { class: "select", value: ui.bubbleBackground || "solid", onChange: (e) => saveUi({ bubbleBackground: e.target.value }) },
          ["solid", "soft", "clear", "light"].map((value) => h("option", { value, selected: (ui.bubbleBackground || "solid") === value }, t(`manager.option.bubble.${value}`)))
        )),
        field(t("manager.field.theme"), h("select", { class: "select", value: ui.theme || "system", onChange: (e) => saveUi({ theme: e.target.value }) },
          h("option", { value: "system" }, t("manager.option.system")),
          h("option", { value: "dark" }, t("manager.option.dark")),
          h("option", { value: "light" }, t("manager.option.light"))
        )),
        field(t("manager.field.locale"), h("select", { class: "select", value: ui.locale || "auto", onChange: (e) => saveUi({ locale: e.target.value }) },
          h("option", { value: "auto" }, t("manager.option.auto")),
          h("option", { value: "en" }, "English"),
          h("option", { value: "zh-CN" }, "中文")
        )),
        h("button", { class: "btn btn-primary", type: "button", onClick: saveSpine }, t("manager.actions.saveConfiguration"))
      ),
      section(t("manager.settings.behavior"), t("manager.settings.behaviorHelp"),
        check(t("manager.field.showStatusPanel"), ui.hudVisible !== false, (checked) => saveUi({ hudVisible: checked })),
        check(t("manager.field.showProgressBubble"), ui.bubbleVisible !== false, (checked) => saveUi({ bubbleVisible: checked })),
        check(t("manager.field.autoShowCodex"), ui.autoRevealOnMcp !== false, (checked) => saveUi({ autoRevealOnMcp: checked })),
        check(t("manager.field.systemNotifications"), ui.systemNotifications !== false, (checked) => saveUi({ systemNotifications: checked })),
        check(t("manager.field.updateAutoCheck"), ui.updateAutoCheck !== false, (checked) => saveUi({ updateAutoCheck: checked })),
        field(t("manager.field.updateChannel"), h("select", { class: "select", value: ui.updateChannel || "auto", onChange: async (event) => {
          await saveUi({ updateChannel: event.target.value });
          await refreshUpdateStatus();
          if (activeView === "settings") renderView("settings");
        } },
          ["auto", "stable", "prerelease"].map((value) => h("option", { value, selected: (ui.updateChannel || "auto") === value }, t(`manager.option.updateChannel.${value}`)))
        ))
      ),
      section(t("manager.settings.interaction"), t("manager.settings.interactionHelp"),
        isTauri()
          ? h("p", { class: "empty-text" }, t("manager.diagnostics.message.shortcutUnavailable"))
          : [
              check(t("manager.field.shortcutEnabled"), ui.shortcutEnabled !== false, (checked) => saveUi({ shortcutEnabled: checked })),
              field(t("manager.field.shortcutAccelerator"), h("input", {
                class: "input",
                value: ui.shortcutAccelerator || "CommandOrControl+Shift+S",
                onChange: (e) => saveUi({ shortcutAccelerator: e.target.value })
              }))
            ],
        rangeNumber(t("manager.field.hitboxPadding"), "set-hitbox-padding", Number(ui.hitboxPadding || 8), 0, 48, 1, () => saveUi({ hitboxPadding: numeric("set-hitbox-padding-number") }))
      ),
      section(t("manager.settings.compatibility"), t("manager.settings.compatibilityHelp"),
        rangeNumber(t("manager.field.maxDpr"), "set-max-dpr", Number(ui.maxDevicePixelRatio || 2), 1, 3, 0.25, () => saveUi({ maxDevicePixelRatio: numeric("set-max-dpr-number") })),
        check(t("manager.field.hardwareAcceleration"), (ui.gpuMode || "hardware") !== "software", (checked) => {
          saveUi({ gpuMode: checked ? "hardware" : "software" });
          showToast(t("manager.status.restartRequired"));
        }, t("manager.hint.hardwareAcceleration")),
        h("details", { class: "settings-advanced" },
          h("summary", {}, t("manager.settings.advanced")),
          check(t("manager.field.debugHitbox"), ui.debugHitbox === true, (checked) => saveUi({ debugHitbox: checked }))
        )
      ),
      section(t("manager.section.reminders"), t("manager.settings.remindersHelp"),
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
  const range = h("input", { id: rangeId, type: "range", min, max, step, value, "aria-label": t("manager.accessibility.slider", { label }) });
  const number = h("input", { id: numberId, class: "input", type: "number", min, max, step, value, "aria-label": t("manager.accessibility.numberValue", { label }) });
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
    h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-thumb" })),
    h("span", { class: "checkbox-copy" },
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

async function openIntegrationConfig(id) {
  try {
    await window.companion?.openAiIntegrationConfig?.(id);
  } catch (error) {
    showModal(t("manager.actions.openConfig"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
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

async function installAgentInstructions(id) {
  try {
    const preview = await window.companion?.generateAiIntegrationInstructions?.(id);
    const name = preview?.integration?.name || id;
    const body = t("manager.modal.instructionsPrompt", {
      path: preview?.targetPath || "",
      name
    });
    showModal(t("manager.modal.instructionsTitle", { name }), body, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
      h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
        closeModal();
        try {
          const result = await window.companion?.installAiIntegrationInstructions?.(id);
          await refreshIntegrations();
          await renderView("integrations");
          showModal(t("manager.modal.instructionsInstalledTitle", { name }), t("manager.modal.instructionsInstalledBody", {
            path: result?.targetPath || "",
            backup: result?.backupPath || t("manager.integrations.noBackupCreated")
          }), [
            h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
          ]);
        } catch (error) {
          showModal(t("manager.actions.agentInstructions"), error.message || String(error), [
            h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
            h("button", { class: "btn btn-primary", type: "button", onClick: () => installAgentInstructions(id) }, t("manager.actions.retry"))
          ]);
        }
      } }, t("manager.actions.installInstructions"))
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
        try {
          const result = await window.companion?.configureAiIntegration?.(id);
          await refreshIntegrations();
          await renderView("integrations");
          showModal(t(result?.needsRestart ? "manager.modal.integrationUpdatedTitle" : "manager.modal.integrationUnchangedTitle", { name }), t(result?.needsRestart ? "manager.modal.integrationUpdatedBody" : "manager.modal.integrationUnchangedBody", {
            name,
            path: result?.targetPath || "",
            backup: result?.backupPath || t("manager.integrations.noBackupCreated")
          }), [
            h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
          ]);
        } catch (error) {
          showModal(t("manager.integrations.title"), error.message || String(error), [
            h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
            h("button", { class: "btn btn-primary", type: "button", onClick: () => configureIntegration(id) }, t("manager.actions.retry"))
          ]);
        }
      } }, t("manager.actions.confirmConfigure"))
    ]);
  } catch (error) {
    showModal(t("manager.integrations.title"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  }
}

async function acknowledgeIntegrationRestart(id) {
  try {
    await window.companion?.acknowledgeAiIntegrationRestart?.(id);
    await refreshIntegrations();
    await renderView("integrations");
    showToast(t("manager.status.restartAcknowledged"));
  } catch (error) {
    showModal(t("manager.integrations.title"), error.message || String(error), [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      h("button", { class: "btn btn-primary", type: "button", onClick: () => acknowledgeIntegrationRestart(id) }, t("manager.actions.retry"))
    ]);
  }
}

async function showRestoredIntegrationResult(name, result) {
  const body = t("manager.modal.restoreIntegrationDoneBody", {
    path: result?.targetPath || "",
    safety: result?.safetyBackupPath || "",
    name
  });
  try {
    await refreshIntegrations();
    await renderView("integrations");
    showModal(t("manager.modal.restoreIntegrationDoneTitle", { name }), body, [
      h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  } catch (error) {
    showModal(t("manager.modal.restoreIntegrationDoneTitle", { name }), `${body}\n\n${t("manager.modal.restoreIntegrationRefreshWarning", {
      error: error.message || String(error)
    })}`, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      h("button", { class: "btn btn-primary", type: "button", onClick: () => showRestoredIntegrationResult(name, result) }, t("manager.actions.retry"))
    ]);
  }
}

async function restoreIntegration(id) {
  const item = integrations.find((integration) => integration.id === id);
  const name = item?.name || id;
  showModal(t("manager.modal.restoreIntegrationTitle", { name }), t("manager.modal.restoreIntegrationPrompt", {
    path: item?.configPath || "",
    backup: item?.lastBackupPath || t("manager.integrations.createdConfigRestore")
  }), [
    h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
    h("button", { class: "btn btn-danger", type: "button", onClick: async () => {
      closeModal();
      let result;
      try {
        result = await window.companion?.restoreAiIntegrationBackup?.(id);
      } catch (error) {
        showModal(t("manager.modal.restoreIntegrationTitle", { name }), error.message || String(error), [
          h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
          h("button", { class: "btn btn-primary", type: "button", onClick: () => restoreIntegration(id) }, t("manager.actions.retry"))
        ]);
        return;
      }
      await showRestoredIntegrationResult(name, result);
    } }, t("manager.actions.restoreBackup"))
  ]);
}

async function testIntegration(id) {
  try {
    const result = await window.companion?.testAiIntegration?.(id);
    await refreshIntegrations();
    if (activeView === "integrations") await renderView("integrations");
    showModal(t("manager.integrations.testTitle"), t("manager.integrations.testOk", {
      label: result?.sourceLabel || result?.source || id,
      count: result?.toolCount || 0
    }), [
      h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
    ]);
  } catch (error) {
    await refreshIntegrations().catch(() => {});
    if (activeView === "integrations") await renderView("integrations");
    const item = integrations.find((integration) => integration.id === id);
    const rawError = error.message || String(error);
    showModal(t("manager.integrations.testTitle"), `${t(integrationErrorKey(rawError))}\n\n${t("manager.integrations.technicalDetails")}: ${rawError}`, [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      item?.configPath ? h("button", { class: "btn", type: "button", onClick: () => openIntegrationConfig(id) }, t("manager.actions.openConfig")) : null,
      h("button", { class: "btn btn-primary", type: "button", onClick: () => testIntegration(id) }, t("manager.actions.retry"))
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
      h("article", { class: "card" }, h("p", { class: "empty-text" }, t("manager.integrations.runtimeUnavailable")))
    );
  }
  const filtered = integrations.filter((item) => integrationMatchesFilter(item, integrationFilter, integrationTestResults.get(item.id)));
  const selected = selectFilteredIntegration(filtered, selectedIntegrationId);
  selectedIntegrationId = selected?.id || "";
  const testResult = selected ? integrationTestResults.get(selected.id) : null;
  const progress = selected ? integrationCompletion(selected, testResult) : null;
  const action = selected ? integrationPrimaryAction(selected, testResult) : "manual";
  const statusStep = (label, done, detail) => h("div", { class: `setup-step${done ? " done" : ""}` },
    h("span", { class: "setup-step-mark", "aria-hidden": "true" }, done ? "✓" : "·"),
    h("div", {}, h("strong", {}, label), detail ? h("small", {}, detail) : null)
  );
  const brandIcon = (item, size = "row", state = "") => {
    const brand = integrationBrand(item?.id, item);
    const className = `integration-monogram integration-brand-${size}${state ? ` state-${state}` : ""}`;
    if (!brand) {
      return h("span", { class: className, "aria-hidden": "true" }, item?.name?.slice(0, 1).toUpperCase() || "AI");
    }
    return h("span", { class: className, style: { "--integration-brand": brand.color }, "aria-hidden": "true" },
      brand.image
        ? h("img", { src: brand.image, alt: "" })
        : h("svg", { viewBox: "0 0 24 24", focusable: "false" }, h("path", { d: brand.path }))
    );
  };
  const primaryAction = () => {
    if (!selected) return null;
    if (action === "configure") return h("button", { class: "btn btn-primary", type: "button", onClick: () => configureIntegration(selected.id) }, t("manager.actions.configure"));
    if (action === "instructions") return h("button", { class: "btn btn-primary", type: "button", onClick: () => installAgentInstructions(selected.id) }, t("manager.actions.installInstructions"));
    if (action === "restart") return h("button", { class: "btn btn-primary", type: "button", onClick: () => acknowledgeIntegrationRestart(selected.id) }, t("manager.actions.restartedTool"));
    if (action === "test" || action === "retest") return h("button", { class: "btn btn-primary", type: "button", onClick: () => testIntegration(selected.id) }, t(action === "retest" ? "manager.actions.retestMcp" : "manager.actions.testMcp"));
    if (action === "custom") return h("button", { class: "btn btn-primary", type: "button", onClick: () => copyIntegrationTemplate(null) }, t("manager.actions.copyTemplate"));
    return h("button", { class: "btn btn-primary", type: "button", onClick: () => copyIntegrationTemplate(selected.id) }, t("manager.actions.manualSetup"));
  };
  const customForm = selected?.configFormat === "templateOnly" ? h("form", { class: "custom-integration-form", onSubmit: (event) => {
    event.preventDefault();
    generateCustomTemplate(event.currentTarget);
  } },
    field(t("manager.integrations.customTool"), h("input", { class: "input", name: "toolName", placeholder: t("manager.integrations.customTool"), required: true })),
    field(t("manager.integrations.customSource"), h("input", { class: "input", name: "source", placeholder: "my-tool-mcp" })),
    field(t("manager.integrations.customLabel"), h("input", { class: "input", name: "sourceLabel", placeholder: t("manager.integrations.customLabel") })),
    h("button", { class: "btn", type: "submit" }, t("manager.actions.generateCustomTemplate"))
  ) : null;
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.integrations.title")),
        h("p", { class: "empty-text" }, t("manager.integrations.subtitle"))
      ),
      h("div", { class: "integration-overview" },
        h("strong", {}, integrations.filter((item) => item.configured).length),
        h("span", {}, t("manager.integrations.configuredCount", { total: integrations.length }))
      )
    ),
    h("div", { class: "integration-filters", role: "group", "aria-label": t("manager.integrations.filterLabel") },
      INTEGRATION_FILTERS.map((filter) => h("button", {
        class: integrationFilter === filter ? "active" : "",
        type: "button",
        "aria-pressed": integrationFilter === filter,
        onClick: () => { integrationFilter = filter; renderView("integrations"); }
      }, t(`manager.integrations.filter.${filter}`)))
    ),
    h("div", { class: "integration-workspace" },
      h("div", { class: "integration-list" },
        filtered.length ? filtered.map((item) => {
          const itemProgress = integrationCompletion(item, integrationTestResults.get(item.id));
          return h("button", {
            class: `integration-row${item.id === selected?.id ? " active" : ""}`,
            type: "button",
            onClick: () => { selectedIntegrationId = item.id; renderView("integrations"); }
          },
            brandIcon(item, "row", itemProgress.state),
            h("span", { class: "integration-row-copy" },
              h("strong", {}, item.name),
              h("small", {}, t(integrationSummaryKey(item, integrationTestResults.get(item.id))))
            ),
            itemProgress.total ? h("span", { class: "integration-progress" }, `${itemProgress.completed}/${itemProgress.total}`) : null
          );
        }) : h("p", { class: "empty-text integration-empty" }, t("manager.integrations.noMatches"))
      ),
      selected ? h("article", { class: "integration-detail" },
        h("div", { class: "integration-detail-header" },
          h("div", { class: "integration-title-lockup" },
            brandIcon(selected, "detail"),
            h("div", {},
              h("p", { class: "integration-kicker" }, selected.sourceLabel || selected.source),
              h("h3", {}, selected.name),
              h("p", { class: "model-meta" }, t(integrationSummaryKey(selected, testResult)))
            )
          ),
          h("span", { class: progress?.state === "ready" ? "status-value status-ok" : "status-value" }, t(integrationSummaryKey(selected, testResult)))
        ),
        selected.configFormat !== "templateOnly" ? h("div", { class: "setup-checklist" },
          statusStep(t("manager.integrations.step.detected"), selected.installed || selected.configFound || selected.configured, selected.installed ? t("manager.integrations.installed") : t("manager.integrations.notDetected")),
          statusStep(t("manager.integrations.step.config"), selected.configured, selected.configured ? t("manager.integrations.configured") : t("manager.integrations.step.configHelp")),
          statusStep(t("manager.integrations.step.instructions"), selected.instructionsFound, selected.instructionsFound ? t("manager.integrations.instructionsFound") : t("manager.integrations.step.instructionsHelp")),
          statusStep(t("manager.integrations.step.test"), testResult?.ok === true, selected.needsRestart
            ? t("manager.integrations.step.restartHelp", { name: selected.name })
            : testResult?.ok
              ? t("manager.integrations.testPassedAt", { time: testResult.testedAt ? new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(testResult.testedAt)) : "" })
              : testResult?.error ? t(integrationErrorKey(testResult.error)) : t("manager.integrations.step.testHelp"))
        ) : customForm,
        testResult?.ok === false && testResult.error ? h("div", { class: "integration-alert", role: "status" },
          h("strong", {}, t(integrationErrorKey(testResult.error))),
          h("details", {},
            h("summary", {}, t("manager.integrations.technicalDetails")),
            h("p", {}, testResult.error)
          )
        ) : null,
        selected.configPath ? h("p", { class: "integration-path", title: selected.configPath }, `${t("manager.integrations.config")}: ${selected.configPath}`) : null,
        h("div", { class: "integration-primary-actions" }, primaryAction(),
          selected.configFormat !== "templateOnly" && selected.configured && !selected.instructionsFound
            ? h("button", { class: "btn", type: "button", onClick: () => showAgentInstructions(selected.id) }, t("manager.actions.previewInstructions"))
            : null
        ),
        h("details", { class: "integration-advanced" },
          h("summary", {}, t("manager.integrations.advanced")),
          h("div", { class: "integration-advanced-actions" },
            h("button", { class: "btn", type: "button", onClick: () => previewIntegration(selected.id) }, t("manager.actions.preview")),
            selected.configFormat !== "templateOnly" ? h("button", { class: "btn", type: "button", onClick: () => showAgentInstructions(selected.id) }, t("manager.actions.agentInstructions")) : null,
            selected.configPath ? h("button", { class: "btn", type: "button", onClick: () => openIntegrationConfig(selected.id) }, t("manager.actions.openConfig")) : null,
            selected.restoreAvailable ? h("button", { class: "btn btn-danger", type: "button", onClick: () => restoreIntegration(selected.id) }, t("manager.actions.restoreBackup")) : null,
            h("button", { class: "btn", type: "button", onClick: () => copyIntegrationTemplate(selected.configFormat === "templateOnly" ? null : selected.id) }, t("manager.actions.copyTemplate"))
          ),
          h("p", { class: "integration-path" }, `${t("manager.integrations.command")}: ${selected.source} / ${selected.sourceLabel}`)
        )
      ) : h("article", { class: "integration-detail" }, h("p", { class: "empty-text" }, t("manager.integrations.noMatches")))
    )
  );
}

async function diagnosticsView() {
  diagnostics = await window.companion?.getDiagnostics?.() || {};
  history = await window.companion?.getHistory?.() || [];
  await refreshReminders();
  if (!updateStatus) await refreshUpdateStatus({ silent: true });
  const row = (label, ok, value) => h("div", { class: "status-row" },
    h("span", { class: "status-label" }, label),
    h("span", { class: ok ? "status-value status-ok" : "status-value status-err" }, value || (ok ? t("manager.diagnostics.ok") : t("manager.diagnostics.needsAttention")))
  );
  return h("section", {},
    h("h2", { class: "view-title" }, t("manager.diagnostics.title")),
    h("div", { class: "grid-2" },
      h("article", { class: "card diag-card" },
        row(t("manager.diagnostics.localApi"), diagnostics.apiOk, diagnostics.apiOk ? t("manager.diagnostics.online") : t("manager.diagnostics.unreachable")),
        row(t("manager.diagnostics.mcpConfigured"), diagnostics.mcpConfigured, diagnostics.mcpConfigured ? t("manager.diagnostics.yes") : t("manager.diagnostics.no")),
        row(t("manager.diagnostics.localConfig"), diagnostics.localConfigExists, diagnostics.localConfigExists ? t("manager.diagnostics.found") : t("manager.diagnostics.missing")),
        diagnostics.localConfigPath ? h("p", { class: "model-meta", title: diagnostics.localConfigPath }, diagnostics.localConfigPath) : null,
        ...(diagnostics.configWarnings || []).map((warning) => h("p", { class: "error-text selectable", title: warning.file }, t("manager.diagnostics.configWarning", { message: warning.message }))),
        row(t("manager.diagnostics.spineAssets"), diagnostics.assetDirExists && diagnostics.hasSkel && diagnostics.hasAtlas && diagnostics.hasPng, "skel / atlas / png"),
        row(t("manager.diagnostics.modelHealth"), diagnostics.modelHealth?.ok, localizedDiagnosticMessage(diagnostics.modelHealth?.message)),
        row(t("manager.diagnostics.shortcut"), diagnostics.shortcut?.registered || diagnostics.shortcut?.enabled === false,
          diagnostics.shortcut?.enabled === false
            ? t("manager.status.disabled")
            : localizedDiagnosticMessage(diagnostics.shortcut?.error) || diagnostics.shortcut?.accelerator),
        diagnostics.gpu ? row(t("manager.diagnostics.gpu"), true, localizedDiagnosticMessage(diagnostics.gpu.message) || diagnostics.gpu.mode) : null,
        diagnostics.gpu?.renderer ? row(t("manager.diagnostics.renderer"), diagnostics.gpu.renderer.status !== "context-lost", t("manager.diagnostics.rendererSummary", { status: localizedRendererState(diagnostics.gpu.renderer.status), count: diagnostics.gpu.renderer.recoveryCount || 0 })) : null,
        diagnostics.gpu?.webviewCacheDir ? h("p", { class: "model-meta", title: diagnostics.gpu.webviewCacheDir }, diagnostics.gpu.webviewCacheDir) : null,
        diagnostics.gpu?.tdrNote ? h("p", { class: "model-meta" }, localizedDiagnosticMessage(diagnostics.gpu.tdrNote)) : null,
        row(t("manager.diagnostics.runtime"), true, runtimeName()),
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
        h("p", { class: "model-meta" }, updateStatus?.error || t("manager.diagnostics.updateSummary", { channel: updateStatus?.channel || "stable", current: updateStatus?.currentVersion || "", latest: updateStatus?.latestVersion || "" })),
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

async function refreshAvatarPacks() {
  avatarPacks = await window.companion?.listAvatarPacks?.() || [];
  return avatarPacks;
}

async function avatarStudioView() {
  const requirementsPromise = typeof window.companion?.avatarRequirements === "function"
    ? window.companion.avatarRequirements().catch(() => null)
    : Promise.resolve(null);
  const [requirements] = await Promise.all([
    requirementsPromise,
    refreshAvatarPacks().catch(() => [])
  ]);
  const pathInput = h("input", { class: "input", type: "text", placeholder: t("manager.avatar.pathPlaceholder"), "aria-label": t("manager.avatar.packPath") });
  const resultRoot = h("div", { class: "avatar-validation" });
  const editorHost = h("div", { class: "avatar-editor-host" });
  let latestValidation = null;
  const importButton = h("button", { class: "btn btn-primary", type: "button", disabled: true }, t("manager.avatar.saveDraft"));
  const createParent = h("input", { class: "input", placeholder: t("manager.avatar.parentFolder") });
  const createId = h("input", { class: "input", placeholder: t("manager.avatar.packId") });
  const createName = h("input", { class: "input", placeholder: t("manager.avatar.packName") });
  const createPack = async () => {
    const parent = createParent.value.trim();
    const id = createId.value.trim();
    if (!parent || !id || !createName.value.trim()) return showToast(t("manager.avatar.createRequired"));
    const separator = parent.includes("\\") ? "\\" : "/";
    const result = await window.companion?.createAvatarPack?.({ path: `${parent.replace(/[\\/]$/, "")}${separator}${id}`, id, name: createName.value.trim(), source: "local", licenseNote: t("manager.avatar.userOwnedLicense") });
    await refreshAvatarPacks();
    await openEditor(result.path);
  };
  const duplicatePack = (pack) => {
    const copyId = h("input", { class: "input", value: `${pack.id}-copy`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80), "aria-label": t("manager.avatar.packId") });
    const copyName = h("input", { class: "input", value: t("manager.avatar.copyName", { name: pack.name || pack.id }), "aria-label": t("manager.avatar.packName") });
    const form = h("div", { class: "modal-form" }, copyId, copyName);
    showModal(t("manager.avatar.duplicateTitle"), t("manager.avatar.duplicateBody"), [
      form,
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
      h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
        const id = copyId.value.trim();
        const name = copyName.value.trim();
        if (!id || !name) return showToast(t("manager.avatar.duplicateRequired"));
        const parent = String(pack.path).replace(/[\\/][^\\/]+$/, "");
        await window.companion?.duplicateAvatarPack?.({ path: pack.path, destinationParent: parent, id, name });
        closeModal({ dismissed: false });
        await refreshAvatarPacks();
        await renderView("avatar");
      } }, t("manager.avatar.duplicate"))
    ]);
  };
  const renderValidation = (result) => {
    latestValidation = result || null;
    const ok = result?.ok === true;
    importButton.textContent = t(avatarActionKey(result));
    importButton.disabled = !ok;
    resultRoot.replaceChildren(
      h("p", { class: ok ? "status-value status-ok" : "status-value status-err" }, t(avatarStatusKey(result))),
      result?.id || result?.name ? h("p", { class: "model-meta" }, `${result.name || result.id} (${result.id || ""})`) : null,
      h("div", { class: "avatar-readiness" },
        badge(result?.hasPreview ? t("manager.avatar.previewReady") : t("manager.avatar.previewMissing"), result?.hasPreview ? "badge-success" : "badge-warning"),
        badge(result?.hasLayersDir ? t("manager.avatar.layersReady") : t("manager.avatar.layersMissing"), result?.hasLayersDir ? "badge-success" : "badge-warning"),
        badge(result?.runtimeReady ? t("manager.avatar.runtimeReady") : t("manager.avatar.runtimeMissing"), result?.runtimeReady ? "badge-success" : "badge-warning")
      ),
      ...(result?.errors || []).map((item) => h("p", { class: "error-text" }, item)),
      ...(result?.warnings || []).map((item) => h("p", { class: "model-meta" }, item))
    );
  };
  const validate = async () => {
    const path = pathInput.value.trim();
    if (!path) {
      resultRoot.replaceChildren(h("p", { class: "error-text" }, t("manager.avatar.selectFirst")));
      return null;
    }
    try {
      const result = await window.companion?.validateAvatarPack?.(path);
      renderValidation(result);
      return result;
    } catch (error) {
      resultRoot.replaceChildren(h("p", { class: "error-text" }, error?.message || String(error)));
      return null;
    }
  };
  const chooseFolder = async () => {
    const selected = await window.companion?.pickAvatarPackFolder?.();
    if (typeof selected !== "string" || !selected) return;
    pathInput.value = selected;
    pathInput.dispatchEvent(new Event("input"));
    await validate();
    await openEditor(selected);
  };
  const openEditor = async (packPath) => {
    if (!packPath) return;
    pathInput.value = packPath;
    editorHost.replaceChildren(h("p", { class: "empty-text" }, t("manager.status.loading")));
    try {
      const editor = await createAvatarEditor({
        path: packPath,
        bridge: window.companion,
        labels: {
          preview: t("manager.avatar.title"), visible: t("manager.avatar.visible"), up: t("manager.avatar.moveUp"), down: t("manager.avatar.moveDown"), remove: t("manager.avatar.delete"),
          name: t("manager.avatar.packName"), file: t("manager.avatar.layerFile"), noLayer: t("manager.avatar.noIssues"), addLayer: t("manager.avatar.addLayers"),
          save: t("manager.avatar.saveManifest"), validate: t("manager.avatar.validate"), layers: t("manager.avatar.layers"), properties: t("manager.avatar.properties"),
          motions: t("manager.avatar.motions"), issues: t("manager.avatar.issues"), noIssues: t("manager.avatar.noIssues"),
          anchorX: t("manager.avatar.anchorX"), anchorY: t("manager.avatar.anchorY"), offsetX: t("manager.avatar.offsetX"), offsetY: t("manager.avatar.offsetY"),
          scaleX: t("manager.avatar.scaleX"), scaleY: t("manager.avatar.scaleY"), cropX: t("manager.avatar.cropX"), cropY: t("manager.avatar.cropY"),
          cropWidth: t("manager.avatar.cropWidth"), cropHeight: t("manager.avatar.cropHeight")
        },
        onSaved: (next) => { renderValidation(next); showToast(t("manager.status.settingsSaved")); }
      });
      editorHost.replaceChildren(editor);
      editorHost.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      editorHost.replaceChildren(h("p", { class: "error-text" }, error?.message || String(error)));
    }
  };
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
      const name = result?.validation?.name || result?.validation?.id || "avatar pack";
      showToast(t(avatarResultToastKey(result), { name }));
      await refreshAvatarPacks();
      installedModels = await window.companion?.getInstalledModels?.() || installedModels;
      if (result?.installed && result?.modelId) {
        await window.companion?.beginModelTrial?.(result.modelId);
        const restoreTrial = () => window.companion?.cancelModelTrial?.().catch(() => {});
        showModal(t("manager.avatar.tryOnTitle"), t("manager.avatar.tryOnBody", { name }), [
          h("button", { class: "btn btn-primary", type: "button", onClick: async () => { await window.companion?.confirmModelTrial?.(); closeModal({ dismissed: false }); } }, t("manager.avatar.keep")),
          h("button", { class: "btn", type: "button", onClick: async () => { await window.companion?.cancelModelTrial?.(); closeModal({ dismissed: false }); } }, t("manager.avatar.restore"))
        ], { onDismiss: restoreTrial });
      }
      await renderView("avatar");
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
    h("div", { class: "avatar-studio-layout" },
      h("article", { class: "card avatar-workflow" },
        h("div", { class: "avatar-workflow-heading" },
          h("div", {}, h("span", { class: "step-number" }, "1"), h("strong", {}, t("manager.avatar.stepSelect"))),
          h("div", {}, h("span", { class: "step-number" }, "2"), h("strong", {}, t("manager.avatar.stepValidate"))),
          h("div", {}, h("span", { class: "step-number" }, "3"), h("strong", {}, t("manager.avatar.stepImport")))
        ),
        h("h3", {}, t("manager.avatar.workflowTitle")),
        h("p", { class: "model-meta" }, t("manager.avatar.workflowBody")),
        h("div", { class: "avatar-pack-form" },
          pathInput,
          h("div", { class: "avatar-pack-actions" },
            h("button", { class: "btn", type: "button", onClick: chooseFolder }, t("manager.avatar.selectFolder")),
            h("button", { class: "btn", type: "button", onClick: validate }, t("manager.avatar.validate")),
            importButton
          )
        ),
        resultRoot
      ),
      h("article", { class: "card avatar-create-pack" },
        h("h3", {}, t("manager.avatar.createTitle")),
        h("p", { class: "model-meta" }, t("manager.avatar.createBody")),
        h("div", { class: "avatar-create-grid" }, createParent, createId, createName,
          h("button", { class: "btn", type: "button", onClick: async () => { const selected = await window.companion?.pickAvatarPackFolder?.(); if (selected) createParent.value = selected; } }, t("manager.avatar.chooseParent")),
          h("button", { class: "btn btn-primary", type: "button", onClick: createPack }, t("manager.avatar.createPack"))
        )
      ),
      h("div", { class: "grid-2 avatar-secondary-grid" },
        h("article", { class: "card" },
          h("h3", {}, t("manager.avatar.inputsTitle")),
          h("p", { class: "model-meta" }, t("manager.avatar.inputsBody")),
          h("p", { class: "model-meta" }, (requirements?.layout || ["avatar-pack.json", "preview.png", "layers/", "exports/"]).join(" · "))
        ),
        h("article", { class: "card" },
          h("h3", {}, t("manager.avatar.limitsTitle")),
          h("p", { class: "model-meta" }, t("manager.avatar.limitsBody"))
        ),
        h("article", { class: "card avatar-registered-card" },
          h("h3", {}, t("manager.avatar.registeredTitle")),
          avatarPacks.length ? h("div", { class: "avatar-pack-list" }, avatarPacks.map((pack) => h("div", { class: "avatar-pack-row" },
            h("div", { class: "avatar-pack-row-copy" }, h("strong", {}, pack.name || pack.id), h("small", { title: pack.path || "" }, pack.path || "")),
            badge(pack.runtimeReady ? t("manager.avatar.runtimeReady") : t("manager.avatar.savedDraftStatus"), pack.runtimeReady ? "badge-success" : "badge-warning"),
            h("div", { class: "avatar-pack-row-actions" },
              h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(pack.path) }, t("manager.actions.openFolder")),
              h("button", { class: "btn", type: "button", onClick: async () => {
                pathInput.value = pack.path || "";
                await validate();
              } }, t("manager.avatar.revalidate")),
              h("button", { class: "btn btn-primary", type: "button", onClick: () => openEditor(pack.path) }, t("manager.avatar.edit")),
              h("button", { class: "btn", type: "button", onClick: async () => { await window.companion?.repackAvatarPack?.(pack.path); await openEditor(pack.path); } }, t("manager.avatar.repack")),
              h("button", { class: "btn", type: "button", onClick: () => duplicatePack(pack) }, t("manager.avatar.duplicate")),
              h("button", { class: "btn danger", type: "button", onClick: () => showModal(t("manager.avatar.deleteConfirmTitle"), t("manager.avatar.deleteConfirmBody", { name: pack.name || pack.id }), [
                h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
                h("button", { class: "btn danger", type: "button", onClick: async () => { closeModal({ dismissed: false }); await window.companion?.deleteAvatarPack?.(pack.path); await refreshAvatarPacks(); await renderView("avatar"); } }, t("manager.avatar.delete"))
              ]) }, t("manager.avatar.delete"))
            )
          ))) : h("p", { class: "empty-text" }, t("manager.avatar.noRegistered"))
        ),
        h("article", { class: "card" },
          h("h3", {}, t("manager.avatar.docsTitle")),
          h("div", { class: "model-actions" },
            h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.("https://github.com/cb8010d6/spine-companion/blob/main/docs/avatar-studio.md") }, "English"),
            h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.("https://github.com/cb8010d6/spine-companion/blob/main/docs/avatar-studio.zh-CN.md") }, "中文")
          )
        )
      ),
      editorHost
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
  if (viewName === "library") render(await libraryView(), viewContainer);
  else if (viewName === "installed") render(installedView(), viewContainer);
  else if (viewName === "downloads") render(downloadsView(), viewContainer);
  else if (viewName === "settings") {
    await refreshReminders();
    render(settingsView(), viewContainer);
  }
  else if (viewName === "integrations") render(await integrationsView(), viewContainer);
  else if (viewName === "avatar") render(await avatarStudioView(), viewContainer);
  else if (viewName === "diagnostics") render(await diagnosticsView(), viewContainer);
}

async function boot() {
  installManagerPreviewBridge();
  if (isTauri()) await initTauriBridge();
  await refreshConfig();
  refreshUpdateStatus({ silent: true }).then((status) => {
    if (status?.updateAvailable) {
      setStatus(t("manager.status.updateAvailable", { version: status.latestVersion }));
    }
    if (activeView === "diagnostics") renderView("diagnostics");
  });
  for (const button of navButtons) button.addEventListener("click", () => navTo(button.dataset.view));
  topbarLocaleSelect?.addEventListener("change", async (event) => {
    const locale = event.target.value;
    await window.companion?.saveSettings?.({ ui: { locale } });
    config.ui = { ...(config.ui || {}), locale };
    applyUiLocale();
    await renderView(activeView);
    showToast(t("manager.status.settingsSaved"));
  });
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
    applyUiLocale();
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
