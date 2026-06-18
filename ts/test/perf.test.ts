/* Copyright (c) 2021-2026 Richard Rodger and other contributors, MIT License */

import { describe, test } from 'node:test'
import assert from 'node:assert'

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { Json5 } from '../dist/json5'

// makeJson5 builds a fresh Tabnas instance with the Json5 plugin installed —
// the full per-call setup a hypothetical convenience parse() would do if it
// failed to cache.
function makeJson5() {
  return new Tabnas().use(jsonic).use(Json5)
}

// Guards against the performance pattern where a caller rebuilds the
// (expensive) JSON5 engine + grammar on every parse instead of reusing a
// single configured instance. Installing the Json5 plugin parses the embedded
// grammar, layers many option overrides, and rewrites the val/pair rule
// alternates — that setup dominates a small parse, so building per call is
// dramatically slower than instance reuse.
//
// json5 is a PLUGIN, not a module with a convenience parse(): users build
// their own instance via `new Tabnas().use(jsonic).use(Json5)`. There is
// therefore nothing in the module to cache. This test instead guards the
// representative usage — build ONE instance, reuse it for N parses — and
// proves reuse is overwhelmingly cheaper than rebuilding per call, which is
// exactly the regression a convenience parse() must avoid.
//
// The check is machine-INDEPENDENT: it compares "build per parse" against
// "reuse one instance" on the SAME machine in the SAME run, so a slow CI box
// cannot make it flaky (both sides scale together). There is deliberately NO
// wall-clock budget.
describe('json5 perf', () => {
  test('reusing one instance is far cheaper than rebuilding per parse', () => {
    const src = '{a:1,b:2,c:[1,2,3]}'
    const n = 200

    // Warm both paths so the comparison is steady-state.
    for (let i = 0; i < 50; i++) makeJson5().parse(src)
    const reused = makeJson5()
    for (let i = 0; i < 50; i++) reused.parse(src)

    // Build a fresh instance for every parse (the slow, rebuild-per-call path).
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < n; i++) makeJson5().parse(src)
    const build = Number(process.hrtime.bigint() - t0)

    // Reuse a single instance for every parse (the fast, cached path).
    const t1 = process.hrtime.bigint()
    for (let i = 0; i < n; i++) reused.parse(src)
    const reuse = Number(process.hrtime.bigint() - t1)

    const ratio = build / reuse
    console.log(
      `build-per-parse=${(build / 1e6).toFixed(1)}ms  ` +
        `reuse=${(reuse / 1e6).toFixed(1)}ms  ratio=${ratio.toFixed(2)}x`,
    )

    // Reuse must be much cheaper than rebuilding the plugin per parse. The
    // rebuild path is many times slower here (grammar parse + option layering
    // + rule rewrites per call), so requiring build > 4x reuse catches a
    // regression to per-call construction without any absolute wall-clock
    // assumption.
    assert.ok(
      build > 4 * reuse,
      `reusing a Json5 instance is not meaningfully cheaper than rebuilding ` +
        `it per parse: ${n} reuse parses took ${(reuse / 1e6).toFixed(1)}ms ` +
        `vs ${(build / 1e6).toFixed(1)}ms building per parse ` +
        `(ratio ${ratio.toFixed(1)}x, want >4x). Reuse one configured ` +
        `instance; do not construct new Tabnas().use(jsonic).use(Json5) per parse.`,
    )
  })
})
