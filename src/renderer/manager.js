import "./manager.css";
import {
  Activity,
  Bot,
  Box,
  Check,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  House,
  Library,
  Languages,
  PackageCheck,
  Settings,
  Sparkles,
  Trash2,
  X,
  createElement
} from "lucide";
import { initTauriBridge, isTauri } from "./tauri-bridge.js";
import { h, render } from "./lib/dom.js";
import { createI18n, getLocale, t } from "../shared/i18n.js";
import { avatarActionKey, avatarResultToastKey, avatarStatusKey } from "./avatar-ui.js";
import {
  INTEGRATION_FILTERS,
  integrationCanTest,
  integrationCompletion,
  integrationErrorKey,
  integrationReportResult,
  integrationMatchesFilter,
  integrationMatchesSource,
  integrationPrimaryAction,
  integrationSummaryKey,
  integrationTestResult,
  isIntegrationSelfTest,
  selectFilteredIntegration
} from "./integration-ui.js";
import { modelPreview } from "./model-preview.js";
import { readCachedModelPreview, writeCachedModelPreview } from "./model-preview-cache.js";
import {
  createModelAcknowledgementCoordinator,
  modelRequiresAcknowledgement
} from "./model-consent.js";
import { installManagerPreviewBridge } from "./manager-preview.js";
import { applyThemePreference } from "./theme.js";
import { integrationBrand } from "./integration-icons.js";
import {
  LIBRARY_COUNT_DURATION_MS,
  LIBRARY_PAGE_SIZE,
  LIBRARY_PREVIEW_BATCH_SIZE,
  LIBRARY_PREVIEW_CONFIRM_BYTES,
  canRemoveCatalogSource,
  catalogDisplayName,
  catalogDownloadRequest,
  catalogModelSizeBytes,
  catalogModelSourceId,
  catalogSpineDisplayVersion,
  beginDownloadRecord,
  enabledCatalogSources,
  libraryCardRevealDelay,
  libraryCountValue,
  mergeInstalledModelMetadata,
  normalizeCatalogEntries,
  resolveCatalogSourceId,
  selectPreviewBatch,
  retryCatalogEntry,
  upsertInstalledModel
} from "./catalog-model.js";
import { createAvatarEditor } from "./avatar-editor-view.js";
import { createNavigationGuard } from "./navigation.js";
import { actionableManagerErrorBody, readableManagerError } from "./manager-error.js";
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
  integrations: Bot,
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
const remoteCatalogCache = new Map();
const ALL_CATALOG_SOURCES = "all";
export const MANAGER_FRAME_RATE_MODES = Object.freeze(["display", "60", "30"]);
export const MANAGER_PRIMARY_VIEWS = Object.freeze(["dashboard", "library", "integrations", "settings", "diagnostics"]);
export const LIBRARY_TABS = Object.freeze(["catalog", "installed", "downloads"]);

export function resolveManagerNavigation(viewName) {
  if (viewName === "installed" || viewName === "downloads") {
    return { view: "library", libraryTab: viewName };
  }
  return { view: viewName, libraryTab: null };
}
let updateStatus = null;
let liveState = null;
const downloads = {};
const integrationTestResults = new Map();
let integrationFilter = "all";
let selectedIntegrationId = "";
let integrationTestAllInFlight = false;
let dashboardRenderRevision = 0;
const navigationGuard = createNavigationGuard();
let librarySession = null;
let libraryTab = "catalog";
let librarySelectedSource = ALL_CATALOG_SOURCES;
let modalReturnFocus = null;
let modalOnDismiss = null;
let spinePreviewModulePromise = null;
const modelAcknowledgementCoordinator = createModelAcknowledgementCoordinator();

function loadSpinePreview() {
  spinePreviewModulePromise ||= import("./spine-preview.js");
  return spinePreviewModulePromise;
}

export function resolveLibraryCatalogSource(sources = [], selected = ALL_CATALOG_SOURCES) {
  const enabledSources = enabledCatalogSources(sources);
  if (!enabledSources.length) return "";
  return selected === ALL_CATALOG_SOURCES
    ? ALL_CATALOG_SOURCES
    : resolveCatalogSourceId(enabledSources, selected);
}

export function catalogSourcesForSelection(sourceId, sources = []) {
  const enabledSources = enabledCatalogSources(sources);
  return sourceId === ALL_CATALOG_SOURCES
    ? enabledSources
    : enabledSources.filter((source) => source.id === sourceId);
}

export function managerInitialView(runtimeConfig = {}) {
  const spine = runtimeConfig.spine || {};
  const hasActiveModel = Boolean(
    String(spine.modelId || "").trim()
    || (spine.assetDirConfigured !== false && String(spine.assetDir || "").trim() && String(spine.skel || "").trim())
  );
  return hasActiveModel ? "dashboard" : "library";
}

function setStatus(text) {
  topbarStatus.textContent = text;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function showManagerError({ title, error, retry = null, extraActions = [], openDiagnostics = true, fallback = "" }) {
  const retryAction = typeof retry === "function"
    ? h("button", { class: "btn btn-primary", type: "button", onClick: async () => {
      closeModal({ dismissed: false });
      try {
        await retry();
      } catch (retryError) {
        showManagerError({ title, error: retryError, retry, extraActions, openDiagnostics, fallback });
      }
    } }, t("manager.actions.retry"))
    : null;
  const diagnosticsAction = openDiagnostics
    ? h("button", { class: "btn", type: "button", onClick: () => {
      closeModal({ dismissed: false });
      navTo("diagnostics");
    } }, t("manager.actions.openDiagnostics"))
    : null;
  showModal(
    title,
    actionableManagerErrorBody(
      error,
      t(openDiagnostics ? "manager.error.nextStep" : "manager.error.nextStep.retryOnly"),
      fallback
    ),
    [
      h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.close")),
      ...extraActions,
      diagnosticsAction,
      retryAction
    ]
  );
}

function modelAcknowledgementBody(details, modelCount) {
  const blocks = details.map((detail) => [
    t("manager.modal.modelConsentSource", { value: detail.source }),
    t("manager.modal.modelConsentAuthor", { value: detail.author }),
    t("manager.modal.modelConsentLicense", { value: detail.license }),
    t("manager.modal.modelConsentWarning", { value: detail.licenseWarning }),
    t("manager.modal.modelConsentRepository", { value: detail.repository }),
    t("manager.modal.modelConsentRevision", { value: detail.revision }),
    detail.licenseNote ? t("manager.modal.modelConsentNote", { value: detail.licenseNote }) : ""
  ].filter(Boolean).join("\n"));
  return [
    t("manager.modal.modelConsentIntro", { count: modelCount }),
    ...blocks
  ].join("\n\n");
}

async function requestModelAcknowledgement(models = []) {
  return modelAcknowledgementCoordinator.request(models, (pending, requestedModels) => new Promise((resolve) => {
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      closeModal({ dismissed: false });
      resolve(accepted);
    };
    showModal(
      t("manager.modal.modelConsentTitle"),
      modelAcknowledgementBody(pending, new Set(requestedModels.map((model) => model?.id).filter(Boolean)).size || requestedModels.length),
      [
        h("button", { class: "btn", type: "button", onClick: () => finish(false) }, t("manager.actions.cancel")),
        h("button", { class: "btn btn-primary", type: "button", onClick: () => finish(true) }, t("manager.actions.acknowledgeContinue"))
      ],
      { onDismiss: () => {
        if (settled) return;
        settled = true;
        resolve(false);
      } }
    );
  }));
}

function modelFromCatalogEntry(entry) {
  return normalizeCatalogEntries(entry ? [entry] : [])[0] || null;
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
  const navigation = resolveManagerNavigation(viewName);
  if (navigation.libraryTab) libraryTab = navigation.libraryTab;
  activeView = navigation.view;
  for (const button of navButtons) button.classList.toggle("active", button.dataset.view === activeView);
  if (topbarTitle) topbarTitle.textContent = t(`manager.nav.${activeView}`);
  renderView(activeView);
}

function selectLibraryTab(tab) {
  if (!LIBRARY_TABS.includes(tab)) return;
  libraryTab = tab;
  activeView = "library";
  for (const button of navButtons) button.classList.toggle("active", button.dataset.view === "library");
  if (topbarTitle) topbarTitle.textContent = t("manager.nav.library");
  renderView("library");
}

function libraryTabs(selectedTab) {
  return h("div", { class: "library-tabs", role: "tablist", "aria-label": t("manager.library.tabsLabel") },
    ...LIBRARY_TABS.map((tab) => h("button", {
      class: `library-tab${selectedTab === tab ? " active" : ""}`,
      type: "button",
      role: "tab",
      "aria-selected": selectedTab === tab ? "true" : "false",
      onClick: () => selectLibraryTab(tab)
    }, t(`manager.library.tab.${tab}`)))
  );
}

function animateLibraryCount(element, target) {
  const finalValue = Math.max(0, Math.floor(Number(target) || 0));
  element.textContent = "0";
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    element.textContent = String(finalValue);
    return;
  }
  let startedAt = 0;
  const frame = (timestamp) => {
    if (!element.isConnected) return;
    if (!startedAt) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / LIBRARY_COUNT_DURATION_MS);
    element.textContent = String(libraryCountValue(finalValue, progress));
    if (progress < 1) window.requestAnimationFrame(frame);
  };
  window.setTimeout(() => window.requestAnimationFrame(frame), 70);
}

function libraryLoadingView() {
  const enabledSources = enabledCatalogSources(config.models?.sources || []);
  librarySelectedSource = resolveLibraryCatalogSource(enabledSources, librarySelectedSource);
  const sourceFilter = h("select", {
    class: "select library-filter",
    "aria-label": t("manager.library.sourceFilterLabel"),
    disabled: enabledSources.length === 0,
    onChange: (event) => {
      librarySelectedSource = event.target.value;
      renderView("library");
    }
  }, ...(enabledSources.length
    ? [
        h("option", { value: ALL_CATALOG_SOURCES }, t("manager.library.allSources")),
        ...enabledSources.map((source) => h("option", { value: source.id }, catalogSourceLabel(source)))
      ]
    : [h("option", { value: "" }, t("manager.library.noEnabledSources"))]));
  sourceFilter.value = librarySelectedSource;
  const skeletonCards = Array.from({ length: 6 }, (_, index) => h("article", {
    class: "model-card model-card-skeleton",
    style: { "--reveal-delay": `${libraryCardRevealDelay(index)}ms` },
    "aria-hidden": "true"
  },
  h("div", { class: "model-preview skeleton-block" }),
  h("div", { class: "model-info" },
    h("span", { class: "skeleton-line skeleton-title" }),
    h("span", { class: "skeleton-line skeleton-meta" }),
    h("span", { class: "skeleton-line skeleton-detail" })
  )));
  return h("section", { class: "library-loading-shell", "aria-busy": "true" },
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.library.title")),
        h("p", { class: "empty-text" }, t("manager.library.subtitle"))
      ),
      h("div", { class: "model-actions" },
        h("button", { class: "btn", type: "button", disabled: true }, t("manager.actions.importLocal")),
        h("button", { class: "btn", type: "button", onClick: () => navTo("avatar") }, ...iconLabel(Sparkles, t("manager.labs.open")))
      )
    ),
    libraryTabs("catalog"),
    h("div", { class: "library-summary" },
      h("div", {}, h("strong", {}, "0"), h("span", {}, t("manager.library.catalogCount"))),
      h("div", {}, h("strong", {}, "0"), h("span", {}, t("manager.library.installedCount"))),
      h("div", {}, h("strong", {}, "0"), h("span", {}, t("manager.library.activeCount")))
    ),
    h("div", { class: "library-toolbar" },
      sourceFilter,
      h("input", { class: "input", type: "search", placeholder: t("manager.search.placeholder"), disabled: true }),
      h("select", { class: "select library-filter", disabled: true }, h("option", {}, t("manager.library.filter.all"))),
      h("button", { class: "btn", type: "button", disabled: true }, ...iconLabel(Eye, t("manager.library.previewBatch", { count: LIBRARY_PREVIEW_BATCH_SIZE })))
    ),
    h("div", { class: "grid-2 library-grid" }, ...skeletonCards)
  );
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
  const renderAndCache = async ({ acknowledgement = false, reportError = false } = {}) => {
    const acknowledgementRequired = preview.canPrepareRemotePreview && modelRequiresAcknowledgement(model);
    if (acknowledgementRequired && !acknowledgement) {
      acknowledgement = await requestModelAcknowledgement([model]);
      if (!acknowledgement) return false;
    }
    if (previewButton) {
      previewButton.disabled = true;
      previewButton.textContent = t("manager.model.previewLoading");
    }
    let dataUrl = "";
    let previewError = null;
    try {
      if (!preview.spinePreviewUrl && preview.canPrepareRemotePreview) {
        if (!window.companion?.prepareModelPreview) throw new Error(t("manager.model.previewUnavailable"));
        const sourceId = model.catalogSourceId || model.sourceId;
        if (!sourceId) throw new Error(t("manager.model.previewUnavailable"));
        const prepared = await window.companion.prepareModelPreview(sourceId, model.id, acknowledgementRequired && acknowledgement);
        preview.spinePreviewUrl = prepared?.assetUrl || "";
      }
      const { renderSpinePreview } = await loadSpinePreview();
      dataUrl = await renderSpinePreview(node, preview);
    } catch (error) {
      previewError = error;
      node.title = readableManagerError(error, t("manager.model.previewFailed"));
      if (reportError) {
        showManagerError({
          title: t("manager.model.previewFailed"),
          error,
          retry: () => renderAndCache({ acknowledgement: true, reportError: true }),
          fallback: t("manager.model.previewFailed")
        });
      }
    }
    if (dataUrl) {
      writeCachedModelPreview(model, dataUrl);
      previewButton?.remove();
      return true;
    }
    if (reportError && !previewError) {
      showManagerError({
        title: t("manager.model.previewFailed"),
        error: t("manager.model.previewFailed"),
        retry: () => renderAndCache({ acknowledgement: true, reportError: true }),
        fallback: t("manager.model.previewFailed")
      });
    }
    if (previewButton) {
      previewButton.disabled = false;
      previewButton.replaceChildren(...iconLabel(Eye, t("manager.model.previewRetry")));
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
        renderAndCache({ reportError: true });
      }
    }, ...iconLabel(Eye, t("manager.model.preview")));
    children.push(previewButton);
  }
  const node = h("div", { class: `model-preview ${preview.imageUrl ? "has-image" : ""}`, style: preview.style, "aria-label": `Preview for ${preview.label}` },
    children
  );
  if (previewButton && typeof onPreviewReady === "function") {
    onPreviewReady({ id: model.id, model, bytes: catalogModelSizeBytes(model), run: renderAndCache });
  }
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

function iconLabel(Icon, label) {
  const icon = createElement(Icon);
  icon.classList.add("btn-icon");
  icon.setAttribute("aria-hidden", "true");
  return [icon, h("span", {}, label)];
}

function iconAction(Icon, label, onClick, { danger = false, disabled = false } = {}) {
  const [icon] = iconLabel(Icon, label);
  return h("button", {
    class: `btn model-icon-action${danger ? " danger" : ""}`,
    type: "button",
    title: label,
    "aria-label": label,
    disabled,
    onClick
  }, icon);
}

function catalogSourceLabel(source = {}) {
  const key = `manager.library.officialSource.${source.id || "unknown"}`;
  const translated = t(key);
  return translated === key ? (source.label || source.id || t("manager.library.unknownSource")) : translated;
}

function catalogSourceStateLabel(state = "") {
  const key = `manager.library.sourceState.${state}`;
  const translated = t(key);
  return translated === key ? state : translated;
}

function localizedDiagnosticMessage(message) {
  const keys = {
    "No active asset directory.": "manager.diagnostics.message.noAssetDirectory",
    "No recoverable downloaded catalog model was found.": "manager.diagnostics.message.noRecoverableModel",
    "Spine asset set is healthy.": "manager.diagnostics.message.assetsHealthy",
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

async function startDownload(id, catalogEntry = null, acknowledgement = false) {
  downloads[id] = beginDownloadRecord(catalogEntry, t("manager.download.initializing"));
  librarySession?.refreshModel(id);
  try {
    const installer = catalogEntry
      ? window.companion?.installCatalogModel
      : window.companion?.installModel;
    if (!installer) throw new Error(t("manager.error.installUnavailable"));
    const result = catalogEntry
      ? await installer(catalogEntry.catalogSourceId || catalogEntry.sourceId, id, acknowledgement)
      : await installer({ id });
    downloads[id] = { ...(downloads[id] || {}), status: "succeeded", current: downloads[id]?.total || 1, total: downloads[id]?.total || 1, file: t("manager.download.done") };
    await refreshConfig();
    installedModels = upsertInstalledModel(
      installedModels,
      { ...(result || {}), id: result?.id || id },
      catalogEntry?.model || catalogEntry || { id }
    );
    librarySession?.refresh({ installed: true });
    setStatus(t("manager.status.installedModel", { name: result?.name || id }));
  } catch (error) {
    const message = error.message || t("manager.error.downloadFailed");
    if (/cancel/i.test(message)) {
      downloads[id] = { ...(downloads[id] || {}), status: "cancelled", error: "", current: 0 };
      librarySession?.refreshModel(id);
      setStatus(t("manager.status.downloadCancelled"));
      return;
    }
    downloads[id] = { ...(downloads[id] || {}), status: "failed", error: message, current: 0, total: downloads[id]?.total || 1 };
    librarySession?.refreshModel(id);
    setStatus(t("manager.status.downloadFailed", { id }));
    showManagerError({
      title: t("manager.error.downloadFailed"),
      error: message,
      retry: () => {
        const model = modelFromCatalogEntry(catalogEntry);
        if (model) confirmDownload(model);
        else startDownload(id, null, false);
      },
      fallback: t("manager.error.downloadFailed")
    });
  }
  if (activeView === "library" && libraryTab !== "catalog") renderView("library");
}

function emptyRemoteCatalog() {
  return { models: [], sources: [] };
}

export function mergeRemoteCatalogs(catalogs = []) {
  const models = new Map();
  const sources = [];
  for (const catalog of catalogs) {
    for (const entry of catalog?.models || []) {
      const id = entry?.model?.id || entry?.id;
      if (id && !models.has(id)) models.set(id, entry);
    }
    sources.push(...(catalog?.sources || []));
  }
  return { models: [...models.values()], sources };
}

function rendererCachedCatalog(sourceId, sources) {
  if (sourceId !== ALL_CATALOG_SOURCES && remoteCatalogCache.has(sourceId)) {
    return { catalog: remoteCatalogCache.get(sourceId), available: true };
  }
  if (sourceId !== ALL_CATALOG_SOURCES) {
    return { catalog: emptyRemoteCatalog(), available: false };
  }
  const cached = catalogSourcesForSelection(sourceId, sources)
    .filter((source) => remoteCatalogCache.has(source.id))
    .map((source) => remoteCatalogCache.get(source.id));
  return cached.length
    ? { catalog: mergeRemoteCatalogs(cached), available: true }
    : { catalog: emptyRemoteCatalog(), available: false };
}

function cacheRemoteCatalog(sourceId, sources, catalog) {
  remoteCatalogCache.set(sourceId, catalog);
  for (const source of catalogSourcesForSelection(sourceId, sources)) {
    remoteCatalogCache.set(source.id, {
      models: (catalog.models || []).filter((entry) => (entry.catalogSourceId || entry.model?.catalogSourceId) === source.id),
      sources: (catalog.sources || []).filter((status) => status.sourceId === source.id)
    });
  }
}

async function getCachedRemoteCatalog(sourceId, sources) {
  const rendererCache = rendererCachedCatalog(sourceId, sources);
  if (rendererCache.available || !window.companion?.getCachedModelCatalogs) return rendererCache;
  const selectedSources = catalogSourcesForSelection(sourceId, sources);
  if (!selectedSources.length) return rendererCache;
  try {
    const cached = await window.companion.getCachedModelCatalogs();
    const catalog = Array.isArray(cached) ? { models: cached, sources: [] } : (cached || emptyRemoteCatalog());
    cacheRemoteCatalog(sourceId, sources, catalog);
    return { catalog, available: true };
  } catch {
    return rendererCache;
  }
}

async function refreshRemoteCatalog(sourceId, sources) {
  const empty = emptyRemoteCatalog();
  if (!sourceId) return empty;
  const cached = rendererCachedCatalog(sourceId, sources).catalog;
  if (!window.companion?.refreshModelCatalogs) return cached;
  const selectedSources = catalogSourcesForSelection(sourceId, sources);
  if (!selectedSources.length) return empty;
  try {
    return await window.companion.refreshModelCatalogs();
  } catch (error) {
    return {
      models: cached.models || [],
      sources: [{
        sourceId,
        state: cached.models?.length ? "stale" : "failed",
        modelCount: cached.models?.length || 0,
        error: error?.message || String(error)
      }]
    };
  }
}

async function libraryView({ cachedOnly = false } = {}) {
  const enabledSources = enabledCatalogSources(config.models?.sources || []);
  librarySelectedSource = resolveLibraryCatalogSource(enabledSources, librarySelectedSource);
  const sourceValue = librarySelectedSource;
  const cachedResult = cachedOnly
    ? await getCachedRemoteCatalog(sourceValue, enabledSources)
    : null;
  let remoteCatalog = cachedOnly
    ? cachedResult.catalog
    : await refreshRemoteCatalog(sourceValue, enabledSources);
  let catalog = [];
  let catalogTotal = 0;
  let catalogSearchRevision = 0;
  let installedIds = new Set(installedModels.map((model) => model.id));
  let activeId = activeInstalledId();
  let filterValue = "all";
  let catalogPage = 1;
  let catalogSearchTimer = 0;
  const pageSize = LIBRARY_PAGE_SIZE;
  const search = h("input", {
    class: "input",
    type: "search",
    placeholder: t("manager.search.placeholder"),
    "aria-label": t("manager.search.placeholder"),
    onInput: () => {
      catalogPage = 1;
      window.clearTimeout(catalogSearchTimer);
      catalogSearchTimer = window.setTimeout(() => renderCards(search.value, filterValue), 160);
    }
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
    disabled: enabledSources.length === 0,
    onChange: (event) => {
      librarySelectedSource = event.target.value;
      renderView("library");
    }
  },
    ...(enabledSources.length
      ? [
          h("option", { value: ALL_CATALOG_SOURCES }, t("manager.library.allSources")),
          ...enabledSources.map((source) => h("option", { value: source.id }, catalogSourceLabel(source)))
        ]
      : [h("option", { value: "" }, t("manager.library.noEnabledSources"))])
  );
  sourceFilter.value = sourceValue;
  const sourceStrip = h("div", { class: "catalog-source-strip" });
  const renderSourceStatuses = () => {
    sourceStrip.replaceChildren(...(remoteCatalog.sources || []).map((status) => {
      const source = enabledSources.find((item) => item.id === status.sourceId) || { id: status.sourceId, label: status.sourceId };
      const warning = status.state === "failed" || status.state === "stale";
      return h("span", { class: `badge ${warning ? "badge-warning" : ""}`, title: status.error || "" }, `${catalogSourceLabel(source)}: ${catalogSourceStateLabel(status.state)}`);
    }));
  };
  renderSourceStatuses();
  const grid = h("div", { class: "grid-2 library-grid" });
  const pager = h("div", { class: "library-pager" });
  const cardControllers = new Map();
  let currentPagePreviewTasks = [];
  let revealCards = true;
  const previewButtonLabel = () => t("manager.library.previewBatch", { count: LIBRARY_PREVIEW_BATCH_SIZE });
  const runPreviewBatch = async (tasks) => {
    previewCurrentPageButton.disabled = true;
    previewCurrentPageButton.textContent = t("manager.library.previewingPage", { count: tasks.length });
    let completed = 0;
    for (let index = 0; index < tasks.length; index += 2) {
      const results = await Promise.allSettled(tasks.slice(index, index + 2).map((task) => task.run({
        acknowledgement: modelRequiresAcknowledgement(task.model)
      })));
      completed += results.filter((result) => result.status === "fulfilled" && result.value === true).length;
    }
    previewCurrentPageButton.disabled = false;
    previewCurrentPageButton.replaceChildren(...iconLabel(Eye, previewButtonLabel()));
    showToast(t("manager.library.previewPageResult", { completed, total: tasks.length }));
  };
  const requestPreviewBatch = async () => {
    const tasks = selectPreviewBatch(currentPagePreviewTasks);
    if (!tasks.length) {
      showToast(t("manager.library.previewPageEmpty"));
      return;
    }
    if (!await requestModelAcknowledgement(tasks.map((task) => task.model))) return;
    const bytes = tasks.reduce((total, task) => total + task.bytes, 0);
    if (bytes >= LIBRARY_PREVIEW_CONFIRM_BYTES) {
      showModal(t("manager.library.previewConfirmTitle"), t("manager.library.previewConfirmBody", {
        count: tasks.length,
        size: formatBytes(bytes)
      }), [
        h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel")),
        h("button", { class: "btn btn-primary", type: "button", onClick: () => {
          closeModal();
          runPreviewBatch(tasks);
        } }, t("manager.library.previewContinue"))
      ]);
      return;
    }
    runPreviewBatch(tasks);
  };
  const previewCurrentPageButton = h("button", {
    class: "btn",
    type: "button",
    onClick: requestPreviewBatch
  }, ...iconLabel(Eye, previewButtonLabel()));
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
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)
      || `custom-${Date.now().toString(36)}`;
    const sources = [...(config.models?.sources || []).filter((source) => source.id !== id), { id, label, catalogUrl, kind, enabled: true }];
    await window.companion?.saveSettings?.({ models: { sources } });
    config.models = { ...(config.models || {}), sources };
    await renderView("library");
  };

  async function renderCards(query = "", selectedFilter = "all") {
    const revision = ++catalogSearchRevision;
    const shouldRevealCards = revealCards;
    revealCards = false;
    cardControllers.clear();
    let searchResult;
    try {
      searchResult = await window.companion?.searchModelCatalog?.({
        query,
        sourceIds: sourceValue === ALL_CATALOG_SOURCES ? [] : [sourceValue],
        page: catalogPage,
        pageSize,
        runtimeSpineVersion: "3.8.99",
        includeIncompatible: true,
        installationFilter: selectedFilter
      });
    } catch (error) {
      if (revision !== catalogSearchRevision) return;
      searchResult = { models: [], page: 1, total: 0, totalPages: 0 };
      const message = readableManagerError(error, t("manager.library.catalogLoadFailed"));
      setStatus(message);
      showManagerError({
        title: t("manager.library.catalogLoadFailed"),
        error: message,
        retry: () => renderCards(query, selectedFilter),
        fallback: t("manager.library.catalogLoadFailed")
      });
    }
    if (revision !== catalogSearchRevision || activeView !== "library") return;
    catalog = normalizeCatalogEntries(searchResult?.models || []);
    catalogTotal = Number(searchResult?.total || 0);
    const filtered = catalog;
    const pageCount = Math.max(1, Number(searchResult?.totalPages || 0));
    catalogPage = Math.min(Math.max(1, Number(searchResult?.page || catalogPage)), pageCount);
    currentPagePreviewTasks = [];
    const cards = filtered
      .map((model, index) => {
        const download = downloads[model.id];
        let downloadBusy = download?.status === "pending" || download?.status === "downloading" || download?.status === "cancelling";
        let installed = installedIds.has(model.id);
        let active = activeId === model.id;
        const actionLabel = installed
          ? (active ? t("manager.status.active") : t("manager.actions.setActive"))
          : (downloadBusy ? t("manager.actions.cancel") : t("manager.actions.download"));
        const button = h("button", {
          class: installed ? "btn model-action" : "btn btn-primary model-action",
          type: "button",
          hidden: installed && active,
          onClick: async () => {
            if (installed) {
              if (!active) await activateModel(model.id, { incremental: true });
              return;
            }
            if (!downloadBusy) {
              confirmDownload(model);
              return;
            }
            downloads[model.id] = { ...(downloads[model.id] || {}), status: "cancelling" };
            cardControllers.get(model.id)?.update();
            await window.companion?.cancelModelDownload?.(model.id);
          }
        }, ...iconLabel(installed ? PackageCheck : (downloadBusy ? X : Download), actionLabel));
        const progress = h("span", { class: "model-download-progress" },
          downloadBusy ? `${download?.current || 0}/${download?.total || 0} ${download?.file || ""}` : "");
        const installedMark = badge(t("manager.status.installed"), "badge-success");
        const activeMark = badge(t("manager.status.active"), "badge-warning");
        installedMark.hidden = !installed || active;
        activeMark.hidden = !active;
        const statusRow = h("div", { class: "model-statuses", hidden: !installed }, installedMark, activeMark);
        cardControllers.set(model.id, {
          update() {
            const current = downloads[model.id] || {};
            const busy = current.status === "pending" || current.status === "downloading" || current.status === "cancelling";
            const failed = current.status === "failed";
            installed = installedIds.has(model.id);
            active = activeId === model.id;
            downloadBusy = !installed && busy;
            button.className = installed ? "btn model-action" : "btn btn-primary model-action";
            button.hidden = installed && active;
            button.disabled = false;
            button.replaceChildren(...iconLabel(installed ? PackageCheck : (busy ? X : Download),
              installed ? (active ? t("manager.status.active") : t("manager.actions.setActive"))
                : busy ? (current.status === "cancelling" ? t("manager.status.cancelling") : t("manager.actions.cancel"))
                  : failed ? t("manager.actions.retry")
                    : t("manager.actions.download")));
            progress.textContent = !installed && busy
              ? `${current.current || 0}/${current.total || 0} ${current.file || ""}${current.fileBytes ? ` · ${formatBytes(current.fileBytes)}${current.fileBytesTotal ? ` / ${formatBytes(current.fileBytesTotal)}` : ""}` : ""}`
              : !installed && failed ? current.error || t("manager.error.downloadFailed") : "";
            progress.classList.toggle("error-text", !installed && failed);
            installedMark.hidden = !installed || active;
            activeMark.hidden = !active;
            statusRow.hidden = !installed;
          }
        });
        const sourceUrl = model.repositoryUrl || model.sourceUrl || "";
        const displayName = catalogDisplayName(model);
        return h("article", {
          class: `model-card ${shouldRevealCards ? "library-card-enter" : ""}`.trim(),
          style: { "--reveal-delay": `${libraryCardRevealDelay(index)}ms` }
        },
          previewNode(model, (task) => currentPagePreviewTasks.push(task)),
          h("div", { class: "model-info" },
            h("div", { class: "model-title-row" },
              h("div", { class: "model-title", title: displayName }, displayName),
              statusRow
            ),
            h("div", { class: "model-id", title: model.id }, model.id),
            h("div", { class: "model-meta" }, t("manager.model.source", { source: model.source || t("manager.model.unknownSource") })),
            model.author ? h("div", { class: "model-meta" }, t("manager.library.author", { author: model.author })) : null,
            h("div", { class: "model-badges" },
              badge(model.versionVerified === false
                ? t("manager.library.spineUnverified", { version: catalogSpineDisplayVersion(model) })
                : `Spine ${catalogSpineDisplayVersion(model)}`),
              badge(t(`manager.library.category.${model.category || "operator"}`)),
              badge(t(`manager.library.compatibility.${model.compatibilityProfile || "companion"}`),
                model.compatibilityProfile === "companion" ? "badge-success" : "badge-warning"),
              model.license ? badge(model.license, model.license === "NOASSERTION" ? "badge-warning" : "") : null,
              model.licenseNote ? badge(t("manager.library.licenseNotice"), "badge-warning") : null
            ),
            h("div", { class: "model-actions" },
              progress,
              h("div", { style: { flex: "1" } }),
              sourceUrl ? iconAction(ExternalLink, t("manager.actions.openSource"), () => window.companion?.openExternal?.(sourceUrl)) : null,
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
      h("button", { class: "btn", type: "button", disabled: catalogPage <= 1, onClick: () => { catalogPage -= 1; revealCards = true; renderCards(query, selectedFilter); } }, t("manager.library.previousPage")),
      h("span", {}, t("manager.library.page", { page: catalogPage, pages: pageCount, count: catalogTotal })),
      h("button", { class: "btn", type: "button", disabled: catalogPage >= pageCount, onClick: () => { catalogPage += 1; revealCards = true; renderCards(query, selectedFilter); } }, t("manager.library.nextPage"))
    );
  }

  const session = {
    refreshModel(id) {
      cardControllers.get(id)?.update();
    },
    refresh({ installed = false } = {}) {
      if (installed) {
        installedIds = new Set(installedModels.map((model) => model.id));
        activeId = activeInstalledId();
      }
      if (installed && filterValue !== "all") renderCards(search.value, filterValue);
      else for (const controller of cardControllers.values()) controller.update();
      catalogCount.textContent = String(catalogTotal);
      animateLibraryCount(installedCount, installedModels.length);
      animateLibraryCount(activeCount, activeId ? 1 : 0);
    },
    async applyRemoteCatalog(nextRemoteCatalog) {
      remoteCatalog = nextRemoteCatalog || emptyRemoteCatalog();
      renderSourceStatuses();
      await renderCards(search.value, filterValue);
      animateLibraryCount(catalogCount, catalogTotal);
    }
  };

  const installedCountTarget = installedModels.length;
  const activeCountTarget = activeId ? 1 : 0;
  const catalogCount = h("strong", {}, "0");
  const installedCount = h("strong", {}, "0");
  const activeCount = h("strong", {}, "0");
  await renderCards();
  const catalogCountTarget = catalogTotal;
  const content = h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.library.title")),
        h("p", { class: "empty-text" }, t("manager.library.subtitle"))
      ),
      h("div", { class: "model-actions" },
        h("button", { class: "btn", type: "button", onClick: importLocalModel }, t("manager.actions.importLocal")),
        h("button", { class: "btn", type: "button", onClick: () => navTo("avatar") }, ...iconLabel(Sparkles, t("manager.labs.open")))
      )
    ),
    libraryTabs("catalog"),
    h("div", { class: "library-summary" },
      h("div", {}, catalogCount, h("span", {}, t("manager.library.catalogCount"))),
      h("div", {}, installedCount, h("span", {}, t("manager.library.installedCount"))),
      h("div", {}, activeCount, h("span", {}, t("manager.library.activeCount")))
    ),
    h("div", { class: "library-toolbar" }, sourceFilter, search, filter, previewCurrentPageButton),
    sourceStrip,
    h("details", { class: "catalog-source-editor" }, h("summary", {}, t("manager.library.sources")),
      h("div", { class: "catalog-source-list" }, ...(config.models?.sources || []).map((source) => h("div", { class: "catalog-source-row" },
        h("span", {}, catalogSourceLabel(source)), h("small", { title: source.catalogUrl }, source.catalogUrl),
        h("label", { class: "switch-row compact" }, h("input", { type: "checkbox", checked: source.enabled !== false, onChange: async (event) => {
          const sources = (config.models?.sources || []).map((item) => item.id === source.id ? { ...item, enabled: event.target.checked } : item);
          await window.companion?.saveSettings?.({ models: { sources } }); config.models.sources = sources; await renderView("library");
        } }), h("span", {}, t("manager.library.sourceEnabled"))),
        canRemoveCatalogSource(source) ? h("button", { class: "btn danger", type: "button", onClick: async () => {
          const sources = (config.models?.sources || []).filter((item) => item.id !== source.id);
          await window.companion?.saveSettings?.({ models: { sources } }); config.models.sources = sources; await renderView("library");
        } }, t("manager.actions.remove")) : null
      ))),
      h("div", { class: "catalog-source-add" }, sourceLabelInput, sourceUrlInput, h("button", { class: "btn", type: "button", onClick: addSource }, t("manager.library.addSource")))
    ),
    grid,
    pager
  );
  window.requestAnimationFrame(() => {
    animateLibraryCount(catalogCount, catalogCountTarget);
    animateLibraryCount(installedCount, installedCountTarget);
    animateLibraryCount(activeCount, activeCountTarget);
  });
  return { content, session, remoteCatalog, sourceId: sourceValue, hasCachedCatalog: cachedResult?.available === true };
}

async function confirmDownload(model) {
  const request = catalogDownloadRequest(model);
  const acknowledgementRequired = modelRequiresAcknowledgement(model);
  if (!await requestModelAcknowledgement([model])) return;
  const proceed = h("button", { class: "btn btn-primary", type: "button", onClick: () => {
    closeModal({ dismissed: false });
    startDownload(request.id, request.catalogEntry, acknowledgementRequired);
  } }, t("manager.actions.acceptDownload"));
  const cancel = h("button", { class: "btn", type: "button", onClick: closeModal }, t("manager.actions.cancel"));
  const profile = model.compatibilityProfile || "companion";
  const compatibilityWarning = profile === "companion"
    ? ""
    : t(`manager.library.compatibilityWarning.${profile}`);
  const body = [!acknowledgementRequired && model.licenseNote ? t("manager.modal.licensePrompt", { note: model.licenseNote }) : "", compatibilityWarning]
    .filter(Boolean)
    .join("\n\n");
  if (body) showModal(
    profile === "companion" ? t("manager.modal.licenseTitle") : t("manager.library.compatibilityWarningTitle"),
    body,
    [cancel, proceed]
  );
  else startDownload(request.id, request.catalogEntry, acknowledgementRequired);
}

async function activateModel(id, { incremental = false } = {}) {
  setStatus(t("manager.status.activating", { id }));
  try {
    await window.companion?.setActiveModel?.(id);
    await refreshConfig();
    if (incremental && activeView === "library" && libraryTab === "catalog") {
      librarySession?.refresh({ installed: true });
      setStatus(t("manager.status.active"));
    } else if (incremental && activeView === "library") {
      renderView("library");
    } else {
      renderView(activeView);
    }
  } catch (error) {
    showManagerError({
      title: t("manager.model.activationFailed"),
      error,
      retry: () => activateModel(id, { incremental }),
      fallback: t("manager.model.activationFailed")
    });
  }
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
      const isActive = model.id === active;
      return h("article", { class: "model-card installed-model-card fade-in" },
        previewNode(displayModel),
        h("div", { class: "model-info" },
          h("div", { class: "model-title-row" },
            h("div", { class: "model-title", title: displayModel.name || model.id }, displayModel.name || model.id),
            isActive ? h("div", { class: "model-statuses" }, badge(t("manager.status.active"), "badge-warning")) : null
          ),
          h("div", { class: "model-meta", title: model.dir }, model.dir),
          h("div", { class: "model-actions" },
            h("div", { style: { flex: "1" } }),
            iconAction(FolderOpen, t("manager.actions.openFolder"), () => window.companion?.openFolder?.(model.dir)),
            !isActive ? h("button", { class: "btn btn-primary model-action", type: "button", onClick: () => activateModel(model.id) }, ...iconLabel(Check, t("manager.actions.setActive"))) : null,
            !isActive ? iconAction(Trash2, t("manager.actions.remove"), () => confirmRemove(model.id), { danger: true }) : null
          )
        )
      );
    })
    : [h("p", { class: "empty-text" }, t("manager.empty.noModels"))];
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.installed.title")),
        h("p", { class: "empty-text" }, t("manager.library.subtitle"))
      ),
      h("div", { class: "model-actions" },
        h("button", { class: "btn", type: "button", onClick: () => navTo("avatar") }, ...iconLabel(Sparkles, t("manager.labs.open")))
      )
    ),
    libraryTabs("installed"),
    h("div", { class: "grid-2 installed-grid" }, content)
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
      dl.status === "failed" ? h("button", { class: "btn", type: "button", onClick: () => {
        const catalogEntry = retryCatalogEntry(dl);
        const model = modelFromCatalogEntry(catalogEntry);
        if (model) confirmDownload(model);
        else startDownload(id, null, false);
      } }, t("manager.actions.retry")) : null
    );
  }) : [h("p", { class: "empty-text" }, t("manager.empty.noDownloads"))];
  return h("section", {},
    h("div", { class: "view-header" },
      h("div", {},
        h("h2", { class: "view-title" }, t("manager.downloads.title")),
        h("p", { class: "empty-text" }, t("manager.library.subtitle"))
      ),
      h("div", { class: "model-actions" },
        h("button", { class: "btn", type: "button", onClick: () => navTo("avatar") }, ...iconLabel(Sparkles, t("manager.labs.open")))
      )
    ),
    libraryTabs("downloads"),
    h("div", { class: "grid-2" }, cards)
  );
}

function settingsView() {
  const ui = config.ui || {};
  const spine = config.spine || {};
  const numeric = (id) => Number(document.getElementById(id).value || 0);
  const saveSpine = async () => {
    const presentation = {
      scale: numeric("set-scale-number"),
      offsetX: numeric("set-offset-x-number"),
      offsetY: numeric("set-offset-y-number"),
      fitMode: document.getElementById("set-fit-mode")?.value || "legacy"
    };
    if (spine.modelId && window.companion?.saveModelPresentation) {
      await window.companion.saveModelPresentation({ modelId: spine.modelId, ...presentation });
    } else {
      await window.companion?.saveSettings?.({ spine: presentation });
    }
    config = await window.companion?.getConfig?.() || config;
    setStatus(t("manager.status.settingsSaved"));
    showToast(t("manager.status.settingsSaved"));
  };
  const resetExperience = async () => {
    await window.companion?.saveSettings?.({
      spine: { scale: 0.86, offsetX: 0, offsetY: -18, fitMode: "legacy" },
      ui: { maxDevicePixelRatio: 2, hitboxPadding: 8, gpuMode: "hardware", debugHitbox: false }
    });
    if (spine.modelId && window.companion?.saveModelPresentation) {
      await window.companion.saveModelPresentation({
        modelId: spine.modelId,
        scale: 0.86,
        offsetX: 0,
        offsetY: -18,
        fitMode: "legacy"
      });
    }
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
        field(t("manager.field.fitMode"), h("select", { class: "select", id: "set-fit-mode" },
          ["legacy", "character", "full"].map((value) => h("option", {
            value,
            selected: (spine.fitMode || "legacy") === value
          }, t(`manager.option.fitMode.${value}`)))
        )),
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
          field(t("manager.field.frameRateMode"), h("select", {
            class: "select",
            value: ui.frameRateMode || "display",
            onChange: (event) => saveUi({ frameRateMode: event.target.value })
          }, MANAGER_FRAME_RATE_MODES.map((value) => h("option", {
            value,
            selected: (ui.frameRateMode || "display") === value
          }, t(`manager.option.frameRateMode.${value}`))))),
          check(t("manager.field.debugHitbox"), ui.debugHitbox === true, (checked) => saveUi({ debugHitbox: checked }))
        )
      ),
      section(t("manager.labs.title"), t("manager.labs.body"),
        h("button", { class: "btn", type: "button", onClick: () => navTo("avatar") }, ...iconLabel(Sparkles, t("manager.labs.open")))
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
    showManagerError({
      title: t("manager.integrations.previewErrorTitle"),
      error,
      retry: () => previewIntegration(id),
      fallback: t("manager.integrations.previewErrorTitle")
    });
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
    showManagerError({
      title: t("manager.integrations.openConfigErrorTitle"),
      error,
      retry: () => openIntegrationConfig(id),
      fallback: t("manager.integrations.openConfigErrorTitle")
    });
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
    showManagerError({
      title: t("manager.integrations.instructionsErrorTitle"),
      error,
      retry: () => showAgentInstructions(id),
      fallback: t("manager.integrations.instructionsErrorTitle")
    });
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
          showManagerError({
            title: t("manager.integrations.instructionsErrorTitle"),
            error,
            retry: () => installAgentInstructions(id),
            fallback: t("manager.integrations.instructionsErrorTitle")
          });
        }
      } }, t("manager.actions.installInstructions"))
    ]);
  } catch (error) {
    showManagerError({
      title: t("manager.integrations.instructionsErrorTitle"),
      error,
      retry: () => installAgentInstructions(id),
      fallback: t("manager.integrations.instructionsErrorTitle")
    });
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
          showManagerError({
            title: t("manager.integrations.configureErrorTitle"),
            error,
            retry: () => configureIntegration(id),
            fallback: t("manager.integrations.configureErrorTitle")
          });
        }
      } }, t("manager.actions.confirmConfigure"))
    ]);
  } catch (error) {
    showManagerError({
      title: t("manager.integrations.configureErrorTitle"),
      error,
      retry: () => configureIntegration(id),
      fallback: t("manager.integrations.configureErrorTitle")
    });
  }
}

async function acknowledgeIntegrationRestart(id) {
  try {
    await window.companion?.acknowledgeAiIntegrationRestart?.(id);
    await refreshIntegrations();
    await renderView("integrations");
    showToast(t("manager.status.restartAcknowledged"));
  } catch (error) {
    showManagerError({
      title: t("manager.integrations.recoveryErrorTitle"),
      error,
      retry: () => acknowledgeIntegrationRestart(id),
      fallback: t("manager.integrations.recoveryErrorTitle")
    });
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
    showManagerError({
      title: t("manager.modal.restoreIntegrationDoneTitle", { name }),
      error: `${body}\n\n${t("manager.modal.restoreIntegrationRefreshWarning", {
        error: readableManagerError(error)
      })}`,
      retry: () => showRestoredIntegrationResult(name, result),
      fallback: t("manager.modal.restoreIntegrationRefreshWarning", { error: t("error.unknown") })
    });
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
        showManagerError({
          title: t("manager.modal.restoreIntegrationTitle", { name }),
          error,
          retry: () => restoreIntegration(id),
          fallback: t("manager.modal.restoreIntegrationRefreshWarning", { error: t("error.unknown") })
        });
        return;
      }
      await showRestoredIntegrationResult(name, result);
    } }, t("manager.actions.restoreBackup"))
  ]);
}

async function testIntegration(id, { silent = false, refresh = true } = {}) {
  try {
    const result = await window.companion?.testAiIntegration?.(id);
    if (refresh) {
      await refreshIntegrations();
      if (activeView === "integrations") await renderView("integrations");
    }
    if (!silent) {
      showModal(t("manager.integrations.testTitle"), t("manager.integrations.testOk", {
        label: result?.sourceLabel || result?.source || id,
        count: result?.toolCount || 0
      }), [
        h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
      ]);
    }
    return { ok: true, result };
  } catch (error) {
    if (refresh) {
      await refreshIntegrations().catch(() => {});
      if (activeView === "integrations") await renderView("integrations");
    }
    const item = integrations.find((integration) => integration.id === id);
    const rawError = readableManagerError(error, t("manager.integrations.testErrorTitle"));
    if (!silent) {
      showManagerError({
        title: t("manager.integrations.testErrorTitle"),
        error: `${t(integrationErrorKey(rawError))}\n\n${t("manager.integrations.technicalDetails")}: ${rawError}`,
        extraActions: item?.configPath ? [h("button", { class: "btn", type: "button", onClick: async () => {
          closeModal({ dismissed: false });
          await openIntegrationConfig(id);
        } }, t("manager.actions.openConfig"))] : [],
        retry: () => testIntegration(id),
        fallback: t("manager.integrations.testErrorTitle")
      });
    }
    return { ok: false, error: rawError, item };
  }
}

async function testAllIntegrations() {
  if (integrationTestAllInFlight) return;
  integrationTestAllInFlight = true;
  let body = "";
  try {
    await refreshIntegrations();
    const candidates = integrations.filter(integrationCanTest);
    if (!candidates.length) {
      body = t("manager.integrations.testAllEmpty");
    } else {
      setStatus(t("manager.status.testingIntegrations", { count: candidates.length }));
      const results = [];
      for (const item of candidates) {
        results.push({ item, ...(await testIntegration(item.id, { silent: true, refresh: false })) });
      }
      await refreshIntegrations();
      const failures = results.filter((result) => !result.ok);
      body = failures.length
        ? t("manager.integrations.testAllPartial", {
            passed: results.length - failures.length,
            total: results.length,
            failed: failures.map(({ item }) => item.name).join(", ")
          })
        : t("manager.integrations.testAllOk", { count: results.length });
    }
  } catch (error) {
    body = t("manager.integrations.testAllFailed", { error: error.message || String(error) });
  } finally {
    integrationTestAllInFlight = false;
    if (activeView === "integrations" || activeView === "diagnostics") {
      await renderView(activeView).catch((error) => {
        body = `${body}\n\n${t("manager.integrations.testAllFailed", { error: error.message || String(error) })}`;
      });
    }
  }
  showModal(t("manager.integrations.testAllTitle"), body, [
    h("button", { class: "btn btn-primary", type: "button", onClick: closeModal }, t("manager.actions.close"))
  ]);
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

async function restartRendererFromDiagnostics() {
  try {
    await window.companion?.restartRenderer?.({ reason: "manager-diagnostics" });
    showToast(t("manager.status.rendererRestarted"));
  } catch (error) {
    showManagerError({
      title: t("manager.diagnostics.rendererRecoveryErrorTitle"),
      error,
      retry: restartRendererFromDiagnostics,
      openDiagnostics: false,
      fallback: t("manager.diagnostics.rendererRecoveryErrorTitle")
    });
  }
}

async function clearGpuCacheFromDiagnostics() {
  try {
    const result = await window.companion?.clearGpuCache?.();
    showToast(t("manager.status.gpuCacheCleared", { count: result?.removed || 0 }));
  } catch (error) {
    showManagerError({
      title: t("manager.diagnostics.gpuCacheErrorTitle"),
      error,
      retry: clearGpuCacheFromDiagnostics,
      openDiagnostics: false,
      fallback: t("manager.diagnostics.gpuCacheErrorTitle")
    });
  }
}

async function exportDiagnosticsFromManager() {
  try {
    const result = await window.companion?.exportDiagnostics?.();
    showToast(t("manager.status.diagnosticsExported", { path: result?.file || "" }));
  } catch (error) {
    showManagerError({
      title: t("manager.diagnostics.exportErrorTitle"),
      error,
      retry: exportDiagnosticsFromManager,
      openDiagnostics: false,
      fallback: t("manager.diagnostics.exportErrorTitle")
    });
  }
}

async function copyDiagnosticsFromManager() {
  try {
    await copyText(await diagnosticsReportText());
    showToast(t("manager.status.diagnosticsCopied"));
  } catch (error) {
    showManagerError({
      title: t("manager.diagnostics.copyErrorTitle"),
      error,
      retry: copyDiagnosticsFromManager,
      openDiagnostics: false,
      fallback: t("manager.diagnostics.copyErrorTitle")
    });
  }
}

async function exportLogsFromManager() {
  try {
    const result = await window.companion?.exportLogs?.();
    showToast(t("manager.status.logsExported", { path: result?.file || "" }));
  } catch (error) {
    showManagerError({
      title: t("manager.diagnostics.logsExportErrorTitle"),
      error,
      retry: exportLogsFromManager,
      openDiagnostics: false,
      fallback: t("manager.diagnostics.logsExportErrorTitle")
    });
  }
}

async function integrationsView() {
  try {
    await refreshIntegrations();
  } catch (error) {
    showManagerError({
      title: t("manager.integrations.configureErrorTitle"),
      error,
      retry: () => renderView("integrations"),
      fallback: t("manager.integrations.configureErrorTitle")
    });
    return h("section", {},
      h("h2", { class: "view-title" }, t("manager.integrations.title")),
      h("p", { class: "error-text", role: "alert" }, readableManagerError(error, t("manager.integrations.configureErrorTitle")))
    );
  }
  const available = typeof window.companion?.listAiIntegrations === "function";
  if (!available) {
    return h("section", {},
      h("h2", { class: "view-title" }, t("manager.integrations.title")),
      h("article", { class: "card" }, h("p", { class: "empty-text" }, t("manager.integrations.runtimeUnavailable")))
    );
  }
  const realReportFor = (item) => integrationReportResult(item);
  const filtered = integrations.filter((item) => integrationMatchesFilter(
    item,
    integrationFilter,
    integrationTestResults.get(item.id),
    Boolean(realReportFor(item))
  ));
  const selected = selectFilteredIntegration(filtered, selectedIntegrationId);
  selectedIntegrationId = selected?.id || "";
  const testResult = selected ? integrationTestResults.get(selected.id) : null;
  const realReport = selected ? realReportFor(selected) : null;
  const progress = selected ? integrationCompletion(selected, testResult, Boolean(realReport)) : null;
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
      h("div", { class: "view-header-actions" },
        h("div", { class: "integration-overview" },
          h("strong", {}, integrations.filter((item) => item.configured).length),
          h("span", {}, t("manager.integrations.configuredCount", { total: integrations.length }))
        ),
        h("button", { class: "btn", type: "button", disabled: integrationTestAllInFlight, onClick: testAllIntegrations }, t("manager.actions.testAllIntegrations"))
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
          const itemReport = realReportFor(item);
          const itemProgress = integrationCompletion(item, integrationTestResults.get(item.id), Boolean(itemReport));
          return h("button", {
            class: `integration-row${item.id === selected?.id ? " active" : ""}`,
            type: "button",
            onClick: () => { selectedIntegrationId = item.id; renderView("integrations"); }
          },
            brandIcon(item, "row", itemProgress.state),
            h("span", { class: "integration-row-copy" },
              h("strong", {}, item.name),
              h("small", {}, t(integrationSummaryKey(item, integrationTestResults.get(item.id), Boolean(itemReport))))
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
              h("p", { class: "model-meta" }, t(integrationSummaryKey(selected, testResult, Boolean(realReport))))
            )
          ),
          h("span", { class: progress?.state === "ready" ? "status-value status-ok" : "status-value" }, t(integrationSummaryKey(selected, testResult, Boolean(realReport))))
        ),
        selected.configFormat !== "templateOnly" ? h("div", { class: "setup-checklist" },
          statusStep(t("manager.integrations.step.detected"), selected.installed || selected.configFound || selected.configured, selected.installed ? t("manager.integrations.installed") : t("manager.integrations.notDetected")),
          statusStep(t("manager.integrations.step.config"), selected.configured, selected.configured ? t("manager.integrations.configured") : t("manager.integrations.step.configHelp")),
          selected.instructionsPath
            ? statusStep(t("manager.integrations.step.instructions"), selected.instructionsFound, selected.instructionsFound ? t("manager.integrations.instructionsFound") : t("manager.integrations.step.instructionsHelp"))
            : null,
          statusStep(t("manager.integrations.step.test"), testResult?.ok === true, selected.needsRestart
            ? t("manager.integrations.step.restartHelp", { name: selected.name })
            : testResult?.ok
              ? t("manager.integrations.testPassedAt", { time: testResult.testedAt ? new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(testResult.testedAt)) : "" })
              : testResult?.error ? t(integrationErrorKey(testResult.error)) : t("manager.integrations.step.testHelp")),
          statusStep(t("manager.integrations.step.firstReport"), Boolean(realReport), realReport
            ? t("manager.integrations.step.firstReportAt", {
                time: realReport.reportedAt ? new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(realReport.reportedAt)) : ""
              })
            : testResult?.ok
              ? t("manager.integrations.step.firstReportHelp", { name: selected.name })
              : t("manager.integrations.step.firstReportBlocked"))
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
          selected.configFormat !== "templateOnly" && selected.configured && selected.instructionsPath && !selected.instructionsFound
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
        diagnostics.cache ? row(
          t("manager.diagnostics.modelCache"),
          true,
          t("manager.diagnostics.cacheSummary", {
            files: diagnostics.cache.models?.files || 0,
            size: formatBytes(diagnostics.cache.models?.bytes || 0)
          })
        ) : null,
        diagnostics.cache ? row(
          t("manager.diagnostics.previewCache"),
          true,
          t("manager.diagnostics.cacheSummary", {
            files: diagnostics.cache.previews?.files || 0,
            size: formatBytes(diagnostics.cache.previews?.bytes || 0)
          })
        ) : null,
        diagnostics.gpu ? row(t("manager.diagnostics.gpu"), true, localizedDiagnosticMessage(diagnostics.gpu.message) || diagnostics.gpu.mode) : null,
        diagnostics.gpu?.renderer ? row(t("manager.diagnostics.renderer"), rendererHealthCategory(diagnostics.gpu.renderer.status) === "healthy", t("manager.diagnostics.rendererSummary", { status: localizedRendererState(diagnostics.gpu.renderer.status), count: diagnostics.gpu.renderer.recoveryCount || 0 })) : null,
        diagnostics.gpu?.renderer?.animationName ? h("p", { class: "model-meta" }, `${diagnostics.gpu.renderer.animationName} · ${Number(diagnostics.gpu.renderer.trackTime || 0).toFixed(1)}s`) : null,
        diagnostics.gpu?.webviewCacheDir ? h("p", { class: "model-meta", title: diagnostics.gpu.webviewCacheDir }, diagnostics.gpu.webviewCacheDir) : null,
        diagnostics.gpu?.tdrNote ? h("p", { class: "model-meta" }, localizedDiagnosticMessage(diagnostics.gpu.tdrNote)) : null,
        row(t("manager.diagnostics.runtime"), true, runtimeName()),
        h("div", { class: "model-actions" },
          h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(config.paths?.configDir) }, t("manager.actions.openConfigFolder")),
          diagnostics.cache?.modelsDir ? h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(diagnostics.cache.modelsDir) }, t("manager.actions.openModelCache")) : null,
          diagnostics.cache?.previewsDir ? h("button", { class: "btn", type: "button", onClick: () => window.companion?.openFolder?.(diagnostics.cache.previewsDir) }, t("manager.actions.openPreviewCache")) : null,
          h("button", { class: "btn", type: "button", onClick: restartRendererFromDiagnostics }, t("manager.actions.restartRenderer")),
          h("button", { class: "btn", type: "button", onClick: clearGpuCacheFromDiagnostics }, t("manager.actions.clearGpuCache")),
          h("button", { class: "btn", type: "button", onClick: copyDiagnosticsFromManager }, t("manager.actions.copyDiagnostics")),
          h("button", { class: "btn", type: "button", onClick: exportDiagnosticsFromManager }, t("manager.actions.exportDiagnostics")),
          h("button", { class: "btn", type: "button", onClick: exportLogsFromManager }, t("manager.actions.exportLogs")),
          h("button", { class: "btn", type: "button", disabled: integrationTestAllInFlight, onClick: testAllIntegrations }, t("manager.actions.testAllIntegrations"))
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
      ),
      h("div", { class: "model-actions" },
        h("button", { class: "btn", type: "button", onClick: () => navTo("settings") }, t("manager.labs.back"))
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
            h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.("https://github.com/cb8010d6/spine-companion/blob/main/docs/guides/avatar-studio.md") }, "English"),
            h("button", { class: "btn", type: "button", onClick: () => window.companion?.openExternal?.("https://github.com/cb8010d6/spine-companion/blob/main/docs/guides/avatar-studio.zh-CN.md") }, "中文")
          )
        )
      ),
      editorHost
    )
  );
}

async function renderView(viewName) {
  const resolved = resolveManagerNavigation(viewName);
  if (resolved.libraryTab) libraryTab = resolved.libraryTab;
  viewName = resolved.view;
  activeView = viewName;
  for (const button of navButtons) button.classList.toggle("active", button.dataset.view === activeView);
  if (topbarTitle) topbarTitle.textContent = t(`manager.nav.${activeView}`);
  const navigation = navigationGuard.begin(viewName);
  librarySession = null;
  if (viewName === "dashboard") {
    setStatus(t("manager.status.viewing", { view: t("manager.nav.dashboard") }));
    await renderDashboard();
    return;
  }
  if (viewName === "library" && libraryTab === "catalog") render(libraryLoadingView(), viewContainer);
  else if (viewName !== "library") viewContainer.replaceChildren(h("p", { class: "empty-text" }, t("manager.status.loading")));
  setStatus(t("manager.status.viewing", { view: t(`manager.nav.${viewName}`) }));
  if (viewName === "library") {
    if (libraryTab !== "catalog") {
      render(libraryTab === "installed" ? installedView() : downloadsView(), viewContainer);
      return;
    }
    const cachedResult = await libraryView({ cachedOnly: true });
    if (!navigationGuard.isCurrent(navigation, activeView)) return;
    librarySession = cachedResult.session;
    render(cachedResult.content, viewContainer);
    const result = await refreshRemoteCatalog(
      cachedResult.sourceId,
      enabledCatalogSources(config.models?.sources || [])
    );
    if (!navigationGuard.isCurrent(navigation, activeView)) return;
    if (cachedResult.sourceId) cacheRemoteCatalog(cachedResult.sourceId, config.models?.sources || [], result);
    await librarySession?.applyRemoteCatalog(result);
    const selectedSources = catalogSourcesForSelection(cachedResult.sourceId, enabledCatalogSources(config.models?.sources || []));
    const failedSources = (result?.sources || []).filter((status) => status.state === "failed");
    const allSelectedSourcesFailed = selectedSources.length > 0
      && selectedSources.every((source) => failedSources.some((status) => status.sourceId === source.id));
    if (!cachedResult.hasCachedCatalog && allSelectedSourcesFailed && !(result?.models || []).length) {
      showManagerError({
        title: t("manager.library.catalogLoadFailed"),
        error: failedSources.map((status) => status.error).filter(Boolean).join("\n") || t("manager.library.catalogLoadFailed"),
        retry: () => renderView("library"),
        fallback: t("manager.library.catalogLoadFailed")
      });
    }
  }
  else if (viewName === "installed") render(installedView(), viewContainer);
  else if (viewName === "downloads") render(downloadsView(), viewContainer);
  else if (viewName === "settings") {
    await refreshReminders();
    if (!navigationGuard.isCurrent(navigation, activeView)) return;
    render(settingsView(), viewContainer);
  }
  else if (viewName === "integrations") {
    const content = await integrationsView();
    if (!navigationGuard.isCurrent(navigation, activeView)) return;
    render(content, viewContainer);
  }
  else if (viewName === "avatar") {
    const content = await avatarStudioView();
    if (!navigationGuard.isCurrent(navigation, activeView)) return;
    render(content, viewContainer);
  }
  else if (viewName === "diagnostics") {
    const content = await diagnosticsView();
    if (!navigationGuard.isCurrent(navigation, activeView)) return;
    render(content, viewContainer);
  }
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
    if (activeView === "library" && libraryTab === "catalog") librarySession?.refreshModel(p.id);
    else if (activeView === "library" && libraryTab === "downloads") renderView("library");
  });
  window.companion?.onConfigChanged?.(async (nextConfig) => {
    config = nextConfig || await window.companion?.getConfig?.() || config;
    applyUiLocale();
    if (activeView === "library") {
      await refreshConfig();
      if (libraryTab === "catalog") librarySession?.refresh({ installed: true });
      else renderView("library");
    } else if (activeView === "settings" || activeView === "installed" || activeView === "dashboard") {
      renderView(activeView);
    }
  });
  window.companion?.onReminders?.((nextReminders) => {
    reminders = Array.isArray(nextReminders) ? nextReminders : [];
    if (activeView === "settings") renderView("settings");
    else if (activeView === "dashboard") dashboardRefresh.schedule();
  });
  window.companion?.onState?.((nextState) => {
    liveState = nextState || null;
    if (activeView === "dashboard") dashboardRefresh.schedule();
    else if (activeView === "integrations"
      && !isIntegrationSelfTest(nextState)
      && integrations.some((item) => integrationMatchesSource(item, nextState?.source))) {
      renderView("integrations");
    }
  });
  navTo(managerInitialView(config));
}

if (document.getElementById("manager-app")) {
  boot().catch((error) => {
    setStatus(error.message);
    render(h("section", { class: "card form-card", role: "alert" }, h("strong", {}, "Manager failed"), h("p", {}, error.message)), viewContainer);
  });
}
