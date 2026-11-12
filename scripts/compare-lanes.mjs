import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const loaded=[]
globalThis.window={location:{origin:'http://x'},localStorage:{getItem:()=>null,setItem:()=>{}},__ModuleLoader__:{load:d=>loaded.push(d)}}
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const { computeGraphLanes } = loaded[0].factory(require).__internals
const commits=JSON.parse(readFileSync('/tmp/jwxt-gg-commits.json','utf8'))
const gitRows=JSON.parse(readFileSync('/tmp/jwxt-gg-rows.json','utf8'))
const { rows } = computeGraphLanes(commits)
console.log('row  ours_col  ours_lanes  git_col  git_width  subject')
for (let i=0;i<Math.min(20,rows.length);i++){
  const o=rows[i], g=gitRows[i]
  console.log(String(i).padStart(3), String(o.nodeIndex).padStart(7), String(o.laneCount).padStart(10), String(g.git_col).padStart(7), String(g.git_width).padStart(10), ' ', g.subject)
}
