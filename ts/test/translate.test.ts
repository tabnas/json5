/* Copyright (c) 2021-2026 Richard Rodger, MIT License */

import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { test } from 'node:test'

const { translate } = require('../dist/json5')

const root = path.resolve(__dirname, '..', '..')

test('translation parts expose the manifest, source and explicit entry', () => {
  const parts = translate()
  assert.ok(parts)
  assert.equal(parts.manifest, readFileSync(path.join(root, 'tabnas.plugin.json'), 'utf8'))
  assert.equal(parts.lift, undefined)
  assert.equal(parts.render?.entry, 'json5-render')
  assert.equal(
    parts.render?.source,
    readFileSync(path.join(root, 'alchemy', 'render.alc'), 'utf8'))
})

// An embed takes a plain tree into a format's own schema. JSON5's events
// carry a plain tree, so its manifest names none and the package carries
// none; a manifest that named one would be held to its file here, as the
// render is above.
test('translation parts carry the embed the manifest names, and none where it names none', () => {
  const parts = translate()
  const spec = JSON.parse(readFileSync(path.join(root, 'tabnas.plugin.json'), 'utf8')).translate
  if (null == spec.embed) {
    assert.equal(parts.embed, undefined)
  } else {
    assert.equal(parts.embed?.entry, 'json5-embed')
    assert.equal(parts.embed?.source, readFileSync(path.join(root, spec.embed), 'utf8'))
  }
})

// A transducer makes the format's JSON events of its parser's rule passes.
// JSON5's is alchemy/transduce.alc, which the manifest names and the
// package embeds under the entry json5-transduce: the copy is held to the
// file.
test('translation parts carry the transducer the manifest names', () => {
  const parts = translate()
  const spec = JSON.parse(readFileSync(path.join(root, 'tabnas.plugin.json'), 'utf8')).translate
  assert.equal(spec.transduce, 'alchemy/transduce.alc')
  const source = readFileSync(path.join(root, spec.transduce), 'utf8')
  assert.ok(source.includes('def json5-transduce [input]'))
  assert.equal(parts.transduce?.entry, 'json5-transduce')
  assert.equal(parts.transduce?.source, source)
})
