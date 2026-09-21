// Performance regression guard. Mirrors `ts/test/perf.test.ts` and
// `go/perf_test.go`.
//
// Installing the plugin parses the embedded grammar with a jsonic
// instance, layers the option overrides and rewrites the val / pair
// alternates; that setup dominates a small parse, so building per call is
// dramatically slower than instance reuse. This guards the usage the docs
// recommend, build ONE instance and reuse it, which is also what the
// optionless `parse` does with its shared default.
//
// The check is machine-INDEPENDENT: it compares "build per parse" against
// "reuse one instance" on the SAME machine in the SAME run, so a slow CI
// box cannot make it flaky (both sides scale together). There is
// deliberately NO wall-clock budget.

use std::time::Instant;

use tabnas_json5::{make, parse_with};

const SRC: &str = "{a:1,b:2,c:[1,2,3]}";

/// Smaller than the 500 the Go test uses: `cargo test` runs the
/// unoptimised profile, where every rebuild re-parses the grammar text.
/// The guard is a ratio measured on one machine in one run, so the count
/// only has to be large enough to average out scheduler noise.
const N: u32 = 100;

#[test]
fn parse_reuses_instance() {
    // Warm both paths so the comparison is steady-state.
    for _ in 0..10 {
        let parser = make();
        parse_with(&parser, SRC).expect("warm build-per-parse");
    }
    let reused = make();
    for _ in 0..50 {
        parse_with(&reused, SRC).expect("warm reuse parse");
    }

    // Build a fresh instance for every parse (the slow, rebuild-per-call path).
    let start = Instant::now();
    for _ in 0..N {
        let parser = make();
        parse_with(&parser, SRC).expect("build-per-parse");
    }
    let build = start.elapsed();

    // Reuse a single instance for every parse (the fast, cached path).
    let start = Instant::now();
    for _ in 0..N {
        parse_with(&reused, SRC).expect("reuse parse");
    }
    let reuse = start.elapsed();

    // Reuse must be much cheaper than rebuilding the plugin per parse.
    // Requiring build > 4x reuse catches a regression to per-call
    // construction without any absolute wall-clock assumption.
    assert!(
        build > 4 * reuse,
        "reusing a json5 instance is not meaningfully cheaper than rebuilding it per parse: \
         {N} reuse parses took {reuse:?} vs {build:?} building per parse (want >4x). Reuse one \
         configured instance; do not call make() per parse."
    );
    println!(
        "build-per-parse={build:?}  reuse={reuse:?}  ratio={:.2}x",
        build.as_secs_f64() / reuse.as_secs_f64().max(f64::EPSILON)
    );
}
