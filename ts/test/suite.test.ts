/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

/*
 * suite.test.ts — the official json5/json5-tests conformance corpus.
 *
 * The corpus is vendored under `test/json5-tests/` (upstream MIT, see its
 * LICENSE.md) so it is present unconditionally — in a clean clone, offline,
 * and in CI. `test/json5-tests-expected.json` is the generated expected-VALUE
 * oracle (`scripts/gen-json5-expected.js`: JSON.parse for `.json`, ES5 `eval`
 * for `.json5`, the oracle json5-tests' own README prescribes); `npm test`
 * re-checks it against the corpus via `pretest`.
 *
 * This runner asserts BOTH halves:
 *
 *   valid (.json/.json5)  must parse AND produce the canonical expected value
 *   invalid (.js/.txt)    must be REJECTED with an error
 *
 * Asserting the value matters: parse-vs-error alone cannot see a fixture that
 * parses to the wrong thing, and 57 of the 83 valid fixtures are `.json5`,
 * i.e. exactly the syntax this plugin exists to implement.
 *
 * It MUST NOT be possible for this suite to skip. If the corpus or the
 * manifest is missing the suite FAILS — a conformance test that quietly does
 * not run is a green tick that lies.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep, extname } from 'node:path'

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { Json5 } from '../dist/json5'

// --- canonical value form; must stay byte-compatible with
// --- scripts/gen-json5-expected.js and go/suite_test.go
const HEX = '0123456789abcdef'
const numBuf = new DataView(new ArrayBuffer(8))

function quote(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x22) out += '\\"'
    else if (c === 0x5c) out += '\\\\'
    else if (0x20 <= c && c <= 0x7e) out += s[i]
    else {
      out +=
        '\\u' +
        HEX[(c >> 12) & 0xf] +
        HEX[(c >> 8) & 0xf] +
        HEX[(c >> 4) & 0xf] +
        HEX[c & 0xf]
    }
  }
  return out + '"'
}

function canonNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN'
  if (n === Infinity) return 'Infinity'
  if (n === -Infinity) return '-Infinity'
  numBuf.setFloat64(0, n)
  let hex = ''
  for (let i = 0; i < 8; i++) {
    const b = numBuf.getUint8(i)
    hex += HEX[(b >> 4) & 0xf] + HEX[b & 0xf]
  }
  return '#' + hex
}

function canon(v: any): string {
  if (v === null || v === undefined) return 'null'
  const t = typeof v
  if (t === 'boolean') return v ? 'true' : 'false'
  if (t === 'number') return canonNumber(v)
  if (t === 'string') return quote(v)
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (t === 'object') {
    const entries = Object.keys(v).map(
      (k) => [quote(k), canon(v[k])] as [string, string],
    )
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return '{' + entries.map(([k, val]) => k + ':' + val).join(',') + '}'
  }
  throw new Error('uncanonicalisable value of type ' + t)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if ('.git' === name) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const repoRoot = join(__dirname, '..', '..')
const suiteRoot = join(repoRoot, 'test', 'json5-tests')
const manifestPath = join(repoRoot, 'test', 'json5-tests-expected.json')

const MISSING =
  'The json5/json5-tests conformance corpus is not usable.\n' +
  'It is vendored at test/json5-tests/ with its generated oracle at\n' +
  'test/json5-tests-expected.json (regenerate: npm run gen-suite-expected).\n' +
  'This suite must never skip: a conformance run that silently does not\n' +
  'happen is the defect this harness exists to prevent.'

const present = existsSync(suiteRoot) && existsSync(manifestPath)

describe('json5-tests suite', () => {
  // Hard failure, never a skip.
  test('corpus and oracle present', () => {
    assert.ok(existsSync(suiteRoot), MISSING + '\nmissing dir: ' + suiteRoot)
    assert.ok(
      existsSync(manifestPath),
      MISSING + '\nmissing oracle: ' + manifestPath,
    )
  })

  if (!present) return

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const cases: Record<string, { outcome: string; canon?: string }> =
    manifest.cases

  const j = new Tabnas().use(jsonic).use(Json5)
  const files = walk(suiteRoot).filter((f) => /\.(json|json5|js|txt)$/.test(f))

  test('corpus is fully enumerated', () => {
    assert.ok(0 < files.length, 'no fixtures discovered under ' + suiteRoot)
    assert.equal(
      files.length,
      Object.keys(cases).length,
      'corpus file count does not match the generated oracle — run: npm run gen-suite-expected',
    )
  })

  for (const file of files) {
    const name = relative(suiteRoot, file).split(sep).join('/')
    test(name, () => {
      const expect = cases[name]
      assert.ok(expect, 'no oracle entry for ' + name)

      const src = readFileSync(file, 'utf8')
      const ext = extname(file)
      const shouldParse = '.json' === ext || '.json5' === ext
      assert.equal(
        shouldParse,
        'value' === expect.outcome,
        'oracle/extension disagree for ' + name,
      )

      let value: any
      let err: any = null
      try {
        value = j.parse(src)
      } catch (e) {
        err = e
      }

      if (!shouldParse) {
        assert.ok(
          null !== err,
          `expected parse error, but parsed to: ${canon(value)}`,
        )
        return
      }

      assert.equal(err, null, `expected to parse, got error: ${err && err.message}`)
      // Both halves: it parsed AND it is the right value.
      assert.equal(canon(value), expect.canon, 'wrong parsed value')
    })
  }

  // --- DERIVED supplement (NOT part of json5/json5-tests) ------------------
  //
  // Every case below is a string the ES5 engine itself rejects. JSON5 is a
  // strict subset of ES5, so a JSON5 parser must reject them too. They exist
  // because the official corpus has no truncated and no trailing-garbage
  // documents, and therefore cannot see base-grammar leniency leaking through
  // the plugin: a parser that auto-closes `{a:1` or that silently discards
  // everything after the first complete top-level value passes the whole
  // official corpus. Mirrored by the same block in go/suite_test.go.
  describe('derived: truncation must not auto-close', () => {
    const es5Accepts: Record<string, number[]> =
      (manifest.derived && manifest.derived.truncations) || {}
    for (const rel of Object.keys(es5Accepts)) {
      test(rel, () => {
        const runes = Array.from(readFileSync(join(suiteRoot, rel), 'utf8'))
        const skip = new Set(es5Accepts[rel])
        const accepted: string[] = []
        let probed = 0
        for (let n = 1; n < runes.length; n++) {
          if (skip.has(n)) continue
          probed++
          const src = runes.slice(0, n).join('')
          try {
            const v = j.parse(src)
            accepted.push(`${JSON.stringify(src)} -> ${canon(v)}`)
          } catch {
            /* correct: rejected */
          }
        }
        assert.deepEqual(
          accepted,
          [],
          `${accepted.length}/${probed} ES5-invalid truncations were ACCEPTED, e.g.\n  ` +
            accepted.slice(0, 5).join('\n  '),
        )
      })
    }
  })

  describe('derived: trailing garbage must not be ignored', () => {
    const trailing: Record<string, string[]> =
      (manifest.derived && manifest.derived.trailing) || {}
    for (const rel of Object.keys(trailing)) {
      test(rel, () => {
        const base = readFileSync(join(suiteRoot, rel), 'utf8')
        const accepted: string[] = []
        for (const suffix of trailing[rel]) {
          try {
            const v = j.parse(base + suffix)
            accepted.push(`${JSON.stringify(suffix)} -> ${canon(v)}`)
          } catch {
            /* correct: rejected */
          }
        }
        assert.deepEqual(
          accepted,
          [],
          `${accepted.length}/${trailing[rel].length} ES5-invalid trailing suffixes were ACCEPTED (garbage after a complete value silently ignored):\n  ` +
            accepted.join('\n  '),
        )
      })
    }
  })
})
