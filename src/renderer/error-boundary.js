import { h } from "./lib/dom.js";
import { bindManagerButton } from "./manager-action.js";
import { t } from "../shared/i18n.js";

export function friendlyError(error, config = {}) {
  const message = error?.message || String(error || t("error.unknown"));
  if (message.includes("XMLHttpRequest") || message.includes("status: 0")) {
    return t("error.assetLoad");
  }
  if (!config.spine?.assetDirConfigured) {
    return t("error.noModel");
  }
  return message;
}

export function createErrorCard({ title = t("error.title"), error, config, onRetry, onManager }) {
  const managerStatus = h("span", { class: "error-action-status", role: "status" });
  const managerButton = bindManagerButton(
    h("button", { type: "button", class: "btn" }, t("error.openManager")),
    managerStatus,
    onManager
  );
  return h("section", { class: "error-card", role: "alert" },
    h("strong", {}, title),
    h("span", {}, friendlyError(error, config)),
    h("div", { class: "error-actions" },
      h("button", { type: "button", class: "btn btn-primary", onClick: onRetry }, t("error.retry")),
      managerButton
    ),
    managerStatus
  );
}
