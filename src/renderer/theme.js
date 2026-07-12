let mediaQuery = null;
let currentPreference = "system";
let mediaListenerInstalled = false;

export function resolveThemePreference(preference, prefersDark) {
  if (preference === "light" || preference === "dark") return preference;
  return prefersDark ? "dark" : "light";
}

function resolvedTheme(preference) {
  return resolveThemePreference(preference, Boolean(mediaQuery?.matches));
}

function writeTheme(preference) {
  const resolved = resolvedTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.body.dataset.themePreference = preference;
  document.body.dataset.theme = resolved;
  return resolved;
}

export function applyThemePreference(preference = "system") {
  currentPreference = ["system", "light", "dark"].includes(preference) ? preference : "system";
  mediaQuery ||= window.matchMedia("(prefers-color-scheme: dark)");
  if (!mediaListenerInstalled) {
    mediaListenerInstalled = true;
    mediaQuery.addEventListener("change", () => {
      if (currentPreference === "system") writeTheme(currentPreference);
    });
  }
  return writeTheme(currentPreference);
}
