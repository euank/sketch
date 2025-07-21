#!/usr/bin/env bash
set -e

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="${LDFLAGS:-}" -tags=innie -o embedded/sketch-linux/sketch-linux-amd64 ./cmd/sketch &
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="${LDFLAGS:-}" -tags=innie -o embedded/sketch-linux/sketch-linux-arm64 ./cmd/sketch &
wait
