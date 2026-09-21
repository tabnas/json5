// The divergence register: where this repo's ports DISAGREE, executed.
//
// `ts/test/divergent.test.ts` and `go/divergent_test.go` run the SAME
// file and read their own columns; this runner reads `rust`.
//
// WHY THIS IS NOT A FIXTURE. A fixture fails when behaviour REGRESSES.
// This fails BOTH ways: when a port is repaired to agree with another,
// the row still claims they differ, so the suite goes red and names the
// row to delete. A divergence recorded as a passing test of current
// behaviour survives its own repair, and the record then describes
// something that no longer happens, with nothing red. That is how the
// 2026-08 fleet audit found 29 recorded claims contradicted by execution.
//
// The runner is LOCAL, as the TypeScript and Go ones are, and for one
// more reason here: the register's only live rows record a POSITION
// disagreement under one code, and `tabnas_support::Register` compares
// error cells by code alone, so it would refuse every row as recording
// no divergence. The row vocabulary is the one that crate standardises,
// `@<row>:<col>` included, so once its register compares positions this
// file collapses to a `Register::new(runner, "rust", &["go", "ts",
// "rust"])` call and the fixture stays untouched.

mod common;

use tabnas_json5::make;
use tabnas_support::{equal_value, is_error_expect, load_spec, parse_expect, SpecOptions};

use common::{outcome, spec_dir};

/// This runtime's column, and the others.
const RUNTIME: &str = "rust";
const OTHERS: [&str; 2] = ["ts", "go"];

/// `ERROR:unexpected@1:8` as ("unexpected", "1:8"); `ERROR:unexpected`
/// as ("unexpected", ""). Parsed from the raw cell: the cell format is
/// this repo's own contract, so this repo reads it.
fn split_cell(cell: &str) -> (&str, &str) {
    let code = cell.strip_prefix("ERROR:").unwrap_or(cell);
    let Some(at) = code.rfind('@') else {
        return (code, "");
    };
    let position = &code[at + 1..];
    let (row, col) = match position.split_once(':') {
        Some(parts) => parts,
        None => return (code, ""),
    };
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    if digits(row) && digits(col) {
        (&code[..at], position)
    } else {
        (code, "")
    }
}

/// Do two cells MEAN the same thing? Compared by meaning, not bytes: `1`
/// and `1.0` are one expectation, and a row whose columns differ only
/// that way records no divergence at all.
fn same_expectation(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    if is_error_expect(a) || is_error_expect(b) {
        if !is_error_expect(a) || !is_error_expect(b) {
            return false;
        }
        let (code_a, pos_a) = split_cell(a);
        let (code_b, pos_b) = split_cell(b);
        if code_a != code_b {
            return false;
        }
        // POSITION IS OPT-IN. A cell that pins no position is satisfied
        // by any position; one that does is compared on both.
        return pos_a.is_empty() || pos_b.is_empty() || pos_a == pos_b;
    }
    match (parse_expect(a), parse_expect(b)) {
        (Ok(value_a), Ok(value_b)) => equal_value(&value_a, &value_b),
        _ => false,
    }
}

#[test]
fn divergence_register() {
    let path = spec_dir().join("..").join("divergent.tsv");
    let spec = load_spec(&path, &SpecOptions::default()).unwrap_or_else(|error| panic!("{error}"));

    // An EMPTY register is legitimate, a repo with no divergences, but an
    // empty FILE is not: it cannot be told apart from a loader that read
    // nothing.
    assert!(!spec.rows.is_empty(), "{} has no rows", path.display());

    let parser = make();
    let mut failures = Vec::new();
    for row in &spec.rows {
        let at = row.location();
        let input = row.unesc_named("input");
        for column in [RUNTIME, "ts", "go", "why"] {
            assert!(
                row.index_of(column).is_some(),
                "{at}: no column named {column:?}"
            );
        }
        let mine = row.named(RUNTIME);
        let theirs: Vec<(&str, &str)> =
            OTHERS.iter().map(|name| (*name, row.named(name))).collect();

        // 1. Does this row record a divergence at all? Columns all saying
        //    the same thing assert nothing and would pass forever, which
        //    is the shape of the prose claims this replaces.
        if theirs.iter().all(|(_, cell)| same_expectation(mine, cell)) {
            failures.push(format!(
                "{at}: every runtime column means {mine:?}, so this row records no divergence \
                 and can never fail meaningfully. Delete it, or correct the cells to what the \
                 ports actually do."
            ));
            continue;
        }

        let got = outcome(&parser, &input);
        if same_expectation(&got, mine) {
            continue;
        }

        // 2. It changed. Did it change INTO another port's answer? Then
        //    the divergence is closed, and reporting a regression would
        //    send the reader to exactly the wrong conclusion.
        let converged: Vec<&(&str, &str)> = theirs
            .iter()
            .filter(|(_, cell)| same_expectation(&got, cell))
            .collect();
        if converged.len() == theirs.len() {
            failures.push(format!(
                "{at}: this divergence is CLOSED. {RUNTIME} now produces what the other \
                 columns record ({}), not its own ({mine}).\n  A fixed divergence fails as \
                 loudly as a regressed one, so the row cannot outlive it.\n  DELETE this row, \
                 and if the repair landed in the engine, check whether the other rows citing \
                 {} go with it.",
                converged[0].1,
                row.named("why").trim()
            ));
        } else if !converged.is_empty() {
            let names: Vec<&str> = converged.iter().map(|(name, _)| *name).collect();
            failures.push(format!(
                "{at}: this divergence is PARTIALLY closed. {RUNTIME} now agrees with {} but \
                 not with every other column.\n  Do NOT delete this row; UPDATE the {RUNTIME} \
                 column to what it now produces ({got}) instead of {mine:?}.",
                names.join(", ")
            ));
        } else {
            // 3. Neither. An ordinary regression.
            failures.push(format!(
                "{at}: {RUNTIME} changed, and not into another port's answer either; this is \
                 a regression, not a closed divergence.\n  got:      {got}\n  expected: {mine}"
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// The cell reader this register depends on: a position is split off
/// only when it is a well-formed `@<row>:<col>` suffix.
#[test]
fn cells_split_into_code_and_position() {
    assert_eq!(split_cell("ERROR:unexpected@1:8"), ("unexpected", "1:8"));
    assert_eq!(split_cell("ERROR:unexpected"), ("unexpected", ""));
    assert_eq!(split_cell("ERROR:a@b"), ("a@b", ""));
    assert!(same_expectation("ERROR:unexpected", "ERROR:unexpected@1:8"));
    assert!(!same_expectation(
        "ERROR:unexpected@1:7",
        "ERROR:unexpected@1:8"
    ));
    assert!(same_expectation("1", "1.0"));
    assert!(!same_expectation("1", "ERROR:unexpected"));
}
