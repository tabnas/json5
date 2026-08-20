/* Copyright (c) 2026 Richard Rodger and other contributors, MIT License */

// Audit P1/P2, pinned at the code the shared fixture cannot pin.
//
// A quote used to end a Go text run and did not end a TypeScript one, so
// `{a:b"c}` was `unterminated_string` there and `unexpected` here. tabnas
// parser#128 moved Go. `test/divergent.tsv` carried the disagreement until
// the repair landed and the rows went red; the inputs now live in
// `test/spec/strings.tsv` so both suites keep executing them.
//
// They are there as a bare `ERROR`, because that fixture is shared and must
// hold against the engine the Go module DECLARES as well as the sibling
// checkouts CI links — and parser#128 is not yet in a parser release.
//
// `go/text_ender_test.go` is the twin, and it has to read the linked engine
// and report which behaviour it saw. This half does not: TypeScript never
// had the defect, so `unexpected` is what every published version of the
// engine produces, and asserting it outright is honest.

import { test, describe } from 'node:test'
import { equal, fail } from 'node:assert/strict'

import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'

import { Json5 } from '../dist/json5'


// The three P1/P2 rows: a quote inside a text run, a quote after a value,
// and a quote inside a bare top-level text run.
const INPUTS = ['{a:b"c}', '{a:1"}', 'a"b']


// The error code one input produces. A parse that SUCCEEDS is a failure:
// every one of these is invalid JSON5 under either reading of the quote.
function errorCode(src: string): string {
  const j5 = new Tabnas().use(jsonic).use(Json5)
  try {
    const value = j5.parse(src)
    fail(`${JSON.stringify(src)} was accepted, producing ` +
      `${JSON.stringify(value)}; it is invalid JSON5 whether or not a ` +
      `quote ends a text run`)
  } catch (err: any) {
    if (null == err.code) throw err
    return err.code
  }
}


describe('text-ender', () => {

  // `unexpected` is the repaired reading: the quote is an ordinary
  // character in a text run, the run is not a string, and the parse fails
  // on the token it really is. `unterminated_string` would mean the quote
  // had started a string — the defect parser#128 removed from Go, and one
  // this port must never acquire.
  for (const src of INPUTS) {
    test(`a quote does not end a text run: ${src}`, () => {
      equal(errorCode(src), 'unexpected')
    })
  }

})
