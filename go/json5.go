// Package json5 is a Jsonic plugin that configures a Jsonic parser
// instance to parse JSON5 syntax:
// single- and double-quoted strings, unquoted and single-quoted object
// keys, trailing commas, `//` and `/* */` comments, hexadecimal integers,
// Infinity / NaN, leading- and trailing-decimal numbers, explicit `+`
// signs, and string line continuations.
//
// This is a Go port of the @jsonic/json5 TypeScript plugin. Both ports
// configure their host Jsonic instance the same way and pass the full
// official json5/json5-tests corpus.
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
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	jsonic "github.com/jsonicjs/jsonic/go"
)

// Version is the semantic version of this plugin.
const Version = "0.1.0"

// JSON5 WhiteSpace characters: tab, vertical tab, form feed, space,
// no-break space, BOM, and everything in Unicode category Zs.
const json5WhiteSpace = "\t\v\f \u00A0\uFEFF" +
	"\u1680" + // OGHAM SPACE MARK
	"\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A" +
	"\u202F" + // NARROW NO-BREAK SPACE
	"\u205F" + // MEDIUM MATHEMATICAL SPACE
	"\u3000" // IDEOGRAPHIC SPACE

// JSON5 LineTerminator characters: LF, CR, LINE SEPARATOR, PARAGRAPH SEPARATOR.
const json5LineTerminator = "\r\n\u2028\u2029"

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

// leadingZero matches JSON5-invalid leading-zero integer patterns such
// as "010", "0123", "-098", "+080". JSON5 decimal integers must be a
// single "0" or start with a non-zero digit.
var leadingZero = regexp.MustCompile(`^[+-]?0[0-9]`)

// trailingDecExp matches decimal numbers of the form "5.e4" /
// "-1.E-2" — a trailing decimal point immediately followed by an
// exponent. Jsonic Go's number lexer rejects this shape so the plugin
// registers a regex value def that catches it.
var trailingDecExp = regexp.MustCompile(`^[+-]?[0-9]+\.[eE][+-]?[0-9]+`)

// uppercaseHex matches `0X...` hexadecimal literals. Jsonic TS's number
// lexer only accepts the lowercase `0x` prefix; the plugin registers
// this value def so both ports accept both forms.
var uppercaseHex = regexp.MustCompile(`^[+-]?0X[0-9a-fA-F]+`)

// isJS5IdentifierStart reports whether r may begin a JSON5 IdentifierName.
// JSON5 defers to ECMAScript 5.1 IdentifierStart:
//
//	UnicodeLetter | '$' | '_' | '\' UnicodeEscapeSequence
func isJS5IdentifierStart(r rune) bool {
	if r == '$' || r == '_' || r == '\\' {
		return true
	}
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r)
}

// isJS5IdentifierPart reports whether r may continue a JSON5 IdentifierName.
// JSON5 defers to ECMAScript 5.1 IdentifierPart.
func isJS5IdentifierPart(r rune) bool {
	if isJS5IdentifierStart(r) {
		return true
	}
	if r == '\u200C' || r == '\u200D' { // ZWNJ, ZWJ
		return true
	}
	return unicode.IsDigit(r) ||
		unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Mc, r) ||
		unicode.Is(unicode.Pc, r)
}

// isValidIdentifierName reports whether s is a well-formed JSON5
// IdentifierName (used as an unquoted object key).
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

// Json5 is the plugin entry point. Pass it to jsonic.UseDefaults together
// with Defaults():
//
//	j.UseDefaults(json5.Json5, json5.Defaults())
func Json5(j *jsonic.Jsonic, opts map[string]any) error {
	yes := true
	no := false

	infinity := optBool(opts, "infinity", true)
	hex := optBool(opts, "hex", true)
	hashComment := optBool(opts, "hashComment", false)
	backtickString := optBool(opts, "backtickString", false)
	numberSeparator := optBool(opts, "numberSeparator", false)
	octal := optBool(opts, "octal", false)
	binary := optBool(opts, "binary", false)
	requireValue := optBool(opts, "requireValue", true)
	strictValue := optBool(opts, "strictValue", true)

	// Comment definitions. slash and multi are always on; hash is opt-in.
	commentDefs := map[string]*jsonic.CommentDef{
		"slash": {Line: true, Start: "//", Lex: &yes, EatLine: &no},
		"multi": {Line: false, Start: "/*", End: "*/", Lex: &yes, EatLine: &no},
	}
	hashLex := &no
	if hashComment {
		hashLex = &yes
	}
	commentDefs["hash"] = &jsonic.CommentDef{
		Line: true, Start: "#", Lex: hashLex, EatLine: &no,
	}

	// String quotes: backtick is additionally enabled when requested.
	stringChars := "'\""
	multiChars := ""
	if backtickString {
		stringChars = "'\"`"
		multiChars = "`"
	}

	// Numeric separator: "_" when enabled, empty string disables entirely.
	sep := ""
	if numberSeparator {
		sep = "_"
	}

	// Value keywords. JSON's three plus JSON5's Infinity / NaN family.
	// Extra regex-based entries close gaps in Jsonic's number lexer so
	// both TS and Go ports accept the full JSON5 number grammar.
	valueDef := map[string]*jsonic.ValueDef{
		"true":  {Val: true},
		"false": {Val: false},
		"null":  {Val: nil},
		// Trailing decimal + exponent (e.g. "5.e4"). Jsonic Go's number
		// lexer rejects this shape; we catch it via a regex value def.
		"trailingDecExp": {
			Match: trailingDecExp,
			ValFunc: func(m []string) any {
				f, _ := strconv.ParseFloat(m[0], 64)
				return f
			},
			Consume: true,
		},
		// Uppercase "0X" hex prefix. Jsonic TS's number lexer only
		// accepts lowercase "0x"; a regex value def papers over that.
		"uppercaseHex": {
			Match: uppercaseHex,
			ValFunc: func(m []string) any {
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
			},
			Consume: true,
		},
	}
	if infinity {
		valueDef["Infinity"] = &jsonic.ValueDef{Val: math.Inf(1)}
		valueDef["+Infinity"] = &jsonic.ValueDef{Val: math.Inf(1)}
		valueDef["-Infinity"] = &jsonic.ValueDef{Val: math.Inf(-1)}
		valueDef["NaN"] = &jsonic.ValueDef{Val: math.NaN()}
		valueDef["+NaN"] = &jsonic.ValueDef{Val: math.NaN()}
		valueDef["-NaN"] = &jsonic.ValueDef{Val: math.NaN()}
	}

	hexPtr := &yes
	if !hex {
		hexPtr = &no
	}
	octPtr := &no
	if octal {
		octPtr = &yes
	}
	binPtr := &no
	if binary {
		binPtr = &yes
	}
	emptyPtr := &yes
	if requireValue {
		emptyPtr = &no
	}

	// JSON5 values are string, number, boolean, null, object, or array.
	// Removing #TX from VAL blocks bare identifiers like `foo` at value
	// positions while unquoted object keys keep working via #KEY.
	var tokenSet map[string][]string
	if strictValue {
		tokenSet = map[string][]string{
			"VAL": {"#ST", "#NR", "#VL"},
		}
	}

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

	// textCheck rejects unquoted text tokens that cannot be a valid
	// JSON5 IdentifierName AND are not a value-def keyword / regex
	// match. Returning Done=true with a nil Token tells the lexer no
	// token exists here so the parser raises "unexpected character".
	// Identifier-name validation for keys (e.g. `multi-word`) happens
	// in a rule action further down; here we only need to stop the
	// text matcher from consuming entirely non-identifier starts like
	// `!` or `10twenty`.
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
		for name, def := range valueDef {
			if def.Match != nil {
				if def.Match.MatchString(forward) {
					return nil
				}
				continue
			}
			if strings.HasPrefix(forward, name) {
				return nil
			}
		}
		return &jsonic.LexCheckResult{Done: true, Token: nil}
	}

	j.SetOptions(jsonic.Options{
		Rule:     &jsonic.RuleOptions{Exclude: "imp"},
		TokenSet: tokenSet,
		Space: &jsonic.SpaceOptions{
			Lex:   &yes,
			Chars: json5WhiteSpace,
		},
		Line: &jsonic.LineOptions{
			Lex:      &yes,
			Chars:    json5LineTerminator,
			RowChars: "\n\u2028\u2029",
		},
		Fixed: &jsonic.FixedOptions{
			Lex: &yes,
		},
		Text: &jsonic.TextOptions{
			Lex: &yes,
		},
		Number: &jsonic.NumberOptions{
			Lex: &yes,
			Hex: hexPtr,
			Oct: octPtr,
			Bin: binPtr,
			Sep: sep,
			// Reject JS-style octal and noctal leading-zero literals.
			Exclude: func(s string) bool {
				return leadingZero.MatchString(s)
			},
		},
		Comment: &jsonic.CommentOptions{
			Lex: &yes,
			Def: commentDefs,
		},
		String: &jsonic.StringOptions{
			Lex:        &yes,
			Chars:      stringChars,
			MultiChars: multiChars,
			EscapeChar: "\\",
			Escape: map[string]string{
				"b":  "\b",
				"f":  "\f",
				"n":  "\n",
				"r":  "\r",
				"t":  "\t",
				"v":  "\v",
				"0":  "\x00",
				"\"": "\"",
				"'":  "'",
				"`":  "`",
				"\\": "\\",
				"/":  "/",
				// Line continuation: backslash + line terminator → empty.
				"\n":     "",
				"\r":     "",
				"\u2028": "",
				"\u2029": "",
			},
			AllowUnknown: &yes,
		},
		Value: &jsonic.ValueOptions{
			Lex: &yes,
			Def: valueDef,
		},
		Map:  &jsonic.MapOptions{Extend: &yes, Child: &no},
		List: &jsonic.ListOptions{Property: &no, Pair: &no, Child: &no},
		Lex: &jsonic.LexOptions{
			Empty:       emptyPtr,
			EmptyResult: nil,
		},
		Error: map[string]string{
			"json5_empty":    "JSON5 input must contain a value",
			"json5_no_value": "JSON5 input must contain a value",
		},
		Hint: map[string]string{
			"json5_empty": "JSON5 requires a top-level value. An empty " +
				"source is not a valid JSON5 document.",
			"json5_no_value": "JSON5 requires a top-level value. A source " +
				"that consists only of whitespace and comments is not valid.",
		},
	})

	cfg := j.Config()

	// Remove backtick from the quote sets when not explicitly enabled —
	// Jsonic's buildConfig restores the default backtick multi-line
	// quote whenever Options.String.MultiChars is empty.
	if !backtickString {
		if cfg != nil && cfg.MultiChars != nil {
			delete(cfg.MultiChars, '`')
		}
		if cfg != nil && cfg.StringChars != nil {
			delete(cfg.StringChars, '`')
		}
	}

	// Wire the LexCheck hooks directly on the config. The installed
	// Jsonic version exposes them as *LexConfig fields rather than as
	// option fields.
	if cfg != nil {
		cfg.FixedCheck = fixedCheck
		cfg.TextCheck = textCheck
	}

	// Grammar alternates resolve token sets at Make() time, so later
	// TokenSet overrides do not propagate into the val/pair rule alts.
	// Walk the rule spec map and tune the resolved Tin sets to match
	// JSON5 semantics.
	//
	//   strictValue  → drop #TX from every "val"-tagged alt so bare text
	//                  is never a valid top-level value (while unquoted
	//                  keys keep working through #KEY).
	//   always        → drop #NR from every "pair"-tagged alt so numeric
	//                   keys like `{10: 1}` are rejected. JSON5 permits
	//                   reserved-word keys (TinVL) and string / text.
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

	// Reject a `{,}` lone-comma object by dropping pair.Open's leading-
	// comma alt (tagged "comma,jsonic"). Trailing commas (in pair.Close)
	// are untouched, preserving JSON5 trailing-comma support.
	//
	// Also install an after-open state action that validates any #TX key:
	// JSON5 requires unquoted keys to be valid IdentifierNames, so text
	// tokens like `multi-word` or `foo!bar` must be rejected here because
	// Jsonic's text matcher is happy to consume them.
	j.Rule("pair", func(rs *jsonic.RuleSpec) {
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

	// Reject a source that contains only whitespace and comments. The
	// val rule has a `#ZZ jsonic` alt that accepts an empty parse at the
	// top level; drop it when a value is required.
	if requireValue {
		j.Rule("val", func(rs *jsonic.RuleSpec) {
			rs.Open = dropRootZZAlt(rs.Open)
		})
	}

	return nil
}

// filterTinFromAlts removes `tin` from the Tin-set at each slot of every
// alt tagged with `requiredTag`. If removal empties a slot, the alt is
// dropped entirely (an empty Tin set would match everything).
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

// dropAltsByTag returns a new slice with every alt whose G tags contain
// ALL of the comma-separated requiredTags removed.
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

// dropRootZZAlt returns a new slice with the "empty at top" alt
// removed — the one tagged `jsonic` whose single slot matches only #ZZ.
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
