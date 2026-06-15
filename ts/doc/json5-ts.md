# JSON5 plugin for Jsonic (TypeScript)

A Jsonic syntax plugin that configures a parser to accept
[JSON5](https://json5.org) syntax: single- and double-quoted strings,
unquoted and single-quoted object keys, trailing commas, `//` and
`/* */` comments, hexadecimal integers, `Infinity` / `NaN`, leading-
and trailing-decimal numbers, explicit `+` signs, and string line
continuations.

```bash
npm install @tabnas/json5
```

Requires `jsonic` >= 2 as a peer dependency.


## Tutorials

### Parse a JSON5 document

Install the plugin on a Jsonic instance, then call it like any
Jsonic parser — the return value is the decoded JavaScript value.

```js
import { Jsonic } from '@tabnas/jsonic'
import { Json5 } from '@tabnas/json5'

const j = Jsonic.make().use(Json5)

const doc = j(`{
  // A JSON5 document
  name: 'Alice',
  age: 30,
  tags: ['admin', 'user',],
  "legacy-key": null,
}`)

doc // => { name: 'Alice', age: 30, tags: ['admin', 'user'], 'legacy-key': null }
```

### Parse JSON5 numbers

Everything the spec admits round-trips to `number`, including
`Infinity`, `NaN`, hexadecimal literals, leading- and
trailing-decimal-point forms, and explicit `+` signs.

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5)

j('0x1F')        // => 31
j('.5')          // => 0.5
j('5.')          // => 5
j('+1e10')       // => 10000000000
j('-Infinity')   // => -Infinity
j('NaN')         // => NaN
```

### Parse strings with line continuations

A backslash immediately before a line terminator (`LF`, `CR`, `CRLF`,
`LS`, or `PS`) is stripped from the string, leaving the line
terminator in place — so the string continues on the next line.

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5)

j("'line1 \\\nline2'")
// => 'line1 \nline2'
```


## How-to guides

### Accept Jsonic-style `#` comments

Standard JSON5 forbids `#` comments. Enable them for compatibility
with ad-hoc config files:

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5, { hashComment: true })

j('# comment\n42')   // => 42
```

### Accept backtick-quoted strings

Not part of the JSON5 spec, but occasionally useful when consuming
template-literal-like source:

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5, { backtickString: true })

j('`hello`')   // => 'hello'
```

### Accept JavaScript-style numeric extensions

Octal literals (`0o17`), binary literals (`0b101`), and `_` digit
separators (`1_000`) are rejected by default. Enable them
individually:

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5, {
  octal: true,
  binary: true,
  numberSeparator: true,
})

j('0o17')    // => 15
j('0b101')   // => 5
j('1_000')   // => 1000
```

### Accept bare top-level text

With `strictValue: true` (the default), unquoted text at a value
position is rejected (JSON5 requires a typed value). Disable for
loose input:

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5, { strictValue: false })

j('foo')   // => 'foo'
```

### Allow empty input

By default, an empty or comments-only source raises an error.
Return a no-value result instead — an empty source yields `null`,
a comments-only source yields `undefined`:

```js
const { Jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = Jsonic.make().use(Json5, { requireValue: false })

j('')           // => null
j('// only\n')  // => undefined
```


## Explanation

### Why this plugin exists

Jsonic is a relaxed JSON superset: out of the box it already accepts
most JSON5 features (unquoted keys, single quotes, trailing commas,
comments). But Jsonic also accepts things JSON5 forbids — implicit
top-level lists and maps (`a,b,c`, `a:1`), leading-zero numbers
(`010`), non-identifier unquoted keys (`multi-word`), `#` comments,
and backtick-quoted strings. And it's missing a few pieces JSON5
requires — `Infinity` / `NaN` as values, backslash+CRLF line
continuations, and Unicode-category-Zs whitespace.

The plugin configures Jsonic to accept exactly JSON5. Everything it
does is done through Jsonic's standard plugin surface: token sets,
`value.def` entries (including regex ones for the cases Jsonic's
number lexer misses), `LexCheck` hooks on the fixed and text
matchers, rule-level alt filters, and option overrides for
whitespace / line-terminator character sets and `number.exclude`.

### The shared grammar file

Both the TypeScript and Go ports consume the same declarative
grammar — [`json5-grammar.jsonic`](../json5-grammar.jsonic). It
captures the strict-JSON5 baseline: token sets, comment definitions,
string escapes, the `number.exclude` regex, regex-based `value.def`
entries for `5.e4` and `0X…` literals, and error / hint messages.

At build time, `embed-grammar.js` copies the grammar into both
`src/json5.ts` and `go/json5.go` so neither runtime reads from disk.
The plugin parses the embedded text with a standard Jsonic instance,
patches in the character-set placeholders and option-dependent
overrides (hash comment on / off, number-feature flags,
Infinity / NaN value entries), attaches the ref map, and calls
`jsonic.grammar(grammarDef)`.

### Compliance

Both ports pass the full official
[`json5/json5-tests`](https://github.com/json5/json5-tests) corpus
(114 / 114) and behave identically on every fixture.


## Reference

### `Json5` (Plugin)

```typescript
import { Json5 } from '@tabnas/json5'

Jsonic.make().use(Json5, options?)
```

Installs the JSON5 plugin. Pass an `options` object to override any
of the fields on `Json5Options`.


### `Json5Options`

All options default to a strict JSON5 configuration.

| Option            | Type      | Default | Description                                                                              |
| ----------------- | --------- | ------- | ---------------------------------------------------------------------------------------- |
| `infinity`        | `boolean` | `true`  | Accept `Infinity`, `-Infinity`, `+Infinity`, `NaN`, `-NaN`, `+NaN` as numeric literals.  |
| `hex`             | `boolean` | `true`  | Accept hexadecimal literals (`0x1F`, `0X1F`).                                            |
| `requireValue`    | `boolean` | `true`  | Reject empty input and sources that contain only whitespace and comments.                |
| `strictValue`     | `boolean` | `true`  | Reject bare unquoted text at the top level (e.g. `foo`).                                 |
| `hashComment`     | `boolean` | `false` | Accept `#` single-line comments (not part of the JSON5 spec).                            |
| `backtickString`  | `boolean` | `false` | Accept backtick-quoted strings (not part of the JSON5 spec).                             |
| `numberSeparator` | `boolean` | `false` | Accept `_` digit separators (`1_000`).                                                   |
| `octal`           | `boolean` | `false` | Accept octal literals (`0o17`).                                                          |
| `binary`          | `boolean` | `false` | Accept binary literals (`0b101`).                                                        |


### Errors

Parsing raises a `JsonicError` (re-exported from `jsonic`). Codes
specific to this plugin:

| Code              | Raised when                                                     |
| ----------------- | --------------------------------------------------------------- |
| `json5_empty`     | The input is an empty string and `requireValue` is `true`.      |
| `json5_no_value`  | The input contains only whitespace / comments.                  |

Everything else — unterminated strings, unexpected characters,
invalid escape sequences, malformed numbers — is reported via the
host Jsonic error codes (`unterminated_string`, `unexpected`,
`invalid_unicode`, `invalid_ascii`, `unprintable`).
