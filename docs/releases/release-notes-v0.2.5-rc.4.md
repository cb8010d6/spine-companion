# Spine Companion v0.2.5-rc.4

This prerelease completes the first usable Avatar Studio runtime-pack workflow.

## Changes

- Validates avatar IDs, manifest paths, skeleton selection, atlas references, and textures.
- Separates draft avatar packs from runtime-ready Spine exports.
- Installs runtime-ready exports atomically under the local models directory.
- Activates a successful import immediately and hot-reloads the companion renderer.
- Keeps the previous installed model and active model when validation or installation fails.
- Uses the same configuration directory for Manager and MCP avatar imports.
- Adds clear `Install and Use` and `Save Draft Pack` actions in Manager.
- Adds Rust caching to CI and release workflows.

Avatar Studio only imports legal, existing Spine runtime exports. It does not convert a single image into a professional Spine rig.
