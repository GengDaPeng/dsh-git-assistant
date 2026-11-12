# dsh-git-assistant

一个给 DeepSeek Harness（DSH）用的、**克制清爽的 Git 工作台**插件。目标是把编辑器的 Git 面板体验搬进 DSH，让用户不必离开对话去看文件、看改动、切分支、管工作树。

> 状态：**v0.2.0 可用版**。已打通：双入口（左栏 + 对话顶部标签）、仓库/工作树下拉、源代码管理（暂存/取消暂存/丢弃/提交/amend）、文件浏览（树 + 文本/图片预览）、统一/并排 diff + 轻量语法高亮、分支切换/新建、5s 自动刷新。
> 下一步：工作树创建/删除 UI、提交历史图、stash、合并/冲突处理、文件编辑、Markdown 渲染、快捷键（见底部路线图）。

## 两个入口，同一个面板

- **左侧栏入口**：全局图标 → main 面板（`sidebar.panellist` + `main` keyed slot）
- **对话顶部标签**：会话视图标签「Git」，与「对话 / 轨迹 / 上下文」同排（`conversation.view` list slot）

两个座位渲染同一个 `Panel` 组件，按容器宽度自适应布局。

## 目录结构

```
dsh-git-assistant/
├── package.json          # dsh bundle 清单：bundle.patch + client 入口
├── cordis.patch.yml      # 插入插件行
├── icon.svg              # 插件显示图标
├── locale/{zh,en}.json   # 插件管理器里的标题/描述
├── src/
│   ├── index.js          # host 半：/git-assistant/api/* 路由（本地同源校验）
│   └── client.js         # client 半：window.__ModuleLoader__ 单文件 bundle
├── docs/                 # 设计与调研（可选）
└── README.md
```

无构建步骤：host 是 ESM 单文件，client 是手写的 CJS 风格单文件 bundle（只 require `react`，React 由 DSH 注入）。

客户端冒烟测试（Node + react-dom/server，不需要浏览器）：

```sh
npm run smoke   # 或 node scripts/smoke-client.mjs
```

## 安装到本地 DSH

桌面版（profile `desktop`）走 DSH 的插件管理器安装本地目录：

- 在 Harness 的 Plugins 页面选择安装本地插件目录，或使用 `plugin_manager install_bundle`，目标为本仓库路径；
- 安装后刷新页面：左侧栏会出现 **Git** 图标；任意会话的顶部标签栏会出现 **Git** 标签。

## Host API（v0.1.1）

前缀 `/git-assistant/api`，仅接受本机同源请求：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ping` | 健康检查 `{ ok, version }` |
| GET | `/repositories` | DSH Workspace 中的 Git checkout + 每个 linked worktree（repoName / branch / isMain / path） |
| GET | `/status?path=` | `git status --porcelain=v2 --branch` 解析：分支、ahead/behind、staged、unstaged、untracked、conflicted |
| GET | `/branches?path=` | 本地分支列表（name / current / upstream） |
| GET | `/diff?path=&file=&staged=0\|1` | 单文件 unified diff，host 解析为 hunk/行结构（含 untracked 文件的 /dev/null 对比） |
| GET | `/file?path=&file=` | 读取文本文件（≤512 KiB；二进制检测） |
| GET | `/files?path=` | 列出 tracked + untracked（遵守 .gitignore）文件，供文件浏览 |
| GET | `/raw?path=&file=` | 原始字节（图片等预览，≤24 MiB） |
| POST | `/stage` | `{path, files[]}` → `git add` |
| POST | `/unstage` | `{path, files[]}` → `git reset HEAD`（unborn HEAD 时 `git rm --cached`） |
| POST | `/discard` | `{path, files[]}` → tracked `git restore --worktree`；untracked 删除文件 |
| POST | `/commit` | `{path, message, amend}` → `git commit` / `--amend` |
| POST | `/switch` | `{path, branch}` → `git switch` |
| POST | `/branch/create` | `{path, name, from?}` → `git branch` |

安全：只接受 loopback + 同源请求；所有 git 命令 argv 数组、不拼 shell；路径包含校验；破坏性操作由客户端二次确认。

## 路线图

- **v0.1（已完成）**：插件骨架 + 双入口 + 仓库发现 + 布局
- **v0.1（已完成）**：插件骨架 + 双入口 + 仓库发现
- **v0.1.1（已完成）**：真实 Git 数据——仓库/工作树下拉、staged / changes / untracked、分支、逐文件 unified diff、轮询刷新
- **v0.2.0（当前）**：写操作（暂存/取消暂存/丢弃/提交/amend/切分支/新建分支）、文件浏览（树 + 过滤 + 文本/图片预览）、并排 diff、轻量语法高亮、确认弹窗与 toast、客户端冒烟测试
- **v0.2.x（下一步）**：工作树创建/删除 UI、提交历史/提交图、stash、合并与冲突处理
- **v0.3**：文件编辑、Markdown 渲染、文件树懒加载、快捷键、按用户截图逐轮校准视觉
- **后续**：Issue / PR / Discussion 看板（把 GitHub 搬进 DSH 的长期目标）

## 设计原则

视觉语言参考了插件「自媒体工作台」的克制气质（仅借鉴设计语言，未复制其代码）：全部颜色走 DSH 语义 token、卡片式玻璃面板、大圆角、柔和阴影、药丸形控件、三级文字层级、衬线标题点缀、极低饱和的环境光，以及 0.15–0.25s 的柔和过渡。

1. **安静**：单色小图标、弱分隔线、状态字母低饱和着色、hover 才出现操作。
2. **贴近宿主**：颜色/圆角/字号优先沿用 DSH 主题 token（`--dsw-*`），深浅色一致。
3. **两入口一致**：左侧栏与顶部标签永远渲染同一个面板，不做两套 UI。
4. **渐进接入**：先只读，确认视觉后再加写操作；所有破坏性操作必须二次确认。

## 设计/调研文档

- `git-panel-build-plan.md` — 难度评估、工作量拆解、复用清单
- `git-panel-dsh-feasibility.md` — 官方能力盘点、生态候选对比、选型结论
- `research/git-plugin-ecosystem.md`、`research/git-panel-primitives.md` — 生态调研与官方原语证据
