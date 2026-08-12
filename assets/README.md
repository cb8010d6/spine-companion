# Assets

[English](README.md) | [简体中文](README.zh-CN.md)

This repository intentionally does not include commercial or game model assets.

For local testing, place a Spine 3.8 compatible model folder outside the repository
or under ignored `local-assets/`, then run:

```bash
bun run setup:assets -- <model-folder>
```

The folder should contain the `.skel`, `.atlas`, and `.png` files referenced by
the atlas. The setup script writes `companion.local.json`, which is ignored by git.
