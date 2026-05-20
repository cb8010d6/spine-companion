import { h } from "./lib/dom.js";

export function shouldShowOnboarding(config = {}) {
  return !config.paths?.hasLocalConfig || !config.spine?.assetDirConfigured;
}

export function createOnboarding({ onManager, onDownload }) {
  return h("section", { class: "onboarding-card", role: "dialog", "aria-modal": "false", "aria-labelledby": "onboarding-title" },
    h("div", { class: "onboarding-mark" }, "SC"),
    h("strong", { id: "onboarding-title" }, "Set up Spine Companion"),
    h("span", {}, "Download the test model or activate a local Spine 3.8 model from Manager."),
    h("div", { class: "onboarding-actions" },
      h("button", { type: "button", class: "btn btn-primary", onClick: onDownload }, "Download test model"),
      h("button", { type: "button", class: "btn", onClick: onManager }, "Open Manager")
    )
  );
}
