# Avatar Studio

[English](avatar-studio.md) | [简体中文](avatar-studio.zh-CN.md)

Avatar Studio 是实验中的形象制作工作流，用来把用户自己拥有版权或使用权的角色设计转换为
Spine Companion 本地模型。它不是承诺“一张平面图一定能自动变成专业 Spine rig”。

## 产品形态

- 推荐输入：分层 PSD，或已经拆好的 PNG 图层文件夹。
- 草稿输入：单张角色图，由外部 AI 工具拆成可编辑的候选图层。
- Companion 负责：校验、预览、导入和记录 avatar pack。
- 外部工具负责：图像生成、拆层、骨骼草稿、动作草稿，以及可选的 Spine Editor 导出。

Spine Companion 仍然只在本地做高帧渲染。AI 工具应该产出文件和进度事件，不应该直接参与
Companion 的实时渲染循环。

## Avatar Pack

生成结果应写入一个本地文件夹，结构如下：

```text
avatar-pack.json
preview.png
layers/
rig/
exports/
```

`avatar-pack.json` 应包含：

- `id`、`name`、`source` 和 `licenseNote`
- `preview` 路径
- `layers` 列表，使用稳定命名，例如 `head`、`hair_back`、`body`、
  `arm_left`、`arm_right`、`leg_left`、`leg_right`
- `motions` 映射，覆盖 `idle`、`working`、`reviewing`、`running`、`success`、
  `failed`、`waiting`、`sleeping`、`reminder` 和 `interact`
- 可选 `exports`，指向 `.skel`、`.atlas` 和贴图 `.png`

avatar pack 属于用户本地内容。生成或上传的角色素材不得提交到本仓库。

## 当前编辑器

Manager 现在可以创建标准包，导入 PNG/JPEG/WebP 图层，调整图层顺序和显隐，编辑锚点、
偏移、缩放和裁切，实时预览组合结果，编辑状态到动作名称的映射，并从校验问题直接定位到
对应字段。形象包还可以复制、重新打包，或在二次确认后删除。

如果形象包包含有效的 Spine 3.8 runtime 导出，点击“安装并使用”会开始一次由原生后端
管理的临时试穿。选择“保留形象”确认使用，选择“恢复之前角色”返回原模型；直接关闭确认框
也会恢复之前角色。

## 实验性 MCP 接口

以下接口已作为实验性契约提供，可供 Codex 或其他 AI 工具对接：

- `companion_avatar_requirements`
- `companion_create_avatar_job`
- `companion_update_avatar_job`
- `companion_list_avatar_jobs`
- `companion_get_avatar_job`
- `companion_validate_avatar_pack`
- `companion_import_avatar_pack`

Codex 应按阶段汇报进度：角色提示词、拆层、骨骼草稿、动作草稿、Spine 导出、校验和导入。
如果本机没有安装 Spine Editor，Codex 仍可创建 avatar pack，但不能声称已经完成最终
`.skel/.atlas/.png` runtime 导出。

Avatar Job 会以受限的“规划/进度记录”保存到应用用户配置目录，重启应用后仍可读取，
并保留一段有限的更新历史，方便 AI 工具明确读取上下文后继续规划。`resumable` 只表示
记录可以提供继续工作的上下文，不会自动启动任务、调用 AI、自动拆层绑骨，或导出 Spine
文件。Job ID 和可选的 `packPath` 会经过校验，记录和历史数量也有上限，避免配置文件无限增长。
Job 仍必须先校验并导入为本地 avatar pack，才可能影响桌宠模型。

## Spine Editor 依赖

Spine runtime 资产需要 Spine Editor 或其他合法导出路径。后续当用户配置了本地 Spine
Editor CLI 路径时，工作流可以把 runtime 文件导出到 `exports/`。没有 Spine Editor 时，
Companion 只能导入已有 runtime 资产，或校验中间 avatar pack。

