import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const loaded = []
globalThis.window = { location:{origin:'http://x'}, localStorage:{getItem:()=>null,setItem:()=>{}}, __ModuleLoader__:{ load:d=>loaded.push(d) } }
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const mod = loaded[0].factory(require)
for (const scope of ['branch','all']) {
  const commits = JSON.parse(readFileSync(`/tmp/jwxt-${scope}-commits.json`,'utf8'))
  const { rows, maxLaneCount } = mod.__internals.computeGraphLanes(commits)
  const widths = rows.map(r => r.laneCount)
  console.log(scope, 'commits:', commits.length, 'maxLaneCount:', maxLaneCount, 'max row cols:', Math.max(...widths), 'avg:', (widths.reduce((a,b)=>a+b,0)/widths.length).toFixed(1))
}
