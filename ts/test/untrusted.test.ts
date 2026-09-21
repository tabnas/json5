/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

// Untrusted input: what a parser reached from the outside must do with
// input nobody designed for it.
//
// The counterpart of `rs/tests/untrusted_test.rs` and
// `go/untrusted_test.go`. The three files hold the SAME cases, because
// the behaviour is ordinary JSON5 behaviour that every runtime owes:
// deep nesting, very long input, unterminated constructs, empty input,
// control characters and odd Unicode must not hang, overflow or take
// super-linear time. A case that lived in one suite alone would let the
// other two regress while that suite stayed green, which is the whole of
// what the parity contract forbids.
//
// The one case that is NOT here is the Rust port's depth cap. That bound
// is `tabnas_jsonic`'s, it exists because a Rust `Value` walks its own
// nesting when it is converted and again when it is dropped, and it is a
// recorded divergence: nesting is unbounded in this runtime, which
// `json5.test.ts` pins under `nesting-is-unbounded`.
//
// Sizes match the Rust file exactly, so the three suites measure the
// same thing. Every case asserts an OUTCOME, not merely that the call
// returned: a test that only proves "no crash" passes just as well when
// the parser has started answering nonsense.

import { describe, test } from 'node:test'
import assert from 'node:assert'

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { Json5 } from '../dist/json5'

function make() {
  return new Tabnas().use(jsonic).use(Json5)
}

// The error code, or 'OK' when the parse succeeds.
function code(j: any, src: string): string {
  try {
    j.parse(src)
    return 'OK'
  } catch (err: any) {
    return err.code
  }
}

describe('untrusted', () => {
  // Empty, blank, byte-order-mark-only and comments-only sources are the
  // ways to send nothing, and each has its code. The short forms are
  // shared fixture rows in test/spec/options.tsv; the long ones are here
  // because a megabyte does not fit a fixture cell.
  test('a-source-with-no-value-in-it-is-refused-with-a-code', () => {
    const j = make()
    assert.strictEqual(code(j, ''), 'json5_empty')
    assert.strictEqual(code(j, ' '.repeat(100_000)), 'json5_no_value')
    assert.strictEqual(code(j, '﻿'), 'json5_no_value')
    assert.strictEqual(code(j, '/*a*/'.repeat(200_000)), 'json5_no_value')
  })

  // A control character is not a value, and a very long run of them is
  // not a long parse: the first one is refused where it stands.
  test('control-characters-are-refused-where-they-stand', () => {
    const j = make()
    for (const src of ['\u0000', '\u0001\u0002\u0003', '\u007F']) {
      assert.strictEqual(code(j, src), 'unexpected', JSON.stringify(src))
    }
    let thrown: any
    try {
      j.parse('\u0001'.repeat(100_000))
    } catch (err) {
      thrown = err
    }
    assert.deepStrictEqual(
      [thrown?.code, thrown?.lineNumber, thrown?.columnNumber],
      ['unexpected', 1, 1],
    )
  })

  // An unterminated construct ends the parse with its own code, however
  // much of it there is. The long forms are the interesting ones: the
  // scanner runs to the end of the source before it can know, so this is
  // where an unbounded read or a quadratic rescan would show.
  test('unterminated-constructs-are-refused-at-any-length', () => {
    const j = make()
    const long = 'a'.repeat(2_000_000)
    assert.strictEqual(code(j, '"' + long), 'unterminated_string')
    assert.strictEqual(code(j, "'" + long), 'unterminated_string')
    assert.strictEqual(code(j, '/*' + long), 'unterminated_comment')
    // A trailing backslash run is an unterminated string too: the last
    // backslash escapes the closing quote that never arrives.
    assert.strictEqual(
      code(j, '"' + '\\'.repeat(500_000)),
      'unterminated_string',
    )
    // Unterminated INSIDE a structure still reports the string, at the
    // position the string opened. json5's errors carry the position as
    // lineNumber / columnNumber, not row / col.
    let thrown: any
    try {
      j.parse('['.repeat(50) + '"abc')
    } catch (err) {
      thrown = err
    }
    assert.deepStrictEqual(
      [thrown?.code, thrown?.lineNumber, thrown?.columnNumber],
      ['unterminated_string', 1, 51],
    )
  })

  // Very long WELL-FORMED input parses, and parses to the right thing.
  // The size is the point: a bound that refused these would be a bound
  // on legitimate documents, and a scanner that mangled them would be
  // worse than one that refused them.
  test('very-long-well-formed-input-parses-to-the-right-value', () => {
    const j = make()

    const body = 'a'.repeat(2_000_000)
    assert.strictEqual((j.parse('"' + body + '"') as string).length, 2_000_000)

    // A 500,000-digit integer is finite input and an infinite double.
    assert.strictEqual(j.parse('9'.repeat(500_000)), Infinity)

    // A 500,000-character unquoted key is an IdentifierName, and the
    // whole of it is the key.
    const key = 'a'.repeat(500_000)
    const keyed = j.parse('{' + key + ':1}') as Record<string, unknown>
    const names = Object.keys(keyed)
    assert.strictEqual(names.length, 1)
    assert.strictEqual(names[0].length, 500_000)

    // 200,000 line continuations collapse to the empty string, and the
    // rewrite that strips them does not go quadratic doing it.
    assert.strictEqual(j.parse('"' + '\\\n'.repeat(200_000) + '"'), '')

    // 200,000 unicode escapes decode one for one.
    const escaped = j.parse('"' + '\\u0041'.repeat(200_000) + '"') as string
    assert.strictEqual(escaped.length, 200_000)
    assert.strictEqual(escaped, 'A'.repeat(200_000))
  })

  // A wide container is the other direction from a deep one: what bounds
  // exist bound DEPTH, and breadth is unbounded on purpose, so a document
  // with many siblings must arrive whole rather than truncated at a cap.
  test('a-wide-container-arrives-whole', () => {
    const j = make()
    const WIDTH = 5_000

    const array = j.parse('[' + '1,'.repeat(WIDTH) + ']') as unknown[]
    assert.strictEqual(array.length, WIDTH)

    let object = '{'
    for (let index = 0; index < WIDTH; index++) {
      object += 'k' + index + ':1,'
    }
    object += '}'
    assert.strictEqual(
      Object.keys(j.parse(object) as Record<string, unknown>).length,
      WIDTH,
    )
  })
})
