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

const hex4Re = /^[0-9A-Fa-f]{4}$/

// Validate AND decode a JSON5 IdentifierName (used for unquoted keys).
// Returns the decoded name, or undefined when the source is not a legal
// ECMAScript 5.1 IdentifierName.
//
// An IdentifierStart / IdentifierPart may be written as a
// UnicodeEscapeSequence (`\uXXXX`), and the identifier's VALUE is the
// decoded text — `{ sigΣma: 1 }` has the key `sigΣma`. Each escape
// contributes exactly one UTF-16 code unit which must itself be a legal
// identifier character: per ES5.1 7.6 an escape cannot smuggle an
// otherwise-illegal character into an identifier, so ` `, `-`,
// a leading `0`, and escaped surrogate halves are all rejected.
function decodeIdentifierName(s: string): string | undefined {
  if (s.length === 0) return undefined
  let out = ''
  let first = true
  let i = 0
  while (i < s.length) {
    let ch: string
    if (s[i] === '\\') {
      if (s[i + 1] !== 'u') return undefined
      const hex = s.slice(i + 2, i + 6)
      if (!hex4Re.test(hex)) return undefined
      ch = String.fromCharCode(parseInt(hex, 16))
      i += 6
    } else {
      ch = String.fromCodePoint(s.codePointAt(i) as number)
      i += ch.length
    }
    if (first ? !idStartRe.test(ch) : !idPartRe.test(ch)) return undefined
    out += ch
    first = false
  }
  return out
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
  #
  # \`finish: false\` turns off Jsonic's auto-close of open rules at the end
  # of the source: JSON5 requires every \`{\` / \`[\` to be closed, so \`{a:1\`
  # is an error, not \`{"a":1}\`.
  options: rule: { exclude: 'imp' finish: false }

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
  #   fixed.check  reads a string literal that holds a line continuation
  #                (a backslash and a LineTerminatorSequence), which the
  #                escape map cannot express, where it stands, so every
  #                row, column and offset after it is the source's own.
  #   text.check   rejects unquoted text that cannot start a valid
  #                JSON5 IdentifierName AND is not a registered value
  #                keyword or regex-matched number.
  #   string.check rejects the escape sequences ECMAScript 5.1 forbids
  #                inside a string literal but the permissive lexer
  #                would otherwise accept (\`\\1\`..\`\\9\`, \`\\0\` followed by
  #                a digit, and the ES2015-only \`\\u{...}\` form).
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

  # JSON5 strings: single or double quote, with ES5.1 escapes. A line
  # continuation (backslash + LineTerminatorSequence, which produces the
  # empty string) has no entry here: an entry is keyed by one character,
  # which cannot spell CRLF, and the TypeScript and Go lexers take an
  # empty replacement as no entry at all. A string holding one is read by
  # fixed.check instead.
  options: string: {
    lex: true
    check: '@string-check'
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
        match:   '@/^[+-]?(?:0|[1-9][0-9]*)\\\\.[eE][+-]?[0-9]+/'
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

// LineTerminator test, shared by the string scans below.
const isLineTerminator = (ch: string | undefined) =>
  '\n' === ch || '\r' === ch || '\u2028' === ch || '\u2029' === ch

const isDigit = (ch: string | undefined) =>
  undefined !== ch && '0' <= ch && ch <= '9'

const hex2Re = /^[0-9A-Fa-f]{2}$/

// Whether the lexer holds the character at `i` of `lex.src`, reading the
// window on where `i` lies past it. In a parse from a reader a window at a
// time (`lex.window`, admin ADR-30), `lex.src` is the window's text while a
// token is cut, and `lex.pnt` counts from the window's start; the window
// may end inside the token. Where `i` lies past it, the window is asked to
// reach twice as far past `from`, the token's start, as has been read, so a
// long token costs its length to read and not its square, and `lex.src` is
// the grown window, whose positions do not move while a token is cut. So
// every read here is of the text the whole source has at that place. In a
// whole text `lex.fill` only answers.
function held(lex: Lex, from: number, i: number): boolean {
  const src: string = (lex as any).src
  if (i < src.length) return true
  const read = i - from
  ;(lex as any).fill?.(Math.max(read + 1, 2 * read))
  return i < (lex as any).src.length
}

// The characters a number is written in: an ASCII letter (a base marker, a
// hex digit, an exponent, or a keyword such as `Infinity`) or digit, a
// sign, or a point.
const isNumberChar = (ch: string | undefined) =>
  undefined !== ch &&
  (('0' <= ch && ch <= '9') ||
    ('a' <= ch && ch <= 'z') ||
    ('A' <= ch && ch <= 'Z') ||
    '+' === ch ||
    '-' === ch ||
    '.' === ch)

// Read the window on as far as the text check reads at the point: the run
// of a number's characters there and the character after it, or to the end
// of the source, so that a keyword or a value regex judged on the window
// answers what it answers of the whole source. Every keyword the check can
// meet (one that does not begin an IdentifierName, such as `-Infinity`)
// and every match of a value regex the grammar declares is a run of a
// number's characters (`value-definitions-read-a-numbers-characters` in
// test/window.test.ts).
function holdText(lex: Lex): void {
  const from = (lex as any).pnt.sI
  for (
    let end = from;
    held(lex, from, end) && isNumberChar((lex as any).src[end]);
    end++
  );
}

// What the string literal opening at the point holds, walked the way the
// string check has always walked it: an escape takes the character after
// it along, and the walk ends at the closing quote or the end of the
// source. It reads through the window (`held`), as far as the string runs.
// The answer is a set of these two bits.
//
//   FORBIDDEN  an escape ES5.1 refuses (`\1`..`\9`, `\0` before a digit,
//              `\u{`): the string is refused at its quote
//   CONTINUED  a LineContinuation: the fixed check reads the string
//
// A string with neither is the engine's.
const FORBIDDEN = 1
const CONTINUED = 2

function scanString(lex: Lex, escChar: string): number {
  const start: number = (lex as any).pnt.sI
  const at = (i: number) =>
    held(lex, start, i) ? ((lex as any).src[i] as string) : undefined
  const quote = at(start)
  let found = 0
  for (let i = start + 1; held(lex, start, i); i++) {
    const c = at(i)
    if (c === quote) break
    if (c !== escChar) continue
    const n = at(i + 1)
    if (undefined === n) break
    if (
      ('0' === n && isDigit(at(i + 2))) ||
      ('1' <= n && n <= '9') ||
      ('u' === n && '{' === at(i + 2))
    ) {
      found |= FORBIDDEN
    } else if (isLineTerminator(n)) {
      found |= CONTINUED
    }
    i++
  }
  return found
}

// Read the string literal at the lexer's point, which holds a JSON5
// LineContinuation: a backslash and the LineTerminatorSequence after it
// (CRLF counting as one), which adds nothing to the value.
//
// The engine cannot read one. Its escape map is keyed by the single
// character after the backslash, the lexer drops an entry whose
// replacement is the empty string, and its string matcher never counts a
// row inside an escape. Removing the continuations from the source before
// lexing, as this plugin used to, made the value right and every later
// position wrong: each one took a line out of the text the lexer counted,
// so every token and every error after it was reported that many rows
// early (tabnas/json5#80). The removal also completed a partial escape
// across the line break, reading `\x4`, a continuation and `b` as `\x4b`.
//
// So this reads the string where it stands, the way the engine's string
// matcher reads every other one: the same escape map, the same `\x` and
// `\u` forms, the same errors on the same characters. Nothing is
// rewritten, so every row, column and offset after the string is the
// source's own. A continuation ends a row when its terminator is one of
// the engine's row characters (LF, LS and PS, so CRLF too); a lone CR is
// not one, inside a string or out, and counts as the two columns the
// source has. The grammar declares no `string.replace`, so there is no
// replace step. It reads through the window (`held`), so a string the
// window ends inside reads as the whole text has it.
function readContinuedString(lex: Lex): any {
  const pnt: any = (lex as any).pnt
  const cfg: any = (lex as any).cfg
  const scfg = cfg.string
  const lineChars = cfg.line.chars
  const rowChars = cfg.line.rowChars
  const start = pnt.sI
  // The character at `i`, and the text from `a` to `b`, as the whole
  // source has them, cut at its end.
  const at = (i: number) =>
    held(lex, start, i) ? ((lex as any).src[i] as string) : undefined
  const text = (a: number, b: number): string => {
    held(lex, start, b - 1)
    return (lex as any).src.substring(a, b)
  }
  const quote = at(start) as string
  const multiLine = !!scfg.multiChars[quote]

  let sI = start + 1
  let rI = pnt.rI
  let cI = pnt.cI + 1
  let val = ''

  // An error inside the string is sited where it stands: on the offending
  // character, or on the backslash of a malformed escape. Its span is the
  // whole text's, cut at the end of the source.
  const bad = (why: string, at: number, atCI: number, end: number) => {
    held(lex, start, end - 1)
    pnt.sI = at
    pnt.rI = rI
    pnt.cI = atCI
    return (lex as any).bad(why, at, end)
  }

  while (held(lex, start, sI)) {
    const c = at(sI) as string

    if (c === quote) {
      const token = (lex as any).token(
        '#ST', val, text(start, sI + 1), pnt)
      pnt.sI = sI + 1
      pnt.rI = rI
      pnt.cI = cI + 1
      return token
    }

    if (c === scfg.escChar) {
      const n = at(sI + 1)
      if (undefined === n) break

      if (isLineTerminator(n)) {
        const crlf = '\r' === n && '\n' === at(sI + 2)
        sI += crlf ? 3 : 2
        if (rowChars[crlf ? '\n' : n]) {
          rI++
          cI = 1
        } else {
          cI += 2
        }
        continue
      }

      const es = scfg.escMap[n]
      if (null != es) {
        val += es
        sI += 2
        cI += 2
        continue
      }

      if ('x' === n && !scfg.escapeStrict) {
        const hex = text(sI + 2, sI + 4)
        if (!hex2Re.test(hex)) return bad('invalid_ascii', sI, cI, sI + 4)
        val += String.fromCharCode(parseInt(hex, 16))
        sI += 4
        cI += 4
        continue
      }

      if ('u' === n) {
        const hex = text(sI + 2, sI + 6)
        if (!hex4Re.test(hex)) return bad('invalid_unicode', sI, cI, sI + 6)
        val += String.fromCharCode(parseInt(hex, 16))
        sI += 6
        cI += 6
        continue
      }

      if (!scfg.allowUnknown) return bad('unexpected', sI + 1, cI + 1, sI + 2)
      val += n
      sI += 2
      cI += 2
      continue
    }

    if (multiLine && lineChars[c]) {
      val += c
      sI++
      if (rowChars[c]) rI++
      cI = 1
      continue
    }

    if (c.charCodeAt(0) < 32 && !(scfg.allowControl && !lineChars[c])) {
      return bad('unprintable', sI, cI, sI + 1)
    }

    val += c
    sI++
    cI++
  }

  // Unterminated: sited on the opening quote, as the engine sites it. The
  // walk read to the end of the source, so the window holds it all.
  return (lex as any).bad('unterminated_string', start, (lex as any).src.length)
}

// Plugin implementation.
const Json5: Plugin = (tn: Tabnas, options: Json5Options) => {
  // fixedCheck runs before every lexer step, ahead of every matcher. A
  // string that holds a LineContinuation is its own: at the string's
  // opening quote it reads it (readContinuedString) and hands the engine
  // the finished token. Such a string never reaches stringCheck, so one
  // that also holds a forbidden escape is refused here instead, the same
  // way and at the same place: `unexpected`, on the quote. Anywhere else
  // fixedCheck makes no token, and every other string is the engine's.
  //
  // In a parse from a reader it also reads the window on, first, as far
  // as any check of this grammar reads at this token: a string to its
  // closing quote (the scan, as the string check reads it), and where the
  // text check may judge the token, what it reads (holdText). The engine
  // cuts a token again over a wider window when a matcher's read reached
  // the window's end, unless the source has ended; a check that read on in
  // the middle of the cut, to the end of the source, would keep the answer
  // a matcher before it gave over the shorter window. Read on first, every
  // matcher of the cut reads the same window.
  const fixedCheck = (lex: Lex) => {
    const pnt: any = (lex as any).pnt
    const scfg: any = (lex as any).cfg?.string
    if (!pnt || !held(lex, pnt.sI, pnt.sI)) return undefined
    const src: string = (lex as any).src
    if (!scfg?.quoteMap?.[src[pnt.sI]]) {
      const r = String.fromCodePoint(src.codePointAt(pnt.sI) as number)
      if (!isIdentifierStart(r)) holdText(lex)
      return undefined
    }
    const found = scanString(lex, scfg.escChar || '\\')
    if (!(found & CONTINUED)) return undefined
    if (found & FORBIDDEN) {
      const token = (lex as any).bad('unexpected', pnt.sI, pnt.sI + 1)
      return { done: true, token }
    }
    return { done: true, token: readContinuedString(lex) }
  }

  // textCheck rejects text tokens that cannot begin a valid JSON5
  // IdentifierName AND do not correspond to a registered value-def
  // keyword / regex. Returning { done: true, token: undefined } halts
  // lexing at this position so the parser raises "unexpected character".
  //
  // It reads through the window as far as its answer needs (holdText): the
  // first character, and the run of a number's characters at the point and
  // the character after it, which holds any keyword and any value regex
  // match it can meet. fixedCheck has read that far already.
  const textCheck = (lex: Lex) => {
    const pnt: any = (lex as any).pnt
    if (!pnt || !held(lex, pnt.sI, pnt.sI)) return undefined
    const src: string = (lex as any).src
    // Read a CODE POINT, not a code unit. `forward[0]` on a JavaScript
    // string is one UTF-16 code unit, so a character outside the Basic
    // Multilingual Plane presents its high surrogate, which belongs to
    // no Unicode letter category, and `{𝒜:1}` was refused although
    // ES5.1 7.6 makes an IdentifierStart a UnicodeLetter and U+1D49C
    // MATHEMATICAL SCRIPT CAPITAL A is Lu. A lone surrogate reads as
    // itself and is still refused, and `decodeIdentifierName` already
    // walks code points, so the two halves now agree.
    const r = String.fromCodePoint(src.codePointAt(pnt.sI) as number)
    if (isIdentifierStart(r)) return undefined
    holdText(lex)
    const forward: string = (lex as any).src.slice(pnt.sI)
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

  // stringCheck rejects escape sequences that ECMAScript 5.1 — and hence
  // JSON5 — forbids inside a string literal, but that the engine's
  // permissive escape handling (allowUnknown, non-strict `\u{...}`) would
  // otherwise accept:
  //   \1 .. \9    a DecimalDigit is an EscapeCharacter, so it is not a
  //               NonEscapeCharacter: legacy octal escapes are not JSON5.
  //   \0<digit>   `0` is an escape only when NOT followed by a DecimalDigit.
  //   \u{XXXX}    the ES2015 code-point form; JSON5 has only `\uXXXX`.
  // Returning { done: true, token: undefined } halts lexing at this
  // position so the parser raises "unexpected character" — the same shape
  // textCheck uses.
  const stringCheck = (lex: Lex) => {
    const pnt: any = (lex as any).pnt
    if (!pnt || !held(lex, pnt.sI, pnt.sI)) return undefined
    const cfg: any = (lex as any).cfg
    if (!cfg?.string?.quoteMap?.[(lex as any).src[pnt.sI]]) return undefined
    if (scanString(lex, cfg.string.escChar || '\\') & FORBIDDEN) {
      return { done: true, token: undefined }
    }
    return undefined
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
    '@string-check': stringCheck,
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
      const name = decodeIdentifierName(t.src)
      if (undefined === name) {
        ;(ctx as any).ParseErr = t
        if (typeof (t as any).bad === 'function') {
          return (t as any).bad('unexpected')
        }
        return
      }
      // A key written with `\uXXXX` escapes resolves to the decoded text.
      // jsonic's `@pairkey` alt action has already copied the raw token
      // value into `r.u.key`, so update both.
      if (name !== t.val) {
        t.val = name
        ;(r as any).u.key = name
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

  requireValue(tn, options)
}

// The requireValue rule, on the instance's own `parse` and `parseReader`.
//
// With the option on (the default) an empty source is `json5_empty` and
// one of only whitespace and slash comments `json5_no_value`; with it off,
// every such source resolves to the grammar's declared empty result. The
// rule wraps the instance's `parse` and `parseReaderWithSizes`, through
// which `parseReader` reads, rather than the engine's `parser.start`: the
// engine replaces its parser whenever the instance's options change
// (`tn.options(...)`, which a host such as transduce's sources calls, and
// `make` below, which declares the window), so a wrapper on the parser was
// dropped with it, and in a parse from a reader a window at a time the
// engine hands `parser.start` an empty `src` and the source in a window.
// The instance's own methods survive both.
//
// From a reader, the rule reads only as far as its answer needs, the
// leading whitespace and comments and the first character after them
// (`readLeading`), and the parse then reads the rest, a window at a time
// where the instance declares `lex.window`. A read that fails, and bytes
// that are not UTF-8, are the parse's to report (`unreadable`).
function requireValue(tn: Tabnas, options: Json5Options): void {
  const parse = tn.parse.bind(tn)
  const parseReaderWithSizes = tn.parseReaderWithSizes.bind(tn)

  // Slash forms ONLY with the option on, deliberately, and the `false`
  // says so at the call rather than in a comment on the scan. A
  // hash-comment-only source is not `json5_no_value` there: it reaches the
  // rules and fails on the comment with the engine's own `unexpected`,
  // which is what all three runtimes do and what the `# comment` row of
  // test/spec/options.tsv pins. With the option off, the scan is told
  // which comment forms this configuration HAS: with hashComment on, `#`
  // runs to the end of the line and is trivia exactly as `//` is, so
  // `'# c'` resolves to the declared empty result like every other
  // no-value source. Until 2026-09-21 it did not, and TypeScript fell out
  // with `undefined` where both ports answered the declared empty result.
  const hashComment = !options.requireValue && !!options.hashComment

  // Without the option, a source holding no value must resolve to the
  // SAME declared empty result that `''` already resolves to. The engine
  // short-circuits only on an EXACTLY empty source; a whitespace- or
  // comments-only source reached the rules instead, matched no value, and
  // fell out as `undefined`, two answers to one question from a single
  // declaration, and the whole of the TS/Go difference once recorded
  // against this option. Such a source is parsed as `''`, through the
  // engine's own empty-source path, so the grammar declares the empty
  // result once.
  const noValue = (code: string, src: string, meta: any, parent_ctx: any) => {
    if (!options.requireValue) return parse('', meta, parent_ctx)
    const err: any = new Error('JSON5 input must contain a value')
    err.code = code
    err.details = { src }
    throw err
  }

  ;(tn as any).parse = (src: any, meta?: any, parent_ctx?: any) => {
    if ('string' !== typeof src) return parse(src, meta, parent_ctx)
    if ('' === src) {
      return options.requireValue
        ? noValue('json5_empty', src, meta, parent_ctx)
        : parse(src, meta, parent_ctx)
    }
    if (!hasValue(src, hashComment)) {
      return noValue('json5_no_value', src, meta, parent_ctx)
    }
    return parse(src, meta, parent_ctx)
  }

  ;(tn as any).parseReaderWithSizes = (
    reader: any,
    sizes: any,
    meta?: any,
    parent_ctx?: any,
  ) => {
    if (null == reader || 'function' !== typeof reader.read) {
      return parseReaderWithSizes(reader, sizes, meta, parent_ctx)
    }
    const lead = readLeading(reader, hashComment)
    if (NONE === lead.verdict) {
      return '' === lead.text
        ? options.requireValue
          ? noValue('json5_empty', '', meta, parent_ctx)
          : parse('', meta, parent_ctx)
        : noValue('json5_no_value', lead.text, meta, parent_ctx)
    }
    return parseReaderWithSizes(lead.reader, sizes, meta, parent_ctx)
  }
}

// A synchronous pull reader of bytes, as `tn.parseReader` takes one.
type Reader = { read(buf: Uint8Array): number }

// What a read that did not give bytes gave instead: it threw, or it
// answered a count it cannot have.
type ReadEnd = { error: unknown } | { count: number }

// Read `reader`'s leading whitespace and comments, as far as the
// requireValue scan needs to answer (`ValueScan`): the answer, the text
// read when it is NONE, and a reader that gives every byte `reader` gives,
// the ones read here first, and then what a read here ended on, for the
// parse. Bytes that are not UTF-8, and a read that fails, end the scan
// with VALUE, leaving them to the parse.
function readLeading(
  reader: Reader,
  hashComment: boolean,
): { verdict: number; text: string; reader: Reader } {
  const chunks: Uint8Array[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const buf = new Uint8Array(512)
  const scan = new ValueScan(hashComment)
  let text = ''
  for (;;) {
    let n: number
    try {
      n = reader.read(buf)
    } catch (error) {
      return { verdict: VALUE, text, reader: replay(chunks, undefined, { error }) }
    }
    if (!(Number.isInteger(n) && 0 <= n && n <= buf.length)) {
      return { verdict: VALUE, text, reader: replay(chunks, undefined, { count: n }) }
    }
    const end = 0 === n
    if (0 < n) chunks.push(buf.slice(0, n))
    try {
      text += decoder.decode(buf.subarray(0, n), { stream: !end })
    } catch {
      return { verdict: VALUE, text, reader: replay(chunks, end ? undefined : reader) }
    }
    const verdict = scan.scan(text, end)
    if (MORE !== verdict) {
      return { verdict, text, reader: replay(chunks, end ? undefined : reader) }
    }
  }
}

// A reader that gives `chunks`, then what a read ended on, if anything,
// then what `rest` gives.
function replay(chunks: Uint8Array[], rest?: Reader, ended?: ReadEnd): Reader {
  let i = 0
  let at = 0
  return {
    read(buf: Uint8Array): number {
      for (; i < chunks.length; i++, at = 0) {
        const chunk = chunks[i]
        if (at < chunk.length) {
          const n = Math.min(buf.length, chunk.length - at)
          buf.set(chunk.subarray(at, at + n))
          at += n
          return n
        }
      }
      if (undefined !== ended) {
        const end = ended
        ended = undefined
        if ('error' in end) throw end.error
        return end.count
      }
      return undefined === rest ? 0 : rest.read(buf)
    },
  }
}

// The requireValue scan's answers.
const MORE = 0 // what has been read does not answer: read on
const VALUE = 1 // a character that is neither whitespace nor in a comment
const NONE = 2 // only whitespace and comments, to the end of the source

// The walk of a source's leading whitespace and comments, which says
// whether anything else follows: the question hasValue answers of a text
// and readLeading of a reader. It walks the text it is given and, when that
// does not answer, goes on from where it stopped once given more, so a
// source is read only as far as its leading trivia runs.
class ValueScan {
  at = 0 // the code unit the walk has reached
  within = 0 // 0 outside a comment, 1 in a line comment, 2 in a block comment

  constructor(readonly hashComment: boolean) {}

  // Walk `src`, the source read so far, from where the walk stopped; `end`
  // says whether it is all of it.
  scan(src: string, end: boolean): number {
    const n = src.length
    for (;;) {
      if (1 === this.within) {
        // Line comment: runs to the next line terminator, or to the end.
        while (this.at < n && !isLineEnd(src[this.at])) {
          this.at++
        }
        if (this.at >= n) return end ? NONE : MORE
        this.within = 0
      } else if (2 === this.within) {
        const close = src.indexOf('*/', this.at)
        if (close < 0) {
          // Unterminated: leave it to unterminated_comment.
          if (end) return VALUE
          // A `*` the text ends on may begin the `*/`.
          this.at = Math.max(this.at, n - 1)
          return MORE
        }
        this.at = close + 2
        this.within = 0
      } else {
        if (this.at >= n) return end ? NONE : MORE
        const c = src[this.at]
        if (isSpace(c)) {
          this.at++
          continue
        }
        if (this.hashComment && '#' === c) {
          this.at++
          this.within = 1
          continue
        }
        if ('/' === c) {
          if (this.at + 1 >= n && !end) return MORE
          const d = src[this.at + 1]
          if ('/' === d) {
            this.at += 2
            this.within = 1
            continue
          }
          if ('*' === d) {
            this.at += 2
            this.within = 2
            continue
          }
        }
        // Anything else begins something. Whether it is a VALID value is
        // the parser's question, not this one.
        return VALUE
      }
    }
  }
}

// Does this source contain anything that could begin a value, or is it
// only whitespace and comments? JSON5 requires a top-level value, and a
// comments-only document is exactly what `json5_no_value` names.
//
// This deliberately does NOT lex or parse. It only has to find the FIRST
// character that is neither whitespace nor part of a comment, and stop
// there — which is what makes it safe. The trap in a naive "strip the
// comments and see what is left" is a source like `"/* x */"`: a valid
// JSON5 *string* whose contents look like a comment, which stripping
// would wrongly report as empty. Here the leading quote is simply a
// non-trivia character, so the scan stops on it and answers yes without
// ever looking inside.
//
// An unterminated block comment answers YES on purpose. `/* x` contains
// no value, but the engine's own `unterminated_comment` is the more
// useful diagnostic and this declines to shadow it.
//
// It is the walk readLeading makes of a reader (`ValueScan`), over the
// whole text.
//
// `hashComment` says whether THIS configuration also has the `#` form.
// It is a parameter rather than a read of the options because the two
// callers want different answers: the requireValue guard passes `false`,
// so a hash-comment-only source keeps falling through to the rules and
// the engine's own `unexpected`, and the requireValue-off short-circuit
// passes the option, so the same source counts as trivia and resolves to
// the declared empty result. Both answers are measured; see
// test/spec/options.tsv. (`requireValue` above makes the two calls.)
function hasValue(src: string, hashComment: boolean): boolean {
  return NONE !== new ValueScan(hashComment).scan(src, true)
}

// JSON5 whitespace: the ECMAScript set. \s covers the usual suspects
// including   and ﻿ in a JS regex, but they are named too so
// the intent survives a regex-engine difference.
function isSpace(c: string): boolean {
  return /\s/.test(c) || ' ' === c || '﻿' === c
}

function isLineEnd(c: string): boolean {
  return '\n' === c || '\r' === c || ' ' === c || ' ' === c
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

// Build a JSON5 parser whole: jsonic's base with the plugin installed, as
// `new Tabnas().use(jsonic).use(Json5, options)` builds it, and with
// `lex.window` declared, so that `tn.parseReader` reads a reader a window at
// a time rather than whole (admin ADR-30). The checks this grammar installs
// read the source only through the lexer's window, and jsonic's base is the
// engine's own matchers. The window is declared here, on the parser this
// package makes whole, and not in `Json5`, which a host may install beneath
// matchers of its own. The requireValue rule rides on the instance's own
// `parse` and `parseReader`, so it holds on the parser this returns, and
// from a reader it reads only the leading whitespace and comments.
function make(options: Partial<Json5Options> = {}): Tabnas {
  const tn = new Tabnas().use(jsonic).use(Json5, options)
  tn.options({ lex: { window: true } })
  return tn
}

// VERSION is this package's version. It MUST equal package.json "version":
// the release orchestrator rewrites both, and the version test fails the
// build if they drift. Mirrors `const VERSION` in go/json5.go.
const VERSION = '0.5.18'

export { VERSION, Json5, make }

export type { Json5Options }

export { translate } from './translate'
export type { TranslationPart, TranslationParts } from './translate'
