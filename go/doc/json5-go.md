# JSON5 plugin for Jsonic (Go)

A Jsonic plugin that configures a parser to accept
[JSON5](https://json5.org) syntax: single- and double-quoted strings,
unquoted and single-quoted object keys, trailing commas, `//` and
`/* */` comments, hexadecimal integers, `Infinity` / `NaN`, leading-
and trailing-decimal numbers, explicit `+` signs, and string line
continuations.

```bash
go get github.com/tabnas/json5/go
```

Requires `github.com/tabnas/jsonic/go` v0.1.19 or later.


## Tutorials

### Parse a JSON5 document

Install the plugin on a Jsonic instance, then call `Parse`. The
return value is a Go `any` with the usual JSON-style mapping
(objects → `map[string]any`, arrays → `[]any`, numbers → `float64`,
strings → `string`, booleans → `bool`, `null` → `nil`).

```go
import (
    jsonic "github.com/tabnas/jsonic/go"
    json5 "github.com/tabnas/json5/go"
)

j := jsonic.Make()
if err := j.UseDefaults(json5.Json5, json5.Defaults()); err != nil {
    return err
}

v, err := j.Parse(`{
    // A JSON5 document
    name: 'Alice',
    age: 30,
    tags: ['admin', 'user',],
    "legacy-key": null,
}`)
```

### Parse JSON5 numbers

All the shapes JSON5 admits round-trip to `float64`:

```go
j.Parse(`0x1F`)        // 31
j.Parse(`.5`)          // 0.5
j.Parse(`5.`)          // 5
j.Parse(`+1e10`)       // 1e10
j.Parse(`-Infinity`)   // math.Inf(-1)
j.Parse(`NaN`)         // math.NaN()
```

### Parse strings with line continuations

A backslash immediately before a line terminator (`LF`, `CR`, `CRLF`,
`LS`, or `PS`) is stripped — the string continues on the next line.

```go
j.Parse("'line1 \\\nline2'")
// "line1 line2"
```


## How-to guides

### Override plugin options

Options are a `map[string]any`. Pass a third argument to
`UseDefaults` with just the keys you want to change:

```go
j := jsonic.Make()
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
    "hashComment": true,
})
```

### Accept Jsonic-style `#` comments

Enable for ad-hoc config files:

```go
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
    "hashComment": true,
})
j.Parse("# comment\n42")  // 42
```

### Accept backtick-quoted strings

```go
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
    "backtickString": true,
})
j.Parse("`hello`")   // "hello"
```

### Accept JavaScript-style numeric extensions

Octal (`0o17`), binary (`0b101`), and `_` digit separators are off
by default. Enable individually:

```go
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
    "octal":           true,
    "binary":          true,
    "numberSeparator": true,
})
j.Parse(`0o17`)    // 15
j.Parse(`0b101`)   // 5
j.Parse(`1_000`)   // 1000
```

### Accept bare top-level text

```go
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
    "strictValue": false,
})
j.Parse(`foo`)   // "foo"
```

### Allow empty input

```go
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
    "requireValue": false,
})
j.Parse(``)            // nil
j.Parse("// only\n")   // nil
```


## Explanation

### Why this plugin exists

Jsonic is a relaxed JSON superset: it already accepts most JSON5
features (unquoted keys, single quotes, trailing commas, comments).
But Jsonic also accepts things JSON5 forbids — implicit top-level
lists / maps, leading-zero numbers (`010`), non-identifier unquoted
keys (`multi-word`), `#` comments, backtick-quoted strings — and is
missing a few pieces JSON5 requires: `Infinity` / `NaN` as values,
backslash+CRLF line continuations, and Unicode-category-Zs
whitespace.

The plugin configures Jsonic to accept exactly JSON5, using only
Jsonic's standard plugin surface: `tokenSet`, `value.def` entries
(including regex ones for `5.e4` and `0X…`), `LexCheck` hooks on the
fixed and text matchers, rule-level alt filters, and option
overrides for whitespace / line-terminator sets and
`number.exclude`.

### The shared grammar file

Both the TypeScript and Go ports consume the same declarative
grammar — [`json5-grammar.jsonic`](../json5-grammar.jsonic). It
captures the strict-JSON5 baseline: token sets, comment definitions,
string escapes, the `number.exclude` regex, regex-based `value.def`
entries, and error / hint messages.

At build time, `embed-grammar.js` copies the grammar into
`go/json5.go` (as a backtick-spliced raw string) so no disk read
happens at runtime. The plugin parses the embedded text with a
standard Jsonic instance, patches in character-set placeholders and
option-dependent overrides, attaches a ref map, and calls
`j.Grammar(grammarDef)`.

### Compliance

Both ports pass the full official
[`json5/json5-tests`](https://github.com/json5/json5-tests) corpus
(114 / 114) with identical results on every fixture.


## Reference

### `json5.Json5` (Plugin function)

```go
func Json5(j *jsonic.Jsonic, opts map[string]any) error
```

The plugin entry point. Install via `j.UseDefaults`:

```go
j.UseDefaults(json5.Json5, json5.Defaults(), overrides...)
```


### `json5.Defaults`

```go
func Defaults() map[string]any
```

Returns a fresh copy of the default plugin options — a strict JSON5
configuration. Pass the return value as the second argument to
`UseDefaults`, then supply any overrides as the third argument.

| Key               | Type   | Default | Description                                                                             |
| ----------------- | ------ | ------- | --------------------------------------------------------------------------------------- |
| `infinity`        | `bool` | `true`  | Accept `Infinity`, `-Infinity`, `+Infinity`, `NaN`, `-NaN`, `+NaN` as numeric literals. |
| `hex`             | `bool` | `true`  | Accept hexadecimal literals (`0x1F`, `0X1F`).                                           |
| `requireValue`    | `bool` | `true`  | Reject empty input and sources that contain only whitespace and comments.               |
| `strictValue`     | `bool` | `true`  | Reject bare unquoted text at the top level (e.g. `foo`).                                |
| `hashComment`     | `bool` | `false` | Accept `#` single-line comments (not part of the JSON5 spec).                           |
| `backtickString`  | `bool` | `false` | Accept backtick-quoted strings (not part of the JSON5 spec).                            |
| `numberSeparator` | `bool` | `false` | Accept `_` digit separators (`1_000`).                                                  |
| `octal`           | `bool` | `false` | Accept octal literals (`0o17`).                                                         |
| `binary`          | `bool` | `false` | Accept binary literals (`0b101`).                                                       |


### `json5.Version`

```go
const Version = "0.1.0"
```

The semantic version of this package.


### Errors

`j.Parse` returns a `*jsonic.JsonicError` (from
`github.com/tabnas/jsonic/go`) whose `Code` field carries one of:

| Code                    | Raised when                                                |
| ----------------------- | ---------------------------------------------------------- |
| `json5_empty`           | Input is the empty string and `requireValue` is `true`.   |
| `json5_no_value`        | Input contains only whitespace / comments.                 |
| `unexpected`            | A character or token cannot appear in JSON5 here.          |
| `unterminated_string`   | A quoted string is not closed.                             |
| `unterminated_comment`  | A block comment is not closed.                             |
| `invalid_unicode`       | A `\uXXXX` or `\u{...}` escape is malformed.               |
| `invalid_ascii`         | A `\xHH` escape is malformed.                              |
| `unprintable`           | An unescaped control character appears in a string.        |
