package tabnasjson5

import (
	"testing"
	"time"

	jsonic "github.com/tabnas/jsonic/go"
)

// makeJSON5 builds a fresh Jsonic instance with the Json5 plugin installed
// using default options — the full per-call setup a hypothetical convenience
// Parse() would do if it failed to cache.
func makeJSON5(t testing.TB) *jsonic.Jsonic {
	t.Helper()
	j := jsonic.Make()
	if err := j.UseDefaults(Json5, Defaults()); err != nil {
		t.Fatalf("UseDefaults: %v", err)
	}
	return j
}

// TestParseReusesInstance guards against the performance pattern where a
// caller rebuilds the (expensive) JSON5 engine + grammar on every parse
// instead of reusing a single configured instance. Installing the Json5
// plugin parses the embedded grammar, layers many option overrides, and
// rewrites the val/pair rule alternates — that setup dominates a small
// parse, so building per call is dramatically slower than instance reuse.
//
// json5 is a PLUGIN, not a package with a convenience Parse(): users build
// their own instance via jsonic.Make() + UseDefaults(Json5, Defaults()).
// There is therefore nothing in the package to cache. This test instead
// guards the representative usage — build ONE instance, reuse it for N
// parses — and proves that reuse is overwhelmingly cheaper than rebuilding
// per call, which is exactly the regression a convenience Parse() must avoid.
//
// The check is machine-INDEPENDENT: it compares "build per parse" against
// "reuse one instance" on the SAME machine in the SAME run, so a slow CI box
// cannot make it flaky (both sides scale together). There is deliberately NO
// wall-clock budget.
func TestParseReusesInstance(t *testing.T) {
	const src = "{a:1,b:2,c:[1,2,3]}"
	const n = 500

	// Warm both paths so the comparison is steady-state.
	for i := 0; i < 50; i++ {
		j := makeJSON5(t)
		if _, err := j.Parse(src); err != nil {
			t.Fatalf("warm build-per-parse error: %v", err)
		}
	}
	reused := makeJSON5(t)
	for i := 0; i < 50; i++ {
		if _, err := reused.Parse(src); err != nil {
			t.Fatalf("warm reuse parse error: %v", err)
		}
	}

	// Build a fresh instance for every parse (the slow, rebuild-per-call path).
	t0 := time.Now()
	for i := 0; i < n; i++ {
		j := makeJSON5(t)
		if _, err := j.Parse(src); err != nil {
			t.Fatalf("build-per-parse error: %v", err)
		}
	}
	build := time.Since(t0)

	// Reuse a single instance for every parse (the fast, cached path).
	t1 := time.Now()
	for i := 0; i < n; i++ {
		if _, err := reused.Parse(src); err != nil {
			t.Fatalf("reuse parse error: %v", err)
		}
	}
	reuse := time.Since(t1)

	// Reuse must be much cheaper than rebuilding the plugin per parse. The
	// rebuild path is many times slower here (grammar parse + option layering
	// + rule rewrites per call), so requiring reuse < build/4 catches a
	// regression to per-call construction without any absolute wall-clock
	// assumption. (Equivalently: build > 4x reuse.)
	if build < 4*reuse {
		t.Errorf("reusing a Json5 instance is not meaningfully cheaper than "+
			"rebuilding it per parse: %d reuse parses took %v vs %v building "+
			"per parse (ratio %.1fx, want >4x). Reuse one configured instance; "+
			"do not call jsonic.Make()+UseDefaults per parse.",
			n, reuse, build, float64(build)/float64(reuse))
	}
	t.Logf("build-per-parse=%v  reuse=%v  ratio=%.2fx", build, reuse, float64(build)/float64(reuse))
}
