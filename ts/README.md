# @tabnas/json5

A [Jsonic](https://github.com/tabnas/jsonic) syntax plugin that
parses [JSON5](https://json5.org) text into objects, with support for
single- and double-quoted strings, unquoted and single-quoted object
keys, trailing commas, `//` and `/* */` comments, hexadecimal
integers, `Infinity` / `NaN`, leading- and trailing-decimal numbers,
explicit `+` signs, and string line continuations.

Both ports pass the full official
[`json5/json5-tests`](https://github.com/json5/json5-tests) corpus
(114 / 114) and behave identically on every fixture.

Available for [TypeScript](doc/json5-ts.md) and [Go](doc/json5-go.md).


## Quick example

**TypeScript**

```js
import { Tabnas } from '@tabnas/parser'
import { jsonic } from '@tabnas/jsonic'
import { Json5 } from '@tabnas/json5'

const j = new Tabnas().use(jsonic).use(Json5)

const doc = j.parse(`{
  // A JSON5 document
  name: 'Alice',
  balance: +1.5e3,
  limit: Infinity,
  tags: ['admin', 'user',],
}`)

doc // => { name: 'Alice', balance: 1500, limit: Infinity, tags: ['admin', 'user'] }
```

**Go**

```go
import (
    jsonic "github.com/tabnas/jsonic/go"
    json5 "github.com/tabnas/json5/go"
)

j := jsonic.Make()
j.UseDefaults(json5.Json5, json5.Defaults())
v, _ := j.Parse(`{
    name: 'Alice',
    balance: +1.5e3,
    limit: Infinity,
    tags: ['admin', 'user',],
}`)
```


## Documentation

Full documentation following the [Diataxis](https://diataxis.fr)
framework (tutorials, how-to guides, explanation, reference):

- [TypeScript documentation](doc/json5-ts.md)
- [Go documentation](doc/json5-go.md)


## Tutorials

Learn the plugin from scratch with worked examples.

- [Parse a JSON5 document (TypeScript)](doc/json5-ts.md#parse-a-json5-document) | [(Go)](doc/json5-go.md#parse-a-json5-document)
- [Parse JSON5 numbers (TypeScript)](doc/json5-ts.md#parse-json5-numbers) | [(Go)](doc/json5-go.md#parse-json5-numbers)
- [Parse strings with line continuations (TypeScript)](doc/json5-ts.md#parse-strings-with-line-continuations) | [(Go)](doc/json5-go.md#parse-strings-with-line-continuations)


## How-to guides

Solve specific tasks.

- [Accept `#` comments (TypeScript)](doc/json5-ts.md#accept-jsonic-style--comments) | [(Go)](doc/json5-go.md#accept-jsonic-style--comments)
- [Accept backtick strings (TypeScript)](doc/json5-ts.md#accept-backtick-quoted-strings) | [(Go)](doc/json5-go.md#accept-backtick-quoted-strings)
- [Accept octal, binary, or `_`-separated numbers (TypeScript)](doc/json5-ts.md#accept-javascript-style-numeric-extensions) | [(Go)](doc/json5-go.md#accept-javascript-style-numeric-extensions)
- [Accept bare top-level text (TypeScript)](doc/json5-ts.md#accept-bare-top-level-text) | [(Go)](doc/json5-go.md#accept-bare-top-level-text)
- [Allow empty input (TypeScript)](doc/json5-ts.md#allow-empty-input) | [(Go)](doc/json5-go.md#allow-empty-input)


## Explanation

Understand how the plugin works.

- [Why this plugin exists (TypeScript)](doc/json5-ts.md#why-this-plugin-exists) | [(Go)](doc/json5-go.md#why-this-plugin-exists)
- [The shared grammar file (TypeScript)](doc/json5-ts.md#the-shared-grammar-file) | [(Go)](doc/json5-go.md#the-shared-grammar-file)
- [Compliance (TypeScript)](doc/json5-ts.md#compliance) | [(Go)](doc/json5-go.md#compliance)


## Reference

Detailed API and option tables.

- [`Json5` plugin / `Json5Options` / errors (TypeScript)](doc/json5-ts.md#reference)
- [`json5.Json5` / `json5.Defaults` / errors (Go)](doc/json5-go.md#reference)


## License

Copyright (c) 2021-2026 Richard Rodger and other contributors,
[MIT License](LICENSE).

The vendored JSON5 test corpus under `test/json5-tests` is
redistributed under the MIT License from the upstream
[json5/json5-tests](https://github.com/json5/json5-tests) project;
see `test/json5-tests/LICENSE.md` for details.
