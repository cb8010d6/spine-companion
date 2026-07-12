# Spine Companion v0.2.6-rc.1

This release candidate focuses on native desktop interaction reliability and a smaller daily-use surface.

## Changes

- Adds a user-selectable update channel: automatic, stable-only, or prerelease.
- Adds recognizable local vector marks for Codex, Claude, VS Code, Cursor, Gemini, and OpenCode in AI Integrations, with no runtime network dependency.
- Replaces the narrow center-only model hitbox with bounds that cover most of the visible Spine model at every supported scale.
- Streams current model bounds from the renderer while Rust owns cursor enter/leave handling, including an 18px recovery margin and an 80ms leave delay on Windows.
- Moves Tauri Quick Panel blur-to-close behavior into native window focus events. Pinned panels stay open, while native select menus use a short interaction lock.
- Adds Windows tray single-click and double-click behavior: delayed single click toggles Quick Panel; double click opens Manager without also opening the panel.
- Simplifies and localizes the tray menu. Daily actions stay at the top level; diagnostics, GPU recovery, API/config paths, and debug states move under Advanced / Debug.
- Adds `System / Light / Dark` theme selection. System is now the default, reacts to operating-system theme changes, and is shared by Manager, Quick Panel, and the companion window.
- Reduces Quick Panel to a single-screen control surface. Reminders and updates are represented by compact badges instead of full scrolling sections.
- Hides unsupported global-shortcut controls in the Tauri settings UI instead of presenting a control that diagnostics report as unavailable.
- Preserves non-Rust UI settings such as locale and theme when Tauri merges runtime settings.
- Adds Tauri HTTP `GET /config` and `GET /history` endpoints for compatibility with existing local integrations.
- Adds regression tests for model hitbox coverage and system theme resolution.

## Scope

- Tauri remains the recommended runtime; Electron remains legacy.
- The remote model-source catalog and Manager navigation consolidation are planned for a later 0.2.6 release candidate.
- No copyrighted Spine model assets are included.
