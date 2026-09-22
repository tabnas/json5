# ci/

Staging area for GitHub Actions workflow changes.

This directory exists because session credentials cannot write
`.github/workflows/*` — see admin `DECISIONS.md` ADR-8. To change CI:

1. Put the intended workflow file in `workflows/`.
2. A maintainer promotes it with the admin `rollout/apply-ci-folders.sh`
   script.

## Promoted, 2026-09-22

Both files that were staged here are now live, moved by the rollout
script rather than edited: `workflows/docs.yml` is
`.github/workflows/docs.yml` and `workflows/rust.yml` is
`.github/workflows/rust.yml`. Nothing is pending. Read the workflows
themselves rather than a description of them here.

Two notes the promotion settled, kept because each was an open question
while the files sat here:

- `dtolnay/rust-toolchain` was referenced by tag while every other action
  was SHA-pinned. It is pinned by digest now, in the promoted file.
- `rust.yml` still opens with a header calling itself PROPOSED and
  telling the reader to move it into `.github/workflows/`, which is where
  it already is. The rollout moves files and does not rewrite their
  comments, and a session cannot edit `.github/workflows/*` to correct
  it, so the fix is a staged copy here and another rollout run.

## What still lives here

- **`rust/run.sh`** is the Rust gate itself: formatting, build, the
  shared fixtures, the vendored json5-tests corpus, doctests, clippy, and
  a lockfile check that exempts only the sibling crates' versions, on the
  MSRV pinned in `rs/Cargo.toml`. `.github/workflows/rust.yml` runs this
  file and so can you, which is what keeps the local and hosted runs from
  drifting apart. It clones nothing: the crate takes `tabnas/parser`,
  `tabnas/json`, `tabnas/jsonic` and `tabnas/support` as path
  dependencies, so it expects them checked out beside this repository and
  says so when they are missing. `make test-rs` is the fast local loop.
