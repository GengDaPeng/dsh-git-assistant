import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs'
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

test('stash push, list and pop round-trip through the host helpers', async () => {
  const repo = makeRepo()
  try {
    appendFileSync(join(repo, 'a.txt'), 'stashed line\n')
    writeFileSync(join(repo, 'untracked.txt'), 'new file\n')
    await internals.stashPush(repo, 'host stash note')

    const listed = await internals.stashesOf(repo)
    assert.equal(listed.stashes.length, 1)
    assert.equal(listed.stashes[0].index, 0)
    assert.equal(listed.stashes[0].selector, 'stash@{0}')
    assert.match(listed.stashes[0].subject, /host stash note/)
    assert.ok(listed.stashes[0].time > 0)
    assert.equal(git(repo, ['status', '--porcelain']).trim(), '')

    await internals.stashPop(repo, 0)
    const afterPop = await internals.stashesOf(repo)
    assert.equal(afterPop.stashes.length, 0)
    assert.match(git(repo, ['status', '--porcelain']), /a\.txt/)
    assert.match(git(repo, ['status', '--porcelain']), /untracked\.txt/)
  } finally {
    dropRepo(repo)
  }
})

test('stash push reports a friendly error when there is nothing to stash', async () => {
  const repo = makeRepo()
  try {
    await assert.rejects(() => internals.stashPush(repo), /nothing to stash/)
    assert.equal((await internals.stashesOf(repo)).stashes.length, 0)
  } finally {
    dropRepo(repo)
  }
})

test('file history lists commits touching one file, newest first', async () => {
  const repo = makeRepo()
  try {
    writeFileSync(join(repo, 'b.txt'), 'one\n')
    git(repo, ['add', 'b.txt'])
    git(repo, ['commit', '-qm', 'add b'])
    appendFileSync(join(repo, 'b.txt'), 'two\n')
    git(repo, ['add', 'b.txt'])
    git(repo, ['commit', '-qm', 'touch b'])
    appendFileSync(join(repo, 'a.txt'), 'only a\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-qm', 'only a'])

    const history = await internals.fileHistoryOf(repo, 'b.txt', 40)
    assert.equal(history.file, 'b.txt')
    assert.equal(history.commits.length, 2)
    assert.match(history.commits[0].subject, /touch b/)
    assert.match(history.commits[1].subject, /add b/)
    assert.ok(history.commits[0].time >= history.commits[1].time)

    await assert.rejects(() => internals.fileHistoryOf(repo, '../outside.txt', 10))
  } finally {
    dropRepo(repo)
  }
})

test('issue write helpers validate their inputs and translate gh failures', async () => {
  const repo = makeRepo()
  try {
    git(repo, ['remote', 'add', 'origin', 'git@github.com:example/nope.git'])
    // CI 没有 gh 凭据：gh 会先报 GH_TOKEN；本机登录时才报 404。两类都算「翻译成功」。
    const ghFailure = /invalid issue number|no such issue|404|Not Found|GH_TOKEN/i
    await assert.rejects(() => internals.issueCommentAdd(repo, 0, 'x'), ghFailure)
    await assert.rejects(() => internals.issueCommentAdd(repo, 1, '   '), /comment body is empty/)
    await assert.rejects(() => internals.issueSetState(repo, 1, 'frozen'), /invalid issue state/)
  } finally {
    dropRepo(repo)
  }
})

test('branchesOf reports the worktree holding each branch and switchBranch refuses a held branch', async () => {
  const repo = makeRepo()
  const worktree = `${repo}-wt`
  const initialBranch = git(repo, ['branch', '--show-current']).trim()
  try {
    git(repo, ['branch', 'feature/held'])
    git(repo, ['worktree', 'add', '-q', worktree, 'feature/held'])

    const branches = await internals.branchesOf(repo)
    const held = branches.find(branch => branch.name === 'feature/held')
    const current = branches.find(branch => branch.current)
    assert.equal(held.current, false)
    assert.equal(realpathSync(held.worktree), realpathSync(worktree))
    assert.equal(held.worktreeName, worktree.split('/').pop())
    assert.equal(current.name, initialBranch)
    assert.equal(current.worktree, null)

    const holder = await internals.branchHolderOf(repo, 'feature/held')
    assert.equal(realpathSync(holder), realpathSync(worktree))

    await assert.rejects(
      () => internals.switchBranch(repo, 'feature/held'),
      error => error.code === 'branch-in-worktree' && realpathSync(error.worktree) === realpathSync(worktree),
    )
    assert.equal(git(repo, ['branch', '--show-current']).trim(), initialBranch)
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', worktree]) } catch { /* ignore */ }
    dropRepo(worktree)
    dropRepo(repo)
  }
})
