.PHONY: all build test clean build-ts build-go test-ts test-go clean-ts clean-go embed reset

all: build test

build: build-ts build-go

test: test-ts test-go

clean: clean-ts clean-go

# Sync json5-grammar.jsonic into src/json5.ts and go/json5.go.
embed:
	node embed-grammar.js

# TypeScript
build-ts: embed
	npm run build

test-ts:
	npm test

clean-ts:
	rm -rf dist dist-test

# Go
build-go: embed
	cd go && go build ./...

test-go:
	cd go && go test ./...

clean-go:
	cd go && go clean -cache

reset:
	npm run reset
	cd go && go clean -cache
	cd go && go build ./...
	cd go && go test ./...
