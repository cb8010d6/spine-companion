# Spine Companion v0.2.5-rc.8

This prerelease closes the clean-install gaps found while testing the actual packaged Windows executable.

## Changes

- Localizes the no-model, asset-load, startup, onboarding, and Manager-opening guidance in the companion window.
- Replaces raw English Rust diagnostics with localized model, shortcut, GPU, TDR, and renderer-state messages.
- Keeps the companion document language and onboarding copy synchronized after a locale change.
- Adds a packaged-executable MCP smoke test that launches `spine-companion.exe --mcp`, lists tools, reports a phase through the live API, verifies the resulting source/state, and restores the previous state.
- Verifies the cloud NSIS package can be extracted and its Tauri executable starts with an isolated configuration directory.
- Adds regression coverage for Chinese clean-install model guidance.

No copyrighted Spine model assets are included. A clean install intentionally starts without a model and guides the user to Manager.
