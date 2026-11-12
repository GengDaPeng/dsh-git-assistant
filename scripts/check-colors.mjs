import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const loaded=[]
globalThis.window={location:{origin:'http://x'},localStorage:{getItem:()=>null,setItem:()=>{}},__ModuleLoader__:{load:d=>loaded.push(d)}}
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const { computeGraphLanes } = loaded[0].factory(require).__internals
const commits = JSON.parse(readFileSync('/tmp/jwxt-branch-commits.json','utf8'))
const { rows } = computeGraphLanes(commits)
for (let i=0;i<12;i++) {
  const r=rows[i]
  console.log(i, 'oid=', commits[i].oid.slice(0,7), 'nodeColor=', r.colorOf(commits[i].oid), 'newLanes=', JSON.stringify(r.newLanes.map(h=>h?h.slice(0,4):null)), 'laneColors=', JSON.stringify(r.newLanes.map(h=>h?r.colorOf(h):null)))
}
