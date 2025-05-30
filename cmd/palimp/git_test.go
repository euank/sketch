package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// setupTestRepo creates a temporary git repository for testing
func setupTestRepo(t *testing.T) (string, func()) {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "palimp-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	cleanup := func() {
		os.RemoveAll(tmpDir)
	}

	// Initialize git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		cleanup()
		t.Fatalf("Failed to init git repo: %v", err)
	}

	// Set git config
	cmds := [][]string{
		{"git", "config", "user.name", "Test User"},
		{"git", "config", "user.email", "test@example.com"},
		{"git", "config", "init.defaultBranch", "main"},
	}

	for _, cmdArgs := range cmds {
		cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
		cmd.Dir = tmpDir
		if err := cmd.Run(); err != nil {
			cleanup()
			t.Fatalf("Failed to run %v: %v", cmdArgs, err)
		}
	}

	// Create initial commit on main branch
	initialFile := filepath.Join(tmpDir, "README.md")
	if err := os.WriteFile(initialFile, []byte("# Test Repository\n"), 0644); err != nil {
		cleanup()
		t.Fatalf("Failed to create initial file: %v", err)
	}

	cmd = exec.Command("git", "add", "README.md")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		cleanup()
		t.Fatalf("Failed to add initial file: %v", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Initial commit")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		cleanup()
		t.Fatalf("Failed to create initial commit: %v", err)
	}

	// Ensure we're on main branch (git init might create master)
	cmd = exec.Command("git", "checkout", "-b", "main")
	cmd.Dir = tmpDir
	cmd.Run() // Ignore error if main already exists

	cmd = exec.Command("git", "branch", "-D", "master")
	cmd.Dir = tmpDir
	cmd.Run() // Ignore error if master doesn't exist

	return tmpDir, cleanup
}

// createSketchBranch creates a sketch branch with commits
func createSketchBranch(t *testing.T, repoDir, branchName string, commits []string) {
	t.Helper()

	fullBranchName := "sketch/" + branchName

	// Create and checkout branch
	cmd := exec.Command("git", "checkout", "-b", fullBranchName)
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create branch %s: %v", fullBranchName, err)
	}

	// Create commits
	for i, commitMsg := range commits {
		fileName := filepath.Join(repoDir, "file"+branchName+"_"+string(rune('0'+i))+".txt")
		content := "Content for " + commitMsg + "\n"
		if err := os.WriteFile(fileName, []byte(content), 0644); err != nil {
			t.Fatalf("Failed to create file %s: %v", fileName, err)
		}

		cmd := exec.Command("git", "add", filepath.Base(fileName))
		cmd.Dir = repoDir
		if err := cmd.Run(); err != nil {
			t.Fatalf("Failed to add file %s: %v", fileName, err)
		}

		// Add Change-Id trailer
		fullMsg := commitMsg + "\n\nChange-Id: I" + branchName + "_" + string(rune('0'+i))
		cmd = exec.Command("git", "commit", "-m", fullMsg)
		cmd.Dir = repoDir
		if err := cmd.Run(); err != nil {
			t.Fatalf("Failed to create commit '%s': %v", commitMsg, err)
		}
	}

	// Return to main branch
	cmd = exec.Command("git", "checkout", "main")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		// Try master as fallback
		cmd = exec.Command("git", "checkout", "master")
		cmd.Dir = repoDir
		if err := cmd.Run(); err != nil {
			t.Fatalf("Failed to checkout main/master: %v", err)
		}
	}
}

func TestFindMainBranch(t *testing.T) {
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

	// Test finding main branch
	mainBranch, err := findMainBranch()
	if err != nil {
		t.Fatalf("Failed to find main branch: %v", err)
	}

	// Accept either main or master as valid main branches
	if mainBranch != "main" && mainBranch != "master" {
		t.Errorf("Expected main branch to be 'main' or 'master', got '%s'", mainBranch)
	}
}

func TestCheckRepoState(t *testing.T) {
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

	// Test clean repo state (should pass)
	if err := checkRepoState(); err != nil {
		t.Errorf("Expected clean repo state to pass, got error: %v", err)
	}

	// Test with staged changes first
	testFile := filepath.Join(repoDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	cmd := exec.Command("git", "add", "test.txt")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to add test file: %v", err)
	}

	// Should fail due to staged changes
	if err := checkRepoState(); err == nil {
		t.Error("Expected checkRepoState to fail with staged changes")
	} else if !strings.Contains(err.Error(), "staged changes") {
		t.Errorf("Expected error about staged changes, got: %v", err)
	}

	// Commit the file to clean up
	cmd = exec.Command("git", "commit", "-m", "Add test file")
	cmd.Dir = repoDir
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to commit test file: %v", err)
	}

	// Test with unstaged changes
	if err := os.WriteFile(testFile, []byte("modified content"), 0644); err != nil {
		t.Fatalf("Failed to modify test file: %v", err)
	}

	// Should fail due to unstaged changes
	if err := checkRepoState(); err == nil {
		t.Error("Expected checkRepoState to fail with unstaged changes")
	} else if !strings.Contains(err.Error(), "unstaged changes") {
		t.Errorf("Expected error about unstaged changes, got: %v", err)
	}

	// Clean up
	cmd = exec.Command("git", "checkout", "--", "test.txt")
	cmd.Dir = repoDir
	cmd.Run()
}

func TestGetSketchBranches(t *testing.T) {
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

	// Create some sketch branches
	createSketchBranch(t, repoDir, "feature1", []string{"Add feature 1", "Fix feature 1"})
	createSketchBranch(t, repoDir, "feature2", []string{"Add feature 2"})

	// Add some delay to ensure different timestamps
	time.Sleep(1 * time.Second)
	createSketchBranch(t, repoDir, "feature3", []string{"Add feature 3"})

	// Get sketch branches
	branches, err := getSketchBranches()
	if err != nil {
		t.Fatalf("Failed to get sketch branches: %v", err)
	}

	if len(branches) != 3 {
		t.Errorf("Expected 3 sketch branches, got %d", len(branches))
	}

	// Check that branches are sorted by date (most recent first)
	if len(branches) >= 2 {
		if branches[0].Date.Before(branches[1].Date) {
			t.Error("Expected branches to be sorted by date (most recent first)")
		}
	}

	// Check that all expected branches are present
	expectedNames := map[string]bool{
		"sketch/feature1": true,
		"sketch/feature2": true,
		"sketch/feature3": true,
	}
	for _, branch := range branches {
		if !expectedNames[branch.Name] {
			t.Errorf("Unexpected branch: %s", branch.Name)
		}
		delete(expectedNames, branch.Name)
	}
	if len(expectedNames) > 0 {
		t.Errorf("Missing expected branches: %v", expectedNames)
	}

	// Check ahead/behind counts
	for _, branch := range branches {
		if branch.Ahead <= 0 {
			t.Errorf("Expected branch %s to be ahead of main, got ahead=%d", branch.Name, branch.Ahead)
		}
		if branch.Behind != 0 {
			t.Errorf("Expected branch %s to not be behind main, got behind=%d", branch.Name, branch.Behind)
		}
	}
}

func TestNormalizeSketchBranch(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"feature1", "sketch/feature1"},
		{"sketch/feature1", "sketch/feature1"},
		{"sketch/sketch/feature1", "sketch/sketch/feature1"}, // Edge case
		{"", "sketch/"},
	}

	for _, test := range tests {
		result := normalizeSketchBranch(test.input)
		if result != test.expected {
			t.Errorf("normalizeSketchBranch(%q) = %q, expected %q", test.input, result, test.expected)
		}
	}
}

func TestGetCommitsInBranch(t *testing.T) {
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
	createSketchBranch(t, repoDir, "test", []string{"First commit", "Second commit"})

	// Get commits
	commits, err := getCommitsInBranch("sketch/test")
	if err != nil {
		t.Fatalf("Failed to get commits: %v", err)
	}

	if len(commits) != 2 {
		t.Errorf("Expected 2 commits, got %d", len(commits))
	}

	// Check commit subjects (should be in chronological order)
	expectedSubjects := []string{"First commit", "Second commit"}
	for i, commit := range commits {
		if commit.Subject != expectedSubjects[i] {
			t.Errorf("Expected commit %d subject to be %q, got %q", i, expectedSubjects[i], commit.Subject)
		}
		if len(commit.ChangeIDs) == 0 {
			t.Errorf("Expected commit %d to have at least one change-id", i)
		}
	}
}

func TestExtractChangeIDs(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "single change-id",
			input:    "commit message\n\nChange-Id: I1234567890abcdef",
			expected: []string{"I1234567890abcdef"},
		},
		{
			name:     "multiple change-ids",
			input:    "commit message\n\nChange-Id: I1234567890abcdef\nChange-Id: Iabcdef1234567890",
			expected: []string{"I1234567890abcdef", "Iabcdef1234567890"},
		},
		{
			name:     "case insensitive",
			input:    "commit message\n\nchange-id: I1234567890abcdef\nCHANGE-ID: Iabcdef1234567890",
			expected: []string{"I1234567890abcdef", "Iabcdef1234567890"},
		},
		{
			name:     "no change-ids",
			input:    "commit message\n\nSome other trailer: value",
			expected: []string{},
		},
		{
			name:     "empty change-id",
			input:    "commit message\n\nChange-Id: \nChange-Id: I1234567890abcdef",
			expected: []string{"I1234567890abcdef"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := extractChangeIDs(test.input)
			if len(result) != len(test.expected) {
				t.Errorf("Expected %d change-ids, got %d", len(test.expected), len(result))
				return
			}
			for i, expected := range test.expected {
				if i >= len(result) || result[i] != expected {
					t.Errorf("Expected change-id %d to be %q, got %q", i, expected, result[i])
				}
			}
		})
	}
}

func TestAnalyzeCommits(t *testing.T) {
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

	// Create some commits to analyze
	commits := []GitCommit{
		{
			Hash:      "abc123def456",
			Subject:   "Valid commit",
			ChangeIDs: []string{"Ivalid123456"},
		},
		{
			Hash:      "def456ghi789",
			Subject:   "Another valid commit",
			ChangeIDs: []string{"Ivalid789012"},
		},
	}

	// Test analysis using HEAD as the main ref
	analysis, err := analyzeCommits(commits, "HEAD", "")
	if err != nil {
		t.Fatalf("analyzeCommits failed: %v", err)
	}

	// Since these are mock commits that don't exist in the repo,
	// the analysis should handle this gracefully
	if analysis == nil {
		t.Error("Expected analysis result, got nil")
	}

	// Test with empty commits list
	emptyAnalysis, err := analyzeCommits([]GitCommit{}, "HEAD", "")
	if err != nil {
		t.Fatalf("analyzeCommits with empty list failed: %v", err)
	}

	if len(emptyAnalysis.ValidCommits) != 0 {
		t.Errorf("Expected 0 valid commits for empty list, got %d", len(emptyAnalysis.ValidCommits))
	}
}
