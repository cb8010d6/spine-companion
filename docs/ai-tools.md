# AI Tool Integration

[English](ai-tools.md) | [简体中文](ai-tools.zh-CN.md)

Spine Companion supports AI tools through MCP when possible and through the
local HTTP API as a fallback. Tauri builds include a self-contained MCP
entrypoint, so installed users should prefer the app executable instead of
repo-local scripts.

## Manager Setup

Open **Manager > AI Integrations** to detect supported local AI tools and write
their MCP config after confirmation. The manager creates a timestamped backup
before writing and marks the tool as **Needs restart** after configuration.

The first supported set is Codex, Claude Desktop, Cursor / VS Code, Roo / Cline,
Gemini / Antigravity, OpenCode, and MiMoCode. MiMoCode support is best-effort
because its MCP config format is not publicly documented.

## Manual MCP Shape

Installed Tauri app:

```json
{
  "mcpServers": {
    "spine_companion": {
      "command": "C:/Program Files/Spine Companion/spine-companion.exe",
      "args": ["--mcp"],
      "env": {
        "COMPANION_API": "http://127.0.0.1:17388",
        "COMPANION_SOURCE": "my-tool-mcp",
        "COMPANION_SOURCE_LABEL": "My Tool"
      }
    }
  }
}
```

OpenCode uses its official `mcp` config shape with a command array:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "spine_companion": {
      "type": "local",
      "command": ["C:/Program Files/Spine Companion/spine-companion.exe", "--mcp"],
      "enabled": true,
      "environment": {
        "COMPANION_API": "http://127.0.0.1:17388",
        "COMPANION_SOURCE": "opencode-mcp",
        "COMPANION_SOURCE_LABEL": "OpenCode"
      }
    }
  }
}
```

Source workflow fallback:

```json
{
  "mcpServers": {
    "spine_companion": {
      "command": "node",
      "args": ["C:/path/to/spine-companion/scripts/mcp-companion-server.mjs"],
      "env": {
        "COMPANION_API": "http://127.0.0.1:17388",
        "COMPANION_SOURCE": "my-tool-mcp",
        "COMPANION_SOURCE_LABEL": "My Tool"
      }
    }
  }
}
```

MCP stdio servers generally cannot reliably know which parent AI app launched
them. The stable integration contract is: configure `COMPANION_SOURCE` and
`COMPANION_SOURCE_LABEL` in the MCP client. Unknown future tools are supported
as long as they can launch a local stdio MCP server and set environment
variables.

## HTTP Fallback

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

MCP does not automatically push state. The AI tool must have instructions to call
`companion_report_ai_phase` during work phases. `companion_report_codex_phase`
remains as a compatibility alias for older Codex instructions.
