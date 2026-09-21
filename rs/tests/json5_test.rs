// In-language tests: the behaviour the shared fixtures cannot pin, and
// the same cases `go/json5_test.go` and `ts/test/json5.test.ts` carry,
// so the three suites can be read side by side.

mod common;

use std::sync::Arc;
use std::thread;

use tabnas::Tabnas;
use tabnas_json5::{json5, make, make_with, parse, parse_with, plugin, Json5Options};

use common::{json, to_value};

/// A fresh parser with the given overrides on the defaults.
fn parser(configure: impl FnOnce(&mut Json5Options)) -> Tabnas {
    let mut options = Json5Options::default();
    configure(&mut options);
    make_with(options)
}

fn parsed(parser: &Tabnas, src: &str) -> String {
    json(&parse_with(parser, src).unwrap_or_else(|error| panic!("{src:?}: {error}")))
}

fn code(parser: &Tabnas, src: &str) -> String {
    match parse_with(parser, src) {
        Ok(value) => panic!("{src:?} parsed to {}", json(&value)),
        Err(error) => error.code,
    }
}

// --- go/json5_test.go -------------------------------------------------

#[test]
fn primitives() {
    let j = make();
    for (src, want) in [
        ("true", "true"),
        ("false", "false"),
        ("null", "null"),
        (r#""hello""#, r#""hello""#),
        ("'hello'", r#""hello""#),
        ("42", "42"),
        ("3.14", "3.14"),
        ("-7", "-7"),
        ("+5", "5"),
        (".5", "0.5"),
        ("5.", "5"),
        ("1e10", "10000000000"),
        ("1.5e-2", "0.015"),
        ("0x1F", "31"),
        ("0xDEADBEEF", "3735928559"),
        ("-0x10", "-16"),
    ] {
        assert_eq!(parsed(&j, src), want, "{src:?}");
    }
}

#[test]
fn infinity_and_nan() {
    let j = make();
    for src in ["Infinity", "+Infinity"] {
        assert_eq!(parsed(&j, src), "Infinity", "{src:?}");
    }
    assert_eq!(parsed(&j, "-Infinity"), "-Infinity");
    for src in ["NaN", "+NaN", "-NaN"] {
        assert_eq!(parsed(&j, src), "NaN", "{src:?}");
    }

    // Can be disabled.
    let jn = parser(|o| o.infinity = false);
    assert_eq!(code(&jn, "Infinity"), "unexpected");
    assert_eq!(code(&jn, "NaN"), "unexpected");
}

#[test]
fn objects() {
    let j = make();
    for (src, want) in [
        ("{}", "{}"),
        (r#"{"a":1}"#, r#"{"a":1}"#),
        ("{a:1}", r#"{"a":1}"#),
        ("{a:1,b:2}", r#"{"a":1,"b":2}"#),
        ("{a:1, 'b':2}", r#"{"a":1,"b":2}"#),
        ("{ nested: { x: 1 } }", r#"{"nested":{"x":1}}"#),
        ("{$id:1, _n:2, a1:3}", r#"{"$id":1,"_n":2,"a1":3}"#),
    ] {
        assert_eq!(parsed(&j, src), want, "{src:?}");
    }
}

#[test]
fn arrays() {
    let j = make();
    for (src, want) in [
        ("[]", "[]"),
        ("[1]", "[1]"),
        ("[1,2,3]", "[1,2,3]"),
        (r#"["a","b"]"#, r#"["a","b"]"#),
        ("[[1,2],[3,4]]", "[[1,2],[3,4]]"),
    ] {
        assert_eq!(parsed(&j, src), want, "{src:?}");
    }
}

#[test]
fn trailing_commas() {
    let j = make();
    for (src, want) in [
        ("[1,2,3,]", "[1,2,3]"),
        ("{a:1,b:2,}", r#"{"a":1,"b":2}"#),
        ("[1,]", "[1]"),
        ("{a:1,}", r#"{"a":1}"#),
        ("[ 1 , 2 , ]", "[1,2]"),
    ] {
        assert_eq!(parsed(&j, src), want, "{src:?}");
    }
}

#[test]
fn comments() {
    let j = make();
    for (src, want) in [
        ("// hello\n42", "42"),
        ("/* block */ 42", "42"),
        ("{ a: 1, /* mid */ b: 2 }", r#"{"a":1,"b":2}"#),
        ("[/* a */ 1, /* b */ 2]", "[1,2]"),
        ("/* multi\nline\ncomment */ [1,2]", "[1,2]"),
    ] {
        assert_eq!(parsed(&j, src), want, "{src:?}");
    }

    // Hash comments are not JSON5 by default.
    assert_eq!(code(&j, "# nope\n42"), "unexpected");

    // Can be enabled.
    let jh = parser(|o| o.hash_comment = true);
    assert_eq!(parsed(&jh, "# hello\n42"), "42");
}

#[test]
fn strings() {
    let j = make();
    for (src, want) in [
        (r#""hello""#, "hello"),
        ("'hello'", "hello"),
        (r#""he said \"hi\"""#, r#"he said "hi""#),
        (r#"'he said \'hi\''"#, "he said 'hi'"),
        (r#""a\tb""#, "a\tb"),
        (r#""a\nb""#, "a\nb"),
        (r#""aAb""#, "aAb"),
        (r#""a\x41b""#, "aAb"),
        (r#""\0""#, "\0"),
        ("\"line1\\\nline2\"", "line1line2"),
        ("\"line1\\\r\nline2\"", "line1line2"),
    ] {
        match parse_with(&j, src) {
            Ok(tabnas::Value::String(got)) => assert_eq!(got, want, "{src:?}"),
            other => panic!("{src:?}: {other:?}"),
        }
    }

    // Backticks are not JSON5 by default.
    assert_eq!(code(&j, "`backtick`"), "unexpected");

    // Can be enabled.
    let jb = parser(|o| o.backtick_string = true);
    assert_eq!(parsed(&jb, "`backtick`"), r#""backtick""#);
}

#[test]
fn rejects_non_json5() {
    let j = make();
    for src in [
        "", "foo", "0o17", "0b101", "1_000", "1,2,3", "a:1", "{,}", "{10:1}",
    ] {
        assert!(parse_with(&j, src).is_err(), "{src:?} expected an error");
    }
}

/// Mirrors the TypeScript `require-value` test: empty input under the
/// default requireValue option fails with `json5_empty` (message matching
/// /JSON5/), while requireValue=false lets it parse to `null`.
#[test]
fn require_value() {
    let j = make();
    let error = parse_with(&j, "").expect_err("empty input is an error");
    assert_eq!(error.code, "json5_empty");
    assert!(error.to_string().contains("JSON5"), "{error}");
    assert_eq!(error.detail, "JSON5 input must contain a value");
    assert!(error.hint.contains("top-level value"), "{}", error.hint);

    let error = parse_with(&j, "   // nothing").expect_err("no value is an error");
    assert_eq!(error.code, "json5_no_value");

    // A direct `parse` on the instance also fails (lex.empty is off),
    // though with the engine's generic error; the package-level
    // `parse_with` is the counterpart of the TypeScript wrapped start
    // and the Go `Parse(j, src)`.
    assert!(j.parse("").is_err());

    // Allow empty input.
    let jopt = parser(|o| o.require_value = false);
    assert_eq!(parsed(&jopt, ""), "null");
    assert_eq!(parsed(&jopt, "  // nothing\n/* here */"), "null");
}

/// Both ports site the two no-value errors at the start of the source,
/// where the canonical raises them before the lexer has a point to
/// report and leaves `row` and `col` undefined. The CODE agrees, and
/// that is what `../test/spec/options.tsv` pins in all three runtimes;
/// the POSITION is what diverges, and no fixture column carries it.
/// This is the pin for the RUST column of that entry in
/// `../DIVERGENCE.md`; `the-no-value-errors-carry-no-position` in
/// `ts/test/json5.test.ts` and `TestTheNoValueErrorsCarryAPosition` in
/// `go/json5_test.go` pin the other two.
#[test]
fn the_no_value_errors_carry_a_position() {
    let j = make();
    for (src, want) in [("//", "json5_no_value"), ("", "json5_empty")] {
        let error = parse_with(&j, src).expect_err("refused");
        assert_eq!(
            (error.code.as_str(), error.row, error.col),
            (want, 1, 1),
            "{src:?}"
        );
    }
}

/// A hash-comment-only source under `hashComment`, with `requireValue`
/// OFF. `has_value` deliberately knows only the two slash comment forms,
/// in all three runtimes, so a `#` counts as the start of a value and
/// the requireValue short-circuit does not fire. The source then reaches
/// the rules, where this engine answers the grammar's declared
/// `emptyResult` and the canonical TypeScript engine falls out with no
/// value at all. That difference is recorded in `../DIVERGENCE.md`.
///
/// Neither pin the register offers fits: it has no `opts` column, and a
/// shared fixture compares ONE expected value across three runtimes, so
/// a row for this input would be a row the runtimes disagree about. This
/// is the pin for the RUST column. The TypeScript and Go columns of that
/// table are pinned by `hash-comment-only-with-require-value-off` in
/// `ts/test/json5.test.ts` and `TestHashCommentOnlyWithRequireValueOff`
/// in `go/json5_test.go`, so a change to any of the three goes red.
///
/// The expectation is `Value::Null` by NAME, not "some empty thing".
/// `Value::Null` and `Value::Undefined` are different results, and which
/// one comes back IS the divergence, so an assertion loose enough to
/// accept either would pin nothing. Verified by flipping it to
/// `Value::Undefined`, which fails.
#[test]
fn a_hash_comment_only_source_answers_the_declared_empty_result() {
    let j = parser(|o| {
        o.hash_comment = true;
        o.require_value = false;
    });
    for src in ["# c", "# c\n# d", "   # c   "] {
        assert_eq!(
            parse_with(&j, src).unwrap_or_else(|error| panic!("{src:?}: {error}")),
            tabnas::Value::Null,
            "{src:?}"
        );
    }

    // The slash forms answer the same thing, and they are shared fixture
    // rows: only the hash form diverges.
    let slash = parser(|o| o.require_value = false);
    assert_eq!(
        parse_with(&slash, "// c").expect("parsed"),
        tabnas::Value::Null
    );

    // The control, itself a row of `../test/spec/options.tsv`: with
    // requireValue ON the same source fails on the comment instead.
    let strict = parser(|o| o.hash_comment = true);
    assert_eq!(code(&strict, "# comment"), "unexpected");
}

#[test]
fn non_strict_options() {
    let js = parser(|o| {
        o.octal = true;
        o.binary = true;
        o.number_separator = true;
    });
    assert_eq!(parsed(&js, "0o17"), "15");
    assert_eq!(parsed(&js, "0b101"), "5");
    assert_eq!(parsed(&js, "1_000"), "1000");

    let jnh = parser(|o| o.hex = false);
    assert_eq!(code(&jnh, "0x1F"), "unexpected");
}

#[test]
fn strict_value_toggle() {
    // With strictValue disabled, bare words parse as text strings
    // (jsonic's default text fallback).
    let j = parser(|o| o.strict_value = false);
    assert_eq!(parsed(&j, "foo"), r#""foo""#);
}

#[test]
fn json5_spec_example() {
    let j = make();
    let src = "{
      // comments
      unquoted: 'and you can quote me on that',
      singleQuotes: 'I can use \"double quotes\" here',
      lineBreaks: \"Look, Mom! \\
No \\\\n's!\",
      hexadecimal: 0xdecaf,
      leadingDecimalPoint: .8675309, andTrailing: 8675309.,
      positiveSign: +1,
      trailingComma: 'in objects', andIn: ['arrays',],
      \"backwardsCompatible\": \"with JSON\",
    }";
    assert_eq!(
        parsed(&j, src),
        concat!(
            r#"{"unquoted":"and you can quote me on that","#,
            r#""singleQuotes":"I can use \"double quotes\" here","#,
            r#""lineBreaks":"Look, Mom! No \\n's!","hexadecimal":912559,"#,
            r#""leadingDecimalPoint":0.8675309,"andTrailing":8675309,"positiveSign":1,"#,
            r#""trailingComma":"in objects","andIn":["arrays"],"backwardsCompatible":"with JSON"}"#
        )
    );
}

#[test]
fn json_is_json5() {
    let j = make();
    for src in [
        "{}",
        "[]",
        r#"{"a":1,"b":"two","c":null,"d":true,"e":false}"#,
        r#"[1,2.5,-3,1e10,"s",null,true,false]"#,
        r#"{"nested":{"list":[1,{"x":null}]}}"#,
    ] {
        // Compared in the fixture data model, where every number is an
        // f64 as in JSON.parse, so `1` and `1.0` are one value.
        let want = tabnas_support::parse_expect(src).expect("valid JSON");
        let got = to_value(&parse_with(&j, src).unwrap_or_else(|error| panic!("{src:?}: {error}")));
        assert!(
            tabnas_support::equal_value(&got, &want),
            "{src:?}: {}",
            tabnas_support::format_value(&got)
        );
    }
}

// --- Keys: decoded, not just validated (test/spec/keys.tsv pins the
// --- table; this pins the API detail that the decoded name is the key)

#[test]
fn unquoted_keys_are_decoded() {
    let j = make();
    let value = parse_with(&j, r"{sigΣma:1, A:2}").expect("it parses");
    let tabnas::Value::Object(map) = value else {
        panic!("not an object: {value:?}");
    };
    let keys: Vec<&str> = map.keys().map(String::as_str).collect();
    assert_eq!(keys, ["sigΣma", "A"]);
}

// --- The API surface -------------------------------------------------

#[test]
fn options_round_trip_through_the_plugin_bag() {
    let options = Json5Options {
        hash_comment: true,
        require_value: false,
        ..Default::default()
    };
    assert_eq!(Json5Options::from_value(&options.to_value()), options);

    // A key the bag does not carry keeps its default, as in Go.
    let partial = Json5Options::from_json(&serde_json::json!({ "octal": true }));
    assert_eq!(
        partial,
        Json5Options {
            octal: true,
            ..Default::default()
        }
    );
    // As does a key of the wrong type.
    let odd = Json5Options::from_json(&serde_json::json!({ "hex": "no" }));
    assert_eq!(odd, Json5Options::default());
}

#[test]
fn the_plugin_installs_through_use_plugin_and_records_its_options() {
    let mut parser = tabnas_jsonic::make();
    let overrides = Json5Options {
        backtick_string: true,
        ..Default::default()
    };
    parser
        .use_plugin(plugin(), Some(overrides.to_value()))
        .expect("the plugin installs");
    assert_eq!(parsed(&parser, "`x`"), r#""x""#);
    assert_eq!(code(&parser, ""), "json5_empty");

    // The engine's option bag carries the merged defaults.
    let bag = parser.plugin_options("json5").expect("the bag is recorded");
    assert_eq!(Json5Options::from_value(bag), overrides);
}

#[test]
fn the_plain_install_function_matches_the_plugin() {
    let mut direct = tabnas_jsonic::make();
    json5(&mut direct, &Json5Options::default()).expect("the plugin installs");
    let through_make = make();
    for src in ["{a:1,}", "[1,2,]", "0x10", "Infinity", "'s'"] {
        assert_eq!(parsed(&direct, src), parsed(&through_make, src), "{src:?}");
    }
    assert_eq!(code(&direct, "foo"), code(&through_make, "foo"));
}

#[test]
fn parse_with_on_a_parser_without_the_plugin_is_a_plain_parse() {
    let jsonic = tabnas_jsonic::make();
    assert_eq!(parsed(&jsonic, "a:1"), r#"{"a":1}"#);
    assert_eq!(
        json(&parse_with(&jsonic, "").expect("jsonic accepts empty")),
        "undefined"
    );
}

#[test]
fn errors_carry_the_position() {
    let j = make();
    let error = parse_with(&j, "[1,\n  foo]").expect_err("bare text is rejected");
    assert_eq!(error.code, "unexpected");
    assert_eq!((error.row, error.col), (2, 3));
}

#[test]
fn a_string_line_continuation_is_stripped_inside_strings_only() {
    let j = make();
    assert_eq!(parsed(&j, "['a\\\nb', \"p\\\r\nq\"]"), r#"["ab","pq"]"#);
    assert!(parse_with(&j, "[1,\\\n2]").is_err());
    // A backslash does NOT continue a line comment.
    assert_eq!(parsed(&j, "// c\\\n1"), "1");
}

// --- The shared default parser ----------------------------------------

#[test]
fn parse_uses_a_shared_default_and_is_safe_across_threads() {
    assert_eq!(
        json(&parse("{a:[1,2,],b:0x10}").unwrap()),
        r#"{"a":[1,2],"b":16}"#
    );
    assert_eq!(parse("").unwrap_err().code, "json5_empty");

    let sources: Arc<Vec<&'static str>> = Arc::new(vec![
        "{a:1}",
        "[1,2,3,]",
        "'x'",
        "Infinity",
        "// c\n42",
        "{sig\\u03A3ma:1}",
    ]);
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let sources = Arc::clone(&sources);
            thread::spawn(move || {
                for _ in 0..50 {
                    for src in sources.iter() {
                        parse(src).unwrap_or_else(|error| panic!("{src:?}: {error}"));
                    }
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("a parsing thread panicked");
    }
}

// --- Line separators inside a string literal ---------------------------

/// U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR may appear
/// UNESCAPED inside a JSON5 string, where CR and LF may not (JSON5 5.2:
/// a `JSON5DoubleStringCharacter` is any `SourceCharacter` but a quote,
/// a backslash or a `LineTerminator`, plus `LineContinuation`, plus
/// U+2028 and U+2029). TypeScript and Go both accept them.
///
/// This engine asks `line.chars` alone for what a string may not hold,
/// and `line.chars` plus `line.fixed` everywhere a line can end, so the
/// plugin puts LS and PS in `line.fixed`. Carrying them in `line.chars`
/// instead, as TypeScript and Go do, made every one of these inputs
/// `unprintable` here.
///
/// The rows belong in `../test/spec/strings.tsv`, where all three
/// runtimes would execute them; they are pinned here because the pass
/// that found the defect may not write the shared fixtures.
#[test]
fn a_line_separator_is_legal_inside_a_string_but_still_ends_a_line() {
    let j = make();
    for (src, want) in [
        ("\"a\u{2028}b\"", "a\u{2028}b"),
        ("\"a\u{2029}b\"", "a\u{2029}b"),
        ("'a\u{2028}b'", "a\u{2028}b"),
        ("\"\u{2028}\"", "\u{2028}"),
    ] {
        match parse_with(&j, src) {
            Ok(tabnas::Value::String(got)) => assert_eq!(got, want, "{src:?}"),
            other => panic!("{src:?}: {other:?}"),
        }
    }
    // CR and LF are still forbidden unescaped.
    for src in ["\"a\nb\"", "\"a\rb\""] {
        assert_eq!(code(&j, src), "unprintable", "{src:?}");
    }
    // LS still ends a line comment and still bumps the row counter,
    // which is what `line.fixed` and `line.rowChars` are for.
    assert_eq!(parsed(&j, "//c\u{2028}1"), "1");
    assert_eq!(parsed(&j, "//c\u{2029}1"), "1");
    match parse_with(&j, "1\u{2028}2") {
        Err(error) => assert_eq!(
            (error.code.as_str(), error.row, error.col),
            ("unexpected", 2, 1)
        ),
        other => panic!("{other:?}"),
    }
}

// --- Recorded divergences the shared files cannot hold -----------------

/// A LONE SURROGATE escape survives in canonical TypeScript and folds to
/// U+FFFD here. Inherited from the engine, and from Rust itself: a
/// JavaScript string is UTF-16 and may hold an unpaired surrogate, while
/// a Rust `String` (and a Go `string`) is UTF-8 and cannot. The Go port
/// answers U+FFFD for the same inputs, so this is not a Rust-only
/// deviation; it is where the two UTF-8 ports stand together.
///
/// It is pinned HERE rather than in `../test/divergent.tsv` because that
/// register cannot express it. Its cells are JSON values, and every
/// runtime but TypeScript reads them with a UTF-8 JSON decoder that
/// folds `\ud800` to U+FFFD: a `ts` cell of `"\ud800"` and a `rust` cell
/// of `"�"` then MEAN the same thing to the Go and Rust halves,
/// which refuse the row as recording no divergence at all. Measured, not
/// assumed -- both halves were run against exactly that row. The shared
/// `test/spec` fixtures refuse such a cell outright:
/// `tabnas_support::lone_surrogate_at` exists to find it.
#[test]
fn a_lone_surrogate_folds_to_the_replacement_character() {
    let j = make();
    for (src, want) in [
        (r#""\uD800""#, "\u{FFFD}"),
        (r#""\uDFFF""#, "\u{FFFD}"),
        (r#""a\uD800b""#, "a\u{FFFD}b"),
    ] {
        match parse_with(&j, src) {
            Ok(tabnas::Value::String(got)) => assert_eq!(got, want, "{src:?}"),
            other => panic!("{src:?}: {other:?}"),
        }
    }

    // A well-formed PAIR is a single astral character, not two folds.
    match parse_with(&j, r#""𐀀""#) {
        Ok(tabnas::Value::String(got)) => assert_eq!(got, "\u{10000}"),
        other => panic!("{other:?}"),
    }
}

// An astral `IdentifierStart` opening an unquoted key, or unquoted
// text under `strictValue: false`, was a divergence until 2026-09-21:
// the canonical text check read one UTF-16 code unit and saw a high
// surrogate. It reads a code point now, so all three runtimes agree and
// the cases belong in the shared fixtures rather than in a Rust-only
// test: five astral letters opening a key in `../test/spec/keys.tsv`,
// the two `strictValue: false` rows in `../test/spec/options.tsv`, and
// an astral NON-letter control beside each.

// --- The inherited nesting budget --------------------------------------

/// Nesting is BOUNDED here and unbounded in TypeScript and Go. The
/// budget is jsonic's, inherited by building on `tabnas_jsonic::make()`;
/// this plugin's own grammar document does not name `parse.budget`, and
/// installing it must not drop what jsonic set. The boundary is pinned
/// so that a change is a decision rather than a surprise, and so that
/// the figure in `../DIVERGENCE.md` stays true. A Rust-only divergence
/// cannot be a register row: the TypeScript and Go halves each compare
/// their own column against one other port's and fail a row whose two
/// columns agree, so this asserts the RUST side alone.
///
/// The bound is for the CALLER's stack, not the parse loop: the engine's
/// `Value` walks its own nesting in `to_json()`, and again in the
/// derived drop it has no iterative replacement for, both outside this
/// crate and both one frame per level.
#[test]
fn nesting_is_capped_at_the_budget_jsonic_installs() {
    const LIMIT: usize = 127;
    let j = make();
    for (open, close, mid) in [("[", "]", ""), ("{a:", "}", "1")] {
        let at = |n: usize| format!("{}{mid}{}", open.repeat(n), close.repeat(n));
        parse_with(&j, &at(LIMIT)).unwrap_or_else(|error| panic!("{LIMIT} levels: {error}"));
        match parse_with(&j, &at(LIMIT + 1)) {
            Err(error) => assert_eq!(error.code, "cancel", "{} levels", LIMIT + 1),
            Ok(value) => panic!("{} levels parsed: {}", LIMIT + 1, json(&value)),
        }
    }
    // Deeper still is refused rather than run, so no caller ever holds a
    // tree too deep to drop.
    match parse_with(&j, &"[".repeat(10_000)) {
        Err(error) => assert_eq!(error.code, "cancel"),
        Ok(value) => panic!("10000 levels parsed: {}", json(&value)),
    }
}

// --- Base-prefixed integers round once ---------------------------------

/// The exact IEEE-754 bits, because a decimal expectation cannot show
/// the defect this pins: a digit-by-digit floating-point fold lands one
/// unit in the last place away from the correctly rounded value, and
/// both spellings print alike at many digits. `test/spec/numbers.tsv`
/// carries the same literals as shared rows; this is the bit-level
/// statement of what those rows mean, plus the ties the fixture would
/// make unreadable.
///
/// The expectations are ECMAScript's: `Number(BigInt(literal))`, which
/// is what `parseInt` on the digits produces and so what the canonical
/// TypeScript port returns. Verified against node over 4,000 random
/// literals in all three bases.
#[test]
fn wide_base_prefixed_literals_round_once_from_the_exact_integer() {
    let j = make();
    let bits = |src: &str| match parse_with(&j, src) {
        Ok(tabnas::Value::Number(got)) => got.to_bits(),
        other => panic!("{src:?}: {other:?}"),
    };

    // The reported case. The fold answered 0x43a4de5ef1e9f37e.
    assert_eq!(bits("0Xa6f2f78f4f9bf44"), 0x43a4_de5e_f1e9_f37f);
    assert_eq!(bits("0xa6f2f78f4f9bf44"), 0x43a4_de5e_f1e9_f37f);
    assert_eq!(bits("-0Xa6f2f78f4f9bf44"), 0xc3a4_de5e_f1e9_f37f);
    assert_eq!(bits("+0xa6f2f78f4f9bf44"), 0x43a4_de5e_f1e9_f37f);

    // Exactly representable, so nothing rounds.
    assert_eq!(bits("0x1fffffffffffff"), 9_007_199_254_740_991f64.to_bits());

    // Ties go to the even mantissa: 2^53+1 rounds down, 2^53+3 rounds up.
    assert_eq!(bits("0X20000000000001"), 9_007_199_254_740_992f64.to_bits());
    assert_eq!(bits("0X20000000000003"), 9_007_199_254_740_996f64.to_bits());

    // Wider than a u128, so the tail only contributes a sticky bit.
    assert_eq!(bits("0Xffffffffffffffffffffffffffffffffff"), {
        let two: f64 = 2.0;
        two.powi(136).to_bits()
    });
    assert_eq!(bits("0X10000000000000000000000000000000001"), {
        let two: f64 = 2.0;
        two.powi(136).to_bits()
    });

    // Past the double range is infinity, as `Number` of the bigint is.
    let wide = format!("0x{}", "f".repeat(300));
    assert_eq!(bits(&wide), f64::INFINITY.to_bits());

    // Leading zeros are not significant, and neither is a `0` literal.
    assert_eq!(
        bits("0X0000000000000000000000000000000000001"),
        1f64.to_bits()
    );
    assert_eq!(bits("0x0"), 0f64.to_bits());

    // The same conversion serves octal and binary under their options.
    let jo = parser(|o| {
        o.octal = true;
        o.binary = true;
    });
    let bits_o = |src: &str| match parse_with(&jo, src) {
        Ok(tabnas::Value::Number(got)) => got.to_bits(),
        other => panic!("{src:?}: {other:?}"),
    };
    assert_eq!(bits_o("0o46754573436475757744"), 0x43a3_7b2f_71e9_efc0);
    assert_eq!(
        bits_o("0b1010011011110010111101111000111101001111100110111111010001000101"),
        0x43e4_de5e_f1e9_f37f
    );

    // And with the `uppercaseHex` value definition rather than the number
    // lexer, which is the path `hex: false` leaves in place.
    let jn = parser(|o| o.hex = false);
    match parse_with(&jn, "0Xa6f2f78f4f9bf44") {
        Ok(tabnas::Value::Number(got)) => assert_eq!(got.to_bits(), 0x43a4_de5e_f1e9_f37f),
        other => panic!("{other:?}"),
    }
}
