/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

// Import Jsonic types used by plugins.
import { Jsonic, Plugin, Rule, Context, Lex } from 'jsonic'

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
  // Reject bare unquoted text at the top level (e.g. `foo`). JSON5 only
  // admits string, number, boolean, null, object, and array as top-level.
  strictValue: boolean
}

// JSON5 WhiteSpace: HT, VT, FF, SP, NBSP, BOM, and Unicode Zs category.
const json5WhiteSpace =
  '\t\v\f \u00A0\uFEFF' +
  '\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A' +
  '\u202F\u205F\u3000'

// JSON5 LineTerminator: LF, CR, LS, PS.
const json5LineTerminator = '\r\n\u2028\u2029'

// JSON5-invalid leading-zero integer literals like `010`, `-098`, `+080`.
const leadingZero = /^[+-]?0[0-9]/

// Trailing-decimal + exponent number shape (e.g. "5.e4").
const trailingDecExp = /^[+-]?[0-9]+\.[eE][+-]?[0-9]+/

// Uppercase 0X hex prefix — Jsonic TS's number lexer only accepts 0x.
const uppercaseHex = /^[+-]?0X[0-9a-fA-F]+/

// Identifier-name helpers. ECMAScript 5.1 IdentifierStart / IdentifierPart
// restricted to the Unicode categories the spec lists.
const idStartRe = /[\p{L}\p{Nl}$_]/u
const idPartRe = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_\u200C\u200D]/u

function isIdentifierStart(ch: string): boolean {
  return ch === '\\' || idStartRe.test(ch)
}

function isValidIdentifierName(s: string): boolean {
  if (s.length === 0) return false
  let first = true
  for (const ch of s) {
    if (first) {
      if (!isIdentifierStart(ch)) return false
      first = false
    } else if (!idPartRe.test(ch) && ch !== '\\') {
      return false
    }
  }
  return true
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

  // Value defs with regex `match` pick up number shapes Jsonic's built-in
  // lexer misses — trailing-decimal-with-exponent (Go), uppercase 0X hex
  // (TS). Both are here so the ports behave identically.
  // Jsonic TS calls val(res) where res is the RegExp match array
  // (res[0] is the full match); return the parsed number from there.
  const numberRegexDefs: Record<string, { val: any; match: RegExp; consume: boolean }> = {
    trailingDecExp: {
      val: (res: RegExpMatchArray) => parseFloat(res[0]),
      match: trailingDecExp,
      consume: true,
    },
    uppercaseHex: {
      val: (res: RegExpMatchArray) => {
        let s = res[0]
        let sign = 1
        if (s[0] === '-') { sign = -1; s = s.slice(1) }
        else if (s[0] === '+') { s = s.slice(1) }
        return sign * parseInt(s.slice(2), 16)
      },
      match: uppercaseHex,
      consume: true,
    },
  }

  const valueDefEntries: Record<string, any> = {
    true: { val: true },
    false: { val: false },
    null: { val: null },
    ...infinityValues,
    ...numberRegexDefs,
  }

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

  // JSON5 values must be a string, number, boolean, null, object, or
  // array; keys must be unquoted identifiers, single- or double-quoted
  // strings, or JSON5 reserved-word literals (treated as #VL).
  //
  //   VAL without #TX → reject `foo` at a value position.
  //   KEY without #NR → reject `{10: 1}` numeric keys.
  const tokenSetOpts: Record<string, string[]> = {}
  if (options.strictValue) {
    tokenSetOpts.VAL = ['#ST', '#NR', '#VL']
  }
  tokenSetOpts.KEY = ['#TX', '#ST', '#VL']
  jsonic.options({ tokenSet: tokenSetOpts })

  // fixedCheck runs before every lexer step but gates its own work so
  // the preprocessing happens exactly once per parse. It rewrites
  // backslash+CRLF to backslash+LF so the escape-map entry for "\r"
  // handles JSON5 string line continuations that span a CRLF.
  const fixedCheck = (lex: Lex) => {
    const ctx: any = (lex as any).ctx
    if (!ctx || !ctx.u) return
    if (ctx.u.json5_preprocessed) return
    ctx.u.json5_preprocessed = true
    const src = String((lex as any).src)
    if (src.indexOf('\\\r\n') !== -1) {
      const rewritten = src.replace(/\\\r\n/g, '\\\n')
      ;(lex as any).src = rewritten
      const pnt: any = (lex as any).pnt
      if (pnt) pnt.len = rewritten.length
    }
  }

  // textCheck rejects text tokens that cannot begin a valid JSON5
  // IdentifierName AND do not correspond to a registered value-def
  // keyword / regex. Returning { done: true, token: undefined } halts
  // lexing at this position so the parser raises "unexpected character".
  const textCheck = (lex: Lex) => {
    const pnt: any = (lex as any).pnt
    const src: string = (lex as any).src
    if (!pnt || pnt.sI >= src.length) return undefined
    const forward = src.slice(pnt.sI)
    const r = forward[0]
    if (isIdentifierStart(r)) return undefined
    for (const name of Object.keys(valueDefEntries)) {
      const def: any = valueDefEntries[name]
      if (def && def.match instanceof RegExp) {
        if (def.match.test(forward)) return undefined
      } else if (forward.startsWith(name)) {
        return undefined
      }
    }
    return { done: true, token: undefined }
  }

  jsonic.options({
    space: {
      lex: true,
      chars: json5WhiteSpace,
    },
    line: {
      lex: true,
      chars: json5LineTerminator,
      rowChars: '\n\u2028\u2029',
    },
    fixed: {
      lex: true,
      check: fixedCheck,
    },
    text: {
      lex: true,
      check: textCheck,
    },
    number: {
      lex: true,
      hex: options.hex,
      oct: options.octal,
      bin: options.binary,
      sep: options.numberSeparator ? '_' : null,
      // Reject JS-style octal and noctal leading-zero literals.
      exclude: leadingZero,
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
        // JSON5 line continuation: backslash + line terminator → empty.
        '\n': '',
        '\r': '',
        '\u2028': '',
        '\u2029': '',
      },
      allowUnknown: true,
    },
    value: {
      lex: true,
      def: valueDefEntries,
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
      json5_no_value: 'JSON5 input must contain a value',
    },
    hint: {
      json5_empty: `JSON5 requires a top-level value. An empty source is not a
valid JSON5 document.`,
      json5_no_value: `JSON5 requires a top-level value. A source that consists
only of whitespace and comments is not valid.`,
    },
  })

  // Jsonic's option merge is additive for char sets, so explicitly prune
  // quote characters and multi-line quote characters that JSON5 does not allow.
  const cfg: any = jsonic.internal().config
  if (!options.backtickString) {
    delete cfg.string.quoteMap['`']
    delete cfg.string.multiChars['`']
  }

  // TokenSet override does not propagate into grammar alts resolved at
  // make() time. Walk the rule spec map to filter #TX from val-tagged
  // alts and #NR from pair-tagged alts so bare text values and numeric
  // keys are rejected.
  // TokenSet overrides are applied to S0/S1 bitmasks at rule
  // normalization time, so VAL and KEY filtering above is sufficient —
  // no further rule-spec surgery is needed for #TX / #NR filtering.
  const rsm: any = (jsonic.internal().parser as any).rsm

  // Reject `{,}` lone-comma objects by removing pair.Open's leading-
  // comma alt (tagged "comma,jsonic"); trailing commas on pair.Close are
  // untouched. Also install an after-open validator: JSON5 unquoted keys
  // must be valid IdentifierNames. `multi-word` or `foo!bar` would
  // otherwise be accepted as #TX keys.
  jsonic.rule('pair', (rs: any) => {
    const alts = rs.def?.open || rs.open
    if (Array.isArray(alts)) {
      const filtered = alts.filter(
        (a: any) => !a || !tagContains(a.g, ['comma', 'jsonic']),
      )
      if (rs.def) rs.def.open = filtered
      else rs.open = filtered
    }
    const TinTX = jsonic.token('#TX')
    const actions = rs.def?.ao || rs.ao || []
    actions.push((r: Rule, ctx: Context) => {
      const t = (r as any).o0
      if (!t || t.tin !== TinTX) return
      if (!isValidIdentifierName(t.src)) {
        ;(ctx as any).ParseErr = t
        if (typeof (t as any).bad === 'function') {
          return (t as any).bad('unexpected')
        }
      }
    })
    if (rs.def) rs.def.ao = actions
    else rs.ao = actions
    return rs
  })

  // Reject a source that contains only whitespace/comments. The val
  // rule has a `#ZZ jsonic` alt that accepts an empty parse at the top
  // level; drop it when a value is required.
  if (options.requireValue) {
    jsonic.rule('val', (rs: any) => {
      const alts = rs.def?.open || rs.open
      if (Array.isArray(alts)) {
        const filtered = alts.filter((a: any) => !isZZJsonicAlt(a))
        if (rs.def) rs.def.open = filtered
        else rs.open = filtered
      }
      return rs
    })
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

function isZZJsonicAlt(alt: any): boolean {
  if (!alt || !tagContains(alt.g, ['jsonic'])) return false
  const s = alt.s
  if (!Array.isArray(s) || s.length !== 1) return false
  const slot = s[0]
  if (Array.isArray(slot)) return slot.length === 1 && slot[0] === '#ZZ'
  return slot === '#ZZ'
}

function tagContains(tags: any, required: string[]): boolean {
  const list: string[] = Array.isArray(tags)
    ? tags.map(String)
    : typeof tags === 'string'
      ? tags.split(',').map((s) => s.trim())
      : []
  for (const r of required) {
    if (list.indexOf(r) === -1) return false
  }
  return true
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
