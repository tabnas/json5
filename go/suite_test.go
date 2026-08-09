package tabnasjson5

// suite_test.go — the official json5/json5-tests conformance corpus.
//
// The corpus is vendored under `test/json5-tests/` (upstream MIT, see its
// LICENSE.md) so it is present unconditionally — in a clean clone, offline,
// and in CI. `test/json5-tests-expected.json` is the generated expected-VALUE
// oracle (scripts/gen-json5-expected.js: JSON.parse for .json, ES5 eval for
// .json5, the oracle json5-tests' own README prescribes). Go has no ES5
// evaluator, which is why the oracle is precomputed: it is what lets this
// runner and ts/test/suite.test.ts assert exactly the same expected values.
//
// This runner asserts BOTH halves, exactly as ts/test/suite.test.ts does:
//
//	valid (.json/.json5)  must parse AND produce the canonical expected value
//	invalid (.js/.txt)    must be REJECTED with an error
//
// It MUST NOT be possible for this suite to skip. A missing corpus or oracle
// is a hard t.Fatalf, never t.Skip: a conformance run that silently does not
// happen is the defect this harness exists to prevent.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"unicode/utf16"

	jsonic "github.com/tabnas/jsonic/go"
)

const suiteMissing = `The json5/json5-tests conformance corpus is not usable.
It is vendored at test/json5-tests/ with its generated oracle at
test/json5-tests-expected.json (regenerate: make gen-suite-expected).
This suite must never skip: a conformance run that silently does not
happen is the defect this harness exists to prevent.`

// --- canonical value form; must stay byte-compatible with
// --- scripts/gen-json5-expected.js and ts/test/suite.test.ts

const canonHex = "0123456789abcdef"

// canonQuote renders a string as an ASCII-only quoted form. It walks UTF-16
// code units (not runes) so it matches the JavaScript implementation exactly.
func canonQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, c := range utf16.Encode([]rune(s)) {
		switch {
		case c == 0x22:
			b.WriteString(`\"`)
		case c == 0x5c:
			b.WriteString(`\\`)
		case 0x20 <= c && c <= 0x7e:
			b.WriteByte(byte(c))
		default:
			b.WriteString(`\u`)
			b.WriteByte(canonHex[(c>>12)&0xf])
			b.WriteByte(canonHex[(c>>8)&0xf])
			b.WriteByte(canonHex[(c>>4)&0xf])
			b.WriteByte(canonHex[c&0xf])
		}
	}
	b.WriteByte('"')
	return b.String()
}

func canonFloat(f float64) string {
	if math.IsNaN(f) {
		return "NaN"
	}
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	if math.IsInf(f, -1) {
		return "-Infinity"
	}
	return fmt.Sprintf("#%016x", math.Float64bits(f))
}

func canon(v any) (string, error) {
	switch t := v.(type) {
	case nil:
		return "null", nil
	case bool:
		if t {
			return "true", nil
		}
		return "false", nil
	case string:
		return canonQuote(t), nil
	case float64:
		return canonFloat(t), nil
	case float32:
		return canonFloat(float64(t)), nil
	case int:
		return canonFloat(float64(t)), nil
	case int32:
		return canonFloat(float64(t)), nil
	case int64:
		return canonFloat(float64(t)), nil
	case uint64:
		return canonFloat(float64(t)), nil
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return "", err
		}
		return canonFloat(f), nil
	case []any:
		parts := make([]string, 0, len(t))
		for _, e := range t {
			s, err := canon(e)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case map[string]any:
		return canonPairs(t, nil)
	case *jsonic.OrderedMap:
		if t == nil {
			return "null", nil
		}
		return canonPairs(t.Vals, t.Keys)
	}
	if jsonic.IsUndefined(v) {
		return "null", nil
	}
	return "", fmt.Errorf("uncanonicalisable value of type %T", v)
}

// canonPairs sorts by the (ASCII) quoted key form, which is what the JS side
// does, so UTF-16 vs UTF-8 ordering can never make the two disagree.
func canonPairs(vals map[string]any, order []string) (string, error) {
	keys := order
	if keys == nil {
		keys = make([]string, 0, len(vals))
		for k := range vals {
			keys = append(keys, k)
		}
	}
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		v, ok := vals[k]
		if !ok {
			continue
		}
		s, err := canon(v)
		if err != nil {
			return "", err
		}
		parts = append(parts, canonQuote(k)+":"+s)
	}
	sort.Strings(parts)
	return "{" + strings.Join(parts, ",") + "}", nil
}

type suiteCase struct {
	Outcome string `json:"outcome"`
	Canon   string `json:"canon"`
	Oracle  string `json:"oracle"`
}

type suiteDerived struct {
	// Truncations maps a fixture to the prefix lengths ES5 ACCEPTS; every
	// other prefix length must be a JSON5 parse error.
	Truncations map[string][]int    `json:"truncations"`
	Trailing    map[string][]string `json:"trailing"`
}

type suiteManifest struct {
	Cases   map[string]suiteCase `json:"cases"`
	Derived suiteDerived         `json:"derived"`
}

func TestOfficialSuite(t *testing.T) {
	root := filepath.Join("..", "test", "json5-tests")
	manifestPath := filepath.Join("..", "test", "json5-tests-expected.json")

	if _, err := os.Stat(root); err != nil {
		t.Fatalf("%s\nmissing dir: %s (%v)", suiteMissing, root, err)
	}
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("%s\nmissing oracle: %s (%v)", suiteMissing, manifestPath, err)
	}
	var manifest suiteManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("bad oracle %s: %v", manifestPath, err)
	}
	if len(manifest.Cases) == 0 {
		t.Fatalf("oracle %s has no cases", manifestPath)
	}

	j := jsonic.Make()
	if err := j.UseDefaults(Json5, Defaults()); err != nil {
		t.Fatalf("UseDefaults: %v", err)
	}

	var files []string
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		switch filepath.Ext(path) {
		case ".json", ".json5", ".js", ".txt":
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatalf("%s\nno suite files discovered under %s", suiteMissing, root)
	}
	if len(files) != len(manifest.Cases) {
		t.Errorf("corpus has %d fixtures but the oracle has %d cases — run: make gen-suite-expected",
			len(files), len(manifest.Cases))
	}

	for _, path := range files {
		rel, _ := filepath.Rel(root, path)
		name := strings.ReplaceAll(rel, string(os.PathSeparator), "/")
		t.Run(name, func(t *testing.T) {
			expect, ok := manifest.Cases[name]
			if !ok {
				t.Fatalf("no oracle entry for %s", name)
			}

			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}

			ext := filepath.Ext(path)
			shouldParse := ext == ".json" || ext == ".json5"
			if shouldParse != (expect.Outcome == "value") {
				t.Fatalf("oracle/extension disagree for %s", name)
			}

			// Parse is the package-level wrapper that applies the
			// requireValue rule — the exact counterpart of the TS plugin's
			// wrapped parser.start, which is what ts/test/suite.test.ts
			// exercises via j.parse. Calling j.Parse directly here would
			// test a DIFFERENT entry point from the TypeScript suite.
			got, perr := Parse(j, string(data))

			if !shouldParse {
				if perr == nil {
					gotCanon, cerr := canon(got)
					if cerr != nil {
						gotCanon = fmt.Sprintf("%#v", got)
					}
					t.Errorf("expected parse error, but parsed to: %s", gotCanon)
				}
				return
			}

			if perr != nil {
				t.Fatalf("expected to parse, got error: %v", perr)
			}
			gotCanon, cerr := canon(got)
			if cerr != nil {
				t.Fatalf("cannot canonicalise result: %v (%#v)", cerr, got)
			}
			if gotCanon != expect.Canon {
				t.Errorf("wrong parsed value\n  got  %s\n  want %s", gotCanon, expect.Canon)
			}
		})
	}

	// --- DERIVED supplement (NOT part of json5/json5-tests) ---------------
	//
	// Every case below is a string the ES5 engine itself rejects. JSON5 is a
	// strict subset of ES5, so a JSON5 parser must reject them too. They
	// exist because the official corpus has no truncated and no
	// trailing-garbage documents, and therefore cannot see base-grammar
	// leniency leaking through the plugin: a parser that auto-closes `{a:1`
	// or that silently discards everything after the first complete
	// top-level value passes the whole official corpus. Mirrors the same
	// block in ts/test/suite.test.ts.
	t.Run("derived-truncation", func(t *testing.T) {
		for rel, es5Accepts := range manifest.Derived.Truncations {
			t.Run(rel, func(t *testing.T) {
				data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
				if err != nil {
					t.Fatal(err)
				}
				skip := make(map[int]bool, len(es5Accepts))
				for _, n := range es5Accepts {
					skip[n] = true
				}
				runes := []rune(string(data))
				var accepted []string
				probed := 0
				for n := 1; n < len(runes); n++ {
					if skip[n] {
						continue
					}
					probed++
					src := string(runes[:n])
					got, perr := Parse(j, src)
					if perr == nil {
						c, cerr := canon(got)
						if cerr != nil {
							c = fmt.Sprintf("%#v", got)
						}
						accepted = append(accepted, fmt.Sprintf("%q -> %s", src, c))
					}
				}
				if 0 < len(accepted) {
					show := accepted
					if 5 < len(show) {
						show = show[:5]
					}
					t.Errorf("%d/%d ES5-invalid truncations were ACCEPTED, e.g.\n  %s",
						len(accepted), probed, strings.Join(show, "\n  "))
				}
			})
		}
	})

	t.Run("derived-trailing", func(t *testing.T) {
		for rel, suffixes := range manifest.Derived.Trailing {
			t.Run(rel, func(t *testing.T) {
				data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
				if err != nil {
					t.Fatal(err)
				}
				var accepted []string
				for _, suffix := range suffixes {
					got, perr := Parse(j, string(data)+suffix)
					if perr == nil {
						c, cerr := canon(got)
						if cerr != nil {
							c = fmt.Sprintf("%#v", got)
						}
						accepted = append(accepted, fmt.Sprintf("%q -> %s", suffix, c))
					}
				}
				if 0 < len(accepted) {
					t.Errorf("%d/%d ES5-invalid trailing suffixes were ACCEPTED (garbage after a complete value silently ignored):\n  %s",
						len(accepted), len(suffixes), strings.Join(accepted, "\n  "))
				}
			})
		}
	})
}
