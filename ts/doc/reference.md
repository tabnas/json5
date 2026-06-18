# Reference

Dry and complete: the public API, every option with its default and
effect, and the syntax the plugin accepts. For worked walk-throughs see
the [tutorial](tutorial.md) and [how-to guide](guide.md); for the design
rationale see [concepts](concepts.md).

## Package

```
npm install @tabnas/parser @tabnas/jsonic @tabnas/json5
```

`@tabnas/json5` is a grammar plugin for the `@tabnas/parser` engine. It
requires `@tabnas/jsonic` (the relaxed-JSON grammar) to be installed on
the same engine first. Both are declared as peer dependencies.

## Exports

The module exports exactly two names:

| Export | Kind | Description |
|---|---|---|
| `Json5` | `Plugin` | The plugin function. Pass it to `engine.use()`. Carries `Json5.defaults` (the default option values). |
| `Json5Options` | type | The TypeScript type of the options object (see [Options](#options)). |

```ts
import { Json5 } from '@tabnas/json5'
import type { Json5Options } from '@tabnas/json5'
```

## Installing the plugin

`Json5` is installed via the engine's `use()` method. It is not a
standalone parse function — there is no `Json5('...')` entry point. The
parse entry point is the engine instance's `.parse(src)`.

### `engine.use(Json5, options?)`

```ts
const j = new Tabnas().use(jsonic).use(Json5, options?)
```

- `jsonic` **must** be applied before `Json5`. It provides the
  relaxed-JSON rule set that `Json5` constrains (e.g. dropping bare text
  from value positions) and extends (e.g. line continuations,
  `Infinity`).
- `options` is an optional partial `Json5Options`; supplied keys are
  merged over `Json5.defaults`.
- `use()` returns the engine instance, so calls chain. The instance is
  reusable across parses.

### `instance.parse(src, meta?)`

Parses `src` (a string) and returns the resulting value, or throws a
`TabnasError` on failure. This is the engine's standard parse method;
the JSON5 plugin only configures how it behaves.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)
j.parse('{a:1}')   // => { a: 1 }
```

Return types are plain JavaScript values: objects → object literals,
arrays → arrays, strings → `string`, numbers → `number` (including
`Infinity` / `-Infinity` / `NaN`), `true`/`false` → `boolean`, `null` →
`null`. Under `requireValue: false` an empty source returns `undefined`.

### `Json5.defaults`

The default option values, exposed as a property on the plugin function.
A strict-JSON5 configuration:

```js
const { Json5 } = require('@tabnas/json5')

Json5.defaults   // => { infinity: true, hex: true, hashComment: false, backtickString: false, numberSeparator: false, octal: false, binary: false, requireValue: true, strictValue: true }
```

## Options

All options are booleans. The defaults configure a strict JSON5 parser
(accept the JSON5 spec, reject everything else). Each `use()` merges the
keys you pass over these defaults.

| Option | Default | Effect when `true` | When `false` |
|---|---|---|---|
| `infinity` | `true` | Accept the `Infinity`, `+Infinity`, `-Infinity`, `NaN`, `+NaN`, `-NaN` keywords as numeric values. | These keywords are rejected (`unexpected`). |
| `hex` | `true` | Accept hexadecimal integers (`0x1F`, `0X1f`, `-0x10`). | Hex literals are rejected. |
| `hashComment` | `false` | Also treat `#` as a line comment (a jsonic extension, not JSON5). | Only `//` and `/* */` comments are recognised; `#` is rejected. |
| `backtickString` | `false` | Also accept `` `...` `` backtick-quoted strings. | Backticks are rejected. |
| `numberSeparator` | `false` | Accept `_` as a digit group separator (`1_000`). | `_` in a number is rejected. |
| `octal` | `false` | Accept `0o`-prefixed octal integers (`0o17`). | Octal literals are rejected. |
| `binary` | `false` | Accept `0b`-prefixed binary integers (`0b101`). | Binary literals are rejected. |
| `requireValue` | `true` | An empty (or whitespace/comment-only) source is an error: a top-level value is required. | An empty source parses to `undefined`. |
| `strictValue` | `true` | Reject bare unquoted text at value positions (`foo` is not a value). | Fall back to jsonic's text rule: bare words parse as strings. |

Note `infinity` and `hex` default to `true` because they are part of the
JSON5 spec. `octal`, `binary`, `numberSeparator`, `hashComment`, and
`backtickString` default to `false` because they are *not* JSON5 — they
are opt-in extensions.

## Accepted syntax

What the default (strict-JSON5) configuration accepts. Inputs below are
real parses; the `=>` shows the returned value.

### Top level

A document is exactly one value. Implicit top-level lists (`1,2,3`) and
maps (`a:1`) are rejected, unlike bare jsonic.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse('42')   // => 42
```

### Objects

Keys may be double-quoted, single-quoted, or unquoted ECMAScript
identifier names (including `$`, `_`, and reserved words like `while`).
Numeric keys (`{10:1}`) are rejected. Trailing commas are allowed.
Duplicate keys take the last value.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse('{a:1, "b":2, \'c\':3,}')   // => { a: 1, b: 2, c: 3 }
j.parse('{$id:1, _n:2, a1:3}')      // => { $id: 1, _n: 2, a1: 3 }
j.parse('{ a: true, a: false }')    // => { a: false }
```

### Arrays

Comma-separated values, trailing comma allowed. No bare-colon children
or named properties inside a list.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse('[1, 2, 3,]')   // => [1, 2, 3]
j.parse('[[1,2],[3,4]]') // => [[1, 2], [3, 4]]
```

### Strings

Single- or double-quoted, with ES5.1 escapes (`\n`, `\t`, `A`,
`\x41`, `\0`, …) plus line continuations: a backslash immediately
followed by a line terminator is removed, so the string spans lines.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse("'hello'")       // => 'hello'
j.parse('"a\\u0041b"')   // => 'aAb'
j.parse('"a\\x41b"')     // => 'aAb'
j.parse('"line1\\\nline2"') // => 'line1line2'
```

### Numbers

Decimal integers and floats, with optional leading `+` or `-`, leading
or trailing decimal point, exponents, and hexadecimal integers. Numbers
with a JS-style leading zero (`010`, `080`) are rejected.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse('+42')        // => 42
j.parse('.5')         // => 0.5
j.parse('5.')         // => 5
j.parse('1.5e-2')     // => 0.015
j.parse('0xDEADBEEF') // => 3735928559
j.parse('0X1f')       // => 31
j.parse('-0x10')      // => -16
```

### Keywords

`true`, `false`, `null`, and (when `infinity` is set) the `Infinity` /
`NaN` family.

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse('true')        // => true
j.parse('null')        // => null
j.parse('+Infinity')   // => Infinity
```

### Comments

`//` line comments and `/* */` block comments, anywhere whitespace is
allowed. (`#` comments require `hashComment: true`.)

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

j.parse('// hi\n42')                  // => 42
j.parse('{ a: 1, /* mid */ b: 2 }')   // => { a: 1, b: 2 }
```

### Whitespace

The JSON5 whitespace set (tab, vertical tab, form feed, space, NBSP,
BOM, and the Unicode `Zs` category) and line-terminator set (LF, CR, LS
U+2028, PS U+2029) are all accepted between tokens.

## Errors

A failed parse throws a `TabnasError` (the engine's error class, exported
by `@tabnas/parser`). Relevant fields:

| Field | Description |
|---|---|
| `code` | Error code string, e.g. `'unexpected'`, `'unterminated_string'`, `'json5_empty'`. |
| `lineNumber` | 1-based line of the error. |
| `columnNumber` | 1-based column of the error. |
| `message` | Formatted multi-line report with a source extract and caret. |

Plugin-specific codes:

| Code | Raised when |
|---|---|
| `json5_empty` | The source is empty and `requireValue` is `true`. |
| `json5_no_value` | The source contains only whitespace/comments and `requireValue` is `true`. |

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')
const j = new Tabnas().use(jsonic).use(Json5)

let code
try { j.parse('foo') } catch (e) { code = e.code }
code   // => 'unexpected'
```

## Grammar

The grammar is authored once in the repository-root
[`json5-grammar.jsonic`](../../json5-grammar.jsonic) and embedded into
this plugin's source. It is a declarative jsonic-format spec that the
plugin parses, patches with option-dependent overrides, and applies to
the engine via `engine.grammar()`. The rule shape (`val`, `map`, `list`,
`pair`, `elem`) is jsonic's; the JSON5 plugin tightens the token sets and
layers on JSON5-specific lexing. See [concepts](concepts.md) for the
model, and the embedded railroad diagram in the
[README](../README.md).
