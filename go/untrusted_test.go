// Copyright (c) 2025 Richard Rodger and other contributors, MIT License

package tabnasjson5

// untrusted_test.go — what a parser reached from the outside must do
// with input nobody designed for it.
//
// The counterpart of rs/tests/untrusted_test.rs and
// ../ts/test/untrusted.test.ts. The three files hold the SAME cases,
// because the behaviour is ordinary JSON5 behaviour that every runtime
// owes: deep nesting, very long input, unterminated constructs, empty
// input, control characters and odd Unicode must not hang, overflow or
// take super-linear time. A case that lived in one suite alone would let
// the other two regress while that suite stayed green, which is the
// whole of what the parity contract forbids.
//
// The one case that is NOT here is the Rust port's depth cap. That bound
// is tabnas_jsonic's, it exists because a Rust Value walks its own
// nesting when it is converted and again when it is dropped, and it is a
// recorded divergence: nesting is unbounded in this runtime, which
// TestNestingIsUnbounded pins.
//
// Sizes match the Rust file exactly, so the three suites measure the
// same thing. Every case asserts an OUTCOME, not merely that the call
// returned.

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"testing"

	jsonic "github.com/tabnas/jsonic/go"
)

// untrustedCode returns the error code, or "OK" when the parse succeeds.
func untrustedCode(t *testing.T, j *jsonic.Jsonic, src string) string {
	t.Helper()
	if _, err := Parse(j, src); err != nil {
		var je *jsonic.JsonicError
		if errors.As(err, &je) {
			return je.Code
		}
		return err.Error()
	}
	return "OK"
}

// Empty, blank, byte-order-mark-only and comments-only sources are the
// ways to send nothing, and each has its code. The short forms are
// shared fixture rows in ../test/spec/options.tsv; the long ones are
// here because a megabyte does not fit a fixture cell.
func TestASourceWithNoValueInItIsRefusedWithACode(t *testing.T) {
	j := parser(t)
	for _, c := range []struct{ src, code string }{
		{"", "json5_empty"},
		{strings.Repeat(" ", 100000), "json5_no_value"},
		{"\uFEFF", "json5_no_value"},
		{strings.Repeat("/*a*/", 200000), "json5_no_value"},
	} {
		if got := untrustedCode(t, j, c.src); got != c.code {
			t.Errorf("a %d-character no-value source = %s, want %s",
				len(c.src), got, c.code)
		}
	}
}

// A control character is not a value, and a very long run of them is not
// a long parse: the first one is refused where it stands.
func TestControlCharactersAreRefusedWhereTheyStand(t *testing.T) {
	j := parser(t)
	for _, src := range []string{"\x00", "\x01\x02\x03", "\x7F"} {
		if got := untrustedCode(t, j, src); got != "unexpected" {
			t.Errorf("Parse(%q) = %s, want unexpected", src, got)
		}
	}
	_, err := Parse(j, strings.Repeat("\x01", 100000))
	var je *jsonic.JsonicError
	if !errors.As(err, &je) || je.Code != "unexpected" || je.Row != 1 || je.Col != 1 {
		t.Errorf("100,000 control characters = %v, want unexpected at 1:1", err)
	}
}

// An unterminated construct ends the parse with its own code, however
// much of it there is. The long forms are the interesting ones: the
// scanner runs to the end of the source before it can know, so this is
// where an unbounded read or a quadratic rescan would show.
func TestUnterminatedConstructsAreRefusedAtAnyLength(t *testing.T) {
	j := parser(t)
	long := strings.Repeat("a", 2000000)
	for _, c := range []struct{ src, code string }{
		{`"` + long, "unterminated_string"},
		{"'" + long, "unterminated_string"},
		{"/*" + long, "unterminated_comment"},
		// A trailing backslash run is an unterminated string too: the
		// last backslash escapes the closing quote that never arrives.
		{`"` + strings.Repeat(`\`, 500000), "unterminated_string"},
	} {
		if got := untrustedCode(t, j, c.src); got != c.code {
			t.Errorf("a %d-character unterminated construct = %s, want %s",
				len(c.src), got, c.code)
		}
	}

	// Unterminated INSIDE a structure still reports the string, at the
	// position the string opened.
	_, err := Parse(j, strings.Repeat("[", 50)+`"abc`)
	var je *jsonic.JsonicError
	if !errors.As(err, &je) || je.Code != "unterminated_string" || je.Row != 1 || je.Col != 51 {
		t.Errorf("nested unterminated string = %v, want unterminated_string at 1:51", err)
	}
}

// Very long WELL-FORMED input parses, and parses to the right thing. The
// size is the point: a bound that refused these would be a bound on
// legitimate documents, and a scanner that mangled them would be worse
// than one that refused them.
func TestVeryLongWellFormedInputParsesToTheRightValue(t *testing.T) {
	j := parser(t)

	body := strings.Repeat("a", 2000000)
	v, err := Parse(j, `"`+body+`"`)
	if err != nil {
		t.Fatalf("long string: %v", err)
	}
	if got, ok := v.(string); !ok || len(got) != 2000000 {
		t.Errorf("long string = %T of length %d, want a 2,000,000-character string", v, len(body))
	}

	// A 500,000-digit integer is finite input and an infinite double.
	v, err = Parse(j, strings.Repeat("9", 500000))
	if err != nil {
		t.Fatalf("long number: %v", err)
	}
	if got, ok := v.(float64); !ok || !math.IsInf(got, 1) {
		t.Errorf("long number = %#v, want +Inf", v)
	}

	// A 500,000-character unquoted key is an IdentifierName, and the
	// whole of it is the key.
	key := strings.Repeat("a", 500000)
	v, err = Parse(j, "{"+key+":1}")
	if err != nil {
		t.Fatalf("long key: %v", err)
	}
	keyed, ok := deorder(v).(map[string]any)
	if !ok || len(keyed) != 1 {
		t.Fatalf("long key = %#v, want one entry", v)
	}
	for name := range keyed {
		if len(name) != 500000 {
			t.Errorf("long key has length %d, want 500,000", len(name))
		}
	}

	// 200,000 line continuations collapse to the empty string, and the
	// rewrite that strips them does not go quadratic doing it.
	v, err = Parse(j, `"`+strings.Repeat("\\\n", 200000)+`"`)
	if err != nil {
		t.Fatalf("continuations: %v", err)
	}
	if got, ok := v.(string); !ok || got != "" {
		t.Errorf("continuations = %#v, want the empty string", v)
	}

	// 200,000 unicode escapes decode one for one.
	v, err = Parse(j, `"`+strings.Repeat(`A`, 200000)+`"`)
	if err != nil {
		t.Fatalf("escapes: %v", err)
	}
	if got, ok := v.(string); !ok || got != strings.Repeat("A", 200000) {
		t.Errorf("escapes = %T of length %d, want 200,000 A characters", v, len(body))
	}
}

// A wide container is the other direction from a deep one: what bounds
// exist bound DEPTH, and breadth is unbounded on purpose, so a document
// with many siblings must arrive whole rather than truncated at a cap.
func TestAWideContainerArrivesWhole(t *testing.T) {
	j := parser(t)
	const width = 5000

	v, err := Parse(j, "["+strings.Repeat("1,", width)+"]")
	if err != nil {
		t.Fatalf("wide array: %v", err)
	}
	if items, ok := v.([]any); !ok || len(items) != width {
		t.Errorf("wide array = %T of length %d, want %d items", v, len(v.([]any)), width)
	}

	var object strings.Builder
	object.WriteString("{")
	for index := 0; index < width; index++ {
		object.WriteString("k")
		object.WriteString(strconv.Itoa(index))
		object.WriteString(":1,")
	}
	object.WriteString("}")
	v, err = Parse(j, object.String())
	if err != nil {
		t.Fatalf("wide object: %v", err)
	}
	if m, ok := deorder(v).(map[string]any); !ok || len(m) != width {
		t.Errorf("wide object = %T with %d entries, want %d", v, len(m), width)
	}
}
