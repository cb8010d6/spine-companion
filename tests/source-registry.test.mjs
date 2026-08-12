import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const {
  isAiSource,
  sourceDisplayName,
  sourceFromClientInfo
} = require("../src/shared/source-registry.cjs");

const esmRegistry = await import("../src/shared/source-registry.js");

describe("source registry", () => {
  it("recognizes known AI tools and future MCP agents", () => {
    expect(isAiSource("mimocode-mcp")).toBe(true);
    expect(isAiSource("opencode-mcp")).toBe(true);
    expect(isAiSource("kimi-mcp")).toBe(true);
    expect(isAiSource("vscode-mcp")).toBe(true);
    expect(isAiSource("my-new-agent-mcp")).toBe(true);
    expect(isAiSource("tray")).toBe(false);
  });

  it("returns human-readable labels", () => {
    expect(sourceDisplayName("mimocode-mcp")).toBe("MiMoCode");
    expect(sourceDisplayName("opencode-mcp")).toBe("OpenCode");
    expect(sourceDisplayName("kimi-mcp")).toBe("Kimi");
    expect(sourceDisplayName("my-new-agent-mcp")).toBe("My New Agent");
    expect(sourceDisplayName("anything", "Custom Label")).toBe("Custom Label");
  });

  it("derives source from MCP clientInfo", () => {
    expect(sourceFromClientInfo({ name: "OpenCode" })).toBe("opencode-mcp");
    expect(sourceFromClientInfo({ name: "Kimi Code CLI" })).toBe("kimi-mcp");
    expect(sourceFromClientInfo({ name: "My New Agent" })).toBe("my-new-agent-mcp");
  });

  it("keeps ESM wrapper aligned", () => {
    expect(esmRegistry.sourceDisplayName("mimocode-mcp")).toBe(sourceDisplayName("mimocode-mcp"));
  });

  it("keeps browser ESM entry points free of CommonJS imports", async () => {
    const files = await Promise.all([
      readFile(new URL("../src/shared/source-registry.js", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/notification-policy.js", import.meta.url), "utf8")
    ]);
    expect(files.every((source) => !source.includes(".cjs"))).toBe(true);
  });
});
