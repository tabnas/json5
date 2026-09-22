/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

import { describe, test } from 'node:test'
import assert from 'node:assert'

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { Json5 } from '../dist/json5'

// Deep-equal that treats two NaN values as equal.
function eq(actual: any, expected: any) {
  if (
    typeof actual === 'number' &&
    typeof expected === 'number' &&
    Number.isNaN(actual) &&
    Number.isNaN(expected)
  ) {
    return
  }
  assert.deepEqual(actual, expected)
}

describe('json5', () => {
  test('primitives', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('true'), true)
    eq(j.parse('false'), false)
    eq(j.parse('null'), null)
    eq(j.parse('42'), 42)
    eq(j.parse('3.14'), 3.14)
    eq(j.parse('-7'), -7)
    eq(j.parse('"hello"'), 'hello')
    eq(j.parse("'hello'"), 'hello')
  })

  test('objects', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('{}'), {})
    eq(j.parse('{"a":1}'), { a: 1 })
    eq(j.parse('{a:1}'), { a: 1 })
    eq(j.parse('{a:1,b:2}'), { a: 1, b: 2 })
    eq(j.parse('{a:1, b:2, c:"three"}'), { a: 1, b: 2, c: 'three' })
    eq(j.parse("{a:1, 'b':2}"), { a: 1, b: 2 })
    eq(j.parse('{ nested: { x: 1, y: 2 } }'), { nested: { x: 1, y: 2 } })
  })

  test('arrays', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('[]'), [])
    eq(j.parse('[1]'), [1])
    eq(j.parse('[1,2,3]'), [1, 2, 3])
    eq(j.parse('["a","b","c"]'), ['a', 'b', 'c'])
    eq(j.parse('[[1,2],[3,4]]'), [
      [1, 2],
      [3, 4],
    ])
  })

  test('trailing-commas', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('[1,2,3,]'), [1, 2, 3])
    eq(j.parse('{a:1,b:2,}'), { a: 1, b: 2 })
    eq(j.parse('[1,]'), [1])
    eq(j.parse('{a:1,}'), { a: 1 })
    eq(j.parse('[ 1 , 2 , ]'), [1, 2])
  })

  test('comments', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('// hello\n42'), 42)
    eq(j.parse('/* block */ 42'), 42)
    eq(j.parse('{ a: 1, /* mid */ b: 2 }'), { a: 1, b: 2 })
    eq(j.parse('[/* a */ 1, /* b */ 2]'), [1, 2])
    eq(j.parse('/* multi\nline\ncomment */ [1,2]'), [1, 2])

    // Hash comments not in JSON5 spec - rejected by default.
    assert.throws(() => j.parse('# a comment\n42'), /unexpected/)

    // Can be enabled explicitly.
    const jh = new Tabnas().use(jsonic).use(Json5, { hashComment: true })
    eq(jh.parse('# hello\n42'), 42)
  })

  test('numbers', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('0'), 0)
    eq(j.parse('42'), 42)
    eq(j.parse('-42'), -42)
    eq(j.parse('+42'), 42)
    eq(j.parse('3.14'), 3.14)
    eq(j.parse('.5'), 0.5)
    eq(j.parse('5.'), 5)
    eq(j.parse('1e10'), 1e10)
    eq(j.parse('1.5e-2'), 0.015)
    eq(j.parse('0x1F'), 31)
    eq(j.parse('0xDEADBEEF'), 0xdeadbeef)
    eq(j.parse('-0x10'), -16)
  })

  test('infinity-nan', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('Infinity'), Infinity)
    eq(j.parse('+Infinity'), Infinity)
    eq(j.parse('-Infinity'), -Infinity)
    eq(j.parse('NaN'), NaN)
    eq(j.parse('+NaN'), NaN)
    eq(j.parse('-NaN'), NaN)

    // Can be disabled.
    const jn = new Tabnas().use(jsonic).use(Json5, { infinity: false })
    assert.throws(() => jn.parse('Infinity'), /unexpected/)
    assert.throws(() => jn.parse('NaN'), /unexpected/)
  })

  test('strings', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('"hello"'), 'hello')
    eq(j.parse("'hello'"), 'hello')
    eq(j.parse('"he said \\"hi\\""'), 'he said "hi"')
    eq(j.parse("'he said \\'hi\\''"), "he said 'hi'")
    eq(j.parse('"a\\tb"'), 'a\tb')
    eq(j.parse('"a\\nb"'), 'a\nb')
    eq(j.parse('"a\\u0041b"'), 'aAb')
    eq(j.parse('"a\\x41b"'), 'aAb')
    eq(j.parse('"\\0"'), '\0')

    // JSON5 line continuation: backslash immediately before newline.
    eq(j.parse('"line1\\\nline2"'), 'line1line2')

    // Backticks not JSON5 by default.
    assert.throws(() => j.parse('`backtick`'), /unexpected/)

    // Can be enabled.
    const jb = new Tabnas().use(jsonic).use(Json5, { backtickString: true })
    eq(jb.parse('`backtick`'), 'backtick')
  })

  test('keys', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    eq(j.parse('{foo:1}'), { foo: 1 })
    eq(j.parse('{"foo":1}'), { foo: 1 })
    eq(j.parse("{'foo':1}"), { foo: 1 })
    eq(j.parse('{$id:1, _n:2, a1:3}'), { $id: 1, _n: 2, a1: 3 })
  })

  test('rejects-non-json5', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    // Bare words not allowed as top-level values.
    assert.throws(() => j.parse('foo'), /unexpected/)

    // Non-JSON5 number formats.
    assert.throws(() => j.parse('0o17'), /unexpected/)
    assert.throws(() => j.parse('0b101'), /unexpected/)
    assert.throws(() => j.parse('1_000'), /unexpected/)

    // Implicit top-level list not allowed.
    assert.throws(() => j.parse('1,2,3'), /unexpected/)
    assert.throws(() => j.parse('a:1'), /unexpected/)
  })

  test('non-strict-options', () => {
    const js = new Tabnas().use(jsonic).use(Json5, {
      octal: true,
      binary: true,
      numberSeparator: true,
    })
    eq(js.parse('0o17'), 15)
    eq(js.parse('0b101'), 5)
    eq(js.parse('1_000'), 1000)

    const jnh = new Tabnas().use(jsonic).use(Json5, {
      hex: false,
    })
    assert.throws(() => jnh.parse('0x1F'), /unexpected/)
  })

  test('require-value', () => {
    const j = new Tabnas().use(jsonic).use(Json5)
    assert.throws(() => j.parse(''), /JSON5/)

    // Allow empty input. It returns NULL, the emptyResult this grammar
    // declares, not undefined: measured, and pinned in options.tsv as
    // `\tnull\t{"requireValue":false}`. strictEqual, not the eq() above:
    // assert.deepEqual compares undefined and null as EQUAL, so eq() would
    // pass whichever came back and this line would assert nothing. It said
    // `undefined` and asserted nothing until 2026-09-21.
    const jopt = new Tabnas().use(jsonic).use(Json5, { requireValue: false })
    assert.strictEqual(jopt.parse(''), null)
  })

  // A hash-comment-only source with requireValue OFF was a recorded
  // divergence until 2026-09-21: the canonical's no-value scan knew only
  // the two slash comment forms, so `#` counted as the start of a value,
  // the source reached the rules and this engine fell out with UNDEFINED
  // where both ports answered the declared empty result. The scan is
  // told which comment forms the configuration has now, from the
  // requireValue-OFF branch only, so all three answer null and the rows
  // are shared fixture rows in ../../test/spec/options.tsv rather than a
  // pin for one column here. The control that the repair had to leave
  // alone -- `# comment` under requireValue, still `unexpected` -- is a
  // row of that file too.

  test('strict-value-toggle', () => {
    // With strictValue disabled, bare words parse as strings
    // (Jsonic's default text fallback).
    const j = new Tabnas().use(jsonic).use(Json5, { strictValue: false })
    eq(j.parse('foo'), 'foo')
  })

  test('json5-spec-examples', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    // From https://json5.org/ home page example (adjusted).
    const src = `{
      // comments
      unquoted: 'and you can quote me on that',
      singleQuotes: 'I can use "double quotes" here',
      lineBreaks: "Look, Mom! \\
No \\\\n's!",
      hexadecimal: 0xdecaf,
      leadingDecimalPoint: .8675309, andTrailing: 8675309.,
      positiveSign: +1,
      trailingComma: 'in objects', andIn: ['arrays',],
      "backwardsCompatible": "with JSON",
    }`

    eq(j.parse(src), {
      unquoted: 'and you can quote me on that',
      singleQuotes: 'I can use "double quotes" here',
      lineBreaks: "Look, Mom! No \\n's!",
      hexadecimal: 0xdecaf,
      leadingDecimalPoint: 0.8675309,
      andTrailing: 8675309,
      positiveSign: 1,
      trailingComma: 'in objects',
      andIn: ['arrays'],
      backwardsCompatible: 'with JSON',
    })
  })

  test('nested-structures', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    const src = `{
      users: [
        { name: 'Alice', age: 30, tags: ['admin', 'user'] },
        { name: 'Bob',   age: 25, tags: [] },
      ],
      total: 2,
      active: true,
      metadata: null,
    }`

    eq(j.parse(src), {
      users: [
        { name: 'Alice', age: 30, tags: ['admin', 'user'] },
        { name: 'Bob', age: 25, tags: [] },
      ],
      total: 2,
      active: true,
      metadata: null,
    })
  })

  test('json-is-json5', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    // Any valid JSON should also be valid JSON5.
    const cases = [
      '{}',
      '[]',
      '{"a":1,"b":"two","c":null,"d":true,"e":false}',
      '[1,2.5,-3,1e10,"s",null,true,false]',
      '{"nested":{"list":[1,{"x":null}]}}',
    ]
    for (const src of cases) {
      eq(j.parse(src), JSON.parse(src))
    }
  })

  // --- The TypeScript column of ../../DIVERGENCE.md -------------------
  //
  // Every entry in that file carries a measured `input | TypeScript | Go
  // | Rust` table, and a table nothing executes goes stale without any
  // suite going red. The three tests below are the TypeScript column of
  // the three entries that no fixture row can hold. Each has a
  // counterpart in `go/json5_test.go` and `rs/tests/json5_test.rs`.

  // A JavaScript string is UTF-16 and may hold an UNPAIRED surrogate,
  // where a Go `string` and a Rust `String` are UTF-8 and cannot, so both
  // ports fold one to U+FFFD. The register cannot hold this: its cells
  // are JSON values, and every reader but JavaScript's folds `\ud800` to
  // U+FFFD, so the `ts` and `rust` cells would MEAN the same thing.
  test('lone-surrogate-survives-as-a-code-unit', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    for (const [src, code] of [
      ['"\\uD800"', 0xd800],
      ['"\\uDFFF"', 0xdfff],
    ] as [string, number][]) {
      const got = j.parse(src) as string
      assert.strictEqual(got.length, 1, src)
      assert.strictEqual(got.charCodeAt(0), code, src)
    }

    const embedded = j.parse('"a\\uD800b"') as string
    assert.deepStrictEqual(
      [...embedded].map((c) => c.charCodeAt(0)),
      [0x61, 0xd800, 0x62],
    )

    // Reversed halves stay two lone surrogates, not one astral character.
    const reversed = j.parse('"\\uDE00\\uD83D"') as string
    assert.deepStrictEqual(
      [reversed.length, reversed.charCodeAt(0), reversed.charCodeAt(1)],
      [2, 0xde00, 0xd83d],
    )

    // The control: a well-formed PAIR is one astral character in all
    // three runtimes, not two folds.
    const pair = j.parse('"😀"') as string
    assert.strictEqual(pair.codePointAt(0), 0x1f600)
    assert.strictEqual([...pair].length, 1)
  })

  // An unquoted key is an ES5.1 IdentifierName, whose IdentifierStart is
  // a UnicodeLetter. ES5.1 names no Unicode VERSION, so each runtime
  // answers from the tables its platform ships, and the three platforms
  // ship three: this host's ICU, Go's `unicode` package, and the Rust
  // `regex` crate. See "Unquoted keys follow each platform's Unicode
  // tables" in DIVERGENCE.md for the measured table.
  //
  // This is the TypeScript column, and it asserts what that column
  // CLAIMS: that the canonical delegates to the host's own tables. The
  // characters are not hard-coded to a verdict here, deliberately. The
  // canonical's answer for U+1C89 and U+088F is a property of the Node
  // that runs it, not of ts/src/json5.ts, so a hard-coded verdict would
  // fail on a different runner without a line of this repo changing.
  // The Rust column, whose tables come from a crate this repo locks, is
  // hard-coded in rs/tests/json5_test.rs instead.
  test('unquoted-keys-follow-the-hosts-unicode-tables', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    const isIdentifierStart = (ch: string) => /^[\p{L}\p{Nl}]$/u.test(ch)

    const parses = (src: string) => {
      try {
        j.parse(src)
        return true
      } catch {
        return false
      }
    }

    // U+00E9 and U+1F600 are the version-independent controls: a letter
    // in every Unicode version, and So in every one. U+1C89 became a
    // letter in 16.0 and U+088F in 17.0, so those two are where the
    // platforms part company.
    for (const ch of ['\u00e9', '\u1c89', '\u088f', '\u{1F600}']) {
      const want = isIdentifierStart(ch)
      assert.strictEqual(
        parses('{' + ch + ':1}'),
        want,
        'as a key start: ' + ch.codePointAt(0)!.toString(16),
      )
      assert.strictEqual(
        parses('{a' + ch + ':1}'),
        want,
        'as a key part: ' + ch.codePointAt(0)!.toString(16),
      )
    }

    // The control on the control: the loop above is only meaningful if
    // the four characters do not all answer the same way. U+00E9 opens a
    // key and U+1F600 does not, on every host.
    assert.strictEqual(parses('{\u00e9:1}'), true)
    assert.strictEqual(parses('{\u{1F600}:1}'), false)
  })

  // Nesting is BOUNDED in the Rust port and unbounded here and in Go.
  // This is the TypeScript column of that table: the depths it records
  // as parsing must keep parsing, or the entry is describing a runtime
  // that no longer exists.
  test('nesting-is-unbounded', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    for (const depth of [127, 128, 5000]) {
      const array = j.parse('['.repeat(depth) + ']'.repeat(depth)) as unknown[]
      let level = 0
      let node: any = array
      while (Array.isArray(node) && node.length > 0) {
        level++
        node = node[0]
      }
      assert.strictEqual(level, depth - 1, `${depth} nested arrays`)

      const object = j.parse('{a:'.repeat(depth) + '1' + '}'.repeat(depth))
      let olevel = 0
      let onode: any = object
      while (onode && 'object' === typeof onode) {
        olevel++
        onode = onode.a
      }
      assert.strictEqual(olevel, depth, `${depth} nested objects`)
    }
  })

  // Both ports site the two no-value errors at the start of the source.
  // The canonical raises them before the lexer has a point to report, so
  // a caller gets a number from the ports and nothing here. The CODE
  // agrees, and that is what test/spec/options.tsv pins; this is the
  // POSITION, which no fixture column carries.
  //
  // WHICH FIELDS. This engine's errors carry the position as
  // `lineNumber` and `columnNumber` (the ECMA-262 non-standard Error
  // properties), NOT as `row` and `col`. `row` and `col` are undefined on
  // an ORDINARY positioned error too, so a test that asserted them
  // undefined here would be vacuously true: the canonical could grow a
  // 1:1 position on these two and stay green while this entry went stale.
  // Measured before it was written down, both ways round. The ordinary
  // error below is the control that proves the names are the live ones:
  // if the engine renamed them, THAT assertion fails, and this pin can
  // never quietly become an assertion about two fields nobody writes.
  test('the-no-value-errors-carry-no-position', () => {
    const j = new Tabnas().use(jsonic).use(Json5)

    function thrownBy(src: string): any {
      try {
        j.parse(src)
      } catch (err) {
        return err
      }
      return undefined
    }

    // The control: an ordinary positioned error DOES carry a position,
    // in these fields. Two lines in, so the row is a measured 2 rather
    // than a value a default could produce.
    const positioned = thrownBy('{\n  a: @\n}')
    assert.ok(positioned, 'the control should throw')
    assert.deepStrictEqual(
      [positioned.code, positioned.lineNumber, positioned.columnNumber],
      ['unexpected', 2, 6],
    )

    for (const [src, code] of [
      ['//', 'json5_no_value'],
      ['', 'json5_empty'],
    ]) {
      const thrown = thrownBy(src)
      assert.ok(thrown, `${JSON.stringify(src)} should throw`)
      assert.strictEqual(thrown.code, code, JSON.stringify(src))
      assert.strictEqual(thrown.lineNumber, undefined, JSON.stringify(src))
      assert.strictEqual(thrown.columnNumber, undefined, JSON.stringify(src))
      // And not under any other spelling: the property is ABSENT, which
      // is what `undefined` above cannot by itself distinguish from a
      // field the engine sets to undefined on purpose.
      assert.strictEqual('lineNumber' in thrown, false, JSON.stringify(src))
      assert.strictEqual('columnNumber' in thrown, false, JSON.stringify(src))
    }
  })
})
