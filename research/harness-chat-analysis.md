# DSH 0.2.2-rc.1: can a plugin page host a real chat with a superagent?

Scope: installed Host/Client (Web UI, profile `desktop`, GUI `http://127.0.0.1:60320`). Read-only analysis; no plugin installed, no profile state changed.

**Legend / sources**
- `DSH` = `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/<pkg>/…` (installed Host+Client packages; `read` works, shell/ripgrep cannot open app.asar).
- `SA` = `research/upstream/dsh-superagent-prototype/` (official prototype clone).
- `MSG` = `dsh-msg` (`/Users/gpp/project/github/dsh-msg`, profile-linked `dsh-agent-message`; its README states it was verified on Harness 0.2.2-rc.1).
- `inspect` = `cordis_inspect_query` Host output collected 2026-11-10 (Service/Event catalogs + exact contracts).
- **Limit:** Client inspect (`Slots.listSubTree`, client `Service`/`Event`) timed out three times ("Open or reconnect the Harness page"); the GUI needs a launch token I do not hold, so no live slot tree was observed. Client claims below come from shipped README/type declarations + shipped-plugin/SA source usage, not from live `Slots` output. Items marked **[speculation]** are unverified.

---

## 1. How the Web chat UI is composed

Ownership chain (`inspect`, READMEs):

```
main` keyed slot (ui-layout)          keys: 'conversation' (reserved) | plugin panels e.g. 'guizang-design'
└─ key 'conversation': ui-conversation shell  (header + conversation.content Factory + Composer)
   ├─ conversation.session  → ui-chat target (transcript nodes, renderers, turn rail, scroll)
   ├─ conversation.view     → other Views (Trajectory…)
   ├─ conversation.composer / .bar / .dock, conversation.input.dock, conversation.chat.flow, conversation.chat.node
   └─ composer + queue dock are supplied by ui-conversation itself
```

- `main` is a **single-occupant keyed slot**: "Global panels occupy the root-scoped `main` keyed slot; `conversation` is the reserved key for the Conversation. `ctx.layout.selectPanel(id)` selects a registered panel, and `null` selects the Conversation without changing the current Session." — `DSH/dsh-client-ui-layout/README.md:36`. `panelInfo`/`usePanelInfo` expose which panel is showing (`:65`).
- The Conversation package "occupies the root-scoped `main` key `conversation`" and "Its default adapter renders the existing `conversation.session` entry, while the main occurrence selects the width handles; **an embedded occurrence can replace `views` and omit those handles without rendering the main Header**" — `DSH/dsh-client-ui-conversation/README.md:101`.
- Session binding is by **render position**, not by prop: "**Factory occurrences inherit their render-position Session** — `conversation.content` does not accept an independently addressed Session; that requires a separate Session-provider capability." — `DSH/dsh-client-ui-conversation/README.md:203`. Standard props/hooks (`useConversation`, `useInput`, `inputActions`) are projected by `ctx.uiSession` from the one bound Session (`DSH/dsh-client-ui-renderer/README.md:36,46`; `dsh-client-ui-session/README.md:11`).
- Composer takeovers are matched against the **current** session id only: `ComposerChainProps { sessionId, session, pendingInteraction }` + `select: owner => owner.sessionId === request.sessionId ? request : null` — `DSH/dsh-client-ui-conversation/README.md:138-172`.
- Session-scoped extension seats a custom plugin may occupy: `conversation.composer.dock` (ordered list, e.g. chat's `activity`/`usage` entries, `DSH/dsh-client-ui-chat/README.md:79`), `conversation.chat.flow` (DOM anchor, `…/README.md:120`), `conversation.chat.user.before` chain (`…:48`), user-text renderers `conversation.user.text.node`, and Chat rows via `ctx.uiConversation.events.register()` + `conversation.chat.node` (`DSH/dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:37`).
- Right sidebar is the **per-session side panel**: `rightbar.session` subtree per session (`DSH/dsh-client-ui-sidebar-right/README.md:63`), tab type registry `ctx.sidebarRightTabs.register({id,kind,…})` + body slot `sidebar.right.pane.tab` (`…:85-86`).

### Can a custom page render a real chat bound to a session? **No (not supported).**

- A plugin page is a competing `main` panel key, so it cannot coexist with the Conversation panel in `main`.
- A plugin client half may not import the chat packages: "Do not `require('@deepseek-ai/dsh-client-ui-primitives')` or load any other Harness Client package as a module; `dsh.client.inject` entries only order activation… a plain-JS plugin has no type check, and a throwing component blanks your slot entry" — `practices.md:35`; "Do not serve an HTML page from the Host and embed it in an iframe" — `practices.md:33`. Shipped page plugins do render iframes (`dsh-guizang-design/lib/client.js:1-3,72`), i.e. it works mechanically but inherits no theme/locale guarantees.
- Rendering an embedded Conversation occurrence is only hinted at: "Every renderer-created Component can render a Factory occurrence" (`DSH/dsh-client-ui-renderer/README.md:36`) and conversation `README.md:101` mentions "an embedded occurrence". There is **no documented plugin-facing API, props contract, or session argument**; `:203` says an independently addressed Session is unsupported. **[speculation]** It would fail on session binding first, not on rendering.
- Conclusion: the supported ways to show real chat are (a) navigate the main area to a Session (`ctx.uiWorkspace.openSession`), (b) add session-scoped seats around the stock chat (composer docks / Chat rows / right-sidebar tab type). Everything else is reimplementation.

---

## 2. Session lifecycle: Host APIs a plugin actually uses

`inspect`, exact contract `ctx.sessionController` (Host; backs client `ctx.remote.session`):
- `create(request: SessionCreateRequest): Promise<SessionCreateValue>` where
  `SessionCreateRequest = { workspaceId?, cwd?, sessionId?, agentPreset? }`, returns `{ sessionId, agentPreset? }`.
- `resolveAgent(sessionId): Promise<{agent}|{error: 'session/not-found'|'session/agent-busy'|'session/writer-held'|'gateway/internal'}>`
- `list(_request: SessionListRequest, signal): Promise<{items: SessionSummary[]}>`; `search(...)`; `rename({sessionId,title})`; `fork({sessionId, atSeq?, allowMigration?})`; `prompt({requestId, sessionId, mode:'queue'|'steer', content, clientTimeZone?})`; `cancel({sessionId})`; `selectModel({sessionId, provider, model, reasoningEffort?})`; `modelCatalog()`.
- Streaming/cold reads: `events(SessionPageRequest, signal)`, `follow(SessionFollowRequest, signal): AsyncIterable<SessionFollowFrame>` (`{type:'snapshot'|'event'|'assistant-stream'}`, snapshot carries `header,cursor,records,projections,assistantStream?`), `observeEvent`, `observeProjections`, `state`, `observeState`, `wait({timeoutMs?, afterSeq?, maxMessages?})`, `projections`.
- `SessionSummary = { agentAvailable, sessionId, updatedAt, running, blank, parentSessionId?, origin?, cwd?, formatStatus?, projections? }` — **no title, no agentPreset**.
- `SessionHeader = { id, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth?, agentPreset? }` — preset + cwd live on the header.
- Other lifecycle services: `ctx.agentLoop.create(id, options?, meta={cwd})` / `resume(owner, options)`; `ctx.agents.get/list/roots/create/resume`; `ctx.sessions.create(id?, options?)` (in-memory store; `create` is also the low-level path); `ctx.workingDirectory.get(session)` / `ensure(agent)` / `set(agent, path)` / `defaultDirectory`.
- Host events for observation: `'session/event'(session, event)` (post-commit feed), `'session/created'`, `'session/disposed'`, `'agent/status'`, `'agent/assistant-stream'`, `'agent-preset/selected'(sessionId, agentPreset)` (`inspect` Host Event catalog).

Client-side (what a page can call), verified usages:
- `ctx.sessions` is the Client Session Manager typed as `ISessions` from `@deepseek-ai/dsh-api-session-controller/client` — `SA/src/navigation.ts:2`. It exposes a list store + refresh: `sessions.list.getSnapshot()` → `{ phase, byId }`, `sessions.refresh()` — `SA/src/navigation.ts:14-20`; `ctx.sessions.list.subscribe(...)` — `MSG/lib/client.js:314`; row fields read by a shipped plugin: `byId[id].displayTitle | title | id` — `MSG/lib/client.js:27,31`.
- `ctx.uiWorkspace.openSession(target)` — "synchronously replaces the owned `mainView` reference and returns the main area to Conversation without waiting for `reference.ready`" (`DSH/dsh-client-ui-workspace/README.md:86`). Used as `ctx.uiWorkspace.openSession(target)` with `target: SessionId` — `SA/src/client/index.tsx:38,13-14`; `MSG/lib/client.js:188-189` (guards `typeof openSession === 'function'` for version tolerance).
- `ctx.uiWorkspace.startSession(workspace, options?)` — options accept `prompt`, `whenDraftExists: 'keep'|'replace'|'append'`, `clearPreviousDraft`, **and `{ agentPreset }`** (`DSH/dsh-client-ui-workspace/README.md:92,116`); usage: `ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'replace' })` — `dsh-guizang-design/lib/client.js:59`. `openWorkspace(…)`/`connectWorkspace(…)` also accept `agentPreset` (`README.md:92`).
- `ctx.layout.selectPanel(id | null)` shows a registered `main` panel / returns to Conversation (`DSH/dsh-client-ui-layout/README.md:36`).

**Finding a Session (plugin, for lead Q2)**
- Host, by preset/cwd/id/title: `ctx.sessionQuery.listSessions(): Promise<SessionRecord[]>` with `SessionRecord = { header: SessionHeader; live; persisted; formatStatus? }` (`inspect` exact contract). So `header.agentPreset`, `header.cwd`, `header.id` are readable without activating an Agent; titles via `ctx.sessionQuery.readTitleSnapshots(ids)` (`inspect`; used at `MSG/lib/index.js:312,323`) or the `ctx.get('sessionTitle')` service (`MSG/lib/index.js:86`).
- `filterSessions(filters)` filters only `id | cwd | created-at | parent | availability` (`inspect` `SessionResultFilter`) — **no title/preset filter**; filter client-side after reading headers/titles.
- `presetForSession(session)` is the authoritative live read (`inspect` `agentPresets`), projection `'agentPreset'` exists as a fallback — `SA/src/app/sessions.ts:274-280`.
- `sessionController.list()` alone is insufficient (no title/preset; `SessionSummary` above).
- Client-only lookup is possible but weaker: `ctx.sessions.list.getSnapshot().byId` (id/title) — the client row carries no preset; resolving preset needs a Host read (`SA` reads it Host-side).

---

## 3. Agent presets: contribution and pinning

- A preset is a **declarative plugin tree**, declared by a bundle patch row `name: '@deepseek-ai/dsh-agent-preset'` with `config: { id, name, description, order, plugins: [...] }` — `DSH/dsh-agent-preset-registry/README.md:46-48`; real example: `SA/cordis.patch.yml:20-21` (worker) and `:125-126` (router). "A new preset or an override of a shipped one is a bundle patch: an `insert` of a `@deepseek-ai/dsh-agent-preset` row… installed into the profile with `plugin_manager`" (`README.md:48`).
- Tools/system prompt/skills come from the preset's child rows (`@deepseek-ai/dsh-tool-*`, `dsh-persona`, `dsh-skill-filesystem`, …). Host `ctx.systemPrompt.section/context/tools/variable`, `ctx.tools.register/restrict/guard` are the runtime seams a preset's plugins use; `SA` applies them **per agent** on `agent.ctx` after `agent/created` — `SA/src/app/sessions.ts:208` (`agent.ctx.tools.register`), `:244` (`agent.ctx.systemPrompt.section`), `:263-264` (`agent.ctx.tools.restrict({allow:[…]})`, `agent.ctx.tools.guard`). Registering on `agent.ctx` makes teardown follow agent disposal (`practices.md:19`).
- Ids are exposed by `ctx.agentPresets`: `list(): Promise<AgentPreset[]>`, `resolve(id?)`, `presetForSession(session)`, `select(agent, agentPreset): Promise<string>`, `mount(ctx, id?)`, `register(PresetDefinition)`; Remote roster `@Remote('list') remoteExportList(): Promise<AgentPresetRoster>` with rows `{ id, isDefault, name?, description?, broken? }` and `@Remote('read') readDocument(id)` (`inspect`; registry `README.md:48,60`).
- Pinning a session to a preset: set at creation — `sessionController.create({ agentPreset })` ("reused Session runs the requested `agentPreset`, or the configured default when the request names none. A named Session that has started… stays unchanged" — `DSH/dsh-api-session-controller/README.md:48`); or `agentPresets.select(agent, id)` **before the first turn** ("Select a preset before a session starts its first turn… nothing is logged or announced" — `inspect`; "`select` leaves a blank Session that records the requested preset… unchanged" — registry `README.md:60`).
- A page **can** open a NEW session pinned to its own preset: `ctx.uiWorkspace.startSession(undefined, { agentPreset: '<id>' })` (`DSH/dsh-client-ui-workspace/README.md:92`; shipped precedent — the Creator flow does exactly this with `agentPreset: 'cordis'`, `DSH/dsh-client-ui-agent-preset/README.md:50`). No requirement to go through the Hero picker; the preset is chosen by the flow.
- Caveat: a bundle-declared preset is **user-visible in the preset picker and cannot be hidden** — "A preset row has no setting that hides it from the preset picker, so its name and description say whom it is for" — `SA/cordis.patch.yml:18` comment.
- Caveat (proven workaround needed): opening a Session in Web may select the default preset before its first turn; `SA` therefore listens to `'agent-preset/selected'` and re-selects its own preset while the session is unstarted — `SA/src/app/sessions.ts:122-131`. After the first turn DSH refuses selection, so a wrapper must create the session with `agentPreset` or select it before the user sends anything.
- Creating without a preset is allowed (`agentPreset?` optional) but then the registry default applies, so a "superagent" session would run the wrong tools.

---

## 4. What the official superagent repo already uses (proven-stable extension points)

| Area | Evidence (SA file:line) | DSH API |
|---|---|---|
| Session create/resolve/rename/model catalog | `src/app/sessions.ts:138-152`, `src/app/runtime.ts:210` | `ctx.sessionController.resolveAgent/create/rename/modelCatalog` |
| Workspace per session | `src/app/sessions.ts:143` | `ctx.workspaceRegistry.create(cwd)` |
| Permission preset | `src/app/sessions.ts:150` | `ctx.permissionPresets.set(session, 'danger-full-access')` |
| Presets per role | `src/app/sessions.ts:48,124-131`; `cordis.patch.yml:20,125` | `ctx.agentPresets.select`, `agent-preset/selected`, preset rows |
| Live agents / inbox delivery | `src/app/delivery.ts:63-81`, `src/app/runtime.ts` | `ctx.agents.get/list`, `agent.inbox.nextTurn/nextStep`, `agent.inject`, `agent.followup` |
| Tools & prompt per agent | `src/app/sessions.ts` (`ctx.tools.register/restrict/guard`, `ctx.systemPrompt.section`) | Host services |
| Model routing | `src/app/role-models.ts` | `ctx.llm.resolveCallConfig` |
| Background work | `src/executor/background.ts:29-34` | `ctx.get('jobs')`, `ctx.get('subagents')` (`waitForChildren`, `listChildren`, `drainChildren`) |
| Management HTTP page | `src/app/http.ts:105-112` | `ctx.webServer.register({kind:'prefix', path:'/orchestrator', handler})` |
| Client panel | `src/client/index.tsx:48-57` | `ctx.slots.inject('main'|'sidebar.panellist'|'plugins.row.config')`, `ctx.locale`, `ctx.sessions`, `ctx.uiWorkspace` |
| Session navigation | `src/navigation.ts:1-23`, `src/client/index.tsx:30-45` | `ctx.sessions.list/refresh`, `ctx.uiWorkspace.openSession(SessionId)` |
| Main-session id | `src/app/runtime.ts:104-105`, `src/app/http.ts:109` | own deterministic id `orchestrator-<key(stateDir)>` exposed as `state.masterId` |
| Panel polling | `src/client/provider.tsx:74,89` (`PanelProvider` default `interval = 5000`, `usePoll(…)`) | its own HTTP API, not session events |

Not used: `forge`, `dsh-session-*` UI, any conversation slot (`grep -rn "forge\|uiSession\|SessionProvider\|conversation\." src/` → no hits). So its chat surface is **the stock Conversation panel**; its plugin page is purely management (`docs/005-panel.md:1-30`).

**Reusable by a wrapper (proven):** Host session create-with-preset + deterministic id; `resolveAgent` + `agent.followup/inject`; preset rows in the bundle patch; `main` panel + `sidebar.panellist` icon; `ctx.sessions` + `ctx.uiWorkspace.openSession`; `ctx.webServer.register` for its own API; `plugins.row.config` for a config card.
**Must be duplicated:** all domain logic (ticket/trigger/execution state), the panel UI, the HTTP API, polling/dispatch machinery, its delivery dedupe (`AgentDelivery`).

---

## 4b. Direct answers (team-lead questions)

1. **`uiWorkspace.openSession(sessionId)` — yes, supported, and works from a `main` panel.** Service `ctx.uiWorkspace` (client service, injected beside `slots/locale/sessions`), method `openSession(target)`; `target` is a `SessionId` (durable subagent addresses also accepted — `DSH/dsh-client-ui-workspace/README.md:86`). Proven caller: the official repo calls it from its `main` panel component — `SA/src/client/index.tsx:30-38,53-54`; `MSG/lib/client.js:188-189` calls the same method from a shimmed click handler with a `typeof … === 'function'` guard. Sidebar seats are ordinary renderer-created components with the same injected services, so the call itself is not panel-restricted [minor speculation: no shipped sidebar seat is observed calling it].
2. **Finding a Session.** Client: `ctx.sessions.list.getSnapshot()` exposes `{ phase, byId }` and `refresh()` (`SA/src/navigation.ts:14-20`); rows carry `id`, `title`/`displayTitle` (`MSG/lib/client.js:27,31`) — but **no agentPreset** client-side. Host: `ctx.sessionQuery.listSessions()` returns `SessionRecord { header: SessionHeader, live, persisted }`, and `SessionHeader.agentPreset`/`cwd` are the preset/workspace fields (`inspect`); titles come from `readTitleSnapshots(ids)` or `sessionTitle` (`MSG/lib/index.js:86,312,323`). `filterSessions` supports only id/cwd/created-at/parent/availability — no preset/title predicate. Live preset: `agentPresets.presetForSession(session)` or the `agentPreset` projection (`SA/src/app/sessions.ts:274-280`).
3. **Embedding the real chat in a custom main panel: no.** `main` is a single-occupant keyed slot where `conversation` is the reserved key (`ui-layout/README.md:36`); session-scoped slots (`main.conversation` shell, `conversation.chat.flow`, `conversation.composer.bar`, `conversation.composer.dock`) are owned by that shell and bind the **render-position** Session (`ui-conversation/README.md:138-172,203`; `ui-chat/README.md:42,120`). Plugin halves cannot import chat packages (`practices.md:33,35`). Supported: navigate (`openSession`) + contribute seats, or right-sidebar per-session tab (`ui-sidebar-right/README.md:63,85-86`).
4. **Presets: creation does not require an id, but a pinned superagent does.** `SessionCreateRequest.agentPreset?` is optional (default applies); ids are exposed by the Host `ctx.agentPresets` service (`list/resolve/presetForSession/select`) and its `@Remote('list')` roster (`inspect`). A bundle declares presets by patch rows `@deepseek-ai/dsh-agent-preset` with `config.id/plugins` (`SA/cordis.patch.yml:20-21,125-126`; registry `README.md:48`) — and those presets are visible in the user picker, un-hidable (`SA/cordis.patch.yml:18`). A page can open a NEW session pinned to that preset: `ctx.uiWorkspace.startSession(workspace?, { agentPreset })` (`ui-workspace/README.md:92`; shipped Creator flow does this — `ui-agent-preset/README.md:50`), or host-side `sessionController.create({ agentPreset })` (`SA/src/app/sessions.ts:145`). The pin must happen at creation or before the first turn; afterwards `select` is refused (`inspect`; registry `README.md:60`).

---

## 5. Verdicts per approach

| # | Approach | Verdict | Concrete failure risks |
|---|---|---|---|
| A | **Chat-first wrapper**: page creates a new session pinned to its preset (`startSession({agentPreset})` or Host `create`), then hands the user to the stock Conversation; page remains as sidebar icon / management panel | **Supported (recommended)** | Preset is locked only before first turn — any early user message on a default-preset blank is unrecoverable (`agentPresets.select` desc). Bundle preset appears in the user's picker. `openSession` requires a ready catalog: `sessions.refresh()` first or it throws `not-ready`/`not-listed` (`SA/src/navigation.ts:14-22`). Deterministic session id must be plugin-owned and durable. |
| B | **Augment in place**: keep the real chat, add superagent UI through session-scoped seats — `conversation.composer.dock` status chip, `conversation.chat.node` rows via `ctx.uiConversation.events.register()`, right-sidebar tab type (`sidebar.right.pane.tab`) with a per-session panel | **Supported (documented)** | Only the *current* session's seats render (render-position binding); no cross-session rail. Row rendering must match host tokens; a throwing component blanks the slot (`practices.md:35`). Right-sidebar tabs are per-session state in localStorage — no global dashboard. |
| C | **Custom page hosts its own chat**: page reads/writes a session through Host `follow`/`observeEvent`/`prompt`/`state` + renders its own transcript+composer | **Hacky** (data plane supported, UI not reusable) | Must re-implement streaming assistant frames, submission echoes, queue/steer, approvals/`user-questions`, images/attachments, scroll anchoring, a11y — thousands of lines of host behavior; violates "framework drives; the plugin computes" (`practices.md:9`); two chat surfaces for one log risk divergent state and duplicate prompts. `main` panel unmounts while chat is shown, so long-running page state needs its own store. |
| D | **Embed the real Conversation component in the page** (embedded occurrence / Factory occurrence) | **Not supported / would be hacky** | No documented plugin API; plugin halves cannot import client packages (`practices.md:35`); `conversation.content` rejects an independently addressed session (`conversation/README.md:203`); the shell consumes the global `mainView` selection (`ui-workspace/README.md:86`), so an embedded copy would fight navigation. **[speculation]** rendering may be reachable; binding an arbitrary session is not. |
| E | **Mirror the official repo**: management panel in `main` + Host-owned master session + "Open session" navigation | **Supported and proven** (this is exactly what the prototype does) | Panel/main are mutually exclusive with chat: user must switch contexts. Panel state (polling own HTTP API) is a second source of truth vs. Session log. Prototype's `ctx/agents/inbox` usage compiled for `^0.2.1-alpha.2`; verify each service still exists in the profile (all listed above exist in `inspect` 0.2.2-rc.1). |

**Net answer:** a plugin page can host *the superagent's UI* and can *take the user to a real chat bound to the superagent's session*, but it cannot itself be the chat. The correct shape is: Host half owns sessions/presets/prompt+tool decoration; Client half is a `main`/`sidebar.panellist` panel that (1) creates or resolves its session with `agentPreset`, (2) calls `ctx.uiWorkspace.openSession(sessionId)` after `ctx.sessions.refresh()`, (3) optionally adds composer-dock/Chat-row/right-sidebar seats for in-chat affordances.

## 6. Uncertainties
- No live Client inspect: exact `SlotMap` props for `main`, `conversation.chat.node`, `conversation.composer.dock`, `sidebar.right.pane.tab` are quoted from README examples of shipped plugins, not from `Slots.listSubTree`.
- Exact `ISessions` TypeScript signature is unavailable (installed packages ship no `.d.ts` under `lib/types`); fields proved by compiling consumers (`SA/src/navigation.ts`, `MSG/lib/client.js`) and by `README` prose.
- Whether an "embedded occurrence" of the Conversation has any supported caller is unproven (`conversation/README.md:101` only).
- Superagent prototype's peer ranges target `0.2.1-alpha.2` (`SA/package.json:64-95`); it builds (`research/build-probe/logs/exp1-build.log`, EXIT=0) but runtime install/upgrade against 0.2.2-rc.1 was not exercised here (out of scope: no installs).
