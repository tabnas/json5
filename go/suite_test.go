package json5

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"

	jsonic "github.com/jsonicjs/jsonic/go"
)

// loadKnownDeviations reads ../test/known-deviations.txt, stripping
// comments and blank lines. The same file is consumed by the
// TypeScript suite, so both implementations skip the same fixtures and
// thus exhibit identical pass/fail behaviour on the official corpus.
func loadKnownDeviations(t *testing.T, path string) map[string]bool {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()
	set := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		set[line] = true
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return set
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

	deviations := loadKnownDeviations(t, filepath.Join("..", "test", "known-deviations.txt"))

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
			if deviations[name] {
				t.Skip("shared known deviation")
			}
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
