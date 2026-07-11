# Spine Companion v0.2.5

Spine Companion v0.2.5 is the first stable release of the Tauri-first desktop companion workflow. It combines the AI integration setup, runtime diagnostics, local avatar-pack workflow, clean-install guidance, and Manager polish developed across the 0.2.5 release candidates.

## Highlights

- **AI Integrations:** detect supported clients, configure MCP with backups, install managed agent instructions, test the live bridge, show the real AI source label, and recover safely from failed or interrupted configuration updates.
- **Manager Dashboard:** see the current model, AI source, bridge/API health, reminders, updates, and renderer health from one ordinary-user dashboard.
- **Avatar Studio:** validate and import user-owned avatar packs, distinguish drafts from runtime-ready Spine exports, install runtime assets atomically, and keep the previous model when validation fails.
- **Runtime resilience:** keep the companion window protected from accidental maximize/fullscreen behavior, expose GPU/WebView diagnostics and renderer recovery actions, and preserve hardware acceleration by default.
- **Clean installation:** localized no-model onboarding, asset-load errors, startup errors, diagnostics, and packaged MCP verification. Copyrighted Spine model assets are not included.
- **Desktop polish:** consistent Lucide navigation icons, a new original app mark, improved Manager controls and themes, branded Windows NSIS artwork, and English/Simplified Chinese installer support.

## Runtime and compatibility

- Tauri is the recommended runtime.
- Electron remains legacy and receives no new feature development.
- Spine 3.8 assets remain supported through the existing Pixi 6 / Spine 3.8 runtime.
- Hardware acceleration stays enabled by default. Users can disable it manually from compatibility settings when required by a local driver environment.
- macOS packages are unsigned. Follow the macOS opening instructions in the deployment documentation when Gatekeeper blocks a trusted build.

## Privacy and assets

- No Ark-Models, Arknights, or other copyrighted character assets are included in the repository or release packages.
- AI client configuration changes are confirmed before writing, backed up, and exposed with restore/diagnostic paths.

## Validation

- Bun tests, project checks, MCP checks, Rust tests, Tauri builds, packaged MCP smoke tests, and Windows NSIS packaging passed during the release-candidate cycle.
