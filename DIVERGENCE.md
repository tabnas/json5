# Divergences

TypeScript is the canonical implementation; the Go and Rust ports track
it. This file records where a runtime produces a **different result for
the same input**, and why the difference is allowed to stand.

Every entry carries a MEASURED table. The figures below were produced on
2026-09-21 by running the three runtimes on the same inputs: the
canonical through `ts/dist/json5.js`, Go through `Parse(j, src)` from a
scratch module that replaces `github.com/tabnas/json5/go` with this
`go/` by path, and Rust through `tabnas_json5::parse_with`.

A divergence a register row can express belongs in
[`test/divergent.tsv`](test/divergent.tsv), with a `rust` column, per
[`AGENTS.md`](AGENTS.md). Where an entry is not a row, it says why and
names what pins it instead, and whether that pin asserts one runtime or
all three. A hand measurement is a photograph of one day; only a row or
a test keeps a figure honest, so each entry says which it has.

## Column positions after an astral character (engine, Go and Rust)

The engine's token columns count characters, where the canonical
TypeScript engine counts UTF-16 code units, so every column after a
character outside the Basic Multilingual Plane is one further left.

| input | TypeScript | Go | Rust |
|---|---|---|---|
| `["😀" 1]` | `unexpected` at 1:7 | at 1:6 | at 1:6 |
| `["ab😀cd" 1]` | `unexpected` at 1:11 | at 1:10 | at 1:10 |

Argued upstream in `parser/DIVERGENCE.md` under "Column positions for
astral characters", and cited here rather than re-adjudicated. Both rows
are live in `test/divergent.tsv`, so all three runtimes execute them.

## An astral IdentifierStart opens a key in the ports, not in TypeScript

The same UTF-16 seam from the other side. The canonical text check asks
`isIdentifierStart(src[i])`, and `src[i]` on a JavaScript string is one
UTF-16 code unit, so a character outside the Basic Multilingual Plane
presents its high surrogate, which belongs to no Unicode letter
category, and the token is never claimed. Go and Rust read a whole
character and see the letter the specification names: ES5.1 7.6 makes an
`IdentifierStart` a `UnicodeLetter`, and U+1D49C MATHEMATICAL SCRIPT
CAPITAL A is `Lu`.

| input | TypeScript | Go | Rust |
|---|---|---|---|
| `{𝒜:1}` | `unexpected` at 1:2 | `{"𝒜":1}` | `{"𝒜":1}` |
| `{𝒜b:1}` | `unexpected` at 1:2 | `{"𝒜b":1}` | `{"𝒜b":1}` |
| `𝒜` with `strictValue: false` | `unexpected` at 1:1 | `"𝒜"` | `"𝒜"` |
| `{a:𝒜}` with `strictValue: false` | `unexpected` at 1:4 | `{"a":"𝒜"}` | `{"a":"𝒜"}` |
| `{a𝒜:1}` | `{"a𝒜":1}` | the same | the same |

The last row is the control: an astral character in a LATER position
agrees in all three, because by then the canonical check has claimed the
token and `decodeIdentifierName` walks code points.

The repair belongs in `ts/src/json5.ts`: a text check that reads a code
POINT would let the canonical accept what the specification describes,
and this entry would go. Until then the two ports are the ones that
match the specification and the canonical is the one that does not, so
neither port is changed to imitate the artifact.

The first two rows are live in `test/divergent.tsv`, so all three
runtimes execute them; the last row is live in `test/spec/keys.tsv`,
where all three agree. The two `strictValue: false` rows cannot be:
the three register runners each build one parser from the defaults and
the file has no `opts` column. Those two are pinned by
`an_astral_identifier_start_is_accepted_here_and_refused_by_typescript`
in `rs/tests/json5_test.rs`, which asserts the RUST side only; the
TypeScript and Go figures above were measured by hand on the date in the
header, not by a test.

## A lone surrogate escape folds to U+FFFD in both ports

A JavaScript string is UTF-16 and may hold an unpaired surrogate; a Go
`string` and a Rust `String` are UTF-8 and cannot.

| input | TypeScript | Go | Rust |
|---|---|---|---|
| `"\uD800"` | U+D800 | U+FFFD | U+FFFD |
| `"\uDFFF"` | U+DFFF | U+FFFD | U+FFFD |
| `"a\uD800b"` | `a` U+D800 `b` | `a` U+FFFD `b` | `a` U+FFFD `b` |
| `"\uDE00\uD83D"` | U+DE00 U+D83D | U+FFFD U+FFFD | U+FFFD U+FFFD |
| `"😀"` | U+1F600 | U+1F600 | U+1F600 |

The last row is the control: a well-formed PAIR is one astral character
in all three, not two folds.

The register cannot hold this one. Its cells are JSON values, and every
reader but JavaScript's folds `\ud800` to U+FFFD, so a `ts` cell of
`"\ud800"` and a `rust` cell of `"�"` MEAN the same thing to the Go
and Rust halves, which then refuse the row as recording no divergence.
Measured, not assumed: both halves were run against exactly that row.
`tabnas_support::lone_surrogate_at` exists to refuse the same cell in a
shared `test/spec` fixture. Pinned instead by
`a_lone_surrogate_folds_to_the_replacement_character` in
`rs/tests/json5_test.rs`, which asserts the RUST side only. Nothing in
`go/` or `ts/` pins these five inputs today, so the two columns above
are hand measurements taken on the date in the header, not assertions a
suite would catch drifting.

## A hash-comment-only source, with requireValue off

`hasValue` deliberately knows only the two slash comment forms, in all
three runtimes, so a `#` counts as the start of a value and the
`requireValue` guard does not fire. The source then reaches the rules,
where TypeScript falls out with no value at all and both ports answer
the grammar's declared empty result.

| input | options | TypeScript | Go | Rust |
|---|---|---|---|---|
| `# c` | `hashComment`, `requireValue: false` | no value | `null` | `null` |
| `# comment` | `hashComment` alone | `unexpected` | the same | the same |

The second row is the control, and it IS a shared fixture, executed by
all three runtimes: it is in `test/spec/options.tsv`, beside a comment
explaining why the first row is not. The register cannot hold the first
row either, because its three runners build one parser from the defaults
and the file has no `opts` column.

## Nesting is bounded in the Rust port

| input | TypeScript | Go | Rust |
|---|---|---|---|
| 127 nested `[` | 127 arrays | 127 arrays | 127 arrays |
| 128 nested `[` | 128 arrays | 128 arrays | `cancel` |
| 127 nested `{a:` | 127 objects | 127 objects | 127 objects |
| 128 nested `{a:` | 128 objects | 128 objects | `cancel` |
| 5,000 nested `[` | 5,000 arrays | 5,000 arrays | `cancel` |

The bound is `tabnas_jsonic`'s `DEPTH_LIMIT`, inherited by building on
`tabnas_jsonic::make()`; this plugin adds none of its own, and its
grammar document must not drop what jsonic set. It is the depth
`serde_json` accepts, and `tabnas_json` uses the same number, so the
Rust crates bound nesting alike.

The bound is for the CALLER's stack, not the parse loop. The engine's
parse is iterative, and so are `Value::unwrap_undefined` and
`Value::contains_undefined`, deliberately; `Value::to_json` is not, and
`Value` has no `Drop` of its own, so the derived one recurses too. Both
of those walk one frame per level, and both run outside this crate, in
the caller's stack rather than the parser's. A bound on depth is the
only thing between an untrusted source and that walk. TypeScript reaches
the same wall from the other side: 5,000 nested brackets parse, and
`JSON.stringify` on the result then throws `RangeError`, an exception
rather than an abort, so it needs no bound to stay safe.

The repair belongs upstream in `tabnas/parser`: an iterative drop and an
iterative `to_json` would let the number go.

The register cannot hold this one, and the reason is not the size of the
input: 128 brackets fit a cell. It is that `ts/test/divergent.test.ts`
and `go/divergent_test.go` each compare their own column against ONE
other (`ts` against `go`, `go` against `ts`), so a row where TypeScript
and Go agree and only Rust differs reads, to both of those halves, as a
row recording no divergence, and both fail it before running anything.
Measured: that is the first check each of them makes. A Rust-only
divergence becomes expressible when those two halves adopt
`tabnas_support::Register` over every runtime column, which is also what
`rs/tests/divergent_test.rs` is waiting for; that repair belongs to this
repository. Pinned meanwhile by
`nesting_is_capped_at_the_budget_jsonic_installs` in
`rs/tests/json5_test.rs`, which asserts the RUST side only: the
TypeScript and Go rows of the table above were measured by hand on the
date in the header.

## The no-value error carries no position in TypeScript

| input | TypeScript | Go | Rust |
|---|---|---|---|
| `//` | `json5_no_value`, no row or column | at 1:1 | at 1:1 |
| `` (empty) | `json5_empty`, no row or column | at 1:1 | at 1:1 |

The CODE agrees, and that is what `test/spec/options.tsv` pins; only the
position differs, because the canonical raises these two before the
lexer has a point to report. Both ports site them at the start of the
source. Recorded for completeness rather than as a defect: a caller
reading `row` and `col` gets a number from the ports and `undefined`
from the canonical.
