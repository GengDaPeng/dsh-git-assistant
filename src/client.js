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
    const SHARED_STATE = new Map()
    const SHARED_LISTENERS = new Set()

    function useSharedState(key, initial) {
      const [value, setValue] = useState(() => {
        if (SHARED_STATE.has(key)) return SHARED_STATE.get(key)
        const next = typeof initial === 'function' ? initial() : initial
        SHARED_STATE.set(key, next)
        return next
      })
      useEffect(() => {
        const listener = () => setValue(SHARED_STATE.get(key))
        SHARED_LISTENERS.add(listener)
        return () => { SHARED_LISTENERS.delete(listener) }
      }, [key])
      const set = useCallback(next => {
        const computed = typeof next === 'function' ? next(SHARED_STATE.get(key)) : next
        SHARED_STATE.set(key, computed)
        for (const listener of SHARED_LISTENERS) listener()
      }, [key])
      return [value, set]
    }

    const statusBus = new Map()
    let statusLoop = null

    function statusEntryOf(path) {
      let entry = statusBus.get(path)
      if (!entry) {
        entry = { path, listeners: new Set(), state: { phase: 'idle', data: null, error: null }, inFlight: null, queued: false, failures: 0, lastFetch: 0 }
        statusBus.set(path, entry)
      }
      return entry
    }

    function notifyStatus(entry) {
      for (const listener of entry.listeners) listener(entry.state)
    }

    function loadStatusEntry(entry) {
      if (entry.inFlight) { entry.queued = true; return entry.inFlight }
      entry.lastFetch = Date.now()
      entry.inFlight = api('/status', { path: entry.path })
        .then(data => {
          entry.failures = 0
          entry.state = { phase: 'ready', data, error: null }
        })
        .catch(error => {
          entry.failures = Math.min(entry.failures + 1, 4)
          entry.state = { phase: 'error', data: entry.state.data, error: String(error?.message ?? error) }
        })
        .finally(() => {
          entry.inFlight = null
          notifyStatus(entry)
          if (entry.queued) { entry.queued = false; loadStatusEntry(entry) }
        })
      return entry.inFlight
    }

    function ensureStatusLoop() {
      if (statusLoop) return
      statusLoop = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        const now = Date.now()
        for (const entry of statusBus.values()) {
          if (entry.listeners.size === 0) continue
          const backoff = entry.failures > 0 ? Math.min(60000, POLL_MS * 2 ** entry.failures) : POLL_MS
          if (now - entry.lastFetch >= backoff) loadStatusEntry(entry)
        }
      }, POLL_MS)
      statusLoop.unref?.()
      const wake = () => {
        if (typeof document !== 'undefined' && document.hidden) return
        for (const entry of statusBus.values()) if (entry.listeners.size > 0) loadStatusEntry(entry)
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
      if (typeof window !== 'undefined') window.addEventListener('focus', wake)
    }

    function subscribeStatus(path, listener) {
      const entry = statusEntryOf(path)
      entry.listeners.add(listener)
      listener(entry.state)
      ensureStatusLoop()
      if (entry.listeners.size === 1) loadStatusEntry(entry)
      return () => { entry.listeners.delete(listener) }
    }

    function refreshStatusPath(path) {
      const entry = path ? statusBus.get(path) : undefined
      return entry ? loadStatusEntry(entry) : Promise.resolve()
    }

    /** Subscribe to host-side Git change events for one checkout; the browser reconnects automatically. */
    function useRepoEvents(path, onChange) {
      const handlerRef = useRef(onChange)
      handlerRef.current = onChange
      useEffect(() => {
        if (!path || typeof EventSource === 'undefined') return undefined
        const source = new EventSource(`${window.location.origin}/git-assistant/api/events?path=${encodeURIComponent(path)}`)
        let timer = null
        const listener = () => {
          if (timer) return
          timer = setTimeout(() => { timer = null; handlerRef.current?.() }, 700)
        }
        source.addEventListener('change', listener)
        return () => {
          if (timer) clearTimeout(timer)
          source.removeEventListener('change', listener)
          source.close()
        }
      }, [path])
    }
    const MAX_DIFF_LINES = 6000
    const MAX_PREVIEW_LINES = 5000

    const DICT = {
      zh: {
        label: 'Git', title: 'Git 工作台',
        changesTab: '更改', filesTab: '文件', issuesTab: '议题',
        issueDetailEmpty: '选择右侧的议题查看详情', issueNoIssues: '没有匹配的议题',
        issuesOpen: '打开', issuesClosed: '关闭', issuesAll: '全部',
        issueOpenInGitHub: '在 GitHub 打开', issueParent: '父议题', issueChildren: '子议题',
        issueSearchPlaceholder: '搜索议题…', issueComments: '评论', issueUpdated: '更新', issueNoComments: '暂无评论', loadMore: '加载更多',
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
        copyPath: '复制文件路径', copyFolderPath: '复制文件夹路径', copyImage: '复制图片',
        downloadFile: '下载', saveAs: '另存为…', revealInFinder: '在 Finder 中显示', openDefaultApp: '用默认应用打开',
        copiedPath: '已复制路径', imageCopied: '图片已复制', actionFailed: '操作失败',
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
        branches: '分支',
        changes: '更改',
        graphOptions: '图形选项',
        commitScope: '提交范围',
        currentBranch: '当前分支',
        allRefs: '所有引用（含远端/标签）',
        fileDisplayMode: '提交文件展示方式',
        viewTree: '树形展示',
        viewList: '列表展示',
        statsFiles: '{count} 个文件',
        unknownAuthor: '未知作者',
        cardRenderFailed: '卡片渲染失败：{error}',
        panelRenderFailed: 'Git 面板渲染失败：{error}', retry: '重试',
        moreCommitActions: '更多提交方式',
        moreLines: '已显示 {shown} / {total} 行，继续滚动加载',
        selectCommit: '选择提交', unpushedCommits: '未推送的提交', noUnpushedCommits: '当前分支没有未推送的提交',
        wrapLines: '换行', collapseAllFiles: '全部折叠', expandAllFiles: '全部展开', workspaceChanges: '工作区更改', commitChanges: '本次提交的更改',
        diffHunkCollapsed: '这个 hunk 有 {count} 行，点击展开',
        unchangedLines: '{count} 行未变更，点击展开',
        dirtyCount: '{count} 个文件有改动',
        moreFileActions: '更多操作', fileHistory: '文件历史', fileHistoryEmpty: '这个文件还没有提交记录',
        stashPush: '暂存到 stash', stashPop: '恢复到工作区', stashList: 'stash 列表', stashEmpty: '没有 stash',
        stashPushed: '已暂存到 stash', stashPopped: '已恢复 stash', stashChip: '查看 stash',
        commentPlaceholder: '写下评论，Ctrl/⌘ + Enter 发送', commentSend: '发送评论', commentSending: '发送中…',
        commentEmpty: '评论不能为空', commentDone: '评论已发送',
        closeIssue: '关闭议题', reopenIssue: '重新打开', issueClosedOk: '议题已关闭', issueReopenedOk: '议题已重新打开',
        issueStateOpen: '开启', issueStateClosed: '已关闭',
      },
      en: {
        label: 'Git', title: 'Git Workbench',
        changesTab: 'Changes', filesTab: 'Files', issuesTab: 'Issues',
        issueDetailEmpty: 'Select an issue on the right', issueNoIssues: 'No matching issues',
        issuesOpen: 'Open', issuesClosed: 'Closed', issuesAll: 'All',
        issueOpenInGitHub: 'Open in GitHub', issueParent: 'Parent', issueChildren: 'Children',
        issueSearchPlaceholder: 'Search issues…', issueComments: 'comments', issueUpdated: 'updated', issueNoComments: 'No comments yet', loadMore: 'Load more',
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
        copyPath: 'Copy file path', copyFolderPath: 'Copy folder path', copyImage: 'Copy image',
        downloadFile: 'Download', saveAs: 'Save as…', revealInFinder: 'Reveal in Finder', openDefaultApp: 'Open with default app',
        copiedPath: 'Path copied', imageCopied: 'Image copied', actionFailed: 'Action failed',
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
        branches: 'Branches',
        changes: 'Changes',
        graphOptions: 'Graph options',
        commitScope: 'Commit scope',
        currentBranch: 'Current branch',
        allRefs: 'All refs (remote + tags)',
        fileDisplayMode: 'Commit file display',
        viewTree: 'Tree view',
        viewList: 'List view',
        statsFiles: '{count} files',
        unknownAuthor: 'Unknown author',
        cardRenderFailed: 'Card render failed: {error}',
        panelRenderFailed: 'Git panel failed to render: {error}', retry: 'Retry',
        moreCommitActions: 'More commit actions',
        moreLines: 'Showing {shown} / {total} lines — scroll to load more',
        selectCommit: 'Select commit', unpushedCommits: 'Unpushed commits', noUnpushedCommits: 'No unpushed commits on this branch',
        wrapLines: 'Wrap lines', collapseAllFiles: 'Collapse all', expandAllFiles: 'Expand all', workspaceChanges: 'Working tree changes', commitChanges: 'Changes in this commit',
        diffHunkCollapsed: 'This hunk has {count} lines — click to expand',
        unchangedLines: '{count} unchanged lines — click to expand',
        dirtyCount: '{count} changed files',
        moreFileActions: 'More actions', fileHistory: 'File history', fileHistoryEmpty: 'No commits touch this file yet',
        stashPush: 'Stash changes', stashPop: 'Pop stash', stashList: 'Stashes', stashEmpty: 'No stash entries',
        stashPushed: 'Changes stashed', stashPopped: 'Stash restored', stashChip: 'View stashes',
        commentPlaceholder: 'Write a comment (Ctrl/⌘ + Enter to send)', commentSend: 'Comment', commentSending: 'Sending…',
        commentEmpty: 'Comment is empty', commentDone: 'Comment posted',
        closeIssue: 'Close issue', reopenIssue: 'Reopen', issueClosedOk: 'Issue closed', issueReopenedOk: 'Issue reopened',
        issueStateOpen: 'Open', issueStateClosed: 'Closed',
      },
    }

    /**
     * Surface vocabulary for the workbench: one canvas, one elevated card layer, one inset "well"
     * for anything you type into, plus a single filled primary action. Everything resolves through
     * DSH theme tokens so light and dark stay honest; the literal fallbacks only cover a missing token.
     */
    const T = {
      text: 'var(--dsw-alias-label-primary, inherit)',
      ink2: 'var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 68%, transparent))',
      muted: 'var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 54%, transparent))',
      subtle: 'var(--dsw-alias-label-caption, color-mix(in srgb, currentColor 40%, transparent))',
      inverse: 'var(--dsw-alias-label-primary-inverted, #fff)',
      primary: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe))',
      primaryHover: 'var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #4d6bfe))',
      primaryDim: 'var(--dsw-alias-button-primary-dimmed, color-mix(in srgb, currentColor 9%, transparent))',
      primaryText: 'var(--dsw-alias-label-primary-inverted, #fff)',
      accent: 'var(--dsw-alias-link, var(--dsw-alias-brand-primary, #4d6bfe))',
      border: 'var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 15%, transparent))',
      borderSoft: 'var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 9%, transparent))',
      lineStrong: 'var(--dsw-alias-border-l4, color-mix(in srgb, currentColor 26%, transparent))',
      hover: 'var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 7%, transparent))',
      selected: 'var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 11%, transparent))',
      // Surfaces: canvas (page) → surface (card) → surfaceAlt (card header strip) → well (inputs).
      canvas: 'var(--dsw-alias-bg-module-platform, #f5f6f7)',
      surface: 'var(--dsw-alias-bg-layer-1, #fff)',
      surfaceAlt: 'var(--dsw-alias-card-fill, #fafafa)',
      surfaceHover: 'var(--dsw-alias-card-fill-hover, #f5f5f5)',
      well: 'var(--dsw-specific-selector, #f5f6f7)',
      chip: 'var(--dsw-alias-bg-skeleton, rgba(0,0,0,.045))',
      edge: 'var(--dsw-elevation-soft, 0 0 0 .5px rgba(0,0,0,.16), 0 4px 16px rgba(0,0,0,.03), 0 0 24px rgba(0,0,0,.03))',
      edgeStrong: 'var(--dsw-elevation-panel, 0 0 0 .5px rgba(0,0,0,.16), 0 3px 8px rgba(0,0,0,.03), 0 0 16px rgba(0,0,0,.02))',
      ring: 'var(--dsw-elevation-stroke, 0 0 0 .5px rgba(0,0,0,.16))',
      card: 'var(--dsw-alias-bg-layer-1, #fff)',
      glass: 'var(--dsw-alias-bg-layer-1, #fff)',
      menu: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, Canvas))',
      layer: 'var(--dsw-specific-selector, color-mix(in srgb, currentColor 4%, transparent))',
      layer2: 'var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 6%, transparent))',
      success: 'var(--dsw-alias-state-success-primary, #22c55e)',
      error: 'var(--dsw-alias-state-error-primary, #ec1313)',
      warn: 'var(--dsw-alias-state-warn-label, #dd8629)',
      brand: 'var(--dsw-alias-state-business-primary, #4176e6)',
      mono: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      sans: 'var(--dsw-font-family, inherit)',
      serif: '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "Iowan Old Style", Palatino, Georgia, serif',
      shadowSoft: 'var(--dsw-elevation-soft, 0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.07))',
      shadowProminent: 'var(--dsw-elevation-prominent, 0 18px 48px rgba(0,0,0,.22))',
      ease: 'cubic-bezier(.2,.8,.2,1)',
      rSm: 8, rMd: 12, rLg: 16, rXl: 20, pill: 999,
    }

    /** Wrapping a tinted fill around a semantic colour keeps status chips readable in both themes. */
    function tint(color, strength = 12) {
      return `color-mix(in srgb, ${color} ${strength}%, transparent)`
    }

    const ADD_BG = 'color-mix(in srgb, var(--dsw-alias-state-success-primary, #22c55e) 12%, transparent)'
    const DEL_BG = 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent)'
    const STATUS_COLOR = { M: T.warn, A: T.success, U: T.success, D: T.error, R: T.brand, C: T.error, '?': T.success }
    /** A status letter as a tinted chip: readable at 10px without colouring the whole file name. */
    function StatusChip({ status, size = 16 }) {
      if (!status) return h('span', { style: { width: size, flex: `0 0 ${size}px` } })
      const color = STATUS_COLOR[status] ?? T.muted
      return h('span', {
        style: {
          width: size, height: size, flex: `0 0 ${size}px`, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', borderRadius: 5, fontSize: 9.5, fontWeight: 700, letterSpacing: 0,
          color, background: tint(color, 14),
        },
      }, status)
    }
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

    /* Syntax colors follow GitHub Primer (github-dark / github-light); icon set follows Material Icon Theme (MIT). */
    const GITHUB_SYNTAX = {
      dark: { keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', literal: '#79c0ff', comment: '#8b949e' },
      light: { keyword: '#cf222e', string: '#0a3069', number: '#0550ae', literal: '#0550ae', comment: '#6e7781' },
    }
    let codePalette = GITHUB_SYNTAX.dark
    const paletteListeners = new Set()
    function isDarkUi() {
      try {
        if (typeof document === 'undefined' || !document.body || typeof getComputedStyle !== 'function') throw new Error('no dom')
        const background = getComputedStyle(document.body).backgroundColor
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        if (match) {
          const red = Number(match[1])
          const green = Number(match[2])
          const blue = Number(match[3])
          if (red + green + blue > 0) return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128
        }
      } catch { /* fall through */ }
      try { return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true } catch { return true }
    }
    function refreshCodePalette() {
      const next = isDarkUi() ? GITHUB_SYNTAX.dark : GITHUB_SYNTAX.light
      if (next === codePalette) return
      codePalette = next
      for (const listener of paletteListeners) listener()
    }
    if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      try {
        const observer = new MutationObserver(() => refreshCodePalette())
        for (const target of [document.documentElement, document.body]) {
          if (target) observer.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
        }
      } catch { /* ignore */ }
    }
    function useCodePalette() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force(value => value + 1)
        paletteListeners.add(listener)
        refreshCodePalette()
        return () => paletteListeners.delete(listener)
      }, [])
      return codePalette
    }

    function tokenStyle(kind, baseColor) {
      if (kind === 'comment') return { color: codePalette.comment, opacity: 0.9 }
      if (kind === 'string') return { color: codePalette.string }
      if (kind === 'number') return { color: codePalette.number }
      if (kind === 'literal') return { color: codePalette.literal }
      if (kind === 'keyword') return { color: codePalette.keyword }
      return { color: baseColor }
    }

    function CodeText({ text, language, baseColor, highlight }) {
      if (!highlight || !language) return h('span', { style: { color: baseColor } }, text)
      const tokens = tokenize(text, language)
      if (tokens.length === 1) return h('span', { style: { color: baseColor } }, text)
      return h('span', {}, tokens.map((token, index) => h('span', { key: index, style: tokenStyle(token.kind, baseColor) }, token.text)))
    }

    /* ── diff row building ──────────────────────────────────────────── */

    function hunkLabel(hunk) {
      const match = /^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/.exec(hunk.header ?? '')
      return match ? match[1] : (hunk.header ?? '')
    }

    function hunkCounts(hunk) {
      let oldCount = 0
      let newCount = 0
      for (const line of hunk.lines ?? []) {
        if (line.kind === 'del') oldCount += 1
        else if (line.kind === 'add') newCount += 1
        else { oldCount += 1; newCount += 1 }
      }
      return { oldCount, newCount }
    }

    function gapRowBetween(previous, next, index) {
      if (!previous) return null
      const counts = hunkCounts(previous)
      const previousOldEnd = (previous.oldStart ?? 0) + counts.oldCount - 1
      const previousNewEnd = (previous.newStart ?? 0) + counts.newCount - 1
      const nextStart = next.newStart ?? 0
      const count = nextStart - previousNewEnd - 1
      if (count <= 0) return null
      return { kind: 'gap', key: `g:${index}`, count, newStart: previousNewEnd + 1, delta: previousOldEnd - previousNewEnd }
    }

    function unifiedRows(hunks, language, highlight) {
      const rows = []
      let budget = MAX_DIFF_LINES
      hunks.forEach((hunk, hunkIndex) => {
        if (budget <= 0) return
        const gap = gapRowBetween(hunks[hunkIndex - 1], hunk, hunkIndex)
        if (gap) rows.push(gap)
        let oldNumber = hunk.oldStart
        let newNumber = hunk.newStart
        hunk.lines.forEach((line, lineIndex) => {
          if (budget <= 0) return
          budget -= 1
          const isAdd = line.kind === 'add'
          const isDel = line.kind === 'del'
          rows.push({
            kind: 'line', key: `l:${hunkIndex}:${lineIndex}`, hunkIndex,
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
        const gap = gapRowBetween(hunks[hunkIndex - 1], hunk, hunkIndex)
        if (gap) rows.push(gap)
        let oldNumber = hunk.oldStart
        let newNumber = hunk.newStart
        let index = 0
        const lines = hunk.lines
        while (index < lines.length && budget > 0) {
          const line = lines[index]
          if (line.kind === 'ctx') {
            budget -= 1
            rows.push({ kind: 'pair', key: `p:${hunkIndex}:${index}`, hunkIndex, left: { number: String(oldNumber++), text: line.text, kind: 'ctx' }, right: { number: String(newNumber++), text: line.text, kind: 'ctx' }, language, highlight })
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
              kind: 'pair', key: `p:${hunkIndex}:${index}:${offset}`, hunkIndex,
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
      const path = repository?.path
      useEffect(() => {
        if (!path) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        return subscribeStatus(path, setState)
      }, [path])
      useEffect(() => {
        if (path && dataVersion > 0) refreshStatusPath(path)
      }, [path, dataVersion])
      return [state, () => refreshStatusPath(path)]
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
      const previousPathRef = useRef(path)
      useEffect(() => {
        if (!path) { previousPathRef.current = path; setState({ phase: 'idle', items: [] }); return undefined }
        let live = true
        if (previousPathRef.current !== path) {
          previousPathRef.current = path
          setState({ phase: 'loading', items: [] })
        } else {
          setState(previous => ({ ...previous, phase: 'loading' }))
        }
        api('/worktrees', { path })
          .then(data => { if (live) setState({ phase: 'ready', items: Array.isArray(data?.worktrees) ? data.worktrees : [] }) })
          .catch(() => { if (live) setState({ phase: 'error', items: [] }) })
        return () => { live = false }
      }, [path, version, dataVersion])
      return [state, () => setVersion(value => value + 1)]
    }

    function useStatusAt(path, enabled) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      useEffect(() => {
        if (!path || !enabled) return undefined
        return subscribeStatus(path, setState)
      }, [path, enabled])
      return [state, () => refreshStatusPath(path)]
    }

    /** One worktree is one complete operable area: header, commit box, staged/changed lists. */
    function copyToClipboard(text) {
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
          return Promise.reject(new Error('clipboard unavailable'))
        }
        return navigator.clipboard.writeText(text)
      } catch (error) {
        return Promise.reject(error)
      }
    }

    /** Small fixed-position menu anchored at viewport coordinates; escapes card overflow clipping. */
    function FloatingMenu({ at, width = 250, onClose, children }) {
      const ref = useRef(null)
      useEffect(() => {
        const close = event => { if (ref.current && !ref.current.contains(event.target)) onClose?.() }
        const timer = setTimeout(() => document.addEventListener('pointerdown', close, true))
        return () => { clearTimeout(timer); document.removeEventListener('pointerdown', close, true) }
      }, [])
      const left = Math.max(8, Math.min(at.x, (window.innerWidth || 1280) - width - 8))
      const top = Math.min(at.y, Math.max(8, (window.innerHeight || 800) - 260))
      return h('div', {
        ref,
        style: {
          position: 'fixed', left, top, zIndex: 120, width, padding: 5, maxHeight: 320, overflowY: 'auto',
          background: T.menu, border: `0.5px solid ${T.border}`, borderRadius: T.rMd,
          boxShadow: T.shadowProminent, backdropFilter: 'blur(24px) saturate(170%)',
        },
      }, children)
    }

    function MenuItem({ icon, label, onClick, danger }) {
      return h('button', {
        type: 'button', onClick,
        style: {
          appearance: 'none', border: 'none', background: 'transparent', color: danger ? T.error : T.ink2,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          padding: '6px 9px', borderRadius: T.rSm, font: 'inherit', fontSize: 12,
        },
        onMouseEnter: event => { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = danger ? T.error : T.text },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = danger ? T.error : T.ink2 },
      }, icon ? h('span', { style: { display: 'inline-flex', opacity: 0.7, flex: '0 0 auto' } }, icon) : null, label)
    }

    /** One worktree is one complete operable area: header, commit box, stash, staged/changed lists. */
    function WorktreeCard({ t, item, defaultOpen, onOpen, onNotify, selectedPath, onChanged, onSelect, onDiscardAll, onFileHistory, visible = true }) {
      const [open, setOpen] = useState(defaultOpen)
      const [status, refreshStatus] = useStatusAt(item.path, open && visible)
      const [busy, setBusy] = useState(false)
      const [pendingStage, setPendingStage] = useState(() => new Map())
      const [expandedDirs, setExpandedDirs] = useState(() => new Set())
      const [collapsedSections, setCollapsedSections] = useState(() => new Set())
      const [hoveredKey, setHoveredKey] = useState(undefined)
      const [stashes, setStashes] = useState({ phase: 'idle', items: [] })
      const [stashMenu, setStashMenu] = useState(null)
      const [rowMenu, setRowMenu] = useState(null)
      const messageRef = useRef(null)
      const data = status.data
      const behind = status.data?.behind ?? item.behind ?? 0
      const needsSync = behind > 0
      const displayName = item.name ?? item.path.replace(/\/+$/, '').split('/').pop()
      const branchLabel = item.branch ?? t('detached')
      let stagedFiles = data?.staged ?? []
      let changeFiles = [...(data?.unstaged ?? []), ...(data?.untracked ?? [])]
      if (pendingStage.size > 0) {
        const stagedMap = new Map(stagedFiles.map(file => [file.path, file]))
        const changeMap = new Map(changeFiles.map(file => [file.path, file]))
        for (const [path, operation] of pendingStage) {
          if (operation === 'stage') {
            const file = changeMap.get(path)
            if (file) { changeMap.delete(path); stagedMap.set(path, file) }
          } else {
            const file = stagedMap.get(path)
            if (file) { stagedMap.delete(path); changeMap.set(path, file) }
          }
        }
        stagedFiles = [...stagedMap.values()]
        changeFiles = [...changeMap.values()]
      }
      const stagedTree = useMemo(() => fileRows(stagedFiles.map(file => ({ ...file, __staged: true }))), [data, pendingStage])
      const changeTree = useMemo(() => fileRows(changeFiles), [data, pendingStage])
      const dirty = stagedFiles.length + changeFiles.length > 0
      const stagedStatus = useMemo(() => new Map(stagedFiles.map(file => [file.path, file.status])), [data, pendingStage])
      const changeStatus = useMemo(() => new Map(changeFiles.map(file => [file.path, file.status])), [data, pendingStage])
      const loadStashes = useCallback(() => {
        let live = true
        api('/stashes', { path: item.path })
          .then(result => { if (live) setStashes({ phase: 'ready', items: Array.isArray(result?.stashes) ? result.stashes : [] }) })
          .catch(error => { if (live) setStashes({ phase: 'error', items: [], error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [item.path])
      useEffect(() => { if (open && visible) return loadStashes(); return undefined }, [open, visible, loadStashes])
      const toggleSection = name => setCollapsedSections(previous => {
        const next = new Set(previous)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
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
      const optimisticStage = (files, staged) => {
        const paths = files.map(file => file.path).filter(Boolean)
        if (paths.length === 0) return
        const operation = staged ? 'unstage' : 'stage'
        setPendingStage(previous => {
          const next = new Map(previous)
          for (const path of paths) next.set(path, operation)
          return next
        })
        setBusy(true)
        apiPost(staged ? '/unstage' : '/stage', { path: item.path, files: paths })
          .then(() => refreshStatus())
          .then(() => new Promise(resolve => setTimeout(resolve, 120)))
          .catch(error => onNotify?.(String(error?.message ?? error), 'error'))
          .finally(() => {
            setBusy(false)
            setPendingStage(previous => {
              const next = new Map(previous)
              for (const path of paths) next.delete(path)
              return next
            })
          })
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
      const stashPushChanges = () => runAction(async () => {
        await apiPost('/stash-push', { path: item.path })
        loadStashes()
        onChanged?.()
        onNotify?.(t('stashPushed'))
      })
      const stashPopAt = index => runAction(async () => {
        const result = await apiPost('/stash-pop', { path: item.path, index })
        setStashes({ phase: 'ready', items: Array.isArray(result?.stashes) ? result.stashes : [] })
        setStashMenu(null)
        onChanged?.()
        onNotify?.(t('stashPopped'))
      })
      const copyPathOf = file => {
        copyToClipboard(file.path)
          .then(() => onNotify?.(t('copiedPath')))
          .catch(() => onNotify?.(t('actionFailed'), 'error'))
      }
      const fileCommand = (route, file) => apiPost(route, { path: item.path, file: file.path })
        .catch(error => onNotify?.(String(error?.message ?? error), 'error'))
      const openRowMenu = (file, staged, event) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        setRowMenu({ x: rect.left, y: rect.bottom + 4, file, staged })
      }
      const rowMenuItems = rowMenu ? [
        h(MenuItem, { key: 'copy', icon: h(IconCopy), label: t('copyPath'), onClick: () => { copyPathOf(rowMenu.file); setRowMenu(null) } }),
        h(MenuItem, { key: 'reveal', icon: h(IconFolder), label: t('revealInFinder'), onClick: () => { fileCommand('/reveal', rowMenu.file); setRowMenu(null) } }),
        h(MenuItem, { key: 'open', icon: h(IconExternal), label: t('openDefaultApp'), onClick: () => { fileCommand('/open', rowMenu.file); setRowMenu(null) } }),
        h(MenuItem, { key: 'history', icon: h(IconHistory), label: t('fileHistory'), onClick: () => { onFileHistory?.(rowMenu.file, item.path); setRowMenu(null) } }),
      ] : null
      const rowMenuElement = rowMenu
        ? h(FloatingMenu, { key: 'row-menu', at: rowMenu, width: 230, onClose: () => setRowMenu(null) }, rowMenuItems)
        : null
      const stashMenuElement = stashMenu
        ? h(FloatingMenu, { key: 'stash-menu', at: stashMenu, width: 320, onClose: () => setStashMenu(null) },
            h('div', { style: { padding: '6px 9px 3px', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.muted } }, t('stashList')),
            stashes.phase === 'loading'
              ? h('div', { style: { padding: '6px 10px', fontSize: 11.5, color: T.muted } }, t('loading'))
              : stashes.phase === 'error'
                ? h('div', { style: { padding: '6px 10px', fontSize: 11.5, color: T.error } }, stashes.error)
                : stashes.items.length === 0
                  ? h('div', { style: { padding: '6px 10px', fontSize: 11.5, color: T.subtle } }, t('stashEmpty'))
                  : stashes.items.map(entry => h('div', {
                      key: entry.selector,
                      style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: T.rSm },
                    },
                      h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.subtle, flex: '0 0 auto' } }, `@{${entry.index}}`),
                      h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: entry.subject }, entry.subject || '—'),
                      entry.time ? h('span', { style: { fontSize: 10, color: T.subtle, flex: '0 0 auto' } }, formatRelativeTime(entry.time)) : null,
                      h(IconAction, { label: t('stashPop'), disabled: busy, onClick: () => stashPopAt(entry.index) }, h(IconUndo)))))
        : null
      const sectionHeader = (label, count, expanded, onToggle, actions) => h('div', {
        onClick: onToggle,
        style: {
          display: 'flex', alignItems: 'center', gap: 6, minHeight: 26, marginTop: 2, padding: '0 2px',
          cursor: 'pointer', userSelect: 'none',
        },
      },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: T.ink2 } },
          h(Chevron, { open: expanded, size: 8 }),
          h('span', { style: { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' } }, label)),
        h('span', {
          style: {
            fontFamily: MONO, fontSize: 9.5, fontWeight: 600, color: T.muted,
            background: T.chip, borderRadius: T.pill, padding: '0 6px', lineHeight: '15px',
          },
        }, String(count)),
        h('span', { style: { flex: 1 } }),
        h('span', { onClick: event => event.stopPropagation(), style: { display: 'inline-flex', alignItems: 'center', gap: 1 } }, actions))
      const composer = dirty || needsSync ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('textarea', {
          ref: messageRef, rows: 2, placeholder: `${t('commitPlaceholder')} · ${branchLabel}`,
          onFocus: event => { event.currentTarget.style.borderColor = T.accent; event.currentTarget.style.boxShadow = `0 0 0 3px ${tint(T.accent, 18)}` },
          onBlur: event => { event.currentTarget.style.borderColor = T.borderSoft; event.currentTarget.style.boxShadow = 'none' },
          onKeyDown: event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit() } },
          style: {
            width: '100%', boxSizing: 'border-box', resize: 'vertical', background: T.well, color: 'inherit',
            border: `1px solid ${T.borderSoft}`, borderRadius: 9, padding: '7px 9px', fontSize: 12.5,
            fontFamily: 'inherit', outline: 'none', lineHeight: '18px', minHeight: 54,
            transition: `border-color .15s ${T.ease}, box-shadow .15s ${T.ease}`,
          },
        }),
        h('button', {
          type: 'button', onClick: needsSync ? sync : commit, disabled: busy || (!needsSync && !dirty),
          onMouseEnter: event => { if (!event.currentTarget.disabled) event.currentTarget.style.background = needsSync ? T.surfaceHover : T.primaryHover },
          onMouseLeave: event => { event.currentTarget.style.background = needsSync ? T.surface : T.primary },
          style: {
            appearance: 'none', border: needsSync ? `1px solid ${T.border}` : '1px solid transparent',
            borderRadius: 9, height: 30, width: '100%', fontSize: 12, fontWeight: 600,
            font: 'inherit',
            background: needsSync ? T.surface : T.primary,
            color: needsSync ? T.text : T.primaryText,
            boxShadow: needsSync ? 'none' : '0 1px 2px rgba(0,0,0,.14)',
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1,
            transition: `background .15s ${T.ease}, opacity .15s ${T.ease}`,
          },
        }, busy ? (needsSync ? t('syncing') : t('committing')) : needsSync ? `⟳ ${t('syncChanges')} ${behind}↓` : `✓ ${t('commit')}`))
        : null
      const cleanState = !dirty && !needsSync && status.phase === 'ready' ? h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 2px' },
      },
        h('span', {
          style: {
            width: 18, height: 18, flex: '0 0 18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%', background: tint(T.success, 14), color: T.success,
          },
        }, h('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M5 13l4 4L19 7' }))),
        h('span', { style: { fontSize: 12, color: T.ink2 } }, t('cleanTree')))
        : null
      const syncWhenClean = !dirty && needsSync ? h('button', {
        type: 'button', onClick: sync, disabled: busy,
        onMouseEnter: event => { if (!event.currentTarget.disabled) event.currentTarget.style.background = T.primaryHover },
        onMouseLeave: event => { event.currentTarget.style.background = T.primary },
        style: {
          appearance: 'none', border: '1px solid transparent', borderRadius: 8, height: 28, padding: '0 12px',
          fontSize: 11.5, fontWeight: 600, font: 'inherit', background: T.primary, color: T.primaryText,
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1, whiteSpace: 'nowrap',
        },
      }, busy ? t('syncing') : `⟳ ${t('syncChanges')} ${behind}↓`) : null
      return [h('div', {
        key: 'card',
        style: {
          marginBottom: 8, borderRadius: T.rMd, background: T.surface, boxShadow: T.edge, overflow: 'hidden',
        },
      },
        h('div', {
          onClick: () => { setOpen(value => !value); onSelect?.(item.path) },
          style: {
            display: 'flex', alignItems: 'center', gap: 7, minHeight: 36, padding: '0 12px', cursor: 'pointer',
            background: open ? T.surfaceAlt : T.surface,
            borderBottom: open ? `1px solid ${T.borderSoft}` : 'none',
            transition: `background .15s ${T.ease}`,
          },
          onMouseEnter: event => { event.currentTarget.style.background = T.surfaceAlt },
          onMouseLeave: event => { event.currentTarget.style.background = open ? T.surfaceAlt : T.surface },
        },
          h(Chevron, { open, size: 9 }),
          h('span', { title: item.path, style: { fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 72, flex: '0 1 auto' } }, displayName),
          branchLabel !== displayName ? h('span', {
            title: branchLabel,
            style: {
              fontFamily: MONO, fontSize: 10.5, color: T.ink2, background: T.chip, borderRadius: 5,
              padding: '1px 6px', whiteSpace: 'nowrap', maxWidth: 104, flex: '0 2 auto', overflow: 'hidden', textOverflow: 'ellipsis',
            },
          }, branchLabel) : null,
          item.isMain ? h('span', {
            style: {
              fontSize: 9.5, fontWeight: 500, color: T.muted, border: `1px solid ${T.border}`, borderRadius: T.pill,
              padding: '0 7px', lineHeight: '15px', whiteSpace: 'nowrap', flex: '0 0 auto',
            },
          }, t('mainWorktree')) : null,
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.muted, whiteSpace: 'nowrap' } }, `${item.behind > 0 ? `↓${item.behind}` : ''}${item.ahead > 0 ? ` ↑${item.ahead}` : ''}`),
          stashes.items.length > 0 ? h('button', {
            type: 'button', title: t('stashChip'),
            onClick: event => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              setStashMenu({ x: rect.left, y: rect.bottom + 4 })
            },
            style: {
              appearance: 'none', border: `1px solid ${T.border}`, background: T.surface, color: T.ink2,
              display: 'inline-flex', alignItems: 'center', gap: 3, height: 20, padding: '0 7px', borderRadius: T.pill,
              cursor: 'pointer', fontSize: 10, fontFamily: MONO,
            },
          }, h(IconStash), String(stashes.items.length)) : null,
          h(IconAction, { label: t('refresh'), onClick: event => { event.stopPropagation(); refreshStatus(); loadStashes() } }, h(RefreshIcon, {}))),
        open ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px 12px' } },
          composer,
          cleanState,
          !dirty && needsSync ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { flex: 1, fontSize: 12, color: T.ink2 } }, t('cleanTree')),
            syncWhenClean) : null,
          stagedFiles.length > 0 ? h('div', { style: { borderTop: `1px solid ${T.borderSoft}`, paddingTop: 4 } },
            sectionHeader(t('staged'), stagedFiles.length, !collapsedSections.has('staged'), () => toggleSection('staged'),
              h(IconAction, { label: t('unstageAll'), disabled: busy, onClick: () => optimisticStage(stagedFiles, true) }, h(IconMinus))),
            !collapsedSections.has('staged')
              ? h(TreeRows, {
                  node: stagedTree, depth: 0, expandedDirs, onToggleDir: toggleDir,
                  onOpen: file => onOpen(file, item.path),
                  selectedKey: selectedPath ? `s:${selectedPath}` : undefined,
                  actionsFor: file => h('span', { style: { display: 'inline-flex', gap: 1 } },
                    h(IconAction, {
                      label: t('unstage'), disabled: busy,
                      onClick: event => { event.stopPropagation(); optimisticStage([file], true) },
                    }, h(IconMinus)),
                    h(IconAction, { label: t('moreFileActions'), onClick: event => openRowMenu(file, true, event) }, h(IconMore))),
                  statusByPath: stagedStatus, showStatus: true,
                  hoveredKey, onHoverKey: setHoveredKey,
                })
              : null) : null,
          changeFiles.length > 0 ? h('div', { style: { borderTop: `1px solid ${T.borderSoft}`, paddingTop: 4 } },
            sectionHeader(t('changes'), changeFiles.length, !collapsedSections.has('changes'), () => toggleSection('changes'),
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 1 } },
                h(IconAction, {
                  label: t('discardAll'), danger: true, disabled: busy || changeFiles.length === 0,
                  onClick: () => onDiscardAll?.(changeFiles.map(file => file.path)),
                }, h(IconUndo)),
                h(IconAction, { label: t('stashPush'), disabled: busy, onClick: () => stashPushChanges() }, h(IconStash)),
                h(IconAction, { label: t('stageAll'), disabled: busy || changeFiles.length === 0, onClick: () => optimisticStage(changeFiles, false) }, h(IconPlus)))),
            !collapsedSections.has('changes')
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
                      onClick: event => { event.stopPropagation(); optimisticStage([file], false) },
                    }, h(IconPlus)),
                    h(IconAction, { label: t('moreFileActions'), onClick: event => openRowMenu(file, false, event) }, h(IconMore))),
                  statusByPath: changeStatus, showStatus: true,
                  hoveredKey, onHoverKey: setHoveredKey,
                })
              : null) : null,
          status.phase === 'loading' ? h('div', { style: { fontSize: 11.5, color: T.muted, padding: '2px 0' } }, t('loading')) : null,
          status.phase === 'error' ? h('div', { style: { fontSize: 11.5, color: T.error, padding: '2px 0' } }, status.error) : null) : null),
        rowMenuElement, stashMenuElement]
    }
    /** Multi-file diff for one commit: file cards with collapse, wrap and per-file diff. */
    function CommitFileDiff({ context, entry, view, wrap, t }) {
      const state = useCommitFileDiff(context, entry.path)
      if (state.phase === 'loading') return h('div', { style: { padding: '8px 14px', color: T.muted, fontSize: 11.5 } }, t('loading'))
      if (state.phase === 'error') return h('div', { style: { padding: '8px 14px', color: T.error, fontSize: 11.5 } }, state.error)
      return h(DiffLines, { file: state.data?.files ?? [], view, t, wrap, embedded: true, context })
    }

    function CommitFilesView({ state, view, wrap, t, collapseMode, context }) {
      const [collapsed, setCollapsed] = useState(() => new Set())
      const files = state.data?.files ?? []
      useEffect(() => {
        if (!files.length) return
        setCollapsed(new Set(files
          .filter(file => (file.additions ?? 0) + (file.deletions ?? 0) > 3000)
          .map(file => file.path)))
      }, [state.data])
      useEffect(() => {
        if (!files.length) return
        setCollapsed(collapseMode ? new Set(files.map(file => file.path)) : new Set())
      }, [collapseMode])
      if (state.phase === 'loading') return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('loading'))
      if (state.phase === 'error') return h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, state.error)
      if (files.length === 0) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('noDiff'))
      return h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 16 } },
        files.map(entry => {
          const isCollapsed = collapsed.has(entry.path)
          const additions = entry.additions ?? 0
          const deletions = entry.deletions ?? 0
          return h('div', { key: entry.path, style: { borderBottom: `0.5px solid ${T.borderSoft}` } },
            h('div', {
              onClick: () => setCollapsed(previous => {
                const next = new Set(previous)
                if (next.has(entry.path)) next.delete(entry.path)
                else next.add(entry.path)
                return next
              }),
              style: {
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', cursor: 'pointer',
                position: 'sticky', top: 0, zIndex: 2, background: T.menu,
                borderBottom: isCollapsed ? 'none' : `0.5px solid ${T.borderSoft}`,
              },
            },
              h(Chevron, { open: !isCollapsed, size: 8 }),
              h(FileGlyph, { name: entry.path.split('/').pop() ?? entry.path, kind: 'file' }),
              h('span', {
                title: entry.path,
                style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 11.5, color: T.ink2 },
              }, entry.path),
              h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.success } }, `+${additions}`),
              h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.error } }, `−${deletions}`),
              h(StatusChip, { status: entry.status ?? 'M', size: 15 })),
            isCollapsed
              ? null
              : h('div', { style: { padding: '2px 0 6px' } },
                  h(CommitFileDiff, { context, entry, view, wrap, t })))
        }))
    }

    const MD_INLINE_CODE = { fontFamily: MONO, fontSize: '0.92em', padding: '0 4px', borderRadius: 4, background: T.hover }
    const MD_PRE = { margin: '6px 0', padding: '8px 10px', borderRadius: T.rSm, background: T.hover, overflowX: 'auto', fontFamily: MONO, fontSize: 11, lineHeight: '17px' }

    function markdownInline(text, keyPrefix) {
      const tokens = String(text ?? '').split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\))/g)
      return tokens.filter(Boolean).map((token, index) => {
        const key = `${keyPrefix}:${index}`
        if (/^`[^`]+`$/.test(token)) return h('code', { key, style: MD_INLINE_CODE }, token.slice(1, -1))
        if (/^\*\*[^*]+\*\*$/.test(token) || /^__[^_]+__$/.test(token)) return h('strong', { key }, token.slice(2, -2))
        if (/^~~[^~]+~~$/.test(token)) return h('del', { key }, token.slice(2, -2))
        if (/^\*[^*]+\*$/.test(token) || /^_[^_]+_$/.test(token)) return h('em', { key }, token.slice(1, -1))
        const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token)
        if (image) return h('img', { key, src: image[2], alt: image[1], style: { maxWidth: '100%', borderRadius: 6, display: 'block', margin: '4px 0' } })
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
        if (link) return h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer', style: { color: T.accent } }, link[1])
        return token
      })
    }

    function markdownCells(line) {
      return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    }

    function markdownBlocks(text) {
      const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let index = 0
      let key = 0
      while (index < lines.length) {
        const line = lines[index]
        if (!line.trim()) { index += 1; continue }
        if (/^```/.test(line)) {
          index += 1
          const code = []
          while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++])
          index += 1
          blocks.push(h('pre', { key: key++, style: MD_PRE }, h('code', { style: { fontFamily: MONO } }, code.join('\n'))))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          const level = heading[1].length
          blocks.push(h('div', {
            key: key++,
            style: { fontSize: Math.max(13, 20 - (level - 1) * 2), fontWeight: 600, lineHeight: '1.4', margin: '10px 0 4px', color: T.text },
          }, markdownInline(heading[2], `h${key}`)))
          index += 1
          continue
        }
        if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
          blocks.push(h('hr', { key: key++, style: { border: 'none', borderTop: `0.5px solid ${T.borderSoft}`, margin: '10px 0' } }))
          index += 1
          continue
        }
        if (/^\s*>\s?/.test(line)) {
          const quoted = []
          while (index < lines.length && /^\s*>\s?/.test(lines[index])) quoted.push(lines[index++].replace(/^\s*>\s?/, ''))
          blocks.push(h('blockquote', { key: key++, style: { margin: '6px 0', padding: '2px 10px', borderLeft: `2px solid ${T.border}`, color: T.ink2 } }, markdownBlocks(quoted.join('\n'))))
          continue
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const ordered = /^\s*\d+\./.test(line)
          const items = []
          while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
            const match = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[index])
            items.push(match ? match[1] : '')
            index += 1
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: key++, style: { margin: '4px 0', paddingLeft: 20 } },
            items.map((item, itemIndex) => h('li', { key: itemIndex, style: { margin: '1px 0' } }, markdownInline(item, `li${key}:${itemIndex}`)))))
          continue
        }
        if (/\|/.test(line) && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1])) {
          const header = markdownCells(line)
          const rows = []
          index += 2
          while (index < lines.length && /\|/.test(lines[index]) && lines[index].trim()) rows.push(markdownCells(lines[index++]))
          const headRow = h('tr', null, header.map((cell, cellIndex) => h('th', {
            key: cellIndex,
            style: { textAlign: 'left', padding: '3px 8px', border: `0.5px solid ${T.borderSoft}`, background: T.hover, fontWeight: 600, whiteSpace: 'nowrap' },
          }, markdownInline(cell, `th${key}:${cellIndex}`))))
          const bodyRows = rows.map((cells, rowIndex) => h('tr', { key: rowIndex },
            cells.map((cell, cellIndex) => h('td', {
              key: cellIndex,
              style: { padding: '3px 8px', border: `0.5px solid ${T.borderSoft}`, verticalAlign: 'top' },
            }, markdownInline(cell, `td${key}:${rowIndex}:${cellIndex}`)))))
          blocks.push(h('div', { key: key++, style: { overflowX: 'auto', margin: '6px 0' } },
            h('table', { style: { borderCollapse: 'collapse', fontSize: 11.5, width: '100%' } },
              h('thead', null, headRow),
              h('tbody', null, bodyRows))))
          continue
        }
        const paragraph = [line]
        index += 1
        while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^```|^\s*>|^\s*([-*+]|\d+\.)\s|^\s*(---+)|\|/.test(lines[index])) {
          paragraph.push(lines[index++])
        }
        blocks.push(h('p', { key: key++, style: { margin: '4px 0', lineHeight: '1.65' } },
          paragraph.map((part, partIndex) => h('span', { key: partIndex }, markdownInline(part, `p${key}:${partIndex}`), partIndex < paragraph.length - 1 ? h('br') : null))))
      }
      return blocks
    }

    function MarkdownBody({ text }) {
      return h('div', { style: { fontSize: 12.5, lineHeight: '1.6', color: T.ink2, wordBreak: 'break-word' } }, markdownBlocks(text))
    }

    function issueStateColor(value) {
      return value === 'open' ? T.success : '#a371f7'
    }

    /**
     * GitHub label chips: a light tint of the label hue for the fill, and that hue pulled toward the
     * theme's primary text for the label itself — so pale labels (#a2eeef) stay readable on white.
     */
    function labelChipStyle(color) {
      const hex = String(color ?? '').replace(/^#/, '')
      const base = /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : 'currentColor'
      return {
        background: `color-mix(in srgb, ${base} 15%, transparent)`,
        color: `color-mix(in srgb, ${base} 52%, var(--dsw-alias-label-primary, #0f1115))`,
        border: `1px solid color-mix(in srgb, ${base} 26%, transparent)`,
      }
    }

    function IssueCard({ t, issue, selected, onClick }) {
      const stateColor = issueStateColor(issue.state)
      return h('div', {
        role: 'button', tabIndex: 0,
        onClick,
        onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } },
        style: {
          display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 11px', minHeight: 104,
          borderRadius: 10, cursor: 'pointer', position: 'relative',
          background: selected ? tint(T.accent, 7) : T.surface,
          boxShadow: selected ? `inset 0 0 0 1.5px ${T.accent}, 0 2px 8px rgba(0,0,0,.05)` : T.ring,
          transition: `box-shadow .15s ${T.ease}, background .15s ${T.ease}`,
        },
        onMouseEnter: event => { if (!selected) event.currentTarget.style.boxShadow = `${T.ring}, 0 2px 10px rgba(0,0,0,.07)` },
        onMouseLeave: event => { if (!selected) event.currentTarget.style.boxShadow = T.ring },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.muted } }, `#${issue.number}`),
          h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: stateColor } }),
          h('span', { style: { fontSize: 10, color: T.muted, textTransform: 'capitalize' } }, issue.state),
          h('span', { style: { flex: 1 } }),
          issue.comments > 0 ? h('span', { style: { fontSize: 10, color: T.subtle } }, `💬 ${issue.comments}`) : null,
          h('span', { style: { fontSize: 10, color: T.subtle, whiteSpace: 'nowrap' } }, issue.updatedAt ? formatRelativeTime(Math.floor(new Date(issue.updatedAt).getTime() / 1000)) : '')),
        h('div', {
          style: {
            fontSize: 12.5, fontWeight: 500, lineHeight: '18px', color: T.text,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          },
        }, issue.title),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
          ...(issue.labels ?? []).slice(0, 3).map(label => h('span', {
            key: label.name,
            style: { fontSize: 9.5, padding: '0 6px', lineHeight: '16px', borderRadius: T.pill, whiteSpace: 'nowrap', ...labelChipStyle(label.color) },
          }, label.name)),
          (issue.labels?.length ?? 0) > 3 ? h('span', { style: { fontSize: 9.5, color: T.subtle } }, `+${issue.labels.length - 3}`) : null),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' } },
          issue.parent
            ? h('span', { style: { fontSize: 9.5, color: T.subtle, border: `0.5px solid ${T.border}`, borderRadius: T.pill, padding: '0 6px', whiteSpace: 'nowrap' } }, `↑ #${issue.parent.number}`)
            : null,
          (issue.children?.length ?? 0) > 0
            ? h('span', { style: { fontSize: 9.5, color: T.subtle, border: `0.5px solid ${T.border}`, borderRadius: T.pill, padding: '0 6px', whiteSpace: 'nowrap' } }, `⌄ ${issue.children.length} ${t('issueChildren')}`)
            : null,
          h('span', { style: { flex: 1 } })))
    }

    function IssueDetailPane({ t, state, onNavigate, onClose, comments, onCommentPost, onToggleState }) {
      const composerRef = useRef(null)
      const [sending, setSending] = useState(false)
      const [toggling, setToggling] = useState(false)
      const postComment = () => {
        if (sending) return
        const body = composerRef.current?.value ?? ''
        if (!body.trim()) return
        setSending(true)
        Promise.resolve(onCommentPost?.(body.trim()))
          .then(() => { if (composerRef.current) composerRef.current.value = '' })
          .catch(() => { /* the parent already surfaced the failure */ })
          .finally(() => setSending(false))
      }
      const toggleState = () => {
        if (toggling) return
        const issue = state?.data?.issue
        if (!issue) return
        setToggling(true)
        Promise.resolve(onToggleState?.(issue.state === 'closed' ? 'open' : 'closed'))
          .catch(() => { /* the parent already surfaced the failure */ })
          .finally(() => setToggling(false))
      }
      if (!state || state.phase === 'idle') {
        return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, color: T.muted, textAlign: 'center' } },
          h('div', {
            style: {
              width: 44, height: 44, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: T.surfaceAlt, boxShadow: T.ring, color: T.muted,
            },
          }, h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 8v5' }), h('circle', { cx: 12, cy: 16.5, r: 0.6, fill: 'currentColor' }))),
          h('div', { style: { fontSize: 12.5, color: T.ink2 } }, t('issueDetailEmpty')))
      }
      if (state.phase === 'loading') return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('loading'))
      if (state.phase === 'error') return h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, state.error)
      const issue = state.data?.issue
      if (!issue) return null
      const commentItems = comments?.data?.comments ?? []
      return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', minHeight: 36, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSoft}`, flex: '0 0 auto' } },
          h('span', { style: { fontFamily: MONO, fontSize: 11, fontWeight: 600, color: T.ink2 } }, `#${issue.number}`),
          h('span', { style: { fontSize: 10, fontWeight: 600, padding: '0 8px', lineHeight: '16px', borderRadius: T.pill, whiteSpace: 'nowrap', color: issueStateColor(issue.state), background: tint(issueStateColor(issue.state), 12) } },
            issue.state === 'closed' ? t('issueStateClosed') : t('issueStateOpen')),
          h('span', { style: { flex: 1 } }),
          onToggleState ? h(SmallButton, {
            label: toggling ? t('loading') : issue.state === 'closed' ? t('reopenIssue') : t('closeIssue'),
            onClick: toggleState, disabled: toggling,
          }) : null,
          issue.url ? h('a', {
            href: issue.url, target: '_blank', rel: 'noreferrer',
            style: { fontSize: 10.5, color: T.accent, textDecoration: 'none' },
          }, t('issueOpenInGitHub')) : null,
          h('button', {
            type: 'button', onClick: onClose, title: '×',
            style: { appearance: 'none', border: 'none', background: 'transparent', color: T.muted, cursor: 'pointer', fontSize: 15, padding: '0 4px' },
          }, '×')),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { fontSize: 15, lineHeight: '22px', fontWeight: 600, color: T.text } }, issue.title),
          h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
            ...(issue.labels ?? []).map(label => h('span', {
              key: label.name,
              style: { fontSize: 10, padding: '0 7px', lineHeight: '17px', borderRadius: T.pill, whiteSpace: 'nowrap', ...labelChipStyle(label.color) },
            }, label.name))),
          h('div', { style: { display: 'flex', gap: 12, fontSize: 11, color: T.subtle, flexWrap: 'wrap' } },
            h('span', null, `${issue.comments ?? 0} ${t('issueComments')}`),
            issue.updatedAt ? h('span', null, `${t('issueUpdated')} ${formatRelativeTime(Math.floor(new Date(issue.updatedAt).getTime() / 1000))}`) : null,
            issue.author ? h('span', null, `@${issue.author}`) : null),
          (issue.parent || (issue.children?.length ?? 0) > 0)
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 9, background: T.well, boxShadow: `inset 0 0 0 1px ${T.borderSoft}` } },
                h('div', { style: { fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.muted } }, t('issueRelations')),
                issue.parent
                  ? h('button', {
                      type: 'button', onClick: () => onNavigate?.(issue.parent.number),
                      style: { appearance: 'none', border: 'none', background: 'transparent', color: T.accent, cursor: 'pointer', textAlign: 'left', padding: 0, fontSize: 11 },
                    }, `${t('issueParent')}: #${issue.parent.number} ${issue.parent.title ?? ''}`)
                  : null,
                ...(issue.children ?? []).map(child => h('button', {
                  key: child.number, type: 'button', onClick: () => onNavigate?.(child.number),
                  style: { appearance: 'none', border: 'none', background: 'transparent', color: T.accent, cursor: 'pointer', textAlign: 'left', padding: 0, fontSize: 11 },
                }, `${t('issueChildren')}: #${child.number} ${child.title ?? ''}`)))
            : null,
          issue.body
            ? h('div', { style: { borderTop: `0.5px solid ${T.borderSoft}`, paddingTop: 10 } }, h(MarkdownBody, { text: issue.body }))
            : null,
          h('div', { style: { borderTop: `1px solid ${T.borderSoft}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { fontSize: 10.5, fontWeight: 700, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase' } }, `${issue.comments ?? 0} ${t('issueComments')}`),
            comments?.phase === 'loading'
              ? h('div', { style: { fontSize: 11, color: T.muted } }, t('loading'))
              : comments?.phase === 'error'
                ? h('div', { style: { fontSize: 11, color: T.error } }, comments.error)
                : commentItems.length === 0
                  ? h('div', { style: { fontSize: 11, color: T.subtle } }, t('issueNoComments'))
                  : commentItems.map(comment => h('div', {
                      key: comment.id,
                      style: {
                        boxShadow: T.ring, borderRadius: 9, padding: '9px 11px', background: T.surface,
                        display: 'flex', flexDirection: 'column', gap: 6,
                      },
                    },
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: T.muted } },
                        h('span', {
                          title: comment.author,
                          style: {
                            width: 20, height: 20, borderRadius: '50%', flex: '0 0 auto', display: 'inline-flex',
                            alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
                            background: tint(T.brand, 20), color: T.brand,
                          },
                        }, (comment.author || '?').slice(0, 1).toUpperCase()),
                        h('span', { style: { fontWeight: 600, color: T.text } }, comment.author ? `@${comment.author}` : ''),
                        comment.createdAt ? h('span', { style: { color: T.subtle } }, formatRelativeTime(Math.floor(new Date(comment.createdAt).getTime() / 1000))) : null),
                      h(MarkdownBody, { text: comment.body }))),
            onCommentPost ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7, padding: 9, borderRadius: 10, background: T.well, boxShadow: `inset 0 0 0 1px ${T.borderSoft}` } },
              h('textarea', {
                ref: composerRef, rows: 2, placeholder: t('commentPlaceholder'),
                onFocus: event => { event.currentTarget.parentElement.style.boxShadow = `inset 0 0 0 1px ${T.accent}, 0 0 0 3px ${tint(T.accent, 14)}` },
                onBlur: event => { event.currentTarget.parentElement.style.boxShadow = `inset 0 0 0 1px ${T.borderSoft}` },
                style: {
                  width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'transparent', color: 'inherit',
                  border: 'none', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', lineHeight: '18px', padding: 0,
                  minHeight: 40,
                },
                onKeyDown: event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); postComment() } },
              }),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { flex: 1, fontSize: 10, color: T.subtle } }, '⌘/Ctrl + Enter'),
                h('button', {
                  type: 'button', onClick: postComment, disabled: sending,
                  onMouseEnter: event => { if (!event.currentTarget.disabled) event.currentTarget.style.background = T.primaryHover },
                  onMouseLeave: event => { event.currentTarget.style.background = T.primary },
                  style: {
                    appearance: 'none', border: '1px solid transparent', borderRadius: 7, height: 26, padding: '0 12px',
                    fontSize: 11.5, fontWeight: 600, font: 'inherit', background: T.primary, color: T.primaryText,
                    cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.55 : 1,
                  },
                }, sending ? t('commentSending') : t('commentSend')))) : null)))
    }

    function IssuesPane({ t, state, selectedNumber, onSelect, search, onSearch, stateFilter, onStateFilter, onRefresh, onLoadMore }) {
      const issues = state.issues ?? []
      const stateOptions = [['open', t('issuesOpen')], ['closed', t('issuesClosed')], ['all', t('issuesAll')]]
      return h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', {
          style: {
            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 8px',
            minWidth: 0, borderRadius: T.rMd, background: T.surface, boxShadow: T.edge,
          },
        },
          h('input', {
            value: search, placeholder: t('issueSearchPlaceholder'),
            onChange: event => onSearch(event.target.value),
            style: {
              flex: 1, minWidth: 80, height: 28, borderRadius: T.rSm, padding: '0 10px', fontSize: 12, color: 'inherit',
              background: T.well,
              border: `1px solid ${T.borderSoft}`, outline: 'none',
            },
          }),
          h('span', { style: { display: 'inline-flex', padding: 2, borderRadius: T.pill, background: T.hover, border: `0.5px solid ${T.borderSoft}` } },
            stateOptions.map(([value, label]) => h('button', {
              key: value, type: 'button', onClick: () => onStateFilter(value),
              style: {
                appearance: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 10.5,
                height: 22, padding: '0 10px', borderRadius: T.pill,
                background: stateFilter === value ? T.card : 'transparent',
                color: stateFilter === value ? T.text : T.muted,
              },
            }, label))),
          h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.subtle } }, state.phase === 'ready' ? String(issues.length) : ''),
          h(IconButton, { label: t('refresh'), onClick: onRefresh }, h(RefreshIcon, {}))),
        h('div', {
          style: {
            flex: 1, minHeight: 0, overflowY: 'auto', borderRadius: T.rMd,
            background: T.surface, boxShadow: T.edge, padding: 10,
          },
        },
          state.phase === 'loading' && issues.length === 0
            ? h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('loading'))
            : state.phase === 'error'
              ? h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, state.error)
              : issues.length === 0
                ? h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('issueNoIssues'))
                : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, alignContent: 'start' } },
                    issues.map(issue => h(IssueCard, {
                      key: issue.number, t, issue,
                      selected: selectedNumber === issue.number,
                      onClick: () => onSelect(selectedNumber === issue.number ? undefined : issue.number),
                    })),
                  (state.total ?? issues.length) > issues.length
                    ? h('div', { style: { gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', padding: '4px 0 2px' } },
                        h('button', {
                          type: 'button', onClick: onLoadMore,
                          style: {
                            appearance: 'none', border: `0.5px solid ${T.border}`, borderRadius: T.pill,
                            background: T.hover, color: T.ink2, fontSize: 11, padding: '4px 14px', cursor: 'pointer',
                          },
                        }, `${t('loadMore')} (${issues.length}/${state.total})`))
                    : null)))
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
      const [height, setHeight] = useState(472)
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
        borderRadius: T.rMd, background: T.surface, boxShadow: T.edgeStrong, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        height: expanded ? height : 30,
        transition: 'height .18s ' + T.ease,
      }
      const header = h('div', {
        onClick: () => setExpanded(value => !value),
        style: { display: 'flex', alignItems: 'center', gap: 7, minHeight: 30, padding: '0 10px', cursor: 'pointer', flex: '0 0 auto', borderBottom: expanded ? `1px solid ${T.borderSoft}` : 'none' },
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
            type: 'button', title: t('graphOptions'), onClick: event => { event.stopPropagation(); setMenuOpen(open => !open) },
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
            h('div', { style: { padding: '4px 8px 3px', fontSize: 10, color: T.subtle } }, t('commitScope')),
            ...[['branch', t('currentBranch')], ['all', t('allRefs')]].map(([value, label]) => h('button', {
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
            h('div', { style: { padding: '4px 8px 3px', fontSize: 10, color: T.subtle } }, t('fileDisplayMode')),
            ...[['tree', t('viewTree')], ['list', t('viewList')]].map(([value, label]) => h('button', {
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
                            ready ? t('statsFiles', { count: detail.data.stats.files }) : t('loading'),
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
                                        h(StatusChip, { status: file.status ?? 'M', size: 14 }),
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
                h('span', null, hover.commit.author || t('unknownAuthor')),
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
                    t('statsFiles', { count: hover.commit.stats.files }),
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
            t('cardRenderFailed', { error: String(this.state.error?.message ?? this.state.error) }))
        }
        return this.props.children
      }
    }

    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      render() {
        if (this.state.error) {
          const t = this.props.t ?? (key => key)
          return h('div', {
            style: {
              flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10, padding: 24, textAlign: 'center', color: T.muted, fontSize: 12,
            },
          },
            h('div', { style: { fontSize: 13, color: T.error, maxWidth: 480, lineHeight: '20px' } },
              t('panelRenderFailed', { error: String(this.state.error?.message ?? this.state.error) })),
            h('button', {
              type: 'button',
              onClick: () => this.setState({ error: null }),
              style: {
                appearance: 'none', border: `0.5px solid ${T.border}`, borderRadius: T.pill,
                padding: '4px 14px', fontSize: 11.5, cursor: 'pointer', background: T.hover, color: T.ink2,
              },
            }, t('retry')))
        }
        return this.props.children
      }
    }

    const IMAGE_PATH_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'])
    function isImagePath(path) {
      const extension = String(path).split('.').pop()?.toLowerCase()
      return IMAGE_PATH_EXTENSIONS.has(extension)
    }

    /** Right-click menu rendered in a body-level layer (no ancestor clipping / fixed containing blocks). */
    function openFileContextMenu({ x, y, items }) {
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      // DSH 0.2.2-rc.2: macOS desktop only excludes interactive controls inside declared window regions.
      menu.setAttribute('data-window-drag-exclude', '')
      menu.style.cssText = [
        'position:fixed', 'z-index:9999', 'min-width:190px', 'max-width:280px', 'padding:4px',
        'border-radius:10px', 'background:var(--dsw-alias-bg-layer-2, #1b1b20)',
        'border:0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))',
        'box-shadow:0 18px 48px rgba(0,0,0,.35)', 'backdrop-filter:blur(24px) saturate(160%)',
        'font-size:12px', 'color:var(--dsw-alias-label-primary, #e6e6ea)',
        'font-family:var(--dsw-font-family, -apple-system, sans-serif)', 'line-height:1.5',
      ].join(';')
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      const close = () => {
        document.removeEventListener('pointerdown', onPointer, true)
        document.removeEventListener('keydown', onKeydown)
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('resize', close)
        menu.remove()
      }
      const onPointer = event => { if (!menu.contains(event.target)) close() }
      const onKeydown = event => { if (event.key === 'Escape') close() }
      for (const entry of items) {
        if (entry.separator) {
          const line = document.createElement('div')
          line.style.cssText = 'height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2, rgba(255,255,255,.12))'
          menu.appendChild(line)
          continue
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = entry.label
        button.style.cssText = [
          'appearance:none', 'border:none', 'background:transparent', 'color:inherit', 'width:100%',
          'text-align:left', 'cursor:pointer', 'padding:6px 10px', 'border-radius:6px', 'font:inherit',
        ].join(';')
        button.addEventListener('mouseenter', () => { button.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))' })
        button.addEventListener('mouseleave', () => { button.style.background = 'transparent' })
        button.addEventListener('click', () => { close(); try { entry.onClick() } catch { /* ignore */ } })
        menu.appendChild(button)
      }
      document.body.appendChild(menu)
      const bounds = menu.getBoundingClientRect()
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
      document.addEventListener('pointerdown', onPointer, true)
      document.addEventListener('keydown', onKeydown)
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
    }

    /** One worktree's file browser, mirroring the changes cards. */
    /* Icons: Material Icon Theme (MIT, https://github.com/material-extensions/vscode-material-icon-theme) */
    const FILE_ICONS = {
      "audio": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ef5350\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m6 10h-4v8a4 4 0 1 1-4-4 3.96 3.96 0 0 1 2 .555V8h6Z\"/></svg>",
      "console": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#ff7043\" d=\"M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z\"/></svg>",
      "csharp": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#0288d1\" d=\"M30 14v-2h-2V8h-2v4h-2V8h-2v4h-2v2h2v2h-2v2h2v4h2v-4h2v4h2v-4h2v-2h-2v-2Zm-4 2h-2v-2h2Zm-12.437 6A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>",
      "css": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#7e57c2\" d=\"M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034\"/><path fill=\"#7e57c2\" d=\"M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z\"/></svg>",
      "database": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ffca28\" d=\"M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2\"/></svg>",
      "docker": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#0288d1\" d=\"M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.28 0-.56.03-.84.08-.21-1.4-1.38-2.11-1.43-2.14l-.29-.17-.18.27c-.24.36-.43.77-.51 1.19-.2.8-.08 1.56.33 2.21-.49.28-1.29.35-1.46.35H2.62c-.34 0-.62.28-.62.63 0 1.15.18 2.3.58 3.38.45 1.19 1.13 2.07 2 2.61.98.6 2.59.94 4.42.94.79 0 1.61-.07 2.42-.22 1.12-.2 2.2-.59 3.19-1.16A8.3 8.3 0 0 0 16.78 16c1.05-1.17 1.67-2.5 2.12-3.65h.19c1.14 0 1.85-.46 2.24-.85.26-.24.45-.53.59-.87l.08-.24zm-17.96.99h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H3.85c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.43 0h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H6.28c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.47 0h1.75c.1 0 .17-.07.17-.16V9.5c0-.08-.06-.16-.17-.16H8.75c-.08 0-.15.07-.15.16v1.58c0 .09.06.16.15.16m2.44 0h1.77c.08 0 .15-.07.15-.16V9.5c0-.08-.06-.16-.15-.16h-1.77c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16M6.28 9h1.76c.08 0 .16-.09.16-.18V7.25c0-.09-.07-.16-.16-.16H6.28c-.09 0-.16.06-.16.16v1.57c.01.09.07.18.16.18m2.47 0h1.75c.1 0 .17-.09.17-.18V7.25c0-.09-.06-.16-.17-.16H8.75c-.08 0-.15.06-.15.16v1.57c0 .09.06.18.15.18m2.44 0h1.77c.08 0 .15-.09.15-.18V7.25c0-.09-.07-.16-.15-.16h-1.77c-.08 0-.15.06-.15.16v1.57c0 .09.07.18.15.18m0-2.28h1.77c.08 0 .15-.07.15-.16V5c0-.1-.07-.17-.15-.17h-1.77c-.08 0-.15.06-.15.17v1.56c0 .08.07.16.15.16m2.46 4.52h1.76c.09 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16h-1.76c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16\"/></svg>",
      "document": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z\"/></svg>",
      "file": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path d=\"m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z\" fill=\"#90a4ae\" /></svg>",
      "folder": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path d=\"m6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232\" fill=\"#90a4ae\" /></svg>",
      "folder-open": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path d=\"M14.483 6H4.721a1 1 0 0 0-.949.684L2 12V5h12a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11l2.403-5.606A1 1 0 0 0 14.483 6\" fill=\"#90a4ae\" /></svg>",
      "git": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#e64a19\" d=\"M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0\"/></svg>",
      "go": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#00acc1\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#00acc1\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>",
      "graphql": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ec407a\" d=\"M6 20h20v2H6z\"/><circle cx=\"7\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"27\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 10h20v2H6z\"/><circle cx=\"7\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"5\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 12h2v10H6zm18-2h2v12h-2z\"/><path fill=\"#ec407a\" d=\"m5.014 19.41 11.674 6.866L15.674 28 4 21.134z\"/><path fill=\"#ec407a\" d=\"M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z\"/><path fill=\"#ec407a\" d=\"m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z\"/><path fill=\"#ec407a\" d=\"m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z\"/><path fill=\"#ec407a\" d=\"M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z\"/></svg>",
      "hex": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#26a69a\" d=\"M4 8v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m4 14V10h4v12Zm11.999-6L18 18.001 21 21l-3 3.001L19.999 26l3.003-3 3 2.999L28 24l-3-2.999 3-3L26.001 16l-3 3z\"/></svg>",
      "html": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#e65100\" d=\"m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z\"/></svg>",
      "image": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#26a69a\" d=\"M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9\"/></svg>",
      "java": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#f44336\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>",
      "javascript": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#ffca28\" d=\"M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>",
      "json": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\" width=\"14\" height=\"14\"><path fill=\"#f9a825\" d=\"M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z\"/></svg>",
      "kotlin": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><defs><linearGradient id=\"a\" x1=\"1.725\" x2=\"22.185\" y1=\"22.67\" y2=\"1.982\" gradientTransform=\"translate(1.306 1.129)scale(.89324)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7c4dff\"/><stop offset=\".5\" stop-color=\"#d500f9\"/><stop offset=\"1\" stop-color=\"#ef5350\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z\"/></svg>",
      "less": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#0277bd\" d=\"M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z\"/></svg>",
      "license": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#ff5722\" d=\"M8 1a5.5 5.5 0 0 0-4 9.26V15l4-1.5 4 1.5v-4.74A5.49 5.49 0 0 0 8 1m0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4\"/></svg>",
      "lock": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ffd54f\" d=\"M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4\"/></svg>",
      "log": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#afb42b\" d=\"M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z\"/></svg>",
      "makefile": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ef5350\" d=\"m29.5 24.02-1.6-.92a4.4 4.4 0 0 0 .09-.9A1.3 1.3 0 0 0 28 22a5.6 5.6 0 0 0-.1-1.1l1.6-.92a.493.493 0 0 0 .18-.68l-1.5-2.6a.45.45 0 0 0-.18-.18V6.01a2.006 2.006 0 0 0-2-2H4a2.006 2.006 0 0 0-2 2V22a2.006 2.006 0 0 0 2 2h10.53l-.03.02a.493.493 0 0 0-.18.68l1.5 2.6a.493.493 0 0 0 .68.18l1.6-.92a5.9 5.9 0 0 0 1.9 1.09v1.85a.495.495 0 0 0 .5.5h3a.495.495 0 0 0 .5-.5v-1.85a5.9 5.9 0 0 0 1.9-1.09l1.6.92a.493.493 0 0 0 .68-.18l1.5-2.6a.493.493 0 0 0-.18-.68M24 22.01a1.99 1.99 0 0 1-.88 1.65l-.18.11a2.04 2.04 0 0 1-1.88 0l-.18-.11a1.99 1.99 0 0 1-.88-1.65V22a2 2 0 0 1 .88-1.66l.18-.11a2.04 2.04 0 0 1 1.88 0l.18.11A2 2 0 0 1 24 22Zm2-4.63-.1.06a5.9 5.9 0 0 0-1.9-1.09V14.5a.495.495 0 0 0-.5-.5h-3a.495.495 0 0 0-.5.5v1.85a5.9 5.9 0 0 0-1.9 1.09l-1.6-.92a.493.493 0 0 0-.68.18l-1.5 2.6a.493.493 0 0 0 .18.68l1.6.92A5.6 5.6 0 0 0 16 22v.01L4 22V10.01h22Z\"/></svg>",
      "markdown": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#42a5f5\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>",
      "nodejs": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#8bc34a\" d=\"M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z\"/><path fill=\"#8bc34a\" d=\"m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z\"/></svg>",
      "npm": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#e53935\" d=\"M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z\"/></svg>",
      "pdf": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#ef5350\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z\"/></svg>",
      "php": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#1e88e5\" d=\"M12 18.08c-6.63 0-12-2.72-12-6.08s5.37-6.08 12-6.08S24 8.64 24 12s-5.37 6.08-12 6.08m-5.19-7.95c.54 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.58 1.09q-.42.33-1.29.33h-.87l.53-2.76zm-3.5 5.55h1.44l.34-1.75h1.23c.54 0 .98-.06 1.33-.17.35-.12.67-.31.96-.58.24-.22.43-.46.58-.73.15-.26.26-.56.31-.88.16-.78.05-1.39-.33-1.82-.39-.44-.99-.65-1.82-.65H4.59zm7.25-8.33-1.28 6.58h1.42l.74-3.77h1.14c.36 0 .6.06.71.18s.13.34.07.66l-.57 2.93h1.45l.59-3.07c.13-.62.03-1.07-.27-1.36-.3-.27-.85-.4-1.65-.4h-1.27L12 7.35zM18 10.13c.55 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.57 1.09-.29.22-.72.33-1.3.33h-.85l.5-2.76zm-3.5 5.55h1.44l.34-1.75h1.22c.55 0 1-.06 1.35-.17.35-.12.65-.31.95-.58.24-.22.44-.46.58-.73.15-.26.26-.56.32-.88.15-.78.04-1.39-.34-1.82-.36-.44-.99-.65-1.82-.65h-2.75z\"/></svg>",
      "pnpm": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#e0e0e0\" d=\"M2 22h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zM12 12h8v8h-8z\"/><path fill=\"#ffb300\" d=\"M2 2h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zm0 10h8v8h-8z\"/></svg>",
      "prettier": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#f44336\" d=\"M2 8h4v1H2zm0 6h4v1H2zm9-10h3v1h-3zM2 2h3v1H2z\"/><path fill=\"#f9a825\" d=\"M9 2h3v1H9zm1 4h4v1h-4zm-5 6h1v1H5zm-3-2h6v1H2z\"/><path fill=\"#26a69a\" d=\"M2 12h3v1H2zm7-4h5v1H9zM2 4h4v1H2zm3-2h4v1H5z\"/><path fill=\"#ba68c8\" d=\"M2 6h3v1H2zm7-2h2v1H9zm-1 6h4v1H8z\"/></svg>",
      "python": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#0288d1\" d=\"M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711\"/><path fill=\"#fdd835\" d=\"M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM8.32 11.513l-.004.004.038-.004zm6.54 7.276c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89\"/></svg>",
      "react": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#00bcd4\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#00bcd4\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#00bcd4\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#00bcd4\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>",
      "react_ts": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#0288d1\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#0288d1\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#0288d1\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#0288d1\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>",
      "readme": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z\"/></svg>",
      "ruby": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#f44336\" d=\"M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z\"/></svg>",
      "rust": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ff7043\" d=\"m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10\"/></svg>",
      "sass": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ec407a\" d=\"M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754\"/></svg>",
      "settings": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2\"/></svg>",
      "svelte": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\" width=\"14\" height=\"14\"><path fill=\"#ff5722\" d=\"M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z\"/></svg>",
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ffb300\" d=\"M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z\"/></svg>",
      "swift": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#ff6e40\" d=\"M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17\"/></svg>",
      "table": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#8bc34a\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zm4 7.5h-4v2h1l-2 1.67L10 13h1v-2H7v2h1l3 2.5L8 18H7v2h4v-2h-1l2-1.67L14 18h-1v2h4v-2h-1l-3-2.5 3-2.5h1z\"/></svg>",
      "toml": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#cfd8dc\" d=\"M4 6V4h8v2H9v7H7V6z\"/><path fill=\"#ef5350\" d=\"M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z\"/></svg>",
      "tsconfig": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#757575\" d=\"M15 2H6a2.006 2.006 0 0 0-2 2v22a2.006 2.006 0 0 0 2 2h6v-4H6v-2h6v-2H6v-2h6v-2H6v-2h6v-2h2V4l8 8h2v-1Z\" data-mit-no-recolor=\"true\"/><path fill=\"#0288d1\" d=\"M12 12v18h18V12Zm8 6h-2v8h-2v-8h-2v-2h6Zm8 0h-4v2h2a2.006 2.006 0 0 1 2 2v2a2.006 2.006 0 0 1-2 2h-4v-2h4v-2h-2a2.006 2.006 0 0 1-2-2v-2a2.006 2.006 0 0 1 2-2h4Z\"/></svg>",
      "tune": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#fbc02d\" d=\"M12 10h10v2H12z\"/><path fill=\"#fbc02d\" d=\"M16 4h2v8h-2zm4 18h10v2H20zm4 2h2v4h-2zm0-20h2v14h-2zM2 18h10v2H2z\"/><path fill=\"#fbc02d\" d=\"M6 18h2v10H6zM6 4h2v10H6zm10 12h2v12h-2z\"/></svg>",
      "typescript": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\"><path fill=\"#0288d1\" d=\"M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>",
      "video": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#ff9800\" d=\"m24 6 2 6h-4l-2-6h-3l2 6h-4l-2-6h-3l2 6H8L6 6H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V6Z\"/></svg>",
      "vite": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#a0f\" d=\"M29.313 12h-6.664a1.427 1.427 0 0 1-1.1-2.24l4.398-6.676A.703.703 0 0 0 25.397 2H8.428a.62.62 0 0 0-.55.289l-5.77 8.627A.703.703 0 0 0 2.658 12h8.175a1.427 1.427 0 0 1 1.099 2.24l-4.48 6.676A.702.702 0 0 0 8 22l6.695.002A1.34 1.34 0 0 1 16 23.375v5.934a.652.652 0 0 0 1.168.433l12.694-16.586a.725.725 0 0 0-.55-1.156\"/></svg>",
      "vue": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#41b883\" d=\"M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z\"/><path fill=\"#35495e\" d=\"m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z\"/></svg>",
      "webassembly": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#7c4dff\" d=\"M22 18h4v4h-4z\"/><path fill=\"#7c4dff\" d=\"M20 2a4 4 0 0 1-8 0H2v28h28V2Zm-2 24h-2v2h-4v-2h-2v2H6v-2H4V16h2v10h4V16h2v10h4V16h2Zm10 2h-2v-4h-4v4h-2V18h2v-2h4v2h2Z\"/></svg>",
      "xml": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#8bc34a\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z\"/></svg>",
      "yaml": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#ff5252\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z\"/></svg>",
      "yarn": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"14\" height=\"14\"><path fill=\"#0288d1\" d=\"M27.575 23.967a9.9 9.9 0 0 0-3.751 1.726 22.6 22.6 0 0 1-5.537 2.504 1.55 1.55 0 0 1-.931.52 59 59 0 0 1-6.11.548c-1.102.008-1.777-.282-1.965-.735a1.49 1.49 0 0 1 .82-1.965 3.6 3.6 0 0 1-.486-.359c-.163-.162-.334-.487-.385-.367-.213.52-.324 1.794-.897 2.366-.786.795-2.273.53-3.153.069-.965-.513.069-1.718.069-1.718a.69.69 0 0 1-.94-.324 4.6 4.6 0 0 1-.632-2.794 5.2 5.2 0 0 1 1.674-2.76 8.84 8.84 0 0 1 .624-4.17 9.9 9.9 0 0 1 3-3.469S7.136 11.015 7.82 9.177c.444-1.196.623-1.187.769-1.239a3.44 3.44 0 0 0 1.375-.811 4.99 4.99 0 0 1 4.178-1.607s1.094-3.357 2.12-2.7a17.4 17.4 0 0 1 1.452 2.735s1.213-.71 1.35-.445a10.74 10.74 0 0 1 .495 5.81 13.3 13.3 0 0 1-2.46 5.127c-.129.214 1.47.889 2.477 3.683.932 2.554.103 4.699.248 4.938.026.043.034.06.034.06s1.068.085 3.213-1.24a8.05 8.05 0 0 1 4.05-1.52 1.026 1.026 0 0 1 .453 2Z\"/></svg>",
      "zip": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"14\" height=\"14\"><path fill=\"#afb42b\" d=\"M14 17h-2v-2h-2v-2h2v2h2m0-6h-2v2h2v2h-2v-2h-2V9h2V7h-2V5h2v2h2m5-4H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2\"/></svg>",
    }
    const FILE_EXTENSION_ICONS = {
      "md": "markdown",
      "markdown": "markdown",
      "json": "json",
      "jsonc": "json",
      "js": "javascript",
      "mjs": "javascript",
      "cjs": "javascript",
      "jsx": "react",
      "ts": "typescript",
      "mts": "typescript",
      "cts": "typescript",
      "tsx": "react_ts",
      "css": "css",
      "scss": "sass",
      "sass": "sass",
      "less": "less",
      "html": "html",
      "htm": "html",
      "vue": "vue",
      "svelte": "svelte",
      "py": "python",
      "go": "go",
      "rs": "rust",
      "java": "java",
      "kt": "kotlin",
      "rb": "ruby",
      "php": "php",
      "cs": "csharp",
      "swift": "swift",
      "sh": "console",
      "bash": "console",
      "zsh": "console",
      "fish": "console",
      "yml": "yaml",
      "yaml": "yaml",
      "toml": "toml",
      "ini": "settings",
      "conf": "settings",
      "xml": "xml",
      "sql": "database",
      "graphql": "graphql",
      "gql": "graphql",
      "csv": "table",
      "txt": "document",
      "log": "log",
      "lock": "lock",
      "pdf": "pdf",
      "png": "image",
      "jpg": "image",
      "jpeg": "image",
      "gif": "image",
      "webp": "image",
      "bmp": "image",
      "ico": "image",
      "avif": "image",
      "svg": "svg",
      "mp3": "audio",
      "wav": "audio",
      "ogg": "video",
      "flac": "audio",
      "m4a": "audio",
      "mp4": "video",
      "webm": "video",
      "mov": "video",
      "m4v": "video",
      "ogv": "video",
      "zip": "zip",
      "tar": "zip",
      "gz": "zip",
      "tgz": "zip",
      "bz2": "zip",
      "xz": "zip",
      "7z": "zip",
      "rar": "zip",
      "db": "database",
      "sqlite": "database",
      "wasm": "webassembly",
      "bin": "hex",
      "env": "tune",
    }
    const FILE_NAME_ICONS = {
      ".gitignore": "git",
      ".gitattributes": "git",
      ".gitmodules": "git",
      "dockerfile": "docker",
      "makefile": "makefile",
      "license": "license",
      "readme.md": "readme",
      "package.json": "nodejs",
      "pnpm-lock.yaml": "pnpm",
      "yarn.lock": "yarn",
      ".npmrc": "npm",
      ".prettierrc": "prettier",
      "tsconfig.json": "tsconfig",
      "vite.config.ts": "vite",
    }
    const FOLDER_ICON = "folder"
    const FOLDER_OPEN_ICON = "folder-open"

    function FileGlyph({ name, kind, expanded }) {
      const baseName = String(name ?? '').toLowerCase()
      const extension = baseName.includes('.') ? baseName.slice(baseName.lastIndexOf('.') + 1) : ''
      const icon = kind === 'dir'
        ? (expanded ? FOLDER_OPEN_ICON : FOLDER_ICON)
        : (FILE_NAME_ICONS[baseName] ?? FILE_EXTENSION_ICONS[extension] ?? 'file')
      const markup = FILE_ICONS[icon] ?? FILE_ICONS.file
      return h('span', {
        style: { width: 14, height: 14, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
        dangerouslySetInnerHTML: { __html: markup },
      })
    }

    /** One worktree's file browser: lazy filesystem tree (all files, icons, statuses). */
    function WorktreeFilesCard({ t, item, defaultOpen, onOpen, selectedPath, onSelect, onNotify, visible = true }) {
      const [open, setOpen] = useState(defaultOpen)
      const [expandedDirs, setExpandedDirs] = useState(() => new Set())
      const [dirs, setDirs] = useState({})
      const [hoveredKey, setHoveredKey] = useState(undefined)
      const [version, setVersion] = useState(0)
      const [status, refreshStatus] = useStatusAt(item.path, open && visible)
      const statusByPath = useMemo(() => {
        const map = new Map()
        for (const file of [...(status.data?.staged ?? []), ...(status.data?.unstaged ?? []), ...(status.data?.untracked ?? [])]) {
          if (file?.path) map.set(file.path, file.status)
        }
        return map
      }, [status.data])
      const dirStatusByPath = useMemo(() => aggregateDirStatus(statusByPath), [statusByPath])
      const loadDir = useCallback(async dir => {
        setDirs(previous => ({ ...previous, [dir]: { phase: 'loading', entries: previous[dir]?.entries ?? [] } }))
        try {
          const data = await api('/fs/list', { path: item.path, dir })
          setDirs(previous => ({ ...previous, [dir]: { phase: 'ready', entries: Array.isArray(data?.entries) ? data.entries : [], truncated: Boolean(data?.truncated) } }))
        } catch (error) {
          setDirs(previous => ({ ...previous, [dir]: { phase: 'error', entries: [], error: String(error?.message ?? error) } }))
        }
      }, [item.path])
      useEffect(() => { if (open && visible) loadDir('') }, [open, visible, loadDir, version])
      const refreshFiles = () => { setVersion(value => value + 1); refreshStatus() }
      const toggleDir = path => setExpandedDirs(previous => {
        const next = new Set(previous)
        if (next.has(path)) { next.delete(path); return next }
        next.add(path)
        if (!dirs[path] || dirs[path].phase === 'error') loadDir(path)
        return next
      })
      const rootEntries = dirs['']?.entries ?? []
      const rows = []
      const walk = (dirPath, depth) => {
        const node = dirs[dirPath]
        if (!node) return
        if (node.phase === 'loading' && node.entries.length === 0) {
          rows.push(h('div', { key: `${dirPath}:loading`, style: { fontSize: 10.5, color: T.muted, padding: `3px 8px 3px ${10 + depth * 13}px` } }, t('filesLoading')))
          return
        }
        if (node.phase === 'error') {
          rows.push(h('div', { key: `${dirPath}:error`, style: { fontSize: 10.5, color: T.error, padding: `3px 8px 3px ${10 + depth * 13}px` } }, node.error))
          return
        }
        for (const entry of node.entries) {
          const isDir = entry.kind === 'dir'
          const statusLetter = isDir ? dirStatusByPath.get(entry.path) : statusByPath.get(entry.path)
          const expanded = isDir && expandedDirs.has(entry.path)
          const selected = !isDir && selectedPath === entry.path
          rows.push(h('div', {
            key: entry.path,
            title: entry.path,
            onClick: () => { if (isDir) toggleDir(entry.path); else onOpen({ path: entry.path }, item.path) },
            style: {
              display: 'flex', alignItems: 'center', gap: 5, minHeight: 21, margin: '0 4px',
              padding: `1px 6px 1px ${8 + depth * 13}px`, borderRadius: T.rSm, cursor: 'pointer',
              background: selected ? T.selected : 'transparent',
              color: T.ink2,
              fontSize: 12,
            },
            onMouseEnter: event => { if (!selected) event.currentTarget.style.background = T.hover; setHoveredKey(entry.path) },
            onMouseLeave: event => { if (!selected) event.currentTarget.style.background = 'transparent'; if (hoveredKey === entry.path) setHoveredKey(undefined) },
            onContextMenu: event => { event.preventDefault(); event.stopPropagation(); openFileContextMenu({ x: event.clientX, y: event.clientY, items: menuItems(entry, isDir) }) },
          },
            isDir ? h(Chevron, { open: expanded, size: 8 }) : h('span', { style: { width: 8, flex: '0 0 8px' } }),
            h(FileGlyph, { name: entry.name, kind: entry.kind, expanded }),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
            statusLetter ? h(StatusChip, { status: statusLetter, size: 15 }) : null))
          if (isDir && expanded) walk(entry.path, depth + 1)
        }
        if (node.truncated) rows.push(h('div', { key: `${dirPath}:truncated`, style: { fontSize: 10, color: T.subtle, padding: `2px 8px 2px ${10 + depth * 13}px` } }, '…'))
      }
      walk('', 0)
      const menuItems = (entry, isDir) => {
        const root = item.path.replace(/\/$/, '')
        const absolute = `${root}/${entry.path}`
        const rawUrl = `/git-assistant/api/raw?path=${encodeURIComponent(item.path)}&file=${encodeURIComponent(entry.path)}`
        const notify = (message, kind) => onNotify?.(message, kind)
        const copy = async (text, done) => {
          try { await navigator.clipboard.writeText(text); notify(done) } catch { notify(t('actionFailed'), 'error') }
        }
        const copyImage = async () => {
          try {
            const response = await fetch(rawUrl)
            const blob = await response.blob()
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
            notify(t('imageCopied'))
          } catch { notify(t('actionFailed'), 'error') }
        }
        const download = () => {
          const link = document.createElement('a')
          link.href = `${rawUrl}&download=1`
          link.download = entry.name
          document.body.appendChild(link)
          link.click()
          link.remove()
        }
        const saveAs = async () => {
          try {
            const response = await fetch(rawUrl)
            const blob = await response.blob()
            if (window.showSaveFilePicker) {
              const handle = await window.showSaveFilePicker({ suggestedName: entry.name })
              const writable = await handle.createWritable()
              await writable.write(blob)
              await writable.close()
            } else download()
          } catch (error) { if (error?.name !== 'AbortError') notify(t('actionFailed'), 'error') }
        }
        const call = endpoint => apiPost(endpoint, { path: item.path, file: entry.path }).catch(() => notify(t('actionFailed'), 'error'))
        if (isDir) {
          return [
            { label: t('copyFolderPath'), onClick: () => copy(absolute, t('copiedPath')) },
            { separator: true },
            { label: t('revealInFinder'), onClick: () => call('/reveal') },
          ]
        }
        const items = [{ label: t('copyPath'), onClick: () => copy(absolute, t('copiedPath')) }]
        if (isImagePath(entry.path)) items.push({ label: t('copyImage'), onClick: copyImage })
        items.push(
          { label: t('downloadFile'), onClick: download },
          { label: t('saveAs'), onClick: saveAs },
          { separator: true },
          { label: t('revealInFinder'), onClick: () => call('/reveal') },
          { label: t('openDefaultApp'), onClick: () => call('/open') },
        )
        return items
      }
      return h(CardBoundary, null,
        h('div', {
          style: { marginBottom: 8, flex: open ? '1 0 auto' : '0 0 auto', minHeight: open ? 0 : undefined, display: 'flex', flexDirection: 'column', borderRadius: T.rMd, background: T.surface, boxShadow: T.edge, overflow: 'hidden' },
        },
          h('div', {
            onClick: () => { setOpen(value => !value); onSelect?.(item.path) },
            style: {
              display: 'flex', alignItems: 'center', gap: 7, minHeight: 36, padding: '0 12px', cursor: 'pointer',
              background: open ? T.surfaceAlt : T.surface,
              borderBottom: open ? `1px solid ${T.borderSoft}` : 'none',
            },
            onMouseEnter: event => { event.currentTarget.style.background = T.surfaceAlt },
            onMouseLeave: event => { event.currentTarget.style.background = open ? T.surfaceAlt : T.surface },
          },
            h(Chevron, { open, size: 9 }),
            h('span', { title: item.path, style: { fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 72, flex: '0 1 auto' } }, item.name ?? item.path.split('/').pop()),
            item.branch ? h('span', {
              style: { fontFamily: MONO, fontSize: 10.5, color: T.ink2, background: T.chip, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', maxWidth: 104, flex: '0 2 auto', overflow: 'hidden', textOverflow: 'ellipsis' },
            }, item.branch) : null,
            h('span', { style: { flex: 1 } }),
            h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.muted, whiteSpace: 'nowrap' } }, `${item.behind > 0 ? `↓${item.behind}` : ''}${item.ahead > 0 ? ` ↑${item.ahead}` : ''}`),
            h('span', { style: { fontSize: 10.5, color: T.subtle } }, dirs['']?.phase === 'ready' ? String(rootEntries.length) : ''),
            h(IconAction, { label: t('refresh'), onClick: event => { event.stopPropagation(); refreshFiles() } }, h(RefreshIcon, {}))),
          open ? h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 4px 8px' } }, rows) : null))
    }

    function formatRelativeTime(epochSeconds) {
      const now = Math.floor(Date.now() / 1000)
      const diff = Math.max(0, now - epochSeconds)
      let locale
      try { locale = document?.documentElement?.lang || undefined } catch { locale = undefined }
      let rtf
      try { rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }) } catch { rtf = undefined }
      if (!rtf) return new Date(epochSeconds * 1000).toLocaleDateString()
      if (diff < 60) return rtf.format(-diff, 'second')
      if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
      if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
      if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day')
      return new Date(epochSeconds * 1000).toLocaleDateString()
    }

    /** Unpushed commits for the current worktree (local commits not reachable from any remote). */
    function useLocalCommits(repository, enabled) {
      const [state, setState] = useState({ phase: 'idle', commits: [], error: null })
      const [version, setVersion] = useState(0)
      const path = repository?.path
      useEffect(() => {
        if (!path || !enabled) { setState({ phase: 'idle', commits: [], error: null }); return undefined }
        let live = true
        setState(previous => ({ ...previous, phase: 'loading' }))
        api('/local-commits', { path, limit: 80 })
          .then(data => { if (live) setState({ phase: 'ready', commits: Array.isArray(data?.commits) ? data.commits : [], error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', commits: [], error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, enabled, version])
      return [state, () => setVersion(value => value + 1)]
    }

    /** Full parsed patch of one commit, for the multi-file commit view. */
    function useCommitPatch(repository, selection) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const [version, setVersion] = useState(0)
      const active = selection?.kind === 'commit-files'
      const path = selection?.repoPath ?? repository?.path
      useEffect(() => {
        if (!path || !active) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', data: null, error: null })
        api('/commit', { path, hash: selection.hash })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, active, selection?.hash, version])
      return [state, () => setVersion(value => value + 1)]
    }

    function useCommitFileDiff(context, file) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const path = context?.repoPath
      const hash = context?.hash
      useEffect(() => {
        if (!path || !hash || !file) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', data: null, error: null })
        api('/commit-diff', { path, hash, file })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, hash, file])
      return state
    }

    function useIssues(repository, enabled, stateFilter, query, limit, version) {
      const [state, setState] = useState({ phase: 'idle', issues: [], repo: null, total: 0, error: null })
      const path = repository?.path
      useEffect(() => {
        if (!path || !enabled) { setState(previous => ({ ...previous, phase: 'idle' })); return undefined }
        let live = true
        setState(previous => ({ ...previous, phase: previous.issues.length ? 'ready' : 'loading', error: null }))
        api('/issues', { path, state: stateFilter, search: query, limit, refresh: version > 0 ? '1' : '' })
          .then(data => { if (live) setState({ phase: 'ready', issues: Array.isArray(data?.issues) ? data.issues : [], repo: data?.repo ?? null, total: Number(data?.total) || (Array.isArray(data?.issues) ? data.issues.length : 0), error: null }) })
          .catch(error => { if (live) setState(previous => ({ ...previous, phase: 'error', error: String(error?.message ?? error) })) })
        return () => { live = false }
      }, [path, enabled, stateFilter, query, limit, version])
      return state
    }

    function useIssueDetail(repository, number, version = 0) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const path = repository?.path
      useEffect(() => {
        if (!path || !number) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', data: null, error: null })
        api('/issue', { path, number, refresh: version > 0 ? '1' : '' })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, number, version])
      return state
    }

    function useIssueComments(repository, number, version = 0) {
      const [state, setState] = useState({ phase: 'idle', data: null, error: null })
      const path = repository?.path
      useEffect(() => {
        if (!path || !number) { setState({ phase: 'idle', data: null, error: null }); return undefined }
        let live = true
        setState({ phase: 'loading', data: null, error: null })
        api('/issue-comments', { path, number, refresh: version > 0 ? '1' : '' })
          .then(data => { if (live) setState({ phase: 'ready', data, error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, number, version])
      return state
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
        onMouseEnter: event => { if (!disabled) { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = T.text; showTooltip(label, event.currentTarget) } },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = T.ink2; hideTooltip() },
      }, children)
    }

    let tooltipElement = null
    function hideTooltip() {
      if (tooltipElement) { tooltipElement.remove(); tooltipElement = null }
    }
    function showTooltip(text, target) {
      hideTooltip()
      if (!text || typeof document === 'undefined' || !target) return
      const element = document.createElement('div')
      element.textContent = text
      element.setAttribute('role', 'tooltip')
      element.style.cssText = [
        'position:fixed', 'z-index:10000', 'pointer-events:none', 'padding:4px 8px', 'border-radius:6px',
        'font-size:11px', 'line-height:1.4', 'max-width:280px', 'white-space:nowrap',
        'background:var(--dsw-alias-bg-layer-2, #1b1b20)', 'color:var(--dsw-alias-label-primary, #e6e6ea)',
        'border:0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))',
        'box-shadow:0 6px 24px rgba(0,0,0,.3)',
        'font-family:var(--dsw-font-family, -apple-system, sans-serif)',
      ].join(';')
      document.body.appendChild(element)
      const rect = target.getBoundingClientRect()
      const width = element.offsetWidth || 0
      const height = element.offsetHeight || 0
      const left = Math.max(4, Math.min(rect.left + rect.width / 2 - width / 2, (window.innerWidth || 1200) - width - 4))
      let top = rect.bottom + 6
      if (top + height > (window.innerHeight || 800) - 4) top = rect.top - height - 6
      element.style.left = `${left}px`
      element.style.top = `${Math.max(4, top)}px`
      tooltipElement = element
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('pointerdown', () => hideTooltip(), true)
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('scroll', () => hideTooltip(), true)
      window.addEventListener('blur', () => hideTooltip())
    }

    function IconAction({ label, onClick, disabled, danger, children }) {
      return h('button', {
        type: 'button', title: label, 'aria-label': label, onClick, disabled,
        style: {
          appearance: 'none', border: 'none', background: 'transparent', color: danger ? T.muted : T.ink2,
          cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', width: 22, height: 22, borderRadius: 6, padding: 0,
          opacity: disabled ? 0.3 : 1, transition: `background .15s ${T.ease}, color .15s ${T.ease}`,
        },
        onMouseEnter: event => { if (!disabled) { event.currentTarget.style.background = T.hover; event.currentTarget.style.color = danger ? T.error : T.text; showTooltip(label, event.currentTarget) } },
        onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = danger ? T.error : T.muted; hideTooltip() },
      }, children)
    }

    const IconPlus = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, h('path', { d: 'M12 5v14M5 12h14' }))
    const IconUndo = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M9 14L4 9l5-5' }), h('path', { d: 'M4 9h9a6 6 0 1 1 0 12H8' }))
    const IconDiff = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M12 4v16M7 8h2M7 12h2M15 8h2M15 12h2M15 16h2' }))
    const IconMinus = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, h('path', { d: 'M5 12h14' }))
    const IconStash = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M4 8l2-4h12l2 4' }), h('path', { d: 'M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8' }), h('path', { d: 'M12 8v6' }), h('path', { d: 'M9.5 11.5L12 14l2.5-2.5' }))
    const IconCopy = () => h('svg', { width: 12.5, height: 12.5, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('rect', { x: 9, y: 9, width: 11, height: 12, rx: 2 }), h('path', { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }))
    const IconFolder = () => h('svg', { width: 12.5, height: 12.5, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M3 7a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z' }))
    const IconExternal = () => h('svg', { width: 12.5, height: 12.5, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M14 4h6v6' }), h('path', { d: 'M20 4L11 13' }), h('path', { d: 'M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5' }))
    const IconHistory = () => h('svg', { width: 12.5, height: 12.5, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M3.5 12a8.5 8.5 0 1 0 2.5-6' }), h('path', { d: 'M3 4v4h4' }), h('path', { d: 'M12 8v4.5l3 2' }))
    const IconMore = () => h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'currentColor', stroke: 'none' }, h('circle', { cx: 5, cy: 12, r: 1.7 }), h('circle', { cx: 12, cy: 12, r: 1.7 }), h('circle', { cx: 19, cy: 12, r: 1.7 }))

    /** Secondary action: a real raised control (surface + hairline ring), never a ghost outline. */
    function SmallButton({ label, onClick, disabled, title }) {
      return h('button', {
        type: 'button', title: title ?? label, onClick, disabled,
        style: {
          appearance: 'none', border: '1px solid transparent', background: T.surface, color: T.text,
          cursor: disabled ? 'default' : 'pointer', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
          height: 26, padding: '0 11px', borderRadius: 8, opacity: disabled ? 0.4 : 1, whiteSpace: 'nowrap',
          boxShadow: T.ring, transition: `background .15s ${T.ease}`,
        },
        onMouseEnter: event => { if (!disabled) event.currentTarget.style.background = T.surfaceHover },
        onMouseLeave: event => { event.currentTarget.style.background = T.surface },
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
            display: 'flex', alignItems: 'center', gap: 5, minHeight: 24, margin: '0 4px',
            padding: `1px 7px 1px ${7 + depth * 13}px`, cursor: 'pointer', userSelect: 'none',
            borderRadius: 6, color: T.ink2, transition: `background .12s ${T.ease}`,
          },
          onClick: () => onToggleDir(directory.path),
          onMouseEnter: event => { event.currentTarget.style.background = T.hover },
          onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
        },
          h(Chevron, { open: expanded, size: 9 }),
          h(FileGlyph, { name: directory.name, kind: 'dir', expanded }),
          h('span', { style: { fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, directory.name),
          h('span', { style: { flex: 1 } }),
          dirStatus ? h(StatusChip, { status: dirStatus, size: 15 }) : null))
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
            display: 'flex', alignItems: 'center', gap: 6, minHeight: 25, margin: '0 4px',
            padding: `1px 7px 1px ${7 + depth * 13 + 12}px`,
            cursor: 'pointer', background: active ? T.selected : 'transparent', minWidth: 0,
            borderRadius: 6, transition: `background .12s ${T.ease}`,
          },
          onMouseEnter: event => { if (!active) event.currentTarget.style.background = T.hover; onHoverKey?.(key) },
          onMouseLeave: event => { if (!active) event.currentTarget.style.background = 'transparent'; if (hoveredKey === key) onHoverKey?.(undefined) },
        },
          h(FileGlyph, { name: file.name, kind: 'file' }),
          h('span', {
            style: {
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, fontSize: 12.5,
              fontWeight: active ? 500 : 400, color: T.text,
            },
          }, file.name),
          h('span', { style: { flex: 1 } }),
          (hovered || active) && actionsFor
            ? h('span', { style: { display: 'inline-flex', gap: 1, alignItems: 'center', flex: '0 0 auto' } }, actionsFor(file))
            : null,
          h(StatusChip, { status, size: 15 })))
      }
      return rows
    }

    /* ── diff / preview components ──────────────────────────────────── */

    const DIFF_RENDER_STEP = 600

    function DiffLines({ file, view, t, wrap = false, embedded = false, context }) {
      const files = Array.isArray(file) ? file : [file]
      const entry = files[0]
      const [visibleCount, setVisibleCount] = useState(DIFF_RENDER_STEP)
      const [expandedHunks, setExpandedHunks] = useState(() => new Set())
      const [expandedGaps, setExpandedGaps] = useState(() => new Map())
      const scrollRef = useRef(null)
      const resetKey = `${entry?.path ?? ''}|${entry?.additions ?? 0}|${entry?.deletions ?? 0}|${entry?.hunks?.length ?? 0}|${view}`
      useEffect(() => {
        setVisibleCount(DIFF_RENDER_STEP)
        setExpandedHunks(new Set())
        setExpandedGaps(new Map())
        if (scrollRef.current) scrollRef.current.scrollTop = 0
      }, [resetKey])
      if (!entry) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('noDiff'))
      if (entry.binary) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('binary'))
      if (entry.hunks.length === 0) return h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('noDiff'))
      const language = languageOf(entry.path ?? '')
      const highlight = entry.hunks.reduce((total, hunk) => total + hunk.lines.length, 0) <= 1500
      const rows = view === 'split' ? splitRows(entry.hunks, language, highlight) : unifiedRows(entry.hunks, language, highlight)
      const bigHunks = new Set()
      entry.hunks.forEach((hunk, index) => { if ((hunk.lines?.length ?? 0) > 1000) bigHunks.add(index) })
      const displayRows = []
      const collapsedShown = new Set()
      for (const row of rows) {
        if (row.hunkIndex !== undefined && bigHunks.has(row.hunkIndex) && !expandedHunks.has(row.hunkIndex)) {
          if (!collapsedShown.has(row.hunkIndex)) {
            collapsedShown.add(row.hunkIndex)
            displayRows.push({ kind: 'collapsed-hunk', key: `c:${row.hunkIndex}`, hunkIndex: row.hunkIndex, count: entry.hunks[row.hunkIndex].lines.length })
          }
          continue
        }
        displayRows.push(row)
      }
      const effectiveWrap = view === 'split' ? true : wrap
      const visibleRows = embedded || visibleCount >= displayRows.length ? displayRows : displayRows.slice(0, visibleCount)
      const loadGap = async gap => {
        if (!context?.repoPath || expandedGaps.get(gap.key) === 'loading') return
        setExpandedGaps(previous => new Map(previous).set(gap.key, 'loading'))
        try {
          const data = await api('/lines', {
            path: context.repoPath, file: entry.path,
            start: gap.newStart, end: gap.newStart + gap.count - 1,
            staged: context.staged ? '1' : '0', hash: context.hash ?? '',
          })
          setExpandedGaps(previous => new Map(previous).set(gap.key, Array.isArray(data?.lines) ? data.lines : []))
        } catch {
          setExpandedGaps(previous => new Map(previous).set(gap.key, []))
        }
      }
      const renderRow = row => {
        if (row.kind === 'gap') {
          const loaded = expandedGaps.get(row.key)
          if (Array.isArray(loaded)) {
            return loaded.map((text, index) => {
              const newNumber = row.newStart + index
              const oldNumber = newNumber - (row.delta ?? 0)
              if (view === 'split') {
                return h('div', {
                  key: `${row.key}:${index}`,
                  style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', minHeight: 20, borderBottom: `0.5px solid ${T.borderSoft}` },
                },
                  h(DiffHalf, { line: { number: String(oldNumber), text, kind: 'ctx' }, side: 'left', language, highlight, wrap: effectiveWrap }),
                  h(DiffHalf, { line: { number: String(newNumber), text, kind: 'ctx' }, side: 'right', language, highlight, wrap: effectiveWrap }))
              }
              return h('div', {
                key: `${row.key}:${index}`,
                style: { display: 'grid', gridTemplateColumns: '46px 46px 16px minmax(max-content, 1fr)', minHeight: 19, alignItems: 'start' },
              },
                h('span', { style: numberStyle }, String(oldNumber)),
                h('span', { style: numberStyle }, String(newNumber)),
                h('span', { style: { ...numberStyle, textAlign: 'center', color: T.muted } }, ' '),
                h('span', {
                  style: {
                    fontFamily: MONO, fontSize: 11.5, lineHeight: '19px', whiteSpace: wrap ? 'pre-wrap' : 'pre',
                    overflowWrap: wrap ? 'anywhere' : undefined, paddingRight: 18, color: 'inherit',
                  },
                }, h(CodeText, { text, language, highlight, baseColor: 'inherit' })))
            })
          }
          const loading = loaded === 'loading'
          return h('button', {
            key: row.key, type: 'button', disabled: loading || !context?.repoPath,
            onClick: () => loadGap(row),
            style: {
              display: 'block', width: '100%', textAlign: 'left', appearance: 'none', border: 'none',
              background: T.hover, color: T.muted, padding: '3px 16px', fontSize: 11, fontFamily: MONO,
              cursor: loading ? 'default' : 'pointer', opacity: context?.repoPath ? 1 : 0.5,
            },
          }, loading ? t('loading') : t('unchangedLines', { count: row.count }))
        }
        if (row.kind === 'hunk') return h('div', { key: row.key, style: hunkHeaderStyle }, row.label)
        if (row.kind === 'notice') return h('div', { key: row.key, style: { padding: '8px 16px', color: T.muted, fontSize: 11.5 } }, t('truncateNotice'))
        if (row.kind === 'collapsed-hunk') {
          return h('button', {
            key: row.key, type: 'button',
            onClick: () => setExpandedHunks(previous => { const next = new Set(previous); next.add(row.hunkIndex); return next }),
            style: {
              display: 'block', width: '100%', textAlign: 'left', appearance: 'none', border: 'none', cursor: 'pointer',
              background: T.hover, color: T.muted, padding: '8px 16px', fontSize: 11.5, font: 'inherit',
            },
          }, t('diffHunkCollapsed', { count: row.count }))
        }
        if (view === 'split') {
          return h('div', {
            key: row.key,
            style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', minHeight: 20, borderBottom: `0.5px solid ${T.borderSoft}` },
          },
            h(DiffHalf, { line: row.left, side: 'left', language, highlight, wrap: effectiveWrap }),
            h(DiffHalf, { line: row.right, side: 'right', language, highlight, wrap: effectiveWrap }))
        }
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
              fontFamily: MONO, fontSize: 11.5, lineHeight: '19px', whiteSpace: wrap ? 'pre-wrap' : 'pre',
              overflowWrap: wrap ? 'anywhere' : undefined, paddingRight: 18,
              color: isAdd ? T.success : isDel ? T.error : 'inherit', opacity: isDel ? 0.9 : 1,
            },
          }, h(CodeText, { text: row.text, language, highlight, baseColor: isAdd ? T.success : isDel ? T.error : 'inherit' })))
      }
      return h('div', {
        ref: scrollRef,
        onScroll: embedded ? undefined : event => {
          const element = event.currentTarget
          if (visibleCount < displayRows.length && element.scrollHeight - element.scrollTop - element.clientHeight < 800) {
            setVisibleCount(count => Math.min(displayRows.length, count + DIFF_RENDER_STEP))
          }
        },
        style: embedded ? { paddingBottom: 8 } : { overflow: 'auto', flex: 1, minHeight: 0, paddingBottom: 24 },
      },
        visibleRows.map(renderRow),
        !embedded && visibleCount < displayRows.length
          ? h('div', { style: { padding: '8px 16px', fontSize: 11.5, color: T.muted } }, t('moreLines', { shown: visibleCount, total: displayRows.length }))
          : null)
    }

    function DiffHalf({ line, side, language, highlight, wrap = false }) {
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
            fontFamily: MONO, fontSize: 11.5, lineHeight: '19px', whiteSpace: wrap ? 'pre-wrap' : 'pre',
            overflowWrap: wrap ? 'anywhere' : undefined, paddingRight: 14,
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
      const rawUrl = `/git-assistant/api/raw?path=${encodeURIComponent(data.repoPath ?? '')}&file=${encodeURIComponent(selection.path)}`
      const image = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(extension)
      const audio = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension)
      const video = ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)
      if (image) {
        return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' } },
          h('img', { src: rawUrl, alt: selection.path, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }))
      }
      if (audio) {
        return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 } },
          h('audio', { controls: true, src: rawUrl, style: { width: '80%' } }))
      }
      if (video) {
        return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' } },
          h('video', { controls: true, src: rawUrl, style: { maxWidth: '100%', maxHeight: '100%' } }))
      }
      if (extension === 'pdf') {
        return h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
          h('iframe', { src: rawUrl, title: selection.path, style: { flex: 1, width: '100%', height: '100%', border: 'none', background: '#fff' } }))
      }
      if (data.binary) {
        return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: T.muted, fontSize: 12.5, padding: 18 } },
          h('div', null, t('binary')),
          h('div', { style: { fontFamily: MONO, fontSize: 11, color: T.subtle } }, `${selection.path} · ${typeof data.size === 'number' ? `${(data.size / 1024).toFixed(1)} KB` : ''}`))
      }
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

    function AllDiff({ state, view, t, context }) {
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
                ? h(DiffLines, { file: [item.entry], view, t, context })
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

    /** File-history overlay: commits touching one file, click to open that commit's diff. */
    function FileHistoryDialog({ history, t, onClose, onOpenCommit }) {
      const [state, setState] = useState({ phase: 'loading', commits: [], error: null })
      const path = history?.path
      const file = history?.file
      useEffect(() => {
        if (!path || !file) return undefined
        let live = true
        setState({ phase: 'loading', commits: [], error: null })
        api('/file-log', { path, file, limit: 40 })
          .then(data => { if (live) setState({ phase: 'ready', commits: Array.isArray(data?.commits) ? data.commits : [], error: null }) })
          .catch(error => { if (live) setState({ phase: 'error', commits: [], error: String(error?.message ?? error) }) })
        return () => { live = false }
      }, [path, file])
      if (!history) return null
      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 100, background: 'color-mix(in srgb, #000 32%, transparent)',
          backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        },
        onPointerDown: event => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', {
          style: {
            width: 460, maxWidth: '100%', maxHeight: '80vh', background: T.menu, border: `0.5px solid ${T.border}`,
            borderRadius: T.rXl, padding: 18, boxShadow: T.shadowProminent,
            backdropFilter: 'blur(28px) saturate(170%)', display: 'flex', flexDirection: 'column', gap: 10,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { display: 'inline-flex', opacity: 0.65 } }, h(IconHistory)),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('fileHistory')),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button', onClick: onClose,
              style: { appearance: 'none', border: 'none', background: 'transparent', color: T.muted, cursor: 'pointer', fontSize: 14, padding: '0 4px' },
            }, '×')),
          h('div', { style: { fontSize: 11.5, fontFamily: MONO, color: T.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingBottom: 4, borderBottom: `0.5px solid ${T.borderSoft}` } }, file),
          h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 } },
            state.phase === 'loading' ? h('div', { style: { padding: '10px 2px', fontSize: 12, color: T.muted } }, t('loading'))
              : state.phase === 'error' ? h('div', { style: { padding: '10px 2px', fontSize: 12, color: T.error } }, state.error)
              : state.commits.length === 0 ? h('div', { style: { padding: '10px 2px', fontSize: 12, color: T.subtle } }, t('fileHistoryEmpty'))
              : state.commits.map(commit => h('button', {
                  key: commit.oid, type: 'button',
                  onClick: () => { onOpenCommit?.(commit); onClose?.() },
                  style: {
                    appearance: 'none', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '6px 8px',
                    borderRadius: T.rSm, font: 'inherit',
                  },
                  onMouseEnter: event => { event.currentTarget.style.background = T.hover },
                  onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                },
                  h('span', { style: { fontFamily: MONO, fontSize: 10.5, color: T.accent, flex: '0 0 auto' } }, commit.oid.slice(0, 7)),
                  h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, commit.subject || '(no message)'),
                  commit.time ? h('span', { style: { fontSize: 10.5, color: T.subtle, flex: '0 0 auto' } }, formatRelativeTime(commit.time)) : null)))))
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


    /**
     * One small stylesheet for things inline styles cannot express: placeholder tone, textarea
     * caret, and thin scrollbars that suit the card surfaces. Mounted once per panel tree.
     */
    const SURFACE_STYLE_ID = 'dsh-git-assistant-surface'
    function ensureSurfaceStyle() {
      if (typeof document === 'undefined') return undefined
      if (document.getElementById(SURFACE_STYLE_ID)) return undefined
      const style = document.createElement('style')
      style.id = SURFACE_STYLE_ID
      style.textContent = `
        .ga-panel textarea::placeholder,
        .ga-panel input::placeholder { color: var(--dsw-alias-label-caption, #adb2b8); opacity: 1; }
        .ga-panel textarea, .ga-panel input { caret-color: var(--dsw-alias-link, #4176e6); }
        .ga-panel ::-webkit-scrollbar { width: 9px; height: 9px; }
        .ga-panel ::-webkit-scrollbar-thumb {
          background: var(--dsw-alias-scrollbar-bg-l1, #e5e5e5); border-radius: 6px;
          border: 2px solid transparent; background-clip: padding-box;
        }
        .ga-panel ::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1, #d4d4d4); background-clip: padding-box; }
        .ga-panel ::-webkit-scrollbar-track { background: transparent; }
      `
      document.head.appendChild(style)
      return () => { try { style.remove() } catch { /* gone */ } }
    }

    /* ── main panel ─────────────────────────────────────────────────── */

    function Panel({ t, ctx, sessionId, renderFactorySlot, inputActions }) {
      useCodePalette()
      const [repositories, refreshRepositories] = useRepositories()
      const [storedId, setStoredId] = useSharedState('repositoryId', readStoredRepository)
      const [dataVersion, setDataVersion] = useState(0)
      const bump = useCallback(() => setDataVersion(value => value + 1), [])
      const [mode, setMode] = useSharedState('mode', 'changes')
      const [selection, setSelection] = useSharedState('selection', null)
      const [view, setView] = useSharedState('view', 'unified')
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
      const bodyRef = useRef(null)
      const [bodyWidth, setBodyWidth] = useState(0)
      useEffect(() => {
        const element = bodyRef.current
        if (!element || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(entries => {
          for (const entry of entries) setBodyWidth(Math.round(entry.contentRect.width))
        })
        observer.observe(element)
        return () => observer.disconnect()
      }, [])
      const [hoveredKey, setHoveredKey] = useState(undefined)
      const [picked, setPicked] = useState(() => new Set())
      const [graphPath, setGraphPath] = useState(undefined)
      const [wrap, setWrap] = useState(false)
      const [commitPickerOpen, setCommitPickerOpen] = useState(false)
      const commitPickerRef = useRef(null)
      const [allFilesCollapsed, setAllFilesCollapsed] = useState(false)
      const [issuesState, setIssuesState] = useSharedState('issuesState', 'open')
      const [issuesSearch, setIssuesSearch] = useSharedState('issuesSearch', '')
      const [issuesQuery, setIssuesQuery] = useState('')
      const [issueNumber, setIssueNumber] = useSharedState('issueNumber', undefined)
      const [issuesVersion, setIssuesVersion] = useState(0)
      const [issuesLimit, setIssuesLimit] = useState(60)
      const [issuesWidth, setIssuesWidth] = useState(480)
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
      useRepoEvents(active?.path, useCallback(() => {
        if (active?.path) refreshStatusPath(active.path)
        bump()
      }, [active?.path, bump]))
      const repositoryChoices = useMemo(() => {
        const unique = new Map()
        for (const repository of repositories.items) {
          const current = unique.get(repository.repoName)
          if (!current || repository.isMain) unique.set(repository.repoName, repository)
        }
        return [...unique.values()]
      }, [repositories.items])

      const [status, refreshStatus] = useStatus(active, dataVersion)
      const branches = useBranches(active, dataVersion)
      const files = useFiles(active, dataVersion, mode === 'files')
      const [diff, refreshDiff] = useDiff(selection?.repoPath ? { path: selection.repoPath } : active, selection, dataVersion)
      const preview = useFilePreview(selection?.repoPath ? { path: selection.repoPath } : active, selection)
      const [allDiff, refreshAllDiff] = useAllDiffs(active, selection, status.data, dataVersion)
      const [worktrees, refreshWorktrees] = useWorktrees(active, dataVersion)
      const [localCommits, refreshLocalCommits] = useLocalCommits(active, commitPickerOpen)
      const [commitPatch, refreshCommitPatch] = useCommitPatch(active, selection)
      const issues = useIssues(active, mode === 'issues', issuesState, issuesQuery, issuesLimit, issuesVersion)
      const [issueNonce, bumpIssueNonce] = useState(0)
      const issueDetail = useIssueDetail(active, issueNumber, issueNonce)
      const issueComments = useIssueComments(active, issueNumber, issueNonce)
      const [fileHistory, setFileHistory] = useState(null)
      useEffect(() => {
        if (!issues.stale) return undefined
        const timer = setTimeout(() => setIssuesVersion(value => value + 1), 1200)
        return () => clearTimeout(timer)
      }, [issues.stale, issues.issues.length])
      useEffect(() => {
        if (mode !== 'issues' || !active?.path) return undefined
        let live = true
        const touch = () => { if (live) api('/issues/touch', { path: active.path }).catch(() => {}) }
        touch()
        const timer = setInterval(touch, 60000)
        return () => { live = false; clearInterval(timer) }
      }, [mode, active?.path])

      useEffect(() => {
        if (!commitPickerOpen) return undefined
        const close = event => { if (commitPickerRef.current && !commitPickerRef.current.contains(event.target)) setCommitPickerOpen(false) }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
      }, [commitPickerOpen])
      useEffect(() => {
        if (!selection || selection.kind !== 'commit-files') return
        setWrap(false)
        setAllFilesCollapsed(false)
      }, [selection?.hash])
      useEffect(() => {
        const timer = setTimeout(() => setIssuesQuery(issuesSearch.trim()), 350)
        return () => clearTimeout(timer)
      }, [issuesSearch])
      useEffect(() => { setIssuesLimit(60) }, [issuesState, issuesQuery, active?.path])
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
      useEffect(() => ensureSurfaceStyle(), [])
      const postIssueComment = useCallback(async body => {
        if (!active?.path || !issueNumber) throw new Error('no issue selected')
        try {
          await apiPost('/issue-comment', { path: active.path, number: issueNumber, body })
          notify(t('commentDone'))
        } catch (error) {
          notify(String(error?.message ?? error), 'error')
          throw error
        }
        bumpIssueNonce(value => value + 1)
        setIssuesVersion(value => value + 1)
      }, [active?.path, issueNumber, notify, t])
      const toggleIssueState = useCallback(async state => {
        if (!active?.path || !issueNumber) throw new Error('no issue selected')
        try {
          await apiPost('/issue-state', { path: active.path, number: issueNumber, state })
          notify(state === 'closed' ? t('issueClosedOk') : t('issueReopenedOk'))
        } catch (error) {
          notify(String(error?.message ?? error), 'error')
          throw error
        }
        bumpIssueNonce(value => value + 1)
        setIssuesVersion(value => value + 1)
      }, [active?.path, issueNumber, notify, t])

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
      const worktreeFilesCards = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '10px 10px 12px' } },
        worktrees.items.map(item => h(WorktreeFilesCard, {
          key: item.path, t, item, defaultOpen: item.path === active?.path || Boolean(item.isMain), visible: mode === 'files',
          selectedPath: selection?.kind === 'file' ? selection.path : undefined,
          onSelect: path => setGraphPath(path),
          onNotify: notify,
          onOpen: (file, repoPath) => { setGraphPath(repoPath); setSelection({ kind: 'file', path: file.path, repoPath }) },
        })))
      const worktreeCards = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 10px 44px' } },
        worktrees.items.map(item => h(WorktreeCard, {
          key: item.path, t, item, defaultOpen: item.path === active?.path || Boolean(item.isMain), visible: mode === 'changes',
          selectedPath: selection?.kind === 'diff' ? selection.path : undefined,
          onNotify: notify,
          onChanged: () => { refreshWorktrees(); bump() },
          onDiscardAll: paths => discardPaths(paths),
          onSelect: path => setGraphPath(path),
          onOpen: (file, repoPath) => { setGraphPath(repoPath); setSelection({ kind: 'diff', path: file.path, staged: Boolean(file.__staged), repoPath }) },
          onFileHistory: (file, repoPath) => setFileHistory({ path: repoPath, file: file.path, phase: 'loading', commits: [], error: null }),
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
      const effectiveLeftWidth = mode === 'issues' ? issuesWidth : leftWidth
      /**
       * The right-hand pane must keep enough room for its toolbar (commit picker, wrap, collapse,
       * view switch) to stay on one line, so the splitter's upper bound follows the measured body
       * width instead of a fixed 560/760. A narrow host (right sidebar, split conversation view)
       * therefore simply cannot squeeze the viewer into an unusable sliver.
       */
      const RIGHT_PANE_MIN = mode === 'issues' ? 300 : 340
      const LEFT_PANE_MAX = mode === 'issues' ? 760 : 560
      const leftPaneMax = bodyWidth > 0
        ? Math.max(240, Math.min(LEFT_PANE_MAX, bodyWidth - 14 - RIGHT_PANE_MIN))
        : LEFT_PANE_MAX
      useEffect(() => {
        if (bodyWidth <= 0) return
        if (leftWidth > leftPaneMax) setLeftWidth(leftPaneMax)
        if (issuesWidth > leftPaneMax) setIssuesWidth(leftPaneMax)
      }, [bodyWidth, leftPaneMax, leftWidth, issuesWidth])
      const startResize = useCallback(event => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = mode === 'issues' ? issuesWidth : leftWidth
        const applyWidth = mode === 'issues' ? setIssuesWidth : setLeftWidth
        const maxWidth = leftPaneMax
        const move = moveEvent => applyWidth(Math.min(maxWidth, Math.max(240, startWidth + moveEvent.clientX - startX)))
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
      }, [leftWidth, issuesWidth, mode, leftPaneMax])

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
        className: 'ga-panel',
        style: {
          display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: T.text,
          fontSize: 13, lineHeight: 1.5, position: 'relative', overflow: 'hidden', fontFamily: T.sans,
          letterSpacing: '0.002em', background: T.canvas,
        },
      },
        // ── title bar ──────────────────────────────────────────
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 6, minHeight: 46,
            padding: '6px 12px', margin: '10px 12px 0', borderRadius: T.rMd, background: T.surface,
            boxShadow: T.edge, flex: '0 0 auto', position: 'relative', zIndex: 2, minWidth: 0,
          },
        },
          h('span', { style: { display: 'inline-flex', color: T.ink2 } }, h(GitIcon, { size: 15 })),
          h('span', { style: { fontSize: 14, lineHeight: '20px', fontWeight: 600, letterSpacing: '0.005em', whiteSpace: 'nowrap' } }, t('title')),
          h('span', { 'aria-hidden': true, style: { color: T.subtle } }, '·'),
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
              h(Chevron, { open: menuOpen, size: 9 })),
            menuOpen ? h('div', {
              style: {
                position: 'absolute', top: '100%', left: 0, marginTop: 8, zIndex: 40, width: 320,
                maxHeight: 460, overflowY: 'auto', background: T.menu, border: `0.5px solid ${T.border}`,
                borderRadius: T.rLg, padding: 6, boxShadow: T.shadowProminent,
                backdropFilter: 'blur(28px) saturate(170%)',
              },
            }, ...repositoryChoices.map(repository => h('button', {
              key: repository.repoName, type: 'button',
              onClick: () => { setStoredId(repository.id); setMenuOpen(false) },
              style: {
                appearance: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: T.rSm,
                font: 'inherit', color: 'inherit',
                background: repository.repoName === active?.repoName ? T.selected : 'transparent',
              },
              onMouseEnter: event => { if (repository.repoName !== active?.repoName) event.currentTarget.style.background = T.hover },
              onMouseLeave: event => { if (repository.repoName !== active?.repoName) event.currentTarget.style.background = 'transparent' },
            },
              h('span', {
                title: repository.path,
                style: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              }, repository.repoName),
              repository.repoName === active?.repoName
                ? h('span', { style: { fontSize: 11, color: T.accent } }, '✓')
                : null))) : null),

          // branch chip + menu
          active ? h('div', { ref: branchRef, style: { position: 'relative', minWidth: 0 } },
            h('button', {
              type: 'button', onClick: () => setBranchMenuOpen(open => !open), title: t('branches'),
              style: {
                appearance: 'none', border: `1px solid ${branchMenuOpen ? T.border : T.borderSoft}`,
                background: branchMenuOpen ? T.surfaceHover : T.chip,
                color: T.ink2, font: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: T.pill,
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
          ),

        // ── body ────────────────────────────────────────────────
        h('div', { ref: bodyRef, style: { display: 'flex', flex: 1, minHeight: 0, gap: 8, padding: '8px 12px 12px', minWidth: 0, position: 'relative' } },
          // left column
          h('div', {
            style: {
              width: effectiveLeftWidth, flex: `0 0 ${effectiveLeftWidth}px`, minWidth: 240, borderRadius: T.rMd, background: T.surface,
              boxShadow: T.edge,
              display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
            },
          },
            // mode tabs
            h('div', { style: { padding: '10px 10px 4px', borderBottom: `1px solid ${T.borderSoft}` } },
              h('div', {
                style: {
                  display: 'flex', gap: 2, padding: 3, borderRadius: 10,
                  background: T.chip, border: `1px solid ${T.borderSoft}`,
                },
              },
                ['changes', 'files', 'issues'].map(value => h('button', {
                  key: value, type: 'button', onClick: () => setMode(value),
                  style: {
                    appearance: 'none', border: 'none', cursor: 'pointer', font: 'inherit', flex: 1,
                    fontSize: 12, fontWeight: mode === value ? 600 : 500,
                    height: 26, padding: '0 10px', borderRadius: 7,
                    background: mode === value ? T.surface : 'transparent',
                    color: mode === value ? T.text : T.ink2,
                    boxShadow: mode === value ? `${T.ring}, 0 1px 2px rgba(0,0,0,.05)` : 'none',
                    transition: `background .18s ${T.ease}, color .18s ${T.ease}`,
                  },
                  onMouseEnter: event => { if (mode !== value) event.currentTarget.style.color = T.text },
                  onMouseLeave: event => { if (mode !== value) event.currentTarget.style.color = T.ink2 },
                }, value === 'changes' ? t('changesTab') : value === 'files' ? t('filesTab') : t('issuesTab'))))),

            h('div', { style: { display: mode === 'changes' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 } }, worktreeCards),
            h('div', { style: { display: mode === 'files' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 } }, worktreeFilesCards),
            h('div', { style: { display: mode === 'issues' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 } },
              h(IssueDetailPane, {
                t, state: issueDetail, comments: issueComments,
                onNavigate: setIssueNumber,
                onClose: () => setIssueNumber(undefined),
                onCommentPost: postIssueComment,
                onToggleState: toggleIssueState,
              })),
          ),

          // commit graph drawer docked over the workbench column
          graphDrawer,

          // resize handle between the two cards
          h('div', {
            role: 'separator', 'aria-orientation': 'vertical', title: t('resize'), onPointerDown: startResize,
            style: { flex: '0 0 6px', alignSelf: 'stretch', cursor: 'col-resize', borderRadius: 3, transition: `background .15s ${T.ease}` },
            onMouseEnter: event => { event.currentTarget.style.background = T.borderSoft },
            onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
          }),

          // right column: document card or issues board
          mode === 'issues' ? h(IssuesPane, {
            t, state: issues, selectedNumber: issueNumber,
            onSelect: setIssueNumber, search: issuesSearch, onSearch: setIssuesSearch,
            stateFilter: issuesState, onStateFilter: setIssuesState,
            onRefresh: () => setIssuesVersion(value => value + 1),
            onLoadMore: () => setIssuesLimit(value => value + 60),
          }) : h('div', {
            style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 },
          },
            h('div', {
              style: {
                flex: '0 0 auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, rowGap: 6,
                minHeight: 40, padding: '6px 8px', minWidth: 0, borderRadius: T.rMd, background: T.surface,
                boxShadow: T.edge, position: 'relative', zIndex: 30,
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto' } },
              h('div', { ref: commitPickerRef, style: { position: 'relative', minWidth: 0, flex: '0 1 auto' } },
                h('button', {
                  type: 'button', title: t('selectCommit'),
                  onClick: () => { setCommitPickerOpen(open => !open); if (!commitPickerOpen) refreshLocalCommits() },
                  style: {
                    appearance: 'none', border: '1px solid transparent', boxShadow: T.ring,
                    background: commitPickerOpen ? T.chip : T.surface, color: T.ink2, height: 26,
                    padding: '0 10px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, maxWidth: 320,
                  },
                },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    selection?.kind === 'commit-files'
                      ? (selection.subject || selection.hash.slice(0, 7))
                      : t('selectCommit')),
                  h(Chevron, { open: commitPickerOpen, size: 8 })),
                commitPickerOpen ? h('div', {
                  style: {
                    position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 80, width: 380,
                    maxHeight: 360, overflowY: 'auto', background: T.menu, border: `0.5px solid ${T.border}`,
                    borderRadius: T.rMd, padding: 4, boxShadow: T.shadowProminent,
                    backdropFilter: 'blur(24px) saturate(160%)',
                  },
                },
                  h('button', {
                    type: 'button', onClick: () => { setSelection(null); setCommitPickerOpen(false) },
                    style: { display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: '5px 8px', borderRadius: T.rSm, fontSize: 11.5, gap: 6 },
                    onMouseEnter: event => { event.currentTarget.style.background = T.hover },
                    onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                  }, t('workspaceChanges')),
                  h('div', { style: { padding: '4px 8px 3px', fontSize: 10, color: T.subtle } }, t('unpushedCommits')),
                  localCommits.phase === 'loading'
                    ? h('div', { style: { padding: '6px 10px', fontSize: 11, color: T.muted } }, t('loading'))
                    : localCommits.commits.length === 0
                      ? h('div', { style: { padding: '6px 10px', fontSize: 11, color: T.muted } }, t('noUnpushedCommits'))
                      : localCommits.commits.map(commit => h('button', {
                          key: commit.oid, type: 'button',
                          onClick: () => {
                            setSelection({ kind: 'commit-files', repoPath: active?.path, hash: commit.oid, subject: commit.subject })
                            setCommitPickerOpen(false)
                          },
                          style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: '5px 8px', borderRadius: T.rSm, fontSize: 11.5 },
                          onMouseEnter: event => { event.currentTarget.style.background = T.hover },
                          onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                        },
                          h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, commit.subject || '(no message)'),
                          h('span', { style: { fontFamily: MONO, fontSize: 10, color: T.subtle, whiteSpace: 'nowrap' } }, formatRelativeTime(commit.time)))))
                : null),
              selection?.kind === 'commit-files'
                ? h('span', {
                    style: {
                      fontFamily: MONO, fontSize: 10.5, color: T.muted, whiteSpace: 'nowrap',
                      border: `0.5px solid ${T.border}`, borderRadius: T.pill, padding: '1px 8px',
                    },
                  }, selection.hash.slice(0, 7))
                : null,
              selection?.kind === 'commit-files' && commitPatch.data?.stats
                ? h('span', { style: { display: 'inline-flex', gap: 7, fontFamily: MONO, fontSize: 10.5, whiteSpace: 'nowrap' } },
                    h('span', { style: { color: T.success } }, `+${commitPatch.data.stats.additions}`),
                    h('span', { style: { color: T.error } }, `−${commitPatch.data.stats.deletions}`))
                : null,
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto', marginLeft: 'auto' } },
              h('button', {
                type: 'button', onClick: () => setWrap(value => !value), title: t('wrapLines'),
                style: {
                  appearance: 'none', border: '1px solid transparent', whiteSpace: 'nowrap', cursor: 'pointer', height: 26, padding: '0 10px',
                  borderRadius: 7, fontSize: 11.5, fontWeight: 500, font: 'inherit',
                  color: wrap ? T.text : T.ink2, background: wrap ? T.chip : T.surface, boxShadow: wrap ? 'none' : T.ring,
                },
              }, t('wrapLines')),
              h('button', {
                type: 'button', onClick: () => setAllFilesCollapsed(value => !value),
                disabled: selection?.kind !== 'commit-files', title: allFilesCollapsed ? t('expandAllFiles') : t('collapseAllFiles'),
                style: {
                  appearance: 'none', border: '1px solid transparent', whiteSpace: 'nowrap', cursor: selection?.kind === 'commit-files' ? 'pointer' : 'default',
                  height: 26, padding: '0 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 500, font: 'inherit',
                  color: T.ink2, background: allFilesCollapsed ? T.chip : T.surface,
                  boxShadow: allFilesCollapsed ? 'none' : T.ring,
                  opacity: selection?.kind === 'commit-files' ? 1 : 0.4,
                },
              }, allFilesCollapsed ? t('expandAllFiles') : t('collapseAllFiles')),
              h('span', { style: { display: 'inline-flex', padding: 2, borderRadius: 8, background: T.chip, boxShadow: `inset 0 0 0 1px ${T.borderSoft}` } },
                ['unified', 'split'].map(value => h('button', {
                  key: value, type: 'button', onClick: () => setView(value),
                  style: {
                    appearance: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: view === value ? 600 : 500, whiteSpace: 'nowrap',
                    height: 22, padding: '0 10px', borderRadius: 6,
                    background: view === value ? T.surface : 'transparent',
                    color: view === value ? T.text : T.ink2,
                    boxShadow: view === value ? T.ring : 'none',
                    transition: `background .18s ${T.ease}, color .18s ${T.ease}`,
                  },
                }, t(value)))),
              )),

            h('div', {
              style: {
                flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative',
                borderRadius: T.rMd, background: T.surface, boxShadow: T.edge, overflow: 'hidden',
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
            selection && selection.kind !== 'commit-files' ? h('div', {
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
                if (selection.kind === 'commit-files') {
                  const subject = commitPatch.data?.commit?.subject ?? selection.subject ?? ''
                  return h('span', { style: { fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, title: subject },
                    h('span', { style: { fontWeight: 500 } }, subject))
                }
                const parts = splitPath(selection.path)
                return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, title: selection.path },
                  h(FileGlyph, { name: parts.name, kind: 'file' }),
                  h('span', { style: { opacity: 0.45 } }, parts.dir),
                  h('span', { style: { fontWeight: 500 } }, parts.name))
              })(),
              selection.kind !== 'file'
                ? h('span', { style: { fontSize: 10.5, color: T.muted, border: `0.5px solid ${T.border}`, borderRadius: T.pill, padding: '1px 8px', whiteSpace: 'nowrap', fontFamily: selection.kind === 'commit-diff' || selection.kind === 'commit-files' ? MONO : undefined } },
                    selection.kind === 'commit-diff' || selection.kind === 'commit-files' ? selection.hash.slice(0, 7) : selection.staged ? t('staged') : t('changes'))
                : h('span', { style: { fontSize: 10.5, opacity: 0.5, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' } },
                    t('readOnly')),
              h('span', { style: { flex: 1 } }),
              selection.kind === 'diff' || selection.kind === 'commit-diff'
                ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 1, flex: '0 0 auto' } },
                    h(IconAction, {
                      label: t('copyPath'),
                      onClick: () => {
                        copyToClipboard(selection.path)
                          .then(() => notify(t('copiedPath')))
                          .catch(() => notify(t('actionFailed'), 'error'))
                      },
                    }, h(IconCopy)),
                    h(IconAction, { label: t('revealInFinder'), onClick: () => { apiPost('/reveal', { path: selection.repoPath ?? active?.path, file: selection.path }).catch(() => {}) } }, h(IconFolder)),
                    h(IconAction, { label: t('openDefaultApp'), onClick: () => { apiPost('/open', { path: selection.repoPath ?? active?.path, file: selection.path }).catch(() => {}) } }, h(IconExternal)),
                    h(IconAction, {
                      label: t('fileHistory'),
                      onClick: () => setFileHistory({ path: selection.repoPath ?? active?.path, file: selection.path }),
                    }, h(IconHistory)))
                : null,
              selection.kind !== 'file'
                ? h('span', { style: { display: 'inline-flex', gap: 7, fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' } },
                    (() => {
                      if (selection.kind === 'diff' || selection.kind === 'commit-diff') {
                        const file = diff.data?.files?.[0]
                        return file ? [h('span', { key: 'a', style: { color: T.success } }, `+${file.additions ?? 0}`), h('span', { key: 'd', style: { color: T.error } }, `−${file.deletions ?? 0}`)] : null
                      }
                      if (selection.kind === 'commit-files') {
                        const stats = commitPatch.data?.stats
                        return [h('span', { key: 'a', style: { color: T.success } }, `+${stats?.additions ?? 0}`), h('span', { key: 'd', style: { color: T.error } }, `−${stats?.deletions ?? 0}`)]
                      }
                      const totals = allDiff.entries.reduce((sum, item) => ({ add: sum.add + (item.entry?.additions ?? 0), del: sum.del + (item.entry?.deletions ?? 0) }), { add: 0, del: 0 })
                      return [h('span', { key: 'a', style: { color: T.success } }, `+${totals.add}`), h('span', { key: 'd', style: { color: T.error } }, `−${totals.del}`)]
                    })())
                : null,
              )
              : null,

            selection
              ? selection.kind === 'diff' || selection.kind === 'commit-diff'
                ? diff.phase === 'loading'
                  ? h('div', { style: { padding: 18, color: T.muted, fontSize: 12.5 } }, t('loading'))
                  : diff.phase === 'error'
                    ? h('div', { style: { padding: 18, color: T.error, fontSize: 12.5 } }, diff.error)
                    : h(DiffLines, {
                        file: diff.data?.files ?? [], view, t, wrap,
                        context: {
                          repoPath: selection.repoPath ?? active?.path,
                          staged: Boolean(selection.staged),
                          hash: selection.kind === 'commit-diff' ? selection.hash : undefined,
                        },
                      })
                : selection.kind === 'all'
                  ? h(AllDiff, { state: allDiff, view, t, context: { repoPath: selection.repoPath ?? active?.path, staged: Boolean(selection.staged) } })
                  : selection.kind === 'commit-files'
                    ? h(CommitFilesView, { state: commitPatch, view, wrap, t, collapseMode: allFilesCollapsed, context: { repoPath: selection.repoPath ?? active?.path, hash: selection.hash } })
                  : h(FilePreview, { state: { ...preview, data: preview.data ? { ...preview.data, repoPath: selection.repoPath ?? active?.path } : null }, selection, t })
              : h('div', {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28, textAlign: 'center' },
                },
                  h('div', {
                    style: {
                      display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56,
                      borderRadius: 16, background: T.surfaceAlt, boxShadow: T.ring, color: T.muted,
                    },
                  },
                    h('svg', { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
                      h('path', { d: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' }),
                      h('path', { d: 'M9 8h6M9 12h6M9 16h4' }))),
                  h('div', { style: { fontSize: 15, lineHeight: '22px', fontWeight: 600, color: T.text } }, t('emptyDiff')),
                  h('div', { style: { fontSize: 12, color: T.muted, maxWidth: 320, lineHeight: '20px' } }, t('emptyDiffHint')))))),

        h(Dialog, { dialog, onClose: () => setDialog(null) }),
        h(FileHistoryDialog, {
          history: fileHistory, t,
          onClose: () => setFileHistory(null),
          onOpenCommit: commit => {
            if (!fileHistory?.path) return
            setGraphPath(fileHistory.path)
            setMode('changes')
            setSelection({ kind: 'commit-diff', repoPath: fileHistory.path, hash: commit.oid, path: fileHistory.file })
          },
        }),
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
      return h(PanelBoundary, { t }, h(Panel, { t, ctx, sessionId, renderFactorySlot, inputActions }))
    }

    /* ── registration ───────────────────────────────────────────────── */

    const inject = ['slots', 'locale', 'sessions']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'dsh-git-assistant: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', key: ID, locale: NS },
        props => h(PanelBoundary, { t: props?.t ?? t }, h(Panel, { t: props?.t ?? t, ctx, renderFactorySlot: props?.renderFactorySlot, inputActions: props?.inputActions }))))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: ID, order: 24, label: () => t('label'), locale: NS },
        props => h(GitIcon, { size: props?.size })))
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: ID, order: 24, locale: NS, label: () => t('label') },
        props => h(ConversationGitView, { t: props?.t ?? t, ctx, sessionId: props?.sessionId, renderFactorySlot: props?.renderFactorySlot, inputActions: props?.inputActions })))
      // Right-sidebar seat: same workbench as a per-session right column.
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: ID, locale: NS },
        props => h(PanelBoundary, { t: props?.t ?? t }, h(Panel, { t: props?.t ?? t, ctx, sessionId: props?.sessionId, renderFactorySlot: props?.renderFactorySlot, inputActions: props?.inputActions }))))
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
