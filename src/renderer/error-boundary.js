import { h } from "./lib/dom.js";
import { bindManagerButton } from "./manager-action.js";

export function friendlyError(error, config = {}) {
  const message = error?.message || String(error || "Unknown error");
  if (message.includes("XMLHttpRequest") || message.includes("status: 0")) {
    return "Unable to load the Spine asset. Check that the local API is running and the model files exist.";
  }
  if (!config.spine?.assetDirConfigured) {
    return "No model is configured yet. Open Manager and download or activate a model.";
  }
  return message;
}

export function createErrorCard({ title = "Something went wrong", error, config, onRetry, onManager }) {
  const managerStatus = h("span", { class: "error-action-status", role: "status" });
  const managerButton = bindManagerButton(
    h("button", { type: "button", class: "btn" }, "Open Manager"),
    managerStatus,
    onManager
  );
  return h("section", { class: "error-card", role: "alert" },
    h("strong", {}, title),
    h("span", {}, friendlyError(error, config)),
    h("div", { class: "error-actions" },
      h("button", { type: "button", class: "btn btn-primary", onClick: onRetry }, "Retry"),
      managerButton
    ),
    managerStatus
  );
}
