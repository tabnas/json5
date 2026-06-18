# How-to guide

Short, task-focused recipes. Each is self-contained and assumes you have
the plugin installed (see the [tutorial](tutorial.md) for the basics).
For the full option table and the API, follow the links into the
[reference](reference.md).

Every recipe builds a parser the same way — engine, jsonic grammar, then
the `Json5` plugin:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
```

## Use it as a plugin

Add `Json5` to a `Tabnas` engine that already has `jsonic` installed.
`.use()` returns the instance, so the calls chain:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

j.parse(`{ a: 1, b: [2, 3,], }`)   // => { a: 1, b: [2, 3] }
```

`jsonic` must come first: it supplies the relaxed-JSON rules that the
JSON5 plugin then constrains and extends. The built instance is
reusable.

## Pass options

The second argument to `.use()` is an options object. It is merged over
the defaults, so you only set the keys you want to change. Here, allow
`#` comments while leaving everything else at JSON5 defaults:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5, { hashComment: true })

j.parse('# a hash comment\n42')   // => 42
```

The full list of flags and their defaults is in the
[options reference](reference.md#options).

## Accept `#` (hash) comments

JSON5 itself has only `//` and `/* */` comments, so `#` is rejected by
default. Set `hashComment: true` to also treat `#` as a line comment:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5, { hashComment: true })

j.parse('# hello\n42')   // => 42
```

## Accept backtick-quoted strings

`` `...` `` strings are not part of JSON5. Enable them with
`backtickString: true`:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5, { backtickString: true })

j.parse('`backtick`')   // => 'backtick'
```

## Accept octal, binary, or `_`-separated numbers

JSON5 numbers are decimal and hex only. The three flags below add the
JavaScript numeric extensions:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5, {
  octal: true,
  binary: true,
  numberSeparator: true,
})

j.parse('0o17')    // => 15
j.parse('0b101')   // => 5
j.parse('1_000')   // => 1000
```

To go the other way and drop hexadecimal, set `hex: false`.

## Accept bare top-level text

By default a bare word is rejected (`foo` is not a JSON5 value). Set
`strictValue: false` to fall back to jsonic's behaviour, where unquoted
text parses as a string:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5, { strictValue: false })

j.parse('foo')   // => 'foo'
```

## Allow empty input

JSON5 requires a top-level value, so by default an empty source throws.
Set `requireValue: false` to let an empty (or whitespace/comment-only)
source resolve to `undefined`:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5, { requireValue: false })

j.parse('')   // => undefined
```

## Handle parse errors

A failed parse throws a `TabnasError`. Catch it and read its structured
fields:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

let info
try {
  j.parse('foo')              // a bare word is not a JSON5 value
} catch (err) {
  info = { code: err.code, line: err.lineNumber, col: err.columnNumber }
}
info   // => { code: 'unexpected', line: 1, col: 1 }
```

`err.message` is a formatted, multi-line report with a source extract and
a caret — show that to a user. The structured fields (`code`,
`lineNumber`, `columnNumber`) are for your code to branch on. An empty
source under the default `requireValue: true` throws with code
`json5_empty`.

## Reproduce strict JSON5

The defaults already are strict JSON5 — you do not have to set anything.
This parses exactly the JSON5 spec and nothing more:

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

// Any valid JSON is valid JSON5:
j.parse('{"a":1,"b":[2,null,true]}')   // => { a: 1, b: [2, null, true] }
```
