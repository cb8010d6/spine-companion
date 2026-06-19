# Avatar Studio Plan

[English](avatar-studio.md) | [简体中文](avatar-studio.zh-CN.md)

Avatar Studio is the planned workflow for turning a user-owned character design
into a local Spine Companion model. It is not a promise that one flat image can
always become a production-quality Spine rig automatically.

## Product Shape

- Preferred input: layered PSD or a folder of separated PNG layers.
- Supported draft input: one flat character image, processed by an external AI
  tool into editable layer candidates.
- Companion responsibility: validate, preview, import, and track generated
  avatar packs.
- External tool responsibility: image generation, layer separation, rig draft,
  animation draft, and optional Spine Editor export.

Spine Companion will keep the final high-frame rendering local. AI tools should
produce files and progress events, not render frames in the companion process.

## Avatar Pack

Generated assets should be written to a local folder with this layout:

```text
avatar-pack.json
preview.png
layers/
rig/
exports/
```

`avatar-pack.json` should include:

- `id`, `name`, `source`, and `licenseNote`
- `preview` path
- `layers` list with stable names such as `head`, `hair_back`, `body`,
  `arm_left`, `arm_right`, `leg_left`, `leg_right`
- `motions` mapping for `idle`, `working`, `reviewing`, `running`, `success`,
  `failed`, `waiting`, `sleeping`, `reminder`, and `interact`
- optional `exports` entries for `.skel`, `.atlas`, and texture `.png`

The pack is local user content. Generated or uploaded character assets must not
be committed to this repository.

## Experimental MCP Interfaces

These interfaces are available as an experimental contract for Codex or another
AI tool:

- `companion_avatar_requirements`
- `companion_create_avatar_job`
- `companion_update_avatar_job`
- `companion_validate_avatar_pack`
- `companion_import_avatar_pack`

Codex should report progress in visible phases: character prompt, layer split,
rig draft, motion draft, Spine export, validation, and import. If Spine Editor is
not installed, Codex may still create an avatar pack, but it must not claim that
the final `.skel/.atlas/.png` runtime export is complete.

## Spine Editor Dependency

Spine runtime assets require Spine Editor or an equivalent legal export path.
When a local Spine Editor CLI path is configured, the future workflow can export
runtime files into `exports/`. Without it, Companion can only import existing
runtime assets or validate an intermediate avatar pack.

