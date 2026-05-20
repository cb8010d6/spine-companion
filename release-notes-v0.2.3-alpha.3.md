# Spine Companion v0.2.3-alpha.3

Windows prerelease from `develop`.

## Fixes

- Fix update checks for prerelease builds. Alpha/beta/rc versions now query the prerelease channel instead of GitHub's stable-only `latest` endpoint.
- Compare semantic prerelease versions correctly, so `0.2.3-alpha.2` is newer than `0.2.3-alpha.1` and both are newer than `0.2.2`.

## Cleanup

- Add Vite manual chunks for the Pixi/Spine runtime and Tauri API bridge.
- Expand Manager i18n coverage for common actions, settings, diagnostics, and update labels.
- Start converging Manager and Quick Panel colors onto the shared design tokens.
