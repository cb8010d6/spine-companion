# Integration icon sources

The SVG files in this directory are locally bundled copies of upstream product
assets. They are not generated brand marks. The model exposes their local Vite
URLs as `image` metadata; the existing manager remains limited to one tinted
24px path and therefore uses a neutral fallback until it can render full SVG
images.

| Asset | Upstream source | License / terms |
| --- | --- | --- |
| `cursor.svg` | https://www.cursor.com/marketing-static/favicon.svg | Cursor-hosted brand asset. No open-source license was published with the asset; use remains subject to Cursor's terms. |
| `opencode.svg` | https://github.com/anomalyco/opencode/blob/dev/packages/web/src/assets/logo-dark.svg | MIT, https://github.com/anomalyco/opencode/blob/dev/LICENSE |
| `roo-code.svg` | https://github.com/RooVetGit/Roo-Code/blob/main/src/assets/icons/icon.svg | Apache-2.0, https://github.com/RooVetGit/Roo-Code/blob/main/LICENSE |
| `cline.svg` | https://github.com/cline/cline/blob/main/apps/vscode/assets/icons/icon.svg | Apache-2.0, https://github.com/cline/cline/blob/main/LICENSE |
| `openai.svg` | https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/openai-docs/assets/openai-small.svg | Apache-2.0, https://github.com/openai/codex/blob/main/LICENSE |
| `vscode.svg` | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/media/code-icon.svg | MIT, https://github.com/microsoft/vscode/blob/main/LICENSE.txt |
| `gemini.png` | https://github.com/google-gemini/gemini-cli/blob/main/packages/vscode-ide-companion/assets/icon.png | Apache-2.0, https://github.com/google-gemini/gemini-cli/blob/main/LICENSE |
| `anthropic.svg` | https://github.com/simple-icons/simple-icons/blob/develop/icons/anthropic.svg | Simple Icons CC0-1.0 data; Anthropic trademarks remain subject to their owner. |
| `mimocode.svg` | https://github.com/simple-icons/simple-icons/blob/develop/icons/xiaomi.svg | Simple Icons CC0-1.0 data; Xiaomi trademarks remain subject to their owner. |

The OpenAI/Codex, VS Code, and Gemini assets come from their public upstream
repositories. Anthropic and Xiaomi/MiMoCode use the community-maintained Simple
Icons vectors because their checked public repositories did not expose a
redistributable product icon. Product names and logos remain trademarks of
their respective owners and do not imply endorsement.
