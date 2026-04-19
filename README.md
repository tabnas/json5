# @jsonic/json5

A [Jsonic](https://jsonic.senecajs.org) syntax plugin that parses
[JSON5](https://json5.org) text. Available for TypeScript and Go; both
ports configure their host Jsonic the same way and pass the full
official [json5/json5-tests](https://github.com/json5/json5-tests)
corpus — **114/114** on each side.

Features: single- and double-quoted strings, unquoted and single-quoted
object keys, trailing commas, `//` and `/* */` comments, hexadecimal
integers, `Infinity` / `-Infinity` / `NaN`, leading- and trailing-decimal
numbers, explicit `+` sign, and string line continuations (including
across a CRLF).


## TypeScript

```typescript
import { Jsonic } from 'jsonic'
import { Json5 } from '@jsonic/json5'

const parse = Jsonic.make().use(Json5)

parse(`{
  // A JSON5 document
  name: 'Alice',
  age: 30,
  balance: +1.5e3,
  limit: Infinity,
  tags: ['admin', 'user',],
  "legacy-key": null,
}`)
```


## Go

```go
import (
    jsonic "github.com/jsonicjs/jsonic/go"
    json5 "github.com/jsonicjs/json5/go"
)

j := jsonic.Make()
if err := j.UseDefaults(json5.Json5, json5.Defaults()); err != nil {
    return err
}
v, err := j.Parse(`{
    // A JSON5 document
    name: 'Alice',
    balance: +1.5e3,
    limit: Infinity,
    tags: ['admin', 'user',],
}`)
```

`Parse` returns objects as `map[string]any`, arrays as `[]any`,
numbers as `float64`, strings as `string`, booleans as `bool`, and
`null` as `nil`.


## Options

All options default to a strict JSON5 configuration. The TS plugin takes
them as an object; the Go plugin takes them as a `map[string]any`.

| Option            | Default | Description                                                             |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `infinity`        | `true`  | Accept `Infinity`, `-Infinity`, `+Infinity`, `NaN`, `-NaN`, `+NaN`.     |
| `hex`             | `true`  | Accept hexadecimal literals (`0x1F`).                                   |
| `requireValue`    | `true`  | Reject an empty input string (or comments-only input).                  |
| `strictValue`     | `true`  | Reject bare unquoted text at the top level (e.g. `foo`).                |
| `hashComment`     | `false` | Accept `#` single-line comments (not part of the JSON5 spec).           |
| `backtickString`  | `false` | Accept backtick-quoted strings (not part of the JSON5 spec).            |
| `numberSeparator` | `false` | Accept `_` digit separators (`1_000`).                                  |
| `octal`           | `false` | Accept octal literals (`0o17`).                                         |
| `binary`          | `false` | Accept binary literals (`0b101`).                                       |


## Implementation strategy

Both ports use their host Jsonic's plugin APIs only — no Jsonic
internals are patched. Specifically:

- **Tokens and options**: comments, strings, numbers, value keywords,
  whitespace, and line-terminator sets are configured via the standard
  options (`space.chars`, `line.chars`, `string.escape`, `number.hex`,
  `comment.def`, `value.def`, …).
- **Regex `value.def` entries** catch number shapes the built-in
  number lexer misses — trailing-decimal-with-exponent (`5.e4`) and
  uppercase `0X` hex.
- **`number.exclude`** rejects JS-style leading-zero literals (`010`,
  `-098`, …).
- **`tokenSet`** overrides remove `#TX` from `VAL` (reject bare text
  values) and `#NR` from `KEY` (reject numeric keys).
- **Rule-level adjustments** drop the `#ZZ jsonic` empty-parse alt from
  `val` when `requireValue` is set, drop the leading-comma alt from
  `pair` (so `{,}` fails), and install an after-open validator on
  `pair` that rejects #TX keys that are not valid ECMAScript 5.1
  IdentifierNames (so `multi-word` and `foo!bar` fail).
- **`text.check`** lets non-identifier value keywords like `-Infinity`
  and regex-matched number shapes like `5.e4` and `0X1F` through while
  rejecting everything else that wouldn't make a valid identifier start.
- **`fixed.check`** preprocesses the source once at parse start,
  rewriting `\<CR><LF>` to `\<LF>` inside the lexer so JSON5 string
  line-continuations that span a CRLF work end-to-end.


## License

Copyright (c) 2021-2026 Richard Rodger and other contributors,
[MIT License](LICENSE).

The vendored JSON5 test corpus under `test/json5-tests` is redistributed
under the MIT License from the upstream
[json5/json5-tests](https://github.com/json5/json5-tests) project; see
`test/json5-tests/LICENSE.md` for details.
