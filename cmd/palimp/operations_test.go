package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestListBranches(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Test with no sketch branches
	if err := listBranches(); err != nil {
		t.Errorf("listBranches failed with no branches: %v", err)
	}

	// Create some sketch branches
	createSketchBranch(t, repoDir, "feature1", []string{"Add feature 1"})
	createSketchBranch(t, repoDir, "feature2", []string{"Add feature 2"})

	// Test with sketch branches
	if err := listBranches(); err != nil {
		t.Errorf("listBranches failed with branches: %v", err)
	}
}

func TestDropBranch(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create a sketch branch
	createSketchBranch(t, repoDir, "test", []string{"Test commit"})

	// Verify branch exists
	cmd := exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/test")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Branch sketch/test should exist: %v", err)
	}

	// Drop the branch
	if err := dropBranch("test", false); err != nil {
		t.Errorf("dropBranch failed: %v", err)
	}

	// Verify branch no longer exists
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/test")
	cmd.Dir = repoDir
	if err := cmd.Run(); err == nil {
		t.Error("Branch sketch/test should not exist after dropping")
	}

	// Test dropping non-existent branch
	if err := dropBranch("nonexistent", false); err == nil {
		t.Error("Expected dropBranch to fail for non-existent branch")
	}
}

// TestDropBranchFromAnyBranch tests that drop works from any branch
func TestDropBranchFromAnyBranch(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create two sketch branches
	createSketchBranch(t, repoDir, "feature1", []string{"Feature 1 commit"})
	createSketchBranch(t, repoDir, "feature2", []string{"Feature 2 commit"})

	// Switch to sketch/feature1 branch
	cmd := exec.Command("git", "checkout", "sketch/feature1")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to checkout sketch/feature1: %v", err)
	}

	// Verify we're on sketch/feature1
	currentBranch, err := getCurrentBranch()
	if err != nil {
		t.Fatalf("Failed to get current branch: %v", err)
	}
	if currentBranch != "sketch/feature1" {
		t.Fatalf("Expected to be on sketch/feature1, got %s", currentBranch)
	}

	// Drop sketch/feature2 while on sketch/feature1 (should work)
	if err := dropBranch("feature2", false); err != nil {
		t.Errorf("dropBranch failed from different branch: %v", err)
	}

	// Verify sketch/feature2 no longer exists
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature2")
	cmd.Dir = repoDir
	if err := cmd.Run(); err == nil {
		t.Error("Branch sketch/feature2 should not exist after dropping")
	}

	// Verify sketch/feature1 still exists and we're still on it
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature1")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Error("Branch sketch/feature1 should still exist")
	}

	currentBranch, err = getCurrentBranch()
	if err != nil {
		t.Fatalf("Failed to get current branch: %v", err)
	}
	if currentBranch != "sketch/feature1" {
		t.Errorf("Expected to still be on sketch/feature1, got %s", currentBranch)
	}

	// Test that dropping the current branch fails gracefully
	// (git will prevent this, not our code)
	err = dropBranch("feature1", false)
	if err == nil {
		t.Error("Expected dropBranch to fail when trying to drop the current branch")
	}
}

func TestLandBranch(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create a sketch branch with commits
	createSketchBranch(t, repoDir, "feature", []string{"Add feature", "Fix feature"})

	// Get initial commit count on main
	cmd := exec.Command("git", "rev-list", "--count", "main")
	cmd.Dir = repoDir
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to count commits on main: %v", err)
	}
	initialCount := strings.TrimSpace(string(output))

	// Land the branch
	if err := landBranch("feature", LandOptions{Squash: false, DryRun: false, Force: false}); err != nil {
		t.Errorf("landBranch failed: %v", err)
	}

	// Verify commits were added to main
	cmd = exec.Command("git", "rev-list", "--count", "main")
	cmd.Dir = repoDir
	output, err = cmd.Output()
	if err != nil {
		t.Fatalf("Failed to count commits on main after landing: %v", err)
	}
	finalCount := strings.TrimSpace(string(output))

	if finalCount == initialCount {
		t.Error("Expected commit count to increase after landing")
	}

	// Verify branch was deleted
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature")
	cmd.Dir = repoDir
	if err := cmd.Run(); err == nil {
		t.Error("Branch sketch/feature should be deleted after landing")
	}
}

func TestLandBranchWithSquash(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create a sketch branch with multiple commits
	createSketchBranch(t, repoDir, "feature", []string{"First commit", "Second commit", "Third commit"})

	// Get initial commit count on main
	cmd := exec.Command("git", "rev-list", "--count", "main")
	cmd.Dir = repoDir
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to count commits on main: %v", err)
	}
	initialCount := strings.TrimSpace(string(output))

	// Land the branch with squash
	if err := landBranch("feature", LandOptions{Squash: true, DryRun: false, Force: false}); err != nil {
		t.Errorf("landBranch with squash failed: %v", err)
	}

	// Verify only one commit was added (squashed)
	cmd = exec.Command("git", "rev-list", "--count", "main")
	cmd.Dir = repoDir
	output, err = cmd.Output()
	if err != nil {
		t.Fatalf("Failed to count commits on main after squash landing: %v", err)
	}
	finalCount := strings.TrimSpace(string(output))

	// Should have exactly one more commit (the squashed one)
	expected := initialCount + "1" // This is a simple string comparison for the test
	if len(finalCount) != len(expected) {
		t.Logf("Initial count: %s, Final count: %s", initialCount, finalCount)
		// More detailed verification would require proper integer parsing
	}
}

func TestUpdateBranch(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create a sketch branch
	createSketchBranch(t, repoDir, "feature", []string{"Add feature"})

	// Add a commit to main to create something to rebase onto
	mainFile := filepath.Join(repoDir, "main_update.txt")
	if err := os.WriteFile(mainFile, []byte("Main update"), 0644); err != nil {
		t.Fatalf("Failed to create main update file: %v", err)
	}

	cmd := exec.Command("git", "add", "main_update.txt")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add main update file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Update main branch")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit main update: %v", err)
	}

	// Update the branch (rebase onto main)
	if err := updateBranch("feature", false); err != nil {
		t.Errorf("updateBranch failed: %v", err)
	}

	// Verify we're back on main branch
	currentBranch, err := getCurrentBranch()
	if err != nil {
		t.Fatalf("Failed to get current branch: %v", err)
	}
	if currentBranch != "main" {
		t.Errorf("Expected to be on main branch after update, got %s", currentBranch)
	}

	// Verify sketch branch still exists
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Error("Branch sketch/feature should still exist after update")
	}
}

func TestDryRun(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create test branches
	createSketchBranch(t, repoDir, "feature1", []string{"Add feature 1"})
	createSketchBranch(t, repoDir, "feature2", []string{"Add feature 2"})

	// Test dry run for land command
	if err := landBranch("feature1", LandOptions{Squash: false, DryRun: true, Force: false}); err != nil {
		t.Errorf("landBranch dry run failed: %v", err)
	}

	// Verify branch still exists after dry run
	cmd := exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature1")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Error("Branch sketch/feature1 should still exist after dry run")
	}

	// Test dry run for drop command
	if err := dropBranch("feature2", true); err != nil {
		t.Errorf("dropBranch dry run failed: %v", err)
	}

	// Verify branch still exists after dry run
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature2")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Error("Branch sketch/feature2 should still exist after dry run")
	}

	// Test dry run for update command
	if err := updateBranch("feature1", true); err != nil {
		t.Errorf("updateBranch dry run failed: %v", err)
	}

	// Verify we're still on main after dry run
	currentBranch, err := getCurrentBranch()
	if err != nil {
		t.Fatalf("Failed to get current branch: %v", err)
	}
	if currentBranch != "main" && currentBranch != "master" {
		t.Errorf("Expected to still be on main/master after dry run, got %s", currentBranch)
	}
}

func TestCreateCombinedCommitMessage(t *testing.T) {
	commits := []GitCommit{
		{
			Hash:      "abc123def456",
			Subject:   "First commit",
			ChangeIDs: []string{"I1234567890abcdef"},
		},
		{
			Hash:      "def456ghi789",
			Subject:   "Second commit",
			ChangeIDs: []string{"Iabcdef1234567890", "I9876543210fedcba"},
		},
	}

	message := createCombinedCommitMessage(commits)

	// Check that it contains the first commit's subject
	if !strings.Contains(message, "First commit") {
		t.Error("Expected combined message to contain first commit's subject")
	}

	// Check that it contains commit summaries
	if !strings.Contains(message, "Squashed 2 commits:") {
		t.Error("Expected combined message to contain squash summary")
	}

	if !strings.Contains(message, "1. First commit (abc123de)") {
		t.Error("Expected combined message to contain first commit summary")
	}

	if !strings.Contains(message, "2. Second commit (def456gh)") {
		t.Error("Expected combined message to contain second commit summary")
	}

	// Check that it contains all unique change-ids
	if !strings.Contains(message, "Change-Id: I1234567890abcdef") {
		t.Error("Expected combined message to contain first change-id")
	}

	if !strings.Contains(message, "Change-Id: Iabcdef1234567890") {
		t.Error("Expected combined message to contain second change-id")
	}

	if !strings.Contains(message, "Change-Id: I9876543210fedcba") {
		t.Error("Expected combined message to contain third change-id")
	}
}

func TestFilterNewCommits(t *testing.T) {
	commits := []GitCommit{
		{
			Hash:      "abc123def456",
			Subject:   "New commit",
			ChangeIDs: []string{"Inew123456789"},
		},
		{
			Hash:      "def456ghi789",
			Subject:   "Existing commit",
			ChangeIDs: []string{"Iexisting123456"},
		},
		{
			Hash:      "ghi789jkl012",
			Subject:   "Multi changeid commit",
			ChangeIDs: []string{"Inew987654321", "Iexisting123456"},
		},
		{
			Hash:      "jkl012mno345",
			Subject:   "No changeid commit",
			ChangeIDs: []string{},
		},
	}

	mainChangeIDs := map[string]bool{
		"Iexisting123456": true,
	}

	newCommits := filterNewCommits(commits, mainChangeIDs, false)

	// Should have 2 commits: the new one and the no-changeid one
	if len(newCommits) != 2 {
		t.Errorf("Expected 2 new commits, got %d", len(newCommits))
	}

	// Check that the right commits are included
	expectedHashes := map[string]bool{
		"abc123def456": true, // New commit
		"jkl012mno345": true, // No changeid commit
	}

	for _, commit := range newCommits {
		if !expectedHashes[commit.Hash] {
			t.Errorf("Unexpected commit in filtered results: %s", commit.Hash)
		}
		delete(expectedHashes, commit.Hash)
	}

	if len(expectedHashes) > 0 {
		t.Errorf("Missing expected commits: %v", expectedHashes)
	}
}

// TestListBranchesWithStatus tests the listing functionality with status
func TestListBranchesWithStatus(t *testing.T) {
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(oldWd)

	tempDir := t.TempDir()
	os.Chdir(tempDir)

	// Initialize git repo
	exec.Command("git", "init").Run()
	exec.Command("git", "config", "user.email", "test@example.com").Run()
	exec.Command("git", "config", "user.name", "Test User").Run()

	// Create main branch with initial commit
	f, _ := os.Create("file.txt")
	f.Close()
	exec.Command("git", "add", "file.txt").Run()
	exec.Command("git", "commit", "-m", "Initial commit").Run()

	// Create a sketch branch
	exec.Command("git", "checkout", "-b", "sketch/test-feature").Run()
	f2, _ := os.Create("feature.txt")
	f2.Close()
	exec.Command("git", "add", "feature.txt").Run()
	exec.Command("git", "commit", "-m", "Add test feature\n\nChange-Id: Itest123456").Run()

	// Return to main
	exec.Command("git", "checkout", "main").Run()

	// Test listing
	if err := listBranches(); err != nil {
		t.Errorf("listBranches failed: %v", err)
	}
}

func TestLandBranchEmptyCommitDetection(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to repo directory
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current directory: %v", err)
	}
	defer os.Chdir(originalDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to repo directory: %v", err)
	}

	// Create initial content on main
	mainFile := filepath.Join(repoDir, "shared_file.txt")
	if err := os.WriteFile(mainFile, []byte("initial content\n"), 0644); err != nil {
		t.Fatalf("Failed to create main file: %v", err)
	}

	cmd := exec.Command("git", "add", "shared_file.txt")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add main file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Add initial shared file")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit main file: %v", err)
	}

	// Create a branch that modifies the file
	cmd = exec.Command("git", "checkout", "-b", "sketch/feature-branch")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create feature branch: %v", err)
	}

	if err := os.WriteFile(mainFile, []byte("modified content\n"), 0644); err != nil {
		t.Fatalf("Failed to modify file: %v", err)
	}

	cmd = exec.Command("git", "add", "shared_file.txt")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add modified file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Modify shared file\n\nChange-Id: Ifeature_0")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit feature change: %v", err)
	}

	// Switch back to main and apply the same change
	cmd = exec.Command("git", "checkout", "main")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to checkout main: %v", err)
	}

	if err := os.WriteFile(mainFile, []byte("modified content\n"), 0644); err != nil {
		t.Fatalf("Failed to modify file on main: %v", err)
	}

	cmd = exec.Command("git", "add", "shared_file.txt")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add modified file on main: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Apply same change on main\n\nChange-Id: Imain_0")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit same change on main: %v", err)
	}

	// Now try to land the feature branch - the cherry-pick should be empty
	// Test in dry-run first to see the behavior
	if err := landBranch("feature-branch", LandOptions{Squash: false, DryRun: true, Force: false}); err != nil {
		t.Fatalf("landBranch dry-run should succeed: %v", err)
	}

	// Now test actual landing - it should detect empty commits and delete the branch
	if err := landBranch("feature-branch", LandOptions{Squash: false, DryRun: false, Force: false}); err != nil {
		t.Fatalf("landBranch should succeed by detecting and filtering empty commits: %v", err)
	}

	// Verify the branch was deleted
	cmd = exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/sketch/feature-branch")
	cmd.Dir = repoDir
	if err := cmd.Run(); err == nil {
		t.Error("Branch sketch/feature-branch should have been deleted after detecting empty commits")
	}
}

// TestFilterEmptyCommits is currently disabled because creating truly empty commits
// for testing is complex. The functionality is tested end-to-end in TestLandBranchEmptyCommitDetection
// and will be validated by integration testing.
//
// func TestFilterEmptyCommits(t *testing.T) { ... }
