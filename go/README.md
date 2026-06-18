# @tabnas/json5 — Go

A [Jsonic](https://github.com/tabnas/jsonic) grammar plugin for parsing
[JSON5](https://json5.org) — JSON plus comments, unquoted and
single-quoted keys, single-quoted strings, trailing commas, hexadecimal
integers, `Infinity` / `NaN`, leading- and trailing-decimal numbers,
explicit `+` signs, and string line continuations.

This is the Go port of `@tabnas/json5`. It shares one grammar file with
the TypeScript version and passes the full official
[`json5/json5-tests`](https://github.com/json5/json5-tests) corpus.

## Install

```bash
go get github.com/tabnas/json5/go@latest
```

## Example

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

	v, _ := j.Parse(`{
        // a JSON5 document
        name: 'Alice',
        tags: ['admin', 'user',],
    }`)
	fmt.Println(v)
	// map[name:Alice tags:[admin user]]
}
```

`Parse` returns `any`; objects come back as `map[string]any`, arrays as
`[]any`, numbers as `float64`.

## Documentation

Full documentation, following the [Diátaxis](https://diataxis.fr)
framework:

- [Tutorial](doc/tutorial.md) — learn the plugin from a guided first parse.
- [How-to guide](doc/guide.md) — task recipes (options, errors, strictness).
- [Reference](doc/reference.md) — the API, every option, and accepted syntax.
- [Concepts](doc/concepts.md) — how it works, plus differences from the TS version.

The grammar source lives in the repository-root
[`json5-grammar.jsonic`](../json5-grammar.jsonic), shared with the
TypeScript port. The railroad diagram is in the
[repository README](../README.md).

## License

Copyright (c) 2021-2026 Richard Rodger and other contributors,
[MIT License](../LICENSE).
