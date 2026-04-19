# @jsonic/json5

A [JSON5](https://json5.org) parser for TypeScript and Go.

- **TypeScript**: a [Jsonic](https://jsonic.senecajs.org) syntax plugin
  that configures Jsonic to parse JSON5.
- **Go**: a standalone, dependency-free JSON5 parser that passes the
  full official [json5/json5-tests](https://github.com/json5/json5-tests)
  corpus.

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

### TypeScript options

All options default to a strict JSON5 configuration.

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


## Go

```go
import json5 "github.com/jsonicjs/json5/go"

v, err := json5.Parse(`{
    // A JSON5 document
    name: 'Alice',
    balance: +1.5e3,
    limit: Infinity,
    tags: ['admin', 'user',],
}`)
```

`Parse` returns:

- objects as `map[string]any`
- arrays as `[]any`
- strings as `string`
- integer literals (including hex) as `int64` when they fit, otherwise `float64`
- floating-point literals as `float64`
- `true` / `false` as `bool`
- `null` as `nil`


## Validation

The official [json5/json5-tests](https://github.com/json5/json5-tests)
corpus is vendored under `test/json5-tests` and executed by both
implementations.

| Implementation | Suite result                                                                  |
| -------------- | ----------------------------------------------------------------------------- |
| Go             | 114 / 114 pass                                                                |
| TypeScript     | 96 / 114 pass; 18 deviations documented in `test/suite.test.ts` (Jsonic is more permissive in those cases) |


## License

Copyright (c) 2021-2026 Richard Rodger and other contributors,
[MIT License](LICENSE).

The vendored JSON5 test corpus under `test/json5-tests` is redistributed
under the MIT License from the upstream
[json5/json5-tests](https://github.com/json5/json5-tests) project; see
`test/json5-tests/LICENSE.md` for details.
