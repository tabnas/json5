#!/usr/bin/env node
/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

/*
 * gen-json5-expected.js — build the expected-VALUE oracle for the vendored
 * json5/json5-tests corpus, and (with --check) verify that the committed
 * oracle still matches the committed corpus.
 *
 * json5-tests encodes only the expected OUTCOME in the file extension; it
 * ships no expected values. Its own README states how a value is obtained:
 *
 *   .json  "tested via JSON.parse()"
 *   .json5 "tested via eval()"
 *   .js    valid ES5, explicitly disallowed by JSON5 -> must fail
 *   .txt   invalid ES5                               -> must fail
 *
 * So the ES5 engine is the oracle. This script applies it once and writes a
 * manifest that BOTH runtimes assert against, which is what stops the suite
 * degenerating into "it did not throw". Go has no ES5 evaluator, so the
 * oracle has to be precomputed for the two runtimes to assert the same thing.
 *
 * Values are compared as a canonical STRING (see canon() below) so that the
 * TypeScript and Go runners can agree exactly without a shared value model:
 *
 *   null / true / false      -> "null" / "true" / "false"
 *   number                   -> "#<16 hex digits>" = IEEE-754 float64 bits
 *                               (exact: distinguishes 0 from -0, pins every
 *                               rounding decision), or NaN / Infinity /
 *                               -Infinity for the non-finite JSON5 literals
 *   string                   -> ASCII-only quoted form, every code unit
 *                               outside 0x20..0x7e as \uXXXX
 *   array                    -> [a,b,c]
 *   object                   -> {k:v,...} with keys sorted by their (ASCII)
 *                               quoted form, so key ORDER never matters and
 *                               UTF-16 vs UTF-8 sort order cannot diverge
 *
 * The canonicaliser is duplicated in three places and the three copies must
 * stay byte-compatible: this file, ts/test/suite.test.ts, go/suite_test.go.
 *
 * Usage:
 *   node scripts/gen-json5-expected.js            regenerate the manifest
 *   node scripts/gen-json5-expected.js --check    fail if it is out of date
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const CORPUS = path.join(ROOT, 'test', 'json5-tests')
const OUT = path.join(ROOT, 'test', 'json5-tests-expected.json')
const CHECK = process.argv.includes('--check')

const HEX = '0123456789abcdef'
const numBuf = new DataView(new ArrayBuffer(8))

function quote(s) {
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

function canonNumber(n) {
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

function canon(v) {
  if (v === null || v === undefined) return 'null'
  const t = typeof v
  if (t === 'boolean') return v ? 'true' : 'false'
  if (t === 'number') return canonNumber(v)
  if (t === 'string') return quote(v)
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (t === 'object') {
    const entries = Object.keys(v).map((k) => [quote(k), canon(v[k])])
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return '{' + entries.map(([k, val]) => k + ':' + val).join(',') + '}'
  }
  throw new Error('uncanonicalisable value of type ' + t)
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    if ('.git' === name) continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// The upstream oracle. Newlines around the source so a fixture ending in a
// `//` line comment cannot swallow the closing paren.
function es5(src) {
  // eslint-disable-next-line no-eval
  return eval('(\n' + src + '\n)')
}

function es5Rejects(src) {
  try {
    es5(src)
    return false
  } catch {
    return true
  }
}

// Candidates are each placed on their own line so a fixture ending in a `//`
// comment cannot hide them. `trailing` is an ES5 identifier and `"x"` a
// string literal, so neither is rejected for containing an unknown character
// — they are rejected purely because a second top-level value follows the
// first, which is precisely the leniency being probed.
const TRAILING_CANDIDATES = ['\n@', '\ntrailing', '\n"x"', '\n1']

function build() {
  const files = walk(CORPUS).filter((f) => /\.(json|json5|js|txt)$/.test(f))
  if (0 === files.length) {
    throw new Error('no fixtures found under ' + CORPUS)
  }

  const cases = {}
  let valid = 0
  let invalid = 0

  for (const file of files) {
    const rel = path.relative(CORPUS, file).split(path.sep).join('/')
    const src = fs.readFileSync(file, 'utf8')
    const ext = path.extname(file)

    if ('.js' === ext || '.txt' === ext) {
      // Must be REJECTED by a JSON5 parser. No value.
      cases[rel] = { outcome: 'error' }
      invalid++
      continue
    }

    const evalValue = es5(src)

    let oracle = 'eval'
    if ('.json' === ext) {
      // Upstream says .json fixtures are checked with JSON.parse. One is
      // mis-extensioned upstream and is JSON5-only
      // (comments/irregular-block-comment.json holds a block comment). It
      // still MUST parse — only the oracle falls back to eval. Where
      // JSON.parse does work it must AGREE with eval, and a disagreement is
      // a hard error rather than a silent preference.
      let jsonValue
      let jsonOk = false
      try {
        jsonValue = JSON.parse(src)
        jsonOk = true
      } catch (e) {
        oracle = 'eval (JSON.parse rejected: ' + e.message + ')'
      }
      if (jsonOk) {
        oracle = 'JSON.parse'
        if (canon(jsonValue) !== canon(evalValue)) {
          throw new Error(
            `oracle disagreement on ${rel}: JSON.parse=${canon(jsonValue)} eval=${canon(evalValue)}`,
          )
        }
      }
    }

    cases[rel] = { outcome: 'value', canon: canon(evalValue), oracle }
    valid++
  }

  // --- DERIVED supplement (NOT part of json5/json5-tests) -------------------
  //
  // json5/json5-tests contains no truncated documents and no trailing-garbage
  // documents, so on its own it cannot see the leniency class: a base grammar
  // that auto-closes an unterminated document, or that ignores text after a
  // complete value, passes the whole official corpus.
  //
  // These cases are DERIVED mechanically from the corpus and gated by the same
  // ES5 oracle, so nothing here is invented: JSON5 is a strict subset of ES5,
  // therefore any string the ES5 engine REJECTS must also be rejected by a
  // JSON5 parser.
  //
  //   truncations[rel] = [n, ...]  rune-prefix lengths ES5 accepts. Every
  //                                OTHER prefix length in 1..len-1 is
  //                                ES5-rejected and must be a JSON5 error.
  //                                Storing the (tiny) accepted set rather
  //                                than the rejected one keeps this manifest
  //                                small and reviewable.
  //   trailing[rel]    = ["\n@", ...]  suffixes for which fixture+suffix is
  //                                not valid ES5, hence must be a JSON5 error
  const truncSkip = {}
  const trailing = {}
  let truncCount = 0
  let trailingCount = 0

  for (const file of files) {
    const ext = path.extname(file)
    if ('.json' !== ext && '.json5' !== ext) continue
    const rel = path.relative(CORPUS, file).split(path.sep).join('/')
    const runes = Array.from(fs.readFileSync(file, 'utf8'))

    const skip = []
    for (let n = 1; n < runes.length; n++) {
      if (es5Rejects(runes.slice(0, n).join(''))) truncCount++
      else skip.push(n)
    }
    truncSkip[rel] = skip

    const full = runes.join('')
    const suffixes = TRAILING_CANDIDATES.filter((s) => es5Rejects(full + s))
    if (0 < suffixes.length) {
      trailing[rel] = suffixes
      trailingCount += suffixes.length
    }
  }

  return {
    _comment:
      'GENERATED by scripts/gen-json5-expected.js from the vendored test/json5-tests corpus. Do not hand-edit: run `npm run gen-suite-expected` (or `make gen-suite-expected`) instead. `npm test` verifies it is up to date.',
    upstream: 'https://github.com/json5/json5-tests',
    oracle: 'JSON.parse for .json, ES5 eval for .json5 (per json5-tests README)',
    counts: {
      valid,
      invalid,
      total: valid + invalid,
      derivedTruncations: truncCount,
      derivedTrailing: trailingCount,
    },
    cases,
    derived: {
      _comment:
        'DERIVED from the corpus by this script, NOT part of json5/json5-tests. `truncations` lists the prefix lengths ES5 ACCEPTS; every other prefix length of that fixture is ES5-rejected and must therefore be a JSON5 parse error too.',
      truncations: truncSkip,
      trailing,
    },
  }
}

// Compact but reviewable: one line per case, derived arrays inline.
function render(manifest) {
  return JSON.stringify(manifest, null, 1).replace(
    /\[\n\s+([^[\]{}]*?)\n\s+\]/g,
    (_m, body) => '[' + body.split(/,\n\s*/).join(', ') + ']',
  )
}

function main() {
  const text = render(build()) + '\n'

  if (CHECK) {
    let have = null
    try {
      have = fs.readFileSync(OUT, 'utf8')
    } catch {
      /* missing */
    }
    if (have !== text) {
      console.error(
        'gen-json5-expected: ' +
          OUT +
          ' is ' +
          (null === have ? 'MISSING' : 'OUT OF DATE') +
          ' relative to test/json5-tests.\n' +
          'The conformance oracle no longer describes the committed corpus.\n' +
          'Regenerate it with:  npm run gen-suite-expected',
      )
      process.exit(1)
    }
    console.log('gen-json5-expected: manifest is up to date')
    return
  }

  fs.writeFileSync(OUT, text)
  const m = JSON.parse(text)
  console.log(
    `gen-json5-expected: ${m.counts.valid} valid + ${m.counts.invalid} invalid = ${m.counts.total} cases -> ${OUT}`,
  )
  console.log(
    `gen-json5-expected: derived (ES5-rejected) ${m.counts.derivedTruncations} truncations, ${m.counts.derivedTrailing} trailing-garbage`,
  )
}

try {
  main()
} catch (e) {
  console.error('gen-json5-expected: ' + String((e && e.message) || e))
  process.exit(1)
}
