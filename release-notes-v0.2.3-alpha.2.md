# Spine Companion v0.2.3-alpha.2

Prerelease for Windows tester builds from `develop`.

## Fixes

- Validate local Spine imports before saving configuration. A selected `.skel` folder must include at least one `.atlas` and one `.png` texture.
- Show a clear import failure message instead of leaving the renderer to fail later.
- Keep the companion window position and size across restarts.
- Add `ui.autoRevealOnMcp` so Codex MCP state updates can auto-show the companion without overriding users who disable it.
- Handle renderer hot-reload failures by showing the normal model error card instead of silently breaking.
- Close active SSE clients when the local state server shuts down.

## Notes

- This prerelease only publishes the small Windows installer asset.
- Copyrighted Spine model files are still not included in the repository or release artifacts.
