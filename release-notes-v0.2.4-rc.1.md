# Spine Companion v0.2.4-rc.1

Prerelease build for testing scaled interaction fixes.

## Changes

- Tightens the interactive hitbox when the character is scaled down.
- Fixes drag distance drift on high-DPI Windows displays.
- Hides the progress bubble while dragging the character.
- Moves and scales the progress bubble more aggressively for tiny character sizes to reduce head overlap.

## Validation

- `bun run test`
- `bun run check`
- `bun run build`
- `cargo test`
