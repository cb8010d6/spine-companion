import { knownSource, normalizeSource } from "../shared/source-registry.js";

export const INTEGRATION_FILTERS = ["all", "detected", "configured", "attention"];
export const INTEGRATION_REPORT_STALE_AFTER_MS = 5 * 60 * 1000;

export function integrationTestResult(item, override = null) {
  if (override) return override;
  if (typeof item?.lastTestOk !== "boolean") return null;
  return {
    ok: item.lastTestOk,
    testedAt: item.lastTestedAt || 0,
    error: item.lastTestError || ""
  };
}

export function isIntegrationSelfTest(state = {}) {
  const eventKind = String(state?.eventKind || "").trim().toLowerCase();
  return eventKind === "demo"
    || eventKind === "self-test"
    || String(state?.message || "").startsWith("[Spine Companion self-test]");
}

export function integrationReportResult(item) {
  const reportedAt = Number(item?.lastReportedAt || 0);
  return reportedAt > 0 ? { reportedAt } : null;
}

export function integrationReportFromState(state = {}) {
  const report = state?.lastReport;
  if (!report || typeof report !== "object" || isIntegrationSelfTest(report)) return null;
  if (!String(report.source || "").trim() || !String(report.updatedAt || "").trim()) return null;
  return report;
}

export function integrationReportIsStale(item, now = Date.now(), staleAfterMs = INTEGRATION_REPORT_STALE_AFTER_MS) {
  const raw = item?.lastReportedAt;
  const reportedAt = typeof raw === "number" ? raw : Number(raw || 0) || Date.parse(String(raw || ""));
  const threshold = Number(staleAfterMs);
  return Boolean(reportedAt > 0 && Number.isFinite(Number(now)) && Number.isFinite(threshold) && threshold > 0
    && Number(now) - reportedAt > threshold);
}

export function integrationReportState(item = {}, testResult = null, reportReceived = false, now = Date.now()) {
  if (item.configFormat === "templateOnly") return "custom";
  if (item.needsRestart) return "restart";
  if (!item.configured) return "notConfigured";
  if (reportReceived) return integrationReportIsStale(item, now) ? "stale" : "realReport";
  if (integrationTestResult(item, testResult)?.ok === true) return "selfTestOnly";
  return "notTested";
}

export function bridgeReportState(diag = {}, integrations = [], now = Date.now(), state = null) {
  if (!diag.apiOk) return "offline";
  const configured = (Array.isArray(integrations) ? integrations : []).filter((item) => item?.configured === true);
  const report = integrationReportFromState(state);
  const reportedAt = Math.max(
    Date.parse(report?.updatedAt || "") || 0,
    ...configured.map((item) => integrationReportResult(item)?.reportedAt || 0)
  );
  if (reportedAt > 0) return integrationReportIsStale({ lastReportedAt: reportedAt }, now) ? "stale" : "report";
  if (configured.some((item) => item.needsRestart !== true && integrationTestResult(item)?.ok === true)) return "selfTestOnly";
  return "setup";
}

export function integrationMatchesSource(item, source) {
  const itemSource = normalizeSource(item?.source);
  const incomingSource = normalizeSource(source);
  if (!itemSource || !incomingSource) return false;
  if (itemSource === incomingSource) return true;
  const incomingId = knownSource(incomingSource)?.id;
  const itemId = knownSource(itemSource)?.id;
  if (!incomingId) return false;
  const grouped = {
    "roo-cline": ["roo", "cline"],
    "gemini-antigravity": ["gemini", "antigravity"],
    "claude-desktop": ["claude"],
    "kimi-code": ["kimi"]
  };
  return grouped[item?.id]?.includes(incomingId) || (itemId && itemId === incomingId);
}

export function integrationCompletion(item, testResult = null, reportReceived = false) {
  if (item?.configFormat === "templateOnly") return { completed: 0, total: 0, state: "custom" };
  const detected = item?.installed || item?.configFound || item?.configured;
  const configured = item?.configured === true;
  const hasManagedInstructions = item?.instructionsPath !== "";
  const instructed = !hasManagedInstructions || item?.instructionsFound === true;
  const tested = item?.needsRestart !== true && integrationTestResult(item, testResult)?.ok === true;
  const steps = hasManagedInstructions
    ? [detected, configured, instructed, tested, reportReceived]
    : [detected, configured, tested, reportReceived];
  const completed = steps.filter(Boolean).length;
  return {
    completed,
    total: steps.length,
    state: completed === steps.length
      ? "ready"
      : tested && !reportReceived
        ? "awaitingReport"
        : detected
          ? "setup"
          : "undetected"
  };
}

export function integrationMatchesFilter(item, filter, testResult = null, reportReceived = false, now = Date.now()) {
  if (filter === "detected") return item?.installed || item?.configFound || item?.configured;
  if (filter === "configured") return item?.configured === true;
  if (filter === "attention") {
    if (item?.needsRestart) return true;
    if (integrationReportState(item, testResult, reportReceived, now) === "stale") return true;
    const progress = integrationCompletion(item, testResult, reportReceived);
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

export function integrationSummaryKey(item, testResult = null, reportReceived = false) {
  if (item?.needsRestart) return "manager.integrations.summaryRestart";
  const progress = integrationCompletion(item, testResult, reportReceived);
  if (progress.state === "custom") return "manager.integrations.summaryCustom";
  if (progress.state === "ready") return "manager.integrations.summaryReady";
  if (progress.state === "awaitingReport") return "manager.integrations.summaryAwaitingReport";
  if (progress.state === "undetected") return "manager.integrations.summaryUndetected";
  return "manager.integrations.summarySetup";
}

export function integrationCanTest(item) {
  if (!item || item.configFormat === "templateOnly" || item.needsRestart || !item.configured) return false;
  return true;
}

export function selectFilteredIntegration(items, selectedId) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.find((item) => item.id === selectedId) || items[0];
}
