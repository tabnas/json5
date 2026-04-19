.PHONY: all build test clean build-ts build-go test-ts test-go clean-ts clean-go reset

all: build test

build: build-ts build-go

test: test-ts test-go

clean: clean-ts clean-go

# TypeScript
build-ts:
	npm run build

test-ts:
	npm test

clean-ts:
	rm -rf dist dist-test

# Go
build-go:
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
