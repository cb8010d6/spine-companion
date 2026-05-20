# Spine Companion v0.2.0

## Features
- **Manager Window**: Added a dedicated management window accessible from the tray menu.
- **Model Catalog**: Easily browse and download compatible spine models directly from the UI without restarting.
- **Settings UI**: Configure scale, position offsets, and bubble styling seamlessly through the manager.
- **Diagnostics Panel**: View local API health, MCP bridge status, and path directories.
- **Tray Quick Controls**: Restored practical native tray actions for companion visibility, bubble/status toggles, state shortcuts, diagnostics, config folder, and local API.
- **Quick Panel**: Added a compact tray panel that reads real companion state and MCP/API diagnostics instead of static placeholders.
- **Electron & Tauri Support**: Fully backward-compatible while primarily focusing on Tauri v2.

## Assets
- The repository continues to prioritize strict copyright compliance. Downloaded models are placed in the `companion.local.json` directory which is gitignored.

## Developer
- New internal event `companion:model-imported` and `companion:save-settings`.
- Replaced `rollup` simple logic with explicit Vite entries for the newly created `manager.html`.
- Added focused tests for UI settings normalization, MCP diagnostics paths, and native tray menu coverage.
