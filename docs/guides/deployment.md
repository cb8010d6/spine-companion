# Deployment And Startup Guide

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

This guide explains how to run Spine Companion from source, connect local Spine
assets, expose state APIs, and connect the optional Codex MCP bridge.

## 1. Requirements

- Bun 1.3 or newer and Rust stable for source development.
- Git, if you want to clone or contribute.
- A local Spine 3.8-compatible model folder containing `.skel`, `.atlas`, and
  texture files.

The app has been verified with:

- `pixi.js@6.5.10`
- `pixi-spine@3.1.2`
- Spine 3.8 `.skel/.atlas/.png` assets

Linux source builds also need WebKitGTK 4.1, AppIndicator, librsvg, and patchelf.
Ubuntu/Debian example:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

macOS source builds need Xcode Command Line Tools. Packages must be built on the
matching operating system; the GitHub Actions release matrix handles this.

## 2. Easiest Release Startup

Use this path if you only want to run the app.

1. Download the Windows NSIS installer, macOS DMG, Linux AppImage, or Linux DEB
   from the GitHub Release page. Windows is the stable target; macOS and Linux
   packages are unsigned previews.
2. Start the app, open **Manager > Library**, choose a model, and select
   **Download and use**. For an authorized local model, choose **Import local
   .skel**, then manage it from **Library > Installed**.
3. Open **Manager > Settings** to tune scale and position. If no model appears,
   open **Manager > Diagnostics** and confirm the model directory contains a
   compatible skeleton, atlas, and referenced textures.

The app does not ship copyrighted Spine model assets. Your `assetDir` must point
to a local folder containing `.skel`, `.atlas`, and texture files.

The release build also checks this per-user config path:

```text
%APPDATA%\spine-companion\companion.local.json
```

The app also checks for `companion.local.json` next to the executable, but the
per-user config folder is more reliable across reinstall or overwrite updates.

### Configuration layers and write location

The packaged Tauri runtime treats the per-user file as the canonical writable
configuration:

```text
<user-config-dir>/companion.local.json
```

The repository-root, current-working-directory, and executable-directory
`companion.local.json` files are read-only legacy compatibility layers. They are
loaded before the canonical file, so the per-user file always has the highest
priority. Model activation, presentation settings, and other Manager changes
are written only to the canonical file; legacy files are never overwritten.

Relative `spine.assetDir` values are resolved against the directory of the
layer that supplied that value. Manager > Diagnostics shows the canonical write
path and the loaded layers so an override can be traced without exposing
configuration contents or secrets. Active environment override names are shown
there as well, but their values are not included.

The browser/source adapter in `src/backend/config.cjs` mirrors this precedence
for development. It is a development adapter, not a second packaged runtime.

## 3. Upgrade, Uninstall, And Keep Data

Before upgrading or uninstalling, quit Spine Companion and use **Open Config
Folder** to make a backup of the folder if the model or configuration is
important. The install directory and the user data directory are separate.

For an upgrade, install the newer package over the existing installation. The
user configuration, downloaded models, previews, logs, and AI integration
backups are kept in user data; the application version and renderer are
replaced. If a model is not active after the upgrade, open **Manager > Library >
Installed** and set it active again.

v0.2.7 changes the Avatar Job store lock from an age-based marker to an
OS-backed file lock. Quit every v0.2.6 Spine Companion instance before starting
the upgraded app, and do not run old and new versions against the same config
directory at the same time. The `avatar-jobs.lock` file may remain in the user
data folder; its lock is released automatically when the owning process exits.
Avatar job reads and writes wait at most 10 seconds for this lock and return a
busy error if contention persists; no stale marker is deleted.

For an uninstall, use the operating system's normal app removal flow. It removes
the installed application but does not require deleting the user data folder.
Remove that folder manually only after confirming that you no longer need the
models, settings, logs, or backups.

### Restore An AI Configuration

Manager creates a backup before it writes an AI tool configuration. Open
**Manager > AI Integrations**, select the configured tool, and choose **Restore
Previous Config** when a restore is available. The restore creates a safety copy
of the currently replaced file and requires an AI-tool restart. If the target
file was edited after Manager changed it, restore stops rather than overwriting
the newer edit.

## 4. Clone And Install

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

## 5. Add Local Spine Assets

Copyrighted model assets are intentionally not included in the repository.
Choose a local model folder that you have the right to use.

```bash
bun run setup:assets -- <model-folder>
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
bun run setup:assets -- <model-folder> model.skel
```

You can also skip `companion.local.json` and use environment variables:

```bash
set SPINE_ASSET_DIR=<model-folder>
set SPINE_SKEL=model.skel
bun run dev
```

On macOS or Linux:

```bash
export SPINE_ASSET_DIR=<model-folder>
export SPINE_SKEL=model.skel
bun run dev
```

## 6. Start The Desktop App

Run the Tauri desktop application:

```bash
bun run dev
```

This starts Vite through Tauri's `beforeDevCommand`, the native desktop windows,
and the Rust local API at `http://127.0.0.1:17388`. The window is frameless,
transparent, always-on-top, draggable, and supports wheel scaling.

The explicit alias is equivalent:

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

## 7. Browser Preview Mode

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

## 8. State API

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

Event stream:

- SSE: `GET /events`

The packaged API contract is HTTP plus SSE. State, reminders, and recent history
are in-memory for the current application session and reset when the app exits.

## 9. AI / MCP Integrations

The MCP bridge lets AI tools read and update the companion through the local API.
For installed Tauri builds, open **Manager > AI Integrations** and configure the
detected tool from there. The manager writes a stable executable-based MCP entry
and creates a backup before changing a config file.

Installed Tauri entry shape:

```toml
[mcp_servers.spine_companion]
command = "<install-dir>/spine-companion.exe"
args = ["--mcp"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

Source workflow fallback for Codex:

```bash
bun run mcp:install:codex
```

This appends the following shape to `~/.codex/config.toml`:

```toml
[mcp_servers.spine_companion]
command = "bun"
args = ["<repo-root>/scripts/mcp-companion-server.mjs"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

Restart Codex or open a new session after installing. Existing sessions usually
do not hot-load newly added MCP servers.

MCP tools:

- `companion_get_state`
- `companion_set_state`
- `companion_reminder`
- `companion_report_ai_phase`
- `companion_report_codex_phase`
- `companion_get_diagnostics`
- `companion_test_bridge`

The desktop app or `bun run dev:api` must be running before the MCP tools can
reach the companion.

## 10. One-Click Codex Plugin

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

## 11. Build And Checks

Run project checks:

```bash
bun run check
bun run check:mcp
bun run build
```

`bun run build` builds the renderer into `dist/`. Packaging an installer is not
required for normal development.

Build a package on the current operating system:

```bash
bun run release:win    # Windows NSIS
bun run release:mac    # macOS app + DMG
bun run release:linux  # Linux DEB + AppImage
```

Tauri writes native packages under `src-tauri/target/release/bundle/`. Native
packages are built on their matching operating system; use GitHub Actions for
the full platform matrix.

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

## 12. Troubleshooting

### The app says the Spine asset is missing

Run:

```bash
bun run setup:assets -- <model-folder>
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

If Manager shows a failed integration, open **Manager > AI Integrations** and
use **Restore Previous Config** before trying again. A restore is refused when
the target file changed after Manager's backup; inspect the file manually and
keep the newest intentional edit.

### The local API is unavailable

Confirm Spine Companion is running, then open **Manager > Diagnostics** and
check the local API status. A port conflict or a security product blocking the
application can prevent startup. Do not expose the local API beyond localhost.

The installed executable also provides read-only checks that do not open a
window or change companion state:

```powershell
& "<install-dir>/Spine Companion.exe" --status --json
& "<install-dir>/Spine Companion.exe" --doctor --json
```

They return exit code `0` when the local bridge is healthy, `2` when the bridge
is unavailable, and `1` for an invalid command or internal error.

### State or reminders disappeared after restart

This is expected: state, reminders, and recent history are session-only. Model
files, settings, and AI configuration backups are the data intended to survive
an application restart or upgrade.

### macOS arm64 app cannot be opened

Unsigned macOS artifacts from GitHub Actions can be blocked by Gatekeeper,
especially on Apple Silicon. Only use these steps for artifacts downloaded from
a release you trust.

Option 1: use Finder:

1. Move `Spine Companion.app` to the system Applications folder.
2. Right-click the app and choose **Open**.
3. In the warning dialog, choose **Open** again.

Option 2: remove the quarantine flag in Terminal:

```bash
xattr -dr com.apple.quarantine "<path-to-Spine Companion.app>"
open "<path-to-Spine Companion.app>"
```

Official signing and notarization are deferred. For public signed macOS
releases, configure repository secrets such as `MACOS_CERTIFICATE`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`, and `APPLE_TEAM_ID`.

### The model changes size between animations

The renderer samples mapped animations at startup and uses a stable frame. Tune
these values in `companion.config.json`:

- `spine.scale`
- `spine.framePadding`
- `spine.stageBottomInset`
- `spine.fitStates`
- `spine.mixDurationMs`

## 13. Open-Source Safety Checklist

Before pushing or publishing:

- Confirm `companion.local.json` is not staged.
- Confirm no `.skel`, `.atlas`, or texture files are staged.
- Confirm `local-assets/`, `dist/`, `out/`, and `node_modules/` are not staged.
- Run `bun run check`, `bun run check:mcp`, and `bun run build`.
- Run the release preflight with the exact version tag before packaging.
