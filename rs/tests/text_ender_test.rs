// Audit P1/P2, pinned at the code the shared fixture cannot pin.
//
// A quote used to end a Go text run and did not end a TypeScript one, so
// `{a:b"c}` was `unterminated_string` there and `unexpected` here. tabnas
// parser#128 moved Go. `test/divergent.tsv` carried the disagreement
// until the repair landed and the rows went red; the inputs now live in
// `test/spec/strings.tsv` so every suite keeps executing them.
//
// They are there as a bare `ERROR`, because that fixture is shared and
// must hold against the engine the Go module DECLARES as well as the
// sibling checkouts CI links. `go/text_ender_test.go` reads the linked
// engine and reports which behaviour it saw. This half does what
// `ts/test/text-ender.test.ts` does: the Rust engine's text matcher
// never had the defect, so `unexpected` is asserted outright.

use tabnas_json5::{make, parse_with};

/// The three P1/P2 rows: a quote inside a text run, a quote after a
/// value, and a quote inside a bare top-level text run.
const INPUTS: [&str; 3] = [r#"{a:b"c}"#, r#"{a:1"}"#, r#"a"b"#];

/// The error code one input produces. A parse that SUCCEEDS is a
/// failure: every one of these is invalid JSON5 under either reading of
/// the quote.
fn error_code(src: &str) -> String {
    let parser = make();
    match parse_with(&parser, src) {
        Ok(value) => panic!(
            "{src:?} was accepted, producing {value}; it is invalid JSON5 whether or not a \
             quote ends a text run"
        ),
        Err(error) => error.code,
    }
}

/// `unexpected` is the repaired reading: the quote is an ordinary
/// character in a text run, the run is not a string, and the parse fails
/// on the token it really is. `unterminated_string` would mean the quote
/// had started a string, the defect parser#128 removed from Go, and one
/// this port must never acquire.
#[test]
fn a_quote_does_not_end_a_text_run() {
    for src in INPUTS {
        assert_eq!(error_code(src), "unexpected", "{src:?}");
    }
}
