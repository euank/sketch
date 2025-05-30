package main

import (
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"
)

// GitBranch represents a git branch with metadata
type GitBranch struct {
	Name    string
	Commit  string
	Date    time.Time
	Subject string
	Ahead   int
	Behind  int
}

// GitCommit represents a commit with its change-ids
type GitCommit struct {
	Hash      string
	Subject   string
	Message   string
	ChangeIDs []string
}

// findMainBranch finds the main branch from the priority list
func findMainBranch() (string, error) {
	mainBranches := []string{"main", "master", "trunk", "develop", "default", "stable"}

	for _, branch := range mainBranches {
		cmd := exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/"+branch)
		if cmd.Run() == nil {
			return branch, nil
		}
	}

	return "", fmt.Errorf("no main branch found; checked: %s", strings.Join(mainBranches, ", "))
}

// checkMainBranch verifies that we're on the main branch
func checkMainBranch() error {
	mainBranch, err := findMainBranch()
	if err != nil {
		return err
	}

	currentBranch, err := getCurrentBranch()
	if err != nil {
		return fmt.Errorf("failed to get current branch: %w", err)
	}

	if currentBranch != mainBranch {
		return fmt.Errorf("must be on main branch (%s), currently on %s", mainBranch, currentBranch)
	}
	return nil
}

// checkRepoState verifies the repository is in a clean state (excluding main branch check)
func checkRepoState() error {
	// Check for ongoing git operations
	gitDir := ".git"
	if gitDirEnv := os.Getenv("GIT_DIR"); gitDirEnv != "" {
		gitDir = gitDirEnv
	}

	ongoingOps := []string{
		gitDir + "/MERGE_HEAD",
		gitDir + "/CHERRY_PICK_HEAD",
		gitDir + "/REVERT_HEAD",
		gitDir + "/BISECT_LOG",
		gitDir + "/rebase-merge",
		gitDir + "/rebase-apply",
	}

	for _, op := range ongoingOps {
		if _, err := os.Stat(op); err == nil {
			return fmt.Errorf("repository has ongoing git operation (found %s)", op)
		}
	}

	// Check for staged changes
	cmd := exec.Command("git", "diff-index", "--quiet", "--cached", "HEAD")
	if cmd.Run() != nil {
		return fmt.Errorf("repository has staged changes; commit or reset them")
	}

	// Check for unstaged changes
	cmd = exec.Command("git", "diff-files", "--quiet")
	if cmd.Run() != nil {
		return fmt.Errorf("repository has unstaged changes; commit or stash them")
	}

	return nil
}

// getCurrentBranch returns the current branch name
func getCurrentBranch() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// getSketchBranches returns all sketch/* branches with metadata
func getSketchBranches() ([]GitBranch, error) {
	mainBranch, err := findMainBranch()
	if err != nil {
		return nil, err
	}

	// Get all sketch/* branches
	cmd := exec.Command("git", "for-each-ref", "--format=%(refname:short)", "refs/heads/sketch/*")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list sketch branches: %w", err)
	}

	branchNames := strings.Fields(string(output))
	var branches []GitBranch

	for _, name := range branchNames {
		branch, err := getBranchInfo(name, mainBranch)
		if err != nil {
			return nil, fmt.Errorf("failed to get info for branch %s: %w", name, err)
		}
		branches = append(branches, branch)
	}

	// Sort by commit date (most recent first)
	sort.Slice(branches, func(i, j int) bool {
		return branches[i].Date.After(branches[j].Date)
	})

	return branches, nil
}

// getBranchInfo gets detailed information about a branch
func getBranchInfo(branchName, mainBranch string) (GitBranch, error) {
	var branch GitBranch
	branch.Name = branchName

	// Get commit hash, date, and subject
	cmd := exec.Command("git", "log", "-1", "--format=%H%x00%ct%x00%s", branchName)
	output, err := cmd.Output()
	if err != nil {
		return branch, fmt.Errorf("failed to get commit info: %w", err)
	}

	parts := strings.SplitN(strings.TrimSpace(string(output)), "\x00", 3)
	if len(parts) != 3 {
		return branch, fmt.Errorf("unexpected git log output format")
	}

	branch.Commit = parts[0]
	branch.Subject = parts[2]

	// Parse timestamp
	var timestamp int64
	if _, err := fmt.Sscanf(parts[1], "%d", &timestamp); err != nil {
		return branch, fmt.Errorf("failed to parse timestamp: %w", err)
	}
	branch.Date = time.Unix(timestamp, 0)

	// Get ahead/behind info
	cmd = exec.Command("git", "rev-list", "--left-right", "--count", mainBranch+"..."+branchName)
	output, err = cmd.Output()
	if err != nil {
		return branch, fmt.Errorf("failed to get ahead/behind info: %w", err)
	}

	if _, err := fmt.Sscanf(strings.TrimSpace(string(output)), "%d\t%d", &branch.Behind, &branch.Ahead); err != nil {
		return branch, fmt.Errorf("failed to parse ahead/behind counts: %w", err)
	}

	return branch, nil
}

// normalizeSketchBranch ensures branch name has sketch/ prefix
func normalizeSketchBranch(branch string) string {
	if strings.HasPrefix(branch, "sketch/") {
		return branch
	}
	return "sketch/" + branch
}

// getCommitsInBranch gets all commits in a branch that are not in main
func getCommitsInBranch(branchName string) ([]GitCommit, error) {
	mainBranch, err := findMainBranch()
	if err != nil {
		return nil, err
	}

	// Get commits that are in branch but not in main
	cmd := exec.Command("git", "rev-list", "--reverse", mainBranch+".."+branchName)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get commits: %w", err)
	}

	hashes := strings.Fields(string(output))
	var commits []GitCommit

	for _, hash := range hashes {
		commit, err := getCommitInfo(hash)
		if err != nil {
			return nil, fmt.Errorf("failed to get commit info for %s: %w", hash, err)
		}
		commits = append(commits, commit)
	}

	return commits, nil
}

// getCommitInfo gets detailed information about a commit including change-id
func getCommitInfo(hash string) (GitCommit, error) {
	var commit GitCommit
	commit.Hash = hash

	// Get subject and full message
	cmd := exec.Command("git", "log", "-1", "--format=%s%n%b", hash)
	output, err := cmd.Output()
	if err != nil {
		return commit, fmt.Errorf("failed to get commit message: %w", err)
	}

	message := string(output)
	lines := strings.Split(message, "\n")
	if len(lines) > 0 {
		commit.Subject = lines[0]
	}

	commit.Message = message
	commit.ChangeIDs = extractChangeIDs(message)

	return commit, nil
}

// getChangeIDsInRef gets all change-ids that are in the specified ref,
// optionally limited to commits since mergeBase for performance when sourceBranch is provided
func getChangeIDsInRef(ref string, sourceBranch string) (map[string]bool, error) {
	var cmd *exec.Cmd

	if sourceBranch != "" {
		// Find merge-base to limit the range for performance
		// We want to get commits that are in ref but potentially not in sourceBranch
		mergeBaseCmd := exec.Command("git", "merge-base", ref, sourceBranch)
		mergeBaseOutput, err := mergeBaseCmd.Output()
		if err != nil {
			// If merge-base fails (e.g., no common history), get all commits in ref
			cmd = exec.Command("git", "log", "--format=%b", ref)
		} else {
			mergeBase := strings.TrimSpace(string(mergeBaseOutput))
			// Get all commits in ref since the merge-base (this is the optimization)
			// This includes commits that might be cherry-picked from sourceBranch
			// Try to include the merge-base commit itself, but fall back if merge-base has no parent
			// Test if this will work by checking if merge-base^ exists
			commitRange := mergeBase+"^.."+ref
			testCmd := exec.Command("git", "rev-parse", "--verify", mergeBase+"^")
			if testCmd.Run() != nil {
				// merge-base has no parent (root commit), fall back to original range
				commitRange = mergeBase+".."+ref
			}
			cmd = exec.Command("git", "log", "--format=%b", commitRange)
		}
	} else {
		// Get all commits in the ref (no optimization)
		cmd = exec.Command("git", "log", "--format=%b", ref)
	}

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get commits from %s: %w", ref, err)
	}

	changeIDs := make(map[string]bool)
	allChangeIDs := extractChangeIDs(string(output))
	for _, changeID := range allChangeIDs {
		changeIDs[changeID] = true
	}

	return changeIDs, nil
}

// extractChangeIDs extracts all change-ids from a commit message or log output
func extractChangeIDs(text string) []string {
	var changeIDs []string
	for line := range strings.Lines(text) {
		line = strings.TrimSpace(line)
		lowerLine := strings.ToLower(line)
		if !strings.HasPrefix(lowerLine, "change-id: ") {
			continue
		}
		// Use original line to preserve case of the actual ID
		changeID := strings.TrimSpace(line[len("change-id: "):])
		if changeID != "" {
			changeIDs = append(changeIDs, changeID)
		}
	}

	return changeIDs
}

// CommitAnalysis contains the results of analyzing a sequence of commits
type CommitAnalysis struct {
	// ValidCommits are commits that can be applied without conflicts and are not empty
	ValidCommits []GitCommit
	// FirstConflict is the first commit that would cause a merge conflict, if any
	FirstConflict *GitCommit
	// ConflictError is the error from the first conflict
	ConflictError error
}

// analyzeCommits performs comprehensive analysis of commits including change-id filtering,
// empty commit detection, and conflict detection. sourceBranch is used to optimize
// change-id retrieval by limiting the search to commits since the merge-base
func analyzeCommits(commits []GitCommit, mainRef string, sourceBranch string) (*CommitAnalysis, error) {
	// Get change-ids already in the main ref (optimized by merge-base if sourceBranch provided)
	mainChangeIDs, err := getChangeIDsInRef(mainRef, sourceBranch)
	if err != nil {
		return nil, fmt.Errorf("failed to get change-ids from %s: %w", mainRef, err)
	}

	// First filter by change-id
	commitsAfterChangeIdFilter := filterNewCommits(commits, mainChangeIDs, true)
	if len(commitsAfterChangeIdFilter) == 0 {
		return &CommitAnalysis{ValidCommits: []GitCommit{}}, nil
	}

	// Check if git merge-tree --write-tree is available (Git 2.38+)
	cmd := exec.Command("git", "merge-tree", "--write-tree", mainRef, mainRef)
	if err := cmd.Run(); err != nil {
		// Fallback: if merge-tree not available, only do change-id filtering
		return &CommitAnalysis{ValidCommits: commitsAfterChangeIdFilter}, nil
	}

	analysis := &CommitAnalysis{}
	currentBase := mainRef

	// Analyze each commit sequentially for conflicts and empty commits
	for i, commit := range commitsAfterChangeIdFilter {
		// Use three-way merge with --write-tree to simulate cherry-pick
		cmd := exec.Command("git", "merge-tree", "--write-tree", "--merge-base", commit.Hash+"^", currentBase, commit.Hash)
		output, err := cmd.Output()
		if err != nil {
			// Non-zero exit status indicates conflict
			analysis.FirstConflict = &commit
			analysis.ConflictError = fmt.Errorf("merge conflict detected for commit %d/%d (%s %s): %w",
				i+1, len(commitsAfterChangeIdFilter), shortHash(commit.Hash), commit.Subject, err)
			break
		}

		// Get the result tree OID
		treeOID := strings.TrimSpace(string(output))
		if treeOID == "" {
			analysis.FirstConflict = &commit
			analysis.ConflictError = fmt.Errorf("unexpected empty output from merge-tree for commit %d/%d (%s %s)",
				i+1, len(commitsAfterChangeIdFilter), shortHash(commit.Hash), commit.Subject)
			break
		}

		// Check if the cherry-pick would be empty
		cmd = exec.Command("git", "rev-parse", currentBase+"^{tree}")
		baseTreeOutput, err := cmd.Output()
		if err != nil {
			// If we can't compare trees, include the commit
			analysis.ValidCommits = append(analysis.ValidCommits, commit)
		} else {
			baseTreeOID := strings.TrimSpace(string(baseTreeOutput))
			if baseTreeOID == treeOID {
				// Empty commit - skip it
			} else {
				// Valid commit - include it
				analysis.ValidCommits = append(analysis.ValidCommits, commit)
			}
		}

		// Update currentBase for next iteration if we're including this commit
		if len(analysis.ValidCommits) > 0 && analysis.ValidCommits[len(analysis.ValidCommits)-1].Hash == commit.Hash {
			// Create a temporary commit to simulate the effect for the next iteration
			commitCmd := exec.Command("git", "commit-tree", treeOID, "-p", currentBase, "-m", "temp")
			tempCommitOutput, err := commitCmd.Output()
			if err != nil {
				// If we can't create temp commit, just use the commit hash as fallback
				currentBase = commit.Hash
			} else {
				currentBase = strings.TrimSpace(string(tempCommitOutput))
			}
		}
	}

	return analysis, nil
}

// validateGitOperation uses git merge-tree to validate cherry-pick sequence
// Uses three-way merge semantics to simulate actual cherry-pick operations
// Deprecated: Use analyzeCommits for comprehensive analysis
func validateGitOperation(commits []GitCommit) error {
	mainBranch, err := findMainBranch()
	if err != nil {
		return err
	}

	// Can't optimize with source branch since we don't have that context here
	analysis, err := analyzeCommits(commits, mainBranch, "")
	if err != nil {
		return err
	}

	if analysis.FirstConflict != nil {
		return analysis.ConflictError
	}

	return nil
}

// shortHash returns an abbreviated hash using git rev-parse to avoid ambiguity
func shortHash(hash string) string {
	cmd := exec.Command("git", "rev-parse", "--short", hash)
	output, err := cmd.Output()
	if err != nil {
		// Fallback to manual truncation if git command fails
		if len(hash) > 8 {
			return hash[:8]
		}
		return hash
	}
	return strings.TrimSpace(string(output))
}
