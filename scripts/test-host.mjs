import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { internals } from '../src/index.js'

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'dsh-git-assistant-test-'))
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  writeFileSync(join(repo, 'a.txt'), 'hello\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-qm', 'initial'])
  return repo
}

function dropRepo(repo) {
  try { rmSync(repo, { recursive: true, force: true }) } catch { /* ignore */ }
}

test('parseUnifiedDiff parses new-file hunks', () => {
  const patch = [
    'diff --git a/a.txt b/a.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/a.txt',
    '@@ -0,0 +1,2 @@',
    '+hello',
    '+world',
  ].join('\n')
  const files = internals.parseUnifiedDiff(patch)
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'a.txt')
  assert.equal(files[0].newFile, true)
  assert.equal(files[0].hunks.length, 1)
  assert.equal(files[0].hunks[0].newStart, 1)
  assert.equal(files[0].hunks[0].lines.length, 2)
  assert.equal(files[0].hunks[0].lines[0].kind, 'add')
})

test('path guards reject traversal and absolute paths', () => {
  assert.equal(internals.safeRelativePath('src/a.ts'), true)
  assert.equal(internals.safeRelativePath('../outside.txt'), false)
  assert.equal(internals.safeRelativePath('/etc/passwd'), false)
  assert.equal(internals.safeRelativePath('a/../../b'), false)
  assert.equal(internals.safeRelativePath(''), false)
  assert.equal(internals.safeRelativePath(null), false)
  assert.equal(internals.safeFileList(['a.txt', 'src/b.ts'])?.length, 2)
  assert.equal(internals.safeFileList(['../a.txt']), undefined)
  assert.equal(internals.safeFileList([]), undefined)
})

test('diff parsing and cache invalidation on a real repository', async () => {
  const repo = makeRepo()
  try {
    assert.deepEqual(await internals.diffOf(repo, 'a.txt', false), [])

    const before = internals.diffCacheSize()
    appendFileSync(join(repo, 'a.txt'), 'world\n')
    const first = await internals.diffOf(repo, 'a.txt', false)
    assert.equal(first.length, 1)
    assert.equal(first[0].additions, 1)
    assert.ok(internals.diffCacheSize() > before)

    const second = await internals.diffOf(repo, 'a.txt', false)
    assert.equal(second[0].additions, 1)

    internals.clearDiffCache(repo)
    assert.equal(internals.diffCacheSize(), 0)

    await assert.rejects(() => internals.diffOf(repo, '../outside.txt', false))
  } finally {
    dropRepo(repo)
  }
})

test('stage, unstage and commit work through the host helpers', async () => {
  const repo = makeRepo()
  try {
    const listing = await internals.filesOf(repo)
    assert.ok(Array.isArray(listing.files))
    assert.ok(listing.files.includes('a.txt'))

    appendFileSync(join(repo, 'a.txt'), 'staged line\n')
    await internals.stageFiles(repo, ['a.txt'])
    assert.match(git(repo, ['diff', '--cached', '--name-only']), /a\.txt/)

    await internals.unstageFiles(repo, ['a.txt'])
    assert.doesNotMatch(git(repo, ['diff', '--cached', '--name-only']), /a\.txt/)

    await internals.stageFiles(repo, ['a.txt'])
    const result = await internals.commitFiles(repo, 'host unit test commit', 'commit')
    assert.equal(typeof result, 'object')
    assert.match(git(repo, ['log', '-1', '--pretty=%s']), /host unit test commit/)
    assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
  } finally {
    dropRepo(repo)
  }
})

test('branch create and switch helpers operate on the checkout', async () => {
  const repo = makeRepo()
  try {
    await internals.createBranch(repo, 'feature/test-branch')
    await internals.switchBranch(repo, 'feature/test-branch')
    assert.equal(git(repo, ['branch', '--show-current']).trim(), 'feature/test-branch')
  } finally {
    dropRepo(repo)
  }
})
