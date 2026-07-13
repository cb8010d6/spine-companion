# Spine Companion v0.2.6-rc.3

This prerelease completes the first usable Avatar Studio workflow and replaces
the one-model Library fixture with a generated, integrity-checked remote model
catalog. It remains a Windows/Tauri release candidate.

## Highlights

- Avatar Studio now creates, edits, validates, duplicates, repacks, deletes,
  and imports versioned avatar packs.
- The layer editor supports ordering, visibility, anchor, offset, scale, exact
  crop preview, action mapping, and issue-to-field navigation.
- Runtime-ready packs can be tried on temporarily. Keeping, restoring, or
  dismissing the confirmation resolves the native trial session safely.
- Library sources use commit-pinned catalog metadata, SHA-256 verification,
  Spine 3.8 compatibility checks, ETag caching, offline fallback, independent
  source errors, search, source enable/disable controls, and pagination.
- The Ark-Models generator reviews every direct model folder and records
  malformed or incompatible folders without blocking valid entries.
- Bundled integration icon assets now render correctly; custom integrations
  can use a local icon and color without accepting remote image URLs.

## Asset and licensing notice

No Ark-Models or Arknights model binaries are included in this repository or
installer. The catalog contains metadata and pinned download URLs only. Review
the upstream source terms and obtain the necessary rights before downloading,
using, or redistributing third-party assets.

## Verification

- Bun project checks and Vitest suite
- MCP bridge self-check
- Vite production build
- Rust formatting, checks, and tests
- Tauri Windows installer build
- Manager visual checks at desktop and 800x600 layouts
