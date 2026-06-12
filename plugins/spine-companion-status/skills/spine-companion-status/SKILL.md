---
name: spine-companion-status
description: Configure AI coding tools to report work phases to a local Spine Companion desktop app through the bundled MCP bridge or local HTTP API.
---

# Spine Companion Status

Use this skill when a user wants Codex or another AI coding tool to update the Spine Companion desktop app automatically.

## Requirements

- Spine Companion desktop app is running.
- The local API is reachable at `http://127.0.0.1:17388` unless `COMPANION_API` is set.
- Bun is installed and available on `PATH`.

## Codex Behavior

When the `spine_companion` MCP server is available, proactively report phases:

- `thinking`: reading, reasoning, or planning.
- `editing`: changing files.
- `running`: running commands, tests, builds, or long local tasks.
- `reviewing`: checking diffs, screenshots, logs, or test output.
- `succeeded`: final successful completion.
- `failed`: blocker or failed completion.
- `waiting`: waiting for user input or external process.

Use `companion_report_ai_phase` with a short message. `companion_report_codex_phase` remains a compatibility alias. Continue the task if the companion MCP server is unavailable.

## Manual HTTP Fallback

If MCP is not available, a tool or script can post directly:

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d "{\"state\":\"working\",\"source\":\"codex-http\",\"message\":\"Working\"}"
```

Allowed states are `idle`, `working`, `reviewing`, `running`, `success`, `failed`, `waiting`, `sleeping`, and `reminder`.
