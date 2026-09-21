# Agents Guide: rs/

The Rust port of the canonical TypeScript in [`../ts`](../ts). Read
[`../AGENTS.md`](../AGENTS.md) first: it holds the cross-runtime rules,
and this file only covers what is specific to this crate.

## Layout

| Path | |
|---|---|
| `src/lib.rs` | the whole port: `Json5Options`, the embedded grammar text, the lexer checks, the value transforms, the pair-key validator, `json5`, `plugin`, `make`, `make_with`, `parse_with`, `parse` |
| `tests/parity_test.rs` | every `../test/spec/*.tsv` fixture through `tabnas_support::Runner`, a fresh parser per row for the `opts` column, plus two tripwires: every fixture has the standard shape, and the row CENSUS is the one recorded |
| `tests/suite_test.rs` | the vendored `../test/json5-tests` corpus against `../test/json5-tests-expected.json`, both halves, plus the derived truncation and trailing probes |
| `tests/divergent_test.rs` | the register `../test/divergent.tsv`, `rust` column |
| `tests/text_ender_test.rs` | the P1/P2 pin: a quote does not end a text run |
| `tests/json5_test.rs` | in-language behaviour: the `go/json5_test.go` cases, the API, threads |
| `tests/untrusted_test.rs` | playbook section 7: deep nesting, very long input, unterminated constructs, control characters, wide containers |
| `tests/perf_test.rs` | reuse of one instance must beat rebuilding per parse, and cost must grow about linearly with input size |
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
- the JSON5 `LineTerminator` set is SPLIT, where TypeScript and Go write
  all four characters into `line.chars`. CR and LF go into `line.chars`
  and LS and PS into `line.fixed`. Both halves end a line everywhere a
  line can end, because the engine asks `line.chars` plus `line.fixed`
  for that; the one place that asks `line.chars` ALONE is the string
  lexer's unprintable test, and JSON5 5.2 admits an unescaped U+2028 or
  U+2029 inside a string literal where any other line terminator must be
  escaped. Carrying all four in `line.chars` made a string holding a raw
  U+2028 `unprintable` here, while TypeScript and Go both returned the
  string. `char_sets()` in the engine's `options.rs` documents the
  asymmetry as deliberate, so this is a seam rather than a workaround.
  All three runtimes execute it, through the rows in
  `../test/spec/strings.tsv` whose input cells carry the raw characters
  (the fixture escape codec is `\n \r \t \\` and has no `\uXXXX`, so a
  cell reading `\u2028` would test the JSON5 escape instead); pinned
  here as well by
  `a_line_separator_is_legal_inside_a_string_but_still_ends_a_line` in
  `tests/json5_test.rs`;
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
  `0X` and `5.e4`, so the regex definitions mostly pin agreement --
  and `@parse-uppercase-hex` does not run at all under the default
  options, because the number lexer claims `0X` first. See below.
- `@json5-pair-key` is a `state_action_with_next_ref` pushed onto
  `pair.ao` by name through `define_rule`. It rejects a `#TX` key that
  is not an `IdentifierName` (returns the token marked `unexpected`) and
  writes the decoded name onto both the token and `u.key`, because
  jsonic's `@pairkey` has already copied the raw source there.

## Base-prefixed numbers are re-read exactly

`0x`, `0o` and `0b` literals are read as an EXACT integer and rounded to
a double ONCE, half to even, which is what the canonical coercion does
on the same digits. Folding the digits into an `f64` one at a time
instead rounds at every digit, and past the 53-bit exact integer range
the roundings accumulate and the answer drifts.

The engine used to fold that way, so this crate carried a `subscribe_lex`
hook that re-derived the value of every base-prefixed token. That defect
is fixed upstream, in `parser`'s `match_number`, and the hook is gone:
the engine now answers correctly under the default options, where
`number.hex` is on and its lexer claims `0x` and `0X` before any value
definition sees them. Removing the hook was measured rather than assumed,
by running this suite against the fixed engine with the hook gone, and
again against the old engine with the hook gone, where the bit-pinning
test fails.

`radix_literal_value` and `digits_to_f64` stay, because
`@parse-uppercase-hex` still needs them: that value definition owns `0X`
when `hex` is false, which is the one configuration where the engine's
lexer never sees the literal.

Pinned by `../test/spec/numbers.tsv`, the `hex:false` rows in
`../test/spec/options.tsv`, and
`wide_base_prefixed_literals_round_once_from_the_exact_integer` in
`tests/json5_test.rs`, which asserts the IEEE-754 bits a decimal
expectation cannot show. Verified against node over 4,000 random
literals in all three bases.

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

Every divergence, register row or not, also has a MEASURED table in
`../DIVERGENCE.md` with the reason and who owns the repair. Only the
nesting bound is the Rust port's alone: `tabnas_jsonic`'s `DEPTH_LIMIT`,
inherited rather than added here, and unable to be a row for the reason
below. The rest are shared with Go, the astral `IdentifierStart` among
them: those two rows are live in the register, so all three runtimes
execute them.

### What the register cannot hold

Three shapes of divergence do not fit this file. None is a reason to
widen the cell format; each is recorded where it can be executed.

- **A lone surrogate.** `"\uD800"` is that character in TypeScript and
  U+FFFD here, because a Rust `String` is UTF-8. The register's cells
  are JSON values, and every reader but JavaScript's folds `\ud800` to
  U+FFFD, so a `ts` cell of `"\ud800"` and a `rust` cell of `"\ufffd"`
  MEAN the same thing to the Go and Rust halves, which then refuse the
  row as recording no divergence. Measured: both halves were run against
  exactly that row. `tabnas_support::lone_surrogate_at` exists to refuse
  the same cell in a shared `test/spec` fixture. Pinned instead by
  `a_lone_surrogate_folds_to_the_replacement_character` in
  `tests/json5_test.rs`.
- **Anything needing non-default options.** The three register runners
  build one parser from the defaults and the file has no `opts` column.
  A hash-comment-only source under `hashComment` and `requireValue:
  false` is one such case: TypeScript yields no value where both ports
  yield the declared empty result. Recorded in the comments of
  `../test/spec/options.tsv`, beside the rows that DO hold.
- **Anything only THIS port diverges on.** `ts/test/divergent.test.ts`
  and `go/divergent_test.go` each compare their own column against ONE
  other (`ts` against `go`, and back), and the first thing each does is
  fail a row whose two columns agree. A row where TypeScript and Go
  agree and only Rust differs therefore fails both of those halves
  before either parses anything, however true it is. The nesting bound
  is that shape, and its input would otherwise fit a cell. Measured, not
  assumed: that check is `same(mine, theirs)` at the top of each loop.
  Recorded in `../DIVERGENCE.md` and pinned by
  `nesting_is_capped_at_the_budget_jsonic_installs` in
  `tests/json5_test.rs`, which asserts the Rust side alone. It becomes a
  row when those two halves read every runtime column, which is the same
  change that collapses this file's runner into
  `tabnas_support::Register`.
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
