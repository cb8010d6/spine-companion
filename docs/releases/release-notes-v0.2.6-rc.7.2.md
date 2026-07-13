# Spine Companion v0.2.6-rc.7.2

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.2.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.2.zh-CN.md)

This hotfix repairs the failed rc7.1 build and adds the first explicit desktop
touch-input compatibility pass.

## Fixes

- Restore successful Tauri compilation by keeping model activation results
  consistent across downloads, local activation, and catalog installation.
- Preserve remote catalog metadata when retrying a failed download from the
  Downloads view.
- Normalize JavaScript module files to LF so Windows Vitest can import scripts
  with a shebang consistently.
- Add one-finger and pen dragging, two-finger model scaling, pointer cancellation
  cleanup, and touch gesture suppression on the companion canvas.
- Use larger Manager controls on coarse-pointer devices.
- Keep macOS and Linux companion windows interactive until native dynamic
  transparent hit testing is implemented for those platforms.

Windows remains the primary supported platform. Linux and unsigned macOS builds
remain experimental, and transparent-area click-through is currently limited on
those systems in favor of reliable pointer and touch interaction.
