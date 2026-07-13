# Spine Companion v0.2.6-rc.7.1

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.1.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.1.zh-CN.md)

This rc7 hotfix focuses on making the Model Library dependable with the full
Ark-Models catalog and improving renderer recovery after sleep or long stalls.

## Highlights

- Load and cache each enabled model source independently, preserve the selected
  source across renders, and prevent stale requests from replacing newer views.
- Show 12 models per page and limit bulk previews to 6 models with bounded
  concurrency, a large-download confirmation, and a 256 MB native preview cache.
- Download models without silently switching the active companion. Installed
  counts and card actions now update immediately after a completed install.
- Verify binary Spine headers for all generated illustration and enemy entries.
  All 88 illustrations report 3.8.99; 1,892 enemies report 3.8.99 and 21 report
  3.8.84. Legacy labels such as `Spine 3.8` are displayed without duplication.
- Use token-aware, case-insensitive animation fallback for names such as
  `A_Idle`, `C1_Idle`, and `Move_Loop`, while avoiding attack or other unsafe
  animations as idle fallbacks.
- Improve the renderer watchdog around startup, hidden windows, sleep/resume,
  and WebView replacement so a stalled animation can recover without a loop.
- Keep official catalog sources disable-only, localize source state labels, and
  hide the legacy onboarding fixture from normal Library results.

A deterministic 1% audit parsed 29 of 2,909 catalog models successfully. The
sample covered 9 operators, 1 dynamic illustration, and 19 enemies with no
download, digest, or parse failures. Six sampled operators had the standard six
companion motions but no `Special`; the illustration had `Idle`, `Interact`, and
`Special`; four sampled enemies had five combat motions. These are source-model
capability differences rather than damaged downloads.

Windows remains the primary supported platform. Linux and unsigned macOS builds
remain experimental.
