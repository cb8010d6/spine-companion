import { t } from "../shared/i18n.js";

export function bindManagerButton(button, statusNode, onManager, labels = {}) {
  if (!button) return button;
  const idle = labels.idle || button.textContent || t("error.openManager");
  const pending = labels.pending || t("error.openingManager");
  const errorText = labels.error || t("error.openManagerFailed");
  button.textContent = idle;
  button.addEventListener("click", async () => {
    if (!onManager) return;
    button.disabled = true;
    button.textContent = pending;
    if (statusNode) statusNode.textContent = "";
    try {
      await onManager();
      button.textContent = idle;
    } catch (error) {
      button.textContent = errorText;
      if (statusNode) {
        statusNode.textContent = error?.message || String(error || errorText);
      }
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
