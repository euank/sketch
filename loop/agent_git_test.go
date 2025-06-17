package loop

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestGitCommitTracking tests the git commit tracking functionality
func TestGitCommitTracking(t *testing.T) {
	// Create a temporary directory for our test git repo
	tempDir := t.TempDir() // Automatically cleaned up when the test completes

	// Initialize a git repo in the temp directory
	cmd := exec.Command("git", "init")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to initialize git repo: %v", err)
	}

	// Configure git user for commits
	cmd = exec.Command("git", "config", "user.name", "Test User")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to configure git user name: %v", err)
	}

	cmd = exec.Command("git", "config", "user.email", "test@example.com")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to configure git user email: %v", err)
	}

	// Make an initial commit
	testFile := filepath.Join(tempDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("initial content\n"), 0o644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	cmd = exec.Command("git", "add", "test.txt")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Initial commit")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to make initial commit: %v", err)
	}

	// Get the current commit hash
	cmd = exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = tempDir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get commit hash: %v", err)
	}
	initialCommit := strings.TrimSpace(string(out))
	// Set up sketch-base
	cmd = exec.Command("git", "tag", "sketch-base", initialCommit)
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create sketch-base tag: %v", err)
	}

	// Create and switch to sketch-wip branch
	cmd = exec.Command("git", "checkout", "-b", "sketch-wip")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create sketch-wip branch: %v", err)
	}

	// Create a test scenario where we have commits to track
	gitState := &AgentGitState{
		seenCommits: make(map[string]bool),
	}

	// Run handleGitCommits on the repo
	ctx := context.Background()
	sessionID := "test-session"
	baseRef := "sketch-base"
	branchPrefix := "sketch"

	msgs, commits, err := gitState.handleGitCommits(ctx, sessionID, tempDir, baseRef, branchPrefix)
	if err != nil {
		t.Fatalf("handleGitCommits failed: %v", err)
	}

	// We should have no messages since no remote is configured
	if len(msgs) != 0 {
		t.Errorf("Expected no messages, got %d", len(msgs))
	}

	// We should have no commits since there are no new commits
	if len(commits) != 0 {
		t.Errorf("Expected no commits, got %d", len(commits))
	}

	// Now make a new commit and test again
	if err := os.WriteFile(testFile, []byte("updated content\n"), 0o644); err != nil {
		t.Fatalf("Failed to update file: %v", err)
	}

	cmd = exec.Command("git", "add", "test.txt")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add updated file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Update on sketch-wip branch")
	cmd.Dir = tempDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create commit on sketch-wip branch: %v", err)
	}

	// Verify that the commit exists on the sketch-wip branch
	cmd = exec.Command("git", "log", "--oneline", "-n", "1")
	cmd.Dir = tempDir
	out, err = cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get git log: %v", err)
	}

	logOutput := string(out)
	if !strings.Contains(logOutput, "Update on sketch-wip branch") {
		t.Errorf("Expected commit 'Update on sketch-wip branch' in log, got: %s", logOutput)
	}
}

// TestMergeQueueFailure tests the merge queue failure functionality
func TestMergeQueueFailure(t *testing.T) {
	// Test the functionality without complex git setup
	gitState := &AgentGitState{
		gitRemoteAddr: "", // No remote configured
		seenCommits:   make(map[string]bool),
	}

	ctx := context.Background()
	failedHash := "abcd1234567890abcd1234567890abcd12345678"
	originalBranch := "main-philip"

	// Test error case: no remote configured
	err := gitState.PushFailedMergeQueueHash(ctx, "/tmp", failedHash, originalBranch)
	if err == nil {
		t.Error("Expected error when no remote address configured, but got nil")
	}
	if !strings.Contains(err.Error(), "no git remote address configured") {
		t.Errorf("Expected error about no remote address, got: %v", err)
	}

	// Test with remote configured (but this will fail due to invalid remote)
	gitState.gitRemoteAddr = "https://invalid-remote.git"
	err = gitState.PushFailedMergeQueueHash(ctx, "/tmp", failedHash, originalBranch)
	if err == nil {
		t.Error("Expected error when pushing to invalid remote, but got nil")
	}
	// The error should mention the push failure
	if !strings.Contains(err.Error(), "failed to push merge queue failure") {
		t.Errorf("Expected error about push failure, got: %v", err)
	}
}
