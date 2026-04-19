package json5

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestOfficialSuite runs the official json5/json5-tests corpus (vendored
// under ../test/json5-tests). File extensions dictate the expectation:
//
//	.json  - valid JSON (and therefore valid JSON5); must parse.
//	.json5 - valid JSON5; must parse.
//	.js    - valid JavaScript but not valid JSON5; must fail.
//	.txt   - invalid; must fail.
//
// Each file becomes a subtest named after its relative path, so failures
// point directly at the offending fixture.
func TestOfficialSuite(t *testing.T) {
	root := filepath.Join("..", "test", "json5-tests")
	if _, err := os.Stat(root); os.IsNotExist(err) {
		t.Skipf("json5-tests corpus not found at %s", root)
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

	var pass, fail int
	for _, path := range files {
		rel, _ := filepath.Rel(root, path)
		name := strings.ReplaceAll(rel, string(os.PathSeparator), "/")
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			_, perr := Parse(string(data))
			ext := filepath.Ext(path)
			shouldParse := ext == ".json" || ext == ".json5"
			if shouldParse && perr != nil {
				fail++
				t.Errorf("expected to parse, got error: %v", perr)
			}
			if !shouldParse && perr == nil {
				fail++
				t.Errorf("expected parse error, but parsing succeeded")
			}
			if !t.Failed() {
				pass++
			}
		})
	}
	t.Logf("official suite: %d/%d passed", pass, pass+fail)
}
