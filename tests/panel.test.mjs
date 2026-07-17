// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { integrationConfigured } from "../src/renderer/panel.js";

describe("quick panel integration lights", () => {
  const integrations = [
    { id: "codex", name: "Renamed Codex", configured: true },
    { id: "claude-desktop", name: "Claude Desktop", configured: true },
    { id: "cursor", name: "Cursor", configured: false },
    { id: "roo-code", name: "Cursor", configured: true }
  ];

  it("uses stable integration ids instead of display names", () => {
    expect(integrationConfigured(integrations, "codex")).toBe(true);
    expect(integrationConfigured(integrations, "claude-desktop")).toBe(true);
    expect(integrationConfigured(integrations, "cursor")).toBe(false);
  });
});
