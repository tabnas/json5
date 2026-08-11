/* Copyright (c) 2025 Richard Rodger and other contributors, MIT License */

// Cross-runtime conformance, driven by the shared `test/spec/*.tsv` fixtures
// at the repo root (see ../../test/AGENTS.md).
//
// The fixture loader, the escape codec, the `ERROR:<code>` contract and the
// row loop all come from @tabnas/support, whose Go half `go/parity_test.go`
// uses to run the SAME files — so the two implementations cannot drift
// without one of them going red, and neither can the two loaders.
//
// What is left here is only what is specific to json5.

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { findSpecDir, makeRunner, parseExpect } from '@tabnas/support'

import { Json5 } from '../dist/json5'

// JSON cannot express JSON5's non-finite numbers or an absent value, so the
// expected column also accepts these bare tokens. `UNDEFINED` is a
// different result from `null`, and a row that says `null` still must not
// be satisfied by a parse that produced nothing.
const SPECIAL: Record<string, unknown> = {
  'NaN': NaN,
  'Infinity': Infinity,
  '-Infinity': -Infinity,
  'UNDEFINED': undefined,
}

makeRunner({
  // A fresh Tabnas per row: the `opts` column is per-case, and plugin
  // options must not leak from one row into the next.
  parse: (input, row) => {
    const opts = row.named('opts')
    return new Tabnas()
      .use(jsonic)
      .use(Json5, '' === opts.trim() ? {} : JSON.parse(opts))
      .parse(input)
  },

  // NaN compares equal to itself here, which `===` does not — that is the
  // runner's JSON-semantics comparison, and it is why these can be plain
  // expected values rather than a special case in the loop.
  parseExpected: (expected) =>
    expected in SPECIAL ? SPECIAL[expected] : parseExpect(expected),
})
  // `findSpecDir` walks up from this file — `dist-test/` at runtime — to the
  // repo root's `test/spec`, so moving the suite does not mean recounting
  // `..` hops. `dir` then auto-discovers every fixture in it, so adding a
  // .tsv runs it in both runtimes without touching either runner.
  .dir(findSpecDir(__dirname))
