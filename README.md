# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

Open-source desktop companion MVP for Spine 3.8 models. It uses Electron,
`pixi.js@6.5.10`, and `pixi-spine@3.1.2` to render `.skel/.atlas/.png` directly
with transparent background, always-on-top window behavior, dragging, scaling,
click interaction, state transitions, a local status API, MCP bridge, progress
bubble, tray controls, simple reminders, and a tool-like Manager window.

## Asset Policy

This repository does not include Arknights, Ark-Models, or any other copyrighted
model assets. Use those only as local test material if you have the right to do
so. The repo keeps only code, examples, and setup instructions.

Local asset config is written to `companion.local.json`, which is ignored by git.

## Quick Start

### Use A Release Build

1. Download the latest Windows installer or portable build from GitHub Release.
2. Prefer putting `companion.local.json` in the per-user config folder:

```text
%APPDATA%\spine-companion\companion.local.json
```

You can also put it next to the exe:

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

3. Double-click the app. Use the tray menu to open the config folder, show the
   status panel, open the Manager window, zoom, switch states, and quit.

### Run From Source

```bash
bun install
bun run setup:assets -- "C:\path\to\amiya_spine"
bun run dev
```

Run the Tauri candidate build from source:

```bash
bun run tauri:dev
```

For detailed deployment, startup, MCP, and troubleshooting steps, see
[docs/deployment.md](docs/deployment.md).

The renderer preview is available at:

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

For API-only browser preview without launching Electron:

```bash
bun run dev:renderer
bun run dev:api
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
bun run mcp:install:codex
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
bun run skill:install
bun run ai:configure -- --target all
```

Supported targets include Codex Desktop, Codex CLI, Cursor, Claude Desktop,
Claude Code, and Claude CLI. Unsupported MCP tools can copy the JSON snippets in
[docs/ai-tools.md](docs/ai-tools.md).

## One-Click Codex Plugin

The repo includes a local Codex plugin:

```text
plugins/spine-companion-status
```

Codex environments that support repo marketplace files can install
`Spine Companion Status` from `.agents/plugins/marketplace.json`. The plugin
provides the status-reporting skill and a `spine_companion` MCP bridge config
that starts with Bun by default.

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

The settings panel includes a model picker and download/import action. The
bundled Ark-Models catalog entry downloads only into the local config folder;
this repository and public releases do not include the model asset files.

## Open-Source Notes

- Do not commit `.skel`, `.atlas`, or texture files for copyrighted models.
- Keep local model paths in `companion.local.json` or environment variables.
- Use `companion.config.example.json` as the public template.
- Placeholder directories under `assets/` exist only to document placement.

## macOS Release Signing

GitHub Actions can build unsigned macOS artifacts, but Apple Silicon users may
see Gatekeeper errors such as "damaged" or "cannot be opened". For public macOS
downloads, configure these repository secrets so electron-builder can sign and
notarize DMG/ZIP assets:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`
