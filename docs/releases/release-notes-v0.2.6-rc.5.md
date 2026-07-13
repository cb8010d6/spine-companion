# Spine Companion v0.2.6-rc.5

[English](release-notes-v0.2.6-rc.5.md) | [简体中文](release-notes-v0.2.6-rc.5.zh-CN.md)

This candidate consolidates the project on Tauri and expands release packaging
to experimental macOS and Linux previews.

## Highlights

- Retire the untested Electron main process, preload bridge, launcher, preview
  capture, diagnostics, dependencies, and builder configuration.
- Keep the renderer-facing `window.companion` contract while moving standalone
  config and local API code into runtime-neutral `src/backend` modules.
- Make `bun run dev` start Tauri by default and retain `dev:renderer` plus
  `dev:api` for browser debugging.
- Build Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon packages in
  the release workflow. Windows remains primary support; macOS/Linux are
  experimental and macOS artifacts are unsigned.
- Fix remote Spine preview assets returning HTTP 404 because the Axum 0.7 route
  used incompatible dynamic-segment syntax.
- Display a clear model name and ID on every Library card, including a readable
  fallback for third-party entries without a name.
- Improve model-card spacing and replace plain source/download controls with
  compact icon-and-label actions.
- Report page-preview successes and leave failed cards individually retryable.

The v0.2.6 rc.1 through rc.4 Windows installers were already Tauri NSIS builds.
This release removes the dormant Electron source and tooling rather than
changing the Windows package runtime.

## Platform Notes

- Windows 10/11 x64: primary supported NSIS installer.
- Linux x64: experimental AppImage and DEB; tray, transparency, click-through,
  and Wayland/X11 behavior need distribution-specific testing.
- macOS Intel and Apple Silicon: experimental unsigned DMGs. See the deployment
  guide for Gatekeeper steps and apply them only to trusted downloads.

No copyrighted Ark-Models or derived preview assets are included in the release.
