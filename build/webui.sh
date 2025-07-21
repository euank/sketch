#!/usr/bin/env bash
set -e

# Use a content-based hash of the webui dir to avoid unnecessary rebuilds.
OUTPUT_DIR="embedded/webui-dist"
# go:embed ignores files that start with a '.'
HASH_FILE="$OUTPUT_DIR/.input_hash"

calculate_input_hash() {
	local tmp=$(mktemp)
	(
		export GIT_INDEX_FILE="$tmp"
		git read-tree --empty
		git add webui/
		git write-tree
	)
	rm -f "$tmp"
}

CURRENT_HASH=$(calculate_input_hash)

if [ -f "$HASH_FILE" ] && [ -d "$OUTPUT_DIR" ]; then
	STORED_HASH=$(cat "$HASH_FILE")
	if [ "$CURRENT_HASH" = "$STORED_HASH" ]; then
		exit 0
	fi
fi

rm -rf "$OUTPUT_DIR"
unset GOOS GOARCH && go run ./cmd/genwebui -- "$OUTPUT_DIR"
echo "$CURRENT_HASH" >"$HASH_FILE"
