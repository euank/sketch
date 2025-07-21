#!/usr/bin/env bash
# Pre-receive hook for sketch git http server
# Handles refs/remotes/origin/Y pushes by forwarding them to origin/Y

set -e

# Timeout function for commands (macOS compatible)
# Usage: run_with_timeout <timeout_seconds> <command> [args...]
#
# This is here because OX X doesn't ship /usr/bin/timeout by default!?!?
run_with_timeout() {
    local timeout=$1
    shift

    # Run command in background and capture PID
    "$@" &
    local cmd_pid=$!

    # Start timeout killer in background
    (
        sleep "$timeout"
        if kill -0 "$cmd_pid" 2>/dev/null; then
            echo "Command timed out after ${timeout}s, killing process" >&2
            kill -TERM "$cmd_pid" 2>/dev/null || true
            sleep 2
            kill -KILL "$cmd_pid" 2>/dev/null || true
        fi
    ) &
    local killer_pid=$!

    # Wait for command to complete
    local exit_code=0
    if wait "$cmd_pid" 2>/dev/null; then
        exit_code=$?
    else
        exit_code=124  # timeout exit code
    fi

    # Clean up timeout killer
    kill "$killer_pid" 2>/dev/null || true
    wait "$killer_pid" 2>/dev/null || true

    return $exit_code
}

# Read stdin for ref updates
while read oldrev newrev refname; do
    # Check if this is a push to refs/remotes/origin/Y pattern
    if [[ "$refname" =~ ^refs/remotes/origin/(.+)$ ]]; then
        branch_name="${BASH_REMATCH[1]}"

        # Check if this is a force push by seeing if oldrev is not ancestor of newrev
        if [ "$oldrev" != "0000000000000000000000000000000000000000" ]; then
            # Check if this is a fast-forward (oldrev is ancestor of newrev)
            if ! git merge-base --is-ancestor "$oldrev" "$newrev" 2>/dev/null; then
                echo "Error: Force push detected to refs/remotes/origin/$branch_name" >&2
                echo "Force pushes are not allowed" >&2
                exit 1
            fi
        fi

        echo "Detected push to refs/remotes/origin/$branch_name" >&2

        # Verify HTTP_USER_AGENT is set to sketch-intentional-push for forwarding
        if [ "$HTTP_USER_AGENT" != "sketch-intentional-push" ]; then
            echo "Error: Unauthorized push to refs/remotes/origin/$branch_name" >&2
            exit 1
        fi

        echo "Authorization verified, forwarding to origin" >&2

        # Push to origin using the new commit with 10 second timeout
        # There's an innocous "ref updates forbidden inside quarantine environment" warning that we can ignore.
        if ! run_with_timeout 10 git push origin "$newrev:refs/heads/$branch_name"; then
            echo "Error: Failed to push $newrev to origin/$branch_name (may have timed out)" >&2
            exit 1
        fi

        echo "Successfully pushed to origin/$branch_name" >&2
    fi
done

exit 0
