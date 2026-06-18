# Tutorial — your first JSON5 parse (Go)

This walks you from nothing to a working parse with the `json5` plugin
for the Go port of tabnasjsonic. Follow it in order; each step builds on the
last. When you finish you will have installed the plugin, parsed a real
JSON5 document, inspected the result types, and handled a parse error.

For a recipe-style index of individual tasks, see the
[how-to guide](guide.md). For the full API and option table, see the
[reference](reference.md). For how it works, see [concepts](concepts.md).

## 1. Install

`json5` is a grammar plugin for the Go port of jsonic
(`github.com/tabnas/jsonic/go`), which it pulls in as a dependency:

```bash
go get github.com/tabnas/json5/go@latest
```

## 2. Parse a string

Make a jsonic instance, install the `Json5` plugin with its defaults,
then call `Parse`:

```go
package main

import (
	"fmt"

	tabnasjsonic "github.com/tabnas/jsonic/go"
	tabnasjson5 "github.com/tabnas/json5/go"
)

func main() {
	j := tabnasjsonic.Make()
	if err := j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults()); err != nil {
		panic(err)
	}

	result, err := j.Parse("{a:1}")
	if err != nil {
		panic(err)
	}
	fmt.Println(result) // map[a:1]
}
```

Run it with `go run .`. You wrote `{a:1}` — an unquoted key, no spaces —
and got back a map. Ordinary JSON parses too, so
``j.Parse(`{"a":1}`)`` gives the same result. The instance is reusable:
build it once, call `Parse` as many times as you like.

`UseDefaults` takes the plugin, its default options, and optional
override maps. `Defaults()` returns a fresh strict-JSON5 configuration.

## 3. Inspect the result

`Parse` returns `any`. For JSON5 input the concrete types are
predictable:

- objects → `map[string]any`
- arrays → `[]any`
- numbers → `float64` (including `+Inf`, `-Inf`, `NaN`)
- strings → `string`
- booleans → `bool`
- `null` / empty input → `nil`

So type-assert and read fields directly:

```go
result, _ := j.Parse("{a:1, b:2}")
m := result.(map[string]any)
fmt.Println(m["a"]) // 1   (a float64)
```

Numbers come back as `float64`, matching `encoding/json`. The full list
is in the [reference](reference.md#return-types).

## 4. Parse a real JSON5 document

JSON5 is JSON with the comfortable parts of JavaScript object literals
added back — comments, unquoted keys, single quotes, trailing commas,
`+`, leading/trailing decimal points, hex, and `Infinity`:

```go
result, _ := j.Parse(`{
    // a JSON5 document
    name: 'Alice',
    balance: +1.5e3,
    limit: Infinity,
    tags: ['admin', 'user',],
}`)
// result: map[string]any{
//   "name": "Alice", "balance": 1500.0,
//   "limit": math.Inf(1), "tags": []any{"admin", "user"},
// }
```

## 5. Make a configured instance

The defaults are strict JSON5, but you can change individual flags by
passing an override map as the third argument to `UseDefaults`. Here,
allow `#` comments:

```go
j := tabnasjsonic.Make()
j.UseDefaults(tabnasjson5.Json5, tabnasjson5.Defaults(), map[string]any{
	"hashComment": true,
})

result, _ := j.Parse("# a hash comment\n42")
fmt.Println(result) // 42
```

Every flag is documented in the [reference](reference.md#options).

## 6. Catch an error

When the input is not valid JSON5, `Parse` returns an `error` — it never
panics. Inspect the structured detail with `errors.As`:

```go
import (
	"errors"
	"fmt"

	tabnasjsonic "github.com/tabnas/jsonic/go"
)

_, err := j.Parse("foo") // a bare word is not a JSON5 value
var je *tabnasjsonic.JsonicError
if errors.As(err, &je) {
	fmt.Println(je.Code)        // unexpected
	fmt.Println(je.Row, je.Col) // 1 1
}
```

`err.Error()` renders a formatted message with a caret pointing at the
source location — useful to show a user. The `*tabnasjsonic.JsonicError`
fields (`Code`, `Row`, `Col`, `Hint`, …) are for your code to branch on.

## Where to go next

- [How-to guide](guide.md) — focused recipes (options, errors, strictness).
- [Reference](reference.md) — the API, every option, and accepted syntax.
- [Concepts](concepts.md) — how the plugin works, and how it differs from
  the TypeScript version.
