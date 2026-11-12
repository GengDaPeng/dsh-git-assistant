# 自研「Zed 式 Git 面板」插件：难度评估与实施计划

- 日期：2026-11-12
- 背景：试用 `dsh-ide-git@0.32.0` 后，用户认为其 UI/UX 密度高、不协调；目标是做出接近 Zed 编辑器 Git 面板的观感：干净、紧凑、低对比度、信息层级克制。
- 结论：**难度中等、可控**。Git 后端与 DSH 插件机制都不难；diff 查看器可移植官方样式（但不能直接 import 官方组件），真正决定成败的是视觉打磨。

## 一、工作量拆解（以“能连续投入的 agent 工作日”估算）

| 里程碑 | 内容 | 估算 |
|---|---|---|
| v0.1 只读骨架 | 插件脚手架（bundle/patch/host/client）、Git host 服务（repos/worktrees/branches/status/staged+unstaged/diff/file tree/file content）、右栏（或主面板）UI：仓库切换、工作树/分支树、变更列表、点文件看 diff、文件浏览（文本/图片/MD） | 2–4 天 |
| v0.2 写操作 | 暂存/取消暂存/丢弃（逐文件+整组）、提交/amend、切分支/新建分支、冲突列表与基础处理 | +1–2 天 |
| v0.3 体验 | worktree 创建/删除、快捷键、文件树状态装饰、搜索、自动刷新/监听、空状态与错误态、大文件/二进制降级、性能（虚拟滚动） | +2–3 天 |
| 视觉打磨 | 按用户截图逐轮对齐：行高/间距/字号、图标风格、颜色层级、hover/选中/焦点、面板留白、响应式窄宽 | 每轮 0.5–1 天，预计 2–4 轮 |
| 安装/回归/文档 | 打包、安装到 desktop profile、切换 DSH 版本回归、使用说明 | 0.5–1 天 |

**合计：可用 MVP 约 1 周当量；打磨到“顺眼顺手”约 2 周。**

> 2026-11-12 更新：确认官方已有 diff 查看实现（chat DiffBlock / forge Local changes / deliverables changes-review），其样式与 token 可移植，diff 查看器从“中偏高”下调为“中”。

## 二、难点排序

1. **diff 查看器（中，可移植官方样式）**
   - 需要：统一/并排视图、行号双列、hunk 折叠/展开、语法高亮（至少常见语言）、大文件与二进制降级、横向滚动同步。
   - 方案：host 侧输出 `git diff` 结构化 hunk（或用 `jsdiff`/`diff` 库在 host 算），client 自绘；视觉按官方 DiffBlock/forge Changes 的排版与 `--dsw-alias-file-diff-*` token 移植（MIT/BSD-3-Clause，保留版权声明）。语法高亮先用轻量 tokenizer（关键字/字符串/注释），后续再考虑 shiki 轻量版。
   - 注意：**不能 import 官方 diff 组件**（插件客户端只允许基线模块，官方也没暴露 diff 的 slot/Factory），只能"抄样式 + 自己实现渲染"；详见第三节。
   - 风险：大仓库 diff 卡顿、CRLF/编码、图片 diff、子模块。
2. **视觉/交互细节**：Zed 的“舒服”来自克制——单色小图标、22–24px 行高、弱分隔线、状态字母低饱和着色、hover 才出现操作、留白均匀。需要多轮截图对照。
3. **刷新与状态同步**：git status/文件变化自动刷新（轮询或 fs watch）、多仓库切换时快照隔离、操作后乐观更新 + 校验。
4. **Git 边界情况**：重命名、二进制、冲突标记、linked worktree 的 cwd、submodule、bare repo、无 git/非仓库目录、超长路径。
5. **DSH 插件机制**：bundle/patch、host 前缀路由（认证用 `ctx.connection.fetch.register`）、client 单文件 bundle、主题 token、右栏 tab 或 main 面板注册——这些我们已做过一次（superagent 预览版），低风险。

## 三、复用 vs 自写

### 关于“官方已有 diff 查看，直接抄就行”的边界（2026-11-12 补充）

官方 0.2.2-rc.1 确实已有三处 diff 查看：
1. 对话里 write/edit 工具调用的 `DiffBlock`（ui-primitives / ui-tool，随聊天渲染）；
2. experimental forge 的 **Local changes** 右栏 tab（Branch / Uncommitted / Unstaged / Staged 四种范围，只读）；
3. `ui-deliverables` 的 **changes-review** 右栏 tab（每一轮 Agent 改动的统一/并排 diff）。

但“直接抄”要分成两件事：

- ✅ **可以抄样式与实现方式（推荐）**：官方 diff 的颜色、行号、hunk 背景、折叠交互都有固定规范，主题 token 是 `--dsw-alias-file-diff-*`；相关官方包是 MIT / BSD-3-Clause，移植代码保留版权声明即可。我们的 diff 渲染器因此从“自己设计”变成“移植 + 适配”，工作量约 0.5–1 天，观感天然与 DSH 一致。
- ❌ **不能直接 import/内嵌官方组件**：DSH 插件客户端有硬规则——不能 `require` 官方 client 包，只能使用 react 等基线模块；且官方没有把 diff 查看器暴露成可复用的 slot/Factory（当前公开的 Factory 只有 `sidebar.files.tree`、`sidebar.files.navigator` 等 4 个，无 diff）。所以拿不到现成组件实例。
- 🟡 **唯一“用现成”的折中**：从我们的面板导航到官方 diff tab（forge 的 Local changes / deliverables 的 changes-review）。但它只覆盖“当前会话 checkout / 单轮改动”且只读，还会把用户带离面板，做不了“面板内右侧 diff”；只适合做兜底按钮，不做主方案。

结论：diff 仍是自写，但“设计+观感”成本被官方规范大幅降低；后端与任意仓库/工作树的数据能力仍需我们自己做。

**直接复用 DSH 官方能力**（不用自己造）：
- 文件浏览的树 UI：`sidebar.files.tree` Factory（`renderFactorySlot`，可喂任意条目）；
- 文件预览：`openResource` 打开官方 document preview（代码/MD/图片/PDF/Office）；
- 主题：`--dsw-alias-*`（含 `--dsw-alias-file-diff-*` 系列）保证与 DSH 深浅色一致；
- 目录选择：`ctx.directoryPicker`；Workspace 注册：`workspaceRegistry`；
- 跑 git：`ctx.subprocess`（argv 数组，不拼 shell）；
- 面板座位：`ctx.sidebarRightTabs`（右栏 tab）或 `sidebar.panellist` + `main`（左栏图标+全页面板）。

**可借鉴（MIT，抄思路不抄壳）**：`@xbzbing/dsh-git-panel` 的 diff 解析/词级高亮/上下文展开交互；`dsh-ide-git` 的 worktree 只管理不迁移策略与 git 安全围栏（argv/realpath/超时/输出上限/破坏性确认）。

**必须自写**：Git host endpoints（status/branches/worktrees/diff/tree/content）、Zed 风格的三栏/两栏 UI、diff 渲染与样式、快捷键与交互。

## 四、形态建议（二选一或共用一套 UI）

- **A. 右侧栏 tab**（与聊天并排，最接近“编辑器 + 侧栏”的 Zed 观感，也是用户截图的使用方式）——推荐先做这个；
- **B. 左栏图标 + main 全页面板**（整页三栏，像 Zed 的 Git 面板铺满编辑区）——可后加，同一套组件换布局。
- 建议 A 先做，B 复用同一组件（响应式布局按容器宽度切换，学 dsh-ide-git 的 `ResizeObserver` 思路，但视觉重新设计）。

## 五、第一版（v0.1）建议范围

只读：仓库切换（DSH workspaces + 手输绝对路径）、工作树列表 + 分支树、staged/unstaged/untracked 变更列表（只展示）、点文件看只读 diff、文件浏览（树 + 文本/图片/MD 预览）。
不做：commit/暂存/丢弃/切分支/worktree 创建——等视觉定稿后再加，避免边改 UI 边处理写操作风险。

## 六、下一步

1. 用户确认：位置 A 还是 B；v0.1 是否接受“只读先行”。
2. 我建立插件工程（建议包名 `dsh-git-dock` 或类似，避开已有重名），先出可安装的 v0.1，让用户在 DSH 里看实物。
3. 按用户截图逐轮对齐视觉（每轮提供截图对照）。
