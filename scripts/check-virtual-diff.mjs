import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const loaded = []
globalThis.window = { location: { origin: 'http://x' }, localStorage: { getItem: () => null, setItem: () => {} }, __ModuleLoader__: { load: d => loaded.push(d) } }
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const mod = loaded[0].factory(require)
const lines = Array.from({ length: 1200 }, (_, i) => ({ type: 'add', text: `line ${i}`, oldNumber: null, newNumber: i + 1 }))
const entry = { path: 'a.ts', binary: false, additions: 1200, deletions: 0, hunks: [{ header: '@@ -0,0 +1,1200 @@', section: '', lines }] }
const html = renderToStaticMarkup(React.createElement(mod.__internals.DiffLines, { file: [entry], view: 'unified', t: (key, values) => key + (values ? JSON.stringify(values) : '') }))
console.log('collapsed hunk:', html.includes('diffHunkCollapsed'))
console.log('rendered bytes:', html.length, '| footer:', html.includes('moreLines'), '| lines rendered:', (html.match(/line /g) || []).length)
