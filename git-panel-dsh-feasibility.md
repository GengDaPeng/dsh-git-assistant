# 把「Zed 式 Git 面板」做进 DeepSeek Harness：可行性结论

- 日期：2026-11-12
- 环境：DeepSeek Harness Desktop **0.2.2-rc.1**（profile `desktop`，GUI `http://127.0.0.1:55708`）
- 需求（用户原话归纳）：侧边栏一个 Git 插件，可选本地不同仓库；左侧显示该仓库下所有工作树与分支；选工作树/分支后看未暂存与暂存文件；点文件在右侧看改动；也能浏览仓库文件，不必离开 DSH 去看编辑器。
- 研究方式：官方 0.2.2-rc.1 逐包核对（app.asar 内 66 个官方 `dsh-client-ui-*` 包）+ 本机 profile/服务实测 + npm 生态 30+ 个 Git 插件调研（详见 `research/git-plugin-ecosystem.md`、`research/git-panel-primitives.md`）。未安装任何新插件、未改 profile。

## 结论

**完全可行。但结论是「先拿现成的，不要从零写」：**

- 生态里已经有 20+ 个 Git 面板插件；最接近你截图（Zed Git 面板）的是 **`dsh-ide-git@0.32.0`**，右栏/主对话区两种座位、覆盖 6/7 需求，且是唯一在声明上精确覆盖当前 DSH `>=0.2.2-rc.1` 的完整面板（MIT，79 个版本/8 周，活跃）。
- 它缺的「仓库文件浏览」DSH 官方自己就有：会话右栏的 **Files** 页 + 文档预览（代码/Markdown/图片/PDF/Office）已随宿主发布；两者在右侧栏并排使用，就是你说的「不离开 DSH 看文件/看改动」。
- 官方**没有**仓库级 Git 面板（66 个官方 client-ui 包里没有任何 git/source-control 面板包）；但官方有可复用的「积木」（见下）。所谓「官方有 Git 插件」的记忆，对应的是官方 experimental forge / workspace-changes / worktree 这些能力，不是完整面板。

**推荐落地顺序**

1. **先装 `dsh-ide-git` 试用**（0 代码，几分钟）：出现 DSH 原生右侧栏的 Git 胶囊 → 分支树 + 工作树视图 + 提交图谱 + 暂存/未暂存 + diff + 提交/amend；输入框有仓库/分支胶囊；仓库切换器支持输入绝对路径打开工作区外仓库；文件浏览用官方右栏 Files 页。
2. 想要「底部工作台 + 右侧栏 + 主对话区 Git 标签」三合一，再叠官方生态里的 **`dsh-better-sidebar`**（可选底座，MIT，5087★，dsh-ide-git 原生适配）。
3. 只有「必须单插件闭环（含文件浏览）」或「必须自有代码所有权/Zed 精确布局」时，才 fork `dsh-ide-git`（MIT）加一个 FilesTab——复用官方 `sidebar.files.tree` Factory 与 `workspaceFiles` remote，增量不大，但上游 8 周发 79 版，长期要持续 rebase。
4. **不建议从零重写**：Git plumbing + 三栏 UI + diff 渲染 + 写操作安全围栏，从零约 2–3 周，且长期维护成本高于采用。

## 官方 0.2.2-rc.1 已有的可复用能力（“很多能力 DSH 本身有”——属实）

| 能力 | 官方包 | 现状 |
|---|---|---|
| 文件浏览 + 预览（代码/MD/图片/PDF/Office/HTML） | `ui-sidebar-files` + `ui-sidebar-documentpreview` | 已随桌面版启用；会话右栏 Files 页（Mod+P），`dsh-resource://file/session/<id>/<path>` |
| 每轮改动的文件 + diff 审查 | `dsh-workspace-changes` + `ui-deliverables` | 已启用：对话末尾 changed-files 卡片，点开右栏 `changes-review` tab（统一/并排 diff、行号、高亮、5k 行上限） |
| 只读本地 Git 改动/diff（Branch/Uncommitted/Unstaged/Staged 四种范围） | experimental forge bundle | **本机已启用**：会话右栏 Local changes / Changes view，只读，无 staging/commit |
| 新建会话可选 worktree + 模型 worktree 工具 | `dsh-experimental-worktree` / `-tool-worktree` | 已启用；`ctx.worktrees.create/restore`，`.agents/worktrees/` 下创建 |
| 目录选择 / Workspace 注册 / 读文件 / 跑 git | `ctx.directoryPicker`、`workspaceRegistry`、`workspaceFiles`、`ctx.subprocess` | host 服务均在；client↔host 用认证的 `ctx.connection.fetch.register` 路由（裸 `webServer` 路由无鉴权） |
| 右侧栏自有 tab 类型 | `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` | 公开 API，第三方可注册（forge 就是这么做） |
| 可复用文件树 / diff 视觉 | `sidebar.files.tree` Factory（`renderFactorySlot`）、`--dsw-alias-file-diff-*` token、官方 DiffBlock | 文件树 Factory 明确支持「changed files / local diffs」 |

**缺的正是 IDE 面板那层**：仓库/工作树导航、分支树、staged/unstaged 分组操作、仓库级 diff 查看器 —— 官方没有，第三方已补齐。

## 候选插件对比（对用户 7 项需求）

① repo picker ② worktrees ③ branches ④ staged/unstaged ⑤ 点文件→diff ⑥ 仓库文件浏览 ⑦ commit/op

| 插件 @ 版本 | ① | ② | ③ | ④ | ⑤ | ⑥ | ⑦ | 座位 | 声明兼容 0.2.2-rc.1 |
|---|---|---|---|---|---|---|---|---|---|
| **dsh-ide-git@0.32.0**（MIT） | ✅ 可搜索+工作区外绝对路径 | ✅ 列/建/开/删/清理 | ✅ HEAD/本地/远程/标签树 | ✅ 四组+逐文件操作 | ✅ 内嵌 diff + 右栏 diff tab | ❌（用官方 Files 补） | ✅ commit/amend/merge/rebase/cherry-pick/reset/push | 原生右栏 / 主对话区 Git 标签 / better-sidebar 工作台 | ✅ `engines.dsh >=0.2.2-rc.1` |
| @xbzbing/dsh-git-panel@1.13.2（MIT） | 🟡 自动识别 worktree/子仓库 | 🟡 只识别不建删 | ✅ | ✅ | ✅ 统一/并排/前后/图片 | ✅ 懒加载树+预览+编辑 | ✅ commit/amend/stash | 会话顶部 Git 页签 + 输入框分支标记 | 🟡 无 engines；README 称实测 |
| dsh-source-control@1.1.0（MIT） | ❌ | ❌ | 🟡 | ✅ | ✅ | ❌ | ✅ | 原生右栏「源代码管理」tab | ✅ 上界含 0.2.2-rc.1 |
| @dsh-electron/dsh-plugin-git@0.2.9 | 🟡 | ✅ Worktrees tab | ✅ | ✅ | ✅ | ❌ | ✅ | 原生右栏 Changes/Graph/Diff/Worktrees | ⚠️ 枚举止于 0.2.2-alpha.2 |
| dsh-git-tree@0.16.2 | ✅ 工作区切换器 | ❌ | ✅ 分支 rail | ✅ 三组 | ✅ 结构化 diff | ❌ | ✅（无 amend） | **左栏 main 面板入口**（最接近“放侧边栏”） | ❓ 无 engines |
| dsh-solution-explorer@1.0.3（MIT） | 🟡 多仓库发现 | ❌ | ✅ | ✅ | ✅ 可编辑并排 diff | ✅ 文件树+编辑器+终端 | ✅ | 右栏整体接管 | ❓ |
| dsh-better-sidebar@0.31.1（MIT） | ❌ | ❌ | 🟡 | ✅ | ✅ | ✅ | 🟡 | 右栏整列工作台（可作 dsh-ide-git 底座） | peers ^0.2.2-rc.1 |

## 风险

1. **第三方插件以 DSH 进程权限运行**：能做 git 写操作、读工作区文件；选 README 明确写了 argv+spawn、realpath 包含、破坏性二次确认、可撤回的实现（dsh-ide-git 有这些）。
2. **semver 预发布陷阱（当前最大兼容坑）**：大量插件声明 `>=0.2.1-rc.2` 之类下界，按 semver 预发布规则**不匹配** `0.2.2-rc.1`，可能安装即被拒/回滚；安装前 `npm view <pkg> engines.dsh peerDependencies` 复核。dsh-ide-git 是少数字面精确覆盖的。
3. **单作者快速迭代/弃养先例**：锁精确版本；dsh-ide-git 8 周 79 版，升级前看 release。
4. **重名/镜像**：`dsh-git-panel` 至少 6 个同名变体；锁定 scope + 版本，核对 npm repository 与 GitHub 仓一致。
5. **worktree 不可“在面板里切 cwd”**：DSH 会话 cwd 不可变；主流做法是把 worktree 注册成独立 Workspace 并开新会话（dsh-ide-git 选择“只管理不迁移”，列/建/删 worktree 但不搬当前会话，符合安全预期）。

## 若自研：可复用清单与工期（仅作备选）

- **Host**：`ctx.subprocess`（argv 数组跑 git，不拼 shell）、认证路由 `ctx.connection.fetch.register('/api/git-panel/*')`、`ctx.fs`/`workspaceFiles`、`workspaceRegistry`、`directoryPicker`、`ctx.worktrees`、`sandboxPolicy`；git 命令建议照 forge 的做法加超时/输出上限/env 清理/路径包含校验。
- **Client**：`sidebar.panellist` + `main`（左栏入口 + 三栏页）/ 或 `ctx.sidebarRightTabs.register`（右栏 tab）；文件树复用 `sidebar.files.tree` Factory；文件预览用 `openResource` 打开官方 documentpreview；diff 视觉用 `--dsw-alias-file-diff-*` token，可复用官方 DiffBlock 观感；diff 解析/渲染需自己实现（可借 MIT 插件的实现）。
- **工期**：只读 MVP（仓库/工作树/分支/状态/diff/文件浏览）3–5 天；含暂存/提交/worktree 创建与安全围栏 1.5–2.5 周；持续维护另计。
- **结论**：只有代码所有权/精确布局是硬需求时才值得；否则 adopt-as-is。

## 下一步

- 推荐：**装 `dsh-ide-git@0.32.0` + 用官方右栏 Files**，先看是否满足；不满意再决定 fork 加 FilesTab 或换 @xbzbing。
- 安装方式：桌面 profile 走 `plugin_manager install_bundle`（需要审批），或 Settings → Plugins 搜索安装；安装后刷新页面，打开任意会话 → 右栏 Guide → Git 胶囊。

## 安装记录（2026-11-12 02:0x）

- 已安装 **`dsh-ide-git@0.32.0`** 到 `desktop` profile（`plugin_manager install_bundle`，`application: applied`，warnings 为空），bundle 已追加到 profile 的 `dsh.profile.bundles`。
- Host 半验证：`POST http://127.0.0.1:55708/dsh-ide-git/api/version` → `{"ok":true,"data":{"git":"2.56.0","available":true}}`。
- 客户端：刷新 Harness 页面后，会话顶部「对话/轨迹/上下文」旁应出现 **Git** 标签（v0.13+ 默认开启），或从右栏 Guide 的 **Git** 胶囊打开。
- 未安装可选底座 `dsh-better-sidebar`（想要底部工作台再装）。
