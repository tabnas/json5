package json5

import (
	"math"
	"reflect"
	"testing"

	jsonic "github.com/jsonicjs/jsonic/go"
)

// parser returns a fresh Jsonic instance with the Json5 plugin installed
// with the given option overrides.
func parser(t *testing.T, overrides ...map[string]any) *jsonic.Jsonic {
	t.Helper()
	j := jsonic.Make()
	if err := j.UseDefaults(Json5, Defaults(), overrides...); err != nil {
		t.Fatalf("UseDefaults: %v", err)
	}
	return j
}

func parse(t *testing.T, j *jsonic.Jsonic, src string) any {
	t.Helper()
	v, err := j.Parse(src)
	if err != nil {
		t.Fatalf("Parse(%q) error: %v", src, err)
	}
	return v
}

func eq(t *testing.T, got, want any, src string) {
	t.Helper()
	if fg, ok := got.(float64); ok {
		if fw, ok := want.(float64); ok && math.IsNaN(fg) && math.IsNaN(fw) {
			return
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Parse(%q) = %#v, want %#v", src, got, want)
	}
}

func TestPrimitives(t *testing.T) {
	j := parser(t)
	cases := []struct {
		src  string
		want any
	}{
		{"true", true},
		{"false", false},
		{"null", nil},
		{`"hello"`, "hello"},
		{`'hello'`, "hello"},
		{"42", float64(42)},
		{"3.14", 3.14},
		{"-7", float64(-7)},
		{"+5", float64(5)},
		{".5", 0.5},
		{"5.", float64(5)},
		{"1e10", 1e10},
		{"1.5e-2", 0.015},
		{"0x1F", float64(31)},
		{"0xDEADBEEF", float64(0xDEADBEEF)},
		{"-0x10", float64(-16)},
	}
	for _, c := range cases {
		eq(t, parse(t, j, c.src), c.want, c.src)
	}
}

func TestInfinityNaN(t *testing.T) {
	j := parser(t)
	for _, src := range []string{"Infinity", "+Infinity"} {
		eq(t, parse(t, j, src), math.Inf(1), src)
	}
	eq(t, parse(t, j, "-Infinity"), math.Inf(-1), "-Infinity")
	for _, src := range []string{"NaN", "+NaN", "-NaN"} {
		eq(t, parse(t, j, src), math.NaN(), src)
	}

	// Can be disabled.
	jn := parser(t, map[string]any{"infinity": false})
	if _, err := jn.Parse("Infinity"); err == nil {
		t.Error("expected error for Infinity when infinity=false")
	}
}

func TestObjects(t *testing.T) {
	j := parser(t)
	cases := []struct {
		src  string
		want any
	}{
		{`{}`, map[string]any{}},
		{`{"a":1}`, map[string]any{"a": float64(1)}},
		{`{a:1}`, map[string]any{"a": float64(1)}},
		{`{a:1,b:2}`, map[string]any{"a": float64(1), "b": float64(2)}},
		{`{a:1, 'b':2}`, map[string]any{"a": float64(1), "b": float64(2)}},
		{`{ nested: { x: 1 } }`, map[string]any{"nested": map[string]any{"x": float64(1)}}},
		{`{$id:1, _n:2, a1:3}`, map[string]any{"$id": float64(1), "_n": float64(2), "a1": float64(3)}},
	}
	for _, c := range cases {
		eq(t, parse(t, j, c.src), c.want, c.src)
	}
}

func TestArrays(t *testing.T) {
	j := parser(t)
	cases := []struct {
		src  string
		want any
	}{
		{`[]`, []any{}},
		{`[1]`, []any{float64(1)}},
		{`[1,2,3]`, []any{float64(1), float64(2), float64(3)}},
		{`["a","b"]`, []any{"a", "b"}},
		{`[[1,2],[3,4]]`, []any{[]any{float64(1), float64(2)}, []any{float64(3), float64(4)}}},
	}
	for _, c := range cases {
		eq(t, parse(t, j, c.src), c.want, c.src)
	}
}

func TestTrailingCommas(t *testing.T) {
	j := parser(t)
	cases := []string{`[1,2,3,]`, `{a:1,b:2,}`, `[1,]`, `{a:1,}`, `[ 1 , 2 , ]`}
	for _, src := range cases {
		if _, err := j.Parse(src); err != nil {
			t.Errorf("Parse(%q) error: %v", src, err)
		}
	}
}

func TestComments(t *testing.T) {
	j := parser(t)
	cases := []string{
		"// hello\n42",
		"/* block */ 42",
		"{ a: 1, /* mid */ b: 2 }",
		"[/* a */ 1, /* b */ 2]",
		"/* multi\nline\ncomment */ [1,2]",
	}
	for _, src := range cases {
		if _, err := j.Parse(src); err != nil {
			t.Errorf("Parse(%q) error: %v", src, err)
		}
	}

	// Hash comments are not JSON5 by default.
	if _, err := j.Parse("# nope\n42"); err == nil {
		t.Error("expected error for hash comment")
	}

	// Can be enabled.
	jh := parser(t, map[string]any{"hashComment": true})
	eq(t, parse(t, jh, "# hello\n42"), float64(42), "# hello\\n42")
}

func TestStrings(t *testing.T) {
	j := parser(t)
	cases := []struct {
		src  string
		want string
	}{
		{`"hello"`, "hello"},
		{`'hello'`, "hello"},
		{`"he said \"hi\""`, `he said "hi"`},
		{`'he said \'hi\''`, `he said 'hi'`},
		{`"a\tb"`, "a\tb"},
		{`"a\nb"`, "a\nb"},
		{`"a\u0041b"`, "aAb"},
		{`"a\x41b"`, "aAb"},
		{`"\0"`, "\x00"},
		{"\"line1\\\nline2\"", "line1line2"},
	}
	for _, c := range cases {
		got := parse(t, j, c.src)
		if got != c.want {
			t.Errorf("Parse(%q) = %q, want %q", c.src, got, c.want)
		}
	}

	// Backticks not JSON5 by default.
	if _, err := j.Parse("`backtick`"); err == nil {
		t.Error("expected error for backtick string")
	}

	// Can be enabled.
	jb := parser(t, map[string]any{"backtickString": true})
	eq(t, parse(t, jb, "`backtick`"), "backtick", "`backtick`")
}

func TestRejectsNonJSON5(t *testing.T) {
	j := parser(t)
	cases := []string{
		"",
		"foo",
		"0o17",
		"0b101",
		"1_000",
		"1,2,3",
		"a:1",
	}
	for _, src := range cases {
		if v, err := j.Parse(src); err == nil {
			t.Errorf("Parse(%q) expected error, got %#v", src, v)
		}
	}
}

func TestNonStrictOptions(t *testing.T) {
	js := parser(t, map[string]any{
		"octal":           true,
		"binary":          true,
		"numberSeparator": true,
	})
	eq(t, parse(t, js, "0o17"), float64(15), "0o17")
	eq(t, parse(t, js, "0b101"), float64(5), "0b101")
	eq(t, parse(t, js, "1_000"), float64(1000), "1_000")

	jnh := parser(t, map[string]any{"hex": false})
	if _, err := jnh.Parse("0x1F"); err == nil {
		t.Error("expected error when hex=false")
	}
}

func TestStrictValueToggle(t *testing.T) {
	// With strictValue disabled, bare words parse as text strings
	// (Jsonic's default text fallback).
	j := parser(t, map[string]any{"strictValue": false})
	eq(t, parse(t, j, "foo"), "foo", "foo")
}

func TestJSON5SpecExample(t *testing.T) {
	j := parser(t)
	src := `{
      // comments
      unquoted: 'and you can quote me on that',
      singleQuotes: 'I can use "double quotes" here',
      lineBreaks: "Look, Mom! \
No \\n's!",
      hexadecimal: 0xdecaf,
      leadingDecimalPoint: .8675309, andTrailing: 8675309.,
      positiveSign: +1,
      trailingComma: 'in objects', andIn: ['arrays',],
      "backwardsCompatible": "with JSON",
    }`
	got := parse(t, j, src)
	want := map[string]any{
		"unquoted":            "and you can quote me on that",
		"singleQuotes":        `I can use "double quotes" here`,
		"lineBreaks":          "Look, Mom! No \\n's!",
		"hexadecimal":         float64(0xdecaf),
		"leadingDecimalPoint": 0.8675309,
		"andTrailing":         float64(8675309),
		"positiveSign":        float64(1),
		"trailingComma":       "in objects",
		"andIn":               []any{"arrays"},
		"backwardsCompatible": "with JSON",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("spec example mismatch:\n got: %#v\nwant: %#v", got, want)
	}
}

func TestJSONIsJSON5(t *testing.T) {
	j := parser(t)
	cases := []string{
		`{}`,
		`[]`,
		`{"a":1,"b":"two","c":null,"d":true,"e":false}`,
		`[1,2.5,-3,1e10,"s",null,true,false]`,
		`{"nested":{"list":[1,{"x":null}]}}`,
	}
	for _, src := range cases {
		if _, err := j.Parse(src); err != nil {
			t.Errorf("Parse(%q) error: %v", src, err)
		}
	}
}
