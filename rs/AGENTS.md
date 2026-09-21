# Agents Guide: rs/

The Rust port of the canonical TypeScript in [`../ts`](../ts). Read
[`../AGENTS.md`](../AGENTS.md) first: it holds the cross-runtime rules,
and this file only covers what is specific to this crate.

## Layout

| Path | |
|---|---|
| `src/lib.rs` | the whole port: `Json5Options`, the embedded grammar text, the lexer checks, the value transforms, the pair-key validator, `json5`, `plugin`, `make`, `make_with`, `parse_with`, `parse` |
| `tests/parity_test.rs` | every `../test/spec/*.tsv` fixture through `tabnas_support::Runner`, a fresh parser per row for the `opts` column, plus the tripwire that every fixture has the standard shape |
| `tests/suite_test.rs` | the vendored `../test/json5-tests` corpus against `../test/json5-tests-expected.json`, both halves, plus the derived truncation and trailing probes |
| `tests/divergent_test.rs` | the register `../test/divergent.tsv`, `rust` column |
| `tests/text_ender_test.rs` | the P1/P2 pin: a quote does not end a text run |
| `tests/json5_test.rs` | in-language behaviour: the `go/json5_test.go` cases, the API, threads |
| `tests/perf_test.rs` | reuse of one instance must beat rebuilding per parse |
| `tests/version_test.rs` | Cargo.toml == `VERSION` == ts/package.json |
| `tests/common/mod.rs` | shared helpers: spec dir, the hand-written value conversion, the `opts` reader, the register outcome |
| `README.md` | the crate front page, prose-gated; its `rust` fences are doctests of this crate (see below) |

Crate `tabnas-json5`, library `tabnas_json5`. The engine (`tabnas`), the
base grammar (`tabnas-jsonic`, which takes `tabnas-json` by path in
turn) and the fixture runner (`tabnas-support`, dev only) are **path
dependencies on sibling checkouts** (`../../parser/rs`,
`../../jsonic/rs`, `../../json/rs`, `../../support/rs`). None is
published, so there is no registry version to fall back on.

```bash
cargo build --all-targets
cargo test --all-targets && cargo test --doc
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt
```

`make test-rs` from the repository root is the fast loop; `ci/rust/run.sh`
is the full gate and adds `fmt --check`, the lockfile check and the MSRV
pin. Use `CARGO_BUILD_JOBS=2` on a shared box.

## The grammar is the embedded jsonic TEXT, parsed at install

`../json5-grammar.jsonic` is embedded verbatim between the
`BEGIN/END EMBEDDED` markers in `src/lib.rs`, as a `r#"..."#` raw
string, by `../ts/embed-grammar.js` (which writes the TypeScript and Go
sources too, and writes this one when `rs/` exists). **Never hand-edit
the text between the markers.** The grammar cannot contain `"#`; the
script refuses one that does.

At install, `grammar_document` parses that text with
`tabnas_jsonic::make()`, exactly as the other two ports parse it, then
patches it before `GrammarSpec::from_value`:

- the `JSON5_*` placeholders become the real character sets;
- the option-dependent overrides (`hex`, `oct`, `bin`, `sep`, hash
  comment, `lex.empty`, `tokenSet.VAL`) are applied from `Json5Options`;
- `number.exclude` loses its `@/.../` wrapper. The engine reads that
  field as a BARE pattern and stores whatever string it is given, so the
  serialized form compiled to a regex that never matched and `010`
  parsed as ten. `value.def.*.match` DOES take the serialized form; the
  two are not symmetric.

Two things go on AFTER the document, through `set_options`:

- the `Infinity` / `NaN` family, because the values cannot travel as
  JSON (same reason as in TypeScript and Go);
- the `null` keyword's value. The document says `null: { val: null }`,
  and the engine's loader reads a JSON null `val` as "no value", so the
  keyword came back as the text `"null"`. `null_keywords` collects every
  definition whose `val` is null and puts `Value::Null` back.

## The refs the grammar names

Every `@name` in the grammar is registered on the instance BEFORE the
document is installed, because the document is what looks them up:

- `@fixed-check` is a **no-op**. In TypeScript and Go it rewrites the
  lexer's source to strip string line continuations; a Rust lexer check
  is `Fn(&str) -> LexCheckResult` (or takes `&mut Lexer` borrowing the
  source) and cannot replace what it is lexing. The rewrite lives in
  `parse_with`. The registration only satisfies the reference.
- `@text-check` returns `Skip` for unquoted text that cannot start an
  `IdentifierName` and is not a value keyword or value regex; an
  unclaimed character is the engine's `unexpected`. The keyword list is
  captured at install from the document plus the `Infinity` family:
  the check has no access to the live config.
- `@string-check` scans from the quote for the escapes ES5.1 forbids
  (`\1`..`\9`, `\0<digit>`, `\u{`) and returns `Skip`.
- `@parse-trailing-dec-exp` and `@parse-uppercase-hex` are
  `value_transform_ref`s. Note the Rust number lexer already accepts
  `0X` and `5.e4`, so the regex definitions mostly pin agreement.
- `@json5-pair-key` is a `state_action_with_next_ref` pushed onto
  `pair.ao` by name through `define_rule`. It rejects a `#TX` key that
  is not an `IdentifierName` (returns the token marked `unexpected`) and
  writes the decoded name onto both the token and `u.key`, because
  jsonic's `@pairkey` has already copied the raw source there.

## Token sets do not reach pre-built alternates

`AltSpec.s` holds resolved tins, so the `tokenSet` the document
declares does not change jsonic's already-installed `val` and `pair`
alternates. `json5()` filters `#TX` out of every val-tagged alternate
(under `strict_value`) and `#NR` out of every pair-tagged one, on every
rule, exactly as the Go port's `filterTinFromAlts` does. Then it drops
the `comma,jsonic` alternate from `pair.open` and, under
`require_value`, the `#ZZ jsonic` alternate from `val.open`.

## Why `parse_with` exists

The Go port's `Parse(j, src)`, for the same reason: the engine runs a
`parser.start` hook INSTEAD of the parse, not before it, so a plugin
cannot wrap the parse the way the TypeScript one does. `parse_with`
reads the options the plugin recorded as a decoration (`json5$options`),
applies the requireValue codes, delegates a no-value source to
`parse("")` when the option is off (so the grammar's `emptyResult` is
written once), strips line continuations inside string literals, and
parses. A parser without the decoration is parsed as it is.

`Tabnas::parse` on the instance still parses JSON5: the escape map
handles `\` before LF, CR, LS and PS natively (the Rust lexer honours an
empty replacement, where the TypeScript one drops it), so only `\`
before CRLF and the two requireValue codes need the wrapper. Every test
and every fixture goes through `parse_with`.

## The divergence register

`tests/divergent_test.rs` reads the `rust` column of
`../test/divergent.tsv` with a LOCAL runner mirroring
`go/divergent_test.go`, not `tabnas_support::Register`. The register's
only rows record a position disagreement under one code (the astral
column: TypeScript counts UTF-16 units, Go and Rust count characters),
and the support crate's register compares error cells by code alone, so
it would refuse every row as recording no divergence. When it compares
positions, this file collapses to a `Register::new(runner, "rust",
&["go", "ts", "rust"])` call.

## The corpus grader never skips

`tests/suite_test.rs` panics when the corpus or the oracle is missing.
Do not turn that into an early return or an `#[ignore]`: a conformance
run that silently does not happen is the defect the grader exists to
prevent. The canonical value form is duplicated in four places
(`scripts/gen-json5-expected.js`, `ts/test/suite.test.ts`,
`go/suite_test.go`, this file) and must stay byte-compatible: strings
walk UTF-16 code units, numbers are the IEEE-754 bits.

## The docs are gated

`README.md` is in the published set: no em dashes in prose, no first
person singular, no links to any `AGENTS.md`, no project history. This
file is internal and may be blunt.

## The README is doctested

`src/lib.rs` includes `README.md` as rustdoc under `#[cfg(doctest)]`, so
every `rust` fence in it runs on `cargo test --doc` (they show up as
`readme_examples (line N)`). rustdoc runs each fence as written, so a
fence must be a complete program: wrap it in
`fn main() -> Result<(), Box<dyn std::error::Error>> { ... Ok(()) }`
rather than using `?` at the top level, and never use hidden `# ` lines,
which render as garbage on GitHub. The `toml` and `bash` fences are not
run.
