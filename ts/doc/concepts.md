# Concepts

Background on how `@tabnas/json5` is put together, and why. This is
understanding-oriented reading — for steps see the
[tutorial](tutorial.md) and [how-to guide](guide.md), and for exact
signatures and options see the [reference](reference.md).

## JSON5 is a grammar on an engine

The plugin is not a parser. It is a *configuration* of one. Three layers
stack up:

- the **engine** — `@tabnas/parser` — a rule-based parser over a
  configurable, matcher-based lexer. It knows nothing about JSON;
- the **relaxed-JSON grammar** — `@tabnas/jsonic` — the rules that turn
  `a:1,b:2` into an object, comments, trailing commas, and so on;
- the **JSON5 plugin** — this package — which constrains and extends the
  jsonic grammar so that what is accepted is exactly JSON5.

That is why the install order is `new Tabnas().use(jsonic).use(Json5)`:
each `use()` adds a layer, and `Json5` is meaningless without the jsonic
rules underneath it to modify.

The payoff is that JSON5 ends up being mostly *data*. The bulk of the
plugin is a declarative grammar spec; the imperative code is a thin
layer that patches a few things the spec cannot express.

## The shared grammar file

The grammar lives once in the repository-root `json5-grammar.jsonic`. A
build step (`embed-grammar.js`) inlines it verbatim into both
`ts/src/json5.ts` and `go/json5.go` between marker comments, so the two
language ports parse the *same* spec and cannot drift. The file is
itself written in jsonic syntax — a relaxed-JSON document describing
engine options.

At plugin-install time the flow is:

1. A throwaway jsonic instance parses the embedded grammar text into a
   plain options object.
2. The plugin substitutes the placeholder character-set identifiers
   (`JSON5_WHITESPACE`, `JSON5_QUOTE_CHARS`, …) with the real Unicode
   strings. These are kept out of the grammar file because some code
   points (BOM, U+2028/U+2029) do not round-trip losslessly through the
   grammar parser as string literals.
3. Option-dependent overrides are layered on: `hex`/`octal`/`binary`/
   `numberSeparator` toggle number-lexer flags, `hashComment` enables
   the `#` comment def, `backtickString` adds the backtick quote,
   `requireValue` flips `lex.empty`, and `infinity` injects the
   `Infinity`/`NaN` value keywords.
4. A `ref` map wires up the `@`-prefixed function references in the
   grammar (the lex-check hooks and regex value parsers).
5. The patched spec is applied with `engine.grammar()`, then a few
   rule-level trims run that the declarative file cannot express.

## How JSON5 is carved out of jsonic

jsonic is deliberately more permissive than JSON5. The plugin makes it
*less* permissive in specific, deliberate ways:

- **No implicit top-level structures.** jsonic accepts `1,2,3` and
  `a:1` at the document root; JSON5 wants a single value. The grammar
  excludes the implicit (`imp`) rule alternates, and a leading-comma
  object alt is dropped from `pair`.
- **Restricted token sets.** Value positions drop the bare-text token
  (`#TX`), so `foo` is not a value. Key positions drop the number token
  (`#NR`), so `{10:1}` is rejected.
- **Identifier-name keys.** An unquoted key must be a valid ECMAScript
  5.1 `IdentifierName`. A `pair` after-open validator checks each
  unquoted key's source and rejects ones that are not — this is the test
  that lets `{while:true}` through but stops `{10:1}` and symbol keys.
- **Stricter numbers.** Octal, binary, and digit separators are off by
  default, and a regex exclusion (`^[+-]?0[0-9]`) rejects JS-style
  leading-zero integers like `010` and `080`.

## The lexer-check hooks

Two things JSON5 needs cannot be expressed as plain lexer options, so the
plugin installs **lex-check** hooks — small functions the lexer calls at
each step:

- **String line continuations.** A backslash immediately followed by a
  line terminator must produce *nothing*, letting a string span lines.
  The escape map cannot encode this (the lexer discards any escape whose
  replacement is empty), so a `fixed.check` hook preprocesses the whole
  source once per parse, stripping `\` + line-terminator sequences before
  lexing. This is why `"line1\<newline>line2"` parses to `'line1line2'`.
- **Identifier-aware text rejection.** A `text.check` hook stops the
  lexer at any unquoted run that neither begins a valid JSON5
  `IdentifierStart` nor matches a registered value keyword / regex. This
  produces a clean "unexpected character" at the right column instead of
  letting jsonic swallow stray text.

## Two regex value defs

Two number shapes are not recognised by the engine's built-in number
matcher, so they are registered as regex-matched value definitions in the
grammar (and so behave identically in both ports):

- **Trailing-decimal-with-exponent** (`5.e4`) — matched by
  `^[+-]?[0-9]+\.[eE][+-]?[0-9]+` and parsed with `parseFloat`.
- **Uppercase `0X` hex** (`0X1f`) — matched by `^[+-]?0X[0-9a-fA-F]+` and
  parsed as a base-16 integer.

## Why `Infinity` / `NaN` are injected in code

`true`, `false`, and `null` are ordinary value keywords and sit in the
grammar file directly. `Infinity` and `NaN` cannot: they are JS numeric
values, and the grammar parser cannot round-trip a literal `Infinity` or
`NaN` through a relaxed-JSON document as the actual floating-point value.
So the plugin injects the six keywords (`Infinity`, `+Infinity`,
`-Infinity`, `NaN`, `+NaN`, `-NaN`) into the value defs at install time,
gated by the `infinity` option.

## Accepted vs rejected — the edge cases

| Input | Result | Why |
|---|---|---|
| `{while: true}` | accepted | `while` is a valid identifier name; reserved words are fine as keys. |
| `{10: 1}` | rejected | Numeric keys are not allowed (`#NR` dropped from key set). |
| `080` | rejected | JS-style leading zero excluded by the number regex. |
| `0o17` | rejected (default) | Octal is opt-in (`octal: true`). |
| `foo` | rejected (default) | Bare text dropped from value positions (`strictValue: true`). |
| `{,}` | rejected | Leading-comma object alt removed from `pair`. |
| `1,2,3` | rejected | No implicit top-level list. |
| `5.e4` | accepted → `50000` | Regex value def. |
| `0X1f` | accepted → `31` | Uppercase-hex regex value def. |

## Compliance

Both ports run the full official
[`json5/json5-tests`](https://github.com/json5/json5-tests) corpus,
vendored under `test/json5-tests`. Fixture extensions encode the
expectation: `.json`/`.json5` must parse, `.js` (valid ES5 but not
JSON5) and `.txt` (invalid everywhere) must error. The TS and Go suites
agree on every fixture. For where Go differs from this canonical
behaviour, see [../../go/doc/concepts.md](../../go/doc/concepts.md#differences-from-the-ts-version).
