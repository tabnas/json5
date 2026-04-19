/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

import { describe, test } from 'node:test'
import assert from 'node:assert'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { Jsonic } from 'jsonic'
import { Json5 } from '../dist/json5'

// Walks the vendored json5/json5-tests corpus and asserts that every fixture
// either parses or errors according to its file extension:
//   .json  valid JSON   (must parse)
//   .json5 valid JSON5  (must parse)
//   .js    valid ES5 but not JSON5 (must error)
//   .txt   invalid everywhere      (must error)
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const suiteRoot = join(__dirname, '..', 'test', 'json5-tests')
const deviationsPath = join(__dirname, '..', 'test', 'known-deviations.txt')

// The same file is consumed by the Go suite, so both implementations skip
// the same fixtures and exhibit identical pass/fail behaviour.
function loadKnownDeviations(path: string): Set<string> {
  const out = new Set<string>()
  if (!existsSync(path)) return out
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    out.add(line)
  }
  return out
}

describe('json5-tests suite', () => {
  if (!existsSync(suiteRoot)) {
    test('skipped: suite not present', () => {
      // No-op: the official corpus is optional.
    })
    return
  }

  const j = Jsonic.make().use(Json5)
  const deviations = loadKnownDeviations(deviationsPath)
  const files = walk(suiteRoot).filter((f) =>
    /\.(json|json5|js|txt)$/.test(f),
  )

  for (const file of files) {
    const name = relative(suiteRoot, file).split(sep).join('/')
    test(name, (t) => {
      if (deviations.has(name)) {
        t.skip('shared known deviation')
        return
      }
      const src = readFileSync(file, 'utf8')
      const shouldParse = /\.(json|json5)$/.test(file)
      let parsed = false
      try {
        j(src)
        parsed = true
      } catch {
        parsed = false
      }
      assert.equal(
        parsed,
        shouldParse,
        shouldParse
          ? `expected to parse: ${name}`
          : `expected parse error: ${name}`,
      )
    })
  }
})
