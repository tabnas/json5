# Build, test and publish both the TypeScript (ts/) and Go (go/)
# implementations. ts/ is canonical; go/ tracks it.
#
# Local build/test resolve the unpublished @tabnas siblings via the
# repo-set go.work + node_modules symlinks (admin/scripts/link.sh).

.PHONY: all build test clean build-ts build-go test-ts test-go \
        clean-ts clean-go publish-ts publish-go tags-go reset \
        gen-suite-expected check-suite-expected

all: build test

build: build-ts build-go

test: test-ts test-go

clean: clean-ts clean-go

# --- TypeScript (package in ts/) ---
build-ts:
	cd ts && npm run build

test-ts:
	cd ts && npm test

clean-ts:
	rm -rf ts/dist ts/dist-test

# Publish the TypeScript package at its current package.json version.
publish-ts: test-ts
	cd ts && npm publish --access public

# --- Go (module in go/) ---
build-go:
	cd go && go build ./...

# `go test` has no pretest hook (the TS side uses npm's), so verify the
# generated conformance oracle against the vendored corpus here too. Both
# suites FAIL LOUDLY if the corpus or the oracle is missing — never skip.
test-go: check-suite-expected
	# -count=1: the shared test/spec fixtures live outside the Go module, so
	# `go test` will happily serve a CACHED pass after they change.
	cd go && go test -count=1 -v ./...

# Regenerate / verify test/json5-tests-expected.json from test/json5-tests.
gen-suite-expected:
	node scripts/gen-json5-expected.js

check-suite-expected:
	node scripts/gen-json5-expected.js --check

clean-go:
	cd go && go clean

# Publish the Go module: make publish-go V=x.y.z
# Injects V into the Go `VERSION` const, commits, tags go/vX.Y.Z, and
# (when gh is available) creates a GitHub release.
publish-go: test-go
	@test -n "$(V)" || (echo "Usage: make publish-go V=x.y.z" && exit 1)
	sed -i.bak 's/^const VERSION = ".*"/const VERSION = "$(V)"/' go/json5.go
	rm -f go/json5.go.bak
	git add go/json5.go
	git commit -m "go: v$(V)"
	git tag go/v$(V)
	git push origin main go/v$(V)
	@command -v gh >/dev/null 2>&1 && gh release create go/v$(V) --title "go/v$(V)" --notes "Go module release v$(V)" || true

# List published Go module tags, newest first.
tags-go:
	git tag -l 'go/v*' --sort=-version:refname

reset:
	cd ts && npm run reset
	cd go && go clean -cache && go build ./... && go test -v ./...
