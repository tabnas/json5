/* Copyright (c) 2026 Richard Rodger and other contributors, MIT License */

// A parse from a reader (`tn.parseReader`, admin ADR-30 and ADR-33).
//
// `make()` builds the parser whole, as `new Tabnas().use(jsonic).use(Json5,
// options)` builds it, and declares `lex.window` on it, so that a reader is
// read a window at a time. The checks this grammar installs (the fixed
// check that reads a string holding a line continuation, the string check
// and the text check) read the source only through the lexer's window, and
// the requireValue rule reads a reader only as far as its leading
// whitespace and comments. These tests hold it to that: `make()` declares
// the window and parses as that composition does; every row of the shared
// fixtures, under its `opts`, every document of the vendored json5-tests
// corpus and every probe derived from it parses the same from a reader, in
// pieces of 1, 3 and 64 bytes, under windows of a few UTF-16 units and the
// engine's own, as from its text; and so do strings the window's edge cuts
// at every place, the values the text check judges, tokens longer than the
// window and a long document.

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { findSpecDir, loadSpecDir } from '@tabnas/support'

import { Json5, make } from '../dist/json5'
import type { Json5Options } from '../dist/json5'

const SPEC = findSpecDir(__dirname)
const CORPUS = join(__dirname, '..', '..', 'test', 'json5-tests')
const ORACLE = join(__dirname, '..', '..', 'test', 'json5-tests-expected.json')

type Reader = { read(buf: Uint8Array): number }
type Sizes = { margin: number; block: number; chunk: number }
type Seen = { value?: unknown; error?: string }

// A reader that hands its bytes over at most `size` at a time, counting
// what it has handed over.
function pieces(bytes: Uint8Array, size: number): Reader & { at: number } {
  return {
    at: 0,
    read(buf: Uint8Array): number {
      const n = Math.min(size, buf.length, bytes.length - this.at)
      buf.set(bytes.subarray(this.at, this.at + n))
      this.at += n
      return n
    },
  }
}

// What a parse shows: its value, or its error's code, position, row,
// column and token text, or the code of the requireValue rule's own error,
// which has no position. An error's excerpt is left out: a parse from a
// reader shows a long line only as far back as the window reaches
// (tabnas/parser DIVERGENCE.md), the one difference allowed.
function seen(parse: () => unknown): Seen {
  try {
    return { value: parse() }
  } catch (e: any) {
    if (null == e || 'function' !== typeof e.toJSON) {
      return { error: (e && e.code) + ' ' + JSON.stringify(e && e.details) }
    }
    const d = e.toJSON()
    return {
      error:
        d.code + ' at ' + d.pos + ' ' + d.row + ':' + d.col + ' ' +
        JSON.stringify(d.token.src),
    }
  }
}

const show = (o: Seen): string =>
  undefined !== o.error ? 'error ' + o.error : 'value ' + inspect(o.value, { depth: 4 })

function same(a: Seen, b: Seen): boolean {
  if (a.error !== b.error) return false
  try {
    assert.deepStrictEqual(a.value, b.value)
    return true
  } catch (e) {
    return false
  }
}

// The pieces a reader hands its bytes over in, and the windows (margin and
// block) it is read under besides the engine's own: a few units, so that
// every check meets the window's edge.
const PIECES = [1, 3, 64]
const WINDOWS = [[1, 1], [3, 2], [64, 64]]

// `text` parsed by `tn` whole, and from a reader in every size of `sizes`,
// under the engine's window and each of WINDOWS: how many reader parses
// were compared. A difference is pushed onto `failures`.
function sameFromReader(
  tn: Tabnas,
  at: string,
  text: string,
  failures: string[],
  sizes: number[] = PIECES,
): number {
  const whole = seen(() => tn.parse(text))
  const bytes = Buffer.from(text, 'utf8')
  const anyTn = tn as any
  let compared = 0
  for (const size of sizes) {
    const reads: [string, () => unknown][] = [['', () => anyTn.parseReader(pieces(bytes, size))]]
    for (const [margin, block] of WINDOWS) {
      const window: Sizes = { margin, block, chunk: size }
      reads.push([
        ', margin ' + margin + ', block ' + block,
        () => anyTn.parseReaderWithSizes(pieces(bytes, size), window),
      ])
    }
    for (const [how, parse] of reads) {
      const read = seen(parse)
      compared++
      if (!same(read, whole)) {
        failures.push(
          at + ': ' + JSON.stringify(text.slice(0, 80)) + ' from a reader in pieces of ' +
          size + how + '\n  whole:  ' + show(whole).slice(0, 200) +
          '\n  reader: ' + show(read).slice(0, 200),
        )
      }
    }
  }
  return compared
}

// `text` parsed whole and from a reader at the window's sharpest edge:
// handed over a byte at a time, under a margin and a block of one unit.
function sameAtTheEdge(tn: Tabnas, at: string, text: string, failures: string[]): void {
  const whole = seen(() => tn.parse(text))
  const read = seen(() =>
    (tn as any).parseReaderWithSizes(pieces(Buffer.from(text, 'utf8'), 1), {
      margin: 1,
      block: 1,
      chunk: 1,
    }),
  )
  if (!same(read, whole)) {
    failures.push(at + ' at the edge\n  whole:  ' + show(whole) + '\n  reader: ' + show(read))
  }
}

const optionsOf = (cell: string): Partial<Json5Options> =>
  '' === cell.trim() ? {} : JSON.parse(cell)

// Every row of the shared fixtures: where it is, its input and its options.
function fixtureRows(): [string, string, Partial<Json5Options>][] {
  const rows: [string, string, Partial<Json5Options>][] = []
  for (const spec of loadSpecDir(SPEC)) {
    for (const row of spec.rows) {
      rows.push([row.where(), row.unescNamed('input'), optionsOf(row.named('opts'))])
    }
  }
  assert.ok(220 <= rows.length, '' + rows.length)
  return rows
}

// The ways a document of the corpus is read: its text, by its path in the
// oracle.
function corpus(): { oracle: any; read: (rel: string) => string } {
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf8'))
  return { oracle, read: (rel: string) => readFileSync(join(CORPUS, rel), 'utf8') }
}

describe('window', () => {
  test('make-declares-the-window', () => {
    assert.equal((make() as any).internal().config.lex.window, true)
    assert.equal((make({ hashComment: true }) as any).internal().config.lex.window, true)
    // The plugin alone declares nothing: a host may install it beneath
    // matchers of its own.
    const composed = new Tabnas().use(jsonic).use(Json5, {}) as any
    assert.ok(!composed.internal().config.lex.window)
  })

  test('make-parses-as-the-composition-does', () => {
    // Every fixture row, whole, through `make(opts)` and through
    // `new Tabnas().use(jsonic).use(Json5, opts)`, which dmog composed.
    const failures: string[] = []
    for (const [at, input, options] of fixtureRows()) {
      const made = seen(() => make(options).parse(input))
      const composed = seen(() => new Tabnas().use(jsonic).use(Json5, options).parse(input))
      if (!same(made, composed)) {
        failures.push(at + '\n  make:     ' + show(made) + '\n  composed: ' + show(composed))
      }
    }
    assert.deepEqual(failures, [])
  })

  test('the-require-value-rule-outlives-a-change-of-options', () => {
    // The engine replaces its parser when the instance's options change,
    // as a host's do and make's window does; the rule rides on the
    // instance, so it holds after.
    const tn = new Tabnas().use(jsonic).use(Json5) as any
    tn.options({ map: { ordered: true } })
    assert.equal(seen(() => tn.parse('')).error?.split(' ')[0], 'json5_empty')
    assert.equal(seen(() => tn.parse('// c')).error?.split(' ')[0], 'json5_no_value')
    const off = new Tabnas().use(jsonic).use(Json5, { requireValue: false }) as any
    off.options({ map: { ordered: true } })
    assert.equal(off.parse('// c'), null)
  })

  test('every-row-parses-the-same-from-a-reader', () => {
    let compared = 0
    const failures: string[] = []
    const rows = fixtureRows()
    rows.forEach(([at, input, options], n) => {
      compared += sameFromReader(make(options), at, input, failures)
      if (0 === (n + 1) % 50 || n + 1 === rows.length) {
        console.log('window fixtures: ' + (n + 1) + ' of ' + rows.length + ' rows (' +
          Math.floor(((n + 1) * 100) / rows.length) + '%), ' + compared + ' reader parses')
      }
    })
    assert.deepEqual(failures, [])
  })

  test('the-corpus-parses-the-same-from-a-reader', () => {
    // Each document under every pieces size and window, and each probe
    // derived from one (the document cut at every character, and followed
    // by each suffix ES5 refuses) at the window's sharpest edge, where a
    // probe, which ends at the edge by design, is read.
    const { oracle, read } = corpus()
    const tn = make()
    const failures: string[] = []
    let documents = 0
    let probes = 0
    for (const rel of Object.keys(oracle.cases)) {
      sameFromReader(tn, rel, read(rel), failures)
      documents++
    }
    console.log('window corpus: ' + documents + ' documents (33%)')
    for (const rel of Object.keys(oracle.derived.truncations)) {
      const chars = Array.from(read(rel))
      for (let n = 1; n < chars.length; n++) {
        sameAtTheEdge(tn, rel + ' cut at ' + n, chars.slice(0, n).join(''), failures)
        probes++
      }
    }
    console.log('window corpus: ' + probes + ' truncations (66%)')
    for (const [rel, suffixes] of Object.entries(oracle.derived.trailing) as [string, string[]][]) {
      const text = read(rel)
      for (const suffix of suffixes) {
        sameAtTheEdge(tn, rel + ' with ' + JSON.stringify(suffix), text + suffix, failures)
        probes++
      }
    }
    console.log('window corpus: ' + documents + ' documents and ' + probes + ' probes (100%)')
    assert.equal(documents, 114)
    assert.ok(5000 <= probes, '' + probes)
    assert.deepEqual(failures, [])
  })

  test('strings-meet-the-window-edge-at-every-place', () => {
    // Strings of every length up to a few dozen characters, so that the
    // window's edge falls at every place in each: with a line continuation
    // and without, an escape at the end, a forbidden escape after a
    // continuation, a surrogate pair either side of one, strings the
    // source ends inside, and escapes the closing quote cuts short, with
    // text after the quote their error's span reaches into.
    const shapes: ((s: string) => string)[] = [
      (s) => "'" + s + "\\\n'",
      (s) => "['" + s + "\\\r\n" + s + "', 1]",
      (s) => '"' + s + '\\\u2028é\\x41"',
      (s) => "'\\\n" + s + "\\u00e9'",
      (s) => "'\\\n" + s + "\\uD83D\\\n\\uDE00'",
      (s) => "'\\\n" + s + "\\1'",
      (s) => "'\\\n" + s + "\\x4'",
      (s) => "'\\\n" + s + "\\u12'",
      (s) => "'\\\n" + s,
      (s) => '"' + s + '\\0"',
      (s) => '"' + s + '\\01"',
      (s) => '{a: "' + s + '\\u{41}"}',
      (s) => "['\\\n" + s + "\\u12', 1]",
      (s) => "['\\\n" + s + "\\x', 1]",
      (s) => "['" + s + "\\\n\\u', 23]",
    ]
    const tn = make()
    const failures: string[] = []
    let compared = 0
    shapes.forEach((shape, n) => {
      for (let len = 0; len < 40; len++) {
        compared += sameFromReader(tn, 'shape ' + n + ', ' + len + ' characters',
          shape('s'.repeat(len)), failures, [1, 2])
      }
    })
    console.log('window strings: ' + compared + ' reader parses (100%)')
    assert.deepEqual(failures, [])
  })

  test('the-text-check-reads-as-far-as-its-answer-needs', () => {
    // The values the text check judges, at the window's edge: with the
    // number lexer on, and off, where nothing reads ahead of the check and
    // what it lets through is read by the value regexes and keywords alone.
    const numbersOff = make()
    numbersOff.options({ number: { lex: false } })
    const failures: string[] = []
    let compared = 0
    for (const [name, tn] of [['numbers on', make()], ['numbers off', numbersOff]] as [string, Tabnas][]) {
      for (let len = 0; len < 24; len++) {
        const digits = '0'.repeat(len)
        const hex = 'F'.repeat(len + 1)
        for (const text of [
          '[1' + digits + '.e3, -0X' + hex + ', -Infinity, +NaN, 5.e4]',
          '{a: -Infinity, b: +Infinity' + digits + '}',
          '[1' + digits + '.e]',
          '[-0X]',
          '[-Inf, 1]',
          '[+N' + digits + ']',
          '[@' + digits + ']',
          '1' + digits + '.e3',
        ]) {
          compared += sameFromReader(tn, name + ': ' + text, text, failures, [1, 2])
        }
      }
    }
    console.log('window text check: ' + compared + ' reader parses (100%)')
    assert.deepEqual(failures, [])
  })

  test('tokens-longer-than-the-window-parse-the-same-from-a-reader', () => {
    // The engine's window reaches 64 KiB past the cursor before each
    // token: a token longer than that meets its edge under the engine's
    // own sizes.
    const long = (64 << 10) + 2048
    const u = 'u'.repeat(long)
    const docs = [
      "['" + 's'.repeat(long) + "\\\r\nttt', 1]",
      '["\\\n' + 'é'.repeat(long / 2) + '\\x4F\\uD83D\\\u2028\\uDE00", 1]',
      '["' + 'q'.repeat(long) + '\\"", 1]',
      '[1' + '0'.repeat(long) + '.e3, 1]',
      // A run of digits that no number completes, which the engine's
      // number pattern reads in linear time from parser 0.12.18
      // (tabnas/parser#327).
      '[1' + '0'.repeat(long) + '.e]',
      '[0X' + 'f'.repeat(long) + ', 1]',
      '[{' + 'k'.repeat(long) + ': 1}, 1]',
      '[1, // ' + 'c'.repeat(long) + '\n2]',
      '[1, /* ' + 'b\n'.repeat(long / 2) + ' */ 2]',
      '[1,' + ' '.repeat(long) + '2]',
      "['\\\n" + u + "\\1']",
      "['\\\n" + u,
      "['\\\n" + u + '\\x4',
      "['\\\n" + u + "\\u12']",
      '["' + 'v'.repeat(long) + '\\01"]',
      '[+N' + 'N'.repeat(long) + ']',
      '[-0X' + 'g'.repeat(long) + ']',
    ]
    const tn = make() as any
    const failures: string[] = []
    docs.forEach((doc, n) => {
      const whole = seen(() => tn.parse(doc))
      for (const size of [4096, (64 << 10) + 3]) {
        const read = seen(() => tn.parseReader(pieces(Buffer.from(doc, 'utf8'), size)))
        if (!same(read, whole)) {
          failures.push('document ' + n + ' in pieces of ' + size + ': whole ' +
            show(whole).slice(0, 200) + ', reader ' + show(read).slice(0, 200))
        }
      }
      console.log('window long tokens: ' + (n + 1) + ' of ' + docs.length + ' (' +
        Math.floor(((n + 1) * 100) / docs.length) + '%)')
    })
    assert.deepEqual(failures, [])
  })

  test('a-long-document-parses-the-same-from-a-reader', () => {
    // From a reader in pieces of 4 KiB, under the engine's window and
    // under one of 256 units, which moves on thousands of times; with an
    // error at the end too, which the reader places where the whole text
    // does.
    const records: string[] = []
    for (let i = 0; i < 4000; i++) {
      records.push('{id: ' + i + ", 'name': \"ñ" + i + '\\u00e9\\\n" /* note ' + i +
        " */, tags: ['a', \"b\\x41\"], n: -1.5e3, h: 0X1F, d: 5.e4, x: -Infinity, y: +NaN, \\u0061b: 1,}," +
        ' // row ' + i)
    }
    const body = '// records\n[\n' + records.join('\n')
    const text = body + '\n0]\n'
    assert.ok(512 << 10 < text.length, '' + text.length)
    const broken = body + "\n'\\\n" + 'x'.repeat(300) + "\\1'\n]\n"
    const tn = make() as any
    ;[text, broken].forEach((doc, n) => {
      const whole = seen(() => tn.parse(doc))
      assert.equal(undefined === whole.error, 0 === n, show(whole).slice(0, 200))
      for (const sizes of [undefined, { margin: 256, block: 256, chunk: 4096 }]) {
        const bytes = Buffer.from(doc, 'utf8')
        const read = seen(() =>
          undefined === sizes
            ? tn.parseReader(pieces(bytes, 4096))
            : tn.parseReaderWithSizes(pieces(bytes, 4096), sizes),
        )
        assert.ok(same(read, whole), show(read).slice(0, 200))
      }
      console.log('window long document: ' + (n + 1) + ' of 2 (' + (n + 1) * 50 + '%)')
    })
  })

  test('the-rule-reads-only-the-leading-whitespace-and-comments', () => {
    const tn = make() as any
    for (const [text, code] of [
      ['', 'json5_empty'],
      ['   ', 'json5_no_value'],
      ['\ufeff', 'json5_no_value'],
      ['// only a comment', 'json5_no_value'],
      ['/* only */ // comments\n\u2028', 'json5_no_value'],
      ['/* x', 'unterminated_comment'],
    ]) {
      const whole = seen(() => tn.parse(text))
      assert.equal(whole.error?.split(' ')[0], code, JSON.stringify(text))
      for (const size of [1, 2, 3, 4096]) {
        assert.deepEqual(seen(() => tn.parseReader(pieces(Buffer.from(text, 'utf8'), size))),
          whole, JSON.stringify(text) + ' in pieces of ' + size)
      }
    }

    // Only the leading trivia and the character after it are read before
    // the parse: a reader that fails after them fails the parse with the
    // engine's `unreadable`, where it failed, not the rule.
    const lead = '  // a comment\n /* and another */ '
    let given = 0
    const failingAfter = (text: string): Reader => {
      const bytes = Buffer.from(text, 'utf8')
      return {
        read(buf: Uint8Array): number {
          if (given === bytes.length) throw new Error('the reader failed')
          buf[0] = bytes[given++]
          return 1
        },
      }
    }
    const read = seen(() => tn.parseReader(failingAfter(lead + '[1,')))
    assert.equal(read.error?.split(' ')[0], 'unreadable', show(read))
    given = 0
    const inLead = seen(() => tn.parseReader(failingAfter('// a comment')))
    assert.equal(inLead.error?.split(' ')[0], 'unreadable', show(inLead))
    const notUtf8 = seen(() => tn.parseReader(pieces(Uint8Array.from([0x2f, 0x2f, 0x20, 0xff, 0x0a]), 1)))
    assert.equal(notUtf8.error?.split(' ')[0], 'unreadable', show(notUtf8))

    // Without the rule a source holding no value is the declared empty
    // result from a reader too.
    const off = make({ requireValue: false }) as any
    for (const text of ['', '  ', '// c', '[1]']) {
      assert.deepEqual(seen(() => off.parseReader(pieces(Buffer.from(text, 'utf8'), 1))),
        seen(() => off.parse(text)), JSON.stringify(text))
    }
  })

  test('value-definitions-read-a-numbers-characters', () => {
    // The text check reads a keyword or a value regex's match as a run of
    // a number's characters, so that it reads through the window only as
    // far as the run. That holds of the keywords it can meet, those that
    // do not begin an identifier, and of the two regexes the grammar
    // declares, which this pins: a definition that could match another
    // character must widen `isNumberChar` first.
    const value = (make() as any).internal().config.value
    for (const name of Object.keys(value.def)) {
      assert.ok(/^[A-Za-z]/.test(name) || /^[-+.0-9A-Za-z]+$/.test(name), name)
    }
    assert.deepEqual(
      value.defre.map((entry: any) => entry.match.source).sort(),
      ['^[+-]?(?:0|[1-9][0-9]*)\\.[eE][+-]?[0-9]+', '^[+-]?0X[0-9a-fA-F]+'],
    )
  })
})
