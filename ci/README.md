# ci/

The scripts the CI workflows run, kept here so that you can run them
too. See "What still lives here" below.

To change CI, edit `.github/workflows/` in a reviewed pull request.
Session credentials push workflow files (admin `DECISIONS.md` ADR-8, as
amended 2026-09-24), so staging a workflow here first for a maintainer
to promote is optional. Sessions still cannot push tags, so a maintainer
pushes any tag that a tag-triggered workflow needs.

The amendment also asks for the same change in `tabnas/admin` wherever
admin keeps a copy of the workflow:

- If admin's `rollout/workflows/` holds a `json5__<file>` template
  for the workflow you changed, make the same edit there. Admin
  `scripts/verify.sh` compares each template with its deployed copy, and
  a maintainer's `rollout/apply-workflows.sh --apply` would push the
  older text back over yours.
- `clib.yml` and `clib-release.yml` are stamped from admin
  `tasks/clib-template/` and carry a `tabnas-clib-template` marker.
  Change the template, then restamp with admin `tasks/adopt-clib.sh`
  and move the `ci/clib*.yml` it writes over the copies in
  `.github/workflows/`, leaving no `ci/*.yml` behind. Never edit the
  copies here.

## Promoted, 2026-09-22

Both files that were staged here are now live, moved by the rollout
script rather than edited: `workflows/docs.yml` is
`.github/workflows/docs.yml` and `workflows/rust.yml` is
`.github/workflows/rust.yml`. Nothing is pending. Read the workflows
themselves rather than a description of them here.

Two notes the promotion settled, kept because each was an open question
while the files sat here:

- `dtolnay/rust-toolchain` was referenced by tag while every other action
  was SHA-pinned. It was pinned by digest in the promoted file, and has
  since been replaced by `rustup` on the runner, because these
  repositories allow only GitHub-owned and verified-creator actions (the
  comment in `rust.yml` has the detail).
- `rust.yml` opened with a header calling itself PROPOSED and telling
  the reader to move it into `.github/workflows/`, which is where it
  already was: the rollout moves files and does not rewrite their
  comments. The header was corrected in place once ADR-8's amendment let
  a session edit the live file.

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
