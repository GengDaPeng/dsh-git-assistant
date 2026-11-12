# DSH Git 插件生态调研 — 能否直接采用？

**TL;DR**：生态里没有覆盖全部 7 项的现成插件；覆盖度最高的是 `dsh-ide-git`（6/7，缺仓库文件浏览）与 `@xbzbing/dsh-git-panel`（6/7，worktree 只能识别不能建删）。建议 **adopt-as-is（不 fork）**：Git 面板用 `dsh-ide-git`，文件浏览用 DSH 官方右侧栏「文件」页（或 `dsh-better-sidebar`）；只有必须“单插件闭环 + Zed 精确布局”时才 fork `dsh-ide-git` 加文件树。**不建议从零重建**。

> 调研对象：DSH **0.2.2-rc.1**（当前宿主）；调研日期 2026-11-12；只读：未安装任何包、未改 profile。
> 证据口径：npm registry `/<pkg>/latest` 与全量 packument（版本/发布日期/license/engines/peerDeps）、tarball README（`unpkg.com/<pkg>@<ver>/README.md`）、GitHub REST API（stars/created/pushed/archived）、`npm downloads` API（last-week）、`dsh-plugin-catalog@2026.1111.19182`。所有“兼容性”均为**声明值**，除注明“实测”者外未经真机验证。
> 官方基线（内部证据）：DSH 没有通用 Git 面板；`dsh-experimental-forge` 只提供会话内只读 Local changes/diff（Branch/Uncommitted/Unstaged/Staged），无 repo picker / worktree 树 / staging —— 见 `research/git-panel-primitives.md` §5。

## 1. 生态规模与真源

- npm 全量关键词搜索（`dsh git` / `dsh worktree` / `dsh diff` / `dsh source control`）去重后得到 **30+ 个 Git 相关包**，其中 **20+ 个是独立的 Git 面板 UI**；`dsh-plugin-catalog@2026.1111.19182`（10365 条，CC0-1.0）的 `git` 分类有 **185 条**（约 105 条带 panel/sidebar/页签字样），其余为模型工具、代码评审、GitHub/GitLab 集成、worktree 编排（[catalog README](https://www.npmjs.com/package/dsh-plugin-catalog)）。
- **catalog 不能当全集**：任务列出的 8 个候选里只有 4 个在 catalog 中（dsh-cool-git、@linxin666、dsh-git-workbench、dsh-better-sidebar）；catalog 是 awesome-dsh-plugin.com 的策展副本，**npm registry 才是真源**。
- **`dshmarket@1.73.18` 不是第二份目录**：它只是同一 catalog 的可视化 UI（README 明说索引源就是 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`），本 profile 未配置任何 market index，不影响结论（[dshmarket](https://www.npmjs.com/package/dshmarket)）。
- **重名严重**：至少 6 个不同作者都发布过名为 `dsh-git-panel` 的包（`@xbzbing`、`@multidsh`、`@tutu1918`、`@qzsy`、`@z-y-q`、`@fengbinmov`、`dsh-git-panel`）；`@multidsh` 与 `@xbzbing` 的 tarball 文件布局/模块名逐一对应（67 files，`lib/host/{actions,queries,worktrees}.js`），但 `@multidsh` 2026-11-04 才建、仅 2 个版本、1★ —— **疑似镜像/转发布，来源未证实，不建议使用**。选型必须锁定 **scope + 精确版本**。

## 2. 候选证据表（元数据 + UI 座位 + 取数架构 + 维护信号）

安装统一为 `dsh plugin --profile <profile> add <包名>`（本机 profile 以 lead 侧为准；桌面端建议走 Settings → Plugins / `plugin_manager install_bundle`）。

| 包 @ 版本（发布日） | 许可 | 声明 dsh 兼容 | UI 座位 | 取数 / 架构 | 维护（GitHub / 周下载） |
|---|---|---|---|---|---|
| [dsh-ide-git](https://www.npmjs.com/package/dsh-ide-git) 0.32.0 (11-10) | MIT | **`engines.dsh >=0.2.2-rc.1`（下界即当前宿主，字面覆盖；另一个字面覆盖者是 dsh-source-control）** | 原生右侧栏 tab / dsh-better-sidebar tab / 主对话区「Git」页（v0.13+） | host 前缀路由 `/dsh-ide-git/api`，54 个方法；argv+spawn（无 shell/exec）；同仓库写操作串行 | [KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git) 27★ pushed 11-10；3 860/wk |
| [@xbzbing/dsh-git-panel](https://www.npmjs.com/package/@xbzbing/dsh-git-panel) 1.13.2 (11-08) | MIT | 无 `engines.dsh`；README 称**已在 0.2.2-rc.1 实测** | `conversation.view` Git 面板 + 输入框左侧分支标记；另可开右侧栏 Git 页 | host/client 经 typert Remote 网关（`dbGitPanel` 7 端点：snapshot/run/query/suggest/version/openFile/writeFile）；ctx.subprocess + ctx.llm | [xbzbing/dsh-git-panel](https://github.com/xbzbing/dsh-git-panel) 46★ pushed 11-11；2 690/wk |
| [dsh-source-control](https://www.npmjs.com/package/dsh-source-control) 1.1.0 (11-05) | MIT | `engines.dsh >=0.2.0-rc.2 <=0.2.2-rc.1` ✅ | 右侧栏「源代码管理」tab（guide 胶囊 + 会话 header 图标） | 复用 DSH 内置组件外观 + host RPC；提交图/暂存/提交框/差异页 | [xzy-nine/dsh-source-control](https://github.com/xzy-nine/dsh-source-control) 1★ pushed 11-09；755/wk |
| [@dsh-electron/dsh-plugin-git](https://www.npmjs.com/package/@dsh-electron/dsh-plugin-git) 0.2.9 (10-30) | MIT | `engines.dsh` 枚举到 `0.2.2-alpha.2`，**不含 0.2.2-rc.1** ⚠️ | 右侧栏 Changes / Graph / Diff / Worktrees 四个 tab + composer 分支选择器 + 改动指示 | host `ctx.git` 服务（`ctx.subprocess`、从不 shell）+ loopback `/git` RPC + 官方 `DiffBlock` | [cherrchen/dsh-plugin-git](https://github.com/cherrchen/dsh-plugin-git) 1★ pushed 11-11；354/wk |
| [dsh-plugin-git-workbench](https://www.npmjs.com/package/dsh-plugin-git-workbench) 1.1.1 (10-21) | MIT | `dsh.engines.dsh >=0.2.0-rc.2` ⚠️ | 与「对话/轨迹/上下文/编队」同排的 `conversation.view` Git 页 + 输入框分支胶囊 | host routes + argv + 8 个 agent Git 工具 + AI 草稿（不自动发送） | [Yaronluo/…](https://github.com/Yaronluo/dsh-plugin-git-workbench) 1★ pushed 10-21；299/wk |
| [dsh-git-tree](https://www.npmjs.com/package/dsh-git-tree) 0.16.2 (11-04) | MIT | 无 engines/peers ❓ | **main 面板**（左侧图标栏 Git 入口）+ `⇧⌘V` 快捷键 | `/api/git-tree/*` Fetch 路由；argv；写路由带 `--` 守卫与冲突检查 | [chzisnull/dsh-git-tree](https://github.com/chzisnull/dsh-git-tree) 2★ pushed 11-04；865/wk |
| [@qzsy/dsh-git-panel](https://www.npmjs.com/package/@qzsy/dsh-git-panel) 0.2.1 (11-11) | MIT | 仅 node engines ❓ | 右侧栏 Git 分区（提交框/CHANGES/GRAPH）+ **差异预览 tab** | 仅 `connection` 路由；参数数组 spawn；路径逃逸/软链在 git 前拒绝 | [CurLeaf/dsh-plugins](https://github.com/CurLeaf/dsh-plugins) 0★ pushed 11-11；680/wk |
| [@tutu1918/dsh-git-panel](https://www.npmjs.com/package/@tutu1918/dsh-git-panel) 1.0.1 (10-17) | MIT | 无 dsh engines；peers `dsh-llm ^0.2.0-rc.2` 或 `>=0.2.1-0 <0.3.0` ⚠️ | 常驻右侧栏 tab | `/git-panel/*` + SSE 文件系统事件；底部多 tab diff 面板 | [tu1918/dsh-git-plugin](https://github.com/tu1918/dsh-git-plugin) 0★ pushed 10-17；**36/wk** |
| [@weniatall/dsh-file-viewer](https://www.npmjs.com/package/@weniatall/dsh-file-viewer) 0.3.60 (11-09) | MIT | 仅 node engines ⚠️ | 输入框按钮打开抽屉：左侧「文件 / Git」双页签，右侧预览+diff | host 设置 + 路由；git 调用剥离 `GIT_DIR` 等环境变量 | [veildawn/dsh-plugins](https://github.com/veildawn/dsh-plugins) 2★ pushed 11-11；714/wk |
| [dsh-plugin-git-worktrees](https://www.npmjs.com/package/dsh-plugin-git-worktrees) 1.0.1 (10-29) | MIT | 仅 node engines ❓ | 右侧栏 tab（仓库 / Worktrees / 已隐藏 手风琴） | 7 条 `/git-worktrees/*` 路由 + SSE；唯一写操作=删 linked worktree | **npm 无 repository 字段** ❌；65/wk |
| [dsh-gitworktree-gui](https://www.npmjs.com/package/dsh-gitworktree-gui) 0.7.0 (10-18) | MIT | `engines.dsh >=0.2.1-rc.2`；作者称不满足**安装即被拒绝并回滚** ⚠️（按严格 semver 0.2.2-rc.1 不匹配，需复核） | 会话 header Git 图标 → 右栏 tab；分支拓扑 / WORKTREES / CHANGES / FILES | 只读：固定参数 `execFile` + loopback 路由 + `allowedRoots` | [LeonZ666/…](https://github.com/LeonZ666/dsh-gitworktree-gui) 0★ pushed 10-18；136/wk |
| [dsh-cool-git](https://www.npmjs.com/package/dsh-cool-git) 0.5.1 (11-05) | MIT | 无 engines/peers ❓ | **会话 Tab 栏** Git 页 | cordis patch 注释称 host half 目前是占位符，与 README 的完整功能自述**矛盾（未验证）** | [CoolTea001/dsh-cool-git](https://github.com/CoolTea001/dsh-cool-git) 0★ pushed 11-05；728/wk |
| [@civilization/dsh-git-sidebar](https://www.npmjs.com/package/@civilization/dsh-git-sidebar) 0.3.0 (09-11) | Apache-2.0 | 仅 node engines ⚠️ | 官方右侧栏 `sidebarRightTabs` | 自带 host Git RPC 引擎，argv+spawn；路径限制在会话工作目录内 | [civilization-os/…](https://github.com/civilization-os/dsh-git-sidebar) 0★ pushed **09-11（停滞）**；6/wk |
| [dsh-git-plugin](https://www.npmjs.com/package/dsh-git-plugin) 0.4.0 (10-02) | MIT | `engines.dsh >=0.2.0-rc.2 <0.3.0-0` ⚠️ | 右侧栏 Git tab + 5 个 slash 命令 + 4 个只读模型工具 | 自带 host 服务（staged/unstaged diff、branch、history、stash）；每次写操作先预览再确认 | [MashedPotato817/…](https://github.com/MashedPotato817/dsh-git-plugin) 1★ pushed 10-02（停滞）；86/wk |
| [dsh-git-workbench](https://www.npmjs.com/package/dsh-git-workbench) 0.3.4 (08-20) | MIT | `engines.dsh >=0.1.0-rc.6` ⚠️ | 侧栏浮层 + composer Git strip（非标准 tab） | `/git` 命令 + `git_workbench` agent tool + pre-step 上下文注入 | [kaixinbaba/…](https://github.com/kaixinbaba/dsh-git-workbench) 0★ pushed **08-20（停滞）**；191/wk |
| [@linxin666/dsh-client-ui-git-graph](https://www.npmjs.com/package/@linxin666/dsh-client-ui-git-graph) 0.4.14 (11-02) | Apache-2.0 | `dsh >=0.2.1-rc.3` ⚠️；**catalog 标注“作者已弃养，转入官方 workspace-changes”** | 空会话 composer dock 分支胶囊 + Git graph；worktree 管理弹窗 | host `/git/*` + SSE；`autoIsolate` 新建会话自动建 worktree 并注册 workspace | [zhu1090093659/dsh-web](https://github.com/zhu1090093659/dsh-web) 10 353★；11 450/wk（**已停止开发**） |
| [@seayoo-web/dsh-git-log](https://www.npmjs.com/package/@seayoo-web/dsh-git-log) 0.2.1 (10-29) | MIT | peers `>=0.2.1-rc.2`；**作者明确警告 prerelease 规则下 0.2.2-rc.1 不会自动匹配** ⚠️ | `conversation.composer.dock` 提交日志胶囊 + `conversation.hero.options` 分支胶囊 | loopback `/git-log/*`（list/show/branches/switch/create-branch/push），唯一写操作=switch/push | 仓库为内网 `git.shiyou.kingsoft.com`（无 GitHub）；45/wk |
| [dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) 0.31.1 (11-11) | MIT | 无 dsh engines；peers 为 `^0.2.2-rc.1` 的官方包族 ✅ | 右侧栏整列自有 Tab 系统 + 底部工作台；对第三方暴露 `ctx.betterSidebar` 5 个扩展点 | 自家 `/sidebar/api` + 服务；内置文件树/编辑器/Git 页/终端/Subagent | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 5 087★ pushed 11-11；91 868/wk（196 open issues） |
| [@dsh-git/bundle](https://www.npmjs.com/package/@dsh-git/bundle) 0.1.2 (08-25) | MIT | 无 engines ❓ | **无 UI**（纯 host：模型工具 + 5 平台适配器 + memory） | 多 row 组合（`@dsh-git/local` 等），`ctx.credentials` 环境变量引用 | 套件仓 [sakthiveltofficial/dsh-git-plugins](https://github.com/sakthiveltofficial/dsh-git-plugins) 5★ pushed 08-25（停滞）；45/wk |

> 兼容性说明（重要）：npm 的 `engines.dsh` / peer 范围按 **semver prerelease 规则** 判定时，`>=0.2.1-rc.2`、`>=0.2.0-rc.2` 这类下限**不会**匹配 `0.2.2-rc.1`（不同 patch 元组）；`@seayoo-web` 作者在 README 中明确记录了这一点。**只有声明上界含 0.2.2-rc.1 或下界同为 0.2.2-rc.1 的包能“声明合格”**（dsh-ide-git、dsh-source-control），另有 `@xbzbing` 以真机实测兜底。其余标 ⚠️/❓ 的包可能被 CLI/插件管理器拒绝或降级为禁用，需安装前 `npm view <pkg> engines` 复核。
> 截图/演示证据（作者 README 内，未逐张复核）：dsh-ide-git `docs/screenshots/1-bottom-workbench.png`…`6-right-sidebar.png`（含右侧栏同一面板截图）；@xbzbing `docs/assets/screenshots/1-git-panel-overview.png`…`6-plugin-config.png`（含文件浏览页）；dsh-source-control `.github/assets/panel-overview.jpeg`；dsh-plugin-git-workbench `docs/screenshots/{branch-menu,changes}.png`；dsh-gitworktree-gui `assets/readme/{panel-map.svg,commit-detail.jpg}`；`@civilization` 无截图。

## 3. 功能矩阵（对 7 项需求）

图例：✅=有实现且 README/截图可证；🟡=部分/只读/需绕行；❌=无；❓=证据不足。

| 包 | ①repo picker | ②worktrees | ③branches | ④staged/unstaged | ⑤点文件→diff | ⑥仓库文件浏览 | ⑦commit/op |
|---|---|---|---|---|---|---|---|
| dsh-ide-git | ✅ 可搜索仓库选择器（含工作区外绝对路径，按会话记忆 8 条） | ✅ 工作树视图：列/建/开/复制/删/清理；分支树带 worktree 占用标记 | ✅ HEAD/本地/远程/标签树 + ahead/behind | ✅ 冲突/已暂存/更改/未跟踪四组 + 暂存/取消/丢弃 | ✅ 内嵌 diff + 「在右侧栏打开差异 Tab」 | ❌ | ✅ commit + amend + merge/rebase/cherry-pick/reset/push |
| @xbzbing/dsh-git-panel | 🟡 自动识别 worktree/子目录仓库并切换，无目录选择对话框 | 🟡 只识别 + worktree-stats，不建不删 | ✅ 分支/标签 + 切换/新建/合并/cherry-pick/删 | ✅ 逐文件/批量暂存、放弃、Amend；平铺/树形 | ✅ 统一/并排/变更前/变更后 + 词级高亮 + 图片 diff（模态） | ✅ 懒加载目录树 + 代码/MD/Mermaid/HTML/图片预览，可编辑文本 | ✅ commit/amend/stash/fetch/pull/push |
| dsh-source-control | ❌ 自动绑定会话工作区 | ❌ | 🟡 提交图右键检出/建分支/标签 | ✅ 分组 + 暂存/丢弃 + 提交框 + amend | ✅ 独立差异页（并排/统一/按 hunk） | ❌ | ✅ commit + amend + `gh` 建仓/PR |
| @dsh-electron/dsh-plugin-git | 🟡 跟会话目录；无任意仓库选择 | ✅ Worktrees tab：列/进入/建（不删不 prune） | ✅ 建/切 | ✅ staged/unstaged/untracked 三段 + 勾选 | ✅ 官方 `DiffBlock` 单文件 diff | ❌ | ✅ commit/amend/commit&push/sync |
| dsh-plugin-git-workbench | ❌ 自动识别当前仓库 | ✅ 建/开会话/锁/清理预演 | ✅ 搜索/切换/新建 | ✅ 冲突/已暂存/未暂存/未跟踪 + 文件或 hunk 级 | ✅ 并排 + 词级高亮 + 忽略空白 | ❌ | ✅ 草稿/amend/signed-off/撤销提交 + stash |
| dsh-git-tree | ✅ 工具栏仓库切换器（DSH workspaces，可 pin/排序） | ❌ | ✅ 分支 rail + 检出/建/改名/删 + 远程分组 | ✅ 冲突/已暂存/未暂存三组 + 批量 | ✅ 结构化逐文件 diff（双行号/hunk） | ❌ | ✅ commit/commit+push/fetch/pull/push（无 amend） |
| @qzsy/dsh-git-panel | ❌ 仅当前会话仓库（多仓库不并列） | ❌ | ✅ 分支胶囊 + 图顶栏 | ✅ 冲突/已暂存/未暂存/未跟踪 + 逐行动作 | ✅ 差异预览 tab（VS Code 形态，词级高亮） | 🟡 「打开文件」走官方 `openResource` 预览器，无树 | ✅ commit/amend/撤销上次/提交并推送 |
| @tutu1918/dsh-git-panel | 🟡 容器工作区多仓库 picker（有选择才出现） | ❌ | ✅ 分支 rail + picker | ✅ 常驻已暂存抽屉 + 更改/未跟踪分区 | ✅ 底部多 tab diff + 可转到右侧栏 tab | ❌ | ✅ 提交框带“仅 index / 全部已跟踪”范围 |
| @weniatall/dsh-file-viewer | 🟡 根目录或一级子目录仓库自动列出 | ❌ | 🟡 分支过滤 + 显式「检出」 | 🟡 四组含“部分暂存”标记，但**只读**（唯一写操作=检出） | ✅ 点条目在右侧显示 diff | ✅ 文件树 + 多格式预览 + 多标签 | ❌（只读） |
| dsh-plugin-git-worktrees | 🟡 仓库 / worktree / 子模块手风琴（扫描结果） | ✅ 列 + 删（主工作树只读） | 🟡 每个 checkout 选分支用于「工作区引用」 | ❌ | ✅ 就地展开 diff / 浮窗全文件 diff | 🟡 浮窗内全文件只读 | ❌（只读 + 删 worktree） |
| dsh-gitworktree-gui | ❌ 默认会话目录 + `allowedRoots` | ✅ 列 + 切换“看哪棵树”（不 checkout） | ✅ 分支拓扑（只读） | 🟡 CHANGES 列表（只读） | ✅ 提交/文件 diff | ✅ FILES 树 + 点开预览 | ❌（只读） |
| dsh-cool-git | ❌ 会话仓库 | ❌ | ✅ 切换/新建/删除/合并 | ✅ 文件夹树 + staged 状态 + 提交整树或仅 staged | ✅ Diff 面板（含冲突分块解决） | ❌ | ✅ commit（AI 消息）/fetch/pull/push |
| @civilization/dsh-git-sidebar | ❌ | ❌（README 自述“多 worktree 选择器尚未实现”） | 🟡 切换 + 从当前提交建分支 | ✅ 已暂存/更改分组 + **hunk 级**暂存 | ✅ 右侧栏 Diff 视图（统一/双栏） | ❌（自述“提交文件树尚未实现”） | ✅ 全部暂存/取消/提交 + stash |
| dsh-git-plugin | ❌ | ❌ | 🟡 列出 + 建/切（`/branch`） | ✅ staged/unstaged diff + 按文件/全部暂存 | ✅ 面板内 diff，写操作预览+确认 | ❌ | ✅ commit（仅 index）/stash/undo |
| dsh-git-workbench | 🟡 侧栏浮层可选任意已注册 workspace | ✅ 列/加/删 + `/git worktree` + tool | ✅ 切/建/合并 | 🟡 只在上下文中显示 staged/modified 计数 | ❌ | ❌ | ❌（无 commit；只 stash/merge/branch/worktree） |
| @linxin666/dsh-client-ui-git-graph | 🟡 官方 workspace pill + 分支上下文 | ✅ 托管 worktree 建/删 + autoIsolate + `git_worktree` tool | ✅ 切/图 | ❌ | ❌ | ❌ | ❌ |
| @seayoo-web/dsh-git-log | ❌ | ❌ | 🟡 切/建（composer 胶囊） | ❌ | ❌（只有提交内文件统计） | ❌ | 🟡 仅 push（无 commit） |
| dsh-better-sidebar | ❌ 会话/工作区维度 | ❌ | 🟡 分支 + sync 页脚 + 只读图谱过滤（无树） | ✅ Merge/Staged/Changes 分组 + 提交信息框 + Generate | ✅ 底部工作台/右侧栏 diff | ✅ 懒加载文件树 + git 状态着色 + CodeMirror 编辑 | 🟡 消息框+Generate（提交入口未逐版本核实） |
| @dsh-git/bundle | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌（模型工具：本地 git + 5 平台适配器） |

## 4. 架构观察（对自研/借用的启示）

1. **三种 host 取数范式**：(a) 自有 host 服务 + 前缀路由（dsh-ide-git 54 方法、dsh-git-tree `/api/git-tree/*`、git-worktrees 7 路由 + SSE）；(b) 官方 typert Remote 网关（@xbzbing 的 `dbGitPanel` 7 端点、@z-y-q 34 个 `@Remote`）；(c) 复用官方能力 + 官方组件（dsh-source-control 用内置控件、@dsh-electron 用 `ctx.git` + loopback `/git` + 官方 `DiffBlock`）。
2. **安全范式已收敛**：argv 数组 + `spawn`/`execFile`（从不拼 shell 字符串）、工作目录锁仓库根、路径 realpath 包含校验、破坏性操作二次确认、`push`/硬重置/强删分支显式 `confirm`、凭据交给 git 或 `ctx.credentials`。@dsh-electron 的 patch 还额外给出反例警告：**不要在树外插件中把 `@deepseek-ai/*` 声明为 dependencies**，会装出第二份模块实例并破坏 host 模块身份。
3. **模型面分层**：dsh-git-plugin（4 只读工具 + 5 slash 命令）、@hy-sde-org/dsh-git（`ctx.git` 服务 + worktree 租借池，供 `@hy-sde-org/dsh-tool-git` 消费，peer `@deepseek-ai/dsh-subprocess ^0.2.2-rc.1` ✅）、dsh-git-workbench（`git_workbench` tool + pre-step 上下文）、dsh-plugin-git-workbench（8 个 agent Git 工具）、@dsh-git/bundle（工具 + 平台适配器）。UI 面板与模型工具在生态里通常是两个包。
4. **worktree 的正确接法**：主流不是“在面板里切 cwd”，而是**把 worktree 注册成独立 DSH Workspace 并开新会话**（@linxin666 autoIsolate、dsh-left-panel 自动同步、@ds-hu composer Local/New worktree、@guowenzhang/dsh-worktree、dsh-git-worktree 0.12.4 的 Session Target）；因为会话 cwd 不可变。dsh-ide-git 则选择“只管理不迁移”，在面板内列出/建/删 worktree。
5. **UI 座位**：右侧栏 tab（`ctx.sidebarRightTabs`）、`conversation.view` 页签、`main` 面板（`sidebar.panellist`）、composer dock/hero、以及 dsh-better-sidebar 的私有 tab 系统都已验证可行；官方原语（`sidebar.files.tree` Factory、`DiffBlock`、`--dsw-alias-file-diff-*` token）可直接复用（详见 `research/git-panel-primitives.md`）。
6. **长尾**：`dsh-vsceditor`（内嵌 code-server/本机 VS Code）、`dsh-gufa-code`（主面板变 VS Code 风格 IDE，22★）、`@yann9/dsh-git-workbench`（JetBrains 风、hunk/行级暂存，11-10）、`@duke-dsh-plugins/dsh-git-manager`（居中面板 + 交互式 rebase）、`dsh-git-idea`、`dsh-web-git-sidebar`、`dsh-git-plus`、`dsh-git-panel`(a792883583，右侧栏 VS Code 式双栏 diff + 文件树徽标)、`@fengbinmov/dsh-git-panel`（conversation.view 拖拽暂存）等，均只覆盖部分需求，未进入矩阵。

## 5. 推荐（adopt / fork / borrow / build-fresh）

**结论：adopt-as-is（不 fork）> 小增量 fork > build-fresh；borrow-ideas 贯穿始终。**

1. **首选 adopt-as-is（0 代码）**：Git 面板 = `dsh-ide-git@0.32.0`；仓库文件浏览 = **DSH 官方右侧栏「文件」页**（已随宿发布，`ui-sidebar-files` + documentpreview），要“编辑器 + 文件树同列”再叠 `dsh-better-sidebar`。
   - 理由：**两个字面覆盖 0.2.2-rc.1 的完整面板之一**（另一个是 dsh-source-control，仅 4/7）；6/7 覆盖（只缺仓库文件浏览，而该能力宿主自带）；MIT；27★、79 个版本、pushed 11-10、3 860 周下载，活跃度在同类中最高；3.1 MB / 27 files，支持右侧栏与主对话区两种座位，且与 `dsh-better-sidebar` 官方集成。
   - 代价：node `>=24.9.0`（需确认 DSH 内置 Node 版本）；README 的“限制与路线图”章节停留在 v0.1.0，部分条目已过时（如工作树已实现），需以 feature 表为准。
2. **若必须“单插件闭环（含仓库内文件浏览）”**：
   - 选 B：`@xbzbing/dsh-git-panel@1.13.2`（6/7，含文件树/预览/可编辑文本；README 称 0.2.2-rc.1 实测）。代价：worktree 只能识别不能建删；diff 以模态为主；7.07 MB / 67 files；单作者、46★，`@multidsh` 镜像来源不明要避开。
   - 选 C：**fork `dsh-ide-git`**（MIT）加一个 FilesTab（复用官方 `sidebar.files.tree` Factory / `workspaceFiles` remote），得到 7/7 + Zed 式右侧布局。增量小但**上游 8 周发 79 版**，需持续 rebase；不建议把上游整包 vendored 后长期分叉。
3. **build-fresh 仅在**：必须自有代码所有权 / 需要 Zed 精确布局 / 不接受第三方运行时依赖。此时**不要重写 git plumbing**：host 层直接用 `@hy-sde-org/dsh-git`（MIT，`ctx.git` 服务含 diff 解析、hunk staging、worktree 租借池，peer `^0.2.2-rc.1` ✅）或官方 `subprocess` + `workspaceChanges`；UI 用官方 `sidebar.files.tree`、`DiffBlock`、`sidebarRightTabs` 原语。预估 2–3 周，但长期维护成本高于 adopt。
4. **明确不采用**：`@linxin666`（作者弃养）、`@z-y-q`（npm 只有 M0 `0.0.1`，README 自称 v0.7.3，GitHub repo 404）、`@multidsh`（来源未证实）、`@dsh-git/bundle`（无 UI）、`dsh-gitworktree-gui`（README 称 `engines.dsh` 不满足即拒绝安装，按严格 semver 0.2.2-rc.1 不匹配）、`dsh-left-panel`（`engines.dsh` 精确锁 `0.2.1-rc.5`）、`dsh-git-workbench 0.3.4` 与 `dsh-git-plugin`（8–10 月后停滞）。
5. **borrow-ideas 清单**：hunk 级暂存交互（@civilization / @qzsy / dsh-plugin-git-workbench）、diff 隐藏区间按需展开 + 删除撤回（@tutu1918）、worktree 租借池与 `--` 守卫的写路由（@hy-sde-org/dsh-git）、同仓库写操作串行 + 诊断条（dsh-ide-git）、SSE/文件系统事件增量刷新（@tutu1918 / @xbzbing）、双宿主自适应布局（dsh-ide-git 的 rail 排序/显隐）。

## 6. 许可与维护风险

- **许可**：绝大多数为 **MIT**；`@linxin666`、`@civilization` 为 **Apache-2.0**（宽松，但 fork 时保留 NOTICE/文件头）。未见 copyleft。`dsh-source-control`、`dsh-left-panel` 的 GitHub 许可探测为 `NOASSERTION`，npm 声明 MIT —— fork 前必须核对仓库 `LICENSE` 文件。
- **单维护者 + 快速迭代**：20+ 面板几乎都是一个作者、数十个版本（dsh-ide-git 79 版/8 周）；**弃养先例已出现**（@linxin666 作者明确退休；@z-y-q repo 404；@civilization / dsh-git-workbench / dsh-git-plugin 停滞）。adopt 时应锁精确版本并准备 fallback。
- **semver prerelease 陷阱（当前最大兼容风险）**：大量 `engines.dsh`/peer 写 `>=0.2.1-rc.2`、`>=0.2.0-rc.2`，在 0.2.2-rc.1 上按严格 semver 不匹配，可能被拒绝安装或降级禁用（@seayoo-web README 有明确说明；@dsh-electron 枚举到 0.2.2-alpha.2 即止；dsh-gitworktree-gui README 称不满足即拒绝安装）。升级 DSH 前应 `npm view <pkg> engines peerDependencies` 复核。
- **安全面**：这些插件都能对任意（或会话）仓库执行 git 写操作并读工作区文件；优先选 argv+spawn、realpath 包含、loopback+同源围栏、破坏性确认齐全的实现（本矩阵中 dsh-ide-git / @xbzbing / @dsh-electron / dsh-source-control 的 README 均有明确描述）。UI 座位只改变暴露面与交互入口，所有面板都运行在 DSH 进程权限下。
- **供应链**：重名与镜像（`dsh-git-panel` 6 个变体、`@multidsh` 镜像 @xbzbing）意味着必须核对 npm `repository`、`_npmUser`、GitHub 仓与 tarball 内容一致；无 repository 字段的包（dsh-plugin-git-worktrees）不建议进生产。
- **catalog 偏差**：catalog 的 stars/downloads 有滞后（如 dsh-better-sidebar 记 0.30.1/5060★，npm 已 0.31.1），且只收录部分包；只可用作发现与横向比较，不可作安装依据。

## 7. 未验证项（明确标记）

- `@tutu1918/dsh-git-panel` 的 38 KB README 功能表（“What works today”）未与 tarball 内代码逐项核对；其 6 files/545 KB 与 36 周下载、0★ 的成熟度不匹配，**功能声明存疑**。
- `dsh-cool-git` 的 cordis patch 注释称“host half 目前是占位符”，与 README 完整功能自述矛盾，未验证；未在 0.2.2-rc.1 实机确认。
- `@multidsh/dsh-git-panel` 与 `@xbzbing` 的代码同源关系由文件布局推断，未做逐文件 diff / 作者授权验证。
- 各 README 截图为作者自述，未逐张核对；`@z-y-q` 的 README 版本（v0.7.3）与 npm 发布（0.0.1）不一致，GitHub 仓 404。
- 所有 “实测 0.2.2-rc.1” 均为作者 README 声明，本调研未安装运行。
