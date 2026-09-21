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
