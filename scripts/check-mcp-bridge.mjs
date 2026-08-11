import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { createCompanionServer } from "../src/backend/state-server.cjs";
import { getPublicConfig, loadConfig } from "../src/backend/config.cjs";
import runtimeContract from "../src/shared/runtime-contract.json" with { type: "json" };

const require = createRequire(import.meta.url);
const { version: companionVersion } = require("../package.json");

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
    COMPANION_API: origin,
    COMPANION_SOURCE: "",
    COMPANION_SOURCE_LABEL: ""
  },
  stderr: "pipe"
});

const client = new Client({ name: "spine-companion-check", version: "0.1.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expectedNames = [...runtimeContract.mcp.core].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Source MCP tools differ from the runtime contract: ${JSON.stringify(names)}`);
  }
  const serverVersion = client.getServerVersion?.();
  if (serverVersion?.version !== companionVersion) {
    throw new Error(`Source MCP version ${serverVersion?.version || "unknown"} does not match package ${companionVersion}`);
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

  await client.callTool({
    name: "companion_report_codex_phase",
    arguments: {
      phase: "running"
    }
  });

  const aliasState = api.store.snapshot();
  if (aliasState.state !== "running" || aliasState.source !== "spine-companion-check-mcp") {
    throw new Error(`Unexpected alias source: ${JSON.stringify(aliasState)}`);
  }

  console.log("MCP bridge check passed.");
} finally {
  await client.close();
  api.close();
}
