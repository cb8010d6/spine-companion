import { h } from "./lib/dom.js";
import { bindManagerButton } from "./manager-action.js";
import { t } from "../shared/i18n.js";

export function shouldShowOnboarding(config = {}) {
  return !config.paths?.hasLocalConfig || !config.spine?.assetDirConfigured;
}

export function createOnboarding({ onManager }) {
  const managerStatus = h("span", { class: "error-action-status", role: "status" });
  const libraryButton = bindManagerButton(
    h("button", { type: "button", class: "btn btn-primary" }, t("onboarding.start")),
    managerStatus,
    onManager
  );
  const importButton = bindManagerButton(
    h("button", { type: "button", class: "btn" }, t("onboarding.importOwn")),
    managerStatus,
    onManager
  );
  return h("section", { class: "onboarding-card", role: "dialog", "aria-modal": "false", "aria-labelledby": "onboarding-title" },
    h("div", { class: "onboarding-mark" }, "SC"),
    h("strong", { id: "onboarding-title" }, t("onboarding.title")),
    h("span", {}, t("onboarding.body")),
    h("div", { class: "onboarding-actions" },
      libraryButton,
      importButton
    ),
    managerStatus
  );
}
