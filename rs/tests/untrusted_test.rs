// Untrusted input: what a parser reached from the outside must do with
// input nobody designed for it.
//
// The rule (porting playbook section 7) is that deep nesting, very long
// input, unterminated constructs, empty input, control characters and
// odd Unicode must not panic, hang, overflow the stack or take
// super-linear time. Growth with size is guarded separately, in
// `perf_test.rs`; what is here is the shapes.
//
// Every case below asserts an OUTCOME, not merely that the call
// returned. A test that only proves "no panic" passes just as well when
// the parser has started answering nonsense, and the cheapest way to
// stop overflowing a stack is to stop parsing correctly. Each figure was
// measured before it was written down.
//
// WHAT IS RUST-SPECIFIC AND WHAT IS NOT. Only the depth cap is this
// port's own: `nesting_far_past_the_budget_is_refused_rather_than_run`
// exists because a `Value` walks its own nesting in `to_json()` and
// again in its derived drop, one caller frame per level, so the bound
// `tabnas_jsonic` installs is what keeps an untrusted source away from
// that walk. It is a recorded divergence, and the TypeScript and Go
// columns of its table are pinned in their own suites.
//
// Everything else here is ordinary JSON5 behaviour that all three
// runtimes owe, so all three execute it: the short forms are shared
// fixture rows in `../../test/spec/options.tsv` (the empty, blank,
// byte-order-mark-only and comments-only sources), and the long forms,
// which no fixture cell can hold, are mirrored case for case and size
// for size in `ts/test/untrusted.test.ts` and `go/untrusted_test.go`. A
// case that lived here alone would let the canonical and the Go port
// regress while this file stayed green, which is what the parity
// contract forbids.

use tabnas::Tabnas;
use tabnas_json5::{make, parse_with};

/// The error code, or `OK` with the parse succeeding.
fn code(parser: &Tabnas, src: &str) -> String {
    match parse_with(parser, src) {
        Ok(_) => "OK".to_string(),
        Err(error) => error.code,
    }
}

/// Nesting deeper than the budget is REFUSED, at every depth past it,
/// and refused without building the value.
///
/// This is the shape that ends a process rather than a parse: the engine
/// parses iteratively, but the `Value` it returns walks its own nesting
/// in `to_json()` and again in its drop, one frame per level and both
/// outside this crate. The budget is what keeps a caller from being
/// handed a tree too deep to convert or to free. The boundary itself is
/// pinned in `json5_test.rs`; these are the sizes an attacker would
/// actually send.
#[test]
fn nesting_far_past_the_budget_is_refused_rather_than_run() {
    let j = make();
    for depth in [200usize, 1_000, 10_000, 100_000] {
        for (open, close, mid) in [("[", "]", ""), ("{a:", "}", "1")] {
            let balanced = format!("{}{mid}{}", open.repeat(depth), close.repeat(depth));
            assert_eq!(code(&j, &balanced), "cancel", "{depth} levels of {open}");
            // Unclosed is the cheaper attack: no closing half to send.
            let unclosed = open.repeat(depth);
            assert_eq!(code(&j, &unclosed), "cancel", "{depth} unclosed {open}");
        }
    }
}

/// Empty, blank, byte-order-mark-only and comments-only sources are the
/// ways to send nothing, and each has its own code. The short forms are
/// shared fixture rows; the long ones are here, and in the TypeScript
/// and Go suites, because a megabyte does not fit a fixture cell.
#[test]
fn a_source_with_no_value_in_it_is_refused_with_a_code() {
    let j = make();
    assert_eq!(code(&j, ""), "json5_empty");
    assert_eq!(code(&j, " ".repeat(100_000).as_str()), "json5_no_value");
    assert_eq!(code(&j, "\u{FEFF}"), "json5_no_value");
    assert_eq!(code(&j, "/*a*/".repeat(200_000).as_str()), "json5_no_value");
}

/// A control character is not a value, and a very long run of them is
/// not a long parse: the first one is refused where it stands.
#[test]
fn control_characters_are_refused_where_they_stand() {
    let j = make();
    for src in ["\u{0}", "\u{1}\u{2}\u{3}", "\u{7F}"] {
        assert_eq!(code(&j, src), "unexpected", "{src:?}");
    }
    let error = parse_with(&j, "\u{1}".repeat(100_000).as_str()).expect_err("refused");
    assert_eq!(
        (error.code.as_str(), error.row, error.col),
        ("unexpected", 1, 1)
    );
}

/// An unterminated construct ends the parse with its own code, however
/// much of it there is. The long forms are the interesting ones: the
/// scanner runs to the end of the source before it can know, so this is
/// where an unbounded read or a quadratic rescan would show.
#[test]
fn unterminated_constructs_are_refused_at_any_length() {
    let j = make();
    let long = "a".repeat(2_000_000);
    assert_eq!(code(&j, &format!("\"{long}")), "unterminated_string");
    assert_eq!(code(&j, &format!("'{long}")), "unterminated_string");
    assert_eq!(code(&j, &format!("/*{long}")), "unterminated_comment");
    // A trailing backslash run is an unterminated string too: the last
    // backslash escapes the closing quote that never arrives.
    assert_eq!(
        code(&j, &format!("\"{}", "\\".repeat(500_000))),
        "unterminated_string"
    );
    // Unterminated INSIDE a structure still reports the string, at the
    // position the string opened.
    let nested = format!("{}\"abc", "[".repeat(50));
    let error = parse_with(&j, &nested).expect_err("refused");
    assert_eq!(
        (error.code.as_str(), error.row, error.col),
        ("unterminated_string", 1, 51)
    );
}

/// Very long WELL-FORMED input parses, and parses to the right thing.
/// The size is the point: a bound that refused these would be a bound on
/// legitimate documents, and a scanner that mangled them would be worse
/// than one that refused them.
#[test]
fn very_long_well_formed_input_parses_to_the_right_value() {
    let j = make();

    let body = "a".repeat(2_000_000);
    match parse_with(&j, &format!("\"{body}\"")) {
        Ok(tabnas::Value::String(got)) => assert_eq!(got.len(), 2_000_000),
        other => panic!("long string: {other:?}"),
    }

    // A 500,000-digit integer is finite input and an infinite double,
    // which is what the canonical runtime answers too.
    match parse_with(&j, &"9".repeat(500_000)) {
        Ok(tabnas::Value::Number(got)) => assert!(got.is_infinite() && got > 0.0),
        other => panic!("long number: {other:?}"),
    }

    // A 500,000-character unquoted key is an IdentifierName, and the
    // whole of it is the key.
    let key = "a".repeat(500_000);
    match parse_with(&j, &format!("{{{key}:1}}")) {
        Ok(tabnas::Value::Object(map)) => {
            assert_eq!(map.len(), 1);
            assert_eq!(map.keys().next().map(String::len), Some(500_000));
        }
        other => panic!("long key: {other:?}"),
    }

    // 200,000 line continuations collapse to the empty string, and the
    // rewrite that strips them does not go quadratic doing it.
    match parse_with(&j, &format!("\"{}\"", "\\\n".repeat(200_000))) {
        Ok(tabnas::Value::String(got)) => assert!(got.is_empty(), "{} chars", got.len()),
        other => panic!("continuations: {other:?}"),
    }

    // 200,000 unicode escapes decode one for one.
    match parse_with(&j, &format!("\"{}\"", "\\u0041".repeat(200_000))) {
        Ok(tabnas::Value::String(got)) => {
            assert_eq!(got.len(), 200_000);
            assert!(got.bytes().all(|byte| byte == b'A'));
        }
        other => panic!("escapes: {other:?}"),
    }
}

/// A wide container is the other direction from a deep one: the budget
/// bounds DEPTH, and breadth is unbounded on purpose, so a document with
/// many siblings must arrive whole rather than truncated at some cap.
#[test]
fn a_wide_container_arrives_whole() {
    let j = make();
    const WIDTH: usize = 5_000;

    let array = format!("[{}]", "1,".repeat(WIDTH));
    match parse_with(&j, &array) {
        Ok(tabnas::Value::Array(items)) => assert_eq!(items.len(), WIDTH),
        other => panic!("wide array: {other:?}"),
    }

    let mut object = String::from("{");
    for index in 0..WIDTH {
        object.push_str(&format!("k{index}:1,"));
    }
    object.push('}');
    match parse_with(&j, &object) {
        Ok(tabnas::Value::Object(map)) => assert_eq!(map.len(), WIDTH),
        other => panic!("wide object: {other:?}"),
    }
}
