# @jsonic/json5

A [Jsonic](https://jsonic.senecajs.org) syntax plugin that parses
[JSON5](https://json5.org) text. Supports single- and double-quoted
strings, unquoted and single-quoted object keys, trailing commas,
single-line (`//`) and block (`/* */`) comments, hexadecimal integers,
`Infinity` / `-Infinity` / `NaN`, leading- and trailing-decimal numbers,
and explicit `+` sign on numbers.


## Quick example

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
// {
//   name: 'Alice', age: 30, balance: 1500, limit: Infinity,
//   tags: ['admin', 'user'], 'legacy-key': null,
// }
```

Any valid JSON document is also a valid JSON5 document, so this plugin
happily parses plain JSON as well.


## Options

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


## License

Copyright (c) 2021-2026 Richard Rodger and other contributors,
[MIT License](LICENSE).
