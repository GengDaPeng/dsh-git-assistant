import { JSDOM } from 'jsdom'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:62528', pretendToBeVisual: true })
globalThis.window = dom.window
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL = dom.window.URL

const repos = [
  { id: '/repo', path: '/repo', name: 'repo', repoName: 'repo', branch: 'main', isMain: true },
  { id: '/repo-wt', path: '/repo-wt', name: 'wt', repoName: 'repo', branch: 'feat/x', isMain: false },
]
const status = { branch: 'main', ahead: 0, behind: 2, staged: [{ path: 'staged.ts', status: 'M' }], unstaged: [{ path: 'a.ts', status: 'M' }, { path: 'src/b.ts', status: 'M' }], untracked: [], detached: false }
const worktrees = { worktrees: [
  { path: '/repo', branch: 'main', ahead: 0, behind: 0, changes: 1, isMain: true },
  { path: '/repo-wt', branch: 'feat/x', ahead: 2, behind: 3, changes: 0, isMain: false },
] }
const fetched = []
globalThis.fetch = async url => {
  const href = String(url)
  fetched.push(href)
  const payload = href.includes('/repositories') ? { repositories: repos, workspaces: [{ id: 'ws', name: 'ws', path: '/repo' }] }
    : href.includes('/worktrees') ? worktrees
    : href.includes('/status') ? status
    : href.includes('/file-log') ? { file: 'a.ts', commits: [{ oid: 'abc123', author: 'A', time: 1700000000, subject: 'touched a' }] }
    : href.includes('/stashes') ? { stashes: [{ index: 0, selector: 'stash@{0}', time: 1700000000, subject: '测试 stash' }] }
    : href.includes('/fs/list') ? (new dom.window.URL(href).searchParams.get('dir') === 'src'
        ? { entries: [{ name: 'b.ts', path: 'src/b.ts', kind: 'file' }], truncated: false }
        : { entries: [{ name: 'src', path: 'src', kind: 'dir' }, { name: 'a.ts', path: 'a.ts', kind: 'file' }, { name: 'icon.svg', path: 'icon.svg', kind: 'file' }], truncated: false })
    : href.includes('/files') ? { files: ['a.ts', 'src/b.ts', 'images/logo.png', 'icon.svg'], total: 4, truncated: false }
    : href.includes('/file') ? { path: 'a.ts', content: 'hello', size: 5, binary: false }
    : href.includes('/branches') ? { branches: [
        { name: 'main', current: true, upstream: 'origin/main', worktree: null },
        { name: 'feat/x', current: false, worktree: '/repo-wt', worktreeName: 'repo-wt' },
        { name: 'free/branch', current: false, worktree: null },
      ] }
    : href.includes('/issues') ? { repo: { owner: 'x', name: 'y' }, issues: [
        { number: 101, title: '父议题标题', state: 'open', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [], comments: 2, updatedAt: '2026-11-10T10:00:00Z', url: 'https://github.com/x/y/issues/101', parent: null, children: [{ number: 102, title: '子议题标题', state: 'open' }] },
        { number: 102, title: '子议题标题', state: 'open', labels: [], assignees: [], comments: 0, updatedAt: '2026-11-09T10:00:00Z', url: 'https://github.com/x/y/issues/102', parent: { number: 101, title: '父议题标题', state: 'open' }, children: [] },
        { number: 103, title: '无关议题', state: 'open', labels: [], assignees: [], comments: 0, updatedAt: '2026-11-08T10:00:00Z', url: 'https://github.com/x/y/issues/103', parent: null, children: [] },
      ] }
    : href.includes('/issue-comments') ? { comments: [{ id: 1, author: 'bob', body: '评论 **内容**', createdAt: '2026-11-09T10:00:00Z', url: '' }] }
    : href.includes('/issue?') ? { repo: { owner: 'x', name: 'y' }, issue: { number: 101, title: '父议题标题', state: 'open', body: '## 小节标题\n\n这是 **加粗** 和 [链接](https://example.com)。', labels: [{ name: 'bug', color: 'd73a4a' }], assignees: [], author: 'a', comments: 2, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-10T10:00:00Z', url: 'https://github.com/x/y/issues/101', milestone: null, parent: null, children: [{ number: 102, title: '子议题标题', state: 'open' }] } }
    : href.includes('/local-commits') ? { commits: [{ oid: 'abc1234def', author: 'A', time: 1700000000, subject: 'test commit' }] }
    : href.includes('/commit-patch') ? { commit: { hash: 'abc1234def', subject: 'test commit' }, stats: { files: 2, additions: 3, deletions: 1 }, files: [
        { path: 'a.ts', status: 'M', additions: 2, deletions: 1, hunks: [{ header: '@@ -1 +1 @@', lines: [{ type: 'add', text: 'added line', oldNumber: 1, newNumber: 1 }] }] },
        { path: 'src/b.ts', status: 'M', additions: 1, deletions: 0, hunks: [{ header: '@@ -1 +1 @@', lines: [{ type: 'add', text: 'another line', oldNumber: 1, newNumber: 1 }] }] },
      ] }
    : href.includes('/issue-comment') || href.includes('/issue-state') ? { ok: true }
    : href.includes('/commit-diff') ? { file: 'a.ts', hash: 'abc1234def', files: [{ path: 'a.ts', binary: false, newFile: false, deletedFile: false, additions: 1, deletions: 0, hunks: [{ header: '@@ -1 +1 @@', lines: [{ type: 'add', text: 'added line', oldNumber: 1, newNumber: 1 }] }] }] }
    : href.includes('/commit') ? { commit: { hash: 'abc1234def', author: 'A', email: 'a@x', time: 1700000000, subject: 'merge commit', body: 'detail body' }, files: [{ path: 'a.ts', status: 'M', additions: 3, deletions: 1 }, { path: 'src/b.ts', status: 'M', additions: 1, deletions: 0 }], stats: { files: 2, additions: 4, deletions: 1 } }
    : href.includes('/graph') ? { commits: [
        { oid: 'abc1234def', parents: ['fff999', 'eee888'], author: 'A', time: 1700000000, subject: 'merge commit', refs: ['master'] },
        { oid: 'fff999aaa', parents: ['ddd777'], author: 'B', time: 1699990000, subject: 'older commit', refs: [] },
        { oid: 'eee888bbb', parents: ['ddd777'], author: 'C', time: 1699980000, subject: 'side branch', refs: [] },
        { oid: 'ddd777ccc', parents: [], author: 'D', time: 1699970000, subject: 'base commit', refs: [] },
      ] }
    : {}
  return { ok: true, json: async () => payload }
}
const loaded = []
dom.window.__ModuleLoader__ = { load: definition => loaded.push(definition) }

await import('../src/client.js')
const exported = loaded[0].factory(require)
const DICT = exported.__internals.DICT
const LOCALE = process.env.LOCALE || 'zh'
const translate = (key, values) => {
  let text = DICT[LOCALE]?.[key] ?? key
  if (values) for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
const calls = []
const ctx = {
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: { inject(_n, fn) { return fn() ?? (() => {}) }, register(options, component) { calls.push({ options, component }); return () => {} } },
  sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) }, refresh: () => {} },
}
exported.apply(ctx)
const view = calls.find(r => r.options?.name === 'conversation.view')

const errors = []
const originalError = console.error
console.error = (...args) => { errors.push(args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ')); originalError(...args) }

const Boundary = class extends React.Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? React.createElement('pre', { id: 'boundary' }, String(this.state.error?.stack ?? this.state.error)) : this.props.children }
}
const { act } = require('react-dom/test-utils')
const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(Boundary, null, React.createElement(view.component, { t: translate, sessionId: 'session-test' }))) })
await act(async () => { await new Promise(r => setTimeout(r, 100)) })
const drawer = [...document.querySelectorAll('div')].filter(d => d.textContent.trim() === translate('graphTitle')).pop()
console.log('drawer found:', Boolean(drawer))
if (drawer) await act(async () => { drawer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 300)) })
console.log('SVG shapes:', document.querySelectorAll('svg line, svg path, svg circle').length)
console.log('GRAPH-TEXT:', (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 600))
console.log('SVG widths:', [...document.querySelectorAll('svg')].slice(0, 3).map(svg => svg.getAttribute('width')))
const wtHeader = [...document.querySelectorAll('div')].filter(d => d.textContent.trim().startsWith('repo-wt')).pop()
if (wtHeader) await act(async () => { wtHeader.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 300)) })
const commitRow = [...document.querySelectorAll('div')].filter(d => d.textContent.includes('merge commit') && d.style.cursor === 'pointer').pop()
if (commitRow) await act(async () => { commitRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 300)) })
console.log('NODE FILLS:', JSON.stringify([...document.querySelectorAll('svg circle')].map(c => c.getAttribute('fill')).slice(0, 8)))
console.log('BARS:', JSON.stringify([...document.querySelectorAll('span')].filter(el => el.style.position === 'absolute' && el.style.top === '0px' && el.style.bottom === '0px').map(el => ({ bg: el.style.background, left: el.style.left, w: el.style.width }))))
console.log('EXPANDED:', (document.body.textContent || '').includes('a.ts'))
const fileRow = [...document.querySelectorAll('div')].filter(d => d.textContent.trim().startsWith('M') || d.textContent.includes('a.ts')).pop()
if (fileRow) await act(async () => { fileRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 300)) })
console.log('COMMIT-DIFF FETCHED:', fetched.some(h => h.includes('/commit-diff')))
console.log('GRAPH PATHS:', fetched.filter(h => h.includes('/graph')).map(h => new dom.window.URL(h).searchParams.get('path')))
const unstageAll = [...document.querySelectorAll('button')].find(button => button.title === translate('unstageAll'))
console.log('UNSTAGE-ALL BTN:', Boolean(unstageAll))
if (unstageAll) {
  await act(async () => { unstageAll.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  console.log('TOOLTIP:', (document.body.textContent || '').includes(translate('unstageAll')))
}
console.log('CHANGES-TEXT:', (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 500))
const buttons = [...document.querySelectorAll('button')]
console.log('buttons:', buttons.map(b => b.textContent).filter(Boolean).slice(0, 12))
const tab = buttons.find(b => b.textContent === translate('filesTab') || b.textContent.startsWith('files'))
const picker = [...document.querySelectorAll('button')].find(button => button.title === translate('selectCommit'))
console.log('COMMIT PICKER:', Boolean(picker))
if (picker) {
  await act(async () => { picker.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  const commitItem = [...document.querySelectorAll('button')].find(button => button.textContent.includes('test commit'))
  if (commitItem) await act(async () => { commitItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 200)) })
  console.log('COMMIT VIEW:', (document.body.textContent || '').includes('src/b.ts'))
  const collapseBtn = [...document.querySelectorAll('button')].find(button => button.textContent === translate('collapseAllFiles'))
  console.log('COLLAPSE ALL BTN:', Boolean(collapseBtn))
  if (collapseBtn) await act(async () => { collapseBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 100)) })
  console.log('COLLAPSED:', (document.body.textContent || '').includes('another line') === false)
}
const issuesTab = [...document.querySelectorAll('button')].find(button => button.textContent === translate('issuesTab'))
console.log('ISSUES TAB:', Boolean(issuesTab))
if (issuesTab) {
  await act(async () => { issuesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 250)) })
  const card = [...document.querySelectorAll('[role="button"]')].find(element => element.textContent.includes('#101'))
  console.log('ISSUE CARDS:', document.body.textContent.includes('#102'), '| card:', Boolean(card))
  if (card) await act(async () => { card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 250)) })
  console.log('ISSUE DETAIL:', document.body.textContent.includes('小节标题'), '| RELATED:', (document.body.textContent.match(/子议题标题/g) || []).length > 0)
  console.log('MD RENDER:', Boolean(document.querySelector('strong')), '| COMMENTS:', document.body.textContent.includes('@bob'))
  if (card) {
    await act(async () => { card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    console.log('ISSUE DESELECT:', document.body.textContent.includes(translate('issueDetailEmpty')))
  }
  const changesTab = [...document.querySelectorAll('button')].find(button => button.textContent === translate('changesTab'))
  if (changesTab) await act(async () => { changesTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 100)) })
  const stashPushBtn = [...document.querySelectorAll('button')].find(button => button.title === translate('stashPush'))
  console.log('STASH PUSH BTN:', Boolean(stashPushBtn))
  if (stashPushBtn) {
    await act(async () => { stashPushBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    console.log('STASH PUSH POSTED:', fetched.some(h => h.includes('/stash-push')))
  }
  const stashChip = [...document.querySelectorAll('button')].find(button => button.title === translate('stashChip'))
  console.log('STASH CHIP:', Boolean(stashChip))
  if (stashChip) {
    await act(async () => { stashChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 100)) })
    console.log('STASH MENU:', document.body.textContent.includes('测试 stash'), '| POP BTN:', [...document.querySelectorAll('button')].some(b => b.title === translate('stashPop')))
    const popBtn = [...document.querySelectorAll('button')].find(b => b.title === translate('stashPop'))
    if (popBtn) await act(async () => { popBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    console.log('STASH POP POSTED:', fetched.some(h => h.includes('/stash-pop')))
  }
  const changeRow = [...document.querySelectorAll('div')].find(d => {
    const text = d.textContent.trim()
    return (text === 'a.ts' || text === 'a.tsM') && d.style.cursor === 'pointer'
  })
  if (changeRow) await act(async () => { changeRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  const rowMenuBtn = [...document.querySelectorAll('button')].find(button => button.title === translate('moreFileActions'))
  console.log('ROW MENU BTN:', Boolean(rowMenuBtn))
  if (rowMenuBtn) {
    await act(async () => { rowMenuBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 100)) })
    console.log('ROW MENU ITEMS:', document.body.textContent.includes(translate('copyPath')), document.body.textContent.includes(translate('fileHistory')))
    const historyItem = [...document.querySelectorAll('button')].find(button => button.textContent === translate('fileHistory'))
    if (historyItem) await act(async () => { historyItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    console.log('FILE HISTORY DIALOG:', document.body.textContent.includes('touched a'), '| FETCHED:', fetched.some(h => h.includes('/file-log')))
    const closeDialog = [...document.querySelectorAll('button')].find(b => b.textContent === '×')
    if (closeDialog) await act(async () => { closeDialog.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  }
}
console.log('files tab found:', Boolean(tab))
if (tab) await act(async () => { tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 200)) })
console.log('TEXT:', (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400))
const imgCandidates = [...document.querySelectorAll('div')].filter(d => d.textContent.includes('icon.svg'))
console.log('ICON SVG COUNT:', document.querySelectorAll('span > svg').length)
const ctxRow = [...document.querySelectorAll('div')].filter(d => d.textContent.trim() === 'icon.svg').pop()
if (ctxRow) await act(async () => { ctxRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 })) })
await act(async () => { await new Promise(r => setTimeout(r, 100)) })
console.log('CTX MENU HAS COPY:', (document.body.textContent || '').includes(translate('copyPath')), (document.body.textContent || '').includes(translate('copyFolderPath')))
const ctxFolder = [...document.querySelectorAll('div')].filter(d => d.textContent.trim().startsWith('src') && d.textContent.length < 6).pop()
if (ctxFolder) await act(async () => { ctxFolder.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 })) })
await act(async () => { await new Promise(r => setTimeout(r, 100)) })
console.log('CTX MENU FOLDER:', (document.body.textContent || '').includes(translate('copyFolderPath')))
console.log('IMG CANDIDATES:', imgCandidates.length)
const imgRow = imgCandidates[imgCandidates.length - 1]
if (imgRow) await act(async () => { imgRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 200)) })
console.log('IMG SRCS:', JSON.stringify([...document.querySelectorAll('img')].map(img => img.getAttribute('src'))))

/* issue write operations: comment composer and close/reopen */
const issuesTabAgain = [...document.querySelectorAll('button')].find(button => button.textContent === translate('issuesTab'))
if (issuesTabAgain) {
  await act(async () => { issuesTabAgain.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 200)) })
  const cardAgain = [...document.querySelectorAll('[role="button"]')].find(element => element.textContent.includes('#101'))
  if (cardAgain) await act(async () => { cardAgain.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 200)) })
  const composer = [...document.querySelectorAll('textarea')].find(ta => ta.placeholder === translate('commentPlaceholder'))
  console.log('COMMENT COMPOSER:', Boolean(composer))
  if (composer) {
    await act(async () => {
      composer.value = '来自回归脚本的评论'
      composer.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const sendBtn = [...document.querySelectorAll('button')].find(b => b.textContent === translate('commentSend'))
    if (sendBtn) await act(async () => { sendBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    console.log('COMMENT POSTED:', fetched.some(h => h.includes('/issue-comment')))
  }
  const closeBtnAfter = [...document.querySelectorAll('button')].find(b => b.textContent === translate('closeIssue'))
  if (closeBtnAfter) {
    await act(async () => { closeBtnAfter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    console.log('STATE POSTED:', fetched.some(h => h.includes('/issue-state')), '| REOPEN BTN:', [...document.querySelectorAll('button')].some(b => b.textContent === translate('reopenIssue')))
  }
}

/* branch menu: a branch held by another worktree must never trigger a switch */
const branchChip = [...document.querySelectorAll('button')].find(button => button.querySelector('svg') && button.textContent.includes(translate('detached')) === false && button.textContent.trim() === 'main')
if (branchChip) {
  await act(async () => { branchChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 100)) })
  const heldRow = [...document.querySelectorAll('button')].find(button => button.textContent.includes('feat/x'))
  console.log('BRANCH MENU:', Boolean(heldRow), '| HELD BADGE:', (document.body.textContent || '').includes(translate('branchInWorktree', { name: 'repo-wt' })))
  if (heldRow) {
    const before = fetched.filter(href => href.includes('/switch')).length
    await act(async () => { heldRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    const after = fetched.filter(href => href.includes('/switch')).length
    console.log('HELD ROW BLOCKED:', before === after, '| HINT:', (document.body.textContent || '').includes('repo-wt'))
    const card = document.querySelector('[data-worktree-path="/repo-wt"]')
    console.log('WORKTREE CARD TAGGED:', Boolean(card), '| OUTLINE FLASH:', card ? card.style.outline.includes('solid') : false)
  }
}
const switchHereBtn = [...document.querySelectorAll('button')].find(button => button.title === translate('switchBranchHere'))
console.log('SWITCH-HERE BTN:', Boolean(switchHereBtn))
if (switchHereBtn) {
  await act(async () => { switchHereBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(r => setTimeout(r, 150)) })
  console.log('WORKTREE BRANCH MENU:', (document.body.textContent || '').includes(translate('worktreeBranches')), '| FREE BRANCH:', (document.body.textContent || '').includes('free/branch'))
}

console.log('BOUNDARY:', (document.getElementById('boundary')?.textContent || 'none').slice(0, 2000))
console.log('ERRORS:', JSON.stringify(errors.slice(0, 5), null, 1).slice(0, 2500))
root.unmount()
