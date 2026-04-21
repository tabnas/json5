// Package json5 is a Jsonic plugin that configures a Jsonic parser
// instance to parse JSON5 syntax:
// single- and double-quoted strings, unquoted and single-quoted object
// keys, trailing commas, `//` and `/* */` comments, hexadecimal integers,
// Infinity / NaN, leading- and trailing-decimal numbers, explicit `+`
// signs, and string line continuations.
//
// This is a Go port of the @jsonic/json5 TypeScript plugin. Both ports
// share json5-grammar.jsonic (a declarative Jsonic-format spec) and
// pass the full official json5/json5-tests corpus.
//
//	import (
//	    jsonic "github.com/jsonicjs/jsonic/go"
//	    json5 "github.com/jsonicjs/json5/go"
//	)
//
//	j := jsonic.Make()
//	if err := j.UseDefaults(json5.Json5, json5.Defaults()); err != nil {
//	    return err
//	}
//	v, err := j.Parse(`{ a: 1, b: +Infinity, c: [1,2,] }`)
package json5

import (
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	jsonic "github.com/jsonicjs/jsonic/go"
)

// Version is the semantic version of this plugin.
const Version = "0.1.1"

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
  options: rule: { exclude: 'imp' }

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
  #   fixed.check  preprocesses backslash+CRLF inside strings.
  #   text.check   rejects unquoted text that cannot start a valid
  #                JSON5 IdentifierName AND is not a registered value
  #                keyword or regex-matched number.
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

  # JSON5 strings: single or double quote, with ES5.1 escapes plus line
  # continuations (backslash + line terminator produces an empty string).
  options: string: {
    lex: true
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
      # JSON5 line continuation: backslash + LineTerminatorSequence.
      '\n': ''
      '\r': ''
      '\u2028': ''
      '\u2029': ''
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
        match:   '@/^[+-]?[0-9]+\\.[eE][+-]?[0-9]+/'
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
// Use via jsonic.UseDefaults:
//
//	j.UseDefaults(json5.Json5, json5.Defaults())
//
// Override individual flags by passing a third argument with just the
// keys you want to change:
//
//	j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
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

// isJS5IdentifierStart reports whether r may begin a JSON5 IdentifierName.
// JSON5 defers to ECMAScript 5.1 IdentifierStart.
func isJS5IdentifierStart(r rune) bool {
	if r == '$' || r == '_' || r == '\\' {
		return true
	}
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r)
}

func isJS5IdentifierPart(r rune) bool {
	if isJS5IdentifierStart(r) {
		return true
	}
	if r == '\u200C' || r == '\u200D' {
		return true
	}
	return unicode.IsDigit(r) ||
		unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Mc, r) ||
		unicode.Is(unicode.Pc, r)
}

func isValidIdentifierName(s string) bool {
	if s == "" {
		return false
	}
	first := true
	for _, r := range s {
		if first {
			if !isJS5IdentifierStart(r) {
				return false
			}
			first = false
			continue
		}
		if !isJS5IdentifierPart(r) {
			return false
		}
	}
	return true
}

// Json5 is the plugin entry point. Pass it to jsonic.UseDefaults
// together with Defaults():
//
//	j.UseDefaults(json5.Json5, json5.Defaults())
func Json5(j *jsonic.Jsonic, opts map[string]any) error {
	infinity := optBool(opts, "infinity", true)
	hex := optBool(opts, "hex", true)
	hashComment := optBool(opts, "hashComment", false)
	backtickString := optBool(opts, "backtickString", false)
	numberSeparator := optBool(opts, "numberSeparator", false)
	octal := optBool(opts, "octal", false)
	binary := optBool(opts, "binary", false)
	requireValue := optBool(opts, "requireValue", true)
	strictValue := optBool(opts, "strictValue", true)

	// fixedCheck runs before every lexer step but gates its own work so
	// the preprocessing happens exactly once per parse. It rewrites
	// backslash+CRLF to backslash+LF so the escape-map entry for "\r"
	// handles JSON5 string line continuations that span a CRLF.
	fixedCheck := func(lex *jsonic.Lex) *jsonic.LexCheckResult {
		if lex.Ctx == nil || lex.Ctx.U == nil {
			return nil
		}
		if _, done := lex.Ctx.U["json5_preprocessed"]; done {
			return nil
		}
		lex.Ctx.U["json5_preprocessed"] = true
		if strings.Contains(lex.Src, "\\\r\n") {
			lex.Src = strings.ReplaceAll(lex.Src, "\\\r\n", "\\\n")
			if p := lex.Cursor(); p != nil {
				p.Len = len(lex.Src)
			}
		}
		return nil
	}

	// textCheck rejects unquoted text tokens that cannot start a valid
	// JSON5 IdentifierName AND are not a value-def keyword / regex match.
	// Returning Done=true with a nil Token tells the lexer no token
	// exists here, raising "unexpected character".
	textCheck := func(lex *jsonic.Lex) *jsonic.LexCheckResult {
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
		return &jsonic.LexCheckResult{Done: true, Token: nil}
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
	gmap, ok := parsed.(map[string]any)
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

	refs := map[jsonic.FuncRef]any{
		"@fixed-check":            jsonic.LexCheck(fixedCheck),
		"@text-check":             jsonic.LexCheck(textCheck),
		"@parse-trailing-dec-exp": func(m []string) any { return parseTrailingDecExp(m) },
		"@parse-uppercase-hex":    func(m []string) any { return parseUppercaseHex(m) },
	}

	grammarDef := &jsonic.GrammarSpec{
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
	}

	// MapToOptions accepts `number.exclude` as either *regexp.Regexp or
	// func(string) bool. The grammar path resolves @/pattern/ to a
	// RegExp and MapToOptions wraps it — nothing more to do here.

	// Grammar alternates resolve token sets at Make() time. Even though
	// the grammar sets tokenSet.VAL/KEY, the resolved S0/S1 bitmasks on
	// pre-built val/pair alts do not pick that up. Filter #TX from val
	// alts and #NR from pair alts directly to make the restriction
	// effective at parse time.
	txTin := jsonic.TinTX
	nrTin := jsonic.TinNR
	for _, rs := range j.RSM() {
		if strictValue {
			filterTinFromAlts(rs.Open, txTin, "val")
			filterTinFromAlts(rs.Close, txTin, "val")
		}
		filterTinFromAlts(rs.Open, nrTin, "pair")
		filterTinFromAlts(rs.Close, nrTin, "pair")
	}

	// Rule-level trims the grammar file cannot express declaratively:
	//   - pair.Open loses its leading-comma `jsonic` alt so `{,}` fails.
	//   - pair gains an after-open validator that rejects #TX keys
	//     whose source text is not a valid JSON5 IdentifierName.
	//   - val.Open loses its `#ZZ jsonic` alt (when requireValue is
	//     set) so a source containing only comments errors out.
	j.Rule("pair", func(rs *jsonic.RuleSpec, _ *jsonic.Parser) {
		rs.Open = dropAltsByTag(rs.Open, "comma,jsonic")
		rs.AO = append(rs.AO, func(r *jsonic.Rule, ctx *jsonic.Context) {
			if r.O0 == nil || r.O0.Tin != jsonic.TinTX {
				return
			}
			if !isValidIdentifierName(r.O0.Src) {
				ctx.ParseErr = r.O0
			}
		})
	})

	if requireValue {
		j.Rule("val", func(rs *jsonic.RuleSpec, _ *jsonic.Parser) {
			rs.Open = dropRootZZAlt(rs.Open)
		})
	}

	return nil
}

// filterTinFromAlts removes `tin` from the Tin-set at each slot of every
// alt tagged with `requiredTag`.
func filterTinFromAlts(alts []*jsonic.AltSpec, tin jsonic.Tin, requiredTag string) {
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

func dropAltsByTag(alts []*jsonic.AltSpec, requiredTags string) []*jsonic.AltSpec {
	required := strings.Split(requiredTags, ",")
	result := make([]*jsonic.AltSpec, 0, len(alts))
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

func dropRootZZAlt(alts []*jsonic.AltSpec) []*jsonic.AltSpec {
	result := make([]*jsonic.AltSpec, 0, len(alts))
	for _, alt := range alts {
		if alt != nil && isZZJsonicAlt(alt) {
			continue
		}
		result = append(result, alt)
	}
	return result
}

func isZZJsonicAlt(alt *jsonic.AltSpec) bool {
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
	return slot[0] == jsonic.TinZZ
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
