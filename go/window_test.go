// Copyright (c) 2026 Richard Rodger and other contributors, MIT License

package tabnasjson5

// window_test.go — a parse from a reader (Tabnas.ParseReader, admin ADR-30
// and ADR-33).
//
// Make builds the parser whole, as tabnasjsonic.Make() then
// j.UseDefaults(Json5, Defaults(), opts) builds it, and declares lex.window
// on it, so that a reader is read a window at a time. The checks this
// grammar installs (the fixed check that reads a string holding a line
// continuation, the string check and the text check) read the source only
// through the lexer's window. These tests hold it to that: Make declares
// the window and parses every fixture row as that composition does; every
// row, every document of the vendored json5-tests corpus and every probe
// derived from it parses the same from a reader, in pieces of 1, 3, 64 and
// 4096 bytes, as from its text, through ParseReader as through Parse and
// through the instance's own ParseReader as through its Parse; and a long
// document parses the same, its tokens of every kind long and short.
//
// Go's window sizes are fixed at 64 KiB (the engine's small-window hook is
// unexported), and before each token the window reaches 64 KiB past the
// cursor, so a token meets the window's edge only where it is longer than
// that: the long document carries such tokens of every kind.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	jsonic "github.com/tabnas/jsonic/go"
	tabnas "github.com/tabnas/parser/go"
	support "github.com/tabnas/support/go"
)

// readerMargin is how far past the cursor the window reaches before each
// token is cut: a token longer than this meets the window's edge.
const readerMargin = 64 << 10

// pieces is a reader that hands its bytes over at most size at a time,
// counting what it has handed over.
type pieces struct {
	text []byte
	at   int
	size int
}

func (p *pieces) Read(buf []byte) (int, error) {
	if p.at == len(p.text) {
		return 0, io.EOF
	}
	n := min(p.size, len(buf), len(p.text)-p.at)
	copy(buf, p.text[p.at:p.at+n])
	p.at += n
	return n, nil
}

// failing is a reader that hands over text and then fails.
type failing struct {
	text []byte
	at   int
}

var errFailing = errors.New("the reader failed")

func (f *failing) Read(buf []byte) (int, error) {
	if f.at == len(f.text) {
		return 0, errFailing
	}
	n := copy(buf, f.text[f.at:])
	f.at += n
	return n, nil
}

// parsed is what a parse shows: its value, shown with its keys in their
// order, or its error's code, position, row, column and token text. An
// error's excerpt is left out: a parse from a reader shows a long line only
// as far back as the window reaches (tabnas/parser DIVERGENCE.md), and that
// is the one difference allowed.
type parsed struct {
	value string
	err   string
}

func parsedOf(v any, err error) parsed {
	if err == nil {
		return parsed{value: show(v)}
	}
	var te *tabnas.TabnasError
	if errors.As(err, &te) {
		return parsed{err: fmt.Sprintf("%s at %d %d:%d %q", te.Code, te.Pos, te.Row, te.Col, te.Src)}
	}
	return parsed{err: "not a TabnasError: " + err.Error()}
}

// show writes a parsed value with an object's keys in their order, and NaN
// as itself, so that two values are the same where their texts are.
func show(v any) string {
	switch t := v.(type) {
	case nil:
		return "null"
	case *tabnas.OrderedMap:
		parts := make([]string, 0, len(t.Keys))
		for _, k := range t.Keys {
			parts = append(parts, strconv.Quote(k)+":"+show(t.Vals[k]))
		}
		return "{" + strings.Join(parts, ",") + "}"
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, strconv.Quote(k)+":"+show(t[k]))
		}
		return "map{" + strings.Join(parts, ",") + "}"
	case []any:
		parts := make([]string, 0, len(t))
		for _, e := range t {
			parts = append(parts, show(e))
		}
		return "[" + strings.Join(parts, ",") + "]"
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	case string:
		return strconv.Quote(t)
	}
	if jsonic.IsUndefined(v) {
		return "undefined"
	}
	return fmt.Sprintf("%T %#v", v, v)
}

func (o parsed) String() string {
	if o.err != "" {
		return "error " + o.err
	}
	s := "value " + o.value
	if len(s) > 200 {
		s = s[:200] + "..."
	}
	return s
}

func (o parsed) same(p parsed) bool {
	return o == p
}

// sameFromReader parses text whole and from a reader in pieces of each
// size, through ParseReader as through Parse, which apply the requireValue
// guard, and through the instance's own ParseReader as through its Parse,
// and reports where they differ. It returns the number of reader parses
// compared.
func sameFromReader(t *testing.T, j *tabnas.Tabnas, at, text string, sizes []int) int {
	t.Helper()
	whole := parsedOf(Parse(j, text))
	plain := parsedOf(j.Parse(text))
	for _, size := range sizes {
		read := parsedOf(ParseReader(j, &pieces{text: []byte(text), size: size}))
		if !read.same(whole) {
			t.Errorf("%s in pieces of %d:\n  Parse:       %s\n  ParseReader: %s", at, size, whole, read)
		}
		read = parsedOf(j.ParseReader(&pieces{text: []byte(text), size: size}))
		if !read.same(plain) {
			t.Errorf("%s in pieces of %d:\n  j.Parse:       %s\n  j.ParseReader: %s", at, size, plain, read)
		}
	}
	return 2 * len(sizes)
}

// fixtureRows calls each with every row of the shared fixtures: where it
// is, its input and its plugin options.
func fixtureRows(t *testing.T, each func(at, input string, opts map[string]any)) {
	t.Helper()
	dir, err := support.FindSpecDir("")
	if err != nil {
		t.Fatal(err)
	}
	specs, err := support.LoadSpecDir(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(specs) == 0 {
		t.Fatalf("no fixtures in %s", dir)
	}
	for _, spec := range specs {
		for _, row := range spec.Rows {
			opts := map[string]any{}
			if raw := row.Named("opts"); raw != "" {
				if err := json.Unmarshal([]byte(raw), &opts); err != nil {
					t.Fatalf("%s: opts: %v", row.Where(), err)
				}
			}
			each(row.Where(), row.UnescNamed("input"), opts)
		}
	}
}

// TestMakeDeclaresTheWindow: Make declares lex.window; the plugin alone,
// which a host may install beneath matchers of its own, declares nothing.
func TestMakeDeclaresTheWindow(t *testing.T) {
	if !Make().Config().Window {
		t.Error("Make does not declare lex.window")
	}
	if !Make(map[string]any{"hashComment": true}).Config().Window {
		t.Error("Make with options does not declare lex.window")
	}
	j := jsonic.Make()
	if err := j.UseDefaults(Json5, Defaults()); err != nil {
		t.Fatal(err)
	}
	if j.Config().Window {
		t.Error("the Json5 plugin declares lex.window")
	}
}

// TestMakeParsesAsTheComposition: every fixture row parses through Make as
// through jsonic.Make() then j.UseDefaults(Json5, Defaults(), opts), which
// dmog composed, and Make's lexer configuration is that composition's but
// for the window.
func TestMakeParsesAsTheComposition(t *testing.T) {
	n := 0
	fixtureRows(t, func(at, input string, opts map[string]any) {
		j := jsonic.Make()
		if err := j.UseDefaults(Json5, Defaults(), opts); err != nil {
			t.Fatal(err)
		}
		composed := parsedOf(Parse(j, input))
		made := parsedOf(Parse(Make(opts), input))
		if !made.same(composed) {
			t.Errorf("%s:\n  Make:     %s\n  composed: %s", at, made, composed)
		}
		n++
	})
	if n < 220 {
		t.Errorf("only %d rows", n)
	}
	j := jsonic.Make()
	if err := j.UseDefaults(Json5, Defaults()); err != nil {
		t.Fatal(err)
	}
	made, composed := Make().Config(), j.Config()
	for _, c := range []struct {
		name     string
		got, set any
	}{
		{"StringChars", made.StringChars, composed.StringChars},
		{"MultiChars", made.MultiChars, composed.MultiChars},
		{"EscapeMap", made.EscapeMap, composed.EscapeMap},
		{"ValueDef keys", keysOf(made.ValueDef), keysOf(composed.ValueDef)},
	} {
		if !reflect.DeepEqual(c.got, c.set) {
			t.Errorf("Make's %s is %v, the composition's %v", c.name, c.got, c.set)
		}
	}
}

func keysOf(m map[string]any) map[string]bool {
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}

// TestFixturesFromAReader: every fixture row parses the same from a reader
// as from its text, under Make with the row's options.
func TestFixturesFromAReader(t *testing.T) {
	compared := 0
	fixtureRows(t, func(at, input string, opts map[string]any) {
		compared += sameFromReader(t, Make(opts), at, input, []int{1, 3, 64, 4096})
	})
	t.Logf("reader fixtures: %d reader parses (100%%)", compared)
	if compared < 1800 {
		t.Errorf("only %d reader parses", compared)
	}
}

// TestCorpusFromAReader: every document of the vendored json5-tests
// corpus, and every probe derived from it (each prefix of a document, and
// each document with a suffix ES5 refuses), parses the same from a reader
// as from its text.
func TestCorpusFromAReader(t *testing.T) {
	root := filepath.Join("..", "test", "json5-tests")
	raw, err := os.ReadFile(filepath.Join("..", "test", "json5-tests-expected.json"))
	if err != nil {
		t.Fatalf("%s\n%v", suiteMissing, err)
	}
	var manifest suiteManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	j := Make()
	read := func(rel string) string {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	documents, probes := 0, 0
	for rel := range manifest.Cases {
		sameFromReader(t, j, rel, read(rel), []int{1, 3, 64, 4096})
		documents++
	}
	t.Logf("reader corpus: %d documents (33%%)", documents)
	for rel := range manifest.Derived.Truncations {
		runes := []rune(read(rel))
		for n := 1; n < len(runes); n++ {
			sameFromReader(t, j, fmt.Sprintf("%s cut at %d", rel, n), string(runes[:n]), []int{1, 3, 64})
			probes++
		}
	}
	t.Logf("reader corpus: %d truncations (66%%)", probes)
	for rel, suffixes := range manifest.Derived.Trailing {
		text := read(rel)
		for _, suffix := range suffixes {
			sameFromReader(t, j, fmt.Sprintf("%s with %q", rel, suffix), text+suffix, []int{1, 3, 64})
			probes++
		}
	}
	t.Logf("reader corpus: %d documents and %d probes (100%%)", documents, probes)
	if documents != 114 {
		t.Errorf("%d documents, want 114", documents)
	}
	if probes < 5000 {
		t.Errorf("only %d probes", probes)
	}
}

// longDocument is a document of over a megabyte whose tokens of every kind
// this grammar reads are long and short, the long ones longer than the
// window: strings holding a line continuation before and after the
// window's edge, strings without one, keys and values the text check
// judges, numbers, keywords, comments and space. ending closes it.
func longDocument(long int, ending string) string {
	var b strings.Builder
	b.WriteString("// records\n[\n")
	for i := 0; i < 2500; i++ {
		fmt.Fprintf(&b, "  {id: %d, 'name': \"ñ%d\\u00e9\\\n\" /* note %d */, tags: ['a', \"b\\x41\"], n: -1.5e3, h: 0X1F, d: 5.e4, x: -Infinity, y: +NaN, \\u0061b: 1,}, // row %d\n", i, i, i, i)
		if i == 800 || i == 1600 {
			// A continuation past the window's edge, and one before it in a
			// string that ends past the edge.
			fmt.Fprintf(&b, "  '%s\\\r\n%s',\n", strings.Repeat("s", long), strings.Repeat("t", 3))
			fmt.Fprintf(&b, "  \"\\\n%s\\x4F\\uD83D\\\u2028\\uDE00\",\n", strings.Repeat("é", long/2))
			// A string the window's edge cuts, with no continuation.
			fmt.Fprintf(&b, "  \"%s\\\"\",\n", strings.Repeat("q", long))
			// A number the text check reads past the edge, and one the
			// number matcher reads.
			fmt.Fprintf(&b, "  1%s.e3,\n", strings.Repeat("0", long))
			fmt.Fprintf(&b, "  0X%s,\n", strings.Repeat("f", long))
			fmt.Fprintf(&b, "  1%s,\n", strings.Repeat("0", long))
			// A key longer than the window.
			fmt.Fprintf(&b, "  {%s: 1},\n", strings.Repeat("k", long))
			fmt.Fprintf(&b, "  // %s\n", strings.Repeat("c", long))
			fmt.Fprintf(&b, "  /* %s */\n", strings.Repeat("b\n", long/2))
			fmt.Fprintf(&b, "%s\n%s", strings.Repeat(" ", long), strings.Repeat("\n", long))
		}
	}
	return b.String() + ending
}

// TestLongDocumentFromAReader: the long document parses the same from a
// reader as from its text, and so does the same document with an error at
// its end, each kind the checks raise, which a parse from a reader places
// where the whole text does after the window has moved on many times.
func TestLongDocumentFromAReader(t *testing.T) {
	long := readerMargin + 2<<10
	text := longDocument(long, "  0\n]\n")
	if len(text) < 1<<20 {
		t.Fatalf("the document is %d bytes", len(text))
	}
	j := Make()
	if _, err := Parse(j, text); err != nil {
		t.Fatalf("the long document does not parse: %v", err)
	}
	sameFromReader(t, j, "the long document", text, []int{64, 4096, readerMargin + 3})
	t.Logf("reader long document: 1 of 7 (14%%), %d bytes", len(text))
	endings := []struct{ code, ending string }{
		// A continuation string holding a forbidden escape past the edge.
		{"unexpected", "  '\\\n" + strings.Repeat("u", long) + "\\1'\n]\n"},
		// A continuation string the source ends inside.
		{"unterminated_string", "  '\\\n" + strings.Repeat("u", long)},
		// A malformed escape at the end of a continuation string.
		{"invalid_ascii", "  '\\\n" + strings.Repeat("u", long) + "\\x4"},
		{"invalid_unicode", "  '\\\n" + strings.Repeat("u", long) + "\\u12'"},
		// A string without a continuation holding a forbidden escape.
		{"unexpected", "  \"" + strings.Repeat("v", long) + "\\0" + "1\"\n]\n"},
		// Text the text check refuses.
		{"unexpected", "  1" + strings.Repeat("0", long) + ".e\n]\n"},
	}
	for n, e := range endings {
		broken := longDocument(long, e.ending)
		_, err := Parse(j, broken)
		var te *tabnas.TabnasError
		if !errors.As(err, &te) || te.Code != e.code {
			t.Fatalf("ending %d is not %s: %v", n, e.code, err)
		}
		sameFromReader(t, j, fmt.Sprintf("the long document with ending %d", n), broken, []int{4096, readerMargin + 3})
		t.Logf("reader long document: %d of 7 (%d%%)", n+2, (n+2)*100/7)
	}
}

// TestTextCheckFromAReader: the text check reads through the window as far
// as its answer needs. With the number lexer on, the number matcher, which
// runs first, has the engine cut a token again over a wider window when a
// run of a number's characters meets the window's edge, so the text
// check's own reads are what decide only where nothing reads ahead of it:
// here, with the number lexer off, where a value the text check lets
// through is read by the value regexes and keywords alone.
func TestTextCheckFromAReader(t *testing.T) {
	no := false
	j := Make()
	j.SetOptions(tabnas.Options{Number: &tabnas.NumberOptions{Lex: &no}})
	long := readerMargin + 2<<10
	var b strings.Builder
	b.WriteString("[\n")
	for i := 0; i < 3; i++ {
		fmt.Fprintf(&b, "  1%s.e3,\n  -0X%s,\n  -Infinity,\n  +NaN,\n  5.e4,\n", strings.Repeat("0", long), strings.Repeat("A", long))
	}
	text := b.String() + "  0X1\n]\n"
	if _, err := Parse(j, text); err != nil {
		t.Fatalf("the document does not parse: %v", err)
	}
	sameFromReader(t, j, "number-like values with the number lexer off", text, []int{4096, readerMargin + 3})
	broken := b.String() + "  1" + strings.Repeat("0", long) + ".e\n]\n"
	if _, err := Parse(j, broken); err == nil {
		t.Fatal("the broken document parses")
	}
	sameFromReader(t, j, "number-like values with the number lexer off, refused", broken, []int{4096, readerMargin + 3})
}

// TestCheckReader: the requireValue guard reads a reader only as far as
// its leading whitespace and comments run, refuses as Parse refuses, and
// leaves a failing read and bytes that are not UTF-8 to the parse.
func TestCheckReader(t *testing.T) {
	j := Make()
	for _, c := range []struct{ text, code string }{
		{"", "json5_empty"},
		{"   ", "json5_no_value"},
		{"\ufeff", "json5_no_value"},
		{"// only a comment", "json5_no_value"},
		{"/* only */ // comments\n\u2028", "json5_no_value"},
		{"/* x", "unterminated_comment"},
		{"/", "unexpected"},
	} {
		for _, size := range []int{1, 2, 3, 4096} {
			got := parsedOf(ParseReader(j, &pieces{text: []byte(c.text), size: size}))
			want := parsedOf(Parse(j, c.text))
			if !got.same(want) || !strings.HasPrefix(got.err, c.code+" ") {
				t.Errorf("%q in pieces of %d: %s, Parse %s, want %s", c.text, size, got, want, c.code)
			}
		}
	}

	// Only the leading trivia and the character after it are read.
	body := "[" + strings.Repeat("1,", 1<<16) + "1]"
	lead := "  // a comment\n /* and another */ "
	src := &pieces{text: []byte(lead + body), size: 1}
	rest, err := CheckReader(j, src)
	if err != nil {
		t.Fatal(err)
	}
	if src.at != len(lead)+1 {
		t.Errorf("CheckReader read %d bytes, want %d", src.at, len(lead)+1)
	}
	all, err := io.ReadAll(rest)
	if err != nil || string(all) != lead+body {
		t.Errorf("CheckReader's reader gives %d bytes (%v), want the %d of the source", len(all), err, len(lead+body))
	}

	// A read that fails inside the leading comments, and bytes that are not
	// UTF-8 there, are the parse's to report.
	got := parsedOf(ParseReader(j, &failing{text: []byte("// a comment")}))
	want := parsedOf(j.ParseReader(&failing{text: []byte("// a comment")}))
	if !got.same(want) || !strings.HasPrefix(got.err, "unreadable ") {
		t.Errorf("a failing read: %s, want %s", got, want)
	}
	got = parsedOf(ParseReader(j, &pieces{text: []byte("// \xff\n"), size: 1}))
	if !strings.HasPrefix(got.err, "unreadable ") {
		t.Errorf("bytes that are not UTF-8: %s, want unreadable", got)
	}

	// Without the guard the reader is the parse's alone.
	off := Make(map[string]any{"requireValue": false})
	for _, text := range []string{"", "  ", "// c", "[1]"} {
		got := parsedOf(ParseReader(off, &pieces{text: []byte(text), size: 1}))
		want := parsedOf(Parse(off, text))
		if !got.same(want) {
			t.Errorf("requireValue off, %q: %s, Parse %s", text, got, want)
		}
	}
}

// TestValueDefinitionsReadNumberCharacters: the text check reads a keyword
// or a value regex's match as a run of a number's characters
// (isNumberChar), so that it reads through the window only as far as the
// run. That holds of the keywords it can meet, those that do not begin an
// identifier, and of the two regexes the grammar declares, which this pins:
// a definition that could match another character must widen isNumberChar
// first.
func TestValueDefinitionsReadNumberCharacters(t *testing.T) {
	for name := range Make().Config().ValueDef {
		identifier := name != "" && (('a' <= name[0] && name[0] <= 'z') || ('A' <= name[0] && name[0] <= 'Z'))
		for i := 0; !identifier && i < len(name); i++ {
			if !isNumberChar(name[i]) {
				t.Errorf("the keyword %q holds a character a number is not written in", name)
				break
			}
		}
	}
	want := map[string]bool{
		`^[+-]?(?:0|[1-9][0-9]*)\.[eE][+-]?[0-9]+`: true,
		`^[+-]?0X[0-9a-fA-F]+`:                     true,
	}
	got := map[string]bool{}
	for _, entry := range Make().Config().ValueDefRe {
		if entry.Def != nil && entry.Def.Match != nil {
			got[entry.Def.Match.String()] = true
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("the value regexes are %v, want %v", got, want)
	}
}
