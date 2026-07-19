# Spine Companion v0.2.6-rc.10

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.10.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.10.zh-CN.md)

This release candidate completes the Windows input and model-library work that
followed the rc.9 renderer stabilization.

## Improvements

- Build up to 16 pointer regions from the currently visible Spine attachments.
  Windows consumes those regions in the native pointer monitor, improving
  clicks on small characters while letting transparent gaps pass through.
- Save scale, offsets, and framing per model. Wheel, touch pinch, companion
  controls, and Manager now update the same presentation record without
  carrying one model's layout into the next model.
- Add `Automatic`, `Character focus`, and `Full artwork` framing. Existing users
  retain the previous automatic behavior unless they choose another mode.
- Move model search, paging, installed filtering, preview lookup, and install
  lookup behind the Rust Catalog Store. Preview and install commands accept only
  `sourceId + modelId`; URLs and file manifests are resolved from the validated
  local catalog cache.
- Add official Kimi Code CLI MCP configuration through `~/.kimi/mcp.json`, with
  Kimi-specific source labels, icon, instructions, and diagnostics.
- Report pointer-passthrough capability in diagnostics. Windows reports native
  multi-region support; macOS, Linux X11, and Linux Wayland explicitly report
  the interactive fallback until native implementations pass real-device tests.

## Compatibility

- Windows 10/11 remains the primary supported platform.
- Linux and unsigned macOS packages remain experimental. They keep the companion
  interactive and do not claim transparent-area native passthrough support.
- Hardware acceleration and display-refresh rendering remain the defaults.

## Validation

- 223 JavaScript tests and 100 Rust tests passed. Project checks, MCP checks,
  the frontend build, packaged MCP smoke test, and Windows NSIS build passed.
- Native passthrough on macOS, X11, and Wayland remains a future platform task,
  not an unverified rc.10 claim.
