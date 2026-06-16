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

    // Allow empty input (returns undefined).
    const jopt = new Tabnas().use(jsonic).use(Json5, { requireValue: false })
    eq(jopt.parse(''), undefined)
  })

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
})
