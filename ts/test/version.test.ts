/* Copyright (c) 2026 Richard Rodger, MIT License */

// The exported VERSION must equal package.json "version".
//
// This is the CI check for version drift. It exists because the constant HAS
// drifted: @tabnas/json exported Version = '1.0.0' for several releases while
// the package shipped 0.4.x, because nothing rewrote it and AGENTS.md wrongly
// claimed `make publish-go` kept it in sync. A release that bumps
// package.json and forgets the constant now fails here.
//
// The package ROOT is required (not ../dist/json5) because that is what a
// consumer gets: the check must fail if VERSION stops being reachable from
// the published entry point.

import { describe, test } from 'node:test'
import assert from 'node:assert'
import { createRequire } from 'node:module'

const req = createRequire(__filename)

// Deliberately unguarded: if package.json cannot be read this THROWS and the
// test file fails. A version check that silently does not run is the exact
// failure mode being designed out.
const pkg = req('../package.json')
const api = req('..')

describe('version', () => {
  test('VERSION matches package.json', () => {
    assert.equal(
      api.VERSION,
      pkg.version,
      `VERSION drift: ${pkg.name} exports ${api.VERSION} but package.json is ` +
        `${pkg.version}. Both are rewritten by admin/publish.sh at release; ` +
        `if you bumped one by hand, bump the other.`,
    )
  })

  test('VERSION is exported and looks like a semver', () => {
    assert.equal(
      typeof api.VERSION,
      'string',
      'VERSION must be exported as a string',
    )
    assert.match(api.VERSION, /^\d+\.\d+\.\d+/, 'VERSION must be a semver')
  })
})
