// Copyright (c) 2026 Richard Rodger and other contributors, MIT License

package tabnasjson5

// text_ender_test.go — audit P1/P2, pinned at the code the shared fixture
// cannot pin.
//
// A quote used to end a Go text run and did not end a TypeScript one, so
// `{a:b"c}` was unterminated_string here and unexpected there. tabnas
// parser#128 moved Go. test/divergent.tsv carried the disagreement until
// the repair landed and the rows went red; the inputs now live in
// test/spec/strings.tsv so both suites keep executing them.
//
// They are there as a bare ERROR, because that fixture is shared and must
// hold against the engine this module DECLARES as well as the sibling
// checkouts CI links — and parser#128 is not yet in a parser release. This
// file is where the code itself is pinned. It reads the linked engine and
// says which one it saw, rather than asserting a repair the pinned release
// does not have.
//
// ts/test/text-ender.test.ts is the twin. It asserts `unexpected`
// unconditionally, and can: the TypeScript port never had this defect.

import (
	"strings"
	"testing"
)

// textEnderInputs are the three P1/P2 rows: a quote inside a text run, a
// quote after a value, and a quote inside a bare top-level text run.
var textEnderInputs = []string{`{a:b"c}`, `{a:1"}`, `a"b`}

// TestQuoteDoesNotEndATextRun pins the code all three inputs produce.
//
// Both possible answers are named. `unexpected` is the repair: the quote is
// an ordinary character in a text run, the run is not a string, and the
// parse fails on the token it really is. `unterminated_string` is the
// pre-repair engine treating the quote as an ender and then looking for a
// closing quote that is not there. Anything else, or the three inputs
// disagreeing with each other, is a regression this pin exists to catch.
func TestQuoteDoesNotEndATextRun(t *testing.T) {
	const (
		repaired = "unexpected"
		before   = "unterminated_string"
	)

	codes := map[string][]string{}
	for _, src := range textEnderInputs {
		code := errorCode(t, src)
		codes[code] = append(codes[code], src)
	}

	if 1 != len(codes) {
		t.Fatalf("the three P1/P2 inputs no longer agree with each other: %v", codes)
	}

	var code string
	for c := range codes {
		code = c
	}

	switch code {
	case repaired:
		t.Logf("linked engine has parser#128: a quote does not end a text run")
	case before:
		t.Logf("linked engine predates parser#128: a quote still ends a text "+
			"run, so this port reports %s where TypeScript reports %s. CI links "+
			"the sibling checkouts and sees the repair; this is what go.mod's "+
			"parser release still does.", before, repaired)
	default:
		t.Errorf("the three P1/P2 inputs all report %q, which is neither the "+
			"repaired %q nor the pre-repair %q", code, repaired, before)
	}
}

// errorCode parses src and returns the error's code. A parse that SUCCEEDS
// is a failure whichever engine is linked: every one of these inputs is
// invalid JSON5 under both readings of the quote.
func errorCode(t *testing.T, src string) string {
	t.Helper()

	got := outcome(src)
	if !strings.HasPrefix(got, "ERROR:") {
		t.Fatalf("%q was accepted, producing %s; it is invalid JSON5 whether "+
			"or not a quote ends a text run", src, got)
	}

	code := strings.TrimPrefix(got, "ERROR:")
	if at := strings.LastIndex(code, "@"); 0 <= at {
		code = code[:at]
	}
	return code
}
