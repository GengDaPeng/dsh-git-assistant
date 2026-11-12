/**
 * dsh-git-assistant — browser half.
 *
 * One panel, two seats:
 *  - conversation.view  → a tab next to 对话 / 轨迹 / 上下文 in a Session;
 *  - sidebar.panellist + main → a global entry in the left rail that opens the same panel.
 *
 * v0.2.0: source control (staged / changes / untracked), file browser, unified & split diff with a
 * light syntax highlighter, stage / unstage / discard / commit / amend / branch switch + create.
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-assistant',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dshGitAssistant'
    const ID = 'dsh-git-assistant'
    const STORAGE_REPOSITORY = 'dsh-git-assistant:repository'
    const POLL_MS = 5000
    const MAX_DIFF_LINES = 6000
    const MAX_PREVIEW_LINES = 5000

    const DICT = {
      zh: {
        label: 'Git', title: 'Git 工作台',
        changesTab: '更改', filesTab: '文件',
        staged: '已暂存的更改', unstaged: '更改', untracked: '未跟踪',
        noRepos: '没有找到 Git 仓库', noReposHint: '在 DSH 里添加一个 Git 仓库目录作为工作区后，这里会列出来。',
        loading: '读取中…', refresh: '刷新', pickRepo: '选择仓库',
        emptyDiff: '选择文件查看改动', emptyDiffHint: '点击左侧变更文件查看差异；也可以切到「文件」浏览仓库。',
        noDiff: '该文件没有可显示的差异', binary: '二进制文件，暂不展示内容',
        truncateNotice: '内容较大，已截断显示', readOnly: '只读预览',
        commitPlaceholder: '提交信息（Ctrl/⌘ + Enter 提交）', commit: '提交', amend: '修补上次提交',
        commitAmend: '提交（修改）', commitPush: '提交并推送', commitSync: '提交并同步',
        committedPushed: '已提交并推送', committedSynced: '已提交并同步',
        commitEmpty: '先写提交信息', committing: '提交中…',
        stageAll: '全部暂存', unstageAll: '全部取消暂存', stage: '暂存', unstage: '取消暂存', discard: '丢弃',
        discardTitle: '丢弃更改？', discardTracked: '将丢弃 {file} 的工作区改动，无法撤销。',
        discardUntracked: '将删除未跟踪文件 {file}，无法撤销。', discardAllTitle: '丢弃全部更改？',
        discardAllMessage: '将丢弃 {count} 个文件的更改（含未跟踪文件），无法撤销。',
        cancel: '取消', confirm: '确认',
        switched: '已切换到 {branch}', created: '已创建分支 {branch}', stagedDone: '已暂存 {count} 个文件',
        unstagedDone: '已取消暂存 {count} 个文件', committed: '已提交', branchPlaceholder: '新分支名…', createBranch: '新建分支',
        switchConfirmTitle: '切换分支？', switchConfirm: '当前有未提交的更改，切换后会带到 {branch}。继续？',
        filterPlaceholder: '筛选文件…', filesLoading: '读取文件列表…', noFiles: '没有文件',
        filesTruncated: '文件过多，仅显示前 {count} 个',
        conflicts: '冲突', ahead: '待推送', behind: '待拉取', detached: '游离 HEAD',
        loadError: '读取失败', omitted: '另有 {count} 个未跟踪文件未列出',
        unified: '统一', split: '并排', viewLabel: '视图',
        worktree: '工作树', mainWorktree: '主工作树',
        noBranch: '无分支',
        viewAll: '查看全部更改',
        discardAll: '放弃全部更改',
        allChanges: '全部更改',
        allStaged: '全部已暂存',
        allDiffLoading: '正在读取全部差异…',
        allDiffLimited: '仅显示前 {count} 个文件',
        resize: '拖动调整宽度',
        worktrees: '工作树',
        cleanTree: '工作区干净，没有更改',
        syncChanges: '同步更改',
        graphTitle: '图形',
        graphLoading: '读取提交历史…',
        graphEmpty: '没有提交记录',
        syncing: '同步中…',
        detached: '游离 HEAD',
        pickChat: '选择聊天',
        newChat: '新建边聊',
        chatEmpty: '还没有消息',
        send: '发送',
        chatCollapse: '收起聊天',
        chatExpand: '展开聊天',
        chatHeader: '边聊',
        rightbarHint: '在右侧栏中打开 Git 工作台；展开宽度可看完整 diff。',
        quoteAction: '引用文本',
        quoted: '已引用到对话输入框',
        quoteCopied: '已复制选中文本，可粘贴到对话',
        dirtyCount: '{count} 个文件有改动',
      },
      en: {
        label: 'Git', title: 'Git Workbench',
        changesTab: 'Changes', filesTab: 'Files',
        staged: 'Staged changes', unstaged: 'Changes', untracked: 'Untracked',
        noRepos: 'No Git repository found', noReposHint: 'Add the directory of a Git repository as a DSH workspace and it appears here.',
        loading: 'Loading…', refresh: 'Refresh', pickRepo: 'Pick repository',
        emptyDiff: 'Select a file to see its diff', emptyDiffHint: 'Click a changed file on the left, or switch to Files to browse the repository.',
        noDiff: 'This file has no diff to show', binary: 'Binary file; content is not rendered',
        truncateNotice: 'Content truncated', readOnly: 'Read-only preview',
        commitPlaceholder: 'Commit message (Ctrl/⌘ + Enter to commit)', commit: 'Commit', amend: 'Amend last commit',
        commitAmend: 'Commit (amend)', commitPush: 'Commit & push', commitSync: 'Commit & sync',
        committedPushed: 'Committed and pushed', committedSynced: 'Committed and synced',
        commitEmpty: 'Write a commit message first', committing: 'Committing…',
        stageAll: 'Stage all', unstageAll: 'Unstage all', stage: 'Stage', unstage: 'Unstage', discard: 'Discard',
        discardTitle: 'Discard changes?', discardTracked: 'Working-tree changes in {file} will be lost. This cannot be undone.',
        discardUntracked: 'Untracked file {file} will be deleted. This cannot be undone.', discardAllTitle: 'Discard all changes?',
        discardAllMessage: 'Changes in {count} files (including untracked) will be lost. This cannot be undone.',
        cancel: 'Cancel', confirm: 'Confirm',
        switched: 'Switched to {branch}', created: 'Created branch {branch}', stagedDone: 'Staged {count} files',
        unstagedDone: 'Unstaged {count} files', committed: 'Committed', branchPlaceholder: 'New branch name…', createBranch: 'Create branch',
        switchConfirmTitle: 'Switch branch?', switchConfirm: 'There are uncommitted changes; they will follow you to {branch}. Continue?',
        filterPlaceholder: 'Filter files…', filesLoading: 'Loading files…', noFiles: 'No files',
        filesTruncated: 'Too many files; showing the first {count}',
        conflicts: 'conflicts', ahead: 'to push', behind: 'to pull', detached: 'Detached HEAD',
        loadError: 'Failed to load', omitted: '{count} more untracked files not listed',
        unified: 'Unified', split: 'Split', viewLabel: 'View',
        worktree: 'worktree', mainWorktree: 'main worktree',
        noBranch: 'no branch',
        viewAll: 'View all changes',
        discardAll: 'Discard all changes',
        allChanges: 'All changes',
        allStaged: 'All staged changes',
        allDiffLoading: 'Loading all diffs…',
        allDiffLimited: 'Showing the first {count} files',
        resize: 'Drag to resize',
        worktrees: 'Worktrees',
        cleanTree: 'Working tree clean',
        syncChanges: 'Sync changes',
        graphTitle: 'Graph',
        graphLoading: 'Loading history…',
        graphEmpty: 'No commits',
        syncing: 'Syncing…',
        detached: 'Detached HEAD',
        pickChat: 'Pick chat',
        newChat: 'New side chat',
        chatEmpty: 'No messages yet',
        send: 'Send',
        chatCollapse: 'Collapse chat',
        chatExpand: 'Expand chat',
        chatHeader: 'Side chat',
        rightbarHint: 'Open the Git workbench in the right sidebar; widen it for the full diff.',
        quoteAction: 'Quote',
        quoted: 'Quoted into the chat composer',
        quoteCopied: 'Selection copied — paste it into the chat',
        dirtyCount: '{count} changed files',
      },
    }

    const T = {
      text: 'var(--dsw-alias-label-primary, inherit)',
      ink2: 'var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 68%, transparent))',
      muted: 'var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 54%, transparent))',
      subtle: 'var(--dsw-alias-label-caption, color-mix(in srgb, currentColor 40%, transparent))',
      inverse: 'var(--dsw-alias-label-primary-inverted, #fff)',
      primary: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe))',
      primaryHover: 'var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #4d6bfe))',
      accent: 'var(--dsw-alias-link, var(--dsw-alias-brand-primary, #4d6bfe))',
      border: 'var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 15%, transparent))',
      borderSoft: 'var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 9%, transparent))',
      lineStrong: 'var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 26%, transparent))',
      hover: 'var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 7%, transparent))',
      selected: 'var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 11%, transparent))',
      card: 'var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 5%, transparent))',
      glass: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1f1f22) 72%, transparent)',
      menu: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, Canvas))',
      layer: 'var(--dsw-alias-bg-layer-1, color-mix(in srgb, currentColor 4%, transparent))',
      layer2: 'var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 6%, transparent))',
      success: 'var(--dsw-alias-state-success-primary, #3fb950)',
      error: 'var(--dsw-alias-state-error-primary, #f85149)',
      warn: 'var(--dsw-alias-state-warn-primary, #c69026)',
      brand: 'var(--dsw-alias-brand-primary, #58a6ff)',
      mono: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      sans: 'var(--dsw-font-family, inherit)',
      serif: '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "Iowan Old Style", Palatino, Georgia, serif',
      shadowSoft: 'var(--dsw-elevation-soft, 0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.07))',
      shadowProminent: 'var(--dsw-elevation-prominent, 0 18px 48px rgba(0,0,0,.22))',
      ease: 'cubic-bezier(.2,.8,.2,1)',
      rSm: 8, rMd: 12, rLg: 16, rXl: 20, pill: 999,
    }

    const ADD_BG = 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #3fb950) 10%, transparent)'
    const DEL_BG = 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #f85149) 10%, transparent)'
    const STATUS_COLOR = { M: T.warn, A: T.success, U: T.success, D: T.error, R: T.brand, C: T.error, '?': T.success }
    const MONO = T.mono

    function basename(path) {
      if (typeof path !== 'string' || path.length === 0) return '—'
      const parts = path.replace(/\/+$/, '').split('/')
      return parts[parts.length - 1] || path
    }

    function splitPath(path) {
      const index = path.lastIndexOf('/')
      return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
    }

    async function api(path, params) {
      const url = new URL(`/git-assistant/api${path}`, window.location.origin)
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
      }
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
      return body
    }

    async function apiPost(path, body) {
      const response = await fetch(new URL(`/git-assistant/api${path}`, window.location.origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
    }

    const DRAG_TYPE = 'application/x-dsh-git-assistant-file'
    let dragPayload = null

    /** Locate DSH's composer card inside the conversation area for this Session. */
    function composerCardFor(target, sessionId) {
      if (!(target instanceof Element)) return null
      const conversation = target.closest('[data-conversation-content]')
      if (!conversation || conversation.dataset.conversationSession !== sessionId) return null
      const card = conversation.querySelector('[data-composer-card]')
      return card && card.querySelector('[data-composer-input][contenteditable="true"]') ? card : null
    }

    function readStoredRepository() {
      try { return window.localStorage.getItem(STORAGE_REPOSITORY) ?? '' } catch { return '' }
    }

    /* ── syntax highlighting (lightweight, line based) ──────────────── */

    const LANG_BY_EXT = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
      json: 'json', py: 'py', rs: 'rs', go: 'go', sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh',
      css: 'css', scss: 'css', less: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html',
      vue: 'html', svelte: 'html', md: 'md', markdown: 'md', yml: 'yaml', yaml: 'yaml',
      toml: 'toml', sql: 'sql', java: 'java', kt: 'java', c: 'c', h: 'c', cpp: 'c', cc: 'c',
      hpp: 'c', cs: 'js', rb: 'sh', php: 'js', lua: 'sh', ini: 'toml', conf: 'sh', env: 'sh',
      txt: undefined, lock: undefined,
    }

    const KEYWORDS = {
      js: 'const let var function return if else for while do break continue class extends new this super import from export default async await try catch finally throw typeof instanceof in of delete void yield static get set null true false undefined NaN',
      ts: 'const let var function return if else for while do break continue class extends new this super import from export default async await try catch finally throw typeof instanceof keyof infer as satisfies interface type enum namespace declare readonly public private protected abstract implements null true false undefined never unknown any string number boolean',
      json: 'true false null',
      py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda None True False and or not in is global nonlocal yield async await self',
      rs: 'fn let mut const struct enum impl trait pub use mod match if else for while loop return break continue async await move where self Self Some None Ok Err true false',
      go: 'func package import var const type struct interface map chan go defer if else for range return switch case default break continue select nil true false string int int64 float64 bool byte rune error',
      sh: 'if then else elif fi for while do done case esac function return export local readonly source echo printf cd test set unset true false',
      css: 'important media import supports keyframes from to and not only',
      html: 'DOCTYPE html head body div span script style link meta title class id href src',
      yaml: 'true false null yes no on off',
      toml: 'true false',
      sql: 'select from where insert into update delete create table drop alter index join left right inner outer on group by order limit offset values set and or not null true false',
      java: 'public private protected class interface extends implements import package static final new return if else for while do break continue try catch finally throw throws void int long double float boolean char byte short String true false null this super abstract synchronized volatile transient native',
    }

    const KEYWORD_SETS = new Map()
    for (const [language, words] of Object.entries(KEYWORDS)) KEYWORD_SETS.set(language, new Set(words.split(' ')))

    const COMMENT_PREFIX = { js: '//', ts: '//', json: null, py: '#', rs: '//', go: '//', sh: '#', css: null, html: null, yaml: '#', toml: '#', sql: '--', java: '//', c: '//' }

    function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

    function languageOf(path) {
      const dot = path.lastIndexOf('.')
      if (dot < 0) return undefined
      return LANG_BY_EXT[path.slice(dot + 1).toLowerCase()]
    }

    const tokenCache = new Map()

    /** Tokenize one line into [{ text, kind }] where kind ∈ keyword|string|comment|number|plain. */
    function tokenize(text, language) {
      const keywords = KEYWORDS[language]
      if (!keywords) return [{ text, kind: 'plain' }]
      const cacheKey = `${language}\u0000${text}`
      const cached = tokenCache.get(cacheKey)
      if (cached) return cached
      const comment = COMMENT_PREFIX[language]
      let commentPart = ''
      if (comment) commentPart = `${escapeRegExp(comment)}.*$|`
      const pattern = new RegExp(
        `(${commentPart}'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'|"[^"\\\\]*(?:\\\\.[^"\\\\]*)*"|\`[^\`\\\\]*(?:\\\\.[^\`\\\\]*)*\`)` +
        `|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)|([A-Za-z_$][\\w$]*)`, 'g')
      const tokens = []
      let last = 0
      let match
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) tokens.push({ text: text.slice(last, match.index), kind: 'plain' })
        if (match[1] !== undefined) tokens.push({ text: match[1], kind: comment && match[1].startsWith(comment) ? 'comment' : 'string' })
        else if (match[2] !== undefined) tokens.push({ text: match[2], kind: 'number' })
        else if (match[3] !== undefined) {
          const word = match[3]
          tokens.push({ text: word, kind: KEYWORD_SETS.get(language)?.has(word) ? 'keyword' : /^(true|false|null|nil|None|True|False)$/.test(word) ? 'literal' : 'plain' })
        }
        last = pattern.lastIndex
      }
      if (last < text.length) tokens.push({ text: text.slice(last), kind: 'plain' })
      if (tokens.length === 0) tokens.push({ text, kind: 'plain' })
      if (tokenCache.size > 20000) tokenCache.clear()
      tokenCache.set(cacheKey, tokens)
      return tokens
    }

    function tokenStyle(kind, baseColor) {
      if (kind === 'comment') return { color: T.muted, opacity: 0.75 }
      if (kind === 'string') return { color: T.success, opacity: 0.85 }
      if (kind === 'number') return { color: T.warn, opacity: 0.9 }
      if (kind === 'keyword') return { color: T.brand, opacity: 0.9 }
      if (kind === 'literal') return { color: T.warn, opacity: 0.9 }
      return { color: baseColor }
    }

    function CodeText({ text, language, baseColor, highlight }) {
      if (!highlight || !language) return h('span', { style: { color: baseColor } }, text)
      const tokens = tokenize(text, language)
      if (tokens.length === 1) return h('span', { style: { color: baseColor } }, text)
      return h('span', {}, tokens.map((token, index) => h('span', { key: index, style: tokenStyle(token.kind, baseColor) }, token.text)))
    }

    /* ── diff row building ──────────────────────────────────────────── */

    function unifiedRows(hunks, language, highlight) {
      const rows = []
      let budget = MAX_DIFF_LINES
      hunks.forEach((hunk, hunkIndex) => {
        if (budget <= 0) return
        rows.push({ kind: 'hunk', key: `h:${hunkIndex}`, label: `${hunk.header}${hunk.section ? `  ${hunk.section}` : ''}` })
        let oldNumber = hunk.oldStart
        let newNumber = hunk.newStart
        hunk.lines.forEach((line, lineIndex) => {
          if (budget <= 0) return
          budget -= 1
          const isAdd = line.kind === 'add'
          const isDel = line.kind === 'del'
          rows.push({
            kind: 'line', key: `l:${hunkIndex}:${lineIndex}`,
            oldNumber: isAdd ? '' : String(oldNumber++),
            newNumber: isDel ? '' : String(newNumber++),
            sign: isAdd ? '+' : isDel ? '−' : ' ',
            kindOfLine: line.kind,
            text: line.text,
            language, highlight,
          })
        })
      })
      if (budget <= 0) rows.push({ kind: 'notice', key: 'budget' })
      return rows
    }

    function splitRows(hunks, language, highlight) {
      const rows = []
      let budget = MAX_DIFF_LINES
      hunks.forEach((hunk, hunkIndex) => {
        if (budget <= 0) return
        rows.push({ kind: 'hunk', key: `h:${hunkIndex}`, label: `${hunk.header}${hunk.section ? `  ${hunk.section}` : ''}` })
        let oldNumber = hunk.oldStart
        let newNumber = hunk.newStart
        let index = 0
        const lines = hunk.lines
        while (index < lines.length && budget > 0) {
          const line = lines[index]
          if (line.kind === 'ctx') {
            budget -= 1
            rows.push({ kind: 'pair', key: `p:${hunkIndex}:${index}`, left: { number: String(oldNumber++), text: line.text, kind: 'ctx' }, right: { number: String(newNumber++), text: line.text, kind: 'ctx' }, language, highlight })
            index += 1
            continue
          }
          const dels = []
          const adds = []
          while (index < lines.length && lines[index].kind === 'del') { dels.push(lines[index]); index += 1 }
          while (index < lines.length && lines[index].kind === 'add') { adds.push(lines[index]); index += 1 }
          const count = Math.max(dels.length, adds.length)
          for (let offset = 0; offset < count && budget > 0; offset += 1) {
            budget -= 1
            const left = dels[offset]
            const right = adds[offset]
            rows.push({
              kind: 'pair', key: `p:${hunkIndex}:${index}:${offset}`,
              left: left ? { number: String(oldNumber++), text: left.text, kind: 'del' } : undefined,
              right: right ? { number: String(newNumber++), text: right.text, kind: 'add' } : undefined,
              language, highlight,
            })
          }
        }
      })
      if (budget <= 0) rows.push({ kind: 'notice', key: 'budget' })
      return rows
    }

    /* ── data hooks ─────────────────────────────────────────────────── */

    function useRepositories() {
      const [state, setState] = useState({ phase: 'loading', items: [], error: null })
      const [version, setVersion] = useState(0)
      useEffect(() => {
        let live = true
        setState(previous => ({ ...previous, phase: previous.items.length > 0 ? 'ready' : 'loading' }))
        api('/repositories')
          .then(data => {
            if (!live) return
            setState({ phase: 'ready', items: Array.isArray(data?.repositories) ? data.repositories : [], error: null })
          })
          .catch(error => { if (live) setState({ phase: 'error', items: [], error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [version])
      return [state, () => setVersion(value => value + 1)]
    }

    function useStatus(repository, dataVersion) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const [tick, setTick] = useState(0)
      const path = repository?.path
      useEffect(() => {
        if (!path) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState(previous => ({ phase: previous.data ? 'refreshing' : 'loading', data: previous.data, error: null }))
        api('/status', { path })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState(previous => ({ phase: 'error', data: previous.data, error: String(error?.message ?? error) })) })
        return () => { live = false }
      }, [path, tick, dataVersion])
      useEffect(() => {
        if (!path) return undefined
        const timer = setInterval(() => { if (!document.hidden) setTick(value => value + 1) }, POLL_MS)
        const wake = () => setTick(value => value + 1)
        window.addEventListener('focus', wake)
        return () => { clearInterval(timer); window.removeEventListener('focus', wake) }
      }, [path])
      return [state, () => setTick(value => value + 1)]
    }

    function useBranches(repository, dataVersion) {
      const [state, setState] = useState({ phase: 'idle', items: [] })
      const path = repository?.path
      useEffect(() => {
        if (!path) { setState({ phase: 'idle', items: [] }); return undefined }
        let live = true
        setState(previous => ({ ...previous, phase: 'loading' }))
        api('/branches', { path })
          .then(data => { if (live) setState({ phase: 'ready', items: Array.isArray(data?.branches) ? data.branches : [] }) })
          .catch(() => { if (live) setState({ phase: 'error', items: [] }) })
        return () => { live = false }
      }, [path, dataVersion])
      return state
    }

    function useFiles(repository, dataVersion, enabled) {
      const [state, setState] = useState({ phase: 'idle', files: [], total: 0, truncated: false })
      const path = repository?.path
      useEffect(() => {
        if (!path) { setState({ phase: 'idle', files: [], total: 0, truncated: false }); return undefined }
        if (!enabled) return undefined
        let live = true
        setState(previous => ({ ...previous, phase: previous.files.length > 0 ? 'refreshing' : 'loading' }))
        api('/files', { path })
          .then(data => {
            if (!live) return
            setState({ phase: 'ready', files: Array.isArray(data?.files) ? data.files : [], total: data?.total ?? 0, truncated: Boolean(data?.truncated) })
          })
          .catch(() => { if (live) setState({ phase: 'error', files: [], total: 0, truncated: false }) })
        return () => { live = false }
      }, [path, dataVersion, enabled])
      return state
    }

    function useDiff(repository, selection, dataVersion) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const [version, setVersion] = useState(0)
      const path = repository?.path
      const active = selection?.kind === 'diff' || selection?.kind === 'commit-diff'
      useEffect(() => {
        if (!path || !active) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', data: null, error: null })
        const request = selection?.kind === 'commit-diff'
          ? api('/commit-diff', { path, hash: selection.hash, file: selection.path })
          : api('/diff', { path, file: selection.path, staged: selection.staged ? '1' : '0' })
        request
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, active, selection?.path, selection?.staged, selection?.hash, version, dataVersion])
      return [state, () => setVersion(value => value + 1)]
    }

    function useFilePreview(repository, selection) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const path = repository?.path
      const active = selection?.kind === 'file'
      useEffect(() => {
        if (!path || !active) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', data: null, error: null })
        api('/file', { path, file: selection.path })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, active, selection?.path])
      return state
    }

    /** Fetch one diff per changed file for the "all changes" view (bounded). */
    function useAllDiffs(repository, selection, statusData, dataVersion) {
      const [state, setState] = useState({ phase: 'idle', entries: [], error: null })
      const [version, setVersion] = useState(0)
      const active = selection?.kind === 'all'
      const scopes = active
        ? (selection.staged ? (statusData?.staged ?? []) : [...(statusData?.unstaged ?? []), ...(statusData?.untracked ?? [])])
        : []
      const signature = scopes.map(entry => entry.path).join('\n')
      useEffect(() => {
        if (!repository?.path || !active || scopes.length === 0) { setState({ phase: 'idle', entries: [], error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', entries: [], error: null })
        const limited = scopes.slice(0, 30).map(entry => entry.path)
        Promise.all(limited.map(file => api('/diff', { path: repository.path, file, staged: selection.staged ? '1' : '0' })
          .then(data => ({ file, entry: data?.files?.[0] }))
          .catch(error => ({ file, error: String(error?.message ?? error) }))))
          .then(entries => { if (live) setState({ phase: 'ready', entries, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', entries: [], error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [repository?.path, active, selection?.staged, signature, version, dataVersion])
      return [state, () => setVersion(value => value + 1)]
    }

    function useWorktrees(repository, dataVersion) {
      const [state, setState] = useState({ phase: 'idle', items: [] })
      const [version, setVersion] = useState(0)
      const path = repository?.path
      useEffect(() => {
        if (!path) { setState({ phase: 'idle', items: [] }); return undefined }
        let live = true
        setState(previous => ({ ...previous, phase: 'loading' }))
        api('/worktrees', { path })
          .then(data => { if (live) setState({ phase: 'ready', items: Array.isArray(data?.worktrees) ? data.worktrees : [] }) })
          .catch(() => { if (live) setState({ phase: 'error', items: [] }) })
        return () => { live = false }
      }, [path, version, dataVersion])
      return [state, () => setVersion(value => value + 1)]
    }

    function useStatusAt(path, enabled) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const [version, setVersion] = useState(0)
      useEffect(() => {
        if (!path || !enabled) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState(previous => ({ ...previous, phase: previous.data ? 'ready' : 'loading' }))
        api('/status', { path })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, enabled, version])
      return [state, () => setVersion(value => value + 1)]
    }

    /** One worktree is one complete operable area: header, commit box, staged/changed lists. */
    function WorktreeCard({ t, item, defaultOpen, onOpen, onNotify, selectedPath, onChanged, onSelect }) {
      const [open, setOpen] = useState(defaultOpen)
      const [status, refreshStatus] = useStatusAt(item.path, open)
      const [busy, setBusy] = useState(false)
      const [expanded, setExpanded] = useState(true)
      const [expandedDirs, setExpandedDirs] = useState(() => new Set())
      const [hoveredKey, setHoveredKey] = useState(undefined)
      const messageRef = useRef(null)
      const data = status.data
      const behind = status.data?.behind ?? item.behind ?? 0
      const needsSync = behind > 0
      const stagedFiles = data?.staged ?? []
      const changeFiles = [...(data?.unstaged ?? []), ...(data?.untracked ?? [])]
      const stagedTree = useMemo(() => fileRows(stagedFiles.map(file => ({ ...file, __staged: true }))), [data])
      const changeTree = useMemo(() => fileRows(changeFiles), [data])
      const stagedStatus = useMemo(() => new Map(stagedFiles.map(file => [file.path, file.status])), [data])
      const changeStatus = useMemo(() => new Map(changeFiles.map(file => [file.path, file.status])), [data])
      const toggleDir = path => setExpandedDirs(previous => {
        const next = new Set(previous)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      const runAction = async (work) => {
        setBusy(true)
        try { await work() } catch (error) { onNotify?.(String(error?.message ?? error), 'error') }
        finally { setBusy(false); refreshStatus() }
      }
      const sync = () => runAction(async () => {
        await apiPost('/sync', { path: item.path })
        onChanged?.()
        onNotify?.(t('syncChanges'))
      })
      const commit = () => {
        const message = messageRef.current?.value ?? ''
        if (!message.trim()) { onNotify?.(t('commitEmpty'), 'error'); return }
        runAction(async () => {
          await apiPost('/commit', { path: item.path, message, action: 'commit' })
          if (messageRef.current) messageRef.current.value = ''
          onNotify?.(t('committed'))
        })
      }
      const row = (file, staged, index) => h('div', {
        key: `${staged ? 's' : 'w'}:${file.path}:${index}`,
        title: file.path,
        onClick: () => onOpen(staged ? { ...file, __staged: true } : file, item.path),
        style: {
          display: 'flex', alignItems: 'center', gap: 6, minHeight: 21, padding: '1px 8px 1px 22px',
          cursor: 'pointer', borderRadius: T.rSm,
          background: selectedPath === file.path && !staged ? T.selected : 'transparent',
        },
        onMouseEnter: event => { event.currentTarget.style.background = T.hover },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
      },
        h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          file.oldPath ? `${file.path} ← ${file.oldPath}` : file.path),
        h(IconAction, {
          label: staged ? t('unstage') : t('stage'),
          disabled: busy,
          onClick: event => { event.stopPropagation(); runAction(() => apiPost(staged ? '/unstage' : '/stage', { path: item.path, files: [file.path] })) },
        }, staged ? h(IconMinus) : h(IconPlus)),
        h('span', { style: { width: 14, textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: STATUS_COLOR[file.status] ?? T.subtle } }, file.status ?? ''))
      return h('div', {
        style: { margin: '6px 8px', borderRadius: T.rMd, border: `0.5px solid ${T.border}`, background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, currentColor) 34%, transparent)', overflow: 'hidden' },
      },
        h('div', {
          onClick: () => { setOpen(value => !value); onSelect?.(item.path) },
          style: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 28, padding: '0 8px', cursor: 'pointer', borderBottom: open ? `0.5px solid ${T.borderSoft}` : 'none' },
        },
          h(Chevron, { open, size: 9 }),
          h('span', { style: { fontSize: 12, fontWeight: 600, color: T.text } }, item.name ?? item.path.split('/').pop()),
          h('span', { style: { fontSize: 11, color: T.ink2, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 } }, item.branch ?? t('detached')),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.muted, whiteSpace: 'nowrap' } }, `${item.behind > 0 ? `↓${item.behind}` : ''}${item.ahead > 0 ? ` ↑${item.ahead}` : ''}`),
          h(IconAction, { label: t('refresh'), onClick: event => { event.stopPropagation(); refreshStatus() } }, h(RefreshIcon, {}))),
        open ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, padding: '6px 8px 8px' } },
          h('textarea', {
            ref: messageRef, rows: 2, placeholder: `${t('commitPlaceholder')} · ${item.branch ?? ''}`,
            style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'transparent', color: 'inherit', border: `0.5px solid ${T.border}`, borderRadius: T.rSm, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', outline: 'none', lineHeight: '17px' },
            onKeyDown: event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit() } },
          }),
          h('button', {
            type: 'button', onClick: needsSync ? sync : commit, disabled: busy || (!needsSync && !data),
            style: {
              appearance: 'none', border: `0.5px solid ${T.border}`, borderRadius: T.rSm, height: 27,
              background: needsSync ? T.selected : 'transparent', color: T.ink2, fontSize: 11.5,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            },
          }, busy ? (needsSync ? t('syncing') : t('committing')) : needsSync ? `⟳ ${t('syncChanges')} ${behind}↓` : `✓ ${t('commit')}`),
          stagedFiles.length > 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0 0' } },
            h('span', { style: { fontSize: 10.5, fontWeight: 600, color: T.muted } }, t('staged')),
            h('span', { style: { flex: 1 } }),
            h('span', { style: { fontSize: 10.5, color: T.subtle } }, String(stagedFiles.length))) : null,
          stagedFiles.length > 0
            ? h(TreeRows, {
                node: stagedTree, depth: 0, expandedDirs, onToggleDir: toggleDir,
                onOpen: file => onOpen(file, item.path),
                selectedKey: selectedPath ? `s:${selectedPath}` : undefined,
                actionsFor: file => h(IconAction, {
                  label: t('unstage'), disabled: busy,
                  onClick: event => { event.stopPropagation(); runAction(() => apiPost('/unstage', { path: item.path, files: [file.path] })) },
                }, h(IconMinus)),
                statusByPath: stagedStatus, showStatus: true,
                hoveredKey, onHoverKey: setHoveredKey,
              })
            : null,
          changeFiles.length > 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0 0' } },
            h('span', { style: { fontSize: 10.5, fontWeight: 600, color: T.muted } }, t('changes')),
            h('span', { style: { flex: 1 } }),
            h(IconAction, { label: t('stageAll'), disabled: busy || changeFiles.length === 0, onClick: () => runAction(() => apiPost('/stage', { path: item.path, files: changeFiles.map(file => file.path) })) }, h(IconPlus)),
            h('span', { style: { fontSize: 10.5, color: T.subtle } }, String(changeFiles.length))) : null,
          changeFiles.length > 0
            ? h(TreeRows, {
                node: changeTree, depth: 0, expandedDirs, onToggleDir: toggleDir,
                onOpen: file => onOpen(file, item.path),
                selectedKey: selectedPath ? `f:${selectedPath}` : undefined,
                actionsFor: file => h('span', { style: { display: 'inline-flex', gap: 1 } },
                  h(IconAction, {
                    label: t('discard'), danger: true, disabled: busy,
                    onClick: event => { event.stopPropagation(); runAction(() => apiPost('/discard', { path: item.path, files: [file.path] })) },
                  }, h(IconUndo)),
                  h(IconAction, {
                    label: t('stage'), disabled: busy,
                    onClick: event => { event.stopPropagation(); runAction(() => apiPost('/stage', { path: item.path, files: [file.path] })) },
                  }, h(IconPlus))),
                statusByPath: changeStatus, showStatus: true,
                hoveredKey, onHoverKey: setHoveredKey,
              })
            : null,
          stagedFiles.length === 0 && changeFiles.length === 0
            ? h('div', { style: { fontSize: 10.5, color: T.subtle, padding: '2px 0 2px 2px' } }, t('cleanTree'))
            : null,
          status.phase === 'loading' ? h('div', { style: { fontSize: 10.5, color: T.muted } }, t('loading')) : null,
          status.phase === 'error' ? h('div', { style: { fontSize: 10.5, color: T.error } }, status.error) : null) : null)
    }

    const LANE_COLORS = ['#60a5fa', '#fbbf24', '#34d399', '#f472b6', '#fb923c', '#38bdf8', '#a78bfa', '#f87171']
    const LANE_WIDTH = 14
    const ROW_HEIGHT = 22
    const laneX = column => column * LANE_WIDTH + LANE_WIDTH / 2
    const laneColor = column => LANE_COLORS[column % LANE_COLORS.length]

    /**
     * Lane assignment over topo-ordered commits, in a renderer-friendly shape: every row knows which lanes pass
     * straight through, which lanes join into its node, and which lanes start from the node for extra parents.
     */
    function computeGraphLanes(commits) {
      const later = new Set()
      for (const row of commits) for (const parent of row.parents) later.add(parent)
      let colorCursor = 0
      const nextColor = () => colorCursor++ % LANE_COLORS.length
      let lanes = []
      const rows = []
      let maxLaneCount = 1
      for (const row of commits) {
        let nodeIndex = lanes.findIndex(lane => lane.hash === row.oid)
        const wasAwaited = nodeIndex !== -1
        if (!wasAwaited) {
          lanes.push({ hash: row.oid, color: nextColor() })
          nodeIndex = lanes.length - 1
        }
        const oldLanes = lanes.slice()
        const oldNodeIndex = nodeIndex
        const nodeColor = oldLanes[oldNodeIndex].color
        const joins = []
        const working = []
        for (let index = 0; index < oldLanes.length; index += 1) {
          if (index === oldNodeIndex) continue
          if (oldLanes[index].hash === row.oid) { joins.push(index); continue }
          working.push({ hash: oldLanes[index].hash, color: oldLanes[index].color, oldIndex: index })
        }
        const nodeSlot = oldNodeIndex - joins.filter(index => index < oldNodeIndex).length
        const parents = row.parents.filter(parent => later.has(parent))
        const first = parents[0]
        const rest = parents.slice(1)
        let newNodeIndex = -1
        if (first) {
          newNodeIndex = Math.min(nodeSlot, working.length)
          working.splice(newNodeIndex, 0, { hash: first, color: nodeColor, oldIndex: -1 })
        }
        const starts = []
        let insertAt = newNodeIndex === -1 ? nodeSlot : newNodeIndex + 1
        for (const parent of rest) {
          const existing = working.findIndex(entry => entry.hash === parent)
          if (existing !== -1) { starts.push(existing); continue }
          working.splice(insertAt, 0, { hash: parent, color: nextColor(), oldIndex: -2 })
          starts.push(insertAt)
          insertAt += 1
        }
        const survivorMap = new Map()
        for (let index = 0; index < working.length; index += 1) {
          if (working[index].oldIndex >= 0) survivorMap.set(working[index].oldIndex, index)
        }
        const newLanes = working.map(entry => ({ hash: entry.hash, color: entry.color }))
        const laneCount = Math.max(oldLanes.length, newLanes.length, oldNodeIndex + 1, newNodeIndex + 1, ...starts.map(index => index + 1), 1)
        maxLaneCount = Math.max(maxLaneCount, laneCount)
        rows.push({
          oid: row.oid, oldLanes, newLanes, oldNodeIndex, newNodeIndex, wasAwaited, joins, starts, survivorMap,
          nodeColor, hasFirstParent: Boolean(first), laneCount,
        })
        lanes = newLanes
      }
      return { rows, maxLaneCount }
    }

    /** SVG shapes for one row of the commit graph, at a given lane spacing. */
    function graphRowShapes(row, spacing) {
      const shapes = []
      const laneX = column => column * spacing + spacing / 2
      const stroke = { fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round' }
      const mid = ROW_HEIGHT / 2
      const nodeX = laneX(row.newNodeIndex === -1 ? row.oldNodeIndex : row.newNodeIndex)
      for (const [oldIndex, newIndex] of row.survivorMap) {
        const color = LANE_COLORS[row.oldLanes[oldIndex].color]
        const x1 = laneX(oldIndex)
        const x2 = laneX(newIndex)
        if (oldIndex === newIndex) {
          shapes.push(h('line', { key: `p${oldIndex}`, x1, y1: 0, x2, y2: ROW_HEIGHT, stroke: color, ...stroke }))
        } else {
          shapes.push(h('path', {
            key: `p${oldIndex}`, d: `M ${x1} 0 C ${x1} ${mid} ${x2} ${mid} ${x2} ${ROW_HEIGHT}`,
            stroke: color, ...stroke,
          }))
        }
      }
      for (const join of row.joins) {
        const color = LANE_COLORS[row.oldLanes[join].color]
        const x = laneX(join)
        shapes.push(h('path', {
          key: `j${join}`, d: `M ${x} 0 C ${x} ${mid} ${nodeX} 0 ${nodeX} ${mid}`,
          stroke: color, ...stroke,
        }))
      }
      const nodeColor = LANE_COLORS[row.nodeColor]
      if (row.wasAwaited) {
        const topX = laneX(row.oldNodeIndex)
        if (topX === nodeX) shapes.push(h('line', { key: 'nt', x1: nodeX, y1: 0, x2: nodeX, y2: mid, stroke: nodeColor, ...stroke }))
        else shapes.push(h('path', { key: 'nt', d: `M ${topX} 0 C ${topX} ${mid} ${nodeX} ${mid} ${nodeX} ${mid}`, stroke: nodeColor, ...stroke }))
      }
      if (row.hasFirstParent && row.newNodeIndex !== -1) {
        const firstColor = LANE_COLORS[row.newLanes[row.newNodeIndex]?.color ?? row.nodeColor]
        shapes.push(h('line', { key: 'nb', x1: nodeX, y1: mid, x2: nodeX, y2: ROW_HEIGHT, stroke: firstColor, ...stroke }))
      }
      for (const start of row.starts) {
        const color = LANE_COLORS[row.newLanes[start]?.color ?? 0]
        shapes.push(h('path', {
          key: `s${start}`,
          d: `M ${nodeX} ${mid} C ${nodeX} ${ROW_HEIGHT} ${laneX(start)} ${mid} ${laneX(start)} ${ROW_HEIGHT}`,
          stroke: color, ...stroke,
        }))
      }
      shapes.push(h('circle', { key: 'node', cx: nodeX, cy: mid, r: 3.4, fill: nodeColor, stroke: 'var(--dsw-alias-bg-layer-2, #111)', strokeWidth: 1.2 }))
      return shapes
    }

    /** Collapsible commit-graph drawer docked at the bottom of the workbench column. */
    function GraphPanel({ t, repository, width, onOpenDiff }) {
      const [expanded, setExpanded] = useState(false)
      const [height, setHeight] = useState(236)
      const [state, setState] = useState({ phase: 'idle', commits: [], hasMore: true })
      const [loadingMore, setLoadingMore] = useState(false)
      const [scope, setScope] = useState(() => { try { return window.localStorage.getItem('dsh-git-assistant:graph-scope') ?? 'branch' } catch { return 'branch' } })
      const chooseScope = value => { setScope(value); try { window.localStorage.setItem('dsh-git-assistant:graph-scope', value) } catch { /* ignore */ } }
      const [version, setVersion] = useState(0)
      const [expandedHash, setExpandedHash] = useState(undefined)
      const [details, setDetails] = useState({})
      const [hover, setHover] = useState(undefined)
      const hoverTimer = useRef(null)
      const frameRef = useRef(null)
      const loadCommit = hash => {
        if (!path) return
        setDetails(previous => previous[hash] ? previous : { ...previous, [hash]: { phase: 'loading' } })
        api('/commit', { path, hash })
          .then(data => setDetails(previous => ({ ...previous, [hash]: { phase: 'ready', data } })))
          .catch(error => setDetails(previous => ({ ...previous, [hash]: { phase: 'error', error: String(error?.message ?? error) } })))
      }
      const detailsOf = hash => details[hash]
      const [treeDirs, setTreeDirs] = useState({})
      const [fileView, setFileView] = useState(() => { try { return window.localStorage.getItem('dsh-git-assistant:graph-file-view') ?? 'tree' } catch { return 'tree' } })
      const [menuOpen, setMenuOpen] = useState(false)
      const menuRef = useRef(null)
      const chooseFileView = view => {
        setFileView(view)
        setMenuOpen(false)
        try { window.localStorage.setItem('dsh-git-assistant:graph-file-view', view) } catch { /* ignore */ }
      }
      const toggleTreeDir = (hash, path) => setTreeDirs(previous => {
        const current = new Set(previous[hash] ?? [])
        if (current.has(path)) current.delete(path)
        else current.add(path)
        return { ...previous, [hash]: current }
      })
      const path = repository?.path
      useEffect(() => {
        if (!menuOpen) return undefined
        const close = event => { if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false) }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
      }, [menuOpen])
      const PAGE_SIZE = 100
      const loadPage = useCallback(async (skip, replace) => {
        if (!path) return
        setLoadingMore(true)
        if (replace) setState({ phase: 'loading', commits: [], hasMore: true })
        try {
          const data = await api('/graph', { path, limit: PAGE_SIZE, skip, scope })
          const rows = Array.isArray(data?.commits) ? data.commits : []
          setState(previous => {
            const base = replace ? [] : previous.commits
            const seen = new Set(base.map(commit => commit.oid))
            const merged = base.concat(rows.filter(commit => !seen.has(commit.oid)))
            return { phase: 'ready', commits: merged, hasMore: Boolean(data?.hasMore) && rows.length > 0, error: null }
          })
        } catch (error) {
          setState(previous => ({ ...previous, phase: 'error', commits: replace ? [] : previous.commits, error: String(error?.message ?? error) }))
        } finally { setLoadingMore(false) }
      }, [path, scope])
      useEffect(() => { if (expanded && path) loadPage(0, true) }, [expanded, path, version, scope, loadPage])
      const loadMore = () => {
        if (loadingMore || state.phase !== 'ready' || !state.hasMore) return
        loadPage(state.commits.length, false)
      }
      const graph = useMemo(() => computeGraphLanes(state.commits), [state.commits])
      const laneSpacing = Math.max(5, Math.min(LANE_WIDTH, Math.floor((width * 0.6) / Math.max(1, graph.maxLaneCount))))
      const startDrag = event => {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = height
        const move = moveEvent => setHeight(Math.min(620, Math.max(140, startHeight + (startY - moveEvent.clientY))))
        const stop = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', stop)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', stop)
      }
      const frameStyle = {
        position: 'absolute', left: 20, bottom: 18, width: Math.max(140, width - 16), zIndex: 40,
        borderRadius: T.rMd, background: T.glass, border: `0.5px solid ${T.border}`,
        boxShadow: T.shadowProminent, backdropFilter: 'blur(24px) saturate(160%)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        height: expanded ? height : 28,
        transition: 'height .18s ' + T.ease,
      }
      const header = h('div', {
        onClick: () => setExpanded(value => !value),
        style: { display: 'flex', alignItems: 'center', gap: 7, minHeight: 28, padding: '0 10px', cursor: 'pointer', flex: '0 0 auto' },
      },
        h(Chevron, { open: expanded, size: 9 }),
        h('span', { style: { fontSize: 11.5, fontWeight: 600, color: T.ink2 } }, t('graphTitle')),
        h('span', { style: { flex: 1 } }),
        expanded ? h(IconAction, { label: t('refresh'), onClick: event => { event.stopPropagation(); setVersion(value => value + 1) } }, h(RefreshIcon, {})) : null,
        expanded ? h('div', {
          ref: menuRef, style: { position: 'relative', display: 'inline-flex' },
          onClick: event => event.stopPropagation(),
        },
          h('button', {
            type: 'button', title: '图形选项', onClick: event => { event.stopPropagation(); setMenuOpen(open => !open) },
            style: {
              appearance: 'none', border: 'none', background: menuOpen ? T.hover : 'transparent', color: T.muted,
              width: 22, height: 22, borderRadius: T.rSm, cursor: 'pointer', fontSize: 14, lineHeight: '18px', padding: 0,
            },
          }, '⋯'),
          menuOpen ? h('div', {
            style: {
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 80, width: 170,
              background: T.menu, border: `0.5px solid ${T.border}`, borderRadius: T.rMd, padding: 4,
              boxShadow: T.shadowProminent, backdropFilter: 'blur(24px) saturate(160%)',
            },
          },
            h('div', { style: { padding: '4px 8px 3px', fontSize: 10, color: T.subtle } }, '提交范围'),
            ...[['branch', '当前分支'], ['all', '所有引用（含远端/标签）']].map(([value, label]) => h('button', {
              key: `scope-${value}`, type: 'button', onClick: () => chooseScope(value),
              style: {
                appearance: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'transparent', color: 'inherit', padding: '5px 8px', borderRadius: T.rSm, fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
              },
              onMouseEnter: event => { event.currentTarget.style.background = T.hover },
              onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
            },
              h('span', { style: { width: 12, color: T.success } }, scope === value ? '✓' : ''),
              h('span', null, label))),
            h('div', { style: { height: 1, background: T.borderSoft, margin: '4px 6px' } }),
            h('div', { style: { padding: '4px 8px 3px', fontSize: 10, color: T.subtle } }, '提交文件展示方式'),
            ...[['tree', '树形展示'], ['list', '列表展示']].map(([value, label]) => h('button', {
              key: value, type: 'button', onClick: () => chooseFileView(value),
              style: {
                appearance: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'transparent', color: 'inherit', padding: '5px 8px', borderRadius: T.rSm, fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
              },
              onMouseEnter: event => { event.currentTarget.style.background = T.hover },
              onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
            },
              h('span', { style: { width: 12, color: T.success } }, fileView === value ? '✓' : ''),
              h('span', null, label)))) : null) : null)
      if (!expanded) return h('div', { style: frameStyle }, header)
      const body = state.phase === 'loading'
        ? h('div', { style: { padding: '8px 12px', fontSize: 11, color: T.muted } }, t('graphLoading'))
        : state.phase === 'error'
          ? h('div', { style: { padding: '8px 12px', fontSize: 11, color: T.error } }, state.error)
          : state.commits.length === 0
            ? h('div', { style: { padding: '8px 12px', fontSize: 11, color: T.muted } }, t('graphEmpty'))
            : [
                ...state.commits.flatMap((commit, index) => {
                const row = graph.rows[index]
                const detail = detailsOf(commit.oid)
                const isOpen = expandedHash === commit.oid
                const rowWidth = Math.max(1, row ? row.laneCount : 1) * laneSpacing
                const rowEl = h('div', {
                  key: commit.oid,
                  onClick: () => {
                    setExpandedHash(previous => previous === commit.oid ? undefined : commit.oid)
                    if (!isOpen) loadCommit(commit.oid)
                  },
                  style: { display: 'flex', alignItems: 'center', gap: 8, height: ROW_HEIGHT, padding: '0 10px', fontSize: 11.5, cursor: 'pointer', background: isOpen ? T.selected : 'transparent' },
                  onMouseEnter: event => {
                    event.currentTarget.style.background = isOpen ? T.selected : T.hover
                    const target = event.currentTarget
                    clearTimeout(hoverTimer.current)
                    hoverTimer.current = setTimeout(() => {
                      const box = frameRef.current?.getBoundingClientRect()
                      if (!box || !target.isConnected) return
                      const rect = target.getBoundingClientRect()
                      setHover({ hash: commit.oid, commit, top: rect.bottom - box.top + 4 })
                    }, 350)
                  },
                  onMouseLeave: event => { event.currentTarget.style.background = isOpen ? T.selected : 'transparent'; clearTimeout(hoverTimer.current); setHover(undefined) },
                },
                  h('svg', {
                    width: rowWidth, height: ROW_HEIGHT, viewBox: `0 0 ${rowWidth} ${ROW_HEIGHT}`,
                    style: { flex: '0 0 auto', overflow: 'visible' },
                  }, row ? graphRowShapes(row, laneSpacing) : null),
                  h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.ink2 } }, commit.subject || commit.oid.slice(0, 7)),
                  h('span', { style: { fontFamily: MONO, fontSize: 9.5, color: T.subtle } }, commit.oid.slice(0, 7)))

                const filesBlock = isOpen
                  ? (() => {
                      const continuing = row
                        ? row.newLanes.map((lane, index) => (lane?.hash ? { index, color: lane.color } : null)).filter(Boolean)
                        : []
                      const ready = detail?.phase === 'ready'
                      const fileList = ready ? detail.data.files : []
                      const tree = ready ? fileRows(fileList.map(file => ({ path: file.path, status: file.status }))) : null
                      const statusMap = new Map(fileList.map(file => [file.path, file.status]))
                      return h('div', {
                        key: `${commit.oid}:files`,
                        style: { display: 'flex', alignItems: 'stretch', padding: '2px 10px 8px 10px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, currentColor) 26%, transparent)' },
                      },
                        h('div', { style: { position: 'relative', flex: '0 0 auto', width: rowWidth } },
                          ...continuing.map(lane => h('span', {
                            key: `lane-${lane.index}`,
                            style: {
                              position: 'absolute', top: 0, bottom: 0, left: lane.index * laneSpacing + laneSpacing / 2 - 1, width: 2,
                              background: laneColor(lane.color), borderRadius: 1,
                            },
                          }))),
                        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 2 } },
                          h('div', { style: { fontSize: 10.5, color: T.muted, padding: '2px 0 3px' } },
                            ready ? `${detail.data.stats.files} 个文件` : t('loading'),
                            ready ? h('span', { style: { color: T.success, marginLeft: 6 } }, `+${detail.data.stats.additions}`) : null,
                            ready ? h('span', { style: { color: T.error, marginLeft: 6 } }, `−${detail.data.stats.deletions}`) : null),
                          detail?.phase === 'error'
                            ? h('div', { style: { fontSize: 10.5, color: T.error } }, detail.error)
                            : ready
                              ? (fileView === 'tree'
                                  ? h(TreeRows, {
                                      node: tree, depth: 0,
                                      expandedDirs: treeDirs[commit.oid] ?? new Set(),
                                      onToggleDir: path => toggleTreeDir(commit.oid, path),
                                      onOpen: file => onOpenDiff?.(commit.oid, file.path),
                                      selectedKey: undefined, actionsFor: null,
                                      statusByPath: statusMap, showStatus: true,
                                      hoveredKey: undefined, onHoverKey: () => {},
                                    })
                                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } },
                                      ...fileList.map(file => h('div', {
                                        key: file.path,
                                        onClick: event => { event.stopPropagation(); onOpenDiff?.(commit.oid, file.path) },
                                        title: file.path,
                                        style: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 20, padding: '0 6px', borderRadius: T.rSm, cursor: 'pointer', fontSize: 11.5 },
                                        onMouseEnter: event => { event.currentTarget.style.background = T.hover },
                                        onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                                      },
                                        h('span', { style: { width: 12, textAlign: 'center', fontWeight: 700, fontSize: 10, color: STATUS_COLOR[file.status] ?? T.subtle } }, file.status ?? 'M'),
                                        h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.ink2 } }, file.path),
                                        h('span', { style: { fontFamily: MONO, fontSize: 9.5, color: T.success } }, `+${file.additions}`),
                                        h('span', { style: { fontFamily: MONO, fontSize: 9.5, color: T.error } }, `−${file.deletions}`)))))
                              : null))
                    })()
                  : null
                return [rowEl, filesBlock]
              }),
                loadingMore
                  ? h('div', { key: 'graph-more', style: { padding: '6px 12px', fontSize: 10.5, color: T.muted } }, t('graphLoading'))
                  : null,
              ]
      const hoverDetail = hover ? detailsOf(hover.hash) : undefined
      const hoverCard = hover
        ? h('div', {
            style: {
              position: 'absolute', left: 12, top: hover.top, zIndex: 60, width: Math.min(420, width - 24),
              maxHeight: 240, overflowY: 'auto', pointerEvents: 'none',
              background: T.menu, border: `0.5px solid ${T.border}`, borderRadius: T.rMd,
              boxShadow: T.shadowProminent, backdropFilter: 'blur(24px) saturate(160%)', padding: '10px 12px',
            },
          },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.muted, flexWrap: 'wrap' } },
                h('span', null, hover.commit.author || '未知作者'),
                h('span', null, '·'),
                h('span', null, new Date(hover.commit.time * 1000).toLocaleString()),
                h('span', { style: { flex: 1 } }),
                h('span', { style: { fontFamily: MONO, color: T.subtle } }, hover.hash.slice(0, 7))),
              h('div', { style: { fontSize: 12, fontWeight: 600, color: T.ink2, whiteSpace: 'pre-wrap' } }, hover.commit.subject || hover.commit.oid.slice(0, 7)),
              hover.commit.body
                ? h('div', { style: { fontSize: 11.5, color: T.muted, whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'hidden' } }, hover.commit.body)
                : null,
              (hover.commit.refs ?? []).length > 0
                ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                    ...hover.commit.refs.map(ref => h('span', {
                      key: ref,
                      style: { fontSize: 9.5, fontFamily: MONO, color: '#a78bfa', background: 'color-mix(in srgb, #a78bfa 16%, transparent)', padding: '0 6px', borderRadius: 999, whiteSpace: 'nowrap' },
                    }, ref)))
                : null,
              hover.commit.stats
                ? h('div', { style: { fontSize: 11, color: T.muted } },
                    `${hover.commit.stats.files} 个文件`,
                    h('span', { style: { color: T.success, marginLeft: 6 } }, `+${hover.commit.stats.additions}`),
                    h('span', { style: { color: T.error, marginLeft: 6 } }, `−${hover.commit.stats.deletions}`))
                : null))
        : null
      return h('div', { ref: frameRef, style: frameStyle },
        h('div', { onPointerDown: startDrag, style: { flex: '0 0 auto', height: 6, cursor: 'row-resize', display: 'flex', justifyContent: 'center', alignItems: 'center' } },
          h('span', { style: { width: 34, height: 2, borderRadius: 2, background: T.borderSoft } })),
        header,
        h('div', {
          onScroll: event => {
            const element = event.currentTarget
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 160) loadMore()
          },
          style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 6 },
        }, body),
        hoverCard)
    }

    /** Isolates one card's render failure so the panel never goes blank. */
    class CardBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      render() {
        if (this.state.error) {
          return h('div', { style: { margin: '6px 8px', padding: '6px 10px', fontSize: 10.5, color: T.error, border: `0.5px solid ${T.border}`, borderRadius: T.rSm } },
            `卡片渲染失败：${String(this.state.error?.message ?? this.state.error)}`)
        }
        return this.props.children
      }
    }

    /** One worktree's file browser, mirroring the changes cards. */
    function WorktreeFilesCard({ t, item, defaultOpen, onOpen, selectedPath, onSelect }) {
      const [open, setOpen] = useState(defaultOpen)
      const [expandedDirs, setExpandedDirs] = useState(() => new Set())
      const [hoveredKey, setHoveredKey] = useState(undefined)
      const [version, setVersion] = useState(0)
      const files = useFiles({ path: item.path, id: item.path }, version, open)
      const [status, refreshStatus] = useStatusAt(item.path, open)
      const refreshFiles = () => { setVersion(value => value + 1); refreshStatus() }
      const entries = Array.isArray(files.files) ? files.files : []
      const statusByPath = useMemo(() => {
        const map = new Map()
        for (const file of [...(status.data?.staged ?? []), ...(status.data?.unstaged ?? []), ...(status.data?.untracked ?? [])]) {
          if (file?.path) map.set(file.path, file.status)
        }
        return map
      }, [status.data])
      const dirStatusByPath = useMemo(() => aggregateDirStatus(statusByPath), [statusByPath])
      const tree = useMemo(() => fileRows(entries.map(path => ({ path }))), [files.files])
      const toggleDir = path => setExpandedDirs(previous => {
        const next = new Set(previous)
        if (next.has(path)) next.delete(path); else next.add(path)
        return next
      })
      return h(CardBoundary, null,
        h('div', {
          style: { margin: '6px 8px', borderRadius: T.rMd, border: `0.5px solid ${T.border}`, background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, currentColor) 34%, transparent)', overflow: 'hidden' },
        },
          h('div', {
            onClick: () => { setOpen(value => !value); onSelect?.(item.path) },
            style: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 28, padding: '0 8px', cursor: 'pointer', borderBottom: open ? `0.5px solid ${T.borderSoft}` : 'none' },
          },
            h(Chevron, { open, size: 9 }),
            h('span', { style: { fontSize: 12, fontWeight: 600, color: T.text } }, item.name ?? item.path.split('/').pop()),
            h('span', { style: { fontSize: 11, color: T.ink2, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 } }, item.branch ?? t('detached')),
            h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.muted, whiteSpace: 'nowrap' } }, `${item.behind > 0 ? `↓${item.behind}` : ''}${item.ahead > 0 ? ` ↑${item.ahead}` : ''}`),
            h('span', { style: { flex: 1 } }),
            h('span', { style: { fontSize: 10.5, color: T.subtle } }, String(entries.length)),
            h(IconAction, { label: t('refresh'), onClick: event => { event.stopPropagation(); refreshFiles() } }, h(RefreshIcon, {}))),
          open ? (files.phase === 'loading' && entries.length === 0
            ? h('div', { style: { fontSize: 10.5, color: T.muted, padding: '4px 22px 6px' } }, t('filesLoading'))
            : h('div', { style: { padding: '4px 6px 6px' } },
                h(TreeRows, {
                  node: tree, depth: 0, expandedDirs, onToggleDir: toggleDir,
                  onOpen: file => onOpen(file, item.path),
                  selectedKey: selectedPath ? `f:${selectedPath}` : undefined,
                  actionsFor: null, statusByPath, showStatus: true, dirStatusByPath,
                  hoveredKey, onHoverKey: setHoveredKey,
                }))) : null))
    }

    /* ── primitives ─────────────────────────────────────────────────── */

    function Chevron({ open, size = 10 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 100ms ease', opacity: 0.66, flex: '0 0 auto' },
      }, h('path', { d: 'M9 5l7 7-7 7' }))
    }

    function GitIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        h('circle', { cx: 6, cy: 5.5, r: 2.2 }),
        h('circle', { cx: 6, cy: 18.5, r: 2.2 }),
        h('circle', { cx: 18, cy: 8.5, r: 2.2 }),
        h('path', { d: 'M6 7.7v8.6' }),
        h('path', { d: 'M18 10.7c0 3-3.2 3.6-6.4 4.2-2.4.5-3.6 1.2-3.6 1.6' }))
    }

    function RefreshIcon({ size = 13 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('path', { d: 'M20 11a8 8 0 1 0-2.3 5.7' }), h('path', { d: 'M20 5v6h-6' }))
    }

    function IconButton({ label, onClick, children, disabled }) {
      return h('button', {
        type: 'button', title: label, 'aria-label': label, onClick, disabled,
        style: {
          appearance: 'none', border: 'none', background: 'transparent', color: T.ink2,
          cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', width: 30, height: 30, borderRadius: T.rMd, opacity: disabled ? 0.3 : 1, padding: 0,
          transition: `background .15s ${T.ease}, color .15s ${T.ease}`,
        },
        onMouseEnter: event => { if (!disabled) { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = T.text } },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = T.ink2 },
      }, children)
    }

    function IconAction({ label, onClick, disabled, danger, children }) {
      return h('button', {
        type: 'button', title: label, 'aria-label': label, onClick, disabled,
        style: {
          appearance: 'none', border: 'none', background: 'transparent', color: danger ? T.error : T.muted,
          cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', width: 22, height: 22, borderRadius: T.rSm, padding: 0,
          opacity: disabled ? 0.3 : 1, transition: `background .15s ${T.ease}, color .15s ${T.ease}`,
        },
        onMouseEnter: event => { if (!disabled) { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = danger ? T.error : T.text } },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = danger ? T.error : T.muted },
      }, children)
    }

    const IconPlus = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, h('path', { d: 'M12 5v14M5 12h14' }))
    const IconUndo = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M9 14L4 9l5-5' }), h('path', { d: 'M4 9h9a6 6 0 1 1 0 12H8' }))
    const IconDiff = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M12 4v16M7 8h2M7 12h2M15 8h2M15 12h2M15 16h2' }))
    const IconMinus = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, h('path', { d: 'M5 12h14' }))

    function SmallButton({ label, onClick, disabled, title }) {
      return h('button', {
        type: 'button', title: title ?? label, onClick, disabled,
        style: {
          appearance: 'none', border: `0.5px solid ${T.lineStrong}`, background: 'transparent', color: T.ink2,
          cursor: disabled ? 'default' : 'pointer', fontSize: 11, lineHeight: '18px', height: 22, padding: '0 10px',
          borderRadius: T.pill, opacity: disabled ? 0.35 : 1, whiteSpace: 'nowrap',
          transition: `background .15s ${T.ease}, color .15s ${T.ease}`,
        },
        onMouseEnter: event => { if (!disabled) { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = T.text } },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = T.ink2 },
      }, label)
    }

    function Section({ title, count, collapsed, onToggle, actions, children }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', paddingTop: 2 } },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 4, padding: '10px 10px 4px 14px',
            fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted,
          },
        },
          h('button', {
            type: 'button', onClick: onToggle,
            style: {
              appearance: 'none', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, font: 'inherit',
              fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'inherit',
            },
          },
            h(Chevron, { open: !collapsed }),
            h('span', { style: { color: T.muted } }, title)),
          h('span', { style: { flex: 1 } }),
          actions,
          h('span', { style: { color: T.subtle, fontWeight: 500, minWidth: 18, textAlign: 'right' } }, String(count))),
        collapsed ? null : children)
    }

    function fileRows(files) {
      const root = { children: new Map(), files: [] }
      for (const file of files) {
        const parts = file.path.split('/')
        let node = root
        for (let index = 0; index < parts.length - 1; index += 1) {
          const name = parts[index]
          let child = node.children.get(name)
          if (!child) {
            child = { name, path: parts.slice(0, index + 1).join('/'), children: new Map(), files: [] }
            node.children.set(name, child)
          }
          node = child
        }
        node.files.push({ ...file, name: parts[parts.length - 1] })
      }
      return root
    }

    /* ── tree components ────────────────────────────────────────────── */

    /** Highest-priority change status per directory, derived from changed file paths. */
    function aggregateDirStatus(statusByPath) {
      const priority = { U: 5, A: 5, D: 4, R: 3, M: 2 }
      const result = new Map()
      if (!statusByPath || statusByPath.size === 0) return result
      for (const [path, status] of statusByPath) {
        if (!status) continue
        const parts = String(path).split('/')
        parts.pop()
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          const previous = result.get(current)
          if (!previous || (priority[status] ?? 0) > (priority[previous] ?? 0)) result.set(current, status)
        }
      }
      return result
    }

    function TreeRows({ node, depth, expandedDirs, onToggleDir, onOpen, selectedKey, actionsFor, statusByPath, showStatus, hoveredKey, onHoverKey, pickedKeys, onDragStartRow, dirStatusByPath }) {
      const rows = []
      const directories = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))
      for (const directory of directories) {
        const expanded = expandedDirs.has(directory.path)
        const dirStatus = dirStatusByPath?.get(directory.path)
        rows.push(h('div', {
          key: `dir:${directory.path}`,
          style: {
            display: 'flex', alignItems: 'center', gap: 4, minHeight: 22, margin: '0 6px',
            padding: `2px 8px 2px ${8 + depth * 13}px`, cursor: 'pointer', userSelect: 'none',
            borderRadius: T.rSm, color: T.ink2, transition: `background .12s ${T.ease}`,
          },
          onClick: () => onToggleDir(directory.path),
          onMouseEnter: event => { event.currentTarget.style.background = T.hover },
          onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
        },
          h(Chevron, { open: expanded, size: 9 }),
          h('span', { style: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: dirStatus ? (STATUS_COLOR[dirStatus] ?? T.ink2) : T.ink2 } }, directory.name),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 10, fontWeight: 700, color: dirStatus ? (STATUS_COLOR[dirStatus] ?? T.subtle) : 'transparent', opacity: 0.85 } }, dirStatus ?? '')))
        if (expanded) {
          rows.push(h(TreeRows, {
            key: `children:${directory.path}`, node: directory, depth: depth + 1, expandedDirs, onToggleDir,
            onOpen, selectedKey, actionsFor, statusByPath, showStatus, hoveredKey, onHoverKey, pickedKeys, onDragStartRow, dirStatusByPath,
          }))
        }
      }
      const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
      for (const file of files) {
        const key = file.__staged !== undefined ? `${file.__staged ? 's' : 'w'}:${file.path}` : `f:${file.path}`
        const active = selectedKey === key || Boolean(pickedKeys?.has(key))
        const status = showStatus ? statusByPath.get(file.path) : file.status
        const hovered = hoveredKey === key
        rows.push(h('div', {
          key: `file:${key}`,
          title: `${file.oldPath ? `${file.path} ← ${file.oldPath}` : file.path}${status ? `  ·  ${status}` : ''}`,
          draggable: true,
          onDragStart: event => { if (onDragStartRow) onDragStartRow(file, event) },
          onClick: event => onOpen(file, event),
          style: {
            display: 'flex', alignItems: 'center', gap: 5, minHeight: 22, margin: '0 6px',
            padding: `2px 8px 2px ${8 + depth * 13 + 11}px`,
            cursor: 'pointer', background: active ? T.selected : 'transparent', minWidth: 0,
            borderRadius: T.rSm, transition: `background .12s ${T.ease}`,
          },
          onMouseEnter: event => { if (!active) event.currentTarget.style.background = T.hover; onHoverKey?.(key) },
          onMouseLeave: event => { if (!active) event.currentTarget.style.background = 'transparent'; if (hoveredKey === key) onHoverKey?.(undefined) },
        },
          h('span', {
            style: {
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, fontSize: 12.5,
              color: showStatus && status ? (STATUS_COLOR[status] ?? T.text) : T.text,
            },
          }, file.name),
          h('span', { style: { flex: 1 } }),
          (hovered || active) && actionsFor
            ? h('span', { style: { display: 'inline-flex', gap: 1, alignItems: 'center', flex: '0 0 auto' } }, actionsFor(file))
            : null,
          h('span', {
            style: {
              marginLeft: 3, width: 14, flex: '0 0 14px', textAlign: 'center', fontSize: 10.5, fontWeight: 700,
              color: STATUS_COLOR[status] ?? T.subtle, opacity: status ? 0.9 : 0,
            },
          }, status ?? '')))
      }
      return rows
    }

    /* ── diff / preview components ──────────────────────────────────── */

    function DiffLines({ file, view, t }) {
      const files = Array.isArray(file) ? file : [file]
      const entry = files[0]
      if (!entry) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('noDiff'))
      if (entry.binary) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('binary'))
      if (entry.hunks.length === 0) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('noDiff'))
      const language = languageOf(entry.path ?? '')
      const highlight = entry.hunks.reduce((total, hunk) => total + hunk.lines.length, 0) <= 1500
      const rows = view === 'split' ? splitRows(entry.hunks, language, highlight) : unifiedRows(entry.hunks, language, highlight)

      if (view === 'split') {
        return h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, paddingBottom: 24 } },
          rows.map(row => {
            if (row.kind === 'hunk') return h('div', { key: row.key, style: hunkHeaderStyle }, row.label)
            if (row.kind === 'notice') return h('div', { key: row.key, style: { padding: '8px 16px', color: T.muted, fontSize: 11.5 } }, t('truncateNotice'))
            return h('div', {
              key: row.key,
              style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', minHeight: 20, borderBottom: `0.5px solid ${T.borderSoft}` },
            },
              h(DiffHalf, { line: row.left, side: 'left', language, highlight }),
              h(DiffHalf, { line: row.right, side: 'right', language, highlight }))
          }))
      }

      return h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, paddingBottom: 24 } },
        rows.map(row => {
          if (row.kind === 'hunk') return h('div', { key: row.key, style: hunkHeaderStyle }, row.label)
          if (row.kind === 'notice') return h('div', { key: row.key, style: { padding: '8px 16px', color: T.muted, fontSize: 11.5 } }, t('truncateNotice'))
          const isAdd = row.kindOfLine === 'add'
          const isDel = row.kindOfLine === 'del'
          return h('div', {
            key: row.key,
            style: {
              display: 'grid', gridTemplateColumns: '46px 46px 16px minmax(max-content, 1fr)',
              background: isAdd ? ADD_BG : isDel ? DEL_BG : 'transparent', minHeight: 19, alignItems: 'start',
            },
          },
            h('span', { style: numberStyle }, row.oldNumber),
            h('span', { style: numberStyle }, row.newNumber),
            h('span', {
              style: { ...numberStyle, textAlign: 'center', opacity: 1, color: isAdd ? T.success : isDel ? T.error : T.muted },
            }, row.sign),
            h('span', {
              style: {
                fontFamily: MONO, fontSize: 11.5, lineHeight: '19px', whiteSpace: 'pre', paddingRight: 18,
                color: isAdd ? T.success : isDel ? T.error : 'inherit', opacity: isDel ? 0.9 : 1,
              },
            }, h(CodeText, { text: row.text, language, highlight, baseColor: isAdd ? T.success : isDel ? T.error : 'inherit' })))
        }))
    }

    function DiffHalf({ line, side, language, highlight }) {
      const isAdd = line?.kind === 'add'
      const isDel = line?.kind === 'del'
      return h('div', {
        style: {
          display: 'grid', gridTemplateColumns: '38px 13px minmax(0, 1fr)', minWidth: 0,
          background: isAdd ? ADD_BG : isDel ? DEL_BG : 'transparent',
          borderLeft: side === 'right' ? `1px solid ${T.borderSoft}` : 'none',
        },
      },
        h('span', { style: { ...numberStyle, paddingRight: 6 } }, line?.number ?? ''),
        h('span', {
          style: { ...numberStyle, textAlign: 'center', opacity: 1, color: isAdd ? T.success : isDel ? T.error : T.muted },
        }, line ? (isAdd ? '+' : isDel ? '−' : ' ') : ''),
        h('span', {
          style: {
            fontFamily: MONO, fontSize: 11.5, lineHeight: '19px', whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere', paddingRight: 14,
            color: isAdd ? T.success : isDel ? T.error : 'inherit', opacity: isDel ? 0.9 : 1, minWidth: 0,
            display: 'block',
          },
        }, line ? h(CodeText, { text: line.text, language, highlight, baseColor: isAdd ? T.success : isDel ? T.error : 'inherit' }) : ''))
    }

    const numberStyle = {
      fontFamily: MONO, fontSize: 10.5, lineHeight: '20px', textAlign: 'right', paddingRight: 9,
      color: T.subtle, opacity: 0.72, userSelect: 'none', whiteSpace: 'nowrap',
    }
    const hunkHeaderStyle = {
      fontFamily: MONO, fontSize: 11, lineHeight: '26px', padding: '0 14px', color: T.muted,
      background: T.hover, borderTop: `0.5px solid ${T.borderSoft}`, borderBottom: `0.5px solid ${T.borderSoft}`,
      whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis',
    }

    function FilePreview({ state, selection, t }) {
      if (state.phase === 'loading') return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('loading'))
      if (state.phase === 'error') return h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, state.error)
      const data = state.data
      if (!data) return null
      const extension = selection.path.slice(selection.path.lastIndexOf('.') + 1).toLowerCase()
      const image = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(extension)
      if (extension === 'pdf') return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('binary'))
      if (image) {
        const src = `/git-assistant/api/raw?path=${encodeURIComponent(state.data.repoPath ?? '')}&file=${encodeURIComponent(selection.path)}`
        return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' } },
          h('img', { src, alt: selection.path, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }))
      }
      if (data.binary) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('binary'))
      const language = languageOf(selection.path)
      const lines = (data.content ?? '').split('\n').slice(0, MAX_PREVIEW_LINES)
      const highlight = lines.length <= 3000
      return h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, paddingBottom: 24 } },
        lines.map((line, index) => h('div', {
          key: index,
          style: { display: 'grid', gridTemplateColumns: '46px minmax(max-content, 1fr)', minHeight: 19 },
        },
          h('span', { style: { ...numberStyle, opacity: 0.4 } }, String(index + 1)),
          h('span', {
            style: { fontFamily: MONO, fontSize: 11.5, lineHeight: '19px', whiteSpace: 'pre', paddingRight: 18 },
          }, h(CodeText, { text: line, language, highlight, baseColor: 'inherit' })))),
        data.truncated ? h('div', { style: { padding: '8px 16px', color: T.muted, fontSize: 11.5 } }, t('truncateNotice')) : null)
    }

    function AllDiff({ state, view, t }) {
      if (state.phase === 'loading') return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('allDiffLoading'))
      if (state.phase === 'error') return h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, state.error)
      if (state.entries.length === 0) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('noDiff'))
      return h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0, paddingBottom: 12 } },
        state.entries.map(item => h('div', { key: item.file },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
              borderBottom: `0.5px solid ${T.borderSoft}`, background: T.hover,
              position: 'sticky', top: 0, zIndex: 1,
            },
          },
            h('span', { style: { fontFamily: MONO, fontSize: 11.5, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.file),
            h('span', { style: { flex: 1 } }),
            item.entry
              ? h('span', { style: { display: 'inline-flex', gap: 6, fontFamily: MONO, fontSize: 10.5, whiteSpace: 'nowrap' } },
                  h('span', { style: { color: T.success } }, `+${item.entry.additions ?? 0}`),
                  h('span', { style: { color: T.error } }, `−${item.entry.deletions ?? 0}`))
              : null),
          item.error
            ? h('div', { style: { padding: '6px 14px', color: T.error, fontSize: 11.5 } }, item.error)
            : item.entry && item.entry.binary
              ? h('div', { style: { padding: '6px 14px', color: T.muted, fontSize: 11.5 } }, t('binary'))
              : item.entry && item.entry.hunks.length > 0
                ? h(DiffLines, { file: [item.entry], view, t })
                : h('div', { style: { padding: '6px 14px', color: T.muted, fontSize: 11.5 } }, t('noDiff')))))
    }

    /* ── dialogs / toast ────────────────────────────────────────────── */

    function Dialog({ dialog, onClose }) {
      if (!dialog) return null
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 100, background: 'color-mix(in srgb, #000 32%, transparent)',
          backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        },
        onPointerDown: event => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', {
          style: {
            width: 420, maxWidth: '100%', background: T.menu, border: `0.5px solid ${T.border}`,
            borderRadius: T.rXl, padding: 20, boxShadow: T.shadowProminent,
            backdropFilter: 'blur(28px) saturate(170%)', display: 'flex', flexDirection: 'column', gap: 12,
          },
        },
          h('div', { style: { fontSize: 14, fontWeight: 600, letterSpacing: '0.01em' } }, dialog.title),
          h('div', { style: { fontSize: 12.5, color: T.ink2, lineHeight: '20px' } }, dialog.message),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
            h('button', {
              type: 'button', onClick: onClose,
              style: {
                appearance: 'none', border: `0.5px solid ${T.lineStrong}`, background: 'transparent', color: T.ink2,
                height: 30, padding: '0 16px', borderRadius: T.pill, fontSize: 12, cursor: 'pointer',
              },
            }, dialog.cancelLabel),
            h('button', {
              type: 'button',
              onClick: () => { const run = dialog.onConfirm; onClose(); run() },
              style: {
                appearance: 'none', border: 'none', background: dialog.danger ? T.error : T.primary,
                color: T.inverse, height: 30, padding: '0 16px', borderRadius: T.pill, fontSize: 12,
                cursor: 'pointer', boxShadow: T.shadowSoft,
              },
            }, dialog.confirmLabel))))
    }

    function Toast({ toast }) {
      if (!toast) return null
      return h('div', {
        style: {
          position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 60,
          background: T.menu, border: `0.5px solid ${T.border}`, borderRadius: T.pill, padding: '8px 18px',
          fontSize: 12, boxShadow: T.shadowProminent, backdropFilter: 'blur(20px) saturate(160%)',
          maxWidth: '80%', color: toast.kind === 'error' ? T.error : T.text,
        },
      }, toast.text)
    }


    /* ── main panel ─────────────────────────────────────────────────── */

    function Panel({ t, ctx, sessionId, renderFactorySlot, inputActions }) {
      const [repositories, refreshRepositories] = useRepositories()
      const [storedId, setStoredId] = useState(readStoredRepository)
      const [dataVersion, setDataVersion] = useState(0)
      const bump = useCallback(() => setDataVersion(value => value + 1), [])
      const [mode, setMode] = useState('changes')
      const [selection, setSelection] = useState(null)
      const [view, setView] = useState('unified')
      const [commitMessage, setCommitMessage] = useState('')
      const [amend, setAmend] = useState(false)
      const [commitMenu, setCommitMenu] = useState(false)
      const commitMenuRef = useRef(null)
      const commitRef = useRef(null)
      const [busy, setBusy] = useState(false)
      const [dialog, setDialog] = useState(null)
      const [toast, setToast] = useState(null)
      const [collapsedSections, setCollapsedSections] = useState(() => new Set())
      const [expandedDirs, setExpandedDirs] = useState(() => new Set())
      const [leftWidth, setLeftWidth] = useState(() => { try { const stored = Number(window.localStorage.getItem('dsh-git-assistant:left-width')); return Number.isFinite(stored) && stored >= 240 && stored <= 560 ? stored : 318 } catch { return 318 } })
      const [hoveredKey, setHoveredKey] = useState(undefined)
      const [picked, setPicked] = useState(() => new Set())
      const [graphPath, setGraphPath] = useState(undefined)
      const [quoteText, setQuoteText] = useState(undefined)
      const [quoteAnchor, setQuoteAnchor] = useState(undefined)
      const rightCardRef = useRef(null)
      const dragFilesRef = useRef(new Map())
      const [filesFilter, setFilesFilter] = useState('')
      const [menuOpen, setMenuOpen] = useState(false)
      const [branchMenuOpen, setBranchMenuOpen] = useState(false)
      const [newBranch, setNewBranch] = useState('')
      const menuRef = useRef(null)
      const branchRef = useRef(null)

      const sessionCwd = useMemo(() => {
        if (!ctx || !sessionId) return undefined
        try {
          const list = ctx.sessions?.list?.getSnapshot?.()
          const row = list?.byId?.[sessionId]
          return typeof row?.cwd === 'string' ? row.cwd : undefined
        } catch { return undefined }
      }, [ctx, sessionId])

      const preferredId = useMemo(() => {
        const items = repositories.items
        if (items.length === 0) return undefined
        if (storedId && items.some(item => item.id === storedId)) return storedId
        if (sessionCwd) {
          const match = items.find(item => item.path === sessionCwd || sessionCwd.startsWith(item.path + '/'))
          if (match) return match.id
        }
        return items[0].id
      }, [repositories.items, storedId, sessionCwd])
      const active = useMemo(() => repositories.items.find(item => item.id === preferredId), [repositories.items, preferredId])
      const groups = useMemo(() => {
        const grouped = new Map()
        for (const repository of repositories.items) {
          if (!grouped.has(repository.repoName)) grouped.set(repository.repoName, [])
          grouped.get(repository.repoName).push(repository)
        }
        return [...grouped.entries()]
      }, [repositories.items])

      const [status, refreshStatus] = useStatus(active, dataVersion)
      const branches = useBranches(active, dataVersion)
      const files = useFiles(active, dataVersion, mode === 'files')
      const [diff, refreshDiff] = useDiff(selection?.repoPath ? { path: selection.repoPath } : active, selection, dataVersion)
      const preview = useFilePreview(selection?.repoPath ? { path: selection.repoPath } : active, selection)
      const [allDiff, refreshAllDiff] = useAllDiffs(active, selection, status.data, dataVersion)
      const [worktrees, refreshWorktrees] = useWorktrees(active, dataVersion)

      useEffect(() => {
        if (!commitMenu) return undefined
        const close = event => { if (commitMenuRef.current && !commitMenuRef.current.contains(event.target)) setCommitMenu(false) }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
      }, [commitMenu])
      useEffect(() => {
        if (!active) return
        try { window.localStorage.setItem(STORAGE_REPOSITORY, active.id) } catch { /* ignore */ }
      }, [active?.id])
      useEffect(() => { setSelection(null); setFilesFilter(''); setBranchMenuOpen(false) }, [active?.id])
      useEffect(() => { try { window.localStorage.setItem('dsh-git-assistant:left-width', String(leftWidth)) } catch { /* ignore */ } }, [leftWidth])
      useEffect(() => {
        if (!menuOpen && !branchMenuOpen) return undefined
        const close = event => {
          if (menuOpen && menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
          if (branchMenuOpen && branchRef.current && !branchRef.current.contains(event.target)) setBranchMenuOpen(false)
        }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
      }, [menuOpen, branchMenuOpen])
      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 3600)
        return () => clearTimeout(timer)
      }, [toast])

      const notify = useCallback((text, kind = 'info') => setToast({ text, kind }), [])

      const stagedFiles = useMemo(() => (status.data?.staged ?? []).map(entry => ({ ...entry, __staged: true })), [status.data])
      const changeFiles = useMemo(() => [
        ...(status.data?.unstaged ?? []).map(entry => ({ ...entry, __staged: false })),
        ...(status.data?.untracked ?? []).map(entry => ({ ...entry, __staged: false })),
      ], [status.data])
      const statusByPath = useMemo(() => {
        const map = new Map()
        for (const entry of status.data?.staged ?? []) map.set(entry.path, entry.status)
        for (const entry of status.data?.unstaged ?? []) if (!map.has(entry.path)) map.set(entry.path, entry.status)
        for (const entry of status.data?.untracked ?? []) if (!map.has(entry.path)) map.set(entry.path, entry.status)
        return map
      }, [status.data])

      const selectedKey = useMemo(() => {
        if (!selection) return undefined
        if (selection.kind === 'diff') return `${selection.staged ? 's' : 'w'}:${selection.path}`
        return `f:${selection.path}`
      }, [selection])

      const run = useCallback(async (action, successText) => {
        setBusy(true)
        try {
          await action()
          if (successText) notify(successText, 'ok')
          bump()
        } catch (error) {
          notify(String(error?.message ?? error), 'error')
        } finally {
          setBusy(false)
        }
      }, [bump, notify])

      const stagePaths = useCallback(paths => run(
        () => apiPost('/stage', { path: active.path, files: paths }),
        t('stagedDone', { count: paths.length })), [active?.path, run, t])
      const unstagePaths = useCallback(paths => run(
        () => apiPost('/unstage', { path: active.path, files: paths }),
        t('unstagedDone', { count: paths.length })), [active?.path, run, t])

      const discardPaths = useCallback(paths => {
        const tracked = paths.filter(path => {
          const entry = changeFiles.find(file => file.path === path || (file.path === path && file.__staged === false))
          return entry?.status !== 'U'
        })
        const untracked = paths.filter(path => !tracked.includes(path))
        const message = paths.length === 1
          ? (tracked.length > 0 ? t('discardTracked', { file: paths[0] }) : t('discardUntracked', { file: paths[0] }))
          : t('discardAllMessage', { count: paths.length })
        setDialog({
          title: paths.length === 1 ? t('discardTitle') : t('discardAllTitle'),
          message,
          confirmLabel: t('discard'),
          cancelLabel: t('cancel'),
          danger: true,
          onConfirm: () => run(() => apiPost('/discard', { path: active.path, files: paths })),
        })
      }, [changeFiles, run, t])

      const graphRepository = graphPath ? { path: graphPath } : active
      const graphDrawer = mode === 'changes'
        ? h(GraphPanel, {
            t, repository: graphRepository, width: leftWidth,
            onOpenDiff: (hash, path) => {
              if (!graphRepository?.path) return
              setSelection({ kind: 'commit-diff', repoPath: graphRepository.path, hash, path })
            },
          })
        : null
      const worktreeFilesCards = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0 44px' } },
        worktrees.items.map(item => h(WorktreeFilesCard, {
          key: item.path, t, item, defaultOpen: item.path === active?.path || Boolean(item.isMain),
          selectedPath: selection?.kind === 'file' ? selection.path : undefined,
          onSelect: path => setGraphPath(path),
          onOpen: (file, repoPath) => { setGraphPath(repoPath); setSelection({ kind: 'file', path: file.path, repoPath }) },
        })))
      const worktreeCards = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0 44px' } },
        worktrees.items.map(item => h(WorktreeCard, {
          key: item.path, t, item, defaultOpen: item.path === active?.path || Boolean(item.isMain),
          selectedPath: selection?.kind === 'diff' ? selection.path : undefined,
          onNotify: notify,
          onChanged: () => { refreshWorktrees(); bump() },
          onSelect: path => setGraphPath(path),
          onOpen: (file, repoPath) => { setGraphPath(repoPath); setSelection({ kind: 'diff', path: file.path, staged: Boolean(file.__staged), repoPath }) },
        })))
      const openAll = useCallback(staged => { setSelection({ kind: 'all', staged: Boolean(staged) }) }, [])
      const discardAll = useCallback(() => discardPaths(changeFiles.map(file => file.path)), [discardPaths, changeFiles])

      const commit = useCallback((action = 'commit') => {
        if (busy) return
        const message = commitRef.current?.value ?? commitMessage
        if (!message.trim() && action !== 'amend') { notify(t('commitEmpty'), 'error'); return }
        setCommitMenu(false)
        run(async () => {
          await apiPost('/commit', { path: active.path, message, action })
          if (commitRef.current) commitRef.current.value = ''
          setCommitMessage('')
          setAmend(false)
          if (selection?.kind === 'diff') refreshDiff()
        }, t(action === 'push' ? 'committedPushed' : action === 'sync' ? 'committedSynced' : 'committed'))
      }, [busy, commitMessage, active?.path, run, t, selection, refreshDiff])

      const switchBranch = useCallback(branch => {
        setBranchMenuOpen(false)
        const dirty = (status.data?.staged?.length ?? 0) + (status.data?.unstaged?.length ?? 0) + (status.data?.untracked?.length ?? 0) > 0
        const go = () => run(async () => { await apiPost('/switch', { path: active.path, branch }) }, t('switched', { branch }))
        if (dirty) {
          setDialog({
            title: t('switchConfirmTitle'),
            message: t('switchConfirm', { branch }),
            confirmLabel: t('confirm'), cancelLabel: t('cancel'), danger: false,
            onConfirm: go,
          })
        } else go()
      }, [active?.path, run, status.data, t])

      const createBranch = useCallback(() => {
        const name = newBranch.trim()
        if (!name) return
        setBranchMenuOpen(false)
        setNewBranch('')
        run(async () => { await apiPost('/branch/create', { path: active.path, name }); }, t('created', { branch: name }))
      }, [active?.path, newBranch, run, t])

      const toggleSection = key => {
        setCollapsedSections(previous => {
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }
      const toggleDir = path => {
        setExpandedDirs(previous => {
          const next = new Set(previous)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }
      const quoteSelected = useCallback(() => {
        const text = quoteText
        if (!text) return
        setQuoteAnchor(undefined)
        let inserted = false
        try { inserted = Boolean(inputActions && typeof inputActions.insertQuote === 'function' && inputActions.insertQuote(text)) } catch { inserted = false }
        if (inserted) notify(t('quoted'))
        else { try { navigator.clipboard?.writeText(text) } catch { /* ignore */ } ; notify(t('quoteCopied')) }
        setQuoteText(undefined)
      }, [quoteText, inputActions, notify, t])
      const captureQuote = () => {
        try {
          const selection = window.getSelection?.()
          const value = selection?.toString().trim()
          if (!value || value.length < 2 || !selection || selection.rangeCount === 0) {
            setQuoteText(undefined); setQuoteAnchor(undefined); return
          }
          const range = selection.getRangeAt(0)
          const box = rightCardRef.current?.getBoundingClientRect()
          const rect = range.getBoundingClientRect()
          setQuoteText(value.slice(0, 6000))
          if (box && rect.width + rect.height > 0) {
            setQuoteAnchor({
              x: Math.min(Math.max(rect.left - box.left + rect.width / 2, 60), box.width - 60),
              y: Math.max(rect.top - box.top, 34),
            })
          } else setQuoteAnchor(undefined)
        } catch { /* ignore */ }
      }
      useEffect(() => {
        if (!active?.path) { dragFilesRef.current.clear(); return undefined }
        let live = true
        for (const key of picked) {
          const file = key.slice(2)
          if (dragFilesRef.current.has(file)) continue
          fetch(new URL(`/git-assistant/api/raw?path=${encodeURIComponent(active.path)}&file=${encodeURIComponent(file)}`, window.location.origin))
            .then(response => response.ok ? response.blob() : undefined)
            .then(blob => { if (live && blob && blob.size <= 3_000_000) dragFilesRef.current.set(file, blob) })
            .catch(() => { /* ignore */ })
        }
        return () => { live = false }
      }, [picked, active?.path])
      const startDrag = (file, event) => {
        const keys = picked.has(keyOf(file)) && picked.size > 0 ? [...picked] : [keyOf(file)]
        const paths = keys.map(key => key.slice(2))
        const token = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()))
        dragPayload = { token, paths }
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(DRAG_TYPE, token)
        event.dataTransfer.setData('text/plain', `@${file.path}`)
      }
      useEffect(() => {
        if (!sessionId) return undefined
        const onOver = event => {
          if (!event.dataTransfer?.types?.includes(DRAG_TYPE)) return
          const card = composerCardFor(event.target, sessionId)
          if (!card) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
        const onDrop = async event => {
          const token = event.dataTransfer?.getData(DRAG_TYPE)
          if (!token || !dragPayload || dragPayload.token !== token) return
          const card = composerCardFor(event.target, sessionId)
          if (!card) return
          event.preventDefault()
          event.stopPropagation()
          const payload = dragPayload
          dragPayload = null
          const files = []
          for (const path of payload.paths.slice(0, 20)) {
            try {
              const url = new URL('/git-assistant/api/raw', window.location.origin)
              url.searchParams.set('path', active?.path ?? '')
              url.searchParams.set('file', path)
              const response = await fetch(url)
              if (!response.ok) continue
              const blob = await response.blob()
              if (blob.size > 4_000_000) continue
              files.push(new File([blob], path.split('/').pop() || path, { type: blob.type || 'application/octet-stream' }))
            } catch { /* ignore */ }
          }
          if (files.length === 0 || !card.isConnected) return
          const data = new DataTransfer()
          for (const file of files) data.items.add(file)
          card.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
        }
        const onEnd = () => { dragPayload = null }
        document.addEventListener('dragover', onOver, true)
        document.addEventListener('drop', onDrop, true)
        document.addEventListener('dragend', onEnd, true)
        return () => {
          document.removeEventListener('dragover', onOver, true)
          document.removeEventListener('drop', onDrop, true)
          document.removeEventListener('dragend', onEnd, true)
        }
      }, [sessionId, active?.path])
      const startResize = useCallback(event => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = leftWidth
        const move = moveEvent => setLeftWidth(Math.min(560, Math.max(240, startWidth + moveEvent.clientX - startX)))
        const stop = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', stop)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', stop)
      }, [leftWidth])

      const keyOf = file => file.__staged === undefined ? `f:${file.path}` : `${file.__staged ? 's' : 'w'}:${file.path}`
      const openDiff = (file, event) => {
        const key = keyOf(file)
        setMode('changes')
        setSelection({ kind: 'diff', path: file.path, staged: Boolean(file.__staged) })
        setPicked(previous => {
          const next = new Set(previous)
          if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
            if (next.has(key)) next.delete(key)
            else next.add(key)
          } else {
            next.clear(); next.add(key)
          }
          return next
        })
      }
      const pickedPathsFor = file => {
        const key = keyOf(file)
        if (picked.has(key) && picked.size > 1) return [...picked].map(value => value.slice(2))
        return [file.path]
      }
      const scopedPaths = (allPaths) => {
        if (picked.size === 0) return allPaths
        const wanted = new Set([...picked].map(value => value.slice(2)))
        const filtered = allPaths.filter(path => wanted.has(path))
        return filtered.length > 0 ? filtered : allPaths
      }
      const openFile = (file, event) => {
        setSelection({ kind: 'file', path: file.path })
        const key = keyOf(file)
        setPicked(previous => {
          const next = new Set(previous)
          if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
            if (next.has(key)) next.delete(key)
            else next.add(key)
          } else {
            next.clear(); next.add(key)
          }
          return next
        })
      }

      const filteredFiles = useMemo(() => {
        const query = filesFilter.trim().toLowerCase()
        if (!query) return files.files
        return files.files.filter(path => path.toLowerCase().includes(query)).slice(0, 400)
      }, [files.files, filesFilter])

      const changeTree = useMemo(() => fileRows([
        ...stagedFiles.map(file => ({ ...file })),
      ]), [stagedFiles])
      const workingTree = useMemo(() => fileRows(changeFiles), [changeFiles])
      const repositoryFilesTree = useMemo(() => fileRows(filteredFiles.map(path => ({ path, status: statusByPath.get(path) }))), [filteredFiles, statusByPath])

      const changesCount = stagedFiles.length + changeFiles.length
      const dirty = changesCount > 0
      const ahead = status.data?.ahead ?? 0
      const behind = status.data?.behind ?? 0

      return h('div', {
        style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: T.text, fontSize: 13.5, lineHeight: 1.55, position: 'relative', overflow: 'hidden', fontFamily: T.sans, letterSpacing: '0.005em' },
      },
        // ambient wash — very low-saturation colour light behind the cards, as in the media workbench
        h('div', {
          'aria-hidden': true,
          style: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity: 0.75 },
        },
          h('div', {
            style: {
              position: 'absolute', left: '-16%', top: '-32%', width: '58%', height: '66%', borderRadius: '50%',
              filter: 'blur(80px)', background: 'radial-gradient(circle, color-mix(in srgb, var(--dsw-alias-link, #7aa2ff) 11%, transparent), transparent 70%)',
            },
          }),
          h('div', {
            style: {
              position: 'absolute', right: '-14%', bottom: '-36%', width: '54%', height: '60%', borderRadius: '50%',
              filter: 'blur(90px)', background: 'radial-gradient(circle, color-mix(in srgb, var(--dsw-alias-brand-primary, #a78bfa) 9%, transparent), transparent 70%)',
            },
          })),
        // ── title bar ──────────────────────────────────────────
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 12px',
            margin: '10px 12px 0', borderRadius: T.rLg, background: T.glass,
            border: `0.5px solid ${T.border}`, boxShadow: T.shadowSoft,
            backdropFilter: 'blur(24px) saturate(160%)', flex: '0 0 auto', position: 'relative', zIndex: 2,
          },
        },
          h('span', { style: { display: 'inline-flex', opacity: 0.6 } }, h(GitIcon, { size: 15 })),
          h('span', { style: { fontFamily: T.serif, fontSize: 15.5, lineHeight: '20px', fontWeight: 500, letterSpacing: '0.015em', whiteSpace: 'nowrap' } }, t('title')),
          h('span', { 'aria-hidden': true, style: { opacity: 0.25 } }, '·'),
          h('div', { ref: menuRef, style: { position: 'relative', minWidth: 0 } },
            h('button', {
              type: 'button', onClick: () => setMenuOpen(open => !open), disabled: repositories.items.length === 0,
              title: active?.path ?? t('pickRepo'),
              style: {
                appearance: 'none', border: `0.5px solid ${menuOpen ? T.border : 'transparent'}`,
                background: menuOpen ? T.hover : 'transparent', color: 'inherit', font: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: T.rMd,
                cursor: repositories.items.length === 0 ? 'default' : 'pointer', maxWidth: 440, minWidth: 0,
                transition: `background .18s ${T.ease}, border-color .18s ${T.ease}`,
              },
            },
              h('span', { style: { fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                active ? active.repoName : t('noRepos')),
              active ? h('span', { style: { fontFamily: MONO, fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap' } },
                active.branch ?? t('detached')) : null,
              h(Chevron, { open: menuOpen, size: 9 })),
            menuOpen ? h('div', {
              style: {
                position: 'absolute', top: '100%', left: 0, marginTop: 8, zIndex: 40, width: 420,
                maxHeight: 460, overflowY: 'auto', background: T.menu, border: `0.5px solid ${T.border}`,
                borderRadius: T.rLg, padding: 6, boxShadow: T.shadowProminent,
                backdropFilter: 'blur(28px) saturate(170%)',
              },
            }, ...groups.flatMap(([repoName, entries]) => [
              h('div', {
                key: `group:${repoName}`,
                style: { padding: '8px 10px 4px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.subtle },
              }, repoName),
              ...entries.map(repository => h('button', {
                key: repository.id, type: 'button',
                onClick: () => { setStoredId(repository.id); setMenuOpen(false) },
                style: {
                  appearance: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 1, padding: '6px 10px 6px 20px', borderRadius: T.rSm,
                  font: 'inherit', color: 'inherit',
                  background: repository.id === active?.id ? T.selected : 'transparent',
                },
                onMouseEnter: event => { if (repository.id !== active?.id) event.currentTarget.style.background = T.hover },
                onMouseLeave: event => { if (repository.id !== active?.id) event.currentTarget.style.background = 'transparent' },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
                  h('span', { style: { fontSize: 12, fontFamily: MONO, opacity: repository.isMain ? 0.9 : 0.65 } }, repository.branch ?? t('detached')),
                  h('span', { style: { fontSize: 10, opacity: 0.4, border: `1px solid ${T.border}`, borderRadius: 4, padding: '0 4px' } },
                    repository.isMain ? t('mainWorktree') : t('worktree'))),
                h('span', {
                  style: { fontSize: 10.5, fontFamily: MONO, opacity: 0.34, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                }, repository.path)))])) : null),

          // branch chip + menu
          active ? h('div', { ref: branchRef, style: { position: 'relative', minWidth: 0 } },
            h('button', {
              type: 'button', onClick: () => setBranchMenuOpen(open => !open), title: t('branches'),
              style: {
                appearance: 'none', border: 'none', boxShadow: `inset 0 0 0 0.5px ${T.lineStrong}`,
                background: branchMenuOpen ? T.hover : 'color-mix(in srgb, var(--dsw-alias-bg-layer-2, currentColor) 58%, transparent)',
                color: T.ink2, font: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: T.pill,
                cursor: 'pointer', maxWidth: 260, minWidth: 0, transition: `background .18s ${T.ease}`,
              },
            },
              h('span', { style: { fontFamily: MONO, fontSize: 11.5, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                active.branch ?? t('detached')),
              h(Chevron, { open: branchMenuOpen, size: 8 })),
            branchMenuOpen ? h('div', {
              style: {
                position: 'absolute', top: '100%', left: 0, marginTop: 8, zIndex: 40, width: 280,
                maxHeight: 380, overflowY: 'auto', background: T.menu, border: `0.5px solid ${T.border}`,
                borderRadius: T.rLg, padding: 6, boxShadow: T.shadowProminent,
                backdropFilter: 'blur(28px) saturate(170%)',
              },
            },
              ...branches.items.map(branch => h('button', {
                key: branch.name, type: 'button',
                onClick: () => switchBranch(branch.name),
                style: {
                  appearance: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: T.rSm,
                  font: 'inherit', color: 'inherit', background: branch.current ? T.selected : 'transparent',
                },
                onMouseEnter: event => { if (!branch.current) event.currentTarget.style.background = T.hover },
                onMouseLeave: event => { if (!branch.current) event.currentTarget.style.background = 'transparent' },
              },
                h('span', { style: { width: 12, fontSize: 11, opacity: branch.current ? 0.85 : 0.25 } }, '✓'),
                h('span', { style: { fontSize: 12, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, branch.name),
                h('span', { style: { flex: 1 } }),
                branch.upstream ? h('span', { style: { fontSize: 9.5, opacity: 0.35, fontFamily: MONO } }, branch.upstream) : null)),
              h('div', { style: { display: 'flex', gap: 6, padding: '6px 8px 3px', borderTop: `1px solid ${T.borderSoft}`, marginTop: 4 } },
                h('input', {
                  value: newBranch, placeholder: t('branchPlaceholder'),
                  onChange: event => setNewBranch(event.target.value),
                  onKeyDown: event => { if (event.key === 'Enter') createBranch() },
                  style: {
                    flex: 1, minWidth: 0, background: T.layer, color: 'inherit', border: `1px solid ${T.border}`,
                    borderRadius: 5, padding: '3px 7px', fontSize: 11.5, fontFamily: MONO, outline: 'none',
                  },
                }),
                h(SmallButton, { label: t('createBranch'), onClick: createBranch, disabled: !newBranch.trim() }))) : null)
            : null,

          h('span', { style: { flex: 1 } }),
          ahead > 0 || behind > 0 || status.data?.conflicted?.length
            ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11, fontFamily: MONO, opacity: 0.6, whiteSpace: 'nowrap' } },
                ahead > 0 ? h('span', { title: t('ahead') }, `↑${ahead}`) : null,
                behind > 0 ? h('span', { title: t('behind') }, `↓${behind}`) : null,
                status.data?.conflicted?.length ? h('span', { style: { color: T.error, fontFamily: 'inherit' } }, t('conflicts')) : null)
            : null,
          h(IconButton, { label: t('refresh'), onClick: () => { refreshStatus(); bump(); refreshRepositories() } }, h(RefreshIcon, {}))),

        // ── body ────────────────────────────────────────────────
        h('div', { style: { display: 'flex', flex: 1, minHeight: 0, gap: 6, padding: '10px 12px 12px', minWidth: 0, position: 'relative' } },
          // left column
          h('div', {
            style: {
              width: leftWidth, flex: `0 0 ${leftWidth}px`, minWidth: 240, borderRadius: T.rLg, background: T.glass,
              border: `0.5px solid ${T.border}`, boxShadow: T.shadowSoft,
              backdropFilter: 'blur(24px) saturate(160%)',
              display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
            },
          },
            // mode tabs
            h('div', { style: { padding: '10px 12px 2px' } },
              h('div', {
                style: {
                  display: 'inline-flex', gap: 0, padding: 3, borderRadius: T.rMd,
                  background: T.hover, border: `0.5px solid ${T.borderSoft}`,
                },
              },
                ['changes', 'files'].map(value => h('button', {
                  key: value, type: 'button', onClick: () => setMode(value),
                  style: {
                    appearance: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 11.5,
                    height: 26, padding: '0 12px', borderRadius: T.rSm,
                    background: mode === value ? T.card : 'transparent',
                    color: mode === value ? T.text : T.muted,
                    boxShadow: mode === value ? T.shadowSoft : 'none',
                    transition: `background .2s ${T.ease}, color .2s ${T.ease}`,
                  },
                }, value === 'changes' ? t('changesTab') : t('filesTab'))))),

            mode === 'changes' ? worktreeCards
              : mode === 'changes' ? h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 12 } },
              active ? h('div', {
                style: { padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `0.5px solid ${T.borderSoft}` },
              },
                h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 } },
                  h('span', { style: { fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' } }, active.repoName),
                  h('span', { style: { fontSize: 10.5, fontFamily: MONO, opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    active.path),
                  h('span', { style: { fontSize: 10.5, fontFamily: MONO, opacity: 0.5 } }, active.branch ?? t('noBranch'))),
                h('textarea', {
                  defaultValue: commitMessage, placeholder: t('commitPlaceholder'), rows: 2, ref: commitRef,
                  onChange: event => setCommitMessage(event.target.value),
                  onKeyDown: event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commit('commit') } },
                  style: {
                    resize: 'vertical', minHeight: 42, maxHeight: 140,
                    background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, currentColor) 46%, transparent)',
                    color: 'inherit', border: `0.5px solid ${T.border}`, borderRadius: T.rMd,
                    padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
                    lineHeight: '18px', transition: `border-color .18s ${T.ease}, background .18s ${T.ease}`,
                  },
                }),
                h('div', { style: { display: 'flex', alignItems: 'stretch', gap: 0, width: '100%' } },
                  h('div', {
                    ref: commitMenuRef,
                    style: {
                      position: 'relative', display: 'flex', alignItems: 'stretch', width: '100%',
                      height: 32, borderRadius: T.rMd,
                      border: `0.5px solid ${T.border}`,
                      background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, currentColor) 52%, transparent)',
                    },
                  },
                    h('button', {
                      type: 'button', onClick: () => commit('commit'), disabled: busy || !commitMessage.trim(),
                      style: {
                        appearance: 'none', border: 'none', flex: 1, cursor: busy ? 'default' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        background: 'transparent', color: T.ink2, font: 'inherit', fontSize: 12,
                        opacity: busy || !commitMessage.trim() ? 0.45 : 1,
                        transition: `background .15s ${T.ease}, color .15s ${T.ease}`,
                      },
                      onMouseEnter: event => { if (!busy && commitMessage.trim()) { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = T.text } },
                      onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = T.ink2 },
                    },
                      busy ? t('committing') : t('commit'),
                      h('span', { style: { fontFamily: MONO, fontSize: 10, opacity: 0.45 } }, '⌘↩')),
                    h('button', {
                      type: 'button', onClick: () => setCommitMenu(open => !open), disabled: busy, title: '更多提交方式',
                      style: {
                        appearance: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', width: 34,
                        background: 'transparent', color: T.muted, fontSize: 12,
                        borderLeft: `0.5px solid ${T.border}`, opacity: busy ? 0.4 : 1,
                        transition: `background .15s ${T.ease}`,
                      },
                      onMouseEnter: event => { event.currentTarget.style.background = T.hover },
                      onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                    }, '▾'),
                    commitMenu ? h('div', {
                      style: {
                        position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, zIndex: 70, width: 170,
                        background: T.menu, border: `0.5px solid ${T.border}`, borderRadius: T.rMd, padding: 4,
                        boxShadow: T.shadowProminent, backdropFilter: 'blur(28px) saturate(170%)',
                      },
                    },
                      ...[['commit', t('commit')], ['amend', t('commitAmend')], ['push', t('commitPush')], ['sync', t('commitSync')]]
                        .map(([key, label]) => h('button', {
                          key, type: 'button', onClick: () => commit(key),
                          style: {
                            appearance: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
                            background: 'transparent', color: 'inherit', padding: '6px 10px', borderRadius: T.rSm,
                            fontSize: 12,
                          },
                          onMouseEnter: event => { event.currentTarget.style.background = T.hover },
                          onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                        }, label))) : null)),
                dirty ? h('div', { style: { fontSize: 10.5, opacity: 0.4 } }, t('dirtyCount', { count: dirty })) : null)
              : null,
              status.phase === 'loading' && !status.data
                ? h('div', { style: { padding: '14px 13px', fontSize: 12, opacity: 0.5 } }, t('loading'))
                : status.phase === 'error'
                  ? h('div', { style: { padding: '14px 13px', fontSize: 12, color: T.error, opacity: 0.85 } }, `${t('loadError')}: ${status.error}`)
                  : h('div', {},
                      h(Section, {
                        title: t('staged'), count: stagedFiles.length,
                        collapsed: collapsedSections.has('staged'), onToggle: () => toggleSection('staged'),
                        actions: h('span', { style: { display: 'inline-flex', gap: 1, alignItems: 'center' } },
                          h(IconAction, { label: t('viewAll'), onClick: () => openAll(true) }, h(IconDiff)),
                          stagedFiles.length > 0
                            ? h(IconAction, { label: t('unstageAll'), onClick: () => unstagePaths(picked.size > 0 ? scopedPaths(stagedFiles.map(file => file.path)) : stagedFiles.map(file => file.path)), disabled: busy }, h(IconMinus))
                            : null),
                      }, stagedFiles.length === 0
                        ? h('div', { style: { padding: '0 12px 4px 30px', fontSize: 11.5, opacity: 0.34 } }, '—')
                        : h(TreeRows, {
                            node: changeTree, depth: 0, expandedDirs, onToggleDir: toggleDir, pickedKeys: picked, onDragStartRow: startDrag,
                            onOpen: openDiff, selectedKey, statusByPath, showStatus: false,
                            hoveredKey, onHoverKey: setHoveredKey,
                            actionsFor: file => h(IconAction, { label: t('unstage'), onClick: event => { event.stopPropagation(); unstagePaths(pickedPathsFor(file)) }, disabled: busy }, h(IconMinus)),
                          })),
                      h(Section, {
                        title: t('changes'), count: changeFiles.length,
                        collapsed: collapsedSections.has('changes'), onToggle: () => toggleSection('changes'),
                        actions: h('span', { style: { display: 'inline-flex', gap: 1, alignItems: 'center' } },
                          h(IconAction, { label: t('viewAll'), onClick: () => openAll(false) }, h(IconDiff)),
                          changeFiles.length > 0
                            ? h(IconAction, { label: t('discardAll'), danger: true, onClick: () => discardPaths(picked.size > 0 ? scopedPaths(changeFiles.map(file => file.path)) : changeFiles.map(file => file.path)), disabled: busy }, h(IconUndo))
                            : null,
                          changeFiles.length > 0
                            ? h(IconAction, { label: t('stageAll'), onClick: () => stagePaths(picked.size > 0 ? scopedPaths(changeFiles.map(file => file.path)) : changeFiles.map(file => file.path)), disabled: busy }, h(IconPlus))
                            : null),
                      }, changeFiles.length === 0
                        ? h('div', { style: { padding: '0 12px 4px 30px', fontSize: 11.5, opacity: 0.34 } }, '—')
                        : h(TreeRows, {
                            node: workingTree, depth: 0, expandedDirs, onToggleDir: toggleDir, pickedKeys: picked, onDragStartRow: startDrag,
                            onOpen: openDiff, selectedKey, statusByPath, showStatus: false,
                            hoveredKey, onHoverKey: setHoveredKey,
                            actionsFor: file => h('span', { style: { display: 'inline-flex', gap: 1 } },
                              h(IconAction, { label: t('discard'), danger: true, onClick: event => { event.stopPropagation(); discardPaths(pickedPathsFor(file)) }, disabled: busy }, h(IconUndo)),
                              h(IconAction, { label: t('stage'), onClick: event => { event.stopPropagation(); stagePaths(pickedPathsFor(file)) }, disabled: busy }, h(IconPlus))),
                          })),
                      status.data?.untrackedOmitted
                        ? h('div', { style: { padding: '4px 12px', fontSize: 10.5, opacity: 0.4 } }, t('omitted', { count: status.data.untrackedOmitted }))
                        : null))
              : mode === 'files' ? worktreeFilesCards
              : h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: { padding: '8px 10px' } },
                    h('input', {
                      value: filesFilter, placeholder: t('filterPlaceholder'),
                      onChange: event => setFilesFilter(event.target.value),
                      style: {
                        width: '100%', boxSizing: 'border-box',
                        background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, currentColor) 46%, transparent)',
                        color: 'inherit', border: `0.5px solid ${T.border}`, borderRadius: T.rMd,
                        padding: '6px 11px', fontSize: 12, outline: 'none',
                      },
                    })),
                  h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 12 } },
                    files.phase === 'loading'
                      ? h('div', { style: { padding: '10px 12px', fontSize: 12, opacity: 0.5 } }, t('filesLoading'))
                      : files.phase === 'error'
                        ? h('div', { style: { padding: '10px 12px', fontSize: 12, color: T.error } }, t('loadError'))
                        : filteredFiles.length === 0
                          ? h('div', { style: { padding: '10px 12px', fontSize: 12, opacity: 0.4 } }, t('noFiles'))
                          : h(TreeRows, {
                              node: repositoryFilesTree, depth: 0, expandedDirs, onToggleDir: toggleDir, pickedKeys: picked, onDragStartRow: startDrag,
                              onOpen: openFile, selectedKey, statusByPath, showStatus: true, actionsFor: null,
                              hoveredKey, onHoverKey: setHoveredKey,
                            }),
                    files.truncated ? h('div', { style: { padding: '6px 12px', fontSize: 10.5, opacity: 0.4 } }, t('filesTruncated', { count: files.total })) : null))),

          // commit graph drawer docked over the workbench column
          graphDrawer,

          // resize handle between the two cards
          h('div', {
            role: 'separator', 'aria-orientation': 'vertical', title: t('resize'), onPointerDown: startResize,
            style: { flex: '0 0 6px', alignSelf: 'stretch', cursor: 'col-resize', borderRadius: 3, transition: `background .15s ${T.ease}` },
            onMouseEnter: event => { event.currentTarget.style.background = T.borderSoft },
            onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
          }),

          // right column
          h('div', {
            style: {
              flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative',
              borderRadius: T.rLg, background: T.glass, border: `0.5px solid ${T.border}`,
              boxShadow: T.shadowSoft, backdropFilter: 'blur(24px) saturate(160%)', overflow: 'hidden',
            },
            onMouseUp: captureQuote,
            ref: rightCardRef,
          },
            quoteText ? h('button', {
              type: 'button', onClick: quoteSelected,
              style: {
                position: 'absolute', zIndex: 20, height: 26, padding: '0 11px',
                left: quoteAnchor ? quoteAnchor.x : 24, top: quoteAnchor ? Math.max(quoteAnchor.y - 34, 6) : 10,
                transform: quoteAnchor ? 'translateX(-50%)' : 'none',
                borderRadius: T.pill, border: `0.5px solid ${T.border}`, background: T.menu,
                color: T.ink2, fontSize: 11.5, cursor: 'pointer', boxShadow: T.shadowProminent,
                backdropFilter: 'blur(16px)',
              },
            }, t('quoteAction')) : null,
            selection ? h('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: 8, minHeight: 46, padding: '0 14px',
                borderBottom: `0.5px solid ${T.borderSoft}`, flex: '0 0 auto', minWidth: 0,
              },
            },
              (() => {
                if (selection.kind === 'all') {
                  const count = selection.staged ? stagedFiles.length : changeFiles.length
                  return h('span', { style: { fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' } },
                    selection.staged ? t('allStaged') : t('allChanges'),
                    h('span', { style: { marginLeft: 7, fontFamily: MONO, fontSize: 10.5, color: T.muted } }, String(count)))
                }
                const parts = splitPath(selection.path)
                return h('span', { style: { fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, title: selection.path },
                  h('span', { style: { opacity: 0.45 } }, parts.dir),
                  h('span', { style: { fontWeight: 500 } }, parts.name))
              })(),
              selection.kind !== 'file'
                ? h('span', { style: { fontSize: 10.5, color: T.muted, border: `0.5px solid ${T.border}`, borderRadius: T.pill, padding: '1px 8px', whiteSpace: 'nowrap', fontFamily: selection.kind === 'commit-diff' ? MONO : undefined } },
                    selection.kind === 'commit-diff' ? selection.hash.slice(0, 7) : selection.staged ? t('staged') : t('changes'))
                : h('span', { style: { fontSize: 10.5, opacity: 0.5, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' } },
                    t('readOnly')),
              h('span', { style: { flex: 1 } }),
              selection.kind !== 'file'
                ? h('span', { style: { display: 'inline-flex', gap: 7, fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' } },
                    (() => {
                      if (selection.kind === 'diff' || selection.kind === 'commit-diff') {
                        const file = diff.data?.files?.[0]
                        return file ? [h('span', { key: 'a', style: { color: T.success } }, `+${file.additions ?? 0}`), h('span', { key: 'd', style: { color: T.error } }, `−${file.deletions ?? 0}`)] : null
                      }
                      const totals = allDiff.entries.reduce((sum, item) => ({ add: sum.add + (item.entry?.additions ?? 0), del: sum.del + (item.entry?.deletions ?? 0) }), { add: 0, del: 0 })
                      return [h('span', { key: 'a', style: { color: T.success } }, `+${totals.add}`), h('span', { key: 'd', style: { color: T.error } }, `−${totals.del}`)]
                    })())
                : null,
              selection.kind !== 'file'
                ? h('span', { style: { display: 'inline-flex', padding: 2, borderRadius: T.pill, background: T.hover, border: `0.5px solid ${T.borderSoft}` } },
                    ['unified', 'split'].map(value => h('button', {
                      key: value, type: 'button', onClick: () => setView(value),
                      style: {
                        appearance: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 10.5,
                        height: 22, padding: '0 10px', borderRadius: T.pill,
                        background: view === value ? T.card : 'transparent',
                        color: view === value ? T.text : T.muted,
                        boxShadow: view === value ? T.shadowSoft : 'none',
                        transition: `background .18s ${T.ease}, color .18s ${T.ease}`,
                      },
                    }, t(value))))
                : null,
              h(IconButton, { label: t('refresh'), onClick: () => { if (selection.kind === 'diff' || selection.kind === 'commit-diff') refreshDiff(); else if (selection.kind === 'all') refreshAllDiff(); bump() } }, h(RefreshIcon, {})))
              : null,

            selection
              ? selection.kind === 'diff' || selection.kind === 'commit-diff'
                ? diff.phase === 'loading'
                  ? h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('loading'))
                  : diff.phase === 'error'
                    ? h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, diff.error)
                    : h(DiffLines, { file: diff.data?.files ?? [], view, t })
                : selection.kind === 'all'
                  ? h(AllDiff, { state: allDiff, view, t })
                  : h(FilePreview, { state: { ...preview, data: preview.data ? { ...preview.data, repoPath: active?.path } : null }, selection, t })
              : h('div', {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28, textAlign: 'center' },
                },
                  h('div', {
                    style: {
                      display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56,
                      borderRadius: '50%', background: T.hover, border: `0.5px solid ${T.border}`, color: T.muted,
                    },
                  },
                    h('svg', { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' },
                      h('path', { d: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }),
                      h('path', { d: 'M9 8h6M9 12h6M9 16h4' }))),
                  h('div', { style: { fontFamily: T.serif, fontSize: 18, lineHeight: '26px', fontWeight: 500, color: T.ink2, letterSpacing: '0.01em' } }, t('emptyDiff')),
                  h('div', { style: { fontSize: 12.5, color: T.muted, maxWidth: 340, lineHeight: '20px' } }, t('emptyDiffHint'))))),

        h(Dialog, { dialog, onClose: () => setDialog(null) }),
        h(Toast, { toast }))
    }

    /**
     * Conversation-seat wrapper: while this Git view is the active conversation view, the resident composer is
     * replaced with nothing through the public 'conversation.composer' chain slot; switching back to Chat
     * disposes the takeover and the default composer returns.
     */
    function ConversationGitView({ t, ctx, sessionId, renderFactorySlot, inputActions }) {
      useEffect(() => {
        if (!sessionId || !ctx?.slots?.register) return undefined
        let dispose
        try {
          dispose = ctx.slots.register({
            name: 'conversation.composer',
            select: owner => (owner && owner.sessionId === sessionId ? { hidden: true } : null),
          }, () => null)
        } catch {
          return undefined
        }
        return () => { try { dispose?.() } catch { /* already gone */ } }
      }, [ctx, sessionId])
      return h(Panel, { t, ctx, sessionId, renderFactorySlot, inputActions })
    }

    /* ── registration ───────────────────────────────────────────────── */

    const inject = ['slots', 'locale', 'sessions']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'dsh-git-assistant: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', key: ID, locale: NS },
        props => h(Panel, { t: props?.t ?? t, ctx, renderFactorySlot: props?.renderFactorySlot, inputActions: props?.inputActions })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: ID, order: 24, label: () => t('label'), locale: NS },
        props => h(GitIcon, { size: props?.size })))
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: ID, order: 24, locale: NS, label: () => t('label') },
        props => h(ConversationGitView, { t: props?.t ?? t, ctx, sessionId: props?.sessionId, renderFactorySlot: props?.renderFactorySlot, inputActions: props?.inputActions })))
      // Right-sidebar seat: same workbench as a per-session right column.
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: ID, locale: NS },
        props => h(Panel, { t: props?.t ?? t, ctx, sessionId: props?.sessionId, renderFactorySlot: props?.renderFactorySlot, inputActions: props?.inputActions })))
      const tabs = typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : ctx.sidebarRightTabs
      if (tabs && typeof tabs.register === 'function') {
        ctx.effect(() => tabs.register({
          id: ID,
          kind: ID,
          title: () => t('label'),
          guide: [{ id: ID, order: 40, title: () => t('label'), description: () => t('rightbarHint') }],
        }), 'dsh-git-assistant: right sidebar tab type')
      }
    }

    return { inject, apply, __internals: { tokenize, languageOf, unifiedRows, splitRows, DiffLines, TreeRows, FilePreview, DICT, computeGraphLanes } }
  },
})
