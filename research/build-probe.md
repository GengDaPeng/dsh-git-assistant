# Build/typecheck probe: official `dsh-superagent` bundle vs installed DSH 0.2.2-rc.1

Task: task-4 (owner: build-probe). Date: 2026-11-10. Workspace: `/Users/gpp/project/github/git-assistant`.
Source: `research/upstream/dsh-superagent-prototype` @ commit `8c32a9d` (2026-10-31), unbuilt (`private: true`, no `lib/`).
Installed DSH: `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime` **0.2.2-rc.1** (cordis 4.1.0, schemastery 3.19.0).
Nothing outside `research/build-probe/` was written; `research/upstream/` and `~/.dsh/profiles/desktop` were not touched.
Full command logs: `research/build-probe/logs/` (exp1-*.log, exp2-*.log). Porting patch: `research/build-probe/logs/exp2-port.patch`.

Toolchain (both experiments): `NODE=/Users/gpp/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node` (v24.21.0),
`PNPM=$NODE .../pnpm/bin/pnpm.mjs` (v11.28.5, but the repo's `packageManager: pnpm@11.7.0` is honored: logs say "using pnpm v11.7.0").
Registry `https://registry.npmjs.org`. Copies: `repo/` (as published), `repo-022/` (rewritten deps), `repo-022-patched/` (porting trial).
Installs used `--ignore-scripts --config.confirmModulesPurge=false`.

## Verdict

| Question | Answer |
|---|---|
| (a) Does the published bundle build as-is (0.2.1-alpha.2 pins)? | **YES.** install 11 s, `tsc --noEmit` 0 errors in 7 s, `tsdown` build OK in 6 s, `lib/` produced. |
| (b) Does it typecheck against installed DSH 0.2.2-rc.1? | **NO as-is: 10 errors (6 in src/client, 4 in tests), 2 distinct API breaks + 2 stale test fixtures.** But `pnpm build` still succeeds (byte-identical artifacts). After the 3-file ~20-line patch below, src+client typechecks clean. |
| (c) Concrete API drifts | 2 real (src): `SessionController.inspect()` removed; `ctx.webServer.port` now optional. 2 test-only/type-only: `ConfigFormSnapshot.mode` removed; `ModelSelectionRef` removed + `installModelSelection(ctx, ref)` → `installModelSelection(agentCtx)`. All other probed APIs unchanged. |
| (d) Porting effort | **~0.5 dev-day** for a DSH-familiar dev (deps 5 min, src/client patch ~20 lines, 1 trivial test fixture edit, 1 test fixture rework 1–2 h), + ~0.5–1 day runtime verification. No engine change needed. |

## Experiment 1 — build as published (peer/dev deps 0.2.1-alpha.2)

```
rsync -a --exclude .git research/upstream/dsh-superagent-prototype/ research/build-probe/repo/
cd research/build-probe/repo
$NODE $PNPM install --ignore-scripts --config.confirmModulesPurge=false   # EXIT 0, 11 s
$NODE $PNPM typecheck                                                   # EXIT 0, 7 s, 0 errors
$NODE $PNPM build                                                       # EXIT 0, 6 s
```
- Install: 235 packages, 123 MB `node_modules`; lockfile resolved from the shipped `pnpm-lock.yaml` (289 entries). **No engine warning**: pnpm does not evaluate the non-standard `engines.dsh` field (only `engines.node`, which node v24 satisfies). No peer warnings.
- Typecheck (`tsc --noEmit`, includes `tests/`): clean.
- Build (`tsdown`): clean. Only warning is tsdown's generic "We recommend using the ESM format instead of CommonJS" for the CJS client entry.
- Artifacts: `lib/` = **1,052,021 bytes (1.0 MiB), 12 files**. `lib/index.js` 450,257 B (450.26 kB, gzip 127.47 kB), `lib/client.js` 358,517 B (358.52 kB, gzip 86.64 kB), `lib/index.d.ts` 24,974 B; ESM total 693.50 kB, CJS total 358.52 kB.

## Experiment 2 — variant with DSH 0.2.2-rc.1 dependencies

### Dependency rewrite (all changes recorded; `research/build-probe/repo-022/package.json`)
- 48 pins rewritten: **all 23 distinct `@deepseek-ai/dsh-*` packages (23 devDependency pins + 21 peerDependency pins) `0.2.1-alpha.2` → `0.2.2-rc.1`** (dash ranges flattened to exact, as the repo uses exact pins); `@deepseek-ai/cordis` 4.0.5-alpha.1 → **4.1.0** (dev+peer); `@deepseek-ai/schemastery` 3.18.5-alpha.1 → **3.19.0** (dev+peer; both = versions the installed app uses).
- Registry check: every one of the 23 dsh packages has `0.2.2-rc.1` on npmjs; cordis 4.1.0 / schemastery 3.19.0 published too.
- `engines.dsh` left **unchanged** at `^0.2.1-alpha.2` (see runtime gate below: it already accepts 0.2.2-rc.1, so no edit was needed).
- `pnpm install` refreshed `pnpm-lock.yaml` automatically (no manual lockfile edit).

```
rsync -a --exclude .git --exclude node_modules --exclude lib research/upstream/dsh-superagent-prototype/ research/build-probe/repo-022/
# rewrite package.json pins; then
$NODE $PNPM install --ignore-scripts --config.confirmModulesPurge=false   # EXIT 0, 9 s, 240 packages
$NODE $PNPM typecheck                                                   # EXIT 2, 9 s, 10 errors (below)
$NODE $PNPM build                                                       # EXIT 0, 6 s
```
Install warnings: 24 deprecated transitive `@yuku-*` bindings (irrelevant); 1 peer-dependency warning block for cordis plugin peers
(`cordis-plugin-include` 1.0.9 / `loader` 1.1.0 / `group` 1.0.4 resolved by pnpm vs `~4.0.4`/`~1.1.0` peer ranges of the 0.2.2 packages).
These are transitive cordis-composition peers, not plugin APIs; the installed app ships 1.1.0/1.1.0/1.1.0. No install failure.

### Typecheck result (`pnpm typecheck` = `tsc --noEmit`, tests included) — EXIT 2, 9 s
First and only failure output (10 errors):
```
src/app/http.ts(237,28): error TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
  Type 'undefined' is not assignable to type 'number'.
src/app/resources.ts(115,48): error TS2339: Property 'inspect' does not exist on type 'SessionController'.
src/app/resources.ts(284,52): error TS7006: Parameter 'event' implicitly has an 'any' type.
src/app/resources.ts(284,59): error TS7006: Parameter 'index' implicitly has an 'any' type.
src/app/resources.ts(289,24): error TS7006: Parameter 'event' implicitly has an 'any' type.
src/client/deployment.tsx(49,67): error TS2339: Property 'mode' does not exist on type 'ConfigFormSnapshot<Record<string, unknown>>'.
tests/fixtures/panel-server.ts(461,5): error TS2353: ...'mode' does not exist in type 'ConfigFormSnapshot<...>'.
tests/panel-deployment.spec.tsx(108,37): error TS2353: ...'mode' does not exist in type 'Partial<ConfigFormSnapshot<...>>'.
tests/role-models.spec.ts(4,84): error TS2724: '"@deepseek-ai/dsh-agent"' has no exported member named 'ModelSelectionRef'. Did you mean 'ModelSelection'?
tests/role-models.spec.ts(19,30): error TS2554: Expected 1 arguments, but got 2.
```
Src-only run (`tsconfig.src.json` = tsconfig with `include: ["src/**/*.ts","src/**/*.tsx","tsdown.config.ts"]`): 6 errors in 2 s (the same 6 src/client rows above; implicit-any rows 3–5 are downstream of the `inspect` error).

Classification:
| # | Error | Kind | Fix |
|---|---|---|---|
| 1 | `webServer.port` is `number \| undefined` in 0.2.2 (was `number`) | type-only/trivial; new getter type only (new `getOrigin()` added) | guard/assert once in `registerHttp` (3 lines) |
| 2 | `SessionController.inspect(sessionId)` removed | **API removed/renamed** | use persistence read handle (pattern already in this repo at `src/app/delivery.ts:45-56`), ~5 lines |
| 3–5 | `.flatMap((event,index)=>…)` implicit any | cascade of #2 (transcript return type `any`) | disappears with #2 |
| 6 | `ConfigFormSnapshot.mode: 'host' \| 'memory'` removed | type-only + small behavior loss: 0.2.2 no longer exposes memory-mode on the snapshot; drop the "remote browser read-only" branch (or derive elsewhere) | delete 1 ternary branch |
| 7–8 | test fixtures still set `mode` | stale test data, trivial | delete 2 fields |
| 9–10 | `ModelSelectionRef` removed; `installModelSelection(agentCtx, ref)` → `installModelSelection(agentCtx)`; 0.2.2 replaces the mutable ref with `AgentModel` + `modelSelectionProjectionDefinition` (+`ModelSelectionProjectionState`) | **test-only API rework** (src does not use `ModelSelectionRef`) | rewrite `tests/role-models.spec.ts` fixture (1–2 h); 2 errors remain |

### Build result — EXIT 0, 6 s, and artifact identity
`pnpm build` **succeeds against 0.2.2-rc.1 typings** (tsdown builds `src` entries only; it does not fail on `tsc` errors).
`lib/` = 1,052,021 bytes, 12 files — **byte-identical to Experiment 1** (`md5`: `lib/index.js` `5239fb42…`, `lib/client.js` `01e59f04…`, `lib/index.d.ts` `ab646022…`), because `@deepseek-ai/*` are declared `neverBundle` externals in `tsdown.config.ts`.

### Porting trial (proof of effort) — `repo-022-patched/`
Applied 5 small edits (14 added / 12 removed lines, full unified diff in `logs/exp2-port.patch`):
1. `src/app/http.ts`: capture `ctx.webServer.port`, throw if undefined, pass the captured number to `sameOrigin` (+3 lines).
2. `src/app/resources.ts`: `transcript()` now `await host.context.sessionPersistence.open(id, 'read')` → `handle.read().events` in `try` / `handle.close()` in `finally` (existing pattern from `delivery.ts`) (±2 lines).
3. `src/client/deployment.tsx`: remove the `snapshot?.mode === 'memory'` read-only branch (1 line).
4. `tests/fixtures/panel-server.ts` + 5. `tests/panel-deployment.spec.tsx`: drop the removed `mode` field/argument (2 lines).
Result: **`tsc --noEmit` src-only EXIT 0, full EXIT 2 with only the 2 `role-models.spec.ts` model-selection errors**, and `pnpm build` EXIT 0.

## API drift matrix (npm-installed 0.2.2-rc.1 typings, vs 0.2.1-alpha.2)

| API used by source (site) | 0.2.2-rc.1 status |
|---|---|
| `sidebar.panellist` slot (`src/client/index.tsx:55`) | **SAME** — `kind:'list', scope:'root', owner: SidebarPanelIconOwnerProps`; 0.2.2 only adds a sibling slot `sidebar.panellist.actions` |
| `SidebarPanelIconOwnerProps` (`client/index.tsx:24`) | **SAME** — `{ size: number; active: boolean }` |
| `main` slot + `MainPanelId` (`client/index.tsx:4,21,53`) | **SAME** — `'main': { kind:'keyed', scope:'root' }`; `MainPanelId = Branded<'MainPanelId'>` |
| `uiWorkspace.openSession(target: SessionTarget)` (`client/index.tsx:38`) | **SAME** signature; `SessionTarget` re-exported unchanged (+internal additive options) |
| `ISessions` (`src/navigation.ts`, `client/index.tsx`) | **SAME** interface (list/refresh/retain/…); tsc clean |
| `webServer.register(WebRoute)` + `webServer.host` (`src/app/http.ts`) | **SAME** register; `port` getter now `number \| undefined`, new `getOrigin()` → trivial type fix |
| `permissionPresets.set(session, name)` (`src/app/sessions.ts:152`) | **SAME** — `set(session: Session, name: string): void` |
| `sessionController.inspect()` (`src/app/resources.ts:115`) | **REMOVED** — new surface `page`/`events`/`observeEvent`/`state`/`wait`; full log reads via `SessionPersistence.open(...,'read')` handle. `SessionInspection` type still exported but no producer |
| `ConfigFormSnapshot.mode` (`src/client/deployment.tsx:49`) | **REMOVED** (whole `mode` field; `status`/`writable` unchanged) |
| `dsh-agent` `ModelSelectionRef` / `installModelSelection` (tests only) | **REMOVED/RENAMED** — see #9–10 |
| dsh-session, dsh-llm, dsh-tools, dsh-system-prompt, dsh-scope, dsh-session-persistence, dsh-settings, dsh-skill, dsh-attachment, dsh-subprocess, dsh-workspace (all src imports) | **SAME**, no errors (all src usages typecheck clean) |
| dsh-client-locale, dsh-client-ui-renderer, dsh-client-ui-settings (`ConfigForm`), dsh-client-ui-slots, dsh-client-ui-plugin-manager (`PluginConfigViewProps`, `ConfigPageForm`) | **SAME**, no errors |
| cordis 4.0.5-alpha.1 → 4.1.0; schemastery 3.18.5-alpha.1 → 3.19.0 | **No errors**; `Context`/`Service`/`z` usages unchanged |

## Runtime gates of installed DSH 0.2.2-rc.1 (extra evidence)

- **`engines.dsh` gate passes unchanged.** Installed `@deepseek-ai/dsh-app-boot@0.2.2-rc.1` (`lib/index.js:1094-1117`) checks
  `semver.satisfies(runtimeVersion, engines.dsh, { includePrerelease: true })` when `engines.dsh` exists (peerDependencies then ignored).
  With includePrerelease: `satisfies('0.2.2-rc.1','^0.2.1-alpha.2') = true` → the published `engines.dsh` accepts DSH 0.2.2-rc.1
  (plain node-semver default would be `false`, but that is not what DSH uses). No engine change is required; bumping to `^0.2.2-rc.1` is optional hygiene.
- **Client loader contract unchanged.** Installed `@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js:1` still starts
  `window.__ModuleLoader__.load({ id, factory })` — the exact banner/format `lib/client.js` from this repo emits.
- Evidence transcript: `research/build-probe/logs/exp2-runtime-gate-evidence.log`.

## Limits / not covered

- Runtime behavior was not exercised (no install into a DSH profile, no panel/session smoke test); only build, typings, and the
  bundle-manager/loader code paths above were checked. Semantic risk concentrates on the `inspect`→persistence-read rewrite and the
  dropped memory-mode hint.
- `pnpm test` (vitest) was not ported/run; tests are known to need the role-models fixture rework.
- Peer-resolution warnings in the probe tree (cordis plugin peers) come from pnpm auto-installing the 0.2.2 dependency graph; they do not
  appear as typecheck/build errors and are not caused by the bundle.
