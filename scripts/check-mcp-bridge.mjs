import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCompanionServer } from "../src/main/state-server.cjs";
import { getPublicConfig, loadConfig } from "../src/main/config.cjs";

const config = loadConfig();
config.server.port = 0;

const api = createCompanionServer(config, () => getPublicConfig(config, origin));
const address = await api.listen();
const origin = `http://${address.address}:${address.port}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["scripts/mcp-companion-server.mjs"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    COMPANION_API: origin
  },
  stderr: "pipe"
});

const client = new Client({ name: "spine-companion-check", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  for (const expected of ["companion_get_state", "companion_set_state", "companion_reminder", "companion_report_codex_phase"]) {
    if (!names.includes(expected)) throw new Error(`Missing MCP tool: ${expected}`);
  }

  await client.callTool({
    name: "companion_set_state",
    arguments: {
      state: "reviewing",
      source: "mcp-check",
      message: "bridge check"
    }
  });

  const state = api.store.snapshot();
  if (state.state !== "reviewing" || state.source !== "mcp-check") {
    throw new Error(`Unexpected companion state: ${JSON.stringify(state)}`);
  }

  console.log("MCP bridge check passed.");
} finally {
  await client.close();
  api.close();
}
