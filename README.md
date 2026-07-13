# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

Open-source desktop companion for Spine 3.8 models. The desktop runtime is Tauri.
The renderer uses `pixi.js@6.5.10` and `pixi-spine@3.1.2` to render
`.skel/.atlas/.png` directly with transparent background, always-on-top window
behavior, dragging, scaling, click interaction, state transitions, a local status
API, MCP bridge, progress bubble, tray controls, simple reminders, and a
tool-like Manager window.

## Asset Policy

This repository does not include Arknights, Ark-Models, or any other copyrighted
model assets. Use those only as local test material if you have the right to do
so. The repo keeps only code, examples, and setup instructions.

Local asset config is written to `companion.local.json`, which is ignored by git.

## Quick Start

### Use A Release Build

1. Download the package for your platform from GitHub Releases. Windows is the
   primary supported platform; the unsigned macOS and Linux packages are
   experimental previews in rc.5.
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

`bun run dev` and `bun run tauri:dev` both start the Tauri application.

For detailed deployment, startup, MCP, and troubleshooting steps, see
[docs/guides/deployment.md](docs/guides/deployment.md). For a UI-focused walkthrough, see
[docs/guides/user-guide.md](docs/guides/user-guide.md).
The planned AI-assisted character workflow is documented in
[docs/guides/avatar-studio.md](docs/guides/avatar-studio.md).

The renderer preview is available at:

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

For an API-only browser preview without launching the desktop application:

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
[docs/guides/ai-tools.md](docs/guides/ai-tools.md).

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

- Tauri's `window.companion` bridge, used by the desktop app.
- Local HTTP polling, used by browser preview and simple integrations.
- JSON polling, useful for scripts that write a status file.
- WebSocket, useful for push-style bridge services.

See [docs/architecture/overview.md](docs/architecture/overview.md) for the intended MCP bridge
shape.

## Desktop Controls

The Windows tray menu can show or hide the status panel, toggle always-on-top,
show or hide the progress bubble, zoom the model, reset size, switch states, and
quit. Dragging the transparent stage moves the window; horizontal dragging
temporarily switches to `running` and mirrors the model left or right.

The Manager includes a searchable model library, installed model actions,
download status, hot-applied scale and offset settings, diagnostics, update
checks, and recent state history. The bundled Ark-Models catalog entry downloads
only into the local config folder; this repository and public releases do not
include the model asset files.

## FAQ

**Why does the app show missing asset?**
Open Manager > Diagnostics and confirm the active model folder contains `.skel`,
`.atlas`, and `.png` files. If the model was downloaded through Library, try
setting it active again from Installed.

**Why does Codex stay idle?**
The MCP bridge only works while the companion app or local API is running. Run
`bun run mcp:install:codex`, restart Codex, and check Manager > Diagnostics.

**Which runtime should I use?**
Use the Tauri release build. Electron was retired in v0.2.6-rc.5 and is no
longer shipped, tested, or retained as a second desktop backend.

## Open-Source Notes

- Do not commit `.skel`, `.atlas`, or texture files for copyrighted models.
- Keep local model paths in `companion.local.json` or environment variables.
- Use `companion.config.example.json` as the public template.
- Placeholder directories under `assets/` exist only to document placement.

## Platform Support

| Platform | rc.5 status | Package |
| --- | --- | --- |
| Windows 10/11 x64 | Primary support | NSIS `.exe` |
| macOS Apple Silicon | Experimental, unsigned | `.dmg` |
| macOS Intel | Experimental, unsigned | `.dmg` |
| Linux x64 | Experimental | `.AppImage`, `.deb` |

The macOS and Linux builds use the same Tauri application and renderer, but
transparent windows, tray behavior, click-through input, Wayland/X11, and GPU
drivers differ by desktop environment. Report platform-specific problems with
the diagnostics export attached.

## macOS Release Signing

GitHub Actions can build unsigned macOS artifacts, but Apple Silicon users may
see Gatekeeper errors such as "damaged" or "cannot be opened". For public macOS
downloads, configure Apple signing and notarization secrets for the Tauri build:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`
