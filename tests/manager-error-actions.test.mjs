import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { actionableManagerErrorBody, readableManagerError } from "../src/renderer/manager-error.js";
import { createI18n, t } from "../src/shared/i18n.js";

const managerSource = readFileSync(resolve(process.cwd(), "src/renderer/manager.js"), "utf8");
const managerStyles = readFileSync(resolve(process.cwd(), "src/renderer/manager.css"), "utf8");

describe("Manager actionable error recovery", () => {
  it("keeps readable technical messages while adding a next step", () => {
    expect(readableManagerError(new Error("MCP timed out"))).toBe("MCP timed out");
    expect(readableManagerError({ message: "catalog offline" })).toBe("catalog offline");
    expect(readableManagerError(" Imported, but activation failed. ")).toBe("Imported, but activation failed.");
    expect(actionableManagerErrorBody(new Error("catalog offline"), "Retry or open diagnostics.")).toBe("Retry or open diagnostics.\n\ncatalog offline");
  });

  it("uses bilingual actionable copy", () => {
    createI18n({ ui: { locale: "en" } }, { language: "en-US" });
    expect(t("manager.error.nextStep")).toContain("Open Diagnostics");
    expect(t("manager.error.nextStep.retryOnly")).not.toContain("Open Diagnostics");
    expect(t("manager.actions.openDiagnostics")).toBe("Open Diagnostics");
    createI18n({ ui: { locale: "zh-CN" } }, { language: "en-US" });
    expect(t("manager.error.nextStep")).toContain("打开诊断");
    expect(t("manager.error.nextStep.retryOnly")).not.toContain("打开诊断");
    expect(t("manager.actions.openDiagnostics")).toBe("打开诊断");
  });

  it("centralizes the operation modal and keeps recovery actions bounded", () => {
    expect(managerSource).toContain("function showManagerError");
    expect(managerSource).toContain("manager.actions.openDiagnostics");
    expect(managerSource).toContain("retry: () => renderView(\"library\")");
    expect(managerSource).toContain("retry: () => activateModel(id, { incremental })");
    expect(managerSource).toContain("!cachedResult.hasCachedCatalog && allSelectedSourcesFailed");
    expect(managerSource).toContain("exportDiagnosticsFromManager");
    expect(managerSource).toContain("copyDiagnosticsFromManager");
    expect(managerSource).toContain("exportLogsFromManager");
    expect(managerSource).toContain("openDiagnostics: false");
    expect(managerSource).not.toContain("Fix all");
  });

  it("keeps long technical details inside a compact 800x600-safe modal", () => {
    expect(managerStyles).toMatch(/\.modal\s*\{[\s\S]*?max-height:\s*calc\(100vh - 32px\)/);
    expect(managerStyles).toMatch(/\.modal-body\s*\{[\s\S]*?max-height:\s*min\(50vh, 360px\)/);
    expect(managerStyles).toMatch(/\.modal-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });
});
