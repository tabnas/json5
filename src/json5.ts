/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

// Import Jsonic types used by plugins.
import { Jsonic, Plugin } from 'jsonic'

// See defaults below for commentary.
type Json5Options = {
  // Accept Infinity, -Infinity, +Infinity, NaN, -NaN, +NaN literals.
  infinity: boolean
  // Accept hexadecimal number literals (0x...).
  hex: boolean
  // Accept `#` single-line comments (not part of JSON5 spec).
  hashComment: boolean
  // Accept backtick-quoted strings (not part of JSON5 spec).
  backtickString: boolean
  // Accept `_` as a digit separator in numbers (not part of JSON5 spec).
  numberSeparator: boolean
  // Accept octal (0o...) number literals (not part of JSON5 spec).
  octal: boolean
  // Accept binary (0b...) number literals (not part of JSON5 spec).
  binary: boolean
  // Require a top-level value (reject empty input).
  requireValue: boolean
  // Reject bare unquoted text at the top level (e.g. `foo`).
  // JSON5 requires the top-level value to be a string, number, boolean,
  // null, object, or array.
  strictValue: boolean
}

// Plugin implementation.
const Json5: Plugin = (jsonic: Jsonic, options: Json5Options) => {
  const infinityValues: Record<string, { val: number }> = options.infinity
    ? {
        Infinity: { val: Infinity },
        '+Infinity': { val: Infinity },
        '-Infinity': { val: -Infinity },
        NaN: { val: NaN },
        '+NaN': { val: NaN },
        '-NaN': { val: NaN },
      }
    : {}

  const commentDef: Record<string, any> = {
    slash: { line: true, start: '//', lex: true, eatline: false },
    multi: {
      line: false,
      start: '/*',
      end: '*/',
      lex: true,
      eatline: false,
    },
    hash: options.hashComment
      ? { line: true, start: '#', lex: true, eatline: false }
      : null,
  }

  const stringChars = options.backtickString ? '\'"`' : '\'"'
  const stringMultiChars = options.backtickString ? '`' : ''

  // JSON5 requires the top-level production to be a single value; the
  // implicit list/map rules from Jsonic would otherwise accept `1,2` or `a:1`.
  jsonic.options({
    rule: {
      exclude: 'imp',
    },
  })

  // JSON5 values must be a string, number, boolean, null, object, or array.
  // Removing #TX from VAL blocks bare identifiers like `foo` at positions
  // where a value is expected, while still permitting unquoted object keys
  // (which are matched via the KEY token set).
  if (options.strictValue) {
    jsonic.options({
      tokenSet: {
        VAL: ['#ST', '#NR', '#VL'],
      },
    })
  }

  jsonic.options({
    number: {
      lex: true,
      hex: options.hex,
      oct: options.octal,
      bin: options.binary,
      sep: options.numberSeparator ? '_' : null,
    },
    comment: {
      lex: true,
      def: commentDef,
    },
    string: {
      lex: true,
      chars: stringChars,
      multiChars: stringMultiChars,
      escapeChar: '\\',
      escape: {
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
        v: '\v',
        '0': '\0',
        '"': '"',
        "'": "'",
        '`': '`',
        '\\': '\\',
        '/': '/',
        // JSON5 line continuation: backslash followed by a line terminator
        // is stripped entirely.
        '\n': '',
        '\r': '',
        '\u2028': '',
        '\u2029': '',
      },
      allowUnknown: true,
    },
    value: {
      lex: true,
      def: {
        true: { val: true },
        false: { val: false },
        null: { val: null },
        ...infinityValues,
      },
    },
    map: {
      extend: true,
      child: false,
    },
    list: {
      property: false,
      pair: false,
      child: false,
    },
    lex: {
      empty: !options.requireValue,
      emptyResult: undefined,
    },
    error: {
      json5_empty: 'JSON5 input must contain a value',
    },
    hint: {
      json5_empty: `JSON5 requires a top-level value. An empty source is not a
valid JSON5 document.`,
    },
  })

  // Jsonic's option merge is additive for char sets, so explicitly prune
  // quote characters and multi-line quote characters that JSON5 does not allow.
  const cfg: any = jsonic.internal().config
  if (!options.backtickString) {
    delete cfg.string.quoteMap['`']
    delete cfg.string.multiChars['`']
  }

  if (options.requireValue) {
    const parser = jsonic.internal().parser
    const origStart = parser.start.bind(parser)
    parser.start = (src: string, ...rest: any[]) => {
      if ('' === src || null == src) {
        const err: any = new Error('JSON5 input must contain a value')
        err.code = 'json5_empty'
        err.details = { src }
        throw err
      }
      return origStart(src, ...rest)
    }
  }
}

// Default option values: a strict JSON5 configuration.
Json5.defaults = {
  infinity: true,
  hex: true,
  hashComment: false,
  backtickString: false,
  numberSeparator: false,
  octal: false,
  binary: false,
  requireValue: true,
  strictValue: true,
} as Json5Options

export { Json5 }

export type { Json5Options }
