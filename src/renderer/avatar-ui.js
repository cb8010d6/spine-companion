export function avatarActionKey(validation) {
  return validation?.runtimeReady === true
    ? "manager.avatar.installUse"
    : "manager.avatar.saveDraft";
}

export function avatarStatusKey(validation) {
  if (validation?.ok !== true) return "manager.avatar.invalid";
  return validation.runtimeReady === true
    ? "manager.avatar.ready"
    : "manager.avatar.draft";
}

export function avatarResultToastKey(result) {
  if (result?.activated) return "manager.avatar.activated";
  if (result?.installed) return "manager.avatar.installed";
  if (result?.imported) return "manager.avatar.savedDraft";
  return "manager.avatar.invalid";
}
