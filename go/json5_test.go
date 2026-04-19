package json5

import (
	"math"
	"reflect"
	"testing"
)

func TestPrimitives(t *testing.T) {
	cases := []struct {
		src  string
		want any
	}{
		{"true", true},
		{"false", false},
		{"null", nil},
		{`"hello"`, "hello"},
		{`'hello'`, "hello"},
		{"42", int64(42)},
		{"-7", int64(-7)},
		{"+5", int64(5)},
		{"3.14", 3.14},
		{".5", 0.5},
		{"5.", float64(5)},
		{"1e10", 1e10},
		{"1.5e-2", 0.015},
		{"0x1F", int64(31)},
		{"0xDEADBEEF", int64(0xDEADBEEF)},
		{"-0x10", int64(-16)},
	}
	for _, c := range cases {
		got, err := Parse(c.src)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", c.src, err)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("Parse(%q) = %#v, want %#v", c.src, got, c.want)
		}
	}
}

func TestInfinityNaN(t *testing.T) {
	for _, src := range []string{"Infinity", "+Infinity"} {
		v, err := Parse(src)
		if err != nil || v != math.Inf(1) {
			t.Errorf("Parse(%q) = %v, %v", src, v, err)
		}
	}
	v, err := Parse("-Infinity")
	if err != nil || v != math.Inf(-1) {
		t.Errorf("Parse(-Infinity) = %v, %v", v, err)
	}
	for _, src := range []string{"NaN", "+NaN", "-NaN"} {
		v, err := Parse(src)
		f, ok := v.(float64)
		if err != nil || !ok || !math.IsNaN(f) {
			t.Errorf("Parse(%q) = %v, %v", src, v, err)
		}
	}
}

func TestObjects(t *testing.T) {
	cases := []struct {
		src  string
		want any
	}{
		{`{}`, map[string]any{}},
		{`{"a":1}`, map[string]any{"a": int64(1)}},
		{`{a:1}`, map[string]any{"a": int64(1)}},
		{`{a:1,b:2}`, map[string]any{"a": int64(1), "b": int64(2)}},
		{`{a:1, 'b':2}`, map[string]any{"a": int64(1), "b": int64(2)}},
		{`{ nested: { x: 1 } }`, map[string]any{"nested": map[string]any{"x": int64(1)}}},
		{`{$id:1, _n:2, a1:3}`, map[string]any{"$id": int64(1), "_n": int64(2), "a1": int64(3)}},
	}
	for _, c := range cases {
		got, err := Parse(c.src)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", c.src, err)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("Parse(%q) = %#v, want %#v", c.src, got, c.want)
		}
	}
}

func TestArrays(t *testing.T) {
	cases := []struct {
		src  string
		want any
	}{
		{`[]`, []any{}},
		{`[1]`, []any{int64(1)}},
		{`[1,2,3]`, []any{int64(1), int64(2), int64(3)}},
		{`["a","b"]`, []any{"a", "b"}},
		{`[[1,2],[3,4]]`, []any{[]any{int64(1), int64(2)}, []any{int64(3), int64(4)}}},
	}
	for _, c := range cases {
		got, err := Parse(c.src)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", c.src, err)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("Parse(%q) = %#v, want %#v", c.src, got, c.want)
		}
	}
}

func TestTrailingCommas(t *testing.T) {
	cases := []string{`[1,2,3,]`, `{a:1,b:2,}`, `[1,]`, `{a:1,}`, `[ 1 , 2 , ]`}
	for _, src := range cases {
		if _, err := Parse(src); err != nil {
			t.Errorf("Parse(%q) error: %v", src, err)
		}
	}
}

func TestComments(t *testing.T) {
	cases := []string{
		"// hello\n42",
		"/* block */ 42",
		"{ a: 1, /* mid */ b: 2 }",
		"[/* a */ 1, /* b */ 2]",
		"/* multi\nline\ncomment */ [1,2]",
	}
	for _, src := range cases {
		if _, err := Parse(src); err != nil {
			t.Errorf("Parse(%q) error: %v", src, err)
		}
	}

	// Hash comments are not JSON5.
	if _, err := Parse("# nope\n42"); err == nil {
		t.Error("expected error for hash comment")
	}
}

func TestStrings(t *testing.T) {
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
		{"\"line1\\\r\nline2\"", "line1line2"},
	}
	for _, c := range cases {
		got, err := Parse(c.src)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", c.src, err)
			continue
		}
		if got != c.want {
			t.Errorf("Parse(%q) = %q, want %q", c.src, got, c.want)
		}
	}
}

func TestRejects(t *testing.T) {
	cases := []string{
		"",
		"foo",
		"0o17",
		"0b101",
		"1_000",
		"1,2,3",
		"a:1",
		"{a:1",
		"[1,2",
		`"unterminated`,
		"{a}",
		"`backtick`",
		"42 junk",
	}
	for _, src := range cases {
		v, err := Parse(src)
		if err == nil {
			t.Errorf("Parse(%q) expected error, got %#v", src, v)
		}
	}
}

func TestJSON5SpecExample(t *testing.T) {
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
	got, err := Parse(src)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	want := map[string]any{
		"unquoted":             "and you can quote me on that",
		"singleQuotes":         `I can use "double quotes" here`,
		"lineBreaks":           "Look, Mom! No \\n's!",
		"hexadecimal":          int64(0xdecaf),
		"leadingDecimalPoint":  0.8675309,
		"andTrailing":          float64(8675309),
		"positiveSign":         int64(1),
		"trailingComma":        "in objects",
		"andIn":                []any{"arrays"},
		"backwardsCompatible":  "with JSON",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("spec example mismatch:\n got: %#v\nwant: %#v", got, want)
	}
}

func TestJSONIsJSON5(t *testing.T) {
	cases := []string{
		`{}`,
		`[]`,
		`{"a":1,"b":"two","c":null,"d":true,"e":false}`,
		`[1,2.5,-3,1e10,"s",null,true,false]`,
		`{"nested":{"list":[1,{"x":null}]}}`,
	}
	for _, src := range cases {
		if _, err := Parse(src); err != nil {
			t.Errorf("Parse(%q) error: %v", src, err)
		}
	}
}
