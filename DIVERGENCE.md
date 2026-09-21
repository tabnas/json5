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

Recording a difference here asserts that it CANNOT be repaired. Where
the canonical is simply wrong, the repair belongs in `ts/src/json5.ts`
and the rows belong in a shared fixture. An entry whose own prose names
a fixable defect is a false claim of impossibility, and it is worse than
no entry at all, because other ports copy from this file. Two such
entries stood here until 2026-09-21.

The first: an astral `IdentifierStart` opened a key in Go and Rust and
was refused by the canonical, whose text check read one UTF-16 code unit
and so saw a high surrogate. The check reads a code point now, the four
inputs are rows of `test/spec/keys.tsv` and `test/spec/options.tsv`, and
the entry is gone.

The second: with `hashComment` on and `requireValue` off, a
hash-comment-only source answered `undefined` in the canonical and the
declared empty result in both ports, because the canonical's no-value
scan knew the two slash comment forms and not `#`. The entry parked the
repair on the claim that teaching the scan the hash form would also turn
the `requireValue` control row from `unexpected` into `json5_no_value`.
That claim was wrong, and measuring it is what showed so: the canonical
calls the scan from two SEPARATE `requireValue` branches, so the OFF
branch could be told about `#` while the ON branch kept the slash-only
scan its control needs. The canonical was repaired, the
control was re-measured unchanged in all three runtimes, and the rows
are now in `test/spec/options.tsv` -- including the two controls, the
one that keeps `# comment` at `unexpected` under `requireValue` and the
one that keeps `#` a non-value when `hashComment` is off.

Audited 2026-09-21, entry by entry: every table below is executed in all
three runtimes, either as a register row or by a named test per column.
No figure in this file rests on a hand measurement alone.

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
shared `test/spec` fixture. Pinned instead by one test per column, so
every figure above is executed:
`a_lone_surrogate_folds_to_the_replacement_character` in
`rs/tests/json5_test.rs`, `lone-surrogate-survives-as-a-code-unit` in
`ts/test/json5.test.ts`, and
`TestLoneSurrogateFoldsToTheReplacementCharacter` in
`go/json5_test.go`. The TypeScript one compares code UNITS, since the
difference it records is invisible to a value comparison that has
already folded the surrogate.

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
repository. Pinned meanwhile by one test per column, so every figure
above is executed: `nesting_is_capped_at_the_budget_jsonic_installs` in
`rs/tests/json5_test.rs` for the bound at 127 and 128, which also WALKS
the accepted 127 to its floor so the two "127" figures are read and not
merely parsed, and
`nesting_far_past_the_budget_is_refused_rather_than_run` in
`rs/tests/untrusted_test.rs` for the 5,000 row, which is named in its
depth list rather than bracketed by its neighbours; `nesting-is-unbounded`
in `ts/test/json5.test.ts` and `TestNestingIsUnbounded` in
`go/json5_test.go` for the absence of one. Those last two walk the
parsed tree to its floor rather than only checking that the parse
returned, so a runtime that silently truncated at some depth would fail
them.

That last sentence was written here on 2026-09-21 and was only half
true when it was written. The TypeScript test walked both halves; the Go
test walked the array half and checked the object half for nothing but
`err == nil`, so a Go regression that accepted 5,000 nested objects and
truncated the value would have kept this column green. The Go object
half walks the `a` chain to its scalar leaf now, and asserts the depth
and the leaf, which is what the sentence always claimed.

## The no-value error carries no position in TypeScript

| input | TypeScript | Go | Rust |
|---|---|---|---|
| `//` | `json5_no_value`, no row or column | at 1:1 | at 1:1 |
| `` (empty) | `json5_empty`, no row or column | at 1:1 | at 1:1 |

The CODE agrees, and that is what `test/spec/options.tsv` pins; only the
position differs, because the canonical raises these two before the
lexer has a point to report. Both ports site them at the start of the
source. Recorded for completeness rather than as a defect.

The fields are not spelled alike, and the pins have to read the right
ones. The canonical's errors carry a position as `lineNumber` and
`columnNumber`; `row` and `col` are undefined on an ORDINARY positioned
canonical error too, so a pin asserting THOSE undefined here asserts
nothing at all and would stay green through the very change this entry
records. Measured 2026-09-21: `["a" 1]` gives `lineNumber` 1 and
`columnNumber` 6, and `row` and `col` absent; `//` gives all four
absent. Go's `*jsonic.JsonicError` carries `Row` and `Col`, and Rust's
`Json5Error` carries `row` and `col`; both are 1 and 1 for these two
inputs.

No fixture column carries a position, so the position is pinned by one
test per column: `the_no_value_errors_carry_a_position` in
`rs/tests/json5_test.rs`, `the-no-value-errors-carry-no-position` in
`ts/test/json5.test.ts`, and `TestTheNoValueErrorsCarryAPosition` in
`go/json5_test.go`.
