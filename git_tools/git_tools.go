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

// LogEntry represents a single entry in the git log
type LogEntry struct {
	Hash    string   `json:"hash"`    // The full commit hash
	Refs    []string `json:"refs"`    // References (branches, tags) pointing to this commit
	Subject string   `json:"subject"` // The commit subject/message
}

// GitRecentLog returns the recent commit log between the initial commit and HEAD
func GitRecentLog(repoDir string, initialCommitHash string) ([]LogEntry, error) {
	// Validate input
	if initialCommitHash == "" {
		return nil, fmt.Errorf("initial commit hash must be provided")
	}

	// Find merge-base of HEAD and initial commit
	cmdMergeBase := exec.Command("git", "-C", repoDir, "merge-base", "HEAD", initialCommitHash)
	mergeBase, err := cmdMergeBase.CombinedOutput()
	if err != nil {
		// If merge-base fails (which can happen in simple repos), use initialCommitHash
		return getGitLog(repoDir, initialCommitHash)
	}

	mergeBaseHash := strings.TrimSpace(string(mergeBase))
	if mergeBaseHash == "" {
		// If merge-base doesn't return a valid hash, use initialCommitHash
		return getGitLog(repoDir, initialCommitHash)
	}

	// Use the merge-base as the 'from' point
	return getGitLog(repoDir, mergeBaseHash)
}

// getGitLog gets the git log with the specified format using the provided fromCommit
func getGitLog(repoDir string, fromCommit string) ([]LogEntry, error) {
	// Check if fromCommit~10 exists (10 commits before fromCommit)
	checkCmd := exec.Command("git", "-C", repoDir, "rev-parse", "--verify", fromCommit+"~10")
	if err := checkCmd.Run(); err != nil {
		// If fromCommit~10 doesn't exist, use just fromCommit..HEAD as the range
		cmd := exec.Command("git", "-C", repoDir, "log", "-n", "1000", "--oneline", "--decorate", "--pretty=%H%x00%s%x00%d", fromCommit+"..HEAD")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("error executing git log: %w - %s", err, string(out))
		}
		return parseGitLog(string(out))
	}

	// Use fromCommit~10..HEAD range with the specified format for easy parsing
	cmd := exec.Command("git", "-C", repoDir, "log", "-n", "1000", "--oneline", "--decorate", "--pretty=%H%x00%s%x00%d", fromCommit+"~10..HEAD")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("error executing git log: %w - %s", err, string(out))
	}

	return parseGitLog(string(out))
}

// parseGitLog parses the output of git log with null-separated fields
func parseGitLog(logOutput string) ([]LogEntry, error) {
	var entries []LogEntry
	if logOutput == "" {
		return entries, nil
	}

	scanner := bufio.NewScanner(strings.NewReader(strings.TrimSpace(logOutput)))
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Split(line, "\x00")
		if len(parts) != 3 {
			continue // Skip malformed lines
		}

		hash := parts[0]
		subject := parts[1]
		decoration := parts[2]

		// Parse the refs from the decoration
		refs := parseRefs(decoration)

		entries = append(entries, LogEntry{
			Hash:    hash,
			Refs:    refs,
			Subject: subject,
		})
	}

	return entries, nil
}

// parseRefs extracts references from git decoration format
func parseRefs(decoration string) []string {
	// The decoration format from %d is: (HEAD -> main, origin/main, tag: v1.0.0)
	if decoration == "" {
		return nil
	}

	// Remove surrounding parentheses and whitespace
	decoration = strings.TrimSpace(decoration)
	decoration = strings.TrimPrefix(decoration, " (")
	decoration = strings.TrimPrefix(decoration, "(")
	decoration = strings.TrimSuffix(decoration, ")")
	decoration = strings.TrimSuffix(decoration, ") ")

	if decoration == "" {
		return nil
	}

	// Split by comma
	parts := strings.Split(decoration, ", ")

	// Process each part
	var refs []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		// Handle HEAD -> branch format
		if strings.HasPrefix(part, "HEAD -> ") {
			refs = append(refs, strings.TrimPrefix(part, "HEAD -> "))
			continue
		}

		// Handle tag: format
		if strings.HasPrefix(part, "tag: ") {
			refs = append(refs, strings.TrimPrefix(part, "tag: "))
			continue
		}

		// Handle just HEAD (no branch)
		if part == "HEAD" {
			refs = append(refs, part)
			continue
		}

		// Regular branch name
		refs = append(refs, part)
	}

	return refs
}
