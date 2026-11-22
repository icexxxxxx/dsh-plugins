#!/usr/bin/env node
/**
 * One-command release for the dsh-plugins monorepo.
 *
 *   node scripts/release.mjs [patch|minor|major|x.y.z] [--dry-run] [--no-push]
 *
 * Steps: verify a clean main branch, run the self-test, bump both packages to the
 * same version, commit, regenerate index.json pinned to the new commit, commit the
 * index, tag vX.Y.Z, push, wait for the publish workflow, then verify npm and the
 * published index. Anything that fails stops the run and prints the next step.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'icexxxxxx/dsh-plugins'
const INDEX_URL = 'https://raw.githubusercontent.com/icexxxxxx/dsh-plugins/main/index.json'
const PROXY = 'http://127.0.0.1:7890'
const PACKAGES = [
  { dir: 'packages/memory', name: 'icex-dsh-memory' },
  { dir: 'packages/fixer', name: 'icex-dsh-fixer' },
]

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const noPush = argv.includes('--no-push')
const skipVerify = argv.includes('--skip-verify')
const bump = argv.find((arg) => !arg.startsWith('--')) ?? 'patch'

const log = (message) => console.log('[release] ' + message)
const fail = (message) => {
  console.error('[release] FAILED: ' + message)
  process.exit(1)
}

const git = (args) => {
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'inherit' })
}

const gitCapture = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Network git commands: try direct, then the local proxy (this host often needs it). */
const gitNetwork = (args) => {
  try {
    return gitCapture(args)
  } catch (error) {
    log('git ' + args[0] + ' failed directly (' + String(error.message).split('\n')[0] + '); retrying through ' + PROXY)
    return gitCapture(['-c', 'http.proxy=' + PROXY, '-c', 'https.proxy=' + PROXY, ...args])
  }
}

const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const writeJson = (path, value) => writeFileSync(join(root, path), JSON.stringify(value, null, 2) + '\n')

const parseSemver = (version) => {
  const [core, pre = ''] = String(version).split('-')
  const [major, minor, patch] = core.split('.').map((part) => Number(part))
  if (![major, minor, patch].every(Number.isFinite)) fail('not a SemVer version: ' + version)
  return { major, minor, patch, pre }
}

const compareSemver = (left, right) => {
  const a = parseSemver(left)
  const b = parseSemver(right)
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key]
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}

const nextVersion = (current) => {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump
  if (!['patch', 'minor', 'major'].includes(bump)) fail('bump must be patch, minor, major, or an exact x.y.z version')
  const base = parseSemver(current)
  if (bump === 'major') return (base.major + 1) + '.0.0'
  if (bump === 'minor') return base.major + '.' + (base.minor + 1) + '.0'
  return base.major + '.' + base.minor + '.' + (base.patch + 1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  log('checking repository state')
  if (gitCapture(['status', '--porcelain']) !== '') fail('working tree is dirty; commit or stash first')
  if (gitCapture(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('release from the main branch')
  if (!noPush) gitNetwork(['fetch', 'origin', 'main'])
  if (!noPush && gitCapture(['rev-parse', 'HEAD']) !== gitCapture(['rev-parse', 'origin/main'])) fail('local main is not equal to origin/main; pull or push first')

  log('running self-test')
  execFileSync(process.execPath, [join(root, 'scripts/selftest.mjs')], { cwd: root, stdio: 'inherit' })

  const versions = Object.fromEntries(PACKAGES.map((pkg) => [pkg.name, readJson(pkg.dir + '/package.json').version]))
  const current = Object.values(versions).sort(compareSemver).at(-1)
  const version = nextVersion(current)
  const tag = 'v' + version
  if (gitCapture(['tag', '-l', tag]) !== '') fail('tag ' + tag + ' already exists')

  log('release version: ' + current + ' -> ' + version)
  for (const pkg of PACKAGES) log('  ' + pkg.name + ' ' + versions[pkg.name] + ' -> ' + version)
  if (dryRun) {
    log('dry run: nothing written, tagged, or pushed')
    return
  }

  for (const pkg of PACKAGES) {
    const manifestPath = pkg.dir + '/package.json'
    const manifest = readJson(manifestPath)
    manifest.version = version
    writeJson(manifestPath, manifest)
  }
  git(['add', '--', ...PACKAGES.map((pkg) => pkg.dir + '/package.json')])
  git(['commit', '-m', 'release: ' + tag])

  const sha = gitCapture(['rev-parse', 'HEAD'])
  log('regenerating index.json for commit ' + sha.slice(0, 12))
  const index = readJson('index.json')
  for (const plugin of index.plugins) {
    plugin.versions = [{
      version,
      publishTimestamp: Math.floor(Date.now() / 1000),
      source: { type: 'npm' },
      engines: {},
    }]
  }
  writeJson('index.json', index)
  git(['add', '--', 'index.json'])
  git(['commit', '-m', 'docs: market index ' + tag])

  git(['tag', '-a', tag, '-m', 'release ' + version])
  if (noPush) {
    log('--no-push: committed and tagged locally; push with: git push origin main ' + tag)
    return
  }

  log('pushing main and ' + tag)
  gitNetwork(['push', 'origin', 'main'])
  gitNetwork(['push', 'origin', tag])

  log('waiting for the publish workflow')
  const run = await waitForRun(tag)
  if (run === null) fail('no workflow run appeared for ' + tag + '; check actions')
  if (run.conclusion !== 'success') fail('publish workflow ' + run.conclusion + ' — gh run view ' + run.databaseId)

  if (skipVerify) {
    log('skipped verification; tag ' + tag + ' published')
    return
  }

  log('verifying npm registry')
  for (const pkg of PACKAGES) await verifyNpm(pkg.name, version)
  log('verifying market index')
  await verifyIndex(version)

  log('done: ' + tag + ' published for ' + PACKAGES.map((pkg) => pkg.name).join(' and '))
  log('installed profile may need: dsh plugin --profile desktop add icex-dsh-memory@' + version)
}

async function waitForRun(tag) {
  const started = Date.now()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(attempt === 0 ? 6000 : 8000)
    let runs = []
    try {
      runs = JSON.parse(execFileSync('gh', ['run', 'list', '--repo', REPO, '--limit', '10', '--json',
        'databaseId,headBranch,status,conclusion,createdAt'], { encoding: 'utf8' }))
    } catch (error) {
      continue
    }
    const match = runs.find((item) => item.headBranch === tag)
    if (match === undefined) {
      if (Date.now() - started > 120000) return null
      continue
    }
    if (match.status === 'completed') return match
    log('  workflow ' + match.status + '…')
  }
  return null
}

async function verifyNpm(name, version) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const body = execFileSync('curl', ['-fsS', '-m', '10', 'https://registry.npmjs.org/' + name + '?t=' + Date.now()], { encoding: 'utf8' })
      const doc = JSON.parse(body)
      if (doc['dist-tags']?.latest === version || doc.versions?.[version] !== undefined) {
        log('  ' + name + '@' + version + ' live')
        return
      }
    } catch (error) {
      // Registry propagation and CDN edges need a few seconds.
    }
    await sleep(5000)
  }
  fail(name + '@' + version + ' did not appear on the npm registry')
}

async function verifyIndex(version) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const url = INDEX_URL + '?v=' + Date.now()
      let body
      try {
        body = execFileSync('curl', ['-fsS', '-m', '10', url], { encoding: 'utf8' })
      } catch (error) {
        body = execFileSync('curl', ['-fsS', '-m', '10', '-x', PROXY, url], { encoding: 'utf8' })
      }
      const doc = JSON.parse(body)
      const ok = doc.plugins.every((plugin) => plugin.versions?.every((item) => item.version === version && item.source?.type === 'npm'))
      if (ok) {
        log('  index lists ' + version + ' for every plugin')
        return
      }
    } catch (error) {
      // Raw GitHub content can trail the push by a minute.
    }
    await sleep(5000)
  }
  fail('published index did not show ' + version + ' in time')
}

main().catch((error) => fail(error.stack ?? String(error)))
