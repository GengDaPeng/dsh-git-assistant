import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const loaded = []
globalThis.window = { location:{origin:'http://x'}, localStorage:{getItem:()=>null,setItem:()=>{}}, __ModuleLoader__:{ load:d=>loaded.push(d) } }
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const { computeGraphLanes } = loaded[0].factory(require).__internals
const commits = [
  { oid: 'A', parents: ['B', 'C'] },
  { oid: 'B', parents: ['D'] },
  { oid: 'C', parents: ['D'] },
  { oid: 'D', parents: [] },
]
const { rows } = computeGraphLanes(commits)
for (let i = 0; i < rows.length; i += 1) {
  const r = rows[i]
  console.log(commits[i].oid, 'old:', JSON.stringify(r.oldLanes), 'new:', JSON.stringify(r.newLanes), 'node:', r.newNodeIndex, 'joins:', JSON.stringify(r.joins), 'starts:', JSON.stringify(r.starts))
}
