#!/usr/bin/env bash
set -e

# Note: This incantation is duplicated in .goreleaser.yml; please keep them in sync.
go build -ldflags="${LDFLAGS:-}" -tags=outie -o sketch ./cmd/sketch
