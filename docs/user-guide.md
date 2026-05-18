# Spine Companion User Guide

[English](user-guide.md) | [简体中文](user-guide.zh-CN.md)

This guide is for people who want to run the app, import a model, connect an AI
tool, and adjust the companion without editing source code.

## 30-Second Start

1. Install Spine Companion from the latest GitHub Release.
2. Open the tray icon in the system tray.
3. Choose **Manager**.
4. Open **Library**, download the catalog model, then choose **Set Active**.
5. Open **Settings** if the model needs scale or offset adjustment.

The app does not ship copyrighted Spine assets. The Manager downloads assets into
your local app data folder only.

## Tray Menu

Use the tray menu for daily control:

- **Show Companion** brings the transparent companion window back.
- **Manager** opens the model and settings UI.
- **Status Panel** opens the compact control panel.
- **Bubble** toggles the progress bubble near the model.
- **Always On Top** changes whether the model floats above other windows.
- **Zoom** adjusts the companion size.
- **State** lets you test idle, working, running, success, failed, and other states.
- **Open Config Folder** opens the folder that stores local settings and models.

## Manager

The Manager has five main views:

- **Library**: browse supported catalog models, search by name/source, download,
  and activate an installed model.
- **Installed**: inspect local models, open folders, set the active model, or
  remove inactive models.
- **Downloads**: see recent download progress and errors.
- **Settings**: adjust scale, offset, language, theme, and bubble behavior.
- **Diagnostics**: check local API health, model paths, MCP config paths, state
  history, and update status.

Settings are hot-applied where possible. Scale and offset changes should update
the running companion without restarting.

## State And Reminders

Spine Companion exposes a local state API on `127.0.0.1:17388`.

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"message\":\"Building\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"Stretch\",\"inSeconds\":60}"
```

Reminders are persisted under the user config directory, so future reminders
survive app restarts.

## AI Tool Setup

Run the bundled installer to configure common tools:

```bash
bun run skill:install
bun run ai:configure -- --target all
```

Codex Desktop and Codex CLI can also be configured directly:

```bash
bun run mcp:install:codex
```

Restart the AI tool after installing the MCP bridge. The companion app or local
API must be running while the tool sends status updates.

## Troubleshooting

If the model window is missing:

- Open the tray menu and choose **Show Companion**.
- Open **Manager > Diagnostics** and check API health and asset paths.
- Confirm your active model has `.skel`, `.atlas`, and `.png` files.

If you see a missing asset or `XMLHttpRequest failed` error:

- Use **Manager > Installed** to confirm the active model folder.
- Re-download the model from **Library**.
- Avoid moving `companion.local.json` without moving its relative model folder.

If Codex or another AI tool stays idle:

- Make sure the companion app is running.
- Re-run `bun run mcp:install:codex`.
- Restart Codex or open a new Codex session.
- Check **Manager > Diagnostics** for the MCP config path.

If the tray icon appears but the window does not:

- Use **Show Companion** from the tray.
- Check whether the model is off-screen after display changes.
- Reset scale and offsets in **Manager > Settings**.

## Developer Checks

Before publishing a release:

```bash
bun run lint
bun run check:mcp
bun run test
bun run test:coverage
bun run type-check
cd src-tauri && cargo test && cargo check
```
