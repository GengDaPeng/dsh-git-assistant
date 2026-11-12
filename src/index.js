/**
 * dsh-git-assistant — host half.
 *
 * Local Git workbench service for the browser panel. Runs `git` with argv arrays (never a shell string),
 * pins the working directory to a registered DSH workspace / worktree, validates every path, and serves
 * parsed JSON to the panel through a local same-origin API.
 *
 * Read: repository/worktree discovery, status, branches, unified diff, file listing, file text, raw file.
 * Write: stage, unstage, discard, commit/amend, branch switch/create. All write routes require the same
 * local same-origin guard as reads, and the client confirms destructive actions before calling them.
 */

import { spawn } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, resolve, sep } from 'node:path'

export const name = 'dsh-git-assistant'
export const inject = ['webServer', 'workspaceRegistry', 'sessionController', 'sessionPersistence']

const PREFIX = '/git-assistant/api'
const GIT_TIMEOUT_MS = 20000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024
const MAX_RAW_BYTES = 24 * 1024 * 1024
const MAX_UNTRACKED_ENTRIES = 500
const MAX_FILE_ENTRIES = 12000
const MAX_BODY_BYTES = 64 * 1024
const REPOSITORY_CACHE_MS = 2000

const GIT_ENV = (() => {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
  }
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES',
  ]) delete env[key]
  return env
})()

const DIFF_CACHE_LIMIT = 300
const diffCache = new Map()
const headStamp = { path: undefined, at: 0, sha: '' }

function cacheGetDiff(key) {
  const value = diffCache.get(key)
  if (value === undefined) return undefined
  diffCache.delete(key)
  diffCache.set(key, value)
  return value
}

function cacheSetDiff(key, value) {
  if (diffCache.size >= DIFF_CACHE_LIMIT) {
    const oldest = diffCache.keys().next().value
    if (oldest !== undefined) diffCache.delete(oldest)
  }
  diffCache.set(key, value)
}

function clearDiffCache(repoPath) {
  const prefix = `${repoPath}|`
  for (const key of [...diffCache.keys()]) if (key.startsWith(prefix)) diffCache.delete(key)
}

async function headCommitOf(repoPath) {
  const now = Date.now()
  if (headStamp.path === repoPath && now - headStamp.at < 2000) return headStamp.sha
  const raw = await gitOk(repoPath, ['rev-parse', 'HEAD'])
  headStamp.path = repoPath
  headStamp.at = now
  headStamp.sha = (raw ?? '').trim()
  return headStamp.sha
}

async function indexStampOf(repoPath, file) {
  const raw = await gitOk(repoPath, ['ls-files', '-s', '--', file])
  return (raw ?? '').trim() || 'missing'
}

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8',
}

/** Run git without a shell; resolve with { code, stdout, stderr, truncated }. */
function runGit(cwd, args, { timeout = GIT_TIMEOUT_MS, maxBuffer = GIT_MAX_BUFFER } = {}) {
  return new Promise(done => {
    let settled = false
    let truncated = false
    const out = []
    const err = []
    let size = 0
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(result)
    }
    const timer = setTimeout(() => {
      truncated = true
      child.kill('SIGKILL')
      finish({ code: 124, stdout: Buffer.concat(out).toString('utf8'), stderr: 'git timed out', truncated: true })
    }, timeout)
    child.stdout.on('data', chunk => {
      if (size + chunk.length > maxBuffer) {
        truncated = true
        child.kill('SIGKILL')
        return
      }
      size += chunk.length
      out.push(chunk)
    })
    child.stderr.on('data', chunk => {
      if (err.length < 200) err.push(chunk)
    })
    child.on('error', error => finish({ code: -1, stdout: '', stderr: String(error), truncated }))
    child.on('close', code => finish({
      code: code ?? -1,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
      truncated,
    }))
  })
}

async function gitOk(cwd, args, options) {
  const result = await runGit(cwd, args, options)
  return result.code === 0 ? result.stdout : undefined
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** Accept only loopback, same-origin panel requests. */
function allowed(req) {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'same-site') return false
  return true
}

function inside(root, candidate) {
  const a = resolve(root)
  const b = resolve(candidate)
  return b === a || b.startsWith(a + sep)
}

function safeRelativePath(file) {
  return typeof file === 'string' && file.length > 0 && file.length < 4096 &&
    !file.startsWith('/') && !file.split('/').includes('..') && !file.includes('\u0000')
}

function safeFileList(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 500) return undefined
  if (!files.every(safeRelativePath)) return undefined
  return files
}

function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolvePromise({}); return }
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new Error('request body is not JSON')) }
    })
    req.on('error', reject)
  })
}

/* ── parsers ─────────────────────────────────────────────────────────── */

/** `git worktree list --porcelain` → [{ path, head, branch, detached, locked, bare }] */
function parseWorktrees(raw) {
  const list = []
  for (const block of raw.split('\n\n')) {
    let current
    for (const line of block.split('\n')) {
      if (!line) continue
      const index = line.indexOf(' ')
      const key = index === -1 ? line : line.slice(0, index)
      const value = index === -1 ? '' : line.slice(index + 1)
      if (key === 'worktree') {
        current = { path: value }
        list.push(current)
      } else if (current) {
        if (key === 'HEAD') current.head = value
        else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
        else if (key === 'bare') current.bare = true
        else if (key === 'detached') current.detached = true
        else if (key === 'locked') current.locked = value || true
        else if (key === 'prunable') current.prunable = value || true
      }
    }
  }
  return list.filter(item => item.path)
}

function unquotePath(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { return value.slice(1, -1) }
  }
  return value
}

/** `git status --porcelain=v2 --branch` → staged / unstaged / untracked + branch facts. */
function parseStatus(raw) {
  const status = {
    branch: undefined, detached: false, upstream: undefined, ahead: 0, behind: 0,
    staged: [], unstaged: [], untracked: [], conflicted: [],
  }
  for (const line of raw.split('\n')) {
    if (!line) continue
    if (line.startsWith('# ')) {
      const value = line.slice(2)
      if (value.startsWith('branch.head ')) {
        const head = value.slice('branch.head '.length)
        if (head === '(detached)') status.detached = true
        else status.branch = head
      } else if (value.startsWith('branch.upstream ')) {
        status.upstream = value.slice('branch.upstream '.length)
      } else if (value.startsWith('branch.ab ')) {
        const match = /\+(\d+) -(\d+)/.exec(value.slice('branch.ab '.length))
        if (match) { status.ahead = Number(match[1]); status.behind = Number(match[2]) }
      }
      continue
    }
    const kind = line[0]
    if (kind === '1') {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = unquotePath(parts.slice(8).join(' '))
      if (xy[0] !== '.') status.staged.push({ path, status: xy[0] })
      if (xy[1] !== '.') status.unstaged.push({ path, status: xy[1] })
    } else if (kind === '2') {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const info = parts.slice(9).join(' ')
      const [newPath, oldPath] = info.split('\t')
      const path = unquotePath(newPath)
      const entry = { path, status: 'R', oldPath: oldPath ? unquotePath(oldPath) : undefined }
      if (xy[0] !== '.') status.staged.push(entry)
      if (xy[1] !== '.') status.unstaged.push({ path, status: 'R' })
    } else if (kind === 'u') {
      const parts = line.split(' ')
      const path = unquotePath(parts.slice(10).join(' '))
      status.unstaged.push({ path, status: 'C' })
      status.conflicted.push({ path })
    } else if (kind === '?') {
      status.untracked.push({ path: unquotePath(line.slice(2)), status: 'U' })
    }
  }
  return status
}

/** Unified diff text → [{ path, oldPath, binary, newFile, deletedFile, additions, deletions, hunks }] */
function parseUnifiedDiff(raw) {
  const files = []
  let current
  let hunk
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: undefined, oldPath: undefined, binary: false, newFile: false, deletedFile: false, additions: 0, deletions: 0, hunks: [] }
      files.push(current)
      hunk = undefined
      continue
    }
    if (!current) continue
    if (line.startsWith('new file mode ')) { current.newFile = true; continue }
    if (line.startsWith('deleted file mode ')) { current.deletedFile = true; continue }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') { current.binary = true; continue }
    if (line.startsWith('--- ')) {
      const path = line.slice(4)
      current.oldPath = path === '/dev/null' ? undefined : path.replace(/^[ab]\//, '')
      continue
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4)
      current.path = path === '/dev/null' ? current.oldPath : path.replace(/^[ab]\//, '')
      continue
    }
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
      if (!match) continue
      hunk = {
        header: line,
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        section: (match[5] ?? '').trim(),
        lines: [],
      }
      current.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (line.startsWith('\\')) continue
    const sign = line[0]
    if (sign === ' ') hunk.lines.push({ kind: 'ctx', text: line.slice(1) })
    else if (sign === '+') { hunk.lines.push({ kind: 'add', text: line.slice(1) }); current.additions += 1 }
    else if (sign === '-') { hunk.lines.push({ kind: 'del', text: line.slice(1) }); current.deletions += 1 }
  }
  return files
}

/* ── discovery & queries ─────────────────────────────────────────────── */

let repositoryCache = { at: 0, value: undefined }

/** DSH workspaces that are Git checkouts, expanded to every linked worktree. */
async function discoverRepositories(ctx) {
  const now = Date.now()
  if (repositoryCache.value !== undefined && now - repositoryCache.at < REPOSITORY_CACHE_MS) return repositoryCache.value
  const repositories = []
  const seenRoots = new Set()
  for (const workspace of ctx.workspaceRegistry.list()) {
    const insideRepo = await gitOk(workspace.path, ['rev-parse', '--is-inside-work-tree'])
    if (insideRepo === undefined || insideRepo.trim() !== 'true') continue
    const root = (await gitOk(workspace.path, ['rev-parse', '--show-toplevel']) ?? '').trim() || workspace.path
    if (seenRoots.has(root)) continue
    seenRoots.add(root)
    const worktrees = parseWorktrees(await gitOk(root, ['worktree', 'list', '--porcelain']) ?? '')
    const entries = worktrees.length > 0 ? worktrees : [{ path: root }]
    for (const worktree of entries) {
      if (worktree.bare) continue
      repositories.push({
        id: worktree.path,
        path: worktree.path,
        repoRoot: root,
        repoName: basename(root),
        branch: worktree.branch ?? (worktree.detached && worktree.head ? worktree.head.slice(0, 8) : undefined),
        isMain: resolve(worktree.path) === resolve(root),
        locked: Boolean(worktree.locked),
      })
    }
  }
  repositories.sort((a, b) =>
    a.repoName.localeCompare(b.repoName) ||
    Number(b.isMain) - Number(a.isMain) ||
    String(a.branch ?? '').localeCompare(String(b.branch ?? '')))
  const value = { repositories, scannedAt: new Date().toISOString() }
  repositoryCache = { at: now, value }
  return value
}

/** Validate that `path` is one of the discovered checkouts (workspaces or their worktrees). */
async function knownCheckout(ctx, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  const { repositories } = await discoverRepositories(ctx)
  return repositories.find(repository => resolve(repository.path) === resolve(path))
}

async function statusOf(repoPath) {
  const raw = await gitOk(repoPath, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '--ignored=no'])
  if (raw === undefined) throw new Error('not a git checkout')
  const status = parseStatus(raw)
  if (status.untracked.length > MAX_UNTRACKED_ENTRIES) {
    status.untrackedOmitted = status.untracked.length - MAX_UNTRACKED_ENTRIES
    status.untracked = status.untracked.slice(0, MAX_UNTRACKED_ENTRIES)
  }
  return status
}

async function branchesOf(repoPath) {
  const raw = await gitOk(repoPath, ['for-each-ref', '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)', 'refs/heads']) ?? ''
  return raw.split('\n').filter(Boolean).map(line => {
    const [name, head, upstream] = line.split('\t')
    return { name, current: head === '*', upstream: upstream || undefined }
  })
}

function listDirectory(root, dir) {
  const absolute = resolve(root, dir || '.')
  if (!inside(root, absolute)) throw new Error('directory is outside the checkout')
  const dirents = readdirSync(absolute, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    if (dirent.name === '.git') continue
    const kind = dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : dirent.isSymbolicLink() ? 'link' : 'other'
    entries.push({ name: dirent.name, path: dir ? `${dir}/${dirent.name}` : dirent.name, kind })
  }
  entries.sort((left, right) => {
    if ((left.kind === 'dir') !== (right.kind === 'dir')) return left.kind === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  const truncated = entries.length > 2000
  return { entries: truncated ? entries.slice(0, 2000) : entries, truncated }
}

async function filesOf(repoPath) {
  const raw = await gitOk(repoPath, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 32 * 1024 * 1024 })
  if (raw === undefined) throw new Error('not a git checkout')
  const seen = new Set()
  for (const path of raw.split('\u0000')) {
    if (path) seen.add(path)
  }
  const files = [...seen].sort()
  const truncated = files.length > MAX_FILE_ENTRIES
  return { files: truncated ? files.slice(0, MAX_FILE_ENTRIES) : files, total: files.length, truncated }
}

async function commitOf(repoPath, hash) {
  const metaRaw = await gitOk(repoPath, ['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b', hash])
  const [oid, author, email, timeRaw, subject, body] = (metaRaw ?? '').split('\x1f')
  const parentsRaw = await gitOk(repoPath, ['rev-list', '--parents', '-n', '1', hash])
  const parents = (parentsRaw ?? '').trim().split(' ').slice(1)
  const numstatArgs = parents.length > 0
    ? ['diff-tree', '-r', '--numstat', '--no-commit-id', '--find-renames', `${hash}^1`, hash]
    : ['show', '--numstat', '--format=', '--root', '--find-renames', hash]
  const nameArgs = parents.length > 0
    ? ['diff-tree', '-r', '--name-status', '--no-commit-id', '--find-renames', `${hash}^1`, hash]
    : ['show', '--name-status', '--format=', '--root', '--find-renames', hash]
  const statRaw = await gitOk(repoPath, numstatArgs)
  const nameRaw = await gitOk(repoPath, nameArgs)
  const statusByPath = new Map()
  for (const line of (nameRaw ?? '').split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const code = (parts[0] ?? '').charAt(0)
    if (code === 'R' && parts[2]) statusByPath.set(parts[2], { status: 'R', oldPath: parts[1] })
    else if (parts[1]) statusByPath.set(parts[1], { status: code || 'M' })
  }
  const files = []
  let additions = 0
  let deletions = 0
  for (const line of (statRaw ?? '').split('\n')) {
    if (!line.trim()) continue
    const [addRaw, delRaw, pathRaw] = line.split('\t')
    if (!pathRaw) continue
    const info = statusByPath.get(pathRaw) ?? {}
    const added = addRaw === '-' ? 0 : Number(addRaw)
    const removed = delRaw === '-' ? 0 : Number(delRaw)
    additions += added
    deletions += removed
    files.push({
      path: pathRaw, oldPath: info.oldPath, status: info.status ?? 'M',
      additions: added, deletions: removed, binary: addRaw === '-',
    })
  }
  return {
    commit: { hash: oid ?? hash, author: author ?? '', email: email ?? '', time: Number(timeRaw ?? 0), subject: subject ?? '', body: (body ?? '').trim() },
    files,
    stats: { files: files.length, additions, deletions },
  }
}

async function localCommitsOf(repoPath, limit) {
  const raw = await gitOk(repoPath, [
    'log', 'HEAD', '--not', '--remotes', `--max-count=${limit}`,
    '--pretty=format:%H%x1f%an%x1f%at%x1f%s',
  ])
  const commits = []
  for (const line of (raw ?? '').split('\n')) {
    if (!line.trim()) continue
    const [oid, author, timeRaw, subject] = line.split('\x1f')
    commits.push({ oid, author: author ?? '', time: Number(timeRaw ?? 0), subject: subject ?? '' })
  }
  return { commits }
}

async function commitPatchOf(repoPath, hash) {
  const cacheKey = `${repoPath}|cp|${hash}`
  const cached = cacheGetDiff(cacheKey)
  if (cached !== undefined) return cached
  const meta = await commitOf(repoPath, hash)
  const parentsRaw = await gitOk(repoPath, ['rev-list', '--parents', '-n', '1', hash])
  const parents = (parentsRaw ?? '').trim().split(' ').slice(1)
  const raw = parents.length > 0
    ? await gitOk(repoPath, ['diff', '--find-renames', '--no-color', '--no-ext-diff', '--unified=3', `${hash}^1`, hash])
    : await gitOk(repoPath, ['show', '--format=', '--patch', '--root', '--find-renames', '--no-color', '--no-ext-diff', '--unified=3', hash])
  const files = parseUnifiedDiff(raw ?? '')
  const byPath = new Map(meta.files.map(file => [file.path, file]))
  for (const entry of files) {
    const info = byPath.get(entry.path)
    if (info) {
      entry.status = info.status
      entry.additions = info.additions
      entry.deletions = info.deletions
    } else if (!entry.status) {
      entry.status = entry.newFile ? 'A' : entry.deletedFile ? 'D' : 'M'
    }
  }
  const result = { commit: meta.commit, stats: meta.stats, files }
  cacheSetDiff(cacheKey, result)
  return result
}

async function commitDiffOf(repoPath, hash, file) {
  const cacheKey = `${repoPath}|c|${hash}|${file}`
  const cached = cacheGetDiff(cacheKey)
  if (cached !== undefined) return cached
  const parentsRaw = await gitOk(repoPath, ['rev-list', '--parents', '-n', '1', hash])
  const parents = (parentsRaw ?? '').trim().split(' ').slice(1)
  const raw = parents.length > 0
    ? await gitOk(repoPath, ['diff', '--find-renames', `${hash}^1`, hash, '--', file])
    : await gitOk(repoPath, ['show', '--format=', '--patch', '--root', '--find-renames', hash, '--', file])
  const files = parseUnifiedDiff(raw ?? '')
  cacheSetDiff(cacheKey, files)
  return files
}

async function graphOf(repoPath, limit, skip, scope) {
  const scopeArgs = scope === 'all' ? ['--all'] : []
  const raw = await gitOk(repoPath, [
    'log', ...scopeArgs, '--topo-order',
    `--max-count=${limit}`, `--skip=${skip}`,
    '--pretty=format:%x00%H%x1f%P%x1f%an%x1f%at%x1f%s%x1f%D%x1f%b',
  ])
  const statsRaw = await gitOk(repoPath, [
    'log', ...scopeArgs, '--topo-order',
    `--max-count=${limit}`, `--skip=${skip}`,
    '--numstat', '--format=%x00%H',
  ])
  const statsByHash = new Map()
  let currentHash = null
  for (const line of (statsRaw ?? '').split('\n')) {
    if (!line) continue
    if (line.startsWith('\x00')) {
      currentHash = line.slice(1).trim()
      statsByHash.set(currentHash, { files: 0, additions: 0, deletions: 0 })
      continue
    }
    if (!currentHash) continue
    const [addRaw, delRaw] = line.split('\t')
    if (delRaw === undefined) continue
    const entry = statsByHash.get(currentHash)
    if (!entry) continue
    entry.files += 1
    if (addRaw !== '-') entry.additions += Number(addRaw) || 0
    if (delRaw !== '-') entry.deletions += Number(delRaw) || 0
  }
  const commits = []
  for (const record of (raw ?? '').split('\x00')) {
    if (!record.trim()) continue
    const parts = record.split('\x1f')
    const [oid, parentsRaw, author, timeRaw, subject, decoration] = parts
    const bodyRaw = parts.slice(6).join('\x1f')
    const refs = (decoration ?? '').split(', ').map(part => part.replace(/^HEAD -> /, '').replace(/^tag: /, '').trim()).filter(name => name && name !== 'HEAD')
    commits.push({
      oid, parents: (parentsRaw ?? '').split(' ').filter(Boolean), author: author ?? '',
      time: Number(timeRaw ?? 0), subject: subject ?? '', body: (bodyRaw ?? '').trim().slice(0, 2000), refs,
      stats: statsByHash.get(oid) ?? { files: 0, additions: 0, deletions: 0 },
    })
  }
  return { commits, hasMore: commits.length >= limit }
}

async function worktreesOf(repoPath) {
  const list = parseWorktrees(await gitOk(repoPath, ['worktree', 'list', '--porcelain']) ?? '')
  const worktrees = []
  for (const worktree of list.slice(0, 40)) {
    if (worktree.bare) continue
    const status = parseStatus(await gitOk(worktree.path, ['status', '--porcelain=v2', '--branch', '--untracked-files=no']) ?? '')
    const lastRaw = await gitOk(worktree.path, ['log', '-1', '--format=%at'])
    worktrees.push({
      path: worktree.path,
      branch: status.branch ?? (worktree.detached ? 'detached' : undefined),
      ahead: status.ahead,
      behind: status.behind,
      changes: status.staged.length + status.unstaged.length,
      isMain: resolve(worktree.path) === resolve(repoPath),
      updatedAt: Number(lastRaw?.trim() ?? 0) || 0,
    })
  }
  worktrees.sort((left, right) => {
    if (left.isMain !== right.isMain) return left.isMain ? -1 : 1
    if ((left.changes > 0) !== (right.changes > 0)) return left.changes > 0 ? -1 : 1
    return right.updatedAt - left.updatedAt
  })
  return { worktrees }
}

async function diffOf(repoPath, file, staged) {
  if (!safeRelativePath(file)) throw new Error('invalid file path')
  const absolute = resolve(repoPath, file)
  if (!inside(repoPath, absolute)) throw new Error('file is outside the checkout')

  let cacheKey
  if (staged) {
    cacheKey = `${repoPath}|s|${file}|${await indexStampOf(repoPath, file)}`
  } else {
    let statKey = 'missing'
    try {
      const stat = statSync(absolute)
      statKey = `${stat.mtimeMs}:${stat.size}`
    } catch { /* missing file */ }
    cacheKey = `${repoPath}|w|${file}|${await headCommitOf(repoPath)}|${statKey}`
  }
  const cached = cacheGetDiff(cacheKey)
  if (cached !== undefined) return cached

  let files
  if (staged) {
    const raw = await gitOk(repoPath, ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3', '--', file])
    files = parseUnifiedDiff(raw ?? '')
  } else {
    const raw = await gitOk(repoPath, ['diff', '--no-color', '--no-ext-diff', '--unified=3', '--', file])
    if (raw !== undefined && raw.trim().length > 0) {
      files = parseUnifiedDiff(raw)
    } else {
      const tracked = await gitOk(repoPath, ['ls-files', '--error-unmatch', '--', file])
      if (tracked !== undefined) {
        files = []
      } else {
        const untracked = await runGit(repoPath, ['diff', '--no-color', '--no-ext-diff', '--unified=3', '--no-index', '--', '/dev/null', file])
        files = parseUnifiedDiff(untracked.stdout)
        for (const entry of files) {
          entry.path = file
          entry.newFile = true
        }
      }
    }
  }
  cacheSetDiff(cacheKey, files)
  return files
}

function absoluteFile(repoPath, file) {
  if (!safeRelativePath(file)) throw new Error('invalid file path')
  const absolute = resolve(repoPath, file)
  if (!inside(repoPath, absolute)) throw new Error('file is outside the checkout')
  return absolute
}

function readTextFile(repoPath, file) {
  const absolute = absoluteFile(repoPath, file)
  const stat = statSync(absolute)
  if (!stat.isFile()) throw new Error('not a file')
  const truncated = stat.size > MAX_FILE_BYTES
  const buffer = readFileSync(absolute)
  const slice = truncated ? buffer.subarray(0, MAX_FILE_BYTES) : buffer
  const binary = slice.includes(0)
  return {
    path: file,
    size: stat.size,
    truncated,
    binary,
    content: binary ? undefined : slice.toString('utf8'),
  }
}

function spawnDetached(command) {
  try {
    const child = spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore' })
    child.unref()
  } catch { /* best effort */ }
}

/** Reveal a file or folder in the platform file manager. */
function revealInFileManager(repoPath, file) {
  const absolute = absoluteFile(repoPath, file)
  const directory = statSync(absolute).isDirectory()
  if (process.platform === 'darwin') spawnDetached(['open', ...(directory ? [absolute] : ['-R', absolute])])
  else if (process.platform === 'win32') spawnDetached(['explorer', directory ? absolute : `/select,${absolute}`])
  else spawnDetached(['xdg-open', directory ? absolute : dirname(absolute)])
}

/** Open a file or folder with the platform default application. */
function openWithDefaultApp(repoPath, file) {
  const absolute = absoluteFile(repoPath, file)
  if (process.platform === 'darwin') spawnDetached(['open', absolute])
  else if (process.platform === 'win32') spawnDetached(['cmd', '/c', 'start', '', absolute])
  else spawnDetached(['xdg-open', absolute])
}

function rawFile(repoPath, file, res, download = false) {
  const absolute = absoluteFile(repoPath, file)
  const stat = statSync(absolute)
  if (!stat.isFile()) throw new Error('not a file')
  if (stat.size > MAX_RAW_BYTES) throw new Error('file is too large to serve')
  const type = CONTENT_TYPES[extname(absolute).toLowerCase()] ?? 'application/octet-stream'
  const buffer = readFileSync(absolute)
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  if (download) headers['content-disposition'] = `attachment; filename="${basename(absolute).replace(/"/g, '')}"`
  res.writeHead(200, headers)
  res.end(buffer)
}

/* ── write operations ────────────────────────────────────────────────── */

async function requireSuccess(repoPath, args) {
  const result = await runGit(repoPath, args)
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim().split('\n')[0])
  return result.stdout
}

async function stageFiles(repoPath, files) {
  await requireSuccess(repoPath, ['add', '--', ...files])
}

async function unstageFiles(repoPath, files) {
  const tracked = await gitOk(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (tracked === undefined) {
    // Unborn HEAD: remove the paths from the index instead of resetting against a missing commit.
    await requireSuccess(repoPath, ['rm', '--cached', '-r', '-q', '--', ...files])
    return
  }
  await requireSuccess(repoPath, ['reset', '-q', 'HEAD', '--', ...files])
}

async function discardFiles(repoPath, files) {
  const tracked = []
  const untracked = []
  for (const file of files) {
    const result = await runGit(repoPath, ['ls-files', '--error-unmatch', '--', file])
    if (result.code === 0) tracked.push(file)
    else untracked.push(file)
  }
  if (tracked.length > 0) await requireSuccess(repoPath, ['restore', '--worktree', '--', ...tracked])
  for (const file of untracked) {
    const absolute = absoluteFile(repoPath, file)
    const info = lstatSync(absolute)
    if (!info.isFile()) throw new Error(`refusing to delete non-file ${file}`)
    rmSync(absolute, { force: true })
  }
}

async function commitFiles(repoPath, message, action = 'commit') {
  const amend = action === 'amend'
  const args = ['commit']
  if (amend) args.push('--amend')
  if (message.trim().length > 0) args.push('-m', message)
  else if (amend) args.push('--no-edit')
  else throw new Error('commit message is empty')
  const output = await requireSuccess(repoPath, args)
  if (action === 'push') await requireSuccess(repoPath, ['push'])
  if (action === 'sync') {
    const pulled = await runGit(repoPath, ['pull', '--ff-only'])
    if (pulled.code !== 0) throw new Error((pulled.stderr || 'git pull failed').trim().split('\n')[0])
    await requireSuccess(repoPath, ['push'])
  }
  return { output: output.trim() }
}

async function switchBranch(repoPath, branch) {
  if (typeof branch !== 'string' || branch.length === 0 || branch.startsWith('-')) throw new Error('invalid branch name')
  await requireSuccess(repoPath, ['switch', branch])
}

async function createBranch(repoPath, name, from) {
  if (typeof name !== 'string' || name.length === 0 || name.startsWith('-')) throw new Error('invalid branch name')
  const args = ['branch', name]
  if (typeof from === 'string' && from.length > 0 && !from.startsWith('-')) args.push(from)
  await requireSuccess(repoPath, args)
}

/* ── minimal chat bridge (B-route proof) ─────────────────────────────── */

/** Read the durable event log of one Session and reduce it to text messages. */
async function chatHistory(ctx, sessionId, limit = 120) {
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  let events
  try { events = (await handle.read()).events } finally { await handle.close() }
  const messages = []
  for (const event of events ?? []) {
    const type = event?.type
    const data = event?.data
    if (type === 'user/message') {
      const text = textOf(data?.content ?? data?.message?.content)
      if (text) messages.push({ role: 'user', text, seq: event.seq })
    } else if (type === 'assistant/message') {
      const text = textOf(data?.message?.content ?? data?.content)
      if (text) messages.push({ role: 'assistant', text, seq: event.seq })
    }
  }
  return messages.slice(-limit)
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(part => part && part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n').trim()
}

async function chatSend(ctx, sessionId, text, mode) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty message')
  await ctx.sessionController.prompt({
    requestId: randomUUID(), sessionId, mode: mode === 'steer' ? 'steer' : 'queue',
    content: [{ type: 'text', text: text.trim() }],
    clientTimeZone: 'Asia/Taipei',
  })
}

async function syncWorktree(repoPath) {
  const output = await requireSuccess(repoPath, ['pull', '--ff-only'])
  return { output: output.trim() }
}

async function chatNew(ctx, cwd) {
  const value = await ctx.sessionController.create({ cwd })
  return value.sessionId
}

/* ── plugin entry ────────────────────────────────────────────────────── */

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!allowed(req)) {
        json(res, 403, { error: 'the git-assistant API serves local same-origin requests only' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname.slice(PREFIX.length).replace(/\/+$/, '') || '/'
      try {
        if (req.method === 'GET' && route === '/ping') {
          json(res, 200, { ok: true, version: '0.2.0' })
          return
        }
        if (req.method === 'GET' && route === '/repositories') {
          json(res, 200, await discoverRepositories(ctx))
          return
        }

        if (req.method === 'GET' && route === '/local-commits') {
          const target = await knownCheckout(ctx, url.searchParams.get('path'))
          if (!target) { json(res, 400, { error: 'unknown checkout' }); return }
          const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 80))
          json(res, 200, await localCommitsOf(target.path, limit))
          return
        }
        if (req.method === 'GET' && route === '/commit-patch') {
          const target = await knownCheckout(ctx, url.searchParams.get('path'))
          if (!target) { json(res, 400, { error: 'unknown checkout' }); return }
          const hash = url.searchParams.get('hash')
          if (!hash || !/^[0-9a-f]{4,64}$/i.test(hash)) { json(res, 400, { error: 'invalid hash' }); return }
          json(res, 200, await commitPatchOf(target.path, hash))
          return
        }
        if (req.method === 'GET' && route === '/commit') {
          const target = await knownCheckout(ctx, url.searchParams.get('path'))
          if (!target) { json(res, 400, { error: 'unknown checkout' }); return }
          const hash = url.searchParams.get('hash')
          if (!hash || !/^[0-9a-f]{4,64}$/i.test(hash)) { json(res, 400, { error: 'invalid hash' }); return }
          json(res, 200, await commitOf(target.path, hash))
          return
        }
        if (req.method === 'GET' && route === '/commit-diff') {
          const target = await knownCheckout(ctx, url.searchParams.get('path'))
          if (!target) { json(res, 400, { error: 'unknown checkout' }); return }
          const hash = url.searchParams.get('hash')
          const file = url.searchParams.get('file')
          if (!hash || !/^[0-9a-f]{4,64}$/i.test(hash) || !file) { json(res, 400, { error: 'invalid commit diff request' }); return }
          json(res, 200, { file, hash, files: await commitDiffOf(target.path, hash, file) })
          return
        }
        if (req.method === 'GET' && route === '/fs/list') {
          const target = await knownCheckout(ctx, url.searchParams.get('path'))
          if (!target) { json(res, 400, { error: 'unknown checkout' }); return }
          json(res, 200, listDirectory(target.path, url.searchParams.get('dir') ?? ''))
          return
        }
        if (req.method === 'GET' && route === '/graph') {
          const path = url.searchParams.get('path')
          const checkout = await knownCheckout(ctx, path)
          if (!checkout) { json(res, 400, { error: 'unknown checkout' }); return }
          const limit = Math.max(20, Math.min(400, Number(url.searchParams.get('limit')) || 150))
          const skip = Math.max(0, Number(url.searchParams.get('skip')) || 0)
          const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'branch'
          json(res, 200, await graphOf(checkout.path, limit, skip, scope))
          return
        }
        if (req.method === 'GET' && route === '/worktrees') {
          const path = url.searchParams.get('path')
          const checkout = await knownCheckout(ctx, path)
          if (!checkout) { json(res, 400, { error: 'unknown checkout' }); return }
          json(res, 200, await worktreesOf(checkout.path))
          return
        }
        if (req.method === 'GET' && route === '/chat/history') {
          const sessionId = url.searchParams.get('sessionId')
          if (!sessionId) { json(res, 400, { error: 'missing sessionId' }); return }
          json(res, 200, { messages: await chatHistory(ctx, sessionId) })
          return
        }
        if (req.method === 'GET' && ['/status', '/branches', '/diff', '/file', '/files', '/raw'].includes(route)) {
          const path = url.searchParams.get('path')
          const checkout = await knownCheckout(ctx, path)
          if (!checkout) { json(res, 400, { error: 'unknown checkout' }); return }
          if (route === '/status') { json(res, 200, await statusOf(checkout.path)); return }
          if (route === '/branches') { json(res, 200, { branches: await branchesOf(checkout.path) }); return }
          if (route === '/files') { json(res, 200, await filesOf(checkout.path)); return }
          const file = url.searchParams.get('file')
          if (!file) { json(res, 400, { error: 'missing file' }); return }
          if (route === '/diff') {
            const staged = url.searchParams.get('staged') === '1'
            json(res, 200, { file, staged, files: await diffOf(checkout.path, file, staged) })
            return
          }
          if (route === '/raw') { rawFile(checkout.path, file, res, url.searchParams.get('download') === '1'); return }
          json(res, 200, readTextFile(checkout.path, file))
          return
        }

        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const checkout = await knownCheckout(ctx, body?.path)
          if (!checkout) { json(res, 400, { error: 'unknown checkout' }); return }
          if (route === '/reveal') {
            if (!body.file) { json(res, 400, { error: 'missing file' }); return }
            revealInFileManager(checkout.path, body.file)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/open') {
            if (!body.file) { json(res, 400, { error: 'missing file' }); return }
            openWithDefaultApp(checkout.path, body.file)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/sync') {
            await syncWorktree(checkout.path)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/chat/send') {
            await chatSend(ctx, body.sessionId, body.text, body.mode)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/chat/new') {
            const sessionId = await chatNew(ctx, body.path)
            json(res, 200, { ok: true, sessionId })
            return
          }
          if (route === '/stage') {
            const files = safeFileList(body.files)
            if (!files) { json(res, 400, { error: 'invalid file list' }); return }
            await stageFiles(checkout.path, files)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/unstage') {
            const files = safeFileList(body.files)
            if (!files) { json(res, 400, { error: 'invalid file list' }); return }
            await unstageFiles(checkout.path, files)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/discard') {
            const files = safeFileList(body.files)
            if (!files) { json(res, 400, { error: 'invalid file list' }); return }
            await discardFiles(checkout.path, files)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/commit') {
            const message = typeof body.message === 'string' ? body.message : ''
            const action = typeof body.action === 'string' ? body.action : (body.amend ? 'amend' : 'commit')
            const result = await commitFiles(checkout.path, message, action)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true, ...result })
            return
          }
          if (route === '/switch') {
            await switchBranch(checkout.path, body.branch)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true })
            return
          }
          if (route === '/branch/create') {
            await createBranch(checkout.path, body.name, body.from)
            clearDiffCache(checkout.path)
            json(res, 200, { ok: true })
            return
          }
          json(res, 404, { error: `unknown route ${route}` })
          return
        }

        json(res, 404, { error: `unknown route ${req.method ?? 'GET'} ${route}` })
      } catch (error) {
        ctx.logger.warn('dsh-git-assistant: %s', error instanceof Error ? error.stack ?? error.message : error)
        json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-git-assistant: git API')
}

/** Exposed for local parser checks only; not part of the plugin surface. */
export const internals = { parseWorktrees, parseStatus, parseUnifiedDiff, filesOf: (repoPath) => filesOf(repoPath), stageFiles, unstageFiles, discardFiles, commitFiles, switchBranch, createBranch }
