# Spine Companion v0.2.3

Stability and interaction release for the Tauri-based desktop companion.

## Highlights

- Fixes installed-build Manager launch behavior and improves tray/Manager window recovery.
- Hides setup/onboarding overlays once Manager is opened or a model is loaded.
- Restores click interaction feedback and returns the character to idle automatically.
- Improves drag behavior: quicker left/right direction changes, running while moving, and idle after drag stop.
- Tightens transparent-window hit testing after scale/tray changes so blank model margins are less likely to block underlying windows.
- Adds Spine preview rendering to the tray quick panel when no static preview image is available.
- Holds the success pose after the full task-completion sequence until the user clicks to return to idle.
- Keeps Electron as the recommended runtime and Tauri as the actively tested release candidate runtime.

## Validation

- `bun run test`
- `bun run check`
- `bun run build`
- `cargo test`
- GitHub Actions Windows package workflow

## Notes

The release does not include copyrighted Spine model assets. Use the Manager to download or import local test assets.
