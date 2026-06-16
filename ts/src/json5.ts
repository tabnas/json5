/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

// The engine is the tabnas parser; jsonic supplies the relaxed-JSON
// grammar that the embedded grammar text is authored in. Engine TYPES
// (Plugin, Rule, Context, Lex) are re-exported by @tabnas/parser.
import { Tabnas, Plugin, Rule, Context, Lex } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'

type Json5Options = {
  infinity: boolean
  hex: boolean
  hashComment: boolean
  backtickString: boolean
  numberSeparator: boolean
  octal: boolean
  binary: boolean
  requireValue: boolean
  strictValue: boolean
}

// JSON5 WhiteSpace: HT, VT, FF, SP, NBSP, BOM, and Unicode Zs category.
const JSON5_WHITESPACE =
  '\t\v\f \u00A0\uFEFF' +
  '\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A' +
  '\u202F\u205F\u3000'

// JSON5 LineTerminator: LF, CR, LS, PS.
const JSON5_LINE_TERMINATOR = '\r\n\u2028\u2029'
const JSON5_ROW_CHARS = '\n\u2028\u2029'

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

// --- BEGIN EMBEDDED json5-grammar.jsonic ---
const grammarText = `
# JSON5 Grammar Definition
# Parsed by a standard Jsonic instance and passed to jsonic.grammar()
# Function references (@ prefixed) are resolved against the refs map
# Regex references (@/pattern/flags) are resolved to RegExp instances
# Bare identifiers (UPPER_SNAKE_CASE) are placeholders overridden by the
# plugin code before the spec is applied.
#
# This file captures the strict-JSON5 baseline. The plugin layers
# option-dependent overrides (hash comments, backtick strings, octal /
# binary / separator numbers, Infinity / NaN keywords, etc.) on top.

{
  # Drop Jsonic's implicit top-level list / map alternates so \`a:1\` and
  # \`1,2\` are not accepted at the document root. JSON5 requires a single
  # value expression at top level.
  options: rule: { exclude: 'imp' }

  # Restrict the token sets used by Jsonic's grammar rules:
  #   VAL drops #TX — reject bare unquoted text at value positions.
  #   KEY drops #NR — reject numeric keys like \`{10: 1}\`.
  options: tokenSet: {
    VAL: [ '#ST' '#NR' '#VL' ]
    KEY: [ '#TX' '#ST' '#VL' ]
  }

  # Whitespace and line-terminator sets are broadened to match the JSON5
  # spec (Unicode Zs, BOM, LS / PS). The actual character strings are
  # supplied by the plugin because they contain code points the grammar
  # parser cannot round-trip losslessly.
  options: space: { chars: JSON5_WHITESPACE }
  options: line: {
    chars: JSON5_LINE_TERMINATOR
    rowChars: JSON5_ROW_CHARS
  }

  # LexCheck hooks close the last gaps the built-in lexer has against
  # the JSON5 spec:
  #   fixed.check  preprocesses backslash+CRLF inside strings.
  #   text.check   rejects unquoted text that cannot start a valid
  #                JSON5 IdentifierName AND is not a registered value
  #                keyword or regex-matched number.
  options: fixed: { check: '@fixed-check' }
  options: text:  { check: '@text-check' }

  # JSON5 numeric literals: allow hex, disallow octal / binary / digit
  # separators. Reject JS-style leading-zero integers (\`010\`, \`-098\`).
  options: number: {
    lex: true
    hex: true
    oct: false
    bin: false
    sep: ''
    exclude: '@/^[+-]?0[0-9]/'
  }

  # JSON5 comments are \`//\` and \`/* */\`. Hash comments are disabled here
  # and only enabled by the plugin when the \`hashComment\` option is set.
  options: comment: {
    def: {
      slash: { line: true start: '//' lex: true eatline: false }
      multi: { line: false start: '/*' end: '*/' lex: true eatline: false }
      hash:  { line: true start: '#' lex: false eatline: false }
    }
  }

  # JSON5 strings: single or double quote, with ES5.1 escapes plus line
  # continuations (backslash + line terminator produces an empty string).
  options: string: {
    lex: true
    chars: JSON5_QUOTE_CHARS
    multiChars: JSON5_MULTI_QUOTE_CHARS
    escapeChar: '\\\\'
    escape: {
      b:  '\\b'
      f:  '\\f'
      n:  '\\n'
      r:  '\\r'
      t:  '\\t'
      v:  '\\v'
      '0': '\\u0000'
      '"': '"'
      "'": "'"
      '\`': '\`'
      '\\\\': '\\\\'
      '/': '/'
      # JSON5 line continuation: backslash + LineTerminatorSequence.
      '\\n': ''
      '\\r': ''
      '\\u2028': ''
      '\\u2029': ''
    }
    allowUnknown: true
  }

  # Value keywords. The Infinity / NaN family is layered on by the
  # plugin (because the numeric literals cannot be round-tripped through
  # this grammar parser as actual JS numbers). The regex-matched
  # defs pick up number shapes the built-in number lexer does not
  # recognise — trailing-decimal-with-exponent (\`5.e4\`) and uppercase
  # \`0X\` hex — so both TS and Go exhibit the same behaviour on those.
  options: value: {
    lex: true
    def: {
      true:  { val: true }
      false: { val: false }
      null:  { val: null }

      trailingDecExp: {
        match:   '@/^[+-]?[0-9]+\\\\.[eE][+-]?[0-9]+/'
        val:     '@parse-trailing-dec-exp'
        consume: true
      }

      uppercaseHex: {
        match:   '@/^[+-]?0X[0-9a-fA-F]+/'
        val:     '@parse-uppercase-hex'
        consume: true
      }
    }
  }

  # JSON5 objects extend on duplicate keys (last wins); no bare-colon
  # child syntax. Lists are strict — no named properties, pairs, or
  # bare-colon children.
  options: map:  { extend: true  child: false }
  options: list: { property: false pair: false child: false }

  # Reject an entirely empty source. A comments-only source is handled
  # in code by dropping the \`#ZZ jsonic\` alternate from the val rule.
  options: lex: { empty: false emptyResult: null }

  options: error: {
    json5_empty:    'JSON5 input must contain a value'
    json5_no_value: 'JSON5 input must contain a value'
  }
  options: hint: {
    json5_empty: 'JSON5 requires a top-level value. An empty source is not a valid JSON5 document.'
    json5_no_value: 'JSON5 requires a top-level value. A source that consists only of whitespace and comments is not valid.'
  }
}
`
// --- END EMBEDDED json5-grammar.jsonic ---

// Plugin implementation.
const Json5: Plugin = (tn: Tabnas, options: Json5Options) => {
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
    const cfg: any = (lex as any).cfg
    const def = cfg?.value?.def || {}
    for (const name of Object.keys(def)) {
      if (forward.startsWith(name)) return undefined
    }
    const defre = cfg?.value?.defre || []
    for (const entry of defre) {
      if (entry.match && entry.match.test(forward)) return undefined
    }
    return { done: true, token: undefined }
  }

  const parseTrailingDecExp = (res: RegExpMatchArray) => parseFloat(res[0])
  const parseUppercaseHex = (res: RegExpMatchArray) => {
    let s = res[0]
    let sign = 1
    if (s[0] === '-') { sign = -1; s = s.slice(1) }
    else if (s[0] === '+') { s = s.slice(1) }
    return sign * parseInt(s.slice(2), 16)
  }

  // Parse the embedded grammar with a jsonic-grammar engine, then
  // patch the placeholders and attach the ref map.
  const grammarDef: any = new Tabnas().use(jsonic).parse(grammarText)

  // Substitute the placeholder bare-identifier strings with the real
  // character sets. (The grammar parser cannot round-trip some of
  // these code points safely as string literals.)
  grammarDef.options.space.chars = JSON5_WHITESPACE
  grammarDef.options.line.chars = JSON5_LINE_TERMINATOR
  grammarDef.options.line.rowChars = JSON5_ROW_CHARS
  grammarDef.options.string.chars = options.backtickString ? '\'"`' : '\'"'
  grammarDef.options.string.multiChars = options.backtickString ? '`' : ''

  // Option-dependent overrides applied on top of the strict-JSON5 grammar.
  grammarDef.options.number.hex = options.hex
  grammarDef.options.number.oct = options.octal
  grammarDef.options.number.bin = options.binary
  grammarDef.options.number.sep = options.numberSeparator ? '_' : null
  grammarDef.options.comment.def.hash.lex = !!options.hashComment
  grammarDef.options.lex.empty = !options.requireValue

  if (!options.strictValue) {
    delete grammarDef.options.tokenSet.VAL
  }

  // Infinity / NaN keywords need to be layered on here — they cannot
  // appear in the grammar file as JS numbers.
  if (options.infinity) {
    const inf = { val: Infinity }
    const ninf = { val: -Infinity }
    const nan = { val: NaN }
    grammarDef.options.value.def.Infinity = inf
    grammarDef.options.value.def['+Infinity'] = inf
    grammarDef.options.value.def['-Infinity'] = ninf
    grammarDef.options.value.def.NaN = nan
    grammarDef.options.value.def['+NaN'] = nan
    grammarDef.options.value.def['-NaN'] = nan
  }

  const refs: Record<string, any> = {
    '@fixed-check': fixedCheck,
    '@text-check': textCheck,
    '@parse-trailing-dec-exp': parseTrailingDecExp,
    '@parse-uppercase-hex': parseUppercaseHex,
  }
  grammarDef.ref = refs

  tn.grammar(grammarDef)

  // Jsonic's option merge is additive for char sets, so explicitly prune
  // backtick from the quote sets when it's not enabled.
  const cfg: any = tn.internal().config
  if (!options.backtickString) {
    delete cfg.string.quoteMap['`']
    delete cfg.string.multiChars['`']
  }

  // Rule-level trims the grammar file cannot express declaratively:
  //   - pair.Open loses its leading-comma `jsonic` alt so `{,}` fails.
  //   - pair gains an after-open validator that rejects #TX keys whose
  //     source text is not a valid JSON5 IdentifierName.
  //   - val.Open loses its `#ZZ jsonic` alt (when requireValue is set)
  //     so a source containing only whitespace/comments errors out.
  const TinTX = tn.token('#TX')

  tn.rule('pair', (rs: any) => {
    const alts = rs.def?.open || rs.open
    if (Array.isArray(alts)) {
      const filtered = alts.filter(
        (a: any) => !a || !tagContains(a.g, ['comma', 'jsonic']),
      )
      if (rs.def) rs.def.open = filtered
      else rs.open = filtered
    }
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

  if (options.requireValue) {
    tn.rule('val', (rs: any) => {
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
    const parser: any = tn.internal().parser
    const origStart: (...args: any[]) => any = parser.start.bind(parser)
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
