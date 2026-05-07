# Deployment And Startup Guide

This guide explains how to run Spine Companion from source, connect local Spine
assets, expose state APIs, and connect the optional Codex MCP bridge.

## 1. Requirements

- Node.js 20 or newer.
- npm 10 or newer.
- Git, if you want to clone or contribute.
- A local Spine 3.8-compatible model folder containing `.skel`, `.atlas`, and
  texture files.

The app has been verified with:

- `pixi.js@6.5.10`
- `pixi-spine@3.1.2`
- Spine 3.8 `.skel/.atlas/.png` assets

## 2. Clone And Install

```bash
git clone https://github.com/cb8010d6/spine-companion.git
cd spine-companion
npm install
```

If you are working from an unpacked source folder instead of GitHub, run the
same `npm install` command in the project root.

## 3. Add Local Spine Assets

Copyrighted model assets are intentionally not included in the repository.
Choose a local model folder that you have the right to use.

```bash
npm run setup:assets -- "C:\path\to\spine_model_folder"
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
npm run setup:assets -- "C:\path\to\spine_model_folder" model.skel
```

You can also skip `companion.local.json` and use environment variables:

```bash
set SPINE_ASSET_DIR=C:\path\to\spine_model_folder
set SPINE_SKEL=model.skel
npm run dev
```

On macOS or Linux:

```bash
export SPINE_ASSET_DIR=/path/to/spine_model_folder
export SPINE_SKEL=model.skel
npm run dev
```

## 4. Start The Desktop App

For the current MVP source workflow:

```bash
npm run dev
```

This starts:

- Vite renderer on `http://127.0.0.1:17389`
- Electron desktop companion window
- Companion API inside the Electron main process on `http://127.0.0.1:17388`

The window is frameless, transparent, always-on-top, draggable, and supports
wheel scaling over the model stage.

## 5. Browser Preview Mode

Use this when you want to test the renderer in a browser without opening the
desktop window:

```bash
npm run dev:api
npm run dev:renderer
```

Open:

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

The browser preview uses the same local HTTP state API as external integrations.

## 6. State API

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

## 7. Codex MCP Bridge

The MCP bridge lets Codex read and update the companion through the local API.

Install the MCP entry into local Codex config:

```bash
npm run mcp:install:codex
```

This appends the following shape to `~/.codex/config.toml`:

```toml
[mcp_servers.spine_companion]
command = "node"
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

The desktop app or `npm run dev:api` must be running before the MCP tools can
reach the companion.

## 8. Build And Checks

Run project checks:

```bash
npm run check
npm run check:mcp
npm run build
```

`npm run build` builds the renderer into `dist/`. Packaging an installer is not
yet configured in this MVP. The runtime path for day-to-day use is `npm run dev`.

## 9. Troubleshooting

### The app says the Spine asset is missing

Run:

```bash
npm run setup:assets -- "C:\path\to\spine_model_folder"
```

Then restart `npm run dev`.

### Port 17388 or 17389 is already in use

Change the API port:

```bash
set COMPANION_PORT=17488
npm run dev
```

If you change the API port, update browser preview URLs and the MCP config
`COMPANION_API` value to match.

### Codex does not show the MCP tools

Confirm `~/.codex/config.toml` contains `[mcp_servers.spine_companion]`, then
restart Codex or open a new session.

### The model changes size between animations

The renderer samples mapped animations at startup and uses a stable frame. Tune
these values in `companion.config.json`:

- `spine.scale`
- `spine.framePadding`
- `spine.stageBottomInset`
- `spine.fitStates`
- `spine.mixDurationMs`

## 10. Open-Source Safety Checklist

Before pushing or publishing:

- Confirm `companion.local.json` is not staged.
- Confirm no `.skel`, `.atlas`, or texture files are staged.
- Confirm `local-assets/`, `dist/`, `out/`, and `node_modules/` are not staged.
- Run `npm run check`, `npm run check:mcp`, and `npm run build`.
