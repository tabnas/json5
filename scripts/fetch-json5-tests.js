#!/usr/bin/env node
/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

/*
 * fetch-json5-tests.js — fetch the official JSON5 conformance corpus.
 *
 *   upstream: https://github.com/json5/json5-tests
 *   pinned:   ceb24d4080137d70833f86c25659c1331b80a387  (2026-02-20)
 *
 * The corpus is a THIRD-PARTY test suite and is deliberately NOT committed to
 * this repository (project rule: never vendor a third-party corpus). It is
 * fetched into `test/json5-tests/`, which is .gitignore'd, exactly as toml/
 * does for BurntSushi/toml-test and xml/ does for the W3C XML suite.
 *
 * It then (re)generates `test/json5-tests-expected.json`, the expected-VALUE
 * oracle, via scripts/gen-json5-expected.js.
 *
 * This is the implementation; scripts/fetch-json5-tests.sh is a thin wrapper
 * around it. It is written in Node so that `npm test`'s `pretest` hook can run
 * it on Linux, macOS AND Windows — the corpus must never be absent at test
 * time, because a conformance suite that silently does not run is worse than
 * no suite at all.
 *
 * Idempotent: refetches only when the checkout is missing or at the wrong
 * commit; always regenerates the manifest.
 */

'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO_URL = 'https://github.com/json5/json5-tests.git'
const PINNED_SHA = 'ceb24d4080137d70833f86c25659c1331b80a387'

const ROOT = path.join(__dirname, '..')
const DEST = path.join(ROOT, 'test', 'json5-tests')
const MANIFEST = path.join(ROOT, 'test', 'json5-tests-expected.json')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (0 !== r.status) {
    throw new Error(
      `fetch-json5-tests: ${cmd} ${args.join(' ')} failed (${r.status})`,
    )
  }
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return 0 === r.status ? String(r.stdout).trim() : null
}

function main() {
  let needClone = true
  if (fs.existsSync(path.join(DEST, '.git'))) {
    const have = capture('git', ['-C', DEST, 'rev-parse', 'HEAD'])
    if (have === PINNED_SHA) needClone = false
  }

  if (needClone) {
    console.log(`fetch-json5-tests: fetching ${REPO_URL} @ ${PINNED_SHA}`)
    fs.rmSync(DEST, { recursive: true, force: true })
    fs.mkdirSync(DEST, { recursive: true })
    run('git', ['-C', DEST, 'init', '-q'])
    // CRLF translation corrupts the new-lines/* fixtures; force it off.
    run('git', ['-C', DEST, 'config', 'core.autocrlf', 'false'])
    run('git', ['-C', DEST, 'config', 'core.eol', 'lf'])
    run('git', ['-C', DEST, 'remote', 'add', 'origin', REPO_URL])
    run('git', ['-C', DEST, 'fetch', '-q', '--depth', '1', 'origin', PINNED_SHA])
    run('git', ['-C', DEST, 'checkout', '-q', 'FETCH_HEAD'])
  } else {
    console.log(`fetch-json5-tests: already at ${PINNED_SHA}`)
  }

  const got = capture('git', ['-C', DEST, 'rev-parse', 'HEAD'])
  if (got !== PINNED_SHA) {
    throw new Error(
      `fetch-json5-tests: checkout is at ${got}, expected ${PINNED_SHA}`,
    )
  }

  console.log('fetch-json5-tests: generating expected-value manifest')
  run(
    process.execPath,
    [path.join(__dirname, 'gen-json5-expected.js'), DEST, MANIFEST, PINNED_SHA],
    { stdio: 'inherit' },
  )

  console.log(`fetch-json5-tests: ok -> ${DEST}`)
  console.log(`fetch-json5-tests: ok -> ${MANIFEST}`)
}

try {
  main()
} catch (e) {
  console.error(String((e && e.message) || e))
  process.exit(1)
}
