/**
 * Client-half smoke test.
 *
 * Loads src/client.js in Node with the DSH module-loader contract mocked, applies the plugin against a
 * minimal Cordis-like context, and renders both registered seats with react-dom/server. It catches
 * undefined identifiers, bad hooks use, and broken registration shapes without needing a browser.
 *
 * Run: node scripts/smoke-client.mjs
 */
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const React = require('react')

const loaded = []
globalThis.window = {
  location: { origin: 'http://127.0.0.1:62528' },
  localStorage: { getItem: () => null, setItem: () => {} },
  __ModuleLoader__: { load: definition => loaded.push(definition) },
}

await import('../src/client.js')

if (loaded.length !== 1) throw new Error(`expected one client module, got ${loaded.length}`)
const definition = loaded[0]
if (definition.id !== 'dsh-git-assistant') throw new Error(`unexpected module id ${definition.id}`)

const registrations = []
const context = {
  effect(fn) {
    const dispose = fn()
    return () => { if (typeof dispose === 'function') dispose() }
  },
  locale: {
    register() { return () => {} },
    bind() { return (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key) },
  },
  slots: {
    inject(_name, fn) { return fn() ?? (() => {}) },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  sessions: {
    list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) },
  },
}

const exported = definition.factory(require)
if (!Array.isArray(exported.inject)) throw new Error('client module must export inject')
if (typeof exported.apply !== 'function') throw new Error('client module must export apply')
exported.apply(context)

const bySlot = new Map()
for (const registration of registrations) {
  const name = registration.options?.name
  if (!bySlot.has(name)) bySlot.set(name, [])
  bySlot.get(name).push(registration)
}

for (const slot of ['main', 'sidebar.panellist', 'conversation.view']) {
  if (!bySlot.has(slot)) throw new Error(`missing slot registration: ${slot}`)
}

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const translate = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key)

for (const [slot, entries] of bySlot) {
  for (const entry of entries) {
    const html = slot === 'conversation.view'
      ? render(entry.component, { t: translate, sessionId: 'session-test' })
      : render(entry.component, { t: translate, size: 16 })
    if (typeof html !== 'string' || html.length === 0) throw new Error(`empty render for slot ${slot}`)
    console.log(`ok ${slot}: ${html.length} bytes`)
  }
}

console.log('client smoke test passed')

/* ── deeper rendering fixtures (diff / tree / preview) ─────────────── */
const internals = exported.__internals
if (!internals) throw new Error('client module should expose __internals for smoke tests')
const t = translate

const tokens = internals.tokenize('const x = "hi" + 42 // note', 'ts')
if (!tokens.some(token => token.kind === 'keyword')) throw new Error('tokenizer did not mark keywords')
if (!tokens.some(token => token.kind === 'comment')) throw new Error('tokenizer did not mark comments')

const file = [{
  path: 'src/demo.ts', binary: false, newFile: false, additions: 1, deletions: 1,
  hunks: [{
    header: '@@ -1,3 +1,3 @@', oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, section: 'demo',
    lines: [
      { kind: 'ctx', text: 'const a = 1' },
      { kind: 'del', text: 'const b = 2' },
      { kind: 'add', text: 'const b = 3' },
      { kind: 'ctx', text: 'export {}' },
    ],
  }],
}]
for (const view of ['unified', 'split']) {
  const html = render(internals.DiffLines, { file, view, t })
  if (!html.includes('const')) throw new Error(`diff render failed for ${view}`)
  console.log(`ok diff ${view}: ${html.length} bytes`)
}

const treeNode = {
  children: new Map([['src', { name: 'src', path: 'src', children: new Map(), files: [{ path: 'src/demo.ts', name: 'demo.ts', status: 'M' }] }]]),
  files: [{ path: 'README.md', name: 'README.md', status: 'U' }],
}
for (const showStatus of [false, true]) {
  const collapsed = render(internals.TreeRows, {
    node: treeNode, depth: 0, expandedDirs: new Set(), onToggleDir: () => {}, onOpen: () => {},
    selectedKey: undefined, actionsFor: null, statusByPath: new Map([['src/demo.ts', 'M']]), showStatus,
  })
  if (collapsed.includes('demo.ts')) throw new Error('tree directories should start collapsed')
  const expandedHtml = render(internals.TreeRows, {
    node: treeNode, depth: 0, expandedDirs: new Set(['src']), onToggleDir: () => {}, onOpen: () => {},
    selectedKey: undefined, actionsFor: null, statusByPath: new Map([['src/demo.ts', 'M']]), showStatus,
  })
  if (!expandedHtml.includes('demo.ts')) throw new Error(`tree render failed for showStatus=${showStatus}`)
  const statusAtRight = expandedHtml.lastIndexOf('M') > expandedHtml.lastIndexOf('demo.ts')
  if (!statusAtRight) throw new Error('status letter should render at the end of the row')
  console.log(`ok tree showStatus=${showStatus}: collapsed=${collapsed.length}B expanded=${expandedHtml.length}B`)
}

const preview = render(internals.FilePreview, {
  state: { phase: 'ready', data: { content: 'line one\nline two', binary: false, truncated: false, repoPath: '/tmp/demo', size: 18 } },
  selection: { kind: 'file', path: 'README.md' },
  t,
})
if (!preview.includes('line one')) throw new Error('file preview render failed')
console.log('ok preview:', preview.length, 'bytes')
console.log('client deep smoke test passed')

/* ── composer takeover lifecycle (jsdom + react-dom/client) ────────── */
const { JSDOM } = await import('jsdom')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react-dom/test-utils')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:62528' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.fetch = async () => ({ ok: true, json: async () => ({ repositories: [] }) })

const mounted = []
const mountContext = {
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject(_name, fn) { return fn() ?? (() => {}) },
    register(options, component) {
      const record = { options, component, disposed: false }
      mounted.push(record)
      return () => { record.disposed = true }
    },
  },
  sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) } },
}
exported.apply(mountContext)

const viewRegistration = mounted.find(record => record.options?.name === 'conversation.view')
if (!viewRegistration) throw new Error('conversation view registration missing')

const container = document.getElementById('root')
const root = createRoot(container)
await act(async () => {
  root.render(React.createElement(viewRegistration.component, { t: translate, sessionId: 'session-test' }))
})
const takeover = mounted.find(record => record.options?.name === 'conversation.composer')
if (!takeover) throw new Error('composer takeover was not registered while the Git view was active')
if (takeover.disposed) throw new Error('composer takeover should be live while the Git view is mounted')
if (takeover.options.select({ sessionId: 'session-test' }) === null) throw new Error('takeover should match its session')
if (takeover.options.select({ sessionId: 'other-session' }) !== null) throw new Error('takeover must not match other sessions')
console.log('ok composer takeover registered while Git view is active')

await act(async () => { root.unmount() })
if (!takeover.disposed) throw new Error('composer takeover should be disposed when leaving the Git view')
console.log('ok composer takeover disposed after leaving the Git view')
