# Spine Companion v0.1.0

First public MVP release.

## What Is Included

- Windows x64 portable desktop app.
- Transparent, always-on-top Electron companion window.
- Live Spine 3.8 rendering through `pixi.js@6.5.10` and `pixi-spine@3.1.2`.
- Local HTTP, SSE, and WebSocket state API.
- Reminder support.
- Codex MCP bridge scripts.
- Stable animation sizing across mapped states.

## Windows Quick Start

1. Download `spine-companion-0.1.0-windows-x64-portable.exe`.
2. Download `companion.local.example.json`, rename it to `companion.local.json`,
   and put it next to the exe.
3. Edit `companion.local.json`:

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

4. Double-click the exe.

## Asset Notice

This release does not include Arknights, Ark-Models, or any other copyrighted
Spine model assets. You must provide your own local Spine 3.8-compatible model
folder containing `.skel`, `.atlas`, and texture files.

## Checks

- `npm run check`
- `npm run check:mcp`
- `npm run release:win`
