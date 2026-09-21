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

/// Cost grows about LINEARLY with the size of the input.
///
/// This is the other half of the untrusted-input rule (porting playbook
/// section 7): a parser that cannot be made to panic can still be made
/// to sit there. A quadratic rescan is the usual way, and it hides well,
/// because every fixture in the suite is small enough not to notice it.
///
/// Machine-INDEPENDENT, like the guard above: it compares two sizes on
/// the same machine in the same run, so a slow or busy box moves both
/// numbers together. Two details make it robust rather than merely
/// hopeful. The sizes differ by 4, so a quadratic parse would take
/// SIXTEEN times as long where a linear one takes four. And each size is
/// the BEST of three runs, because scheduler noise on a shared box only
/// ever adds time, so the minimum is the closest to the real cost. The
/// bound of 12 sits between the two: a quadratic regression fails it,
/// and a descheduled sample does not.
///
/// Measured while this was written, on a four-core box with other work
/// on it: about 0.11 ms per array element and 0.4 ms per object entry,
/// flat from 5,000 to 80,000 elements.
#[test]
fn cost_grows_about_linearly_with_input_size() {
    const SMALL: usize = 1_000;
    const FACTOR: usize = 4;
    const BOUND: u32 = 12;

    let parser = make();
    let best = |src: &str| {
        (0..3)
            .map(|_| {
                let start = Instant::now();
                parse_with(&parser, src).expect("a well-formed source");
                start.elapsed()
            })
            .min()
            .expect("three runs")
    };

    let array = |n: usize| format!("[{}]", "1,".repeat(n));
    let object = |n: usize| {
        let mut out = String::from("{");
        for index in 0..n {
            out.push_str(&format!("k{index}:1,"));
        }
        out.push('}');
        out
    };

    for (shape, build) in [
        ("array", &array as &dyn Fn(usize) -> String),
        ("object", &object as &dyn Fn(usize) -> String),
    ] {
        let small = best(&build(SMALL));
        let large = best(&build(SMALL * FACTOR));
        assert!(
            large < BOUND * small,
            "{shape} parsing looks super-linear: {} elements took {small:?} and {} took \
             {large:?}, a factor of {:.1} for {FACTOR} times the input (want under {BOUND}). \
             A quadratic rescan would be about {}.",
            SMALL,
            SMALL * FACTOR,
            large.as_secs_f64() / small.as_secs_f64().max(f64::EPSILON),
            FACTOR * FACTOR
        );
        println!("{shape}: {SMALL}={small:?}  {}={large:?}", SMALL * FACTOR);
    }
}
