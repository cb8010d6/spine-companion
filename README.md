# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

Open-source desktop companion MVP for Spine 3.8 models. It uses Electron,
`pixi.js@6.5.10`, and `pixi-spine@3.1.2` to render `.skel/.atlas/.png` directly
with transparent background, always-on-top window behavior, dragging, scaling,
click interaction, state transitions, a local status API, MCP bridge, progress
bubble, tray controls, and simple reminders.

## Asset Policy

This repository does not include Arknights, Ark-Models, or any other copyrighted
model assets. Use those only as local test material if you have the right to do
so. The repo keeps only code, examples, and setup instructions.

Local asset config is written to `companion.local.json`, which is ignored by git.

## Quick Start

### Use A Release Build

1. Download `spine-companion-0.1.2-windows-x64-portable.exe` from the latest
   GitHub Release.
2. Put `companion.local.json` next to the exe:

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

3. Double-click the exe.

### Run From Source

```bash
npm install
npm run setup:assets -- "C:\path\to\amiya_spine"
npm run dev
```

For detailed deployment, startup, MCP, and troubleshooting steps, see
[docs/deployment.md](docs/deployment.md).

The renderer preview is available at:

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

For API-only browser preview without launching Electron:

```bash
npm run dev:renderer
npm run dev:api
```

MVP means this is the smallest usable vertical slice: desktop shell, live Spine
rendering, state switching, local status API, reminders, and MCP bridge. It is
not a spritesheet export path.

## Local State API

The default API listens on `http://127.0.0.1:17388`.

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"source\":\"curl\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"stand up\",\"inSeconds\":30}"
```

State events are also available through:

- SSE: `GET /events`
- WebSocket: `ws://127.0.0.1:17388/ws`

## Codex MCP Bridge

The MCP server lets Codex read and update the companion through the local API.

```bash
npm run mcp:install:codex
```

This appends a `spine_companion` MCP server entry to `~/.codex/config.toml`.
Restart Codex or open a new session after installing it.

Available MCP tools:

- `companion_get_state`
- `companion_set_state`
- `companion_reminder`
- `companion_report_codex_phase`

The companion app or API must be running while Codex uses the MCP bridge.

To install the reusable status reporting skill and configure common AI tools:

```bash
npm run skill:install
npm run ai:configure -- --target all
```

Supported targets include Codex Desktop, Codex CLI, Cursor, Claude Desktop,
Claude Code, and Claude CLI. Unsupported MCP tools can copy the JSON snippets in
[docs/ai-tools.md](docs/ai-tools.md).

## States And Animations

| State | Spine animation |
| --- | --- |
| `idle` | `Relax` |
| `working` | `Relax` |
| `running` | `Move` |
| `reminder` | `Interact` |
| `waiting` | `Sit` |
| `failed` | `Sleep` |
| `sleeping` | `Sleep` |
| `reviewing` | `Special`, configurable `review` segment |
| `success` | `Special`, configurable `success` segment |

Animation changes use Spine runtime mixing through `stateData.setMix` and
per-transition `mixDuration`. The renderer samples all mapped state animations
at startup and uses one stable display frame, so `Sit`, `Sleep`, `Move`, and
`Special` stay in a consistent size range. `Special` segments are configured in
`companion.config.json`.

## Provider Layer

The renderer supports these state sources:

- Electron IPC, used by the desktop app.
- Local HTTP polling, used by browser preview and simple integrations.
- JSON polling, useful for scripts that write a status file.
- WebSocket, useful for push-style bridge services.

See [docs/architecture.md](docs/architecture.md) for the intended MCP bridge
shape.

## Desktop Controls

The Windows tray menu can show or hide the status panel, toggle always-on-top,
show or hide the progress bubble, zoom the model, reset size, switch states, and
quit. Dragging the transparent stage moves the window; horizontal dragging
temporarily switches to `running` and mirrors the model left or right.

## Open-Source Notes

- Do not commit `.skel`, `.atlas`, or texture files for copyrighted models.
- Keep local model paths in `companion.local.json` or environment variables.
- Use `companion.config.example.json` as the public template.
- Placeholder directories under `assets/` exist only to document placement.
