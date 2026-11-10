// A parse from a reader (`Tabnas::parse_reader`, admin ADR-30). `make()`
// declares `lex.window`, so a reader is read a window at a time: the checks
// this crate installs (the fixed check that reads a string holding a line
// continuation, the string check and the text check) read the source only
// through the lexer's window, and jsonic's base is the engine's own
// matchers. Every row of the shared fixtures, every document of the
// vendored json5-tests corpus and every probe derived from it parses the
// same from a reader, handed over a few bytes at a time and under windows
// whose margin and block are a few characters (`parse_reader_with_sizes`,
// which makes every check meet the window's edge), as from its text,
// through `parse_reader_with` as through `parse_with` and through the
// parser's own `parse_reader` as through its `parse`; and so do strings the
// window's edge cuts at every place, the values the text check judges, and
// long documents. `ts/test/window.test.ts` and `go/window_test.go` hold the
// other runtimes to the same.

mod common;

use std::collections::HashMap;
use std::fs;
use std::io::Read;

use serde::Deserialize;
use tabnas::{Tabnas, TabnasError, Value, WindowSizes};
use tabnas_json5::{check_reader, make, make_with, parse_reader_with, parse_with, Json5Options};
use tabnas_support::{load_spec_dir, SpecOptions};

use common::{json, options_from_column, repo_root, spec_dir};

/// The pieces a reader hands its bytes over in.
const PIECES: [usize; 3] = [1, 3, 64];

/// Windows whose margin and block are a few characters.
const WINDOWS: [(usize, usize); 3] = [(1, 1), (3, 2), (64, 64)];

/// A reader that hands its bytes over at most `size` at a time, counting
/// what it has handed over.
struct Pieces<'a> {
    bytes: &'a [u8],
    at: usize,
    size: usize,
}

impl Read for Pieces<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.size.min(buf.len()).min(self.bytes.len() - self.at);
        buf[..n].copy_from_slice(&self.bytes[self.at..self.at + n]);
        self.at += n;
        Ok(n)
    }
}

fn pieces(bytes: &[u8], size: usize) -> Pieces<'_> {
    Pieces { bytes, at: 0, size }
}

/// A reader that hands over its bytes and then fails.
struct Failing<'a>(&'a [u8]);

impl Read for Failing<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.0.is_empty() {
            return Err(std::io::Error::other("the reader failed"));
        }
        let n = buf.len().min(self.0.len());
        buf[..n].copy_from_slice(&self.0[..n]);
        self.0 = &self.0[n..];
        Ok(n)
    }
}

/// What a parse shows: its value, or its error's code, position, row,
/// column and token text. An error's excerpt is left out: a parse from a
/// reader shows a long line only as far back as the window reaches
/// (tabnas/parser `DIVERGENCE.md`), and that is the one difference allowed.
fn outcome(parsed: Result<Value, TabnasError>) -> String {
    match parsed {
        Ok(value) => format!("ok {}", json(&value)),
        Err(e) => format!(
            "err {} at {} {}:{} {:?}",
            e.code, e.pos, e.row, e.col, e.token.src
        ),
    }
}

/// The windows a document is read under: the window's own sizes, and each
/// small one.
fn windows(chunk: usize) -> Vec<Option<WindowSizes>> {
    let mut out = vec![None];
    out.extend(WINDOWS.map(|(margin, block)| {
        Some(WindowSizes {
            margin,
            block,
            chunk,
        })
    }));
    out
}

/// `bytes` read from a reader in pieces of `size` under `sizes`, through
/// the `requireValue` rule ([`check_reader`], which [`parse_reader_with`]
/// applies), as [`parse_with`] reads a text.
fn guarded(parser: &Tabnas, bytes: &[u8], size: usize, sizes: Option<WindowSizes>) -> String {
    let reader = pieces(bytes, size);
    outcome(match sizes {
        None => parse_reader_with(parser, reader),
        Some(sizes) => check_reader(parser, reader)
            .and_then(|checked| parser.parse_reader_with_sizes(checked, sizes)),
    })
}

/// `bytes` read by the parser's own `parse_reader`, as its `parse` reads a
/// text.
fn plain(parser: &Tabnas, bytes: &[u8], size: usize, sizes: Option<WindowSizes>) -> String {
    let reader = pieces(bytes, size);
    outcome(match sizes {
        None => parser.parse_reader(reader),
        Some(sizes) => parser.parse_reader_with_sizes(reader, sizes),
    })
}

/// Parse `text` whole and from a reader in pieces of each size, under
/// each window, both ways, and add where they differ to `failures`.
/// Answers the number of reader parses compared.
fn same_from_reader(
    parser: &Tabnas,
    at: &str,
    text: &str,
    sizes: &[usize],
    failures: &mut Vec<String>,
) -> usize {
    let whole = outcome(parse_with(parser, text));
    let whole_plain = outcome(parser.parse(text));
    let mut compared = 0;
    for &size in sizes {
        for window in windows(size) {
            let read = guarded(parser, text.as_bytes(), size, window);
            if read != whole {
                failures.push(format!(
                    "{at}, pieces of {size}, {window:?}:\n  parse_with:        {}\n  parse_reader_with: {}",
                    cut(&whole),
                    cut(&read)
                ));
            }
            let read = plain(parser, text.as_bytes(), size, window);
            if read != whole_plain {
                failures.push(format!(
                    "{at}, pieces of {size}, {window:?}:\n  parse:        {}\n  parse_reader: {}",
                    cut(&whole_plain),
                    cut(&read)
                ));
            }
            compared += 2;
        }
    }
    compared
}

/// Parse `text` whole and from a reader at the window's sharpest edge:
/// handed over a byte at a time, under a margin and a block of one
/// character, through the `requireValue` rule. Adds where they differ to
/// `failures`.
fn same_at_the_edge(parser: &Tabnas, at: &str, text: &str, failures: &mut Vec<String>) {
    let whole = outcome(parse_with(parser, text));
    let edge = WindowSizes {
        margin: 1,
        block: 1,
        chunk: 1,
    };
    let read = guarded(parser, text.as_bytes(), 1, Some(edge));
    if read != whole {
        failures.push(format!(
            "{at}, at the edge:\n  parse_with:        {}\n  parse_reader_with: {}",
            cut(&whole),
            cut(&read)
        ));
    }
}

fn cut(text: &str) -> String {
    text.chars().take(200).collect()
}

fn assert_none(failures: &[String]) {
    assert!(
        failures.is_empty(),
        "{} differences, the first:\n{}",
        failures.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// Every row of the shared fixtures: where it is, its input and its
/// options.
fn fixture_rows() -> Vec<(String, String, Json5Options)> {
    let dir = spec_dir();
    let specs = load_spec_dir(&dir, &SpecOptions::default())
        .unwrap_or_else(|error| panic!("{}: {error}", dir.display()));
    let mut rows = Vec::new();
    for spec in &specs {
        for row in &spec.rows {
            let options = options_from_column(row.named("opts"), &row.location())
                .unwrap_or_else(|failure| panic!("{failure:?}"));
            rows.push((row.location(), row.unesc_named("input"), options));
        }
    }
    assert!(rows.len() >= 220, "only {} fixture rows", rows.len());
    rows
}

#[test]
fn make_reads_a_reader_a_window_at_a_time() {
    assert!(make().options.lex.window);
    let options = Json5Options {
        hash_comment: true,
        ..Default::default()
    };
    assert!(make_with(options).options.lex.window);
    // The plugin leaves the window to the parser that installs it, since a
    // host may install it beneath matchers of its own.
    let mut parser = tabnas_jsonic::make();
    parser
        .use_plugin(tabnas_json5::plugin(), None)
        .expect("the plugin installs");
    assert!(!parser.options.lex.window);
}

#[test]
fn make_parses_as_the_composition() {
    let mut failures = Vec::new();
    for (at, input, options) in fixture_rows() {
        let mut composed = tabnas_jsonic::make();
        composed
            .use_plugin(tabnas_json5::plugin(), Some(options.to_value()))
            .expect("the plugin installs");
        let want = outcome(parse_with(&composed, &input));
        let got = outcome(parse_with(&make_with(options), &input));
        if got != want {
            failures.push(format!("{at}:\n  make_with: {got}\n  composed:  {want}"));
        }
    }
    assert_none(&failures);
}

#[test]
fn fixtures_parse_the_same_from_a_reader() {
    let mut failures = Vec::new();
    let mut compared = 0;
    for (at, input, options) in fixture_rows() {
        compared += same_from_reader(&make_with(options), &at, &input, &PIECES, &mut failures);
    }
    eprintln!("reader fixtures: {compared} reader parses (100%)");
    assert_none(&failures);
}

#[derive(Deserialize)]
struct Manifest {
    cases: HashMap<String, serde_json::Value>,
    derived: Derived,
}

#[derive(Deserialize)]
struct Derived {
    truncations: HashMap<String, Vec<usize>>,
    trailing: HashMap<String, Vec<String>>,
}

#[test]
fn the_corpus_parses_the_same_from_a_reader() {
    let root = repo_root().join("test").join("json5-tests");
    let raw = fs::read_to_string(repo_root().join("test").join("json5-tests-expected.json"))
        .expect("the corpus oracle is vendored");
    let manifest: Manifest = serde_json::from_str(&raw).expect("the oracle is JSON");
    let read = |rel: &str| {
        fs::read_to_string(root.join(rel)).unwrap_or_else(|error| panic!("{rel}: {error}"))
    };
    let parser = make();
    let mut failures = Vec::new();
    let mut documents = 0;
    for rel in manifest.cases.keys() {
        same_from_reader(&parser, rel, &read(rel), &PIECES, &mut failures);
        documents += 1;
    }
    eprintln!("reader corpus: {documents} documents (33%)");
    // The probes, each document cut at every character and followed by
    // each suffix ES5 refuses, end at the window's edge by design: each is
    // read there, at the sharpest edge.
    let mut probes = 0;
    for rel in manifest.derived.truncations.keys() {
        let chars: Vec<char> = read(rel).chars().collect();
        for n in 1..chars.len() {
            let text: String = chars[..n].iter().collect();
            same_at_the_edge(&parser, &format!("{rel} cut at {n}"), &text, &mut failures);
            probes += 1;
        }
    }
    eprintln!("reader corpus: {probes} truncations (66%)");
    for (rel, suffixes) in &manifest.derived.trailing {
        let text = read(rel);
        for suffix in suffixes {
            same_at_the_edge(
                &parser,
                &format!("{rel} with {suffix:?}"),
                &format!("{text}{suffix}"),
                &mut failures,
            );
            probes += 1;
        }
    }
    eprintln!("reader corpus: {documents} documents and {probes} probes (100%)");
    assert_eq!(documents, 114);
    assert!(probes >= 5000, "only {probes} probes");
    assert_none(&failures);
}

/// Strings of every length up to a few dozen characters, so that the
/// window's edge falls at every place in each: with a line continuation
/// and without, an escape at the end, a forbidden escape after a
/// continuation, a surrogate pair either side of one, and strings the
/// source ends inside.
#[test]
fn strings_meet_the_window_edge_at_every_place() {
    let parser = make();
    let mut failures = Vec::new();
    let mut compared = 0;
    let shapes: [&dyn Fn(&str) -> String; 15] = [
        &|s| format!("'{s}\\\n'"),
        &|s| format!("['{s}\\\r\n{s}', 1]"),
        &|s| format!("\"{s}\\\u{2028}é\\x41\""),
        &|s| format!("'\\\n{s}\\u00e9'"),
        &|s| format!("'\\\n{s}\\uD83D\\\n\\uDE00'"),
        &|s| format!("'\\\n{s}\\1'"),
        &|s| format!("'\\\n{s}\\x4'"),
        &|s| format!("'\\\n{s}\\u12'"),
        &|s| format!("'\\\n{s}"),
        &|s| format!("\"{s}\\0\""),
        &|s| format!("\"{s}\\01\""),
        &|s| format!("{{a: \"{s}\\u{{41}}\"}}"),
        // An escape the closing quote cuts short, with text after the quote
        // its error's span reaches into.
        &|s| format!("['\\\n{s}\\u12', 1]"),
        &|s| format!("['\\\n{s}\\x', 1]"),
        &|s| format!("['{s}\\\n\\u', 23]"),
    ];
    for (n, shape) in shapes.iter().enumerate() {
        for len in 0..40 {
            let text = shape(&"s".repeat(len));
            compared += same_from_reader(
                &parser,
                &format!("shape {n}, {len} characters"),
                &text,
                &[1, 2],
                &mut failures,
            );
        }
    }
    eprintln!("reader strings: {compared} reader parses (100%)");
    assert_none(&failures);
}

/// The values the text check judges, at the window's edge: with the
/// number lexer on, and off, where nothing reads ahead of the check and
/// what it lets through is read by the value regexes and keywords alone.
#[test]
fn the_text_check_reads_as_far_as_its_answer_needs() {
    let mut numbers_off = make();
    numbers_off
        .set_options(|options| options.number.lex = false)
        .expect("number.lex sets");
    let mut failures = Vec::new();
    let mut compared = 0;
    for (name, parser) in [("numbers on", make()), ("numbers off", numbers_off)] {
        for len in 0..24 {
            let digits = "0".repeat(len);
            let hex = "F".repeat(len + 1);
            for text in [
                format!("[1{digits}.e3, -0X{hex}, -Infinity, +NaN, 5.e4]"),
                format!("{{a: -Infinity, b: +Infinity{digits}}}"),
                format!("[1{digits}.e]"),
                "[-0X]".to_string(),
                "[-Inf, 1]".to_string(),
                format!("[+N{digits}]"),
                format!("[@{digits}]"),
                format!("1{digits}.e3"),
            ] {
                compared += same_from_reader(
                    &parser,
                    &format!("{name}: {text}"),
                    &text,
                    &[1, 2],
                    &mut failures,
                );
            }
        }
    }
    eprintln!("reader text check: {compared} reader parses (100%)");
    assert_none(&failures);
}

/// A document whose tokens of every kind this crate reads are long and
/// short: strings holding a line continuation, strings without one, keys
/// and values the text check judges, numbers, keywords, comments and
/// space. `long` is the length of the long ones, and `ending` closes it.
fn long_document(records: usize, long: usize, ending: &str) -> String {
    let mut out = String::from("// records\n[\n");
    for i in 0..records {
        out.push_str(&format!(
            "  {{id: {i}, 'name': \"ñ{i}\\u00e9\\\n\" /* note {i} */, tags: ['a', \"b\\x41\"], n: -1.5e3, h: 0X1F, d: 5.e4, x: -Infinity, y: +NaN, \\u0061b: 1,}}, // row {i}\n"
        ));
        if i == records / 2 {
            out.push_str(&format!(
                "  '{}\\\r\n{}',\n",
                "s".repeat(long),
                "t".repeat(3)
            ));
            out.push_str(&format!(
                "  \"\\\n{}\\x4F\\uD83D\\\u{2028}\\uDE00\",\n",
                "é".repeat(long / 2)
            ));
            out.push_str(&format!("  \"{}\\\"\",\n", "q".repeat(long)));
            out.push_str(&format!("  1{}.e3,\n", "0".repeat(long)));
            out.push_str(&format!("  0X{},\n", "f".repeat(long)));
            out.push_str(&format!("  {{{}: 1}},\n", "k".repeat(long)));
            out.push_str(&format!("  // {}\n", "c".repeat(long)));
            out.push_str(&format!("  /* {} */\n", "b\n".repeat(long / 2)));
            out.push_str(&format!("{}\n{}", " ".repeat(long), "\n".repeat(long)));
        }
    }
    out + ending
}

/// The ways a long document ends: as written, and with each kind of error
/// the checks raise.
fn endings(long: usize) -> Vec<(&'static str, String)> {
    vec![
        ("ok", "  0\n]\n".to_string()),
        (
            "unexpected",
            format!("  '\\\n{}\\1'\n]\n", "u".repeat(long)),
        ),
        (
            "unterminated_string",
            format!("  '\\\n{}", "u".repeat(long)),
        ),
        ("invalid_ascii", format!("  '\\\n{}\\x4", "u".repeat(long))),
        (
            "invalid_unicode",
            format!("  '\\\n{}\\u12'", "u".repeat(long)),
        ),
        ("unexpected", format!("  \"{}\\01\"\n]\n", "v".repeat(long))),
        ("unexpected", format!("  1{}.e\n]\n", "0".repeat(long))),
    ]
}

#[test]
fn a_long_document_parses_the_same_from_a_reader() {
    let parser = make();
    let mut failures = Vec::new();
    // Tokens longer than the window's margin of 64 KiB, under the window's
    // own sizes.
    let long = 64 * 1024 + 2048;
    let all = endings(long);
    for (n, (code, ending)) in all.iter().enumerate() {
        let text = long_document(300, long, ending);
        let whole = outcome(parse_with(&parser, &text));
        assert!(
            whole.starts_with(&format!("{} ", if *code == "ok" { "ok" } else { "err" }))
                && (*code == "ok" || whole.starts_with(&format!("err {code} "))),
            "ending {n}: {}",
            cut(&whole)
        );
        for size in [4096, 64 * 1024 + 3] {
            let read = guarded(&parser, text.as_bytes(), size, None);
            if read != whole {
                failures.push(format!(
                    "the long document, ending {n}, pieces of {size}:\n  whole:  {}\n  reader: {}",
                    cut(&whole),
                    cut(&read)
                ));
            }
        }
        eprintln!(
            "reader long document: {} of {} ({}%), {} bytes",
            n + 1,
            all.len(),
            (n + 1) * 100 / all.len(),
            text.len()
        );
    }
    // Under a small window, a document of some 100 KB, since a debug build
    // takes seconds over each parse of a larger one.
    let small = WindowSizes {
        margin: 16,
        block: 16,
        chunk: 7,
    };
    for (n, (_, ending)) in endings(300).iter().enumerate() {
        let text = long_document(300, 300, ending);
        let whole = outcome(parse_with(&parser, &text));
        let read = outcome(
            check_reader(&parser, pieces(text.as_bytes(), 5))
                .and_then(|checked| parser.parse_reader_with_sizes(checked, small)),
        );
        if read != whole {
            failures.push(format!(
                "the document under a small window, ending {n}:\n  whole:  {}\n  reader: {}",
                cut(&whole),
                cut(&read)
            ));
        }
    }
    assert_none(&failures);
}

#[test]
fn check_reader_reads_only_the_leading_whitespace_and_comments() {
    let parser = make();
    for (text, code) in [
        ("", "json5_empty"),
        ("   ", "json5_no_value"),
        ("\u{feff}", "json5_no_value"),
        ("// only a comment", "json5_no_value"),
        ("/* only */ // comments\n\u{2028}", "json5_no_value"),
        ("/* x", "unterminated_comment"),
    ] {
        let whole = outcome(parse_with(&parser, text));
        assert!(
            whole.starts_with(&format!("err {code} ")),
            "{text:?}: {whole}"
        );
        for size in [1, 2, 3, 4096] {
            for window in windows(size) {
                assert_eq!(
                    guarded(&parser, text.as_bytes(), size, window),
                    whole,
                    "{text:?}, pieces of {size}, {window:?}"
                );
            }
        }
    }

    // Only the leading trivia and the character after it are read.
    let lead = "  // a comment\n /* and another */ ";
    let text = format!("{lead}[{}1]", "1,".repeat(1 << 16));
    let mut source = pieces(text.as_bytes(), 1);
    let mut checked = check_reader(&parser, &mut source).expect("a value follows");
    let mut all = Vec::new();
    checked.read_to_end(&mut all).expect("the reader reads");
    assert_eq!(all, text.as_bytes());
    let mut source = pieces(text.as_bytes(), 1);
    drop(check_reader(&parser, &mut source).expect("a value follows"));
    assert_eq!(source.at, lead.len() + 1);

    // A read that fails inside the leading comments, and bytes that are not
    // UTF-8 there, are the parse's to report.
    let read = outcome(parse_reader_with(&parser, Failing(b"// a comment")));
    assert_eq!(read, outcome(parser.parse_reader(Failing(b"// a comment"))));
    assert!(read.starts_with("err unreadable "), "{read}");
    let read = outcome(parse_reader_with(&parser, pieces(b"// \xff\n", 1)));
    assert!(read.starts_with("err unreadable "), "{read}");

    // Without the rule the reader is the parse's alone.
    let off = make_with(Json5Options {
        require_value: false,
        ..Default::default()
    });
    for text in ["", "  ", "// c", "[1]"] {
        assert_eq!(
            outcome(parse_reader_with(&off, pieces(text.as_bytes(), 1))),
            outcome(parse_with(&off, text)),
            "requireValue off, {text:?}"
        );
    }
}

/// The text check reads a keyword or a value regex's match as a run of a
/// number's characters, so that it reads through the window only as far as
/// the run. That holds of the keywords it can meet, those that do not begin
/// an identifier, and of the two regexes the grammar declares, which this
/// pins: a definition that could match another character must widen
/// `is_number_char` first.
#[test]
fn the_value_definitions_read_a_numbers_characters() {
    let number = |c: char| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.');
    let parser = make();
    let definitions = &parser.options.value.definitions;
    for name in definitions.keys() {
        let identifier = name.starts_with(|c: char| c.is_ascii_alphabetic());
        assert!(
            identifier || name.chars().all(number),
            "the keyword {name:?} holds a character a number is not written in"
        );
    }
    let mut regexes: Vec<String> = definitions
        .values()
        .filter_map(|def| def.matcher.as_ref().map(|regex| regex.as_str().to_string()))
        .collect();
    regexes.sort();
    assert_eq!(
        regexes,
        [
            r"^[+-]?(?:0|[1-9][0-9]*)\.[eE][+-]?[0-9]+",
            r"^[+-]?0X[0-9a-fA-F]+"
        ]
    );
}
