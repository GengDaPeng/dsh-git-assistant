import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('npm 发布包只包含完整的运行时文件', () => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const output = execFileSync(command, ['pack', '--dry-run', '--json'], { encoding: 'utf8' })
  // 某些 npm 版本会在 JSON 前后夹带人类可读输出：取第一个 '[' 到最后一个 ']'。
  const parsed = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1))
  const pack = Array.isArray(parsed) ? parsed[0] : parsed
  const paths = pack.files.map(({ path }) => path).sort()
  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'cordis.patch.yml',
    'icon.svg',
    'src/index.js',
    'src/client.js',
    'locale/zh.json',
    'locale/en.json',
  ]) {
    assert.ok(paths.includes(required), `发布包缺少 ${required}`)
  }
  for (const extra of paths) {
    assert.ok(!extra.includes('node_modules'), `不应打包 node_modules：${extra}`)
    assert.ok(!extra.startsWith('test/'), `不应打包测试：${extra}`)
    assert.ok(!extra.startsWith('scripts/'), `不应打包脚本：${extra}`)
    assert.ok(!extra.startsWith('docs/'), `不应打包文档：${extra}`)
  }
})

test('package.json 元数据满足发布要求', () => {
  assert.equal(manifest.private, undefined, '对外发布的包不应是 private')
  assert.equal(manifest.publishConfig?.access, 'public')
  assert.ok(manifest.description && manifest.description.length > 10, '缺少 description')
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length >= 5, 'keywords 太少')
  assert.ok(manifest.repository?.url?.includes('dsh-git-assistant'), '缺少 repository')
  assert.ok(manifest.homepage, '缺少 homepage')
  assert.ok(manifest.bugs?.url, '缺少 bugs')
  assert.equal(manifest.license, 'MIT')
  assert.ok(manifest.files?.includes('cordis.patch.yml'), 'files 必须打包 cordis.patch.yml')
  assert.ok(manifest.dsh?.bundle?.patch, '缺少 dsh bundle 清单')
})

test('版本与引擎声明一致', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, '版本号必须是 x.y.z')
  assert.ok(manifest.engines?.dsh, '缺少 engines.dsh')
  assert.ok(manifest.engines?.node, '缺少 engines.node')
})
