#!/usr/bin/env bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CURRENT_DIR=$(pwd)

cd "$SCRIPT_DIR"

go test -httprecord .
go test

cd "$CURRENT_DIR"
