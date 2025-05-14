package git_tools

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func setupTestRepo(t *testing.T) string {
	// Create a temporary directory for the test repository
	tempDir, err := os.MkdirTemp("", "git-tools-test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}

	// Initialize a git repository
	cmd := exec.Command("git", "-C", tempDir, "init")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to initialize git repo: %v - %s", err, out)
	}

	// Configure git user
	cmd = exec.Command("git", "-C", tempDir, "config", "user.email", "test@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to configure git user email: %v - %s", err, out)
	}

	cmd = exec.Command("git", "-C", tempDir, "config", "user.name", "Test User")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to configure git user name: %v - %s", err, out)
	}

	return tempDir
}

func createAndCommitFile(t *testing.T, repoDir, filename, content string, stage bool) string {
	filePath := filepath.Join(repoDir, filename)
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	if stage {
		cmd := exec.Command("git", "-C", repoDir, "add", filename)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("Failed to add file: %v - %s", err, out)
		}

		cmd = exec.Command("git", "-C", repoDir, "commit", "-m", "Add "+filename)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("Failed to commit file: %v - %s", err, out)
		}

		// Get the commit hash
		cmd = exec.Command("git", "-C", repoDir, "rev-parse", "HEAD")
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("Failed to get commit hash: %v", err)
		}
		return string(out[:len(out)-1]) // Trim newline
	}

	return ""
}

func TestGitRawDiff(t *testing.T) {
	repoDir := setupTestRepo(t)
	defer os.RemoveAll(repoDir)

	// Create initial file
	initHash := createAndCommitFile(t, repoDir, "test.txt", "initial content\n", true)

	// Modify the file
	modHash := createAndCommitFile(t, repoDir, "test.txt", "initial content\nmodified content\n", true)

	// Test the diff between the two commits
	diff, err := GitRawDiff(repoDir, initHash, modHash)
	if err != nil {
		t.Fatalf("GitRawDiff failed: %v", err)
	}

	if len(diff) != 1 {
		t.Fatalf("Expected 1 file in diff, got %d", len(diff))
	}

	if diff[0].Path != "test.txt" {
		t.Errorf("Expected path to be test.txt, got %s", diff[0].Path)
	}

	if diff[0].Status != "M" {
		t.Errorf("Expected status to be M (modified), got %s", diff[0].Status)
	}

	if diff[0].OldMode == "" || diff[0].NewMode == "" {
		t.Error("Expected file modes to be present")
	}

	if diff[0].OldHash == "" || diff[0].NewHash == "" {
		t.Error("Expected file hashes to be present")
	}

	// Test with invalid commit hash
	_, err = GitRawDiff(repoDir, "invalid", modHash)
	if err == nil {
		t.Error("Expected error for invalid commit hash, got none")
	}
}

func TestGitShow(t *testing.T) {
	repoDir := setupTestRepo(t)
	defer os.RemoveAll(repoDir)

	// Create file and commit
	commitHash := createAndCommitFile(t, repoDir, "test.txt", "test content\n", true)

	// Test GitShow
	show, err := GitShow(repoDir, commitHash)
	if err != nil {
		t.Fatalf("GitShow failed: %v", err)
	}

	if show == "" {
		t.Error("Expected non-empty output from GitShow")
	}

	// Test with invalid commit hash
	_, err = GitShow(repoDir, "invalid")
	if err == nil {
		t.Error("Expected error for invalid commit hash, got none")
	}
}
