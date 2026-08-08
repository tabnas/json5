package tabnasjson5

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	jsonic "github.com/tabnas/jsonic/go"
)

// jsonLike normalizes a parsed value so it can be compared against
// encoding/json's representation of the same document: every numeric type
// collapses to float64 (the only number type encoding/json produces) and
// maps / slices are rebuilt recursively.
func jsonLike(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, e := range t {
			out[k] = jsonLike(e)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			out[i] = jsonLike(e)
		}
		return out
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float32:
		return float64(t)
	default:
		return v
	}
}

// TestOfficialSuite runs the vendored json5/json5-tests corpus. Fixture
// extensions determine expectation:
//
//	.json  - valid JSON   (must parse)
//	.json5 - valid JSON5  (must parse)
//	.js    - valid ES5 but not JSON5 (must error)
//	.txt   - invalid in all formats (must error)
//
// Each file becomes a subtest named after its relative path so failures
// point directly at the offending fixture.
func TestOfficialSuite(t *testing.T) {
	root := filepath.Join("..", "test", "json5-tests")
	if _, err := os.Stat(root); os.IsNotExist(err) {
		t.Skipf("json5-tests corpus not found at %s", root)
	}

	j := jsonic.Make()
	if err := j.UseDefaults(Json5, Defaults()); err != nil {
		t.Fatalf("UseDefaults: %v", err)
	}

	var files []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		ext := filepath.Ext(path)
		switch ext {
		case ".json", ".json5", ".js", ".txt":
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no suite files discovered")
	}

	for _, path := range files {
		rel, _ := filepath.Rel(root, path)
		name := strings.ReplaceAll(rel, string(os.PathSeparator), "/")
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			got, perr := j.Parse(string(data))
			ext := filepath.Ext(path)
			shouldParse := ext == ".json" || ext == ".json5"
			if shouldParse && perr != nil {
				t.Errorf("expected to parse, got error: %v", perr)
			}
			if !shouldParse && perr == nil {
				t.Errorf("expected parse error, but parsing succeeded")
			}
			// Every JSON document is a JSON5 document with the same VALUE,
			// so encoding/json is an oracle for the .json fixtures — parsing
			// without error is not enough, the result has to be right too.
			// (One upstream fixture, comments/irregular-block-comment.json,
			// is mislabelled: it holds a JSON5 block comment, so it is not
			// valid JSON. Apply the oracle only where it really applies.)
			if ext == ".json" && perr == nil {
				var want any
				if err := json.Unmarshal(data, &want); err == nil {
					if !reflect.DeepEqual(jsonLike(plainMapNode(got)), jsonLike(want)) {
						t.Errorf("value mismatch:\n got: %#v\nwant: %#v", got, want)
					}
				}
			}
		})
	}
}
