# Reference (Go)

Dry and complete: the public API of the `json5` Go package, every option
with its default and effect, and the syntax the plugin accepts. For
worked walk-throughs see the [tutorial](tutorial.md) and
[how-to guide](guide.md); for the design rationale and the TS-vs-Go
differences see [concepts](concepts.md).

## Package

```
go get github.com/tabnas/json5/go@latest
```

```go
import (
	jsonic "github.com/tabnas/jsonic/go"
	json5 "github.com/tabnas/json5/go"
)
```

`json5` is a grammar plugin for the Go port of jsonic. It is installed
onto a `*jsonic.Jsonic` instance with `UseDefaults`.

## Exports

| Export | Kind | Description |
|---|---|---|
| `Json5` | `func(j *jsonic.Jsonic, opts map[string]any) error` | The plugin function. Pass it to `UseDefaults`. |
| `Defaults()` | `func() map[string]any` | Returns a fresh copy of the default option map (strict JSON5). |
| `Version` | `const string` | The plugin's semantic version. |

There is no standalone parse function in this package — parsing is done
through the jsonic instance you install the plugin on.

## API

### `jsonic.Make() *jsonic.Jsonic`

Create a fresh jsonic parser instance. The plugin is installed onto it.

### `j.UseDefaults(plugin, defaults, opts...) error`

```go
func (j *jsonic.Jsonic) UseDefaults(
	plugin func(*jsonic.Jsonic, map[string]any) error,
	defaults map[string]any,
	opts ...map[string]any,
) error
```

Installs `plugin` with `defaults`, then deep-merges each `opts` map over
them (so you set only the keys you want to change). Returns a non-nil
error only if the plugin fails to install. The instance is reusable
afterwards.

```go
j := jsonic.Make()
err := j.UseDefaults(json5.Json5, json5.Defaults())
```

With overrides:

```go
j.UseDefaults(json5.Json5, json5.Defaults(), map[string]any{
	"hashComment": true,
})
```

### `j.Parse(src) (any, error)`

Parses `src` and returns the value, or an `error` on failure. It never
panics. This is jsonic's standard parse method; the plugin only
configures how it behaves.

```go
j := jsonic.Make()
j.UseDefaults(json5.Json5, json5.Defaults())
v, err := j.Parse("{a:1}")
// v: map[string]any{"a": 1.0}, err: nil
```

### `json5.Defaults() map[string]any`

Returns a fresh copy of the default options. A strict-JSON5
configuration. Always returns a new map, so you can mutate the result
freely.

```go
json5.Defaults()
// map[string]any{
//   "infinity": true, "hex": true, "hashComment": false,
//   "backtickString": false, "numberSeparator": false,
//   "octal": false, "binary": false,
//   "requireValue": true, "strictValue": true,
// }
```

## Options

All options are booleans, supplied as a `map[string]any`. The defaults
configure a strict JSON5 parser (accept the JSON5 spec, reject
everything else). Each override map you pass to `UseDefaults` is merged
over `Defaults()`.

| Option | Default | Effect when `true` | When `false` |
|---|---|---|---|
| `infinity` | `true` | Accept the `Infinity`, `+Infinity`, `-Infinity`, `NaN`, `+NaN`, `-NaN` keywords as numeric values. | These keywords are rejected. |
| `hex` | `true` | Accept hexadecimal integers (`0x1F`, `0X1f`, `-0x10`). | Hex literals are rejected. |
| `hashComment` | `false` | Also treat `#` as a line comment (a jsonic extension, not JSON5). | Only `//` and `/* */` comments; `#` is rejected. |
| `backtickString` | `false` | Also accept `` `...` `` backtick-quoted strings. | Backticks are rejected. |
| `numberSeparator` | `false` | Accept `_` as a digit group separator (`1_000`). | `_` in a number is rejected. |
| `octal` | `false` | Accept `0o`-prefixed octal integers (`0o17`). | Octal literals are rejected. |
| `binary` | `false` | Accept `0b`-prefixed binary integers (`0b101`). | Binary literals are rejected. |
| `requireValue` | `true` | An empty (or whitespace/comment-only) source is an error: a top-level value is required. | An empty source parses to `nil`. |
| `strictValue` | `true` | Reject bare unquoted text at value positions (`foo` is not a value). | Fall back to jsonic's text rule: bare words parse as strings. |

`infinity` and `hex` default to `true` because they are part of the
JSON5 spec. `octal`, `binary`, `numberSeparator`, `hashComment`, and
`backtickString` default to `false` because they are *not* JSON5 — they
are opt-in extensions.

## Return types

`Parse` returns `any`. The concrete types for JSON5 input are:

| Value | Go type |
|---|---|
| Object | `map[string]any` |
| Array | `[]any` |
| String | `string` |
| Number | `float64` (including `math.Inf(1)`, `math.Inf(-1)`, `math.NaN()`) |
| Boolean | `bool` |
| `null` / empty input (with `requireValue: false`) | `nil` |

Numbers are always `float64`, matching `encoding/json`.

## Accepted syntax

The default (strict-JSON5) configuration. The same syntax tables apply to
both ports — see the TS [reference](../../ts/doc/reference.md#accepted-syntax)
for the full set with examples. In summary:

- **Top level** — exactly one value. No implicit lists (`1,2,3`) or maps
  (`a:1`).
- **Objects** — double-, single-, or unquoted (identifier-name) keys;
  trailing commas; duplicate keys take the last value; numeric keys
  (`{10:1}`) rejected.
- **Arrays** — comma-separated, trailing comma allowed.
- **Strings** — single- or double-quoted, ES5.1 escapes plus line
  continuations (backslash + newline → joined).
- **Numbers** — decimal and hex, optional leading `+`/`-`, leading or
  trailing decimal point, exponents; JS-style leading-zero integers
  (`010`, `080`) rejected.
- **Keywords** — `true`, `false`, `null`, and the `Infinity`/`NaN`
  family.
- **Comments** — `//` and `/* */`.

## Errors

A failed `Parse` returns an `error` whose concrete type is
`*jsonic.JsonicError` (an alias for `*tabnas.TabnasError`). Reach it with
`errors.As`:

```go
import "errors"

_, err := j.Parse("foo")
var je *jsonic.JsonicError
if errors.As(err, &je) {
	// je.Code, je.Row, je.Col, je.Hint, je.Error()
}
```

| Field | Type | Description |
|---|---|---|
| `Code` | `string` | Error code, e.g. `"unexpected"`, `"unterminated_string"`. |
| `Row` | `int` | 1-based line of the error. |
| `Col` | `int` | 1-based column of the error. |
| `Pos` | `int` | 0-based character position. |
| `Hint` | `string` | Additional explanatory text. |
| `Error()` | method | Formatted multi-line report with a source extract and caret. |

A bare word like `foo` reports `Code == "unexpected"`. Empty input under
the default `requireValue: true` returns an error too — note its code
differs from the TS port; see
[concepts](concepts.md#differences-from-the-ts-version).

## Grammar

The grammar is authored once in the repository-root
[`json5-grammar.jsonic`](../../json5-grammar.jsonic) and embedded
verbatim into both `go/json5.go` and the TS source by a build step, so
the two ports parse the same spec. See [concepts](concepts.md) for the
model and the embedded railroad diagram in the [README](../README.md).
