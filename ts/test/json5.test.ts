/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

import { describe, test } from 'node:test'
import assert from 'node:assert'

import { Jsonic } from '@tabnas/jsonic'
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
    const j = Jsonic.make().use(Json5)

    eq(j('true'), true)
    eq(j('false'), false)
    eq(j('null'), null)
    eq(j('42'), 42)
    eq(j('3.14'), 3.14)
    eq(j('-7'), -7)
    eq(j('"hello"'), 'hello')
    eq(j("'hello'"), 'hello')
  })

  test('objects', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('{}'), {})
    eq(j('{"a":1}'), { a: 1 })
    eq(j('{a:1}'), { a: 1 })
    eq(j('{a:1,b:2}'), { a: 1, b: 2 })
    eq(j('{a:1, b:2, c:"three"}'), { a: 1, b: 2, c: 'three' })
    eq(j("{a:1, 'b':2}"), { a: 1, b: 2 })
    eq(j('{ nested: { x: 1, y: 2 } }'), { nested: { x: 1, y: 2 } })
  })

  test('arrays', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('[]'), [])
    eq(j('[1]'), [1])
    eq(j('[1,2,3]'), [1, 2, 3])
    eq(j('["a","b","c"]'), ['a', 'b', 'c'])
    eq(j('[[1,2],[3,4]]'), [
      [1, 2],
      [3, 4],
    ])
  })

  test('trailing-commas', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('[1,2,3,]'), [1, 2, 3])
    eq(j('{a:1,b:2,}'), { a: 1, b: 2 })
    eq(j('[1,]'), [1])
    eq(j('{a:1,}'), { a: 1 })
    eq(j('[ 1 , 2 , ]'), [1, 2])
  })

  test('comments', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('// hello\n42'), 42)
    eq(j('/* block */ 42'), 42)
    eq(j('{ a: 1, /* mid */ b: 2 }'), { a: 1, b: 2 })
    eq(j('[/* a */ 1, /* b */ 2]'), [1, 2])
    eq(j('/* multi\nline\ncomment */ [1,2]'), [1, 2])

    // Hash comments not in JSON5 spec - rejected by default.
    assert.throws(() => j('# a comment\n42'), /unexpected/)

    // Can be enabled explicitly.
    const jh = Jsonic.make().use(Json5, { hashComment: true })
    eq(jh('# hello\n42'), 42)
  })

  test('numbers', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('0'), 0)
    eq(j('42'), 42)
    eq(j('-42'), -42)
    eq(j('+42'), 42)
    eq(j('3.14'), 3.14)
    eq(j('.5'), 0.5)
    eq(j('5.'), 5)
    eq(j('1e10'), 1e10)
    eq(j('1.5e-2'), 0.015)
    eq(j('0x1F'), 31)
    eq(j('0xDEADBEEF'), 0xdeadbeef)
    eq(j('-0x10'), -16)
  })

  test('infinity-nan', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('Infinity'), Infinity)
    eq(j('+Infinity'), Infinity)
    eq(j('-Infinity'), -Infinity)
    eq(j('NaN'), NaN)
    eq(j('+NaN'), NaN)
    eq(j('-NaN'), NaN)

    // Can be disabled.
    const jn = Jsonic.make().use(Json5, { infinity: false })
    assert.throws(() => jn('Infinity'), /unexpected/)
    assert.throws(() => jn('NaN'), /unexpected/)
  })

  test('strings', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('"hello"'), 'hello')
    eq(j("'hello'"), 'hello')
    eq(j('"he said \\"hi\\""'), 'he said "hi"')
    eq(j("'he said \\'hi\\''"), "he said 'hi'")
    eq(j('"a\\tb"'), 'a\tb')
    eq(j('"a\\nb"'), 'a\nb')
    eq(j('"a\\u0041b"'), 'aAb')
    eq(j('"a\\x41b"'), 'aAb')
    eq(j('"\\0"'), '\0')

    // JSON5 line continuation: backslash immediately before newline.
    eq(j('"line1\\\nline2"'), 'line1line2')

    // Backticks not JSON5 by default.
    assert.throws(() => j('`backtick`'), /unexpected/)

    // Can be enabled.
    const jb = Jsonic.make().use(Json5, { backtickString: true })
    eq(jb('`backtick`'), 'backtick')
  })

  test('keys', () => {
    const j = Jsonic.make().use(Json5)

    eq(j('{foo:1}'), { foo: 1 })
    eq(j('{"foo":1}'), { foo: 1 })
    eq(j("{'foo':1}"), { foo: 1 })
    eq(j('{$id:1, _n:2, a1:3}'), { $id: 1, _n: 2, a1: 3 })
  })

  test('rejects-non-json5', () => {
    const j = Jsonic.make().use(Json5)

    // Bare words not allowed as top-level values.
    assert.throws(() => j('foo'), /unexpected/)

    // Non-JSON5 number formats.
    assert.throws(() => j('0o17'), /unexpected/)
    assert.throws(() => j('0b101'), /unexpected/)
    assert.throws(() => j('1_000'), /unexpected/)

    // Implicit top-level list not allowed.
    assert.throws(() => j('1,2,3'), /unexpected/)
    assert.throws(() => j('a:1'), /unexpected/)
  })

  test('non-strict-options', () => {
    const js = Jsonic.make().use(Json5, {
      octal: true,
      binary: true,
      numberSeparator: true,
    })
    eq(js('0o17'), 15)
    eq(js('0b101'), 5)
    eq(js('1_000'), 1000)

    const jnh = Jsonic.make().use(Json5, {
      hex: false,
    })
    assert.throws(() => jnh('0x1F'), /unexpected/)
  })

  test('require-value', () => {
    const j = Jsonic.make().use(Json5)
    assert.throws(() => j(''), /JSON5/)

    // Allow empty input (returns undefined).
    const jopt = Jsonic.make().use(Json5, { requireValue: false })
    eq(jopt(''), undefined)
  })

  test('strict-value-toggle', () => {
    // With strictValue disabled, bare words parse as strings
    // (Jsonic's default text fallback).
    const j = Jsonic.make().use(Json5, { strictValue: false })
    eq(j('foo'), 'foo')
  })

  test('json5-spec-examples', () => {
    const j = Jsonic.make().use(Json5)

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

    eq(j(src), {
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
    const j = Jsonic.make().use(Json5)

    const src = `{
      users: [
        { name: 'Alice', age: 30, tags: ['admin', 'user'] },
        { name: 'Bob',   age: 25, tags: [] },
      ],
      total: 2,
      active: true,
      metadata: null,
    }`

    eq(j(src), {
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
    const j = Jsonic.make().use(Json5)

    // Any valid JSON should also be valid JSON5.
    const cases = [
      '{}',
      '[]',
      '{"a":1,"b":"two","c":null,"d":true,"e":false}',
      '[1,2.5,-3,1e10,"s",null,true,false]',
      '{"nested":{"list":[1,{"x":null}]}}',
    ]
    for (const src of cases) {
      eq(j(src), JSON.parse(src))
    }
  })
})
