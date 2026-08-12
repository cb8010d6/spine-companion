## Summary

<!-- Describe the user-visible change and the main files or boundaries involved. -->

## Validation

- [ ] `bun run test`
- [ ] `bun run check`
- [ ] `bun run check:mcp`
- [ ] `bun run build`
- [ ] Tauri `cargo test` / `cargo check`, when applicable
- [ ] Matching-platform install or uninstall behavior reviewed, when applicable

## Release and privacy checks

- [ ] No product version change unless this PR is explicitly a version PR
- [ ] No changes to `THIRD_PARTY_NOTICES.md` unless this PR is explicitly its owner
- [ ] No copyrighted model assets, secrets, or unredacted diagnostics added
- [ ] Public docs contain no machine-specific absolute paths
- [ ] Release workflow changes preserve exact-tag, version, notes, checksum, and
      packaged-smoke gates
