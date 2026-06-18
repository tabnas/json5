package tabnasjson5

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	jsonic "github.com/tabnas/jsonic/go"
)

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
			_, perr := j.Parse(string(data))
			ext := filepath.Ext(path)
			shouldParse := ext == ".json" || ext == ".json5"
			if shouldParse && perr != nil {
				t.Errorf("expected to parse, got error: %v", perr)
			}
			if !shouldParse && perr == nil {
				t.Errorf("expected parse error, but parsing succeeded")
			}
		})
	}
}
