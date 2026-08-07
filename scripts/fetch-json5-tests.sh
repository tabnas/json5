#!/usr/bin/env bash
#
# Fetch the official JSON5 conformance corpus.
#
#   upstream: https://github.com/json5/json5-tests
#   pinned:   ceb24d4080137d70833f86c25659c1331b80a387  (2026-02-20)
#
# The corpus is a THIRD-PARTY test suite and is deliberately NOT committed to
# this repository (project rule: never vendor a third-party corpus). It is
# fetched into `test/json5-tests/`, which is .gitignore'd, exactly as toml/
# does for BurntSushi/toml-test and xml/ does for the W3C XML suite. The
# expected-VALUE oracle `test/json5-tests-expected.json` is regenerated at the
# same time.
#
# This is a thin wrapper: the implementation lives in fetch-json5-tests.js so
# that ts/package.json's `pretest` hook can run the exact same fetch on Linux,
# macOS and Windows. Keeping one implementation is what guarantees the corpus
# is never absent at test time.
#
# Idempotent. Usage:  scripts/fetch-json5-tests.sh
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/fetch-json5-tests.js" "$@"
