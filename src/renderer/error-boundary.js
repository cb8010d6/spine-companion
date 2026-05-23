import { h } from "./lib/dom.js";

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
  const managerButton = h("button", {
    type: "button",
    class: "btn",
    onClick: async () => {
      if (!onManager) return;
      managerButton.disabled = true;
      managerButton.textContent = "Opening Manager...";
      managerStatus.textContent = "";
      try {
        await onManager();
        managerButton.textContent = "Open Manager";
      } catch (nextError) {
        managerButton.textContent = "Unable to open Manager";
        managerStatus.textContent = nextError?.message || String(nextError || "Unable to open Manager.");
      } finally {
        managerButton.disabled = false;
      }
    }
  }, "Open Manager");
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
