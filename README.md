# @tabnas/json5

A [Tabnas](https://github.com/tabnas/parser) /
[Jsonic](https://github.com/tabnas/jsonic) grammar plugin that parses
[JSON5](https://json5.org) — JSON plus comments, unquoted keys, trailing
commas, single quotes, hex / `Infinity` / `NaN` numbers, leading- and
trailing-decimal numbers, explicit `+` signs, and string line
continuations.

Both ports share one grammar file and pass the full official
[`json5/json5-tests`](https://github.com/json5/json5-tests) corpus.

## Install

```bash
# TypeScript / JavaScript
npm install @tabnas/parser @tabnas/jsonic @tabnas/json5

# Go
go get github.com/tabnas/json5/go@latest
```

## Example

**TypeScript**

```js
const { Tabnas } = require('@tabnas/parser')
const { jsonic } = require('@tabnas/jsonic')
const { Json5 } = require('@tabnas/json5')

const j = new Tabnas().use(jsonic).use(Json5)

j.parse('{ a: 1, b: [2, 3,], }')   // => { a: 1, b: [2, 3] }
```

**Go**

```go
import (
	jsonic "github.com/tabnas/jsonic/go"
	json5 "github.com/tabnas/json5/go"
)

j := jsonic.Make()
j.UseDefaults(json5.Json5, json5.Defaults())
v, _ := j.Parse(`{ a: 1, b: [2, 3,], }`)
// v: map[string]any{"a": 1.0, "b": []any{2.0, 3.0}}
```

## Documentation

Full documentation follows the [Diátaxis](https://diataxis.fr) framework
— a tutorial to learn from, how-to recipes, a complete reference, and the
concepts behind it.

**TypeScript** — [`ts/doc/`](ts/doc/)

- [Tutorial](ts/doc/tutorial.md) · [How-to guide](ts/doc/guide.md) · [Reference](ts/doc/reference.md) · [Concepts](ts/doc/concepts.md)

**Go** — [`go/doc/`](go/doc/)

- [Tutorial](go/doc/tutorial.md) · [How-to guide](go/doc/guide.md) · [Reference](go/doc/reference.md) · [Concepts](go/doc/concepts.md)

## Grammar

The grammar is defined once in the top-level
[`json5-grammar.jsonic`](json5-grammar.jsonic) and embedded into both the
TypeScript ([`ts/src/json5.ts`](ts/src/json5.ts)) and Go
([`go/json5.go`](go/json5.go)) implementations by
[`ts/embed-grammar.js`](ts/embed-grammar.js), so the two ports stay in
sync.

As a railroad/syntax diagram, generated from the live grammar with
[`@tabnas/railroad`](https://github.com/tabnas/railroad):

![json5 grammar railroad diagram](ts/doc/grammar.svg)

An ASCII version is in [`ts/doc/grammar.txt`](ts/doc/grammar.txt).

## License

MIT. Copyright (c) 2021-2026 Richard Rodger and other contributors;
see [LICENSE](LICENSE).

The vendored JSON5 test corpus under `test/json5-tests` is redistributed
under the MIT License from the upstream
[json5/json5-tests](https://github.com/json5/json5-tests) project; see
`test/json5-tests/LICENSE.md`.
