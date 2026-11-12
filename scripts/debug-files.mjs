import { JSDOM } from 'jsdom'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:62528' })
globalThis.window = dom.window
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL = dom.window.URL

const repos = [
  { id: '/repo', path: '/repo', name: 'repo', repoName: 'repo', branch: 'main', isMain: true },
  { id: '/repo-wt', path: '/repo-wt', name: 'wt', repoName: 'repo', branch: 'feat/x', isMain: false },
]
const status = { branch: 'main', ahead: 0, behind: 2, staged: [], unstaged: [{ path: 'a.ts', status: 'M' }, { path: 'src/b.ts', status: 'M' }], untracked: [], detached: false }
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
    : href.includes('/files') ? { files: ['a.ts', 'src/b.ts'], total: 2, truncated: false }
    : href.includes('/file') ? { path: 'a.ts', content: 'hello', size: 5, binary: false }
    : href.includes('/branches') ? { local: [], remote: [], detached: false }
    : href.includes('/commit-diff') ? { file: 'a.ts', hash: 'abc1234def', files: [{ path: 'a.ts', binary: false, newFile: false, deletedFile: false, additions: 1, deletions: 0, hunks: [{ header: '@@ -1 +1 @@', lines: [{ type: 'add', text: 'added line', oldNumber: 1, newNumber: 1 }] }] }] }
    : href.includes('/commit') ? { commit: { hash: 'abc1234def', author: 'A', email: 'a@x', time: 1700000000, subject: 'merge commit', body: 'detail body' }, files: [{ path: 'a.ts', status: 'M', additions: 3, deletions: 1 }], stats: { files: 1, additions: 3, deletions: 1 } }
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
await act(async () => { root.render(React.createElement(Boundary, null, React.createElement(view.component, { t: k => k, sessionId: 'session-test' }))) })
await act(async () => { await new Promise(r => setTimeout(r, 100)) })
const drawer = [...document.querySelectorAll('div')].filter(d => d.textContent.trim() === 'graphTitle').pop()
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
console.log('CHANGES-TEXT:', (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 500))
const buttons = [...document.querySelectorAll('button')]
console.log('buttons:', buttons.map(b => b.textContent).filter(Boolean).slice(0, 12))
const tab = buttons.find(b => b.textContent.startsWith('files'))
console.log('files tab found:', Boolean(tab))
if (tab) await act(async () => { tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 200)) })
console.log('TEXT:', (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400))
console.log('BOUNDARY:', (document.getElementById('boundary')?.textContent || 'none').slice(0, 2000))
console.log('ERRORS:', JSON.stringify(errors.slice(0, 5), null, 1).slice(0, 2500))
root.unmount()
