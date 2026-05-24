# Spine Companion v0.2.4-rc.2

Second prerelease build for scaled interaction and animation polish.

## Changes

- Further tightens the upper transparent hitbox when the character is scaled down.
- Suppresses the progress bubble for direct character clicks while keeping the click interaction animation.
- Keeps working/running task bubbles active when the character is clicked.
- Uses the relaxed idle/working pose for AI running states; the Move animation is now reserved for actual window dragging.
- Keeps the progress bubble away from the visible character body when the model is tiny.
- Keeps the review/waving segment active by replaying it with mixed re-entry, avoiding the hard first-frame jump from native segment looping.
- Plays the full success sequence once, then loops the success tail segment so the mounted/riding portion can remain active until dismissed.

## Validation

- `bun run test`
- `bun run check`
- `bun run build`
- `cargo test`
