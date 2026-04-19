// Package json5 is a Jsonic plugin that configures a Jsonic parser
// instance to parse JSON5 syntax:
// single- and double-quoted strings, unquoted and single-quoted object
// keys, trailing commas, `//` and `/* */` comments, hexadecimal integers,
// Infinity / NaN, leading- and trailing-decimal numbers, explicit `+`
// signs, and string line continuations.
//
// This is a Go port of the @jsonic/json5 TypeScript plugin. Like the TS
// version, it leans on Jsonic's built-in lexer/parser and configures it
// to match the JSON5 spec. Features Jsonic supports by default but JSON5
// forbids (# comments, backtick strings, octal/binary numbers, `_` digit
// separators, implicit top-level lists and maps, bare top-level text)
// are rejected unless the relevant option is enabled.
//
//	import (
//	    jsonic "github.com/jsonicjs/jsonic/go"
//	    json5 "github.com/jsonicjs/json5/go"
//	)
//
//	j := jsonic.Make()
//	if err := j.UseDefaults(json5.Json5, json5.Defaults); err != nil {
//	    return err
//	}
//	v, err := j.Parse(`{ a: 1, b: +Infinity, c: [1,2,] }`)
package json5

import (
	"math"

	jsonic "github.com/jsonicjs/jsonic/go"
)

// Version is the semantic version of this plugin.
const Version = "0.1.0"

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

	// Build comment definitions. slash and multi are always on; hash is
	// opt-in because JSON5 does not permit it.
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
	multiChars := "" // left empty; cleared in Config() below since the
	// buildConfig path restores the default when MultiChars is "".
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
	valueDef := map[string]*jsonic.ValueDef{
		"true":  {Val: true},
		"false": {Val: false},
		"null":  {Val: nil},
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
	// Removing #TX from VAL blocks bare identifiers like `foo` at positions
	// where a value is expected, while unquoted object keys keep working via
	// the KEY token set (which still includes #TX).
	var tokenSet map[string][]string
	if strictValue {
		tokenSet = map[string][]string{
			"VAL": {"#ST", "#NR", "#VL"},
		}
	}

	// All configuration is applied in one SetOptions call so that
	// buildConfig rebuilds the LexConfig once and the tokenSet override
	// is applied on the resulting config (SetOptions only reads TokenSet
	// from the incoming call, not from the merged options history).
	j.SetOptions(jsonic.Options{
		Rule:     &jsonic.RuleOptions{Exclude: "imp"},
		TokenSet: tokenSet,
		Number: &jsonic.NumberOptions{
			Lex: &yes,
			Hex: hexPtr,
			Oct: octPtr,
			Bin: binPtr,
			Sep: sep,
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
				"b":      "\b",
				"f":      "\f",
				"n":      "\n",
				"r":      "\r",
				"t":      "\t",
				"v":      "\v",
				"0":      "\x00",
				"\"":     "\"",
				"'":      "'",
				"`":      "`",
				"\\":     "\\",
				"/":      "/",
				// JSON5 line continuation: backslash followed by a line
				// terminator is stripped entirely.
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
			"json5_empty": "JSON5 input must contain a value",
		},
		Hint: map[string]string{
			"json5_empty": "JSON5 requires a top-level value. An empty " +
				"source is not a valid JSON5 document.",
		},
	})

	// Jsonic's buildConfig restores the default multi-line quote set
	// (containing '`') whenever Options.String.MultiChars is empty, so
	// the only way to remove backtick entirely is to patch the config
	// after SetOptions.
	if !backtickString {
		cfg := j.Config()
		if cfg != nil && cfg.MultiChars != nil {
			delete(cfg.MultiChars, '`')
		}
		if cfg != nil && cfg.StringChars != nil {
			delete(cfg.StringChars, '`')
		}
	}

	// TokenSet("VAL", ...) does not propagate into grammar alts that were
	// resolved at Make() time, so the `val` rule still matches #TX as a
	// valid top-level value. Filter #TX out of each alt tagged `val` (the
	// single-token alt introduced by Jsonic's built-in `val` rule).
	// Pair/key alts (tagged `pair`) still match #TX via the #KEY token
	// set, preserving support for unquoted object keys.
	if strictValue {
		txTin := jsonic.TinTX
		for _, rs := range j.RSM() {
			filterTinFromAlts(rs.Open, txTin, "val")
			filterTinFromAlts(rs.Close, txTin, "val")
		}
	}

	return nil
}

// filterTinFromAlts removes `tin` from the Tin-set at each slot of every
// alt tagged with `requiredTag`. If removal empties a slot the alt is
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

func tagContains(tags, want string) bool {
	if tags == "" {
		return false
	}
	start := 0
	for i := 0; i <= len(tags); i++ {
		if i == len(tags) || tags[i] == ',' {
			tag := tags[start:i]
			// trim leading/trailing spaces
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
