# Remote Catalog

`catalog.json` is generated metadata for approved remote sources. It contains
repository provenance, file sizes, Git blob identifiers, immutable download
URLs, and SHA-256 digests. It never contains `.skel`, `.atlas`, or texture
files.

Generate the Ark-Models catalog at build or release preparation time:

```powershell
bun scripts/generate-ark-catalog.mjs
```

Use `--validate` for a no-network check of the committed document:

```powershell
bun scripts/generate-ark-catalog.mjs --validate
```

Use `--check` in CI to require that the committed document matches a fresh
deterministic scan:

```powershell
bun scripts/generate-ark-catalog.mjs --check
```

The generator resolves the configured branch to a full Git commit SHA before
reading the GitHub tree. It scans only direct model folders under `models/` and,
when `includeDirectories` is set, publishes only the explicitly reviewed
folders. Without that optional filter it reviews every direct model folder.
Each published folder requires exactly one `.skel`, at least one
`.atlas`, and at least one texture. The generator downloads those runtime files
in memory to calculate SHA-256 and detects the runtime version from the `.skel`
header. Invalid, unreadable, or incompatible folders are recorded in
`skippedModels` without blocking valid entries. The output URLs and their
jsDelivr fallback are pinned to that commit.
Runtime code consumes `catalog.json`; it must not scan a remote repository tree.

`ark-source.json` declares the upstream owner, author, unverified license
status, explicit redistribution warning, and the Spine runtime range. Update
that review data before regenerating when upstream terms change. `schema.json`
documents the generated JSON contract; `validateCatalog` in the generator is
the dependency-free build-time validator used by the focused test suite.

Third-party model files are copyrighted material. Do not add downloaded model
binaries to this repository, application resources, or public release assets.
