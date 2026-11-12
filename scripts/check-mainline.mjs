import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const loaded=[]
globalThis.window={location:{origin:'http://x'},localStorage:{getItem:()=>null,setItem:()=>{}},__ModuleLoader__:{load:d=>loaded.push(d)}}
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const { computeGraphLanes } = loaded[0].factory(require).__internals
const commits = JSON.parse(readFileSync('/tmp/jwxt-branch-commits.json','utf8'))
const byOid = new Map(commits.map(c => [c.oid, c]))
const chain = []
let cursor = commits[0]?.oid
while (cursor && byOid.has(cursor)) { chain.push(cursor); cursor = byOid.get(cursor).parents[0] }
const { rows } = computeGraphLanes(commits)
const index = new Map(commits.map((c, i) => [c.oid, i]))
let ok = 0
const bad = []
for (const oid of chain) {
  const i = index.get(oid)
  if (i === undefined) continue
  if (rows[i].newNodeIndex === 0) ok += 1
  else bad.push({ row: i, col: rows[i].newNodeIndex, subject: commits[i].subject?.slice(0, 30) })
}
console.log(`head first-parent chain: ${chain.length} commits, column0 rows: ${ok}/${chain.length}`)
for (const b of bad.slice(0, 6)) console.log('  off-main:', b)
