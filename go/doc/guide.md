# How-to guide (Go)

Short, task-focused recipes. Each is self-contained and assumes you have
the plugin installed (see the [tutorial](tutorial.md) for the basics).
For the full option table and the API, follow the links into the
[reference](reference.md).

Every recipe builds a parser the same way — a jsonic instance with the
`Json5` plugin installed via `UseDefaults`:

```go
import (
	tabnasjsonic "github.com/tabnas/jsonic/go"
	tabnasjson5 "github.com/tabnas/json5/go"
)
```

## Use it as a plugin

`UseDefaults` registers the plugin with its default options. It returns
an `error`, which you should check (it is non-nil only if the plugin
fails to install):

```go
j := tabnasjsonic.Make()
if err := j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults()); err != nil {
	return err
}

v, _ := j.Parse(`{ a: 1, b: [2, 3,], }`)
// v: map[string]any{"a": 1.0, "b": []any{2.0, 3.0}}
```

The built instance is reusable across many `Parse` calls.

## Pass options

Pass one or more override maps as trailing arguments to `UseDefaults`.
Each is merged over `Defaults()`, so you only set the keys you want to
change:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{
	"hashComment": true,
})

v, _ := j.Parse("# a hash comment\n42")
// v: 42.0
```

The full list of flags and their defaults is in the
[reference](reference.md#options).

## Accept `#` (hash) comments

JSON5 has only `//` and `/* */` comments, so `#` is rejected by default.
Set `hashComment: true` to also treat `#` as a line comment:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{"hashComment": true})

v, _ := j.Parse("# hello\n42")
// v: 42.0
```

## Accept backtick-quoted strings

`` `...` `` strings are not part of JSON5. Enable them with
`backtickString: true`:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{"backtickString": true})

v, _ := j.Parse("`backtick`")
// v: "backtick"
```

## Accept octal, binary, or `_`-separated numbers

JSON5 numbers are decimal and hex only. The three flags below add the
JavaScript numeric extensions:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{
	"octal":           true,
	"binary":          true,
	"numberSeparator": true,
})

v, _ := j.Parse("0o17")  // v: 15.0
v, _ = j.Parse("0b101")  // v: 5.0
v, _ = j.Parse("1_000")  // v: 1000.0
```

To go the other way and drop hexadecimal, set `"hex": false`.

## Accept bare top-level text

By default a bare word is rejected (`foo` is not a JSON5 value). Set
`strictValue: false` to fall back to jsonic's behaviour, where unquoted
text parses as a string:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{"strictValue": false})

v, _ := j.Parse("foo")
// v: "foo"
```

## Allow empty input

JSON5 requires a top-level value, so by default an empty source returns
an error. Set `requireValue: false` to let an empty (or
whitespace/comment-only) source resolve to `nil`:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{"requireValue": false})

v, err := j.Parse("")
// v == nil, err == nil
```

## Handle parse errors

A failed `Parse` returns an `error` — it never panics. Use `errors.As`
to reach the structured `*tabnasjsonic.JsonicError`:

```go
import (
	"errors"

	tabnasjsonic "github.com/tabnas/jsonic/go"
)

j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults())

_, err := j.Parse("foo") // a bare word is not a JSON5 value
var je *tabnasjsonic.JsonicError
if errors.As(err, &je) {
	// je.Code == "unexpected", je.Row == 1, je.Col == 1
}
```

`err.Error()` is a formatted, multi-line report with a source extract and
a caret — show that to a user. The fields (`Code`, `Row`, `Col`, `Hint`)
are for your code to branch on. (Empty input under the default
`requireValue: true` also returns an error — use `tabnasjson5.Parse(j,
src)` to get the TS plugin's `json5_empty` code for it; see
[concepts](concepts.md#differences-from-the-ts-version).)

## Reproduce strict JSON5

The defaults already are strict JSON5 — you do not have to set anything.
This parses exactly the JSON5 spec and nothing more, and any valid JSON
is valid JSON5:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults())

v, _ := j.Parse(`{"a":1,"b":[2,null,true]}`)
// v: map[string]any{"a": 1.0, "b": []any{2.0, nil, true}}
```
