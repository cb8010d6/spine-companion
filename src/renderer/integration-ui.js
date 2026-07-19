export const INTEGRATION_FILTERS = ["all", "detected", "configured", "attention"];

export function integrationTestResult(item, override = null) {
  if (override) return override;
  if (typeof item?.lastTestOk !== "boolean") return null;
  return {
    ok: item.lastTestOk,
    testedAt: item.lastTestedAt || 0,
    error: item.lastTestError || ""
  };
}

export function integrationCompletion(item, testResult = null) {
  if (item?.configFormat === "templateOnly") return { completed: 0, total: 0, state: "custom" };
  const detected = item?.installed || item?.configFound || item?.configured;
  const configured = item?.configured === true;
  const hasManagedInstructions = item?.instructionsPath !== "";
  const instructed = !hasManagedInstructions || item?.instructionsFound === true;
  const tested = item?.needsRestart !== true && integrationTestResult(item, testResult)?.ok === true;
  const steps = hasManagedInstructions
    ? [detected, configured, instructed, tested]
    : [detected, configured, tested];
  const completed = steps.filter(Boolean).length;
  return {
    completed,
    total: steps.length,
    state: completed === steps.length ? "ready" : detected ? "setup" : "undetected"
  };
}

export function integrationMatchesFilter(item, filter, testResult = null) {
  if (filter === "detected") return item?.installed || item?.configFound || item?.configured;
  if (filter === "configured") return item?.configured === true;
  if (filter === "attention") {
    if (item?.needsRestart) return true;
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
  if (item.instructionsPath !== "" && !item.instructionsFound) return "instructions";
  if (item.needsRestart) return "restart";
  return integrationTestResult(item, testResult)?.ok ? "retest" : "test";
}

export function integrationErrorKey(error) {
  const message = String(error || "").toLowerCase();
  if (message.includes("timed out") || message.includes("timeout")) return "manager.integrations.error.timeout";
  if (message.includes("failed to start") || message.includes("could not start")) return "manager.integrations.error.start";
  if (message.includes("did not expose") || message.includes("no tools")) return "manager.integrations.error.noTools";
  if (message.includes("could not send") || message.includes("work update")) return "manager.integrations.error.report";
  return "manager.integrations.error.generic";
}

export function integrationSummaryKey(item, testResult = null) {
  if (item?.needsRestart) return "manager.integrations.summaryRestart";
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
