# 把 DeepSeek「Super Agent」装进 DeepSeek Harness 侧边栏：可行性研究报告

- 研究日期：2026-11-10
- 研究环境：DeepSeek Harness Desktop `0.2.2-rc.1`（Web GUI `http://127.0.0.1:60320`，profile `desktop`），macOS arm64
- 研究对象：`deepseek-ai/dsh-superagent-prototype`（commit `8c32a9d`，2026-10-31，MIT，约 2.2 万 star）
- 研究方式：官方仓库源码/文档精读 + 本机 DSH 0.2.2-rc.1 运行时 API 实测核对 + 两次真实构建/类型检查实验（未安装任何插件、未改动任何 profile）

---

## 0. 结论摘要

**结论：可行，而且比预期更顺——官方这个"研究型仓库"本身就是一个标准的 DeepSeek Harness bundle（插件包）。**
但它不是"聊天框插件"，而是"面向前单仓库的主动型团队 Agent"：侧边栏入口打开的是**管理监督面板**，聊天发生在它自己管理的**主 Session**（一个普通 DSH 会话）里。要做到你说的"点侧边栏图标直接和超级助手聊天"，需要在它之上加一个小补丁（约 40 行客户端代码），技术上完全成立。

| 判断项 | 结论 | 依据 |
|---|---|---|
| 官方仓库能否作为 DSH 插件加载 | ✅ 天然支持，它就是 bundle | `package.json` 的 `dsh.bundle.patch` + `dsh.client` 声明；client 注册 `sidebar.panellist`/`main`/`plugins.row.config` 三个标准 slot |
| 是否需要改 app.asar / 重打包桌面 App | ❌ 不需要 | 插件在 profile 层安装，客户端代码由 Host 在运行时按需下发；第三方插件（如已装的歸藏设计、media-desk）已经这样工作 |
| 当前 DSH 0.2.2-rc.1 能否安装该插件 | ✅ 可以（engines 门槛实际放行） | DSH 启动器用 `semver.satisfies(..., { includePrerelease: true })` 校验 `engines.dsh`；`^0.2.1-alpha.2` 对 `0.2.2-rc.1` 返回 true（严格 semver 会拒绝，但 DSH 放行） |
| 源码能否直接构建 | ✅ 原样构建通过 | 实验 1：235 个依赖安装成功，`tsc --noEmit` 0 错误，构建成功；产物 client 358 KB / host 450 KB |
| 对当前 0.2.2-rc.1 的适配量 | 🟡 小补丁（约半天到 1 天，含运行验证） | 实验 2：把依赖换成 0.2.2-rc.1 后仅 6 处生产代码类型错误（4 个根因）+ 4 处测试错误 |
| "侧边栏点进去即聊天" | 🟡 需要加一个小入口 | 官方已有"打开主 Session"按钮（2 次点击）；新增一个 sidebar 图标 + 40 行直达逻辑即可 1 次点击 |
| 不配置 GitHub 能否聊 | ❌ 不能（原版） | 主 Session 只在 GitHub 仓库/Agent 账号 setup 成功后才创建；否则没有可聊的 Session |
| 主要风险 | 版本漂移 / 研究代码质量 / GitHub 账号门槛 / profile 隔离 | 见第 8 节 |

**推荐路线（详见第 6 节）**

1. **P0 隔离验证（0.5–1 天）**：用本机自带的 `dsh` CLI 建一个独立的 `superagent` profile，按官方文档跑起来（不碰你日常的 desktop profile），验证"面板 + 主 Session 聊天"端到端可用。前置条件只需要一个 GitHub 仓库 + 一个 Agent 账号（或临时用个人账号试跑）。
2. **P1 集成进当前桌面 DSH 侧边栏（1–2 天）**：fork 上游 → 打 0.2.2-rc.1 兼容补丁（4 个根因）→ 本地构建 → 用 `plugin_manager install_bundle` 装进 desktop profile → 配置 `stateDir` → 新增"超级助手"侧边栏图标，点击直接打开主 Session 聊天。
3. **P1′（可选）纯聊天变体（1–2 天）**：若你其实只想要一个"超级助手聊天伙伴"、不想被 GitHub setup 绑架，则做 chat-first 改造（把 setup 从启动门槛改为可选，或基于其 prompts 做一个轻量 bundle）。这不是原版 Super Agent 的完整体验，但是最贴近"聊天"诉求的形态。

---

## 1. 研究对象核实

| 项目 | 内容 |
|---|---|
| 仓库 | [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) |
| 定位 | "Towards a More Autonomous Agent System"；README 明确写：**仅供研究参考，不是 DeepSeek 官方产品**，是团队日常开发中长出来的研究代码，可能含 bug，为公开发布做过适配裁剪 |
| 规模 | `src/` 110 个 TS/TSX 文件约 15,205 行；`tests/` 59 个 spec 约 14,056 行；`docs/000–008` 约 1,973 行；prompts 15 个文件 |
| 许可 | MIT（保留版权与许可声明即可复用/修改/再分发） |
| 你的本地关联 | 你的 `super-assistant` 仓库已把该仓库 `src/core/`（15 个文件）按**同一 commit `8c32a9d`** 逐字节固定进 `vendor/superagent/`，并做了校验清单——说明这套领域核心你已经审过一遍，可作为后续复用的现成底座 |
| 结论 | 这是"官方团队放出来的研究原型"，不是成熟插件产品；接入时要按 fork + pin commit 的方式维护 |

## 2. 它到底是什么（决定"是否可行"的关键认知）

**一句话：面向一个 GitHub 仓库的主动型编码 Agent。**它监听 GitHub（可选飞书），在授权策略下把"请求"变成工单，每个工单在自己的 DSH Session + 独立目录里执行，最后在原对话里回复（例如开 PR）。Web 面板用于"监督需要人处理的事"，不是聊天界面。

关键设计（读文档确认）：

- **入口**：别人在 Issue/评论里 `@<agent 账号> <请求>`，或飞书里 @ 机器人；不是聊天框输入。
- **授权**：基于 Source 原生身份的确定性 gate（allowed 名单、admission 表、accept 模式 `off/observe/auto`），只有被接受的请求才创建 Ticket。
- **执行**：每个 Ticket 一个 `worker-<ticketId>` 会话 + 目录；有 `prepare` 命令可创建 git worktree；worker 槽位并发受控；有可恢复的 effects 队列、outbox 回执、健康检查。
- **面板**：Overview / Source / Trigger / Eval / Execution / Settings，六个管理视图（`docs/005-panel.md`）。
- **聊天在哪**：主 Session（`masterId = orchestrator-<hash(stateDir)>`）是一个普通 DSH 会话，面板右上角有「打开主 Session」按钮（`src/client/app.tsx:134-135`，文案 `locales.ts:101`）。人类与它的对话在 DSH 的标准聊天界面里发生；但它的系统提示词是"路由/评估/派工"专用（`prompts/orchestrator.md`），并非通用闲聊助手。
- **两种 Agent preset**：`dsh-superagent-router`（主 Session）与 `dsh-superagent-worker`（执行器），由 bundle 的 `cordis.patch.yml` 以 `@deepseek-ai/dsh-agent-preset` 行声明，会出现在 DSH 的 preset 选择器里（无法隐藏，官方注释说明了这一点）。

> 重要推论：**它的"聊天"是给监督者用的路由器会话，不是产品意义上的"和超级助手聊天"**。原版里你"跟超级 Agent 聊天"的真实含义是：主 Session 收候选卡片、评估、派单、回复你；如果你直接对它说话，它只能对话式回答，**不会**把聊天内容变成授权工作（没有 DSH-chat Source，没有从聊天创建 Trigger 的 API 路由或工具）。

## 3. 为什么"作为 DSH 插件"天然可行（机制证据）

### 3.1 它就是一个标准 bundle

- `package.json`：`main: lib/index.js`，`dsh.bundle.patch: ./cordis.patch.yml`，`dsh.client: { platform: "web", inject: [locale, ui-settings, ui-renderer, ui-layout, ui-sidebar, ui-workspace] }`，`exports["./client"]`。
- `cordis.patch.yml`：一条 `insert` 列表插入 3 个 Host 插件（主插件 + github-watch + feishu-watch，飞书默认 disabled），再加 2 个 `@deepseek-ai/dsh-agent-preset` 行（router/worker）。
- Host 主插件声明注入 11 个 DSH 服务：`agents, sessionController, sessionPersistence, workspaceRegistry, permissionPresets, tools, systemPrompt, skills, webServer, llm, subprocess`（`src/index.ts:8`）——**本次已在本机 desktop profile 的运行时服务目录中逐一核实全部存在**。
- 客户端只注册 3 个标准 slot（`src/client/index.tsx:53-57`）：
  - `main`（keyed）：管理面板；
  - `sidebar.panellist`（list）：侧边栏图标 "Superagent"，order 10；
  - `plugins.row.config`：插件管理器里的配置视图。
- 管理 API：`/orchestrator/api/*`，同源 + `x-orchestrator-request: 1` 头，loopback 限制（`src/app/http.ts`）。

### 3.2 DSH 侧的扩展点全部对得上（本机 0.2.2-rc.1 实测）

- 侧边栏机制：`sidebar.panellist`（列表，`{id, order, label}`）+ `main`（keyed，key 与 id 相同；`conversation` 是保留 key）。官方 README 原文："Plugins add an icon component to the root-scoped `sidebar.panellist` list… The same id addresses the component registered in the layout's root-scoped `main` keyed slot"。
- 现有第三方插件就是活证据：本机 profile 已安装的 歸藏设计、media-desk、dsh-context、dsh-agent-message 都通过这两个 slot 出现在侧边栏。
- 安装方式：`plugin_manager install_bundle`（本地目录用 `link:` 依赖），写入 profile 的 `package.json` 依赖与 `dsh.profile.bundles`，**不需要改 app.asar / 重打包桌面 App**；客户端 bundle 由 Host 在运行时下发。本机 `dsh-agent-message` 就是以 `link:/Users/gpp/project/github/dsh-msg` 方式装着的，证明"本地 link bundle"这条路在本 profile 可用。
- 版本门槛：`engines.dsh: ^0.2.1-alpha.2`。严格 semver 下 `0.2.2-rc.1` 不满足（预发布版本规则），但 DSH 的 app-boot 校验用 `includePrerelease: true`，实际返回 true——**本机不需要版本豁免，也不需要改 engines**。
- 关键 API 兼容：`ctx.slots.inject/register`、`ctx.uiWorkspace.openSession`、`ISessions.list/refresh`、`ctx.locale.register/bind`、`SidebarPanelIconOwnerProps`、`MainPanelId` 在 0.2.2-rc.1 的运行时契约目录里全部仍然存在。

### 3.3 安装/运行形态

官方文档推荐"独立 profile"部署（`docs/006-deployment.md:73-131`）：

```sh
dsh superagent --from-default-profile web --dump-config > /dev/null   # 从 Web 模板建 profile
dsh plugin --profile superagent add "link:$PWD"                        # 安装本地构建好的 bundle
# 在 profile 的 cordis.patch.yml 配置 stateDir（必填）与端口（示例 3082）
scripts/dsh-superagent start   # tmux 里跑 dsh --profile superagent，独立进程/端口
```

本机恰好具备几乎全部前置条件（本次已核实）：node 24.21、pnpm、git 2.56、tmux、python3、GitHub CLI 2.103（已登录）、lark-cli 1.0.97，以及**桌面 App 自带可用的 `dsh` CLI 0.2.2-rc.1**（`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，无需 npm 全局安装）。

> 为什么官方坚持独立 profile：插件会在启动时改写**进程级** `PATH` 与 git 配置、需要独立重启与升级（`docs/006-deployment.md:5-19`）。把它装进你日常的 desktop profile，会把团队 Agent 的自动化机制和你的私人会话放进同一个进程——这是 P1 方案必须明确接受的代价。

## 4. 决定性证据：两次构建实验（本次实测）

实验在 `research/build-probe/` 完成，原始日志在 `research/build-probe/logs/`。

### 实验 1：按官方依赖原样构建（devDeps 0.2.1-alpha.2）

- `pnpm install`：235 个包，约 11 秒（pnpm 本体 5.5 秒），成功。
- `tsc --noEmit`：**0 错误**（7 秒）。
- `tsdown` 构建：**成功**（构建器本身约 1 秒，含启动共 6 秒）；产物 `lib/` 共 1.0 MB：
  - `lib/client.js` 358.5 KB（gzip 86.6 KB）——浏览器端面板；
  - `lib/index.js` 450.3 KB（gzip 127.5 KB）——Host 端；
  - 另有 github-watch 33.9 KB、feishu-watch、若干 chunk 与 `.d.ts`。
- 结论：**仓库是可构建、可交付的**，不存在"源码放出来但跑不起来"的问题。

### 实验 2：换成当前 DSH 的 0.2.2-rc.1 类型定义后构建

把 devDependencies 全部改到 `0.2.2-rc.1`（cordis 4.1.0 / schemastery 3.19.0）后：

- `pnpm install`：成功（9 秒）。
- `tsc --noEmit`：**10 行报错 = 6 行生产代码（4 个根因）+ 4 行测试/夹具**，全部为局部小幅改动：

| # | 位置 | 错误 | 根因/修法 |
|---|---|---|---|
| 1 | `src/app/http.ts:237` | `number \| undefined` 不能传给 `number` | 新版 `WebServer.port` 的类型是 `get port(): number \| undefined`（listen 绑定前为 undefined，运行期已绑定）；非空断言或从 `getOrigin()` 解析端口即可，运行期行为不变 |
| 2 | `src/app/resources.ts:115` | `SessionController.inspect` 不存在 | 0.2.2 用 `sessionController.events({ address })`/`page()` 取代；改读会话事件 |
| 3 | `src/app/resources.ts:284,289` | 回调参数 implicit any | 新版事件类型改动导致的类型标注，补类型即可 |
| 4 | `src/client/deployment.tsx:49` | `ConfigFormSnapshot.mode` 不存在 | 新版 Config 表单快照字段变更，改读对应字段 |
| — | `tests/fixtures/panel-server.ts:461`、`tests/panel-deployment.spec.tsx:108` | 同上 `.mode` | 测试夹具跟随修改 |
| — | `tests/role-models.spec.ts:4,19` | `ModelSelectionRef` 改名、参数个数变化 | 仅测试 |

- `tsdown` 构建：**仍然成功**（820 毫秒，产物大小与实验 1 完全一致）。
- **移植试验（决定性）**：探针随后按上表实际改了一个补丁（5 个文件、+14/−12 行，diff 在 `research/build-probe/logs/exp2-port.patch`：webServer 端口守卫、`inspect` 改为 `sessionPersistence.open(id,'read')` 读事件、去掉 `ConfigFormSnapshot.mode` 分支、修 2 个测试夹具），结果：**`tsc --noEmit` 的 src 范围 0 错误**，完整 typecheck 只剩 2 个测试夹具错误（`ModelSelectionRef` 改名，纯测试代码），构建成功。
- 结论：**对当前桌面 DSH 的适配是"小补丁"级别：2 个真实 API 差异（`SessionController.inspect` 移除、`webServer.port` 变可选）+ 2 个类型/测试差异，约 0.5 人日可改完**，不是移植工程。真正的验证缺口是**运行时行为**（安装后的端到端），本次按"研究不落盘"原则没有安装。

> 说明：`engines.dsh` 与 peerDeps 不会阻止安装（见 3.2）；但为将来升级清晰，建议 fork 时直接把 engines/peer/dev 版本改为 `>=0.2.2-rc.1 <0.3.0` 并在 README 标注。

## 5. "侧边栏点进去就聊天"的差距与实现方案

### 5.1 官方现状 vs 你的目标

| 你的目标 | 官方现状 | 差距 |
|---|---|---|
| 侧边栏出现"超级助手"入口 | ✅ 已有，图标 label "Superagent"，打开管理面板 | 无 |
| 点进去直接聊天 | 🟡 面板需再点一次「打开主 Session」才进入聊天 | 1 次点击 + 一个入口配置 |
| 聊天对象是"超级助手" | 🟡 主 Session 是路由/派工型 orchestrator | 提示词按需调整（可选） |
| 不配 GitHub 也能聊 | ❌ 主 Session 只在 setup 成功后创建（`src/app/runtime.ts:201-211`） | 需要 chat-first 改造（路线 C） |
| 聊天内容能驱动它干活 | ❌ 没有 DSH-chat Source / 聊天建单路径 | 需要新增 Source 或工具（后续扩展） |

### 5.2 一键聊天入口的技术方案（已核对 API，可行）

DSH 的正确姿势不是"把聊天组件嵌进插件页面"（不支持：`main` 是互斥面板，聊天组件绑定的是当前渲染位置的会话），而是**插件页面把用户导航到那个会话**。官方自己就是这么做的：

```ts
// 官方面板里的"打开主 Session"（src/client/index.tsx:34-43）
await openKnownSession(ctx.sessions, id as SessionId,
  target => ctx.uiWorkspace.openSession(target), signal)
```

要"点侧边栏即聊天"，给上游客户端加一个**第二个侧边栏入口**即可（保留原入口作为监督面板）。示意代码（约 40 行，已验证依赖的 API 在 0.2.2-rc.1 存在）：

```tsx
// src/client/chat-entry.tsx：侧边栏"超级助手"图标 → 直接打开主 Session
const CHAT_PANEL = 'dsh-superagent-chat' as MainPanelId

function ChatEntry({ ctx, t }: { ctx: ClientContext; t: T }) {
  const [message, setMessage] = useState(() => t('chatOpening'))
  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        // 1) 同源调用 superagent 的管理 API，取主 Session id
        const state = await fetch('/orchestrator/api/state', {
          headers: { 'x-orchestrator-request': '1' }, signal: abort.signal,
        }).then(r => { if (!r.ok) throw new Error(`state ${r.status}`); return r.json() as Promise<{ masterId: string }> })
        // 2) 确保会话目录已加载，再交给 DSH 标准聊天面板
        await ctx.sessions.refresh()
        const list = ctx.sessions.list.getSnapshot()
        if (list.phase !== 'ready' || !list.byId[state.masterId]) throw new Error(t('chatNotReady'))
        ctx.uiWorkspace.openSession(state.masterId as SessionId)
      } catch (error) {
        if (!abort.signal.aborted) {
          setMessage(String(error))
          ctx.layout.selectPanel('dsh-superagent' as MainPanelId)   // 兜底：回到监督面板看 setup 问题
        }
      }
    })()
    return () => abort.abort()
  }, [ctx, t])
  return <div className="dt-chat-entry">{message}</div>
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: CHAT_PANEL, locale: NS, inject: () => ({}) },
    (props: { t: T }) => <ChatEntry ctx={ctx} t={props.t} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: CHAT_PANEL, order: 11, label: () => t('chatPanel'), locale: NS }, ChatIcon))
}
```

落点两选一（推荐前者）：

- **保留原面板 + 新增"超级助手"聊天入口**：不改变官方交互，风险最小；
- **只保留一个入口，面板挂载时自动跳转**：更接近"点进去就聊"，但会牺牲面板的可见性（可加"打开监督面板"兜底按钮）。

### 5.3 硬门槛：原版没有配置 GitHub 就没有聊天

`src/app/runtime.ts:201-211`：启动先跑 setup，失败则 `paused` 并 `return`——**不会创建主 Session**。setup 需要：一个 GitHub 仓库 + 一个 Agent 账号（独立 gh wrapper 登录、有 push 权限）+ stateDir + 模型 provider。所以原版"侧边栏聊天"的完整前置条件是：

1. 建 Agent 用的 GitHub 账号（建议独立账号，不要用你本人的）并给它仓库写权限；
2. 用隔离的 `GH_CONFIG_DIR` 登录该账号的 `gh`；
3. 在 DSH 里配置模型（当前 desktop profile 已有默认模型，可用）；
4. 配置 `stateDir`（例如 `~/.dsh/state/superagent`）。

不满足这些时，面板会显示 setup 问题清单（这本身是可用状态），但"打开主 Session"会报"会话不在目录中"。

## 6. 三条落地路线对比

| | A. 官方独立 profile（官方推荐） | B. 装进当前 Desktop profile + 一键聊天 | C. chat-first 轻量变体 |
|---|---|---|---|
| 目标达成 | 侧边栏在**独立的** Web 界面（如 `127.0.0.1:3082`），不在当前桌面窗口 | ✅ 侧边栏图标直接出现在你当前 DSH，点开即聊天 | ✅ 一个纯粹的"超级助手"聊天入口，不依赖 GitHub |
| 是否原版 | ✅ 完整原版（GitHub/飞书自动化 + 面板 + 主 Session） | ✅ 原版 + 小补丁 | ❌ 派生版：复用其 prompts/core，不带工单/授权机制（或改造 setup 门槛） |
| 主要工作 | 建 profile、构建、安装、配 stateDir、建 gh 账号/仓库、tmux 服务 | A 的工作 + 4 处 0.2.2 适配 + 第二个侧边栏入口（约 40 行） | B 的骨架 + chat-first 改造 / 新 bundle（约 1–2 天） |
| 工作量 | 0.5–1 天（不含建账号/仓库的操作时间） | 1–2 天（不含账号/仓库操作） | 1–2 天（若从零写轻量 bundle 再加 1–2 天） |
| 隔离/安全 | ✅ 独立进程、独立端口、官方设计用途 | ⚠️ 与私人会话同进程；插件会改进程级 PATH/git 配置，需要接受 | ✅ 轻，风险低 |
| 聊天对象 | orchestrator 主 Session（路由型） | 同 A | 可为聊天优化的 persona |
| 推荐度 | ⭐⭐⭐⭐ 先做（验证原版） | ⭐⭐⭐⭐ 你的目标形态 | ⭐⭐⭐ 备选（若只要聊天） |

**推荐组合：先 A 验证原版，再 B 落到你的桌面侧边栏，C 视你对"纯聊天"的执念决定。**

## 7. 推荐实施计划

### P0 隔离验证（0.5–1 天，不动日常 profile）

1. 本机自带 CLI 可用：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`（0.2.2-rc.1）。
2. 用独立 profile 跑官方流程（或先用官方的 0.2.1-rc.3 CLI 匹配包版本）：
   - 建 `superagent` profile（从 web 模板复制）；
   - fork/构建仓库（先按实验 1 的依赖构建；`pnpm install && pnpm build`）；
   - `dsh plugin --profile superagent add "link:<checkout>"`；
   - profile 的 `cordis.patch.yml` 写 `stateDir` 与端口；
   - 启动，打开侧边栏，配置 GitHub Source（仓库 + gh wrapper）、Policy（allowed 名单）、Execution（目录/prepare 命令）。
3. **验收**：侧边栏出现 "Superagent"；Overview 无 setup 问题；面板「打开主 Session」能进入聊天并收到回复；在 Issue 里 @ 它能在 ~1 分钟内生成工单（GitHub 流程）。

### P1 集成进当前桌面 DSH（1–2 天）

1. fork 仓库并 pin commit；打 0.2.2-rc.1 兼容补丁（第 4 节表里的 4 个根因 + 测试夹具）；更新 engines/peer 到 `>=0.2.2-rc.1 <0.3.0`。
2. `pnpm install && pnpm build`，产出 `lib/`。
3. `plugin_manager install_bundle` 以本地目录为目标安装（需要 danger-full-access 审批）；在 profile `cordis.patch.yml` 增加：
   ```yaml
   - id: dsh-superagent
     config:
       stateDir: /Users/gpp/.dsh/state/superagent
   ```
4. 增加"超级助手"侧边栏入口（第 5.2 节代码），本地化 label/图标（插件显示元数据要求：中英 title/description、自有或授权图标）。
5. **验收**：当前 DSH 侧边栏出现两个入口——"Superagent"（监督面板）与"超级助手"（一键聊天）；点击后者直接进入主 Session 对话；面板数据正常轮询；重启 DSH 后仍可用。

### P2（可选）

- 若要"不配 GitHub 也能聊"：把 setup 从启动门槛改为可选（确保主 Session 在未配置时也创建），或按路线 C 写轻量 chat-first bundle（可复用你 `super-assistant/vendor/superagent/core` 与 prompts）。
- 工程化：升级脚本、stateDir 备份、每小时健康检查（官方 `docs/006-deployment.md:133-141` 已有提示词）、与 DSH 升级联动的重新构建。

## 8. 风险与限制（按严重度）

| # | 风险 | 说明/缓解 |
|---|---|---|
| 1 | **DSH 版本漂移** | 上游面向 0.2.1-alpha.2；本机 0.2.2-rc.1 已有 4 处生产 API 差异。每次升级 DSH 都可能再漂移 → fork + pin + 升级时重跑 `tsc`/构建；不要期待 npm 上游维护 |
| 2 | **研究代码质量** | README 自述"research prototype, may contain bugs, 与内部版本/文章不完全一致"；生产使用需自己接管维护与测试 |
| 3 | **GitHub 账号/setup 门槛** | 原版必须先有仓库 + Agent 账号 + gh wrapper + push 权限；不配就没有主 Session 可聊。需要操作者本人完成账号步骤（不要在对话里传 secret） |
| 4 | **安全边界** | worker/router preset 以 `danger-full-access` + 操作者 OS 用户运行，可读 home 目录；官方建议用独立 OS 账号隔离。只在自己可控的机器/仓库上试 |
| 5 | **进程级副作用** | 插件会改进程 PATH、git 配置、写 worker shims；官方因此要求独立 profile。装进 desktop profile 需接受与私人会话同进程 |
| 6 | **未发布 npm / 无构建产物** | 仓库 `private: true` 且 `lib/` 被 gitignore；`install_bundle` **不会替你构建**（只做 pnpm add），必须本地先 build |
| 7 | **profile 内安装需审批** | `plugin_manager` 每个动作都需要 danger-full-access 审批；profile `cordis.patch.yml` 的编辑也在 workspace 之外 |
| 8 | **sidebar 面板/聊天互斥** | 自定义页面不能同时承载标准聊天（`main` 单占位）；"一键聊天"是导航到会话，不是把聊天嵌进面板 |
| 9 | **升级/回滚** | SQLite schema 只向前迁移；升级前备份 `stateDir/orchestrator.sqlite`；回滚需备份 |
| 10 | **模型/额度** | 主 Session + 每个 worker 都消耗模型调用；建议先用 `observe` 模式 + 小 allowed 名单控制噪音与成本 |

## 9. 关键事实与证据索引

| 结论 | 证据 |
|---|---|
| 它是 DSH bundle | `research/upstream/dsh-superagent-prototype/package.json:30-46`；`cordis.patch.yml:4-12,20,125` |
| 客户端只注册 3 个 slot、无聊天 UI | `src/client/index.tsx:53-57`；`docs/005-panel.md:3-24` |
| 聊天 = 主 Session + 打开按钮 | `src/client/app.tsx:134-135`；`src/client/locales.ts:101`；`src/navigation.ts:14-22` |
| 主 Session 只在 setup 成功后创建 | `src/app/runtime.ts:201-211` |
| 无 DSH-chat Source / 聊天建单路径 | `src/app/api.ts:21-45`；`src/` 中无 conversation/chat 相关代码 |
| 原样构建通过 / 产物大小 | `research/build-probe/logs/exp1-install.log`、`exp1-typecheck.log`、`exp1-build.log`；`research/build-probe/repo/lib/`；逐项结果见 `research/build-probe.md` |
| 0.2.2-rc.1 适配仅 2 个真实 API 差异 | `research/build-probe/logs/exp2-typecheck.log`（10 行错误明细）；移植补丁 `research/build-probe/logs/exp2-port.patch`；`research/build-probe.md` 的 API drift matrix |
| DSH engines 实际放行 | app-boot `0.2.2-rc.1` 的 `semver.satisfies(runtimeVersion, engines.dsh, { includePrerelease: true })`（`dsh-app-boot/lib/index.js:1094-1117`；探针实测见 `research/build-probe/logs/exp2-runtime-gate-evidence.log`） |
| 侧边栏/main slot 机制 | `@deepseek-ai/dsh-client-ui-sidebar/README.md:42`；`dsh-client-ui-layout/README.md:36`；`dsh-client-ui-workspace/README.md:86` |
| 安装不需要重打包 App | `cordis-plugin-development` skill 引用 + 本机已装的第三方 link bundle（`dsh-agent-message`） |
| 团队子报告 | `research/upstream-analysis.md`、`research/harness-ui-analysis.md`、`research/harness-chat-analysis.md`、（`research/build-probe.md`，若已生成） |

## 10. 一句话回答你的问题

**"能不能把它像插件一样放进 DeepSeek Harness、放侧边栏、点进去和超级 Agent 聊天？"**
能。官方仓库本身就是 DSH 插件包；当前桌面版 DSH 的兼容性实测良好（构建通过、适配量小）；侧边栏入口和"打开会话聊天"的机制官方都有，离你的目标只差"一个直达聊天的图标 + 一次 GitHub 账号配置"。真正需要你决策的是：**要不要连 GitHub 自动化一起要（路线 A/B），还是只要一个聊天形态（路线 C）**。
