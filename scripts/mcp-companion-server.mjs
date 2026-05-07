#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const apiBase = (process.env.COMPANION_API || "http://127.0.0.1:17388").replace(/\/$/, "");
const states = ["idle", "working", "reviewing", "running", "success", "failed", "waiting", "sleeping", "reminder"];

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
  if (!response.ok) {
    throw new Error(value.error || `Companion API returned HTTP ${response.status}`);
  }
  return value;
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: typeof value === "object" ? value : undefined
  };
}

const server = new McpServer({
  name: "spine-companion",
  version: "0.1.0"
});

server.registerTool("companion_get_state", {
  title: "Get companion state",
  description: "Read the current Spine companion state from the local companion API."
}, async () => {
  return textResult(await apiJson("/state"));
});

server.registerTool("companion_set_state", {
  title: "Set companion state",
  description: "Set the desktop Spine companion state so Codex can reflect current work status.",
  inputSchema: {
    state: z.enum(states),
    source: z.string().default("codex"),
    message: z.string().optional(),
    direction: z.enum(["left", "right"]).optional(),
    autoReturnMs: z.number().int().positive().optional(),
    returnTo: z.enum(states).optional()
  }
}, async (input) => {
  const state = await apiJson("/state", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return textResult(state);
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
}, async (input) => {
  const reminder = await apiJson("/reminders", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return textResult(reminder);
});

server.registerTool("companion_report_codex_phase", {
  title: "Report Codex phase",
  description: "Map a Codex work phase to a companion state with sensible defaults.",
  inputSchema: {
    phase: z.enum(["thinking", "editing", "running", "reviewing", "succeeded", "failed", "waiting"]),
    message: z.string().optional()
  }
}, async ({ phase, message }) => {
  const map = {
    thinking: "working",
    editing: "working",
    running: "running",
    reviewing: "reviewing",
    succeeded: "success",
    failed: "failed",
    waiting: "waiting"
  };
  const state = await apiJson("/state", {
    method: "POST",
    body: JSON.stringify({
      state: map[phase],
      source: "codex-mcp",
      message: message || phase
    })
  });
  return textResult(state);
});

const transport = new StdioServerTransport();
await server.connect(transport);
