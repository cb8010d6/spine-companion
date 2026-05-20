import { describe, expect, it } from "vitest";

const {
  detectMcpReferences,
  mcpConfigCandidates
} = require("../src/shared/diagnostics-paths.cjs");

describe("diagnostics-paths", () => {
  it("includes cross-platform MCP config candidates", () => {
    expect(mcpConfigCandidates("/Users/me", "darwin").map((item) => item.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Library"),
        expect.stringContaining(".codex")
      ])
    );
    expect(mcpConfigCandidates("/home/me", "linux", { XDG_CONFIG_HOME: "/tmp/config" }).map((item) => item.path.replace(/\\/g, "/"))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/tmp/config"),
        expect.stringContaining(".codex")
      ])
    );
  });

  it("detects both spine-companion and spine_companion references", () => {
    const candidates = [
      { tool: "Codex", path: "codex.toml" },
      { tool: "Claude", path: "claude.json" }
    ];
    const result = detectMcpReferences((file) => {
      if (file === "codex.toml") return "";
      if (file === "claude.json") return '{ "mcpServers": { "spine_companion": {} } }';
      return "";
    }, candidates);
    expect(result.configured).toBe(true);
    expect(result.matches).toEqual([
      { tool: "Claude", path: "claude.json", exists: true, configured: true }
    ]);
  });
});
