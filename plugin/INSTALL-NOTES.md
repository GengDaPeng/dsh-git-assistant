# dsh-superagent 本地预览版：安装与改动记录

安装时间：2026-11-10 19:08（Asia/Taipei）
安装目标 profile：`desktop`（当前 DeepSeek Harness Desktop 正在运行的 profile）
安装方式：`plugin_manager install_bundle`，目标为本地目录 `/Users/gpp/project/github/git-assistant/plugin/dsh-superagent`
安装结果：`application: applied`，bundle `dsh-superagent` 已启用，warnings 为空
状态目录：`/Users/gpp/.dsh/state/superagent`（SQLite + worker 环境，插件自己管理）

## 基线

- 上游：`deepseek-ai/dsh-superagent-prototype` @ `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`（MIT）
- 本目录 = 上游源码 + 以下本地改动（均为预览用途，未提交上游）

## 相对上游的本地改动

### 1. DSH 0.2.2-rc.1 兼容补丁（来自 research/build-probe/logs/exp2-port.patch）

- `src/app/http.ts`：`webServer.port` 现在是 `number | undefined`，在 `registerHttp` 里取一次监听端口并在未绑定时抛错。
- `src/app/resources.ts`：`sessionController.inspect()` 在 0.2.2 已移除，`transcript()` 改为 `sessionPersistence.open(id, 'read')` 读取事件。
- `src/client/deployment.tsx`：去掉已删除的 `ConfigFormSnapshot.mode === 'memory'` 只读分支。
- 两个测试夹具去掉已删除的 `mode` 字段（仅测试）。
- `package.json` 的 dev/peer 依赖从 `0.2.1-alpha.2` 提升到 `0.2.2-rc.1`（cordis 4.1.0 / schemastery 3.19.0）。
- 剩余未修的 2 个 typecheck 错误只在 `tests/role-models.spec.ts`（`ModelSelectionRef` 改名），不影响构建与运行。

### 2. Chat-first 补丁（`src/app/runtime.ts`）

上游只在 setup（GitHub 仓库 + Agent 账号）成功后创建主 Session；本预览版把主 Session 的创建提前到 setup 之前，
因此即使还没配置 GitHub，也能打开主 Session 聊天。setup 仍然会执行并显示待办项。

### 3. 侧边栏"超级助手"直聊入口（`src/client/index.tsx` + `src/client/locales.ts`）

新增第二个侧边栏图标 "超级助手"（order 11）和对应 main 面板：点击时请求
`GET /orchestrator/api/state`（同源，带 `x-orchestrator-request: 1`），拿到 `masterId` 后
`ctx.sessions.refresh()` + `ctx.uiWorkspace.openSession(masterId)`，直接进入 DSH 标准聊天界面。
原 "Superagent" 图标（order 10）仍然打开官方管理面板。

### 4. bundle 层默认 stateDir（`cordis.patch.yml`）

在 insert 的 `dsh-superagent` 行加了：
```yaml
config:
  stateDir: /Users/gpp/.dsh/state/superagent
```
这样不用改 profile 的 `cordis.patch.yml`（预览版做法；上游设计是让 profile 层提供该配置）。

### 5. 侧边栏收敛 + 聊天页内的设置入口（2026-11-10 19:45 追加）

用户反馈：管理页只是设置页，不该单独占一个侧边栏入口。改为：

- **移除** `sidebar.panellist` 里的 "Superagent"（锤子）入口，侧边栏只保留 **"超级助手"** 一个入口；
- 管理面板仍注册在 `main`（key `dsh-superagent`），但改为从聊天页进入：在超级助手主 Session 的
  **聊天页头部**（`conversation.session.header.actions` 槽位）显示一个锤子图标，点击 `ctx.layout.selectPanel('dsh-superagent')`
  跳转到管理面板；面板里原有的「打开主 Session」按钮可以回到聊天。
- 头部的锤子图标只在主 Session（`masterId` 匹配）显示，其他会话不显示。
- 对应 locale 新增 `openPanel`，并更新打不开聊天时的兜底文案。
- `package.json` devDependencies 增加 `@deepseek-ai/dsh-client-ui-conversation`（仅类型，用于该槽位的 TS 类型合并）。
- 该改动只涉及 client 侧：重新 build 后刷新 Harness 页面即可生效，无需重启 App、无需重装 bundle。

## 验证记录

- `GET http://127.0.0.1:60320/orchestrator/api/state`（带 `x-orchestrator-request: 1`）返回 200：
  `masterId = orchestrator-5a120355e6231107c1e1391d39fba6eb`，`setup.problem = repositoryUnset`（预期，尚未配置 GitHub），
  `health.runtime = paused/setupPending`，其他 effects 均 ready。
- 会话已创建：`~/.dsh/sessions/--Users-gpp-.dsh-state-superagent--/orchestrator-5a1203.../session.v4.jsonl.zstd`。
- 状态目录已创建并加锁：`~/.dsh/state/superagent/orchestrator.sqlite*`。
- 构建：`tsc --noEmit` 的 src+client 范围 0 错误；`tsdown` 构建成功（client 361.5 KB / host 450.5 KB）。

## 重新构建 / 更新

```sh
cd /Users/gpp/project/github/git-assistant/plugin/dsh-superagent
export NODE=/Users/gpp/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
export PNPM=/Users/gpp/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs
$NODE "$PNPM" install --ignore-scripts
$NODE "$PNPM" build
```

- 只改 `src/client/**` 和 `src/client/locales.ts`：重新 build 后，刷新 DSH 页面（或等客户端 HMR）即可。
- 改 Host 代码（`src/app/**`）：需要让 DSH 重新加载该插件（重启 App 最稳妥）。

注意：该目录的 `node_modules/` 是运行时依赖（`link:` 安装不会复制依赖），不要删除；否则运行时会缺包。

## 卸载 / 回滚

- 用 Plugins 页面卸载 bundle `dsh-superagent`，或调用 `plugin_manager` 的 `remove_bundle`（target 为 `dsh-superagent`）。
- 状态数据在 `~/.dsh/state/superagent`，卸载插件后可按需删除。
- profile 侧改动仅：`~/.dsh/profiles/desktop/package.json` 增加 `"dsh-superagent": "link:…"` 与 `dsh.profile.bundles` 追加；由 plugin manager 写入。

## 已知限制（预览版）

- GitHub/飞书来源尚未配置，管理面板会显示 setup 待办；不影响聊天入口。
- 主 Session 使用的是上游 router/orchestrator 提示词与 preset（面向"评估/派工"），不是通用闲聊人格；
  且该 Session 被插件设为 `danger-full-access`，它可以在 `~/.dsh/state/superagent` 环境里执行命令，请注意。
- 上游是研究原型（README 自述可能含 bug），升级 DSH 后可能需要重新适配。
