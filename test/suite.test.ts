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

// Fixtures the TS plugin cannot satisfy because the underlying Jsonic parser
// is more permissive than the JSON5 spec in these specific cases. The
// standalone Go parser handles all of them. Listed here to detect
// regressions rather than hide them: any other fixture must still pass.
const knownDeviations = new Set<string>([
  // Jsonic accepts a file containing only whitespace/comments as empty.
  'comments/top-level-inline-comment.txt',
  'comments/top-level-block-comment.txt',
  // Jsonic's whitespace set does not include all Unicode Zs category chars.
  'misc/valid-whitespace.json5',
  // Backslash + CRLF line continuation in strings is not handled.
  'new-lines/escaped-crlf.json5',
  // Uppercase `0X` hex prefix is not recognised.
  'numbers/hexadecimal-uppercase-x.json5',
  // Jsonic accepts JS octal and noctal number literals.
  'numbers/negative-noctal.js',
  'numbers/negative-octal.txt',
  'numbers/negative-zero-octal.txt',
  'numbers/noctal-with-leading-octal-digit.js',
  'numbers/noctal.js',
  'numbers/octal.txt',
  'numbers/positive-noctal.js',
  'numbers/positive-octal.txt',
  'numbers/positive-zero-octal.txt',
  'numbers/zero-octal.txt',
  // Jsonic accepts some malformed object keys and lone trailing commas.
  'objects/illegal-unquoted-key-number.txt',
  'objects/illegal-unquoted-key-symbol.txt',
  'objects/lone-trailing-comma-object.txt',
])

describe('json5-tests suite', () => {
  if (!existsSync(suiteRoot)) {
    test('skipped: suite not present', () => {
      // No-op: the official corpus is optional.
    })
    return
  }

  const j = Jsonic.make().use(Json5)
  const files = walk(suiteRoot).filter((f) =>
    /\.(json|json5|js|txt)$/.test(f),
  )

  for (const file of files) {
    const name = relative(suiteRoot, file).split(sep).join('/')
    test(name, (t) => {
      if (knownDeviations.has(name)) {
        t.skip(`known Jsonic deviation`)
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
