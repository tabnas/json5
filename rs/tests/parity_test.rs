// Cross-runtime conformance, driven by the shared `test/spec/*.tsv`
// fixtures at the repo root (see ../../test/AGENTS.md).
//
// The fixture loader, the escape codec, the `ERROR:<code>` contract and
// the row loop all come from the `tabnas-support` crate, whose
// TypeScript and Go halves `ts/test/parity.test.ts` and
// `go/parity_test.go` use to run the SAME files, so the three
// implementations cannot drift without one of them going red, and
// neither can the three loaders.
//
// What is left here is only what is specific to json5: how to build the
// parser for a row's options, and the values JSON cannot spell.

mod common;

use std::fs;

use tabnas_support::{parse_expect, Runner, Value};

use common::{options_from_column, parse_fresh, spec_dir};

/// Fixtures whose column shape the generic runner cannot express. There
/// are none: every file in `test/spec` is `input`, `expected`, `opts`,
/// and `every_fixture_has_the_standard_shape` below holds it that way,
/// so a bespoke-shaped file cannot arrive without being registered here
/// with its own runner and reason.
const BESPOKE_SHAPE: &[(&str, &str)] = &[];

/// The runner every fixture goes through.
fn runner() -> Runner {
    Runner::new_with_row(|input, row| {
        // A fresh parser per row: the `opts` column is per-case, and
        // plugin options must not leak from one row into the next.
        let options = options_from_column(row.named("opts"), &row.location())?;
        parse_fresh(options, input)
    })
    // JSON cannot express JSON5's non-finite numbers or an absent value,
    // so the expected column also accepts these bare tokens. NaN compares
    // equal to itself in the runner's JSON-semantics comparison, which is
    // why they can be plain expected values rather than a special case in
    // the loop. `UNDEFINED` is a different result from `null`, as it is
    // in TypeScript.
    .parse_expected(|expected, _row| match expected {
        "NaN" => Ok(Value::Number(f64::NAN)),
        "Infinity" => Ok(Value::Number(f64::INFINITY)),
        "-Infinity" => Ok(Value::Number(f64::NEG_INFINITY)),
        "UNDEFINED" => Ok(Value::Undefined),
        other => parse_expect(other),
    })
}

/// Every fixture in the spec directory. `dir` discovers the files by
/// listing, so adding a `.tsv` runs it in all three runtimes without
/// touching any runner; an empty fixture, or an empty directory, fails.
#[test]
fn spec() {
    runner().dir(spec_dir());
}

/// The tripwire: a fixture the generic runner cannot read must be listed
/// in `BESPOKE_SHAPE` with the runner that does read it, and a listed
/// exemption whose file has the standard header is stale.
#[test]
fn every_fixture_has_the_standard_shape() {
    let dir = spec_dir();
    let mut files: Vec<String> = fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tsv"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no fixtures in {}", dir.display());

    for name in &files {
        let stem = name.trim_end_matches(".tsv");
        let body =
            fs::read_to_string(dir.join(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
        let header = body.lines().next().unwrap_or_default();
        let standard = header == "input\texpected\topts";
        let exempt = BESPOKE_SHAPE.iter().any(|(file, _)| *file == stem);
        assert!(
            standard || exempt,
            "{name} has the header {header:?}, which the generic runner cannot read; \
             give it a runner and list it in BESPOKE_SHAPE with the reason"
        );
        assert!(
            !(standard && exempt),
            "{name} is listed in BESPOKE_SHAPE but has the standard header; drop the exemption"
        );
    }
    for (file, _) in BESPOKE_SHAPE {
        assert!(
            files
                .iter()
                .any(|name| name.trim_end_matches(".tsv") == *file),
            "BESPOKE_SHAPE names {file}.tsv, which does not exist"
        );
    }
}
