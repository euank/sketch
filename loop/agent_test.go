package loop

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestAgentGitState_pushFailedRefLocked tests the failed ref push functionality
func TestAgentGitState_pushFailedRefLocked(t *testing.T) {
	// Create a temporary directory for our test git repo
	tmpDir, err := os.MkdirTemp("", "test-git-repo-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Configure git user
	cmd = exec.Command("git", "config", "user.name", "Test User")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to configure git user: %v", err)
	}

	cmd = exec.Command("git", "config", "user.email", "test@example.com")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to configure git email: %v", err)
	}

	// Create a commit
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	cmd = exec.Command("git", "add", "test.txt")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add test file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Test commit")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit: %v", err)
	}

	// Get the commit hash
	cmd = exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = tmpDir
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get commit hash: %v", err)
	}
	commitHash := strings.TrimSpace(string(output))

	// Create a bare repo to simulate the remote
	remoteDir, err := os.MkdirTemp("", "test-remote-repo-*")
	if err != nil {
		t.Fatalf("Failed to create remote temp dir: %v", err)
	}
	defer os.RemoveAll(remoteDir)

	cmd = exec.Command("git", "init", "--bare")
	cmd.Dir = remoteDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to init bare repo: %v", err)
	}

	// Test the pushFailedRefLocked function
	state := &AgentGitState{
		gitRemoteAddr: remoteDir, // Use file path as remote for testing
	}

	ctx := context.Background()
	originalBranch := "main-philip"

	// Call the function
	err = state.pushFailedRefLocked(ctx, tmpDir, commitHash, originalBranch)
	if err != nil {
		t.Fatalf("pushFailedRefLocked failed: %v", err)
	}

	// Verify the ref was created in the remote
	cmd = exec.Command("git", "show-ref")
	cmd.Dir = remoteDir
	output, err = cmd.Output()
	if err != nil {
		t.Fatalf("Failed to show refs: %v", err)
	}

	refsOutput := string(output)
	t.Logf("Remote refs: %s", refsOutput)

	// Check that a ref matching our pattern was created
	expectedPattern := "refs/queue/queue-main-philip-"
	if !strings.Contains(refsOutput, expectedPattern) {
		t.Errorf("Expected ref pattern %s not found in refs output: %s", expectedPattern, refsOutput)
	}

	// Verify the ref points to the correct commit
	lines := strings.Split(strings.TrimSpace(refsOutput), "\n")
	for _, line := range lines {
		if strings.Contains(line, expectedPattern) {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				refHash := parts[0]
				if refHash != commitHash {
					t.Errorf("Expected ref to point to %s, but it points to %s", commitHash, refHash)
				}
				break
			}
		}
	}
}

// TestAgentGitState_pushFailedRefLocked_NoRemote tests the function when no remote is configured
func TestAgentGitState_pushFailedRefLocked_NoRemote(t *testing.T) {
	state := &AgentGitState{
		gitRemoteAddr: "", // No remote
	}

	ctx := context.Background()
	err := state.pushFailedRefLocked(ctx, "/tmp", "abc123", "main-philip")
	if err != nil {
		t.Errorf("Expected no error when no remote is configured, got: %v", err)
	}
}

// TestAgentGitState_pushFailedRefLocked_EmptyHash tests with empty hash
func TestAgentGitState_pushFailedRefLocked_EmptyHash(t *testing.T) {
	state := &AgentGitState{
		gitRemoteAddr: "some-remote",
	}

	ctx := context.Background()
	err := state.pushFailedRefLocked(ctx, "/tmp", "", "main-philip")
	if err != nil {
		t.Errorf("Expected no error when hash is empty, got: %v", err)
	}
}

// TestTimestampFormat tests that our timestamp format matches the expected pattern
func TestTimestampFormat(t *testing.T) {
	// Test with a known time
	testTime := time.Date(2025, 6, 17, 16, 19, 0, 0, time.UTC)
	timestamp := testTime.Format("200601021504")
	expected := "202506171619"
	if timestamp != expected {
		t.Errorf("Expected timestamp %s, got %s", expected, timestamp)
	}
}
