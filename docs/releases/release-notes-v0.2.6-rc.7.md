# Spine Companion v0.2.6-rc.7

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.zh-CN.md)

This candidate expands Ark-Models coverage while making long-running Manager
and renderer behavior more deterministic.

## Highlights

- Add three lazily loaded Ark-Models catalogs: 909 base operators, 88 dynamic
  illustrations, and 1,913 enemies. No third-party model assets are bundled.
- Label every model as full companion, display-only, or experimental. Dynamic
  illustrations and enemies show a clear warning before download.
- Fall back to Idle, Default, or the first available animation when a model
  lacks Relax, Move, Interact, Sit, Sleep, or Special.
- Pin metadata-only catalogs to an immutable upstream commit and verify downloads
  with Git blob digests without mirroring copyrighted assets.
- Prevent slow Manager views from overwriting a newer navigation target.
- Patch only the affected model card during download progress; keep previews,
  keyboard focus, filters, and pagination stable. Refresh totals on completion.
- Preserve companion window position, size, and hidden state during native
  renderer recovery.
- Suspend JavaScript health recovery while hidden and apply a resume grace
  period after sleep or visibility changes.

Windows remains the primary supported platform. Linux and unsigned macOS builds
remain experimental.
