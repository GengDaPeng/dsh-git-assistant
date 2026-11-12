import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const loaded=[]
globalThis.window={location:{origin:'http://x'},localStorage:{getItem:()=>null,setItem:()=>{}},__ModuleLoader__:{load:d=>loaded.push(d)}}
await import('file:///Users/gpp/project/github/git-assistant/src/client.js')
const { computeGraphLanes } = loaded[0].factory(require).__internals

const repo = process.argv[2]
const limit = Number(process.argv[3] ?? 60)
const raw = execFileSync('git', ['-C', repo, 'log', '--graph', '--topo-order', `-n${limit}`, '--pretty=format:%H|%P|%s'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
const commits = []
const gitRows = []
for (const line of raw.split('\n')) {
  const hex = line.search(/[0-9a-f]{40}/)
  if (hex < 0) continue
  const prefix = line.slice(0, hex)
  const rest = line.slice(hex)
  const [oid, parentsRaw, ...subjectParts] = rest.split('|')
  commits.push({ oid, parents: (parentsRaw ?? '').split(' ').filter(Boolean) })
  gitRows.push({
    col: Math.max(0, prefix.indexOf('*')) >= 0 ? Math.floor(prefix.indexOf('*') / 2) : 0,
    width: Math.ceil(prefix.replace(/\s+$/, '').length / 2),
    prefix,
    subject: subjectParts.join('|').slice(0, 34),
  })
}
const { rows } = computeGraphLanes(commits)
let matched = 0
const mismatches = []
for (let i = 0; i < rows.length; i += 1) {
  if (rows[i].newNodeIndex === gitRows[i].col || (rows[i].newNodeIndex === -1 && gitRows[i].col === 0)) matched += 1
  else mismatches.push(i)
}
const ourWidth = rows.reduce((sum, row) => sum + row.laneCount, 0) / Math.max(1, rows.length)
const gitWidth = gitRows.reduce((sum, row) => sum + row.width, 0) / Math.max(1, gitRows.length)
console.log(`repo=${repo.split('/').pop()} rows=${rows.length} node-column match=${matched}/${rows.length} (${(100 * matched / rows.length).toFixed(1)}%)`)
console.log(`avg width ours=${ourWidth.toFixed(2)} git=${gitWidth.toFixed(2)}`)
for (const i of mismatches.slice(0, 6)) {
  console.log(`  row ${i}: ours=${rows[i].newNodeIndex} git=${gitRows[i].col} | ${gitRows[i].prefix.trimEnd()} | ${gitRows[i].subject}`)
}
