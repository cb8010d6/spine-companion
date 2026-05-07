---
name: spine-companion-status
description: Configure AI coding tools to report work phases to a local Spine Companion desktop app. Use when a user wants Codex, Cursor, Claude Desktop, Claude Code, or other MCP-capable AI tools to automatically update companion states through the Spine Companion MCP bridge or local HTTP API.
---

# Spine Companion Status

[English](SKILL.md) | [简体中文](SKILL.zh-CN.md)

Use this skill to connect AI tools to a local Spine Companion app.

## Workflow

1. Find the Spine Companion repo root. It must contain `scripts/mcp-companion-server.mjs`.
2. Make sure the companion desktop app or API is running at `http://127.0.0.1:17388`.
3. Run the bundled configurator:

```bash
node scripts/configure-ai-tools.cjs --repo C:\path\to\spine-companion --target all
```

Use `--target codex`, `codex-cli`, `cursor`, `claude-desktop`, `claude-code`,
or `claude-cli` for a single tool.

4. Restart the configured AI tool. Most MCP clients do not hot-load new servers.
5. Verify by asking the tool to call `companion_report_codex_phase` or by posting:

```bash
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"source\":\"manual-check\"}"
```

## Reporting Policy

When Spine Companion MCP tools are available, proactively report work phases:

- `thinking`: reasoning, planning, or reading context.
- `editing`: changing files.
- `running`: running commands, tests, builds, or long local tasks.
- `reviewing`: checking results, diffs, screenshots, or test output.
- `succeeded`: final successful completion.
- `failed`: blocker or failed completion.
- `waiting`: waiting for user input or an external process.

Keep messages short. Do not fail the user's task just because the companion is unavailable.

## Tool Support

- Codex Desktop / Codex CLI: writes `~/.codex/config.toml` and `~/.codex/AGENTS.md`.
- Cursor: writes workspace `.cursor/mcp.json` and `.cursor/rules/spine-companion-status.mdc`.
- Claude Desktop: writes the user `claude_desktop_config.json`.
- Claude Code / Claude CLI: writes workspace `.mcp.json` and `CLAUDE.md`.
- Other tools: use the local HTTP API or copy the MCP server entry from `references/mcp-configs.md`.

Read `references/mcp-configs.md` only when a user asks for manual setup details or an unsupported tool.
