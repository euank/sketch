// Package git_tools provides utilities for interacting with Git repositories.
package git_tools

import (
	"bufio"
	"fmt"
	"os/exec"
	"strings"
)

// DiffFile represents a file in a Git diff
type DiffFile struct {
	Path    string `json:"path"`
	OldMode string `json:"old_mode"`
	NewMode string `json:"new_mode"`
	OldHash string `json:"old_hash"`
	NewHash string `json:"new_hash"`
	Status  string `json:"status"` // A=added, M=modified, D=deleted, etc.
} // GitRawDiff returns a structured representation of the Git diff between two commits or references
func GitRawDiff(repoDir, from, to string) ([]DiffFile, error) {
	// Git command to generate the diff in raw format with full hashes
	cmd := exec.Command("git", "-C", repoDir, "diff", "--raw", "--abbrev=40", from, to)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("error executing git diff: %w - %s", err, string(out))
	}

	// Parse the raw diff output into structured format
	return parseRawDiff(string(out))
}

// GitShow returns the result of git show for a specific commit hash
func GitShow(repoDir, hash string) (string, error) {
	cmd := exec.Command("git", "-C", repoDir, "show", hash)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("error executing git show: %w - %s", err, string(out))
	}
	return string(out), nil
}

// parseRawDiff converts git diff --raw output into structured format
func parseRawDiff(diffOutput string) ([]DiffFile, error) {
	var files []DiffFile
	if diffOutput == "" {
		return files, nil
	}

	// Process diff output line by line
	scanner := bufio.NewScanner(strings.NewReader(strings.TrimSpace(diffOutput)))
	for scanner.Scan() {
		line := scanner.Text()
		// Format: :oldmode newmode oldhash newhash status\tpath
		// Example: :000000 100644 0000000000000000000000000000000000000000 6b33680ae6de90edd5f627c84147f7a41aa9d9cf A        git_tools/git_tools.go
		if !strings.HasPrefix(line, ":") {
			continue
		}

		parts := strings.Fields(line[1:]) // Skip the leading colon
		if len(parts) < 5 {
			continue // Not enough parts, skip this line
		}

		oldMode := parts[0]
		newMode := parts[1]
		oldHash := parts[2]
		newHash := parts[3]
		status := parts[4]

		// The path is everything after the status character and tab
		pathIndex := strings.Index(line, status) + len(status) + 1 // +1 for the tab
		path := ""
		if pathIndex < len(line) {
			path = strings.TrimSpace(line[pathIndex:])
		}

		files = append(files, DiffFile{
			Path:    path,
			OldMode: oldMode,
			NewMode: newMode,
			OldHash: oldHash,
			NewHash: newHash,
			Status:  status,
		})
	}

	return files, nil
}
