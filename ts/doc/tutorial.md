# Tutorial — your first JSON5 parse

This walks you from nothing to a working parse with the `@tabnas/json5`
plugin. Follow it in order; each step builds on the last. When you
finish you will have installed the plugin, parsed a real JSON5 document,
and seen how the relaxations (comments, unquoted keys, trailing commas,
`Infinity`) come out.

For a recipe-style index of individual tasks, see the
[how-to guide](guide.md). For exhaustive signatures and the option
table, see the [reference](reference.md). For how it all works, see
[concepts](concepts.md).

## 1. Install

`@tabnas/json5` is a grammar plugin. It runs on the `@tabnas/parser`
engine and layers on top of the `@tabnas/jsonic` relaxed-JSON grammar,
so you install all three:

```bash
npm install @tabnas/parser @tabnas/jsonic @tabnas/json5
```

## 2. Parse a string

Build an engine, add the jsonic grammar, then add the JSON5 plugin. The
result is a configured parser you call with `.parse()`:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

j.parse('{a:1}')   // => { a: 1 }
```

You wrote `{a:1}` — an unquoted key, no spaces — and got back an
object. Ordinary JSON parses too, so `j.parse('{"a":1}')` gives the same
result. The instance is reusable: build it once, call `.parse()` as many
times as you like.

In TypeScript the imports are identical:

```ts
import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { Json5 } from '@tabnas/json5'

const j = new Tabnas().use(jsonic).use(Json5)
```

## 3. Parse a real JSON5 document

JSON5 is JSON with the comfortable parts of JavaScript object literals
added back. Here is a document that uses several of them at once —
comments, an unquoted key, a single-quoted string, a trailing comma:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

const src = `{
  // a JSON5 document
  name: 'Alice',
  tags: ['admin', 'user',],
}`

j.parse(src)   // => { name: 'Alice', tags: ['admin', 'user'] }
```

The `//` comment is dropped, `name` needs no quotes, `'Alice'` may use
single quotes, and the trailing comma after `'user'` is allowed.

## 4. See the JSON5-only values

These are values plain JSON rejects but JSON5 accepts. Each comes back
as a real JavaScript value:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

j.parse('+42')         // => 42
j.parse('.5')          // => 0.5
j.parse('5.')          // => 5
j.parse('0xDEADBEEF')  // => 3735928559
j.parse('Infinity')    // => Infinity
```

A leading `+`, a leading or trailing decimal point, a hexadecimal
integer, and the `Infinity` keyword are all JSON5 numbers. (`NaN`,
`+Infinity`, and `-Infinity` work too.)

## 5. See a rejection

`@tabnas/json5` is JSON5, not anything-goes. A bare top-level word is not
a value, so it throws:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

let threw = false
try { j.parse('foo') } catch (e) { threw = true }
threw   // => true
```

The thrown error is a `TabnasError` carrying a `code` (`'unexpected'`
here), `lineNumber`, `columnNumber`, and a formatted `message` with a
caret under the source. See [handle parse errors](guide.md#handle-parse-errors).

## Where to go next

- [How-to guide](guide.md) — focused recipes (options, errors, JSON5-strictness).
- [Reference](reference.md) — the API, every option, and the accepted syntax.
- [Concepts](concepts.md) — how the plugin builds JSON5 on the engine.
