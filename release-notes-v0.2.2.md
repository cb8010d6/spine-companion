# Spine Companion v0.2.2

Hotfix for the v0.2.1 Tauri package.

## Fixes

- Fixed Tauri Spine asset URLs for filenames containing `#`, such as
  `build_char_1001_amiya2_sale#16.skel`.
- Kept `assetDir` in the public runtime config so Manager can reliably detect
  the active installed model.
- Disabled automatic click-through activation in Tauri. The previous behavior
  could prevent the window from receiving mouse and wheel events again, which
  made clicking and scroll zoom unreliable.
- Added update metadata with a recommended release asset for the current
  platform and architecture.
- Added a Manager update action that opens the recommended GitHub download
  directly when available.

## Verification

- `bun run test`
- `bun run build`
- `cargo test`
