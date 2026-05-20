# Spine Companion v0.2.2

Hotfix for the v0.2.1 Tauri package.

## Fixes

- Fixed Tauri Spine asset URLs for filenames containing `#`, such as
  `build_char_1001_amiya2_sale#16.skel`.
- Added renderer-side URL normalization so stale runtime config cannot send
  unencoded `#` filenames to Pixi.
- Regenerate the public Tauri `assetUrl` from the current `skel` every time
  config is returned, preventing stale unencoded URLs after hot reloads.
- Rewrites `.atlas` texture page filenames when served locally, so entries
  such as `build_char_1001_amiya2_sale#16.png` load as `%2316.png` without
  modifying the local asset files.
- Kept the error/onboarding overlays interactive while the transparent
  companion window is visible, so `Retry` and `Open Manager` remain clickable.
- Kept `assetDir` in the public runtime config so Manager can reliably detect
  the active installed model.
- Disabled automatic click-through activation in Tauri. The previous behavior
  could prevent the window from receiving mouse and wheel events again, which
  made clicking and scroll zoom unreliable.
- Made the tray quick panel behave like a flyout: left-click toggles it,
  right-click hides it before the native menu opens, and blur/Escape closes it.
- Fixed Quick Panel switches so the progress bubble and status panel toggles
  render as compact switches instead of stretching across the row.
- Added real model preview images in Manager and Quick Panel using local asset
  URLs for the active model and remote Ark-Models URLs for catalog previews.
- Added update metadata with a recommended release asset for the current
  platform and architecture.
- Added a Manager update action that opens the recommended GitHub download
  directly when available.

## Verification

- `bun run test`
- `bun run build`
- `bun run check`
- `bun run check:mcp`
- `cargo test`
- `cargo check`
- `bun run tauri:build`
