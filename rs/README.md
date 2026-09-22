# tabnas-json5 (Rust)

The JSON5 grammar plugin for the
[`tabnas`](https://github.com/tabnas/parser) parsing engine, crate
`tabnas_json5`.

[JSON5](https://json5.org) is JSON plus comments (`//`, `/* */`),
trailing commas, single-quoted strings, unquoted `IdentifierName` keys
(with `\uXXXX` escapes decoded), hex numbers, leading and trailing
decimal points, explicit `+` signs, `Infinity` and `NaN`, and string
line continuations. The plugin layers on the relaxed-JSON base grammar
of [`tabnas-jsonic`](https://github.com/tabnas/jsonic) and then tightens
it toward the specification: no implicit top-level `a:1` or `1,2`
forms, no auto-close at the end of the source, no unquoted text at a
value position, and no numeric keys. The default option set is a strict
JSON5 configuration; hash comments, backtick strings and octal, binary
or separator numbers are off and opt-in.

This is the Rust port of the canonical TypeScript implementation in
[`../ts`](../ts); the TypeScript version is authoritative and this crate
tracks it. The Go port is in [`../go`](../go). All three share one
grammar file, [`../json5-grammar.jsonic`](../json5-grammar.jsonic), and
all three pass the vendored official `json5/json5-tests` corpus.

## Use

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let value = tabnas_json5::parse("{ a: 1, b: [2, 3,], }")?;
    assert_eq!(value.to_string(), r#"{"a":1,"b":[2,3]}"#);
    Ok(())
}
```

Or build an instance and reuse it, parsing through `parse_with`, the
entry point that applies the `requireValue` rule and strips string line
continuations:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let parser = tabnas_json5::make();
    let value = tabnas_json5::parse_with(&parser, "{ hex: 0xDECAF, sign: +1, tail: 5. }")?;
    assert_eq!(value.to_string(), r#"{"hex":912559,"sign":1,"tail":5}"#);

    let error = tabnas_json5::parse_with(&parser, "// only a comment").unwrap_err();
    assert_eq!(error.code, "json5_no_value");
    Ok(())
}
```

Configure one with `Json5Options`; every field is a boolean and the
defaults are strict JSON5:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = tabnas_json5::Json5Options {
        hash_comment: true,
        require_value: false,
        ..Default::default()
    };
    let parser = tabnas_json5::make_with(options);
    assert_eq!(tabnas_json5::parse_with(&parser, "# note\n42")?.to_string(), "42");
    assert_eq!(tabnas_json5::parse_with(&parser, "   ")?.to_string(), "null");
    Ok(())
}
```

The plugin form installs on any instance that carries the jsonic
grammar, and takes its options as the engine's plugin-option bag, keyed
as the TypeScript plugin spells them:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut parser = tabnas_jsonic::make();
    let overrides = tabnas_json5::Json5Options { backtick_string: true, ..Default::default() };
    parser.use_plugin(tabnas_json5::plugin(), Some(overrides.to_value()))?;
    assert_eq!(tabnas_json5::parse_with(&parser, "`quoted`")?.to_string(), r#""quoted""#);
    Ok(())
}
```

Parse errors are the engine's `TabnasError`, re-exported as
`Json5Error`, with `code`, `row`, `col` and a report that shows the
offending source with a caret. `json5_empty` and `json5_no_value` are
the two codes this plugin adds; the rest are the engine's.

## Install

Neither the engine nor the base grammars are published to a registry, so
all of them are consumed as **sibling checkouts**, the standard tabnas
development model. Clone `https://github.com/tabnas/parser`,
`https://github.com/tabnas/json` and `https://github.com/tabnas/jsonic`
next to this repository and point at them:

```toml
[dependencies]
tabnas-json5 = { path = "../json5/rs" }
tabnas-jsonic = { path = "../jsonic/rs" }
tabnas = { path = "../parser/rs" }
```

All three entries are needed. A crate's dependencies are not passed on
to its dependents, so `tabnas-json5` alone does not put `tabnas` or
`tabnas_jsonic` in your extern prelude, and the examples above that name
`tabnas_jsonic::make` would not resolve. Only `Json5Error` is
re-exported. The test suite additionally needs
`https://github.com/tabnas/support` beside the repository, for the
shared fixture runner.

## Differences from the canonical TypeScript

Every parse result is the TypeScript one: the shared fixtures in
[`../test/spec`](../test/spec) and the vendored corpus in
[`../test/json5-tests`](../test/json5-tests) hold all three runtimes to
it, both the values and the rejections. What differs is the shape of the
API and a few points where the engine has no way to say what the
TypeScript engine says:

- **The entry point is `parse_with`, as in Go.** TypeScript wraps the
  `start` method on the parser to apply the `requireValue` rule and to
  strip string line continuations before lexing. The Rust engine runs a
  `parser.start` hook instead of the parse rather than before it, and a
  lexer hook cannot rewrite the source it is lexing, so both live in the
  package-level `parse_with` (and `parse`), the counterpart of the Go
  `Parse(j, src)`. A direct `Tabnas::parse` on the instance still parses
  JSON5, but reports an empty source with the engine's generic code and
  does not fold a `\` before CRLF inside a string.
- **Options are a struct.** `Json5Options` holds the nine booleans with
  Rust names; `to_value` and `from_value` map them to the TypeScript
  keys the plugin bag uses.
- **The `Infinity` family is a value definition.** `Infinity`, `NaN`
  and their signed forms are real `f64` values in the parse result;
  `Value::to_json` renders them as `null`, so read `Value::Number`
  directly when they matter.
- **Key order is document order.** An `IndexMap` keeps every key where
  it arrived; a JavaScript object enumerates integer-like keys first.
- **Lone surrogates fold to U+FFFD**, and the regular expression dialect
  is the `regex` crate's. Both come from the engine, and both are
  recorded there. The fold is executed rather than only described:
  `a_lone_surrogate_folds_to_the_replacement_character` in
  `tests/json5_test.rs` pins `"\uD800"` to U+FFFD and pins a complete
  surrogate pair to the single astral character it denotes. The Go port
  folds the same way, for the same reason: a UTF-8 string cannot hold an
  unpaired surrogate. It is pinned in a test rather than in the shared
  divergence register because that register compares JSON cells, and
  every reader but JavaScript's folds `\ud800` to U+FFFD, so the row
  would read as no divergence at all.
- **Unquoted keys reach the letters this crate's Unicode tables know.**
  An ECMAScript 5.1 `IdentifierStart` is a Unicode letter, and the
  specification names no Unicode version, so each runtime answers from
  the tables its platform ships. This crate reads them through the
  `regex` crate, which is a version behind a recent Node and a version
  ahead of Go 1.24, so a handful of recently added letters open a key
  here and not in Go, and a smaller handful open one in the canonical and
  not here. The measured table is in
  [`../DIVERGENCE.md`](../DIVERGENCE.md), and
  `unquoted_keys_follow_this_crates_unicode_tables` in
  `tests/json5_test.rs` holds this column to it. Nothing in the parse
  rule differs: the runtimes disagree about which characters are letters,
  not about what a key may be.
- **Nesting stops at 127 containers.** A deeper source gets the `cancel`
  code, where the canonical runtime and the Go port accept it. The bound
  comes from the base grammar, and it guards the caller: the parse loop
  runs flat, while the value it hands back walks its own nesting to
  convert and again to drop, one frame per level and both outside this
  crate. `nesting_is_capped_at_the_budget_jsonic_installs` in
  `tests/json5_test.rs` pins the boundary.

One difference from the specification is shared by every port and
rooted upstream: a literal control character inside a string literal is
rejected with `unprintable`, as the TypeScript and Go ports reject it.
U+2028 and U+2029 stay legal inside a string in all three, which is
what the specification asks for, and the shared `../test/spec/strings.tsv`
fixture executes that agreement in each of them.

## Build and test

The engine, the base grammars and the fixture runner are path
dependencies on sibling checkouts, so there is nothing to fetch:

```bash
cargo test --all-targets && cargo test --doc
```

Or, from the repository root, `make test-rs`. For what CI would say,
including formatting and the lockfile check, run `ci/rust/run.sh`.

The suite runs every shared `../test/spec/*.tsv` fixture, the same files
the TypeScript and Go suites run, through the shared runner with a fresh
parser per row for the `opts` column; the vendored `json5/json5-tests`
corpus against its generated oracle, both halves and the derived
truncation and trailing-garbage probes; the divergence register; and
the in-language tests for what a fixture cannot express: the API, the
decoded keys, the error positions, the shared default parser under
threads, and that reusing an instance is what makes a parse cheap.

## License

MIT.
