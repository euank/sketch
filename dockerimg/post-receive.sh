#!/usr/bin/env bash
# Post-receive hook for sketch git http server
# Sets upstream tracking branch for sketch branches

set -e

while read oldrev newrev refname; do
	if [[ "$refname" =~ ^refs/heads/sketch/ ]]; then
		git branch --set-upstream-to="{{ .Upstream }}" "${refname#refs/heads/}"
	fi
done

exit 0
