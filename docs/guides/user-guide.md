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

- **Dashboard**: see the active model, AI source, local bridge, renderer health,
  reminders, and updates at a glance.
- **Library**: use the **Browse**, **Installed**, and **Downloads** tabs to search
  catalog sources, manage local models, and inspect transfer errors.
  - **Base operators** provide the full companion action set.
  - **Dynamic illustrations** are display-oriented and usually fall back to
    Idle/Default for task states.
  - **Enemies** are experimental because upstream animation names vary.
  Limited models show a warning before download; state messages still work.
- **AI Integrations**: detect, configure, test, and safely restore supported AI
  tool configurations.
- **Settings**: adjust scale, offset, language, theme, and bubble behavior.
- **Diagnostics**: check local API health, model paths, MCP config paths, state
  history, and update status.

Avatar Studio is an experimental tool under **Settings > Labs** rather than a
primary daily-use page.

Settings are hot-applied where possible. Scale and offset changes should update
the running companion without restarting.

## State And Reminders

Spine Companion exposes a local state API on `127.0.0.1:17388`.

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"message\":\"Building\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"Stretch\",\"inSeconds\":60}"
```

State, reminders, and recent history are held only for the current application
session. They reset when the application exits. Model files, settings, and AI
configuration backups are stored in user data and are intended to survive an
application restart or upgrade.

## AI Tool Setup

Open **Manager > AI Integrations**, choose the detected tool, review the file and
backup preview, then select **Configure**. Run the packaged self-test, install or
copy the displayed Agent instructions, and restart the AI tool or open a new
session. Setup is complete only after Manager receives the first real work
report; a successful self-test alone does not prove that the AI is reporting.

The companion app must be running while the AI tool sends status updates. Source
scripts and manual MCP templates are developer fallbacks documented in the
[AI tools guide](ai-tools.md), not prerequisites for an installed app.

## Troubleshooting

If the model window is missing:

- Open the tray menu and choose **Show Companion**.
- Open **Manager > Diagnostics** and check API health and asset paths.
- Confirm your active model has `.skel`, `.atlas`, and `.png` files.

If you see a missing asset or `XMLHttpRequest failed` error:

- Use **Manager > Library > Installed** to confirm the active model folder.
- Re-download the model from **Library**.
- Avoid moving `companion.local.json` without moving its relative model folder.

If Codex or another AI tool stays idle:

- Make sure the companion app is running.
- Open **Manager > AI Integrations**, select the tool, and run **Test Connection**.
- Restart Codex or open a new Codex session.
- Confirm Manager no longer says **Waiting for first report** after a real task.
- Check **Manager > Diagnostics** for the MCP config path.

If the tray icon appears but the window does not:

- Use **Show Companion** from the tray.
- Check whether the model is off-screen after display changes.
- Reset scale and offsets in **Manager > Settings**.

## Touch and Pen Input

- Tap the character to play its interaction animation.
- Drag with one finger or a pen to move the companion window.
- Pinch with two fingers over the character to change its scale.
- Scale, offsets, and framing are saved per model. Use **Manager > Settings >
  Model framing** to keep the previous automatic layout, focus the character,
  or show the full dynamic artwork.
- Touch-friendly Manager controls use larger targets on coarse-pointer devices.
- Windows keeps native dynamic pointer bounds. On Linux and macOS, the current
  compatibility mode keeps the companion interactive instead of enabling full
  transparent-area click-through. macOS trackpad zoom is handled through the
  WebView wheel gesture path; Apple does not currently ship touchscreen Macs.

If Windows reports `LiveKernelEvent 141`, `0x80263001`, or a black rectangle
where the transparent companion should be:

- Treat it as a Windows GPU driver / DWM desktop composition reset first, not a
  missing model issue.
- Update or roll back the GPU driver and restart Windows if desktop composition
  remains disabled.
- In **Manager > Settings**, turn off **Hardware acceleration**, then fully quit
  and restart Spine Companion. This starts Windows WebView2 with software
  rendering. The app does not switch automatically.
- In **Manager > Diagnostics**, check **GPU rendering** to confirm the current
  configured mode.

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
