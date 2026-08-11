# Contributing

Thank you for improving Spine Companion. Keep changes focused and do not commit
copyrighted model assets, credentials, generated installers, or local config.

## Development

Requirements: Bun 1.3.13 or newer, Rust stable for Tauri work, and Git.

```bash
bun install
bun run dev
```

Use the Manager UI for local model setup when possible. For source-only model
testing, keep assets outside tracked files or under the ignored `local-assets/`
directory.

## Checks

Run the focused checks relevant to your change, then the release-safe baseline:

```bash
bun run test
bun run check
bun run check:mcp
bun run build
```

Tauri changes should also pass `cargo test` and `cargo check` from `src-tauri/`.
Release changes should run the preflight with the exact release tag. Native
install and uninstall behavior is verified on the matching operating system.

## Pull Requests

- Explain the user-visible behavior and the validation performed.
- Add or update focused tests for behavior changes.
- Keep public docs free of machine-specific absolute paths.
- Keep product version changes and `THIRD_PARTY_NOTICES.md` changes in their
  separately reviewed work.
- Do not push directly to the main repository or include secrets in examples.
