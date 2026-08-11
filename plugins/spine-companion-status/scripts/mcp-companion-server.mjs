#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { z } from "zod";
import sourceRegistry from "../../../src/shared/source-registry.cjs";

const require = createRequire(import.meta.url);
let companionVersion = process.env.COMPANION_MCP_VERSION || "unknown";
try {
  companionVersion = require("../../../package.json").version;
} catch {}

const apiBase = (process.env.COMPANION_API || "http://127.0.0.1:17388").replace(/\/$/, "");
const states = ["idle", "working", "reviewing", "running", "success", "failed", "waiting", "sleeping", "reminder"];

function configuredSource() {
  const envSource = String(process.env.COMPANION_SOURCE || "").trim();
  const envLabel = String(process.env.COMPANION_SOURCE_LABEL || "").trim();
  if (envSource) {
    return {
      source: envSource,
      sourceLabel: sourceRegistry.sourceDisplayName(envSource, envLabel)
    };
  }
  const clientInfo = server.server.getClientVersion?.();
  const clientSource = sourceRegistry.sourceFromClientInfo(clientInfo || {});
  return {
    source: clientSource || "ai-mcp",
    sourceLabel: sourceRegistry.sourceDisplayName(clientSource || "ai-mcp")
  };
}

function sourceForInput(input = {}) {
  const configured = configuredSource();
  return {
    ...configured,
    source: input.source || configured.source
  };
}

async function apiJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(value.error || `Companion API returned HTTP ${response.status}`);
  return value;
}

function publicApiEndpoint() {
  try {
    const url = new URL(apiBase);
    return url.protocol + "//" + url.hostname + (url.port ? ":" + url.port : "");
  } catch {
    return "configured loopback API";
  }
}

async function readBridgeProbe() {
  const read = async (path) => {
    try {
      return { ok: true, value: await apiJson(path) };
    } catch {
      return { ok: false, value: null };
    }
  };
  const [healthResult, stateResult] = await Promise.all([read("/health"), read("/state")]);
  const healthOk = healthResult.ok && healthResult.value?.ok === true;
  const state = stateResult.ok
    && typeof stateResult.value?.state === "string"
    && typeof stateResult.value?.source === "string"
    ? {
        state: stateResult.value.state,
        source: stateResult.value.source
      }
    : null;
  return { healthOk, state };
}

function bridgeResult(probe) {
  const stateCheck = { ok: Boolean(probe.state) };
  if (probe.state) Object.assign(stateCheck, probe.state);
  const reason = probe.healthOk && probe.state
    ? "ok"
    : probe.healthOk
      ? "state_unavailable"
      : probe.state
        ? "health_unavailable"
        : "bridge_unavailable";
  return {
    ok: reason === "ok",
    reason,
    checks: {
      health: { ok: probe.healthOk },
      state: stateCheck
    },
    mutated: false
  };
}

function diagnosticsResult(probe, source) {
  return {
    ok: probe.healthOk && Boolean(probe.state),
    reason: bridgeResult(probe).reason,
    api: {
      endpoint: publicApiEndpoint(),
      health: { ok: probe.healthOk }
    },
    state: probe.state || { ok: false },
    mcp: {
      server: "spine-companion",
      version: companionVersion,
      transport: "stdio",
      source: source.source,
      sourceLabel: source.sourceLabel
    },
    note: "Full GPU, model, and cache diagnostics are available in Manager > Diagnostics."
  };
}

function textResult(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "object" ? value : undefined
  };
}

const server = new McpServer({
  name: "spine-companion",
  version: companionVersion
});

server.registerTool("companion_get_state", {
  title: "Get companion state",
  description: "Read the current Spine companion state from the local companion API."
}, async () => textResult(await apiJson("/state")));

server.registerTool("companion_get_diagnostics", {
  title: "Get MCP diagnostics",
  description: "Read API health, current state/source, and MCP connection metadata. Full GPU, model, and cache diagnostics remain in Manager > Diagnostics; no config paths or secrets are returned.",
  inputSchema: z.object({})
}, async () => {
  const source = configuredSource();
  return textResult(diagnosticsResult(await readBridgeProbe(), source));
});

server.registerTool("companion_test_bridge", {
  title: "Test companion bridge",
  description: "Verify that the local /health and /state endpoints are readable without changing companion state. Returns machine-readable ok and reason fields.",
  inputSchema: z.object({})
}, async () => textResult(bridgeResult(await readBridgeProbe())));

server.registerTool("companion_set_state", {
  title: "Set companion state",
  description: "Set the desktop Spine companion state for an AI coding tool.",
  inputSchema: {
    state: z.enum(states),
    source: z.string().optional(),
    message: z.string().optional(),
    direction: z.enum(["left", "right"]).optional(),
    autoReturnMs: z.number().int().positive().optional(),
    returnTo: z.enum(states).optional()
  }
}, async (input) => {
  const resolved = sourceForInput(input);
  const state = await apiJson("/state", {
  method: "POST",
    body: JSON.stringify({ ...input, source: resolved.source })
  });
  return textResult({ ...state, sourceLabel: resolved.sourceLabel });
});

server.registerTool("companion_reminder", {
  title: "Create companion reminder",
  description: "Schedule a local reminder that switches the companion into reminder animation when due.",
  inputSchema: {
    text: z.string().min(1),
    inSeconds: z.number().positive().optional(),
    delayMs: z.number().int().positive().optional(),
    dueAt: z.string().optional(),
    durationMs: z.number().int().positive().default(5600),
    returnTo: z.enum(states).default("idle")
  }
}, async (input) => textResult(await apiJson("/reminders", {
  method: "POST",
  body: JSON.stringify(input)
})));

server.registerTool("companion_report_codex_phase", {
  title: "Report Codex phase",
  description: "Compatibility alias for older Codex instructions. Uses the configured MCP source.",
  inputSchema: {
    phase: z.enum(["thinking", "editing", "running", "reviewing", "succeeded", "failed", "waiting"]),
    message: z.string().optional(),
    source: z.string().optional()
  }
}, reportPhase);

server.registerTool("companion_report_ai_phase", {
  title: "Report AI phase",
  description: "Map an AI coding tool work phase to a companion state with sensible defaults.",
  inputSchema: {
    phase: z.enum(["thinking", "editing", "running", "reviewing", "succeeded", "failed", "waiting"]),
    message: z.string().optional(),
    source: z.string().optional()
  }
}, reportPhase);

async function reportPhase({ phase, message, source }) {
  const resolved = sourceForInput({ source });
  const map = {
    thinking: "working",
    editing: "working",
    running: "running",
    reviewing: "reviewing",
    succeeded: "success",
    failed: "failed",
    waiting: "waiting"
  };
  return textResult(await apiJson("/state", {
    method: "POST",
    body: JSON.stringify({
      state: map[phase],
      source: resolved.source,
      message: message || phase
    })
  }).then((state) => ({ ...state, sourceLabel: resolved.sourceLabel })));
}

await server.connect(new StdioServerTransport());
