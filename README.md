# @tabnas/json5

This plugin configures the [Tabnas](https://github.com/tabnas/parser) JSON parser to parse JSON5 syntax.

This repository contains:

| Path | Description |
|---|---|
| [`ts/`](ts/) | TypeScript / JavaScript implementation. |
| [`go/`](go/) | Go port. |

See [`ts/README.md`](ts/README.md) for usage.

## Grammar

The grammar is defined once in the top-level
[`json5-grammar.jsonic`](json5-grammar.jsonic) and embedded into both the
TypeScript ([`ts/src/json5.ts`](ts/src/json5.ts)) and Go
([`go/json5.go`](go/json5.go)) implementations by
[`ts/embed-grammar.js`](ts/embed-grammar.js), so the two ports stay in sync.

## Grammar diagram

The grammar as a railroad/syntax diagram, generated from the live grammar
with [`@tabnas/railroad`](https://github.com/tabnas/railroad):

![json5 grammar railroad diagram](ts/doc/grammar.svg)

ASCII version: [`ts/doc/grammar.txt`](ts/doc/grammar.txt).

## License

MIT. Copyright (c) Richard Rodger.
