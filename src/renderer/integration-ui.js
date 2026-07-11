export const INTEGRATION_FILTERS = ["all", "detected", "configured", "attention"];

export function integrationCompletion(item, testResult = null) {
  if (item?.configFormat === "templateOnly") return { completed: 0, total: 0, state: "custom" };
  const detected = item?.installed || item?.configFound || item?.configured;
  const configured = item?.configured === true;
  const instructed = item?.instructionsFound === true;
  const tested = testResult?.ok === true;
  const completed = [detected, configured, instructed, tested].filter(Boolean).length;
  return {
    completed,
    total: 4,
    state: completed === 4 ? "ready" : detected ? "setup" : "undetected"
  };
}

export function integrationMatchesFilter(item, filter, testResult = null) {
  if (filter === "detected") return item?.installed || item?.configFound || item?.configured;
  if (filter === "configured") return item?.configured === true;
  if (filter === "attention") {
    const progress = integrationCompletion(item, testResult);
    return progress.state !== "custom" && progress.state !== "ready";
  }
  return true;
}

export function integrationPrimaryAction(item, testResult = null) {
  if (item?.configFormat === "templateOnly") return "custom";
  const detected = item?.installed || item?.configFound || item?.configured;
  if (!detected) return "manual";
  if (!item.configured) return "configure";
  if (!item.instructionsFound) return "instructions";
  return testResult?.ok ? "retest" : "test";
}

export function integrationSummaryKey(item, testResult = null) {
  const progress = integrationCompletion(item, testResult);
  if (progress.state === "custom") return "manager.integrations.summaryCustom";
  if (progress.state === "ready") return "manager.integrations.summaryReady";
  if (progress.state === "undetected") return "manager.integrations.summaryUndetected";
  return "manager.integrations.summarySetup";
}

export function selectFilteredIntegration(items, selectedId) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.find((item) => item.id === selectedId) || items[0];
}
