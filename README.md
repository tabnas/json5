# @jsonic/json5

A [Jsonic](https://jsonic.senecajs.org) syntax plugin that parses
[JSON5](https://json5.org) text. Available for TypeScript and Go; both
ports configure their host Jsonic instance the same way and exhibit
identical behaviour on the official
[json5/json5-tests](https://github.com/json5/json5-tests) corpus.

Features: single- and double-quoted strings, unquoted and single-quoted
object keys, trailing commas, `//` and `/* */` comments, hexadecimal
integers, `Infinity` / `-Infinity` / `NaN`, leading- and trailing-decimal
numbers, explicit `+` sign, and string line continuations.


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
| `requireValue`    | `true`  | Reject an empty input string.                                           |
| `strictValue`     | `true`  | Reject bare unquoted text at the top level (e.g. `foo`).                |
| `hashComment`     | `false` | Accept `#` single-line comments (not part of the JSON5 spec).           |
| `backtickString`  | `false` | Accept backtick-quoted strings (not part of the JSON5 spec).            |
| `numberSeparator` | `false` | Accept `_` digit separators (`1_000`).                                  |
| `octal`           | `false` | Accept octal literals (`0o17`).                                         |
| `binary`          | `false` | Accept binary literals (`0b101`).                                       |


## Validation

Both ports are tested against the official
[json5/json5-tests](https://github.com/json5/json5-tests) corpus
(vendored under `test/json5-tests/`). A shared list of fixtures covering
the edges where the host Jsonic implementations are more permissive or
stricter than the JSON5 spec lives in
[`test/known-deviations.txt`](test/known-deviations.txt); both suites
read from that file and skip the same fixtures, so TS and Go pass the
suite with identical results.


## License

Copyright (c) 2021-2026 Richard Rodger and other contributors,
[MIT License](LICENSE).

The vendored JSON5 test corpus under `test/json5-tests` is redistributed
under the MIT License from the upstream
[json5/json5-tests](https://github.com/json5/json5-tests) project; see
`test/json5-tests/LICENSE.md` for details.
