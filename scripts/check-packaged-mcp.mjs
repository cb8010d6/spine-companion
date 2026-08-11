import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const exePath = path.resolve(process.argv[2] || process.env.SPINE_COMPANION_MCP_EXE || "");
const api = process.env.COMPANION_API || "http://127.0.0.1:17388";
const expectedVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

if (!process.argv[2] && !process.env.SPINE_COMPANION_MCP_EXE) {
  throw new Error("Pass the packaged Spine Companion executable path as the first argument or SPINE_COMPANION_MCP_EXE.");
}
if (!fs.existsSync(exePath)) throw new Error(`Packaged executable not found: ${exePath}`);

const readState = async () => {
  const response = await fetch(`${api}/state`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Companion API returned HTTP ${response.status}.`);
  return response.json();
};

const transport = new StdioClientTransport({
  command: exePath,
  args: ["--mcp"],
  env: {
    ...process.env,
    COMPANION_API: api,
    COMPANION_SOURCE: "packaged-smoke-mcp",
    COMPANION_SOURCE_LABEL: "Packaged MCP Smoke Test"
  },
  stderr: "pipe"
});
const client = new Client({ name: "spine-companion-packaged-check", version: "0.2.5" });
let previousState;

try {
  previousState = await readState();
  await client.connect(transport);
  const serverVersion = client.getServerVersion()?.version;
  if (serverVersion !== expectedVersion) {
    throw new Error(`Packaged MCP version is ${serverVersion || "unknown"}; expected ${expectedVersion}.`);
  }
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const expected of ["companion_get_state", "companion_set_state", "companion_reminder", "companion_report_ai_phase"]) {
    if (!names.has(expected)) throw new Error(`Packaged MCP server is missing tool: ${expected}`);
  }

  await client.callTool({
    name: "companion_report_ai_phase",
    arguments: { phase: "reviewing", message: "Packaged MCP smoke test" }
  });
  const reported = await readState();
  if (reported.state !== "reviewing" || reported.source !== "packaged-smoke-mcp") {
    throw new Error(`Packaged MCP report was not applied: ${JSON.stringify(reported)}`);
  }

  console.log(`Packaged MCP check passed (${serverVersion}): ${exePath}`);
} finally {
  if (previousState && client) {
    try {
      await client.callTool({
        name: "companion_set_state",
        arguments: {
          state: previousState.state || "idle",
          source: previousState.source || "system",
          message: previousState.message || "",
          direction: previousState.direction || "right"
        }
      });
    } catch {}
  }
  await client.close().catch(() => {});
}
