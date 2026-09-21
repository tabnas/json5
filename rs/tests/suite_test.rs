// The official json5/json5-tests conformance corpus.
//
// The corpus is vendored under `test/json5-tests/` (upstream MIT, see its
// LICENSE.md) so it is present unconditionally: in a clean clone, offline,
// and in CI. `test/json5-tests-expected.json` is the generated
// expected-VALUE oracle (`scripts/gen-json5-expected.js`: JSON.parse for
// .json, ES5 eval for .json5, the oracle json5-tests' own README
// prescribes). Rust has no ES5 evaluator, which is why the oracle is
// precomputed: it is what lets this runner, `ts/test/suite.test.ts` and
// `go/suite_test.go` assert exactly the same expected values.
//
// This runner asserts BOTH halves, exactly as the other two do:
//
//   valid (.json/.json5)  must parse AND produce the canonical expected value
//   invalid (.js/.txt)    must be REJECTED with an error
//
// It MUST NOT be possible for this suite to skip. A missing corpus or
// oracle is a hard panic, never an early return: a conformance run that
// silently does not happen is the defect this harness exists to prevent.

mod common;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tabnas::Tabnas;
use tabnas_json5::{make, parse_with};

use common::repo_root;

const SUITE_MISSING: &str = "The json5/json5-tests conformance corpus is not usable.
It is vendored at test/json5-tests/ with its generated oracle at
test/json5-tests-expected.json (regenerate: make gen-suite-expected).
This suite must never skip: a conformance run that silently does not
happen is the defect this harness exists to prevent.";

// --- canonical value form; must stay byte-compatible with
// --- scripts/gen-json5-expected.js, ts/test/suite.test.ts and
// --- go/suite_test.go

const CANON_HEX: &[u8; 16] = b"0123456789abcdef";

/// A string as an ASCII-only quoted form. It walks UTF-16 code units,
/// not characters, so it matches the JavaScript implementation exactly.
fn canon_quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for unit in text.encode_utf16() {
        match unit {
            0x22 => out.push_str("\\\""),
            0x5c => out.push_str("\\\\"),
            0x20..=0x7e => out.push(char::from(unit as u8)),
            _ => {
                out.push_str("\\u");
                for shift in [12, 8, 4, 0] {
                    out.push(char::from(CANON_HEX[((unit >> shift) & 0xf) as usize]));
                }
            }
        }
    }
    out.push('"');
    out
}

fn canon_float(number: f64) -> String {
    if number.is_nan() {
        "NaN".to_string()
    } else if number == f64::INFINITY {
        "Infinity".to_string()
    } else if number == f64::NEG_INFINITY {
        "-Infinity".to_string()
    } else {
        format!("#{:016x}", number.to_bits())
    }
}

fn canon_pairs<'a>(pairs: impl Iterator<Item = (&'a String, &'a tabnas::Value)>) -> String {
    let mut parts: Vec<String> = pairs
        .map(|(key, value)| format!("{}:{}", canon_quote(key), canon(value)))
        .collect();
    // Sorted by the (ASCII) quoted key form, which is what the JS side
    // does, so UTF-16 vs UTF-8 ordering can never make the two disagree.
    parts.sort();
    format!("{{{}}}", parts.join(","))
}

fn canon(value: &tabnas::Value) -> String {
    match value {
        tabnas::Value::Undefined | tabnas::Value::Null => "null".to_string(),
        tabnas::Value::Bool(flag) => flag.to_string(),
        tabnas::Value::Number(number) => canon_float(*number),
        tabnas::Value::String(text) => canon_quote(text),
        tabnas::Value::Text(text) => canon_quote(&text.string),
        tabnas::Value::Array(items) => {
            format!(
                "[{}]",
                items.iter().map(canon).collect::<Vec<_>>().join(",")
            )
        }
        tabnas::Value::ListRef(list) => format!(
            "[{}]",
            list.value.iter().map(canon).collect::<Vec<_>>().join(",")
        ),
        tabnas::Value::Object(map) => canon_pairs(map.iter()),
        tabnas::Value::MapRef(map) => canon_pairs(map.value.iter()),
    }
}

#[derive(Deserialize)]
struct SuiteCase {
    outcome: String,
    #[serde(default)]
    canon: String,
}

#[derive(Deserialize, Default)]
struct SuiteDerived {
    /// A fixture to the prefix lengths ES5 ACCEPTS; every other prefix
    /// length must be a JSON5 parse error.
    #[serde(default)]
    truncations: HashMap<String, Vec<usize>>,
    #[serde(default)]
    trailing: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
struct SuiteManifest {
    cases: HashMap<String, SuiteCase>,
    #[serde(default)]
    derived: SuiteDerived,
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
        .map(|entry| entry.expect("a readable directory entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == ".git") {
                continue;
            }
            walk(&path, out);
        } else if matches!(
            path.extension().and_then(|ext| ext.to_str()),
            Some("json" | "json5" | "js" | "txt")
        ) {
            out.push(path);
        }
    }
}

struct Suite {
    root: PathBuf,
    manifest: SuiteManifest,
    parser: Tabnas,
}

fn load() -> Suite {
    let root = repo_root().join("test").join("json5-tests");
    let manifest_path = repo_root().join("test").join("json5-tests-expected.json");
    assert!(
        root.is_dir(),
        "{SUITE_MISSING}\nmissing dir: {}",
        root.display()
    );
    let raw = fs::read_to_string(&manifest_path).unwrap_or_else(|error| {
        panic!(
            "{SUITE_MISSING}\nmissing oracle: {} ({error})",
            manifest_path.display()
        )
    });
    let manifest: SuiteManifest = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("bad oracle {}: {error}", manifest_path.display()));
    assert!(
        !manifest.cases.is_empty(),
        "oracle {} has no cases",
        manifest_path.display()
    );
    Suite {
        root,
        manifest,
        parser: make(),
    }
}

fn rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .expect("a corpus file is under the corpus root")
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Every corpus fixture, both halves: a valid one parses to the oracle's
/// value, an invalid one is rejected.
#[test]
fn official_suite() {
    let suite = load();
    let mut files = Vec::new();
    walk(&suite.root, &mut files);
    assert!(
        !files.is_empty(),
        "{SUITE_MISSING}\nno suite files discovered under {}",
        suite.root.display()
    );
    assert_eq!(
        files.len(),
        suite.manifest.cases.len(),
        "corpus has {} fixtures but the oracle has {} cases; run: make gen-suite-expected",
        files.len(),
        suite.manifest.cases.len()
    );

    let mut failures = Vec::new();
    for path in &files {
        let name = rel(&suite.root, path);
        let Some(expect) = suite.manifest.cases.get(&name) else {
            failures.push(format!("{name}: no oracle entry"));
            continue;
        };
        let data = fs::read_to_string(path).unwrap_or_else(|error| panic!("{name}: {error}"));
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default();
        let should_parse = ext == "json" || ext == "json5";
        assert_eq!(
            should_parse,
            expect.outcome == "value",
            "oracle/extension disagree for {name}"
        );

        // The package-level `parse_with` applies the requireValue rule,
        // the exact counterpart of the Go `Parse(j, src)` and of the
        // wrapped `parser.start` the TypeScript suite exercises. Calling
        // `parser.parse` directly would test a DIFFERENT entry point.
        match (should_parse, parse_with(&suite.parser, &data)) {
            (false, Ok(value)) => {
                failures.push(format!(
                    "{name}: expected parse error, but parsed to: {}",
                    canon(&value)
                ));
            }
            (false, Err(_)) => {}
            (true, Err(error)) => {
                failures.push(format!("{name}: expected to parse, got error: {error}"));
            }
            (true, Ok(value)) => {
                let got = canon(&value);
                if got != expect.canon {
                    failures.push(format!(
                        "{name}: wrong parsed value\n  got  {got}\n  want {}",
                        expect.canon
                    ));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// --- DERIVED supplement (NOT part of json5/json5-tests) ---------------
//
// Every case below is a string the ES5 engine itself rejects. JSON5 is a
// strict subset of ES5, so a JSON5 parser must reject them too. They
// exist because the official corpus has no truncated and no
// trailing-garbage documents, and therefore cannot see base-grammar
// leniency leaking through the plugin: a parser that auto-closes `{a:1`
// or that silently discards everything after the first complete
// top-level value passes the whole official corpus. Mirrors the same
// block in ts/test/suite.test.ts and go/suite_test.go.

#[test]
fn derived_truncation_must_not_auto_close() {
    let suite = load();
    assert!(
        !suite.manifest.derived.truncations.is_empty(),
        "the oracle has no derived truncations; run: make gen-suite-expected"
    );
    let mut failures = Vec::new();
    for (name, es5_accepts) in &suite.manifest.derived.truncations {
        let data = fs::read_to_string(suite.root.join(name))
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let chars: Vec<char> = data.chars().collect();
        let mut accepted = Vec::new();
        let mut probed = 0;
        for n in 1..chars.len() {
            if es5_accepts.contains(&n) {
                continue;
            }
            probed += 1;
            let src: String = chars[..n].iter().collect();
            if let Ok(value) = parse_with(&suite.parser, &src) {
                accepted.push(format!("{src:?} -> {}", canon(&value)));
            }
        }
        if !accepted.is_empty() {
            let show: Vec<&String> = accepted.iter().take(5).collect();
            failures.push(format!(
                "{name}: {}/{probed} ES5-invalid truncations were ACCEPTED, e.g.\n  {}",
                accepted.len(),
                show.iter()
                    .map(|line| line.as_str())
                    .collect::<Vec<_>>()
                    .join("\n  ")
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn derived_trailing_garbage_must_not_be_ignored() {
    let suite = load();
    assert!(
        !suite.manifest.derived.trailing.is_empty(),
        "the oracle has no derived trailing probes; run: make gen-suite-expected"
    );
    let mut failures = Vec::new();
    for (name, suffixes) in &suite.manifest.derived.trailing {
        let data = fs::read_to_string(suite.root.join(name))
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let mut accepted = Vec::new();
        for suffix in suffixes {
            if let Ok(value) = parse_with(&suite.parser, &format!("{data}{suffix}")) {
                accepted.push(format!("{suffix:?} -> {}", canon(&value)));
            }
        }
        if !accepted.is_empty() {
            failures.push(format!(
                "{name}: {}/{} ES5-invalid trailing suffixes were ACCEPTED (garbage after a \
                 complete value silently ignored):\n  {}",
                accepted.len(),
                suffixes.len(),
                accepted.join("\n  ")
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
