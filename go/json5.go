// Package tabnasjson5 is a Jsonic plugin that configures a Jsonic parser
// instance to parse JSON5 syntax:
// single- and double-quoted strings, unquoted and single-quoted object
// keys, trailing commas, `//` and `/* */` comments, hexadecimal integers,
// Infinity / NaN, leading- and trailing-decimal numbers, explicit `+`
// signs, and string line continuations.
//
// This is a Go port of the @tabnas/json5 TypeScript plugin. Both ports
// share json5-grammar.jsonic (a declarative Jsonic-format spec) and
// pass the full official json5/json5-tests corpus.
//
//	import (
//	    tabnasjsonic "github.com/tabnas/jsonic/go"
//	    tabnasjson5 "github.com/tabnas/json5/go"
//	)
//
//	j := tabnasjsonic.Make()
//	if err := j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults()); err != nil {
//	    return err
//	}
//	v, err := j.Parse(`{ a: 1, b: +Infinity, c: [1,2,] }`)
package tabnasjson5

import (
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	jsonic "github.com/tabnas/jsonic/go"
	tabnas "github.com/tabnas/parser/go"
)

// VERSION is this module's version. It MUST equal ts/package.json
// "version": the release orchestrator rewrites both, and
// TestVersionMatchesPackageJSON fails the build if they drift.
const VERSION = "0.5.13"

// requireValueMark is the decoration key under which the plugin records
// the resolved requireValue option on the instance, so the Parse wrapper
// can apply the empty-input guard (see Parse).
const requireValueMark = "json5$requireValue"

// JSON5 WhiteSpace characters: HT, VT, FF, SP, NBSP, BOM, plus the
// Unicode Zs category chars the spec enumerates.
const json5WhiteSpace = "\t\v\f \u00A0\uFEFF" +
	"\u1680" +
	"\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A" +
	"\u202F\u205F\u3000"

// JSON5 LineTerminator characters: LF, CR, LS, PS.
const json5LineTerminator = "\r\n\u2028\u2029"

// JSON5 row-incrementing line terminators (the ones that bump the line
// counter): LF, LS, PS. CR is folded into the following LF for CRLF.
const json5RowChars = "\n\u2028\u2029"

// isLineTerminatorRune reports whether r is a JSON5 LineTerminator.
func isLineTerminatorRune(r rune) bool {
	return r == '\n' || r == '\r' || r == '\u2028' || r == '\u2029'
}

// What a string literal holds, as scanStringEscapes reports it. A string
// with neither is the engine's.
type stringEscapes struct {
	// forbidden: an escape ES5.1 refuses (\1..\9, \0 before a digit, \u{),
	// so the string is refused at its quote.
	forbidden bool
	// continued: a LineContinuation, so the fixed check reads the string.
	continued bool
}

// scanStringEscapes reports what the string literal opening at start holds,
// walked the way the string check has always walked it: an escape takes the
// character after it along, and the walk ends at the closing quote or the
// end of the source. Mirrors scanString in ts/src/json5.ts.
func scanStringEscapes(src string, start int, quote, esc rune) stringEscapes {
	var found stringEscapes
	_, qsize := utf8.DecodeRuneInString(src[start:])
	for i := start + qsize; i < len(src); {
		r, size := utf8.DecodeRuneInString(src[i:])
		if r == quote {
			break
		}
		if r != esc {
			i += size
			continue
		}
		if i+size >= len(src) {
			break
		}
		next := src[i+size]
		var after byte
		if i+size+1 < len(src) {
			after = src[i+size+1]
		}
		// Skip the escape lead and the character it escapes.
		n, nsize := utf8.DecodeRuneInString(src[i+size:])
		if ('1' <= next && next <= '9') ||
			(next == '0' && '0' <= after && after <= '9') ||
			(next == 'u' && after == '{') {
			found.forbidden = true
		} else if isLineTerminatorRune(n) {
			found.continued = true
		}
		i += size + nsize
	}
	return found
}

// readContinuedString reads the string literal at the cursor, which holds a
// JSON5 LineContinuation: a backslash and the LineTerminatorSequence after
// it (CRLF counting as one), which adds nothing to the value.
//
// The engine cannot read one. Its escape map is keyed by the single
// character after the backslash, an entry whose replacement is the empty
// string only removes the escape, and its string matcher never counts a row
// inside an escape. Removing the continuations from the source before
// lexing, as this plugin used to, made the value right and every later
// position wrong: each one took a line out of the text the lexer counted,
// so every token and every error after it was reported that many rows early
// (tabnas/json5#80). The removal also completed a partial escape across the
// line break, reading \x4, a continuation and b as \x4b.
//
// So this reads the string where it stands, the way the engine's string
// matcher reads every other one: the same escape map, the same \x and \u
// forms, the same surrogate pairing, the same errors on the same characters.
// Nothing is rewritten, so every row, column and offset after the string is
// the source's own. A continuation ends a row when its terminator is one of
// the engine's row characters (LF, LS and PS, so CRLF too); a lone CR is not
// one, inside a string or out, and counts as the two columns the source
// has. A continuation is no code unit, so a surrogate pair written either
// side of one is still a pair, as it is in the source text. The grammar
// declares no string.replace, so there is no replace step. Mirrors
// readContinuedString in ts/src/json5.ts.
func readContinuedString(lex *tabnas.Lex, quote, esc rune) *tabnas.Token {
	cfg := lex.Config
	p := lex.Cursor()
	src := lex.Src
	start := p.SI
	_, qsize := utf8.DecodeRuneInString(src[start:])
	multiLine := cfg.MultiChars[quote]

	sI := start + qsize
	rI := p.RI
	cI := p.CI + 1
	var sb strings.Builder

	// UTF-16 surrogate pairing, as the engine's string matcher does it: a
	// high surrogate is held until the next code unit decides it, and one
	// that nothing pairs with is U+FFFD.
	pendingHi := -1
	flushHi := func() {
		if pendingHi >= 0 {
			sb.WriteRune(utf8.RuneError)
			pendingHi = -1
		}
	}
	emitUnit := func(cc int) {
		if 0xD800 <= cc && cc <= 0xDBFF {
			flushHi()
			pendingHi = cc
			return
		}
		if 0xDC00 <= cc && cc <= 0xDFFF {
			if pendingHi >= 0 {
				sb.WriteRune(rune(0x10000 + (pendingHi-0xD800)<<10 + (cc - 0xDC00)))
				pendingHi = -1
				return
			}
			sb.WriteRune(utf8.RuneError)
			return
		}
		flushHi()
		sb.WriteRune(rune(cc))
	}

	// An error inside the string is sited where it stands: on the offending
	// character, or on the backslash of a malformed escape.
	bad := func(why string, at, atCI, end int) *tabnas.Token {
		if end > len(src) {
			end = len(src)
		}
		p.SI, p.RI, p.CI = at, rI, atCI
		tkn := lex.Token("#BD", tabnas.TinBD, nil, src[at:end])
		tkn.Why = why
		return tkn
	}

	for sI < len(src) {
		c, size := utf8.DecodeRuneInString(src[sI:])

		if c == quote {
			flushHi()
			tkn := lex.Token("#ST", tabnas.TinST, sb.String(), src[start:sI+size])
			p.SI, p.RI, p.CI = sI+size, rI, cI+1
			return tkn
		}

		if c == esc {
			if sI+size >= len(src) {
				break
			}
			n, nsize := utf8.DecodeRuneInString(src[sI+size:])
			body := sI + size + nsize

			if isLineTerminatorRune(n) {
				ender := n
				if n == '\r' && strings.HasPrefix(src[body:], "\n") {
					ender = '\n'
					body++
				}
				sI = body
				if cfg.RowChars[ender] {
					rI++
					cI = 1
				} else {
					cI += 2
				}
				continue
			}

			if n != 'u' {
				flushHi()
			}

			if rep, ok := cfg.EscapeMap[string(n)]; ok {
				sb.WriteString(rep)
				sI = body
				cI += 2
				continue
			}

			if n == 'x' && !cfg.EscapeStrict {
				cc := hexValue(src, body, 2)
				if cc < 0 {
					return bad("invalid_ascii", sI, cI, sI+4)
				}
				emitUnit(cc)
				sI = body + 2
				cI += 4
				continue
			}

			if n == 'u' {
				cc := hexValue(src, body, 4)
				if cc < 0 {
					return bad("invalid_unicode", sI, cI, sI+6)
				}
				emitUnit(cc)
				sI = body + 4
				cI += 6
				continue
			}

			if !cfg.AllowUnknownEscape {
				return bad("unexpected", sI+size, cI+1, body)
			}
			sb.WriteString(src[sI+size : body])
			sI = body
			cI += 2
			continue
		}

		if c < 32 {
			if multiLine && cfg.LineChars[c] {
				flushHi()
				sb.WriteRune(c)
				sI += size
				if cfg.RowChars[c] {
					rI++
				}
				cI = 1
				continue
			}
			if !cfg.AllowControl || cfg.LineChars[c] {
				return bad("unprintable", sI, cI, sI+size)
			}
		}

		flushHi()
		sb.WriteString(src[sI : sI+size])
		sI += size
		cI++
	}

	// Unterminated: sited on the opening quote, as the engine sites it.
	tkn := lex.Token("#BD", tabnas.TinBD, nil, src[start:])
	tkn.Why = "unterminated_string"
	return tkn
}

// hexValue reads exactly n hex digits at src[at:], or answers -1 when fewer
// than n are there: a short or junk-terminated run is not an escape.
func hexValue(src string, at, n int) int {
	if at+n > len(src) {
		return -1
	}
	v := 0
	for _, b := range []byte(src[at : at+n]) {
		switch {
		case '0' <= b && b <= '9':
			v = v<<4 | int(b-'0')
		case 'a' <= b && b <= 'f':
			v = v<<4 | int(b-'a'+10)
		case 'A' <= b && b <= 'F':
			v = v<<4 | int(b-'A'+10)
		default:
			return -1
		}
	}
	return v
}

// --- BEGIN EMBEDDED json5-grammar.jsonic ---
const grammarText = `# JSON5 Grammar Definition
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
  # Drop Jsonic's implicit top-level list / map alternates so ` + "`" + `a:1` + "`" + ` and
  # ` + "`" + `1,2` + "`" + ` are not accepted at the document root. JSON5 requires a single
  # value expression at top level.
  #
  # ` + "`" + `finish: false` + "`" + ` turns off Jsonic's auto-close of open rules at the end
  # of the source: JSON5 requires every ` + "`" + `{` + "`" + ` / ` + "`" + `[` + "`" + ` to be closed, so ` + "`" + `{a:1` + "`" + `
  # is an error, not ` + "`" + `{"a":1}` + "`" + `.
  options: rule: { exclude: 'imp' finish: false }

  # Restrict the token sets used by Jsonic's grammar rules:
  #   VAL drops #TX — reject bare unquoted text at value positions.
  #   KEY drops #NR — reject numeric keys like ` + "`" + `{10: 1}` + "`" + `.
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
  #                would otherwise accept (` + "`" + `\1` + "`" + `..` + "`" + `\9` + "`" + `, ` + "`" + `\0` + "`" + ` followed by
  #                a digit, and the ES2015-only ` + "`" + `\u{...}` + "`" + ` form).
  options: fixed: { check: '@fixed-check' }
  options: text:  { check: '@text-check' }

  # JSON5 numeric literals: allow hex, disallow octal / binary / digit
  # separators. Reject JS-style leading-zero integers (` + "`" + `010` + "`" + `, ` + "`" + `-098` + "`" + `).
  options: number: {
    lex: true
    hex: true
    oct: false
    bin: false
    sep: ''
    exclude: '@/^[+-]?0[0-9]/'
  }

  # JSON5 comments are ` + "`" + `//` + "`" + ` and ` + "`" + `/* */` + "`" + `. Hash comments are disabled here
  # and only enabled by the plugin when the ` + "`" + `hashComment` + "`" + ` option is set.
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
    escapeChar: '\\'
    escape: {
      b:  '\b'
      f:  '\f'
      n:  '\n'
      r:  '\r'
      t:  '\t'
      v:  '\v'
      '0': '\u0000'
      '"': '"'
      "'": "'"
      '` + "`" + `': '` + "`" + `'
      '\\': '\\'
      '/': '/'
    }
    allowUnknown: true
  }

  # Value keywords. The Infinity / NaN family is layered on by the
  # plugin (because the numeric literals cannot be round-tripped through
  # this grammar parser as actual JS numbers). The regex-matched
  # defs pick up number shapes the built-in number lexer does not
  # recognise — trailing-decimal-with-exponent (` + "`" + `5.e4` + "`" + `) and uppercase
  # ` + "`" + `0X` + "`" + ` hex — so both TS and Go exhibit the same behaviour on those.
  options: value: {
    lex: true
    def: {
      true:  { val: true }
      false: { val: false }
      null:  { val: null }

      trailingDecExp: {
        match:   '@/^[+-]?(?:0|[1-9][0-9]*)\\.[eE][+-]?[0-9]+/'
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
  # in code by dropping the ` + "`" + `#ZZ jsonic` + "`" + ` alternate from the val rule.
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

// Defaults returns a fresh copy of the default plugin options.
// Use via tabnasjsonic.UseDefaults:
//
//	j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults())
//
// Override individual flags by passing a third argument with just the
// keys you want to change:
//
//	j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{
//	    "hashComment": true,
//	})
func Defaults() map[string]any {
	return map[string]any{
		"infinity":        true,
		"hex":             true,
		"hashComment":     false,
		"backtickString":  false,
		"numberSeparator": false,
		"octal":           false,
		"binary":          false,
		"requireValue":    true,
		"strictValue":     true,
	}
}

// optBool reads a boolean option by key, returning fallback if absent or
// not a bool.
func optBool(opts map[string]any, key string, fallback bool) bool {
	if opts == nil {
		return fallback
	}
	if v, ok := opts[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return fallback
}

// plainMapNode recursively rewrites any *tabnas.OrderedMap object node
// into a plain map[string]any (dropping the now-tracked insertion order)
// and copies []any elements, leaving all other values untouched. A parsed
// jsonic object is an ordered *OrderedMap, but this plugin's grammar tree
// is configuration whose key order is meaningless, and both the patching
// code below and the engine's map-shaped consumers (MapToOptions,
// ResolveFuncRefs) assert on plain map[string]any deeply — so flatten it.
func plainMapNode(v any) any {
	switch node := v.(type) {
	case *tabnas.OrderedMap:
		m := make(map[string]any, len(node.Keys))
		for _, k := range node.Keys {
			m[k] = plainMapNode(node.Vals[k])
		}
		return m
	case map[string]any:
		m := make(map[string]any, len(node))
		for k, elem := range node {
			m[k] = plainMapNode(elem)
		}
		return m
	case []any:
		out := make([]any, len(node))
		for i, elem := range node {
			out[i] = plainMapNode(elem)
		}
		return out
	default:
		return v
	}
}

// idStartRune reports whether r is an ECMAScript 5.1 IdentifierStart
// CHARACTER \u2014 the `\` that introduces a UnicodeEscapeSequence is not
// included (see isJS5IdentifierStart for the source-level test).
func idStartRune(r rune) bool {
	if r == '$' || r == '_' {
		return true
	}
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r)
}

func idPartRune(r rune) bool {
	if idStartRune(r) {
		return true
	}
	if r == '\u200C' || r == '\u200D' {
		return true
	}
	return unicode.IsDigit(r) ||
		unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Mc, r) ||
		unicode.Is(unicode.Pc, r)
}

// isJS5IdentifierStart reports whether r may begin a JSON5 IdentifierName
// in the SOURCE text: an IdentifierStart character, or the `\` of a
// UnicodeEscapeSequence.
func isJS5IdentifierStart(r rune) bool {
	return r == '\\' || idStartRune(r)
}

// decodeIdentifierName validates AND decodes a JSON5 IdentifierName (used
// for unquoted keys), returning the decoded name and true, or false when
// the source is not a legal ECMAScript 5.1 IdentifierName.
//
// An IdentifierStart / IdentifierPart may be written as a
// UnicodeEscapeSequence (`\uXXXX`), and the identifier's VALUE is the
// decoded text \u2014 `{ sig\u03A3ma: 1 }` has the key `sig\u03A3ma`. Each escape
// contributes exactly one UTF-16 code unit which must itself be a legal
// identifier character: per ES5.1 7.6 an escape cannot smuggle an
// otherwise-illegal character into an identifier, so ` `, `-`, a leading
// `0`, and escaped surrogate halves are all rejected. Mirrors the TS
// decodeIdentifierName.
func decodeIdentifierName(s string) (string, bool) {
	if s == "" {
		return "", false
	}
	var b strings.Builder
	first := true
	for i := 0; i < len(s); {
		var r rune
		if s[i] == '\\' {
			if i+6 > len(s) || s[i+1] != 'u' {
				return "", false
			}
			cu, err := strconv.ParseUint(s[i+2:i+6], 16, 32)
			if err != nil {
				return "", false
			}
			r = rune(cu)
			// A lone UTF-16 surrogate half is not an identifier character.
			if 0xD800 <= r && r <= 0xDFFF {
				return "", false
			}
			i += 6
		} else {
			size := 0
			r, size = utf8.DecodeRuneInString(s[i:])
			if r == utf8.RuneError && size <= 1 {
				return "", false
			}
			i += size
		}
		if first {
			if !idStartRune(r) {
				return "", false
			}
			first = false
		} else if !idPartRune(r) {
			return "", false
		}
		b.WriteRune(r)
	}
	return b.String(), true
}

// Json5 is the plugin entry point. Pass it to tabnasjsonic.UseDefaults
// together with Defaults():
//
//	j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults())
func Json5(j *tabnas.Tabnas, opts map[string]any) error {
	infinity := optBool(opts, "infinity", true)
	hex := optBool(opts, "hex", true)
	hashComment := optBool(opts, "hashComment", false)
	backtickString := optBool(opts, "backtickString", false)
	numberSeparator := optBool(opts, "numberSeparator", false)
	octal := optBool(opts, "octal", false)
	binary := optBool(opts, "binary", false)
	requireValue := optBool(opts, "requireValue", true)
	strictValue := optBool(opts, "strictValue", true)

	// fixedCheck runs before every lexer step, ahead of every matcher, and
	// so ahead of jsonic's own unprintable pre-scan, which reads a backslash
	// and a CR as one escape and then refuses the LF after them. A string
	// that holds a LineContinuation is its own: at the string's opening
	// quote it reads it (readContinuedString) and hands the engine the
	// finished token. Such a string never reaches stringCheck, so one that
	// also holds a forbidden escape is refused here instead, the same way
	// and at the same place: unexpected, on the quote. Anywhere else
	// fixedCheck does nothing, and every other string is the engine's.
	fixedCheck := func(lex *tabnas.Lex) *tabnas.LexCheckResult {
		p := lex.Cursor()
		cfg := lex.Config
		if p == nil || cfg == nil || p.SI >= len(lex.Src) {
			return nil
		}
		quote, qsize := utf8.DecodeRuneInString(lex.Src[p.SI:])
		if !cfg.StringChars[quote] {
			return nil
		}
		esc := cfg.EscapeChar
		if esc == 0 {
			esc = '\\'
		}
		found := scanStringEscapes(lex.Src, p.SI, quote, esc)
		if !found.continued {
			return nil
		}
		if found.forbidden {
			tkn := lex.Token("#BD", tabnas.TinBD, nil, lex.Src[p.SI:p.SI+qsize])
			tkn.Why = "unexpected"
			return &tabnas.LexCheckResult{Done: true, Token: tkn}
		}
		return &tabnas.LexCheckResult{Done: true, Token: readContinuedString(lex, quote, esc)}
	}

	// textCheck rejects unquoted text tokens that cannot start a valid
	// JSON5 IdentifierName AND are not a value-def keyword / regex match.
	// Returning Done=true with a nil Token tells the lexer no token
	// exists here, raising "unexpected character".
	textCheck := func(lex *tabnas.Lex) *tabnas.LexCheckResult {
		p := lex.Cursor()
		if p == nil || p.SI >= len(lex.Src) {
			return nil
		}
		forward := lex.Src[p.SI:]
		r, _ := utf8.DecodeRuneInString(forward)
		if isJS5IdentifierStart(r) {
			return nil
		}
		cfg := lex.Config
		if cfg != nil {
			for name := range cfg.ValueDef {
				if strings.HasPrefix(forward, name) {
					return nil
				}
			}
			for _, entry := range cfg.ValueDefRe {
				if entry.Def != nil && entry.Def.Match != nil {
					if entry.Def.Match.MatchString(forward) {
						return nil
					}
				}
			}
		}
		return &tabnas.LexCheckResult{Done: true, Token: nil}
	}

	// stringCheck rejects escape sequences that ECMAScript 5.1 — and hence
	// JSON5 — forbids inside a string literal, but that the engine's
	// permissive escape handling (AllowUnknownEscape, non-strict \u{...})
	// would otherwise accept:
	//   \1 .. \9    a DecimalDigit is an EscapeCharacter, so it is not a
	//               NonEscapeCharacter: legacy octal escapes are not JSON5.
	//   \0<digit>   `0` is an escape only when NOT followed by a DecimalDigit.
	//   \u{XXXX}    the ES2015 code-point form; JSON5 has only \uXXXX.
	// Returning Done=true with a nil Token halts lexing at this position so
	// the parser raises "unexpected character" — the same shape textCheck
	// uses. Mirrors the TS stringCheck.
	stringCheck := func(lex *tabnas.Lex) *tabnas.LexCheckResult {
		p := lex.Cursor()
		if p == nil || p.SI >= len(lex.Src) {
			return nil
		}
		cfg := lex.Config
		if cfg == nil || cfg.StringChars == nil {
			return nil
		}
		quote, _ := utf8.DecodeRuneInString(lex.Src[p.SI:])
		if !cfg.StringChars[quote] {
			return nil
		}
		esc := cfg.EscapeChar
		if esc == 0 {
			esc = '\\'
		}
		if scanStringEscapes(lex.Src, p.SI, quote, esc).forbidden {
			return &tabnas.LexCheckResult{Done: true, Token: nil}
		}
		return nil
	}

	parseTrailingDecExp := func(m []string) any {
		f, _ := strconv.ParseFloat(m[0], 64)
		return f
	}
	parseUppercaseHex := func(m []string) any {
		s := m[0]
		sign := int64(1)
		switch s[0] {
		case '-':
			sign = -1
			s = s[1:]
		case '+':
			s = s[1:]
		}
		n, _ := strconv.ParseInt(s[2:], 16, 64)
		return float64(sign * n)
	}

	// Parse the embedded grammar using a standard Jsonic instance, then
	// patch the placeholders and attach the ref map.
	parser := jsonic.Make()
	parsed, err := parser.Parse(grammarText)
	if err != nil {
		return err
	}
	// A jsonic parse now yields insertion-ordered *OrderedMap object nodes.
	// The embedded grammar is configuration — its key order carries no
	// meaning — and the rest of this function (plus the engine's
	// MapToOptions / ResolveFuncRefs consumers) assert deeply on plain
	// map[string]any. Flatten the parsed tree back to plain maps so all of
	// that keeps working unchanged.
	gmap, ok := plainMapNode(parsed).(map[string]any)
	if !ok {
		return nil
	}
	optionsMap, _ := gmap["options"].(map[string]any)
	if optionsMap == nil {
		optionsMap = map[string]any{}
	}

	// Substitute placeholder bare-identifier strings with the real
	// character sets.
	if sp, ok := optionsMap["space"].(map[string]any); ok {
		sp["chars"] = json5WhiteSpace
	}
	if ln, ok := optionsMap["line"].(map[string]any); ok {
		ln["chars"] = json5LineTerminator
		ln["rowChars"] = json5RowChars
	}
	stringOpts, _ := optionsMap["string"].(map[string]any)
	if stringOpts != nil {
		if backtickString {
			stringOpts["chars"] = "'\"`"
			stringOpts["multiChars"] = "`"
		} else {
			stringOpts["chars"] = "'\""
			stringOpts["multiChars"] = ""
		}
	}

	// Option-dependent overrides applied on top of the strict baseline.
	if numOpts, ok := optionsMap["number"].(map[string]any); ok {
		numOpts["hex"] = hex
		numOpts["oct"] = octal
		numOpts["bin"] = binary
		if numberSeparator {
			numOpts["sep"] = "_"
		} else {
			numOpts["sep"] = ""
		}
	}
	if commentOpts, ok := optionsMap["comment"].(map[string]any); ok {
		if defMap, ok := commentOpts["def"].(map[string]any); ok {
			if hashDef, ok := defMap["hash"].(map[string]any); ok {
				hashDef["lex"] = hashComment
			}
		}
	}
	if lexOpts, ok := optionsMap["lex"].(map[string]any); ok {
		lexOpts["empty"] = !requireValue
	}
	if !strictValue {
		if tokenSet, ok := optionsMap["tokenSet"].(map[string]any); ok {
			delete(tokenSet, "VAL")
		}
	}

	// Infinity / NaN cannot be round-tripped through the grammar parser
	// as actual float values, so layer them on here.
	if infinity {
		if valueOpts, ok := optionsMap["value"].(map[string]any); ok {
			defMap, _ := valueOpts["def"].(map[string]any)
			if defMap == nil {
				defMap = map[string]any{}
				valueOpts["def"] = defMap
			}
			defMap["Infinity"] = map[string]any{"val": math.Inf(1)}
			defMap["+Infinity"] = map[string]any{"val": math.Inf(1)}
			defMap["-Infinity"] = map[string]any{"val": math.Inf(-1)}
			defMap["NaN"] = map[string]any{"val": math.NaN()}
			defMap["+NaN"] = map[string]any{"val": math.NaN()}
			defMap["-NaN"] = map[string]any{"val": math.NaN()}
		}
	}

	refs := map[tabnas.FuncRef]any{
		"@fixed-check":            tabnas.LexCheck(fixedCheck),
		"@text-check":             tabnas.LexCheck(textCheck),
		"@string-check":           tabnas.LexCheck(stringCheck),
		"@parse-trailing-dec-exp": func(m []string) any { return parseTrailingDecExp(m) },
		"@parse-uppercase-hex":    func(m []string) any { return parseUppercaseHex(m) },
	}

	grammarDef := &tabnas.GrammarSpec{
		Ref:        refs,
		OptionsMap: optionsMap,
	}
	if err := j.Grammar(grammarDef); err != nil {
		return err
	}

	cfg := j.Config()

	// Jsonic's buildConfig restores the default multi-line quote set
	// (containing '`') whenever Options.String.MultiChars is empty, so
	// explicitly prune the backtick char here if not enabled.
	if !backtickString {
		if cfg != nil && cfg.MultiChars != nil {
			delete(cfg.MultiChars, '`')
		}
		if cfg != nil && cfg.StringChars != nil {
			delete(cfg.StringChars, '`')
		}
	}

	// Wire the LexCheck hooks directly on the config — Jsonic's
	// MapToOptions does not pass `check` through to the resolved
	// options struct in this version.
	if cfg != nil {
		cfg.FixedCheck = fixedCheck
		cfg.TextCheck = textCheck
		cfg.StringCheck = stringCheck
	}

	// MapToOptions accepts `number.exclude` as either *regexp.Regexp or
	// func(string) bool. The grammar path resolves @/pattern/ to a
	// RegExp and MapToOptions wraps it — nothing more to do here.

	// Grammar alternates resolve token sets at Make() time. Even though
	// the grammar sets tokenSet.VAL/KEY, the resolved S0/S1 bitmasks on
	// pre-built val/pair alts do not pick that up. Filter #TX from val
	// alts and #NR from pair alts directly to make the restriction
	// effective at parse time.
	txTin := tabnas.TinTX
	nrTin := tabnas.TinNR
	for _, rs := range j.RSM() {
		if strictValue {
			filterTinFromAlts(rs.OpenAlts(), txTin, "val")
			filterTinFromAlts(rs.CloseAlts(), txTin, "val")
		}
		filterTinFromAlts(rs.OpenAlts(), nrTin, "pair")
		filterTinFromAlts(rs.CloseAlts(), nrTin, "pair")
	}

	// Rule-level trims the grammar file cannot express declaratively:
	//   - pair.Open loses its leading-comma `jsonic` alt so `{,}` fails.
	//   - pair gains an after-open validator that rejects #TX keys
	//     whose source text is not a valid JSON5 IdentifierName.
	//   - val.Open loses its `#ZZ jsonic` alt (when requireValue is
	//     set) so a source containing only comments errors out.
	j.Rule("pair", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
		filtered := dropAltsByTag(rs.OpenAlts(), "comma,jsonic")
		rs.ClearOpen()
		rs.AddOpen(filtered...)
		rs.AddAO(func(r *tabnas.Rule, ctx *tabnas.Context) {
			if r.O0 == nil || r.O0.Tin != tabnas.TinTX {
				return
			}
			name, ok := decodeIdentifierName(r.O0.Src)
			if !ok {
				ctx.ParseErr = r.O0
				return
			}
			// A key written with `\uXXXX` escapes resolves to the decoded
			// text. jsonic's `@pairkey` alt action has already copied the
			// raw token value into r.U["key"], so update both.
			if cur, _ := r.O0.Val.(string); cur != name {
				r.O0.Val = name
				if r.U == nil {
					r.U = make(map[string]any, 4)
				}
				r.U["key"] = name
			}
		})
	})

	if requireValue {
		j.Rule("val", func(rs *tabnas.RuleSpec, _ *tabnas.Parser) {
			filtered := dropRootZZAlt(rs.OpenAlts())
			rs.ClearOpen()
			rs.AddOpen(filtered...)
		})
	}

	// Record the resolved requireValue flag on the instance so Parse can
	// apply the empty-input guard. The TS plugin wraps parser.start for
	// this; the Go engine handles an empty source before any pluggable
	// hook (custom Parser.Start included), so the guard lives in the
	// package-level Parse wrapper instead.
	j.Decorate(requireValueMark, requireValue)

	return nil
}

// Parse parses a JSON5 source string with a Json5-configured instance.
// It is the Go counterpart of the TS plugin's wrapped `parser.start`:
// when the requireValue option is set (the default) and the source is
// empty, it returns a *tabnas.TabnasError with code "json5_empty"
// ("JSON5 input must contain a value"), exactly as the TS plugin
// throws. All other input delegates to j.Parse.
//
// The guard cannot be installed on j.Parse itself: the Go engine
// short-circuits an empty source before any pluggable hook runs (a
// custom Options.Parser.Start is only invoked for non-empty input), so
// with requireValue a direct j.Parse("") still fails, but with the
// engine's generic "unexpected" error rather than "json5_empty".
func Parse(j *tabnas.Tabnas, src string) (any, error) {
	if rv, ok := j.Decoration(requireValueMark).(bool); ok && rv {
		if src == "" {
			return nil, json5ValueError(j, "json5_empty")
		}
		if !hasValue(src) {
			return nil, json5ValueError(j, "json5_no_value")
		}
	}
	return j.Parse(src)
}

// hasValue reports whether src contains anything that could begin a
// value, as opposed to only whitespace and comments. JSON5 requires a
// top-level value, and a comments-only document is exactly what
// json5_no_value names.
//
// This deliberately does NOT lex or parse. It only has to find the FIRST
// character that is neither whitespace nor part of a comment, and stop
// there -- which is what makes it safe. The trap in a naive "strip the
// comments and see what is left" is a source like `"/* x */"`: a valid
// JSON5 *string* whose contents look like a comment, which stripping
// would wrongly report as empty. Here the leading quote is simply a
// non-trivia character, so the scan stops on it and answers true without
// ever looking inside.
//
// An unterminated block comment answers TRUE on purpose. `/* x` contains
// no value, but the engine's own unterminated_comment is the more useful
// diagnostic and this declines to shadow it.
//
// Mirrors hasValue in ts/src/json5.ts; keep the two in step. The
// TypeScript and Rust copies take a hashComment flag; this one does not,
// and the difference is not drift. That flag serves their
// requireValue-OFF short-circuit, which resolves a no-value source to the
// grammar's declared empty result; Go has no such short-circuit, because
// the Go engine already answers the declared empty result when the rules
// match no value, so Parse below reaches this scan only with requireValue
// ON. In that branch all three runtimes pass the slash-only scan, so that
// a hash-comment-only source is refused by the engine's own `unexpected`
// rather than json5_no_value -- the `# comment` row of
// ../test/spec/options.tsv.
func hasValue(src string) bool {
	// Decoded to runes because the whitespace JSON5 accepts is not all
	// ASCII: NBSP, BOM, the Unicode Zs class and U+2028/U+2029 are
	// multi-byte, and a byte scan would not recognise them.
	rs := []rune(src)
	n := len(rs)
	i := 0

	for i < n {
		c := rs[i]

		if isJSON5Space(c) {
			i++
			continue
		}

		if c == '/' && i+1 < n {
			d := rs[i+1]
			if d == '/' {
				// Line comment: runs to the next line terminator, or the end.
				i += 2
				for i < n && !isJSON5LineEnd(rs[i]) {
					i++
				}
				continue
			}
			if d == '*' {
				end := -1
				for k := i + 2; k+1 < n; k++ {
					if rs[k] == '*' && rs[k+1] == '/' {
						end = k
						break
					}
				}
				if end < 0 {
					return true // unterminated: leave it to unterminated_comment
				}
				i = end + 2
				continue
			}
		}

		// Anything else begins something. Whether it is a VALID value is
		// the parser's question, not this one.
		return true
	}

	return false
}

func isJSON5Space(c rune) bool {
	switch c {
	case '\t', '\v', '\f', ' ', 0x00A0, 0xFEFF, '\n', '\r', 0x2028, 0x2029:
		return true
	}
	return unicode.Is(unicode.Zs, c)
}

func isJSON5LineEnd(c rune) bool {
	return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029
}

// json5ValueError builds a requireValue error (json5_empty or
// json5_no_value) from the message and hint templates the grammar
// registers on the instance config, so the wording has one source.
func json5ValueError(j *tabnas.Tabnas, code string) error {
	e := &tabnas.TabnasError{
		Code:   code,
		Detail: "JSON5 input must contain a value",
		Row:    1,
		Col:    1,
	}
	if cfg := j.Config(); cfg != nil {
		if msg := cfg.ErrorMessages[e.Code]; msg != "" {
			e.Detail = msg
		}
		e.Hint = cfg.Hints[e.Code]
	}
	return e
}

// filterTinFromAlts removes `tin` from the Tin-set at each slot of every
// alt tagged with `requiredTag`.
func filterTinFromAlts(alts []*tabnas.AltSpec, tin tabnas.Tin, requiredTag string) {
	for _, alt := range alts {
		if alt == nil || !tagContains(alt.G, requiredTag) {
			continue
		}
		for i, slot := range alt.S {
			filtered := slot[:0]
			for _, t := range slot {
				if t != tin {
					filtered = append(filtered, t)
				}
			}
			alt.S[i] = filtered
		}
	}
}

func dropAltsByTag(alts []*tabnas.AltSpec, requiredTags string) []*tabnas.AltSpec {
	required := strings.Split(requiredTags, ",")
	result := make([]*tabnas.AltSpec, 0, len(alts))
	for _, alt := range alts {
		if alt == nil {
			continue
		}
		matchAll := true
		for _, tag := range required {
			tag = strings.TrimSpace(tag)
			if tag != "" && !tagContains(alt.G, tag) {
				matchAll = false
				break
			}
		}
		if !matchAll {
			result = append(result, alt)
		}
	}
	return result
}

func dropRootZZAlt(alts []*tabnas.AltSpec) []*tabnas.AltSpec {
	result := make([]*tabnas.AltSpec, 0, len(alts))
	for _, alt := range alts {
		if alt != nil && isZZJsonicAlt(alt) {
			continue
		}
		result = append(result, alt)
	}
	return result
}

func isZZJsonicAlt(alt *tabnas.AltSpec) bool {
	if !tagContains(alt.G, "jsonic") {
		return false
	}
	if len(alt.S) != 1 {
		return false
	}
	slot := alt.S[0]
	if len(slot) != 1 {
		return false
	}
	return slot[0] == tabnas.TinZZ
}

func tagContains(tags, want string) bool {
	if tags == "" {
		return false
	}
	start := 0
	for i := 0; i <= len(tags); i++ {
		if i == len(tags) || tags[i] == ',' {
			tag := tags[start:i]
			for len(tag) > 0 && tag[0] == ' ' {
				tag = tag[1:]
			}
			for len(tag) > 0 && tag[len(tag)-1] == ' ' {
				tag = tag[:len(tag)-1]
			}
			if tag == want {
				return true
			}
			start = i + 1
		}
	}
	return false
}
