# Spine Companion v0.2.6-rc.4

This Windows/Tauri release candidate fixes the remote catalog and download
flow and adds safe, on-demand model preview caching. The app does not download
the whole catalog at startup and does not bundle third-party models or derived
thumbnails.

## Highlights

- Fixed Manager handling of Tauri's flattened catalog entries, restoring model
  names, sources, Spine versions, and the correct remote download path.
- Added model-source selection and live search by model name or ID.
- Added per-model preview and "Preview this page". A page contains at most 24
  models and preview generation is limited to three concurrent tasks.
- Preview assets are downloaded and SHA-256 verified by the Rust backend, then
  served to the Spine runtime through the localhost API. The WebView does not
  fetch remote model assets directly.
- Rendered thumbnails remain local, expire when catalog file signatures change,
  and are capped at 48 asset sets and 80 still images.
- Installed models prefer real catalog or `.companion-model.json` names instead
  of showing only legacy directory IDs.
- Corrected ChatGPT/Codex, VS Code, Antigravity, and OpenCode integration icons;
  Antigravity is now distinct from Gemini.
- Tauri CI and release workflows skip legacy Electron binary downloads.

## Asset and licensing notice

No Ark-Models or Arknights model files are included in the repository or
installer, and no derived model thumbnails are committed. Third-party assets
are stored locally only after an explicit preview or download action. Review
the upstream terms before use or redistribution.

## Verification

- 171 Vitest tests
- 70 Rust tests
- Bun project check and MCP bridge check
- Vite production build
- Tauri Windows NSIS installer build
- GitHub `Check` and `Tauri check`
