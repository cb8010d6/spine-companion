# Spine Companion v0.2.6-rc.2

This release candidate improves Manager discoverability, avatar-pack workflows, model browsing, and Windows tray behavior.

## Changes

- Adds an always-visible language selector to the Manager top bar with System, English, and Chinese options. Language changes apply immediately to the current page and navigation.
- Fixes Windows tray behavior so a left click opens only Quick Panel instead of also opening the native context menu.
- Keeps the Windows tray double-click shortcut: a double click cancels the pending panel action and opens Manager.
- Rebuilds Avatar Studio around a clear choose, validate, and save/install workflow. The path field and action controls now remain separate at compact window sizes.
- Adds a native folder picker for avatar packs and lists registered local packs with open-folder and revalidate actions.
- Shows avatar-pack readiness for preview art, editable layers, and a usable Spine runtime export.
- Expands Library with All, Installed, and Available filters, catalog summaries, compatibility and license badges, source links, and clearer empty states.
- Fixes Manager sidebar branding at compact widths so the product name wraps instead of being truncated.
- Adds regression coverage for the Tauri tray click contract.

## Scope

- Tauri remains the recommended runtime; Electron remains legacy.
- Avatar Studio validates and manages user-owned packs. It does not claim to generate a professional Spine rig from a single image.
- A remote multi-source model catalog with caching and integrity verification remains planned for a later release candidate.
- No copyrighted Spine model assets are included.

## Verification

- 152 JavaScript tests pass.
- 64 Rust tests pass.
- Project checks, MCP self-check, renderer build, and Windows Tauri installer build pass.
