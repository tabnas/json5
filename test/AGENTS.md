# Agents Guide — shared spec fixtures

`spec/*.tsv` holds the cross-runtime conformance fixtures. Both runtimes
auto-discover and run **every** file in this directory, so a change here
affects TypeScript and Go together — edit with that in mind.

## Format

Tab-separated, one case per line, with a header row naming the columns.
Blank lines are skipped, and so are comment lines — a line starting with
`#` that contains no tab. (A data row always has at least one tab, so a
`#`-leading source such as a C preprocessor directive still works.)

| Column | Meaning |
|---|---|
| `input` | JSON5 source. Escapes `\n` `\r` `\t` `\\` are decoded. |
| `expected` | A JSON value (the parse result), or `ERROR` / `ERROR:<code>` for inputs that must fail. The code is compared **exactly** — it is the error's code, not a substring of its message. |
| | JSON5 admits values JSON cannot spell, so `expected` also accepts the bare tokens `NaN`, `Infinity`, `-Infinity` and `UNDEFINED` (no value at all). |
| `opts` | Optional JSON object of plugin options (empty means defaults). |

`expected` and `opts` are **not** escape-decoded — they are raw JSON, so
JSON's own escape rules apply (`"a\nb"` is a string containing a newline).
To put a literal backslash in `input`, write `\\`.

Results are compared after a JSON round-trip, so key order and the
`OrderedMap` / null-prototype-object representations do not affect the
comparison.

## The divergence register — `test/divergent.tsv`

Separate from `spec/`, and read by `ts/test/divergent.test.ts` and
`go/divergent_test.go` rather than by the shared runner.

It records the places the two ports **disagree**, with a column per port,
and it is **not a fixture**. A fixture fails when behaviour regresses. This
fails **both ways**: when a port is repaired to agree with the other, the
row still claims they differ, so the suite goes red and names the row to
delete.

That difference is the whole point. A divergence recorded as a passing test
of current behaviour survives its own repair — the port is fixed, the test
is updated, and the record now describes something that no longer happens,
with nothing red. The 2026-08 fleet audit found 29 recorded claims
contradicted by execution, and a fixture would have preserved every one.

| column | meaning |
|---|---|
| `input` | JSON5 source, escape-decoded as in `spec/`. |
| `ts`, `go` | what each port produces: a JSON value, `ERROR:<code>`, or `ERROR:<code>@<row>:<col>` when the position is the disagreement. |
| `why` | the audit item, and where the repair lives. |

**Position is opt-in.** A cell with no `@row:col` is satisfied by any
position; one that has it is compared on both. Most rows here are about the
code, and pinning the column of every one would make the register fail on
changes it is not recording.

**Rows are measured, not transcribed.** Every current row was produced by
`tasks/ax-parity-probe.js` in the admin repo and then re-measured directly
in each port. Transcribing is how the 29 wrong claims were written.

When a row goes red saying **CLOSED**, delete it — and check whether the
other rows citing the same repair go with it. Do not edit it to match: that
records a divergence that no longer exists.

The runners are local for now. `@tabnas/support` gains this mechanism in
`tabnas/support#14`, and the vocabulary here is deliberately the one that PR
standardises, so adopting it deletes the two runners and leaves the fixture
untouched.

## Who runs what

- TypeScript: `ts/test/parity.test.ts` — `makeRunner(...).dir(...)`.
- Go: `go/parity_test.go` — `support.Runner{...}.Dir(t, dir)`.

Both are a dozen lines holding only what is specific to json5: how to
build the parser for a row's options. Everything else — finding
`test/spec`, reading the file, decoding escapes, the `ERROR:` contract,
the comparison, the `<file>:<line>` in a failure message — comes from
[`@tabnas/support`](https://github.com/tabnas/support) and its Go half, so
the two loaders cannot drift from each other either.

Both discover files by directory listing: adding a `.tsv` here runs it in
both runtimes without touching either runner. An empty fixture, and a spec
directory with no fixtures in it, both **fail** — a runner that reports
green having run nothing is indistinguishable from coverage that was never
there.

## Rules

- Prefer adding a fixture here over a one-off in-language assertion when a
  case is expressible as input → output. That is what keeps the two
  runtimes honest against each other.
- TypeScript is canonical. If the two runtimes disagree, the TS behaviour is
  the expected value — unless Go has exposed a genuine TS defect, in which
  case fix TS first and pin the corrected behaviour here.
- A new fixture must pass in BOTH runtimes: run `go test ./...` (from `go/`)
  and `npm test` (from `ts/`) before considering it done.
