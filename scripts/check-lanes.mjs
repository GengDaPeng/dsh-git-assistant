import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const loaded = []
globalThis.window = { location:{origin:'http://x'}, localStorage:{getItem:()=>null,setItem:()=>{}}, __ModuleLoader__:{ load:d=>loaded.push(d) } }
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const mod = loaded[0].factory(require)
const fn = mod.__internals.computeGraphLanes
const commits=[]
for(let i=0;i<200;i++){
  const oid='c'+i
  const parents=[]
  if(i<199) parents.push('c'+(i+1))
  if(i%7===0 && i+3<200) parents.push('c'+(i+3))
  if(i%11===0 && i+8<200) parents.push('c'+(i+8))
  commits.push({oid, parents})
}
const { rows, maxLaneCount } = fn(commits)
console.log('commits:',commits.length,'maxLaneCount:',maxLaneCount,'rows:',rows.length)
const widths=rows.map(r=>Math.max(r.nodeColumn,...r.passColumns,...r.joins,...r.starts)+1)
console.log('max row columns:', Math.max(...widths), 'avg:', (widths.reduce((a,b)=>a+b,0)/widths.length).toFixed(1))
