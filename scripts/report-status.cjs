#!/usr/bin/env node
const statesByPhase = {
  thinking: "working",
  editing: "working",
  running: "running",
  reviewing: "reviewing",
  succeeded: "success",
  failed: "failed",
  waiting: "waiting"
};

const apiBase = (process.env.COMPANION_API || "http://127.0.0.1:17388").replace(/\/$/, "");
const [phase = "thinking", ...messageParts] = process.argv.slice(2);
const state = statesByPhase[phase] || phase;
const message = messageParts.join(" ").trim() || phase;

async function main() {
  const response = await fetch(`${apiBase}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state,
      source: "codex-mcp",
      message
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Companion API returned HTTP ${response.status}`);
  }
  process.stdout.write(text ? `${text}\n` : "OK\n");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
