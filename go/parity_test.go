// Copyright (c) 2025 Richard Rodger and other contributors, MIT License

package tabnasjson5

// parity_test.go — cross-runtime conformance, driven by the shared
// `test/spec/*.tsv` fixtures at the repo root (see ../test/AGENTS.md).
//
// The fixture loader, the escape codec, the ERROR:<code> contract and the
// row loop all come from github.com/tabnas/support/go, whose TypeScript
// half ts/test/parity.test.ts uses to run the SAME files — so the two
// implementations cannot drift without one of them going red, and neither
// can the two loaders.
//
// What is left here is only what is specific to json5.

import (
	"encoding/json"
	"math"
	"testing"

	jsonic "github.com/tabnas/jsonic/go"
	support "github.com/tabnas/support/go"
)

// TestSpec runs every fixture in the spec directory. FindSpecDir walks up
// from the package directory, and Dir discovers the files by listing, so
// adding a .tsv runs it in both runtimes without touching either runner.
func TestSpec(t *testing.T) {
	dir, err := support.FindSpecDir("")
	if err != nil {
		t.Fatal(err)
	}

	support.Runner{
		// A fresh parser per row: the `opts` column is per-case, and
		// plugin options must not leak from one row into the next.
		ParseRow: func(input string, row *support.Row) (any, error) {
			opts := map[string]any{}
			if raw := row.Named("opts"); "" != raw {
				if err := json.Unmarshal([]byte(raw), &opts); err != nil {
					return nil, err
				}
			}

			j := jsonic.Make()
			if err := j.UseDefaults(Json5, Defaults(), opts); err != nil {
				return nil, err
			}
			// The package-level Parse applies the requireValue rule, which
			// is what the TS plugin folds into its own tn.parse.
			return Parse(j, input)
		},

		// JSON cannot express JSON5's non-finite numbers or an absent
		// value, so the expected column also accepts these bare tokens.
		// NaN compares equal to itself in the runner's JSON-semantics
		// comparison, which is why they can be plain expected values
		// rather than a special case in the loop.
		//
		// UNDEFINED is a different result from null. Go returns a bare nil
		// for both, so it cannot make the distinction TypeScript makes;
		// specUndefined below folds the engine's sentinel into nil too.
		ParseExpected: func(expected string, _ *support.Row) (any, error) {
			switch expected {
			case "NaN":
				return math.NaN(), nil
			case "Infinity":
				return math.Inf(1), nil
			case "-Infinity":
				return math.Inf(-1), nil
			case "UNDEFINED":
				return nil, nil
			}
			return support.ParseExpect(expected)
		},

		Normalize: func(v any) any { return jsonFlatten(specUndefined(v)) },
	}.Dir(t, dir)
}

// specUndefined folds the engine's undefined sentinel into a plain nil,
// which is what an UNDEFINED cell asks for here.
func specUndefined(v any) any {
	if nil != v && jsonic.IsUndefined(v) {
		return nil
	}
	return v
}

// jsonFlatten renders a value as JSON and reads it back as plain
// map/slice/float64/string/bool/nil. A value that will not marshal is
// returned as it is — which is what happens to a non-finite number, and
// is exactly right: NaN and ±Inf reach the comparison intact, where the
// runner knows how to compare them.
func jsonFlatten(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return v
	}
	return out
}
