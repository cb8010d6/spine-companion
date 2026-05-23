export function bindManagerButton(button, statusNode, onManager, labels = {}) {
  if (!button) return button;
  const idle = labels.idle || button.textContent || "Open Manager";
  const pending = labels.pending || "Opening Manager...";
  const errorText = labels.error || "Unable to open Manager";
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
