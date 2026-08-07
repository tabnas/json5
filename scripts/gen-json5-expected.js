#!/usr/bin/env node
/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

/*
 * gen-json5-expected.js — build the expected-VALUE oracle for the official
 * json5/json5-tests corpus.
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
 * degenerating into "it didn't throw".
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
 * Usage: node gen-json5-expected.js <corpus-dir> <out-json> <pinned-sha>
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const [, , CORPUS, OUT, SHA] = process.argv
if (!CORPUS || !OUT) {
  console.error('usage: gen-json5-expected.js <corpus-dir> <out-json> [sha]')
  process.exit(2)
}

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
    if (name === '.git') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(CORPUS).filter((f) => /\.(json|json5|js|txt)$/.test(f))
if (files.length === 0) {
  console.error('gen-json5-expected: no fixtures found under ' + CORPUS)
  process.exit(1)
}

const cases = {}
let valid = 0
let invalid = 0

for (const file of files) {
  const rel = path.relative(CORPUS, file).split(path.sep).join('/')
  const src = fs.readFileSync(file, 'utf8')
  const ext = path.extname(file)

  if (ext === '.js' || ext === '.txt') {
    // Must be REJECTED by a JSON5 parser. No value.
    cases[rel] = { outcome: 'error' }
    invalid++
    continue
  }

  // The upstream oracle. Newlines around the source so a fixture ending in a
  // `//` line comment does not swallow the closing paren.
  // eslint-disable-next-line no-eval
  const evalValue = eval('(\n' + src + '\n)')

  let oracle = 'eval'
  if (ext === '.json') {
    // Upstream says .json fixtures are checked with JSON.parse. A few are
    // mis-extensioned upstream and are JSON5-only (e.g.
    // comments/irregular-block-comment.json, added 2026-02, holds a block
    // comment). Those still MUST parse — only the oracle falls back to eval.
    // Where JSON.parse does work, it must agree with eval, and disagreement
    // is a hard error rather than a silent preference.
    try {
      const jsonValue = JSON.parse(src)
      oracle = 'JSON.parse'
      if (canon(jsonValue) !== canon(evalValue)) {
        throw new Error(
          `oracle disagreement on ${rel}: JSON.parse=${canon(jsonValue)} eval=${canon(evalValue)}`,
        )
      }
    } catch (e) {
      if (/^oracle disagreement/.test(e.message)) throw e
      oracle = 'eval (JSON.parse rejected: ' + e.message + ')'
    }
  }

  cases[rel] = { outcome: 'value', canon: canon(evalValue), oracle }
  valid++
}

// --- DERIVED supplement (NOT third-party) -----------------------------------
//
// json5/json5-tests contains no truncated documents and no trailing-garbage
// documents, so it cannot see the largest suspected defect class in these
// plugins: base-grammar leniency (auto-closing an unterminated document,
// ignoring text after a complete value).
//
// These extra cases are DERIVED mechanically from the corpus and are gated by
// the same ES5 oracle, so nothing here is invented: JSON5 is a strict subset
// of ES5, therefore any string the ES5 engine REJECTS must also be rejected by
// a JSON5 parser. Only prefixes/suffixes that eval() refuses are recorded.
//
//   truncations[rel] = [n, ...]  rune-prefix lengths of the fixture that ES5
//                                rejects, hence must be a JSON5 parse error
//   trailing[rel]    = ["\n@", ...]  suffixes for which fixture+suffix is not
//                                    valid ES5, hence must be a JSON5 error

function es5Rejects(src) {
  try {
    // eslint-disable-next-line no-eval
    eval('(\n' + src + '\n)')
    return false
  } catch (e) {
    return true
  }
}

// Each candidate is placed on its own line so a fixture ending in a `//`
// comment cannot hide it. `trailing` is an ES5 identifier and `"x"` a string
// literal, so neither is rejected for being an unknown character — they are
// rejected purely because a second top-level value follows the first, which
// is precisely the leniency being probed.
const TRAILING_CANDIDATES = ['\n@', '\ntrailing', '\n"x"', '\n1']

const truncations = {}
const trailing = {}
let truncCount = 0
let trailingCount = 0

for (const file of files) {
  const ext = path.extname(file)
  if ('.json' !== ext && '.json5' !== ext) continue
  const rel = path.relative(CORPUS, file).split(path.sep).join('/')
  const runes = Array.from(fs.readFileSync(file, 'utf8'))

  const lens = []
  for (let n = 1; n < runes.length; n++) {
    if (es5Rejects(runes.slice(0, n).join(''))) lens.push(n)
  }
  if (0 < lens.length) {
    truncations[rel] = lens
    truncCount += lens.length
  }

  const full = runes.join('')
  const suffixes = TRAILING_CANDIDATES.filter((s) => es5Rejects(full + s))
  if (0 < suffixes.length) {
    trailing[rel] = suffixes
    trailingCount += suffixes.length
  }
}

const manifest = {
  _comment:
    'GENERATED by scripts/gen-json5-expected.js from the json5/json5-tests corpus. Do not edit; do not commit.',
  upstream: 'https://github.com/json5/json5-tests',
  sha: SHA || null,
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
      'DERIVED from the corpus by this script, NOT part of json5/json5-tests. Every entry is an input the ES5 engine itself rejects, so a JSON5 parser must reject it too.',
    truncations,
    trailing,
  },
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 1) + '\n')
console.log(
  `gen-json5-expected: ${valid} valid + ${invalid} invalid = ${valid + invalid} cases -> ${OUT}`,
)
console.log(
  `gen-json5-expected: derived (ES5-rejected) ${truncCount} truncations, ${trailingCount} trailing-garbage`,
)
