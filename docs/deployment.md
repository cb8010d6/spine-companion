# Deployment And Startup Guide

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

This guide explains how to run Spine Companion from source, connect local Spine
assets, expose state APIs, and connect the optional Codex MCP bridge.

## 1. Requirements

- Bun 1.3 or newer.
- Git, if you want to clone or contribute.
- A local Spine 3.8-compatible model folder containing `.skel`, `.atlas`, and
  texture files.

The app has been verified with:

- `pixi.js@6.5.10`
- `pixi-spine@3.1.2`
- Spine 3.8 `.skel/.atlas/.png` assets

## 2. Easiest Windows Release Startup

Use this path if you only want to run the app.

1. Download the latest Windows installer or portable build from the GitHub
   Release page.
2. Open the tray menu and choose `Open Config Folder`, then create
   `companion.local.json` in that folder.
3. Put this in the file and edit the two paths:

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

4. Double-click the app. If no model appears, use `Open Config Folder` again
   from the tray menu and confirm the config file is in the right place.

The app does not ship copyrighted Spine model assets. Your `assetDir` must point
to a local folder containing `.skel`, `.atlas`, and texture files.

The release build also checks this per-user config path:

```text
%APPDATA%\spine-companion\companion.local.json
```

The app also checks for `companion.local.json` next to the executable, but the
per-user config folder is more reliable across reinstall or overwrite updates.

## 3. Clone And Install

```bash
git clone https://github.com/cb8010d6/spine-companion.git
cd spine-companion
bun install
```

If you are working from an unpacked source folder instead of GitHub, run the
same command in the project root:

```bash
bun install
```

## 4. Add Local Spine Assets

Copyrighted model assets are intentionally not included in the repository.
Choose a local model folder that you have the right to use.

```bash
bun run setup:assets -- "C:\path\to\spine_model_folder"
```

The setup script validates that the folder contains a `.skel`, at least one
`.atlas`, and at least one texture image. It then writes:

```text
companion.local.json
```

That file is ignored by git. Do not commit proprietary `.skel`, `.atlas`, or
texture files.

If the folder contains multiple `.skel` files, pass the skeleton filename:

```bash
bun run setup:assets -- "C:\path\to\spine_model_folder" model.skel
```

You can also skip `companion.local.json` and use environment variables:

```bash
set SPINE_ASSET_DIR=C:\path\to\spine_model_folder
set SPINE_SKEL=model.skel
bun run dev
```

On macOS or Linux:

```bash
export SPINE_ASSET_DIR=/path/to/spine_model_folder
export SPINE_SKEL=model.skel
bun run dev
```

## 5. Start The Desktop App

For the current MVP source workflow:

```bash
bun run dev
```

This starts:

- Vite renderer on `http://127.0.0.1:17389`
- Electron desktop companion window
- Companion API inside the Electron main process on `http://127.0.0.1:17388`

The window is frameless, transparent, always-on-top, draggable, and supports
wheel scaling over the model stage.

Run the Tauri candidate build:

```bash
bun run tauri:dev
```

The Tauri tray menu can show the window, show or hide the status panel, show or
hide the progress bubble, toggle bubble shadow and background, change drag mode,
zoom, reset size, switch states, open the local API, open the config folder, and
quit.

The built-in settings panel also includes a model picker. Select
`Amiya Guard Skin #16` and click `Download and use` to download the model from
`isHarryh/Ark-Models` into your local config folder and write
`companion.local.json`. The app switches to the imported model immediately. The
asset files stay local and are not committed to this repository.

## 6. Browser Preview Mode

Use this when you want to test the renderer in a browser without opening the
desktop window:

```bash
bun run dev:api
bun run dev:renderer
```

Open:

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

The browser preview uses the same local HTTP state API as external integrations.

## 7. State API

The local API listens on:

```text
http://127.0.0.1:17388
```

Read current state:

```bash
curl http://127.0.0.1:17388/state
```

Set a state:

```bash
curl -X POST http://127.0.0.1:17388/state ^
  -H "Content-Type: application/json" ^
  -d "{\"state\":\"working\",\"source\":\"curl\"}"
```

PowerShell example:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17388/state `
  -ContentType "application/json" `
  -Body '{"state":"reviewing","source":"powershell"}'
```

Supported states:

- `idle`
- `working`
- `reviewing`
- `running`
- `success`
- `failed`
- `waiting`
- `sleeping`
- `reminder`

Direction is only meaningful for `running`:

```json
{
  "state": "running",
  "direction": "left",
  "source": "example"
}
```

Schedule a reminder:

```bash
curl -X POST http://127.0.0.1:17388/reminders ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"stand up\",\"inSeconds\":30}"
```

Event streams:

- SSE: `GET /events`
- WebSocket: `ws://127.0.0.1:17388/ws`

## 8. Codex MCP Bridge

The MCP bridge lets Codex read and update the companion through the local API.

Install the MCP entry into local Codex config:

```bash
bun run mcp:install:codex
```

This appends the following shape to `~/.codex/config.toml`:

```toml
[mcp_servers.spine_companion]
command = "bun"
args = ["C:/path/to/spine-companion/scripts/mcp-companion-server.mjs"]
env = { COMPANION_API = "http://127.0.0.1:17388" }
```

Restart Codex or open a new session after installing. Existing sessions usually
do not hot-load newly added MCP servers.

MCP tools:

- `companion_get_state`
- `companion_set_state`
- `companion_reminder`
- `companion_report_codex_phase`

The desktop app or `bun run dev:api` must be running before the MCP tools can
reach the companion.

## 9. One-Click Codex Plugin

The repo includes a local Codex plugin:

```text
plugins/spine-companion-status
```

Codex environments that read `.agents/plugins/marketplace.json` can install
`Spine Companion Status`. It provides:

- The `spine-companion-status` skill.
- A `spine_companion` MCP server config.
- A Bun-based bridge script at
  `plugins/spine-companion-status/scripts/mcp-companion-server.mjs`.

The desktop app or `bun run dev:api` still needs to be running before the MCP
bridge can reach the local API.

## 10. Build And Checks

Run project checks:

```bash
bun run check
bun run check:mcp
bun run build
```

`bun run build` builds the renderer into `dist/`. Packaging an installer is not
required for normal development.

Create a Windows portable release artifact:

```bash
bun run release:win
```

The output is written to:

```text
release/spine-companion-0.1.2-windows-x64-portable.exe
```

Create a local Tauri portable-with-assets folder:

```bash
bun run tauri:portable:assets
```

Output:

```text
release/Spine Companion Portable/
release/Spine Companion Portable.zip
```

This downloads Ark-Models test assets into the portable folder's `models/`
directory. Use it for local testing or distribution only when you have confirmed
you are allowed to redistribute those assets; public open-source releases should
not bundle copyrighted model files.

## 11. Troubleshooting

### The app says the Spine asset is missing

Run:

```bash
bun run setup:assets -- "C:\path\to\spine_model_folder"
```

Then restart `bun run dev`.

### Port 17388 or 17389 is already in use

Change the API port:

```bash
set COMPANION_PORT=17488
bun run dev
```

If you change the API port, update browser preview URLs and the MCP config
`COMPANION_API` value to match.

### Codex does not show the MCP tools

Confirm `~/.codex/config.toml` contains `[mcp_servers.spine_companion]`, then
restart Codex or open a new session.

### macOS arm64 app cannot be opened

Unsigned macOS artifacts from GitHub Actions can be blocked by Gatekeeper,
especially on Apple Silicon. For public macOS releases, configure repository
secrets so the release workflow can sign and notarize:

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`

Without those secrets, users may need to remove quarantine manually or use a
local development run instead of the release artifact.

### The model changes size between animations

The renderer samples mapped animations at startup and uses a stable frame. Tune
these values in `companion.config.json`:

- `spine.scale`
- `spine.framePadding`
- `spine.stageBottomInset`
- `spine.fitStates`
- `spine.mixDurationMs`

## 12. Open-Source Safety Checklist

Before pushing or publishing:

- Confirm `companion.local.json` is not staged.
- Confirm no `.skel`, `.atlas`, or texture files are staged.
- Confirm `local-assets/`, `dist/`, `out/`, and `node_modules/` are not staged.
- Run `bun run check`, `bun run check:mcp`, and `bun run build`.
