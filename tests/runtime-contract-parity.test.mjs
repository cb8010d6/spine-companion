import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import runtimeContract from "../src/shared/runtime-contract.json" with { type: "json" };

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function sourceMcpTools(source) {
  return [...source.matchAll(/server\.registerTool\("(companion_[a-z_]+)"/gu)]
    .map((match) => match[1]);
}

function pluginMcpTools(source) {
  return sourceMcpTools(source);
}

function packagedMcpTools(source) {
  return [...source.matchAll(/"name":\s*"(companion_[a-z_]+)"/gu)]
    .map((match) => match[1]);
}

function expectJavascriptRoute(source, method, path) {
  const prefix = path.endsWith(":id") ? path.slice(0, -3) : null;
  const pathCheck = prefix
    ? `url\\.pathname\\.startsWith\\("${escapeRegex(prefix)}"\\)`
    : `url\\.pathname === "${escapeRegex(path)}"`;
  expect(source).toMatch(new RegExp(`req\\.method === "${method}" && ${pathCheck}`, "u"));
}

function expectRustRoute(source, method, path) {
  const route = source.match(new RegExp(`\\.route\\("${escapeRegex(path)}",\\s*([^\\n]+)`, "u"));
  expect(route, `${method} ${path} is missing from the packaged API`).not.toBeNull();
  expect(route[1]).toMatch(new RegExp(`\\b${method.toLowerCase()}\\(`, "u"));
}

describe("runtime contract parity", () => {
  it("keeps the common MCP tools aligned and lists packaged extensions explicitly", () => {
    const sourceTools = sourceMcpTools(read("scripts/mcp-companion-server.mjs")).sort();
    const pluginTools = pluginMcpTools(read("plugins/spine-companion-status/scripts/mcp-companion-server.mjs")).sort();
    const packagedTools = packagedMcpTools(read("src-tauri/src/mcp.rs")).sort();
    const core = [...runtimeContract.mcp.core].sort();
    const completePackaged = [
      ...runtimeContract.mcp.core,
      ...runtimeContract.mcp.packagedExtensions
    ].sort();

    expect(sourceTools).toEqual(core);
    expect(pluginTools).toEqual(core);
    expect(packagedTools).toEqual(completePackaged);
  });

  it("uses the raw tool value as structuredContent in every MCP runtime", () => {
    const source = read("scripts/mcp-companion-server.mjs");
    const plugin = read("plugins/spine-companion-status/scripts/mcp-companion-server.mjs");
    const packaged = read("src-tauri/src/mcp.rs");

    for (const implementation of [source, plugin]) {
      expect(implementation).toContain("structuredContent: typeof value === \"object\" ? value : undefined");
      expect(implementation).not.toContain("structuredContent: { value");
    }
    expect(packaged).toContain('"structuredContent": value');
    expect(packaged).not.toMatch(/"structuredContent"\s*:\s*\{\s*"value"\s*:\s*value/u);
  });

  it("exposes avatar job persistence as a planning-only contract", () => {
    expect(runtimeContract.mcp.packagedExtensions).toEqual(expect.arrayContaining([
      "companion_create_avatar_job",
      "companion_update_avatar_job",
      "companion_list_avatar_jobs",
      "companion_get_avatar_job"
    ]));
    const packaged = read("src-tauri/src/mcp.rs");
    expect(packaged).toContain('"name": "companion_list_avatar_jobs"');
    expect(packaged).toContain('"name": "companion_get_avatar_job"');
    expect(packaged).toContain("planning/progress");
    expect(packaged).toContain("does not resume execution");
  });

  it("keeps the shared HTTP routes in both implementations", () => {
    const javascript = read("src/backend/state-server.cjs");
    const rust = read("src-tauri/src/server.rs");
    for (const endpoint of runtimeContract.http.shared) {
      const [method, path] = endpoint.split(" ");
      expectJavascriptRoute(javascript, method, path);
      expectRustRoute(rust, method, path);
    }
  });

  it("keeps WebSocket explicitly development-only", () => {
    const javascript = read("src/backend/state-server.cjs");
    const rust = read("src-tauri/src/server.rs");

    expect(runtimeContract.http.developmentOnly).toContain("GET /ws");
    expect(javascript).toContain('url.pathname !== "/ws"');
    expect(rust).not.toContain('.route("/ws"');
  });
});
