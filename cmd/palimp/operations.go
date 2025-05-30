package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"text/tabwriter"
)

// LandOptions configures the behavior of the land operation
type LandOptions struct {
	Squash bool
	DryRun bool
	Force  bool
	UseLLM bool
}

// listBranches implements the list command
func listBranches() error {
	if err := checkRepoState(); err != nil {
		return err
	}

	branches, err := getSketchBranches()
	if err != nil {
		return err
	}

	if len(branches) == 0 {
		fmt.Println("No sketch/* branches found.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	fmt.Fprintln(w, "BRANCH\tAHEAD\tBEHIND\tLAST COMMIT\tSTATUS\tSUBJECT")
	fmt.Fprintln(w, "------\t-----\t------\t-----------\t------\t-------")

	for _, branch := range branches {
		shortName := strings.TrimPrefix(branch.Name, "sketch/")
		aheadStr := fmt.Sprintf("+%d", branch.Ahead)
		behindStr := ""
		if branch.Behind > 0 {
			behindStr = fmt.Sprintf("-%d", branch.Behind)
		}
		dateStr := branch.Date.Format("2006-01-02")
		status := getRebaseLandStatus(branch.Name)

		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
			shortName, aheadStr, behindStr, dateStr, status, branch.Subject)
	}
	w.Flush()

	return nil
}

// landBranch implements the land command
func landBranch(branchName string, opts LandOptions) error {
	// Check main branch requirement unless force is used
	if !opts.Force {
		if err := checkMainBranch(); err != nil {
			return err
		}
	}

	// Check repository state (ongoing operations, staged changes, etc.)
	if err := checkRepoState(); err != nil {
		return err
	}

	branchName = normalizeSketchBranch(branchName)

	// Check if branch exists
	cmd := exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/"+branchName)
	if cmd.Run() != nil {
		return fmt.Errorf("branch %s does not exist", branchName)
	}

	// Get commits to cherry-pick
	commits, err := getCommitsInBranch(branchName)
	if err != nil {
		return fmt.Errorf("failed to get commits from %s: %w", branchName, err)
	}

	if len(commits) == 0 {
		fmt.Printf("Branch %s has no commits to land.\n", branchName)
		return nil
	}

	// Find the main branch for analysis
	mainBranch, err := findMainBranch()
	if err != nil {
		return err
	}

	// Analyze commits comprehensively (change-id filtering, empty detection, conflict detection)
	fmt.Printf("Analyzing %d commits for landing...\n", len(commits))
	analysis, err := analyzeCommits(commits, mainBranch, branchName)
	if err != nil {
		return fmt.Errorf("failed to analyze commits: %w", err)
	}

	if analysis.FirstConflict != nil {
		return fmt.Errorf("validation failed: %w\n\nThe cherry-pick sequence would fail. Please resolve conflicts on the branch first.", analysis.ConflictError)
	}

	newCommits := analysis.ValidCommits
	if len(newCommits) == 0 {
		fmt.Printf("All commits from %s are already in main or would result in empty cherry-picks.\n", branchName)
		// Delete the branch since there's nothing to land
		if opts.DryRun {
			fmt.Printf("[DRY RUN] Would delete branch %s\n", branchName)
			return nil
		}
		return deleteBranch(branchName)
	}

	fmt.Printf("Analysis successful. %d commits ready to land.\n", len(newCommits))

	if opts.DryRun {
		fmt.Printf("[DRY RUN] Would land %d commits from %s:\n", len(newCommits), branchName)
		for i, commit := range newCommits {
			fmt.Printf("[DRY RUN]   Cherry-pick %d/%d: %s %s\n", i+1, len(newCommits), shortHash(commit.Hash), commit.Subject)
		}
		if opts.Squash && len(newCommits) > 1 {
			if opts.UseLLM {
				fmt.Printf("[DRY RUN]   Squash %d commits into one with LLM-generated message\n", len(newCommits))
				fmt.Printf("[DRY RUN]   (LLM would analyze commit messages and diff to generate unified message)\n")
			} else {
				fmt.Printf("[DRY RUN]   Squash %d commits into one with combined message\n", len(newCommits))
				combinedMessage := createCombinedCommitMessage(newCommits)
				fmt.Printf("[DRY RUN]   Combined commit message preview:\n")
				for _, line := range strings.Split(combinedMessage, "\n") {
					fmt.Printf("[DRY RUN]     %s\n", line)
				}
			}
		}
		fmt.Printf("[DRY RUN]   Delete branch %s\n", branchName)
		return nil
	}

	fmt.Printf("Landing %d commits from %s...\n", len(newCommits), branchName)

	// Cherry-pick the commits
	for i, commit := range newCommits {
		fmt.Printf("Cherry-picking %d/%d: %s %s\n", i+1, len(newCommits), shortHash(commit.Hash), commit.Subject)
		cmd := exec.Command("git", "cherry-pick", commit.Hash)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("cherry-pick of %s failed: %w\n\nTo recover:\n  git cherry-pick --abort    # Cancel the cherry-pick\n  git reset --hard HEAD~%d   # Undo %d commits that were already applied", commit.Hash, err, i, i)
		}
	}

	// Squash if requested
	if opts.Squash && len(newCommits) > 1 {
		fmt.Printf("Squashing %d commits...\n", len(newCommits))
		if err := squashLastCommits(len(newCommits), newCommits, opts.UseLLM); err != nil {
			return fmt.Errorf("failed to squash commits: %w", err)
		}
	}

	// Delete the branch on success
	fmt.Printf("Successfully landed %s, deleting branch...\n", branchName)
	return deleteBranch(branchName)
}

// dropBranch implements the drop command
func dropBranch(branchName string, dryRun bool) error {
	if err := checkRepoState(); err != nil {
		return err
	}

	branchName = normalizeSketchBranch(branchName)

	// Check if branch exists
	cmd := exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/"+branchName)
	if cmd.Run() != nil {
		return fmt.Errorf("branch %s does not exist", branchName)
	}

	if dryRun {
		fmt.Printf("[DRY RUN] Would delete branch %s\n", branchName)
		return nil
	}

	return deleteBranch(branchName)
}

// cleanBranches implements the clean command

// updateBranch implements the update command
func updateBranch(branchName string, dryRun bool) error {
	if err := checkMainBranch(); err != nil {
		return err
	}
	if err := checkRepoState(); err != nil {
		return err
	}

	branchName = normalizeSketchBranch(branchName)

	// Check if branch exists
	cmd := exec.Command("git", "show-ref", "--verify", "--quiet", "refs/heads/"+branchName)
	if cmd.Run() != nil {
		return fmt.Errorf("branch %s does not exist", branchName)
	}

	mainBranch, err := findMainBranch()
	if err != nil {
		return err
	}

	// Get commits that would be rebased
	commits, err := getCommitsInBranch(branchName)
	if err != nil {
		return fmt.Errorf("failed to get commits from %s: %w", branchName, err)
	}

	if len(commits) > 0 {
		// Validate that the rebase will succeed
		fmt.Printf("Validating that %d commits can be rebased...\n", len(commits))
		if err := validateGitOperation(commits); err != nil {
			return fmt.Errorf("rebase validation failed: %w\n\nThe rebase would fail. Please resolve conflicts manually.", err)
		}
		fmt.Println("Validation successful.")
	}

	if dryRun {
		fmt.Printf("[DRY RUN] Would rebase %s onto %s\n", branchName, mainBranch)
		fmt.Printf("[DRY RUN]   Checkout %s\n", branchName)
		fmt.Printf("[DRY RUN]   Rebase onto %s\n", mainBranch)
		fmt.Printf("[DRY RUN]   Checkout %s\n", mainBranch)
		return nil
	}

	fmt.Printf("Rebasing %s onto %s...\n", branchName, mainBranch)

	// Checkout the branch
	cmd = exec.Command("git", "checkout", branchName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to checkout %s: %w", branchName, err)
	}

	// Rebase onto main
	cmd = exec.Command("git", "rebase", mainBranch)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		// Try to abort the rebase and checkout main
		exec.Command("git", "rebase", "--abort").Run()
		exec.Command("git", "checkout", mainBranch).Run()
		return fmt.Errorf("rebase failed: %w", err)
	}

	// Checkout main again
	cmd = exec.Command("git", "checkout", mainBranch)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to checkout %s: %w", mainBranch, err)
	}

	fmt.Printf("Successfully updated %s\n", branchName)
	return nil
}

// Helper functions

// deleteBranch deletes a git branch
func deleteBranch(branchName string) error {
	cmd := exec.Command("git", "branch", "-D", branchName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// squashLastCommits squashes the last n commits with combined commit messages
func squashLastCommits(n int, commits []GitCommit, useLLM bool) error {
	if n <= 1 {
		return nil
	}

	// Get the commit before our series
	cmd := exec.Command("git", "rev-parse", fmt.Sprintf("HEAD~%d", n))
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to find base commit: %w", err)
	}
	baseCommit := strings.TrimSpace(string(output))

	// Reset to the base commit but keep changes staged
	cmd = exec.Command("git", "reset", "--soft", baseCommit)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to soft reset: %w", err)
	}

	// Create combined commit message
	var combinedMessage string
	if useLLM {
		fmt.Println("Generating commit message using LLM...")
		combinedMessage, err = generateLLMCommitMessage(commits)
		if err != nil {
			fmt.Printf("Warning: LLM generation failed (%v), falling back to default method\n", err)
			combinedMessage = createCombinedCommitMessage(commits)
		} else {
			// Validate LLM response
			var allChangeIDs []string
			for _, commit := range commits {
				allChangeIDs = append(allChangeIDs, commit.ChangeIDs...)
			}
			if err := validateLLMResponse(combinedMessage, allChangeIDs); err != nil {
				fmt.Printf("Warning: LLM response validation failed (%v), falling back to default method\n", err)
				combinedMessage = createCombinedCommitMessage(commits)
			} else {
				fmt.Println("LLM-generated commit message validated successfully.")
			}
		}
	} else {
		combinedMessage = createCombinedCommitMessage(commits)
	}

	// Write combined message to temp file
	tempFile, err := os.CreateTemp("", "palimp-squash-*.txt")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	if _, err := tempFile.WriteString(combinedMessage); err != nil {
		return fmt.Errorf("failed to write commit message: %w", err)
	}
	tempFile.Close()

	// Check if we're in a testing environment or non-interactive
	if isTesting() || os.Getenv("TERM") == "" {
		// Non-interactive mode: use the message as-is
		cmd = exec.Command("git", "commit", "-F", tempFile.Name())
	} else {
		// Interactive mode: let user edit the commit message
		cmd = exec.Command("git", "commit", "-F", tempFile.Name(), "-e")
		cmd.Stdin = os.Stdin
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// isTesting returns true if we're running in a test environment
func isTesting() bool {
	// Check for go test environment
	for _, arg := range os.Args {
		if strings.Contains(arg, "test") {
			return true
		}
	}
	return false
}

// createCombinedCommitMessage creates a combined commit message from multiple commits
func createCombinedCommitMessage(commits []GitCommit) string {
	var parts []string

	// Use the first commit's subject as the main subject
	if len(commits) > 0 {
		parts = append(parts, commits[0].Subject)
		parts = append(parts, "")
	}

	// Add a summary of all commits
	parts = append(parts, fmt.Sprintf("Squashed %d commits:", len(commits)))
	for i, commit := range commits {
		parts = append(parts, fmt.Sprintf("%d. %s (%s)", i+1, commit.Subject, shortHash(commit.Hash)))
	}
	parts = append(parts, "")

	// Collect all unique change-ids
	changeIDSet := make(map[string]bool)
	for _, commit := range commits {
		for _, changeID := range commit.ChangeIDs {
			changeIDSet[changeID] = true
		}
	}

	// Add change-ids at the end
	for changeID := range changeIDSet {
		parts = append(parts, "Change-Id: "+changeID)
	}

	return strings.Join(parts, "\n")
}

// filterNewCommits filters out commits that are already in main based on change-ids
func filterNewCommits(commits []GitCommit, mainChangeIDs map[string]bool, quiet bool) []GitCommit {
	var newCommits []GitCommit
	for _, commit := range commits {
		isInMain := false
		var matchingChangeID string

		// Check if any of the commit's change-ids are already in main
		for _, changeID := range commit.ChangeIDs {
			if mainChangeIDs[changeID] {
				isInMain = true
				matchingChangeID = changeID
				break
			}
		}

		if len(commit.ChangeIDs) == 0 || !isInMain {
			newCommits = append(newCommits, commit)
		} else {
			if !quiet {
				fmt.Printf("Skipping commit %s (already in main via Change-Id %s)\n",
					shortHash(commit.Hash), matchingChangeID)
			}
		}
	}
	return newCommits
}

// getRebaseLandStatus checks if a branch can rebase/land cleanly using dry run simulation
func getRebaseLandStatus(branchName string) string {
	// Get commits that would be landed
	commits, err := getCommitsInBranch(branchName)
	if err != nil {
		return "ERROR"
	}

	if len(commits) == 0 {
		return "EMPTY"
	}

	// Find main branch for analysis
	mainBranch, err := findMainBranch()
	if err != nil {
		return "ERROR"
	}

	// Analyze commits comprehensively
	analysis, err := analyzeCommits(commits, mainBranch, branchName)
	if err != nil {
		return "ERROR"
	}

	// Check if there are conflicts first
	if analysis.FirstConflict != nil {
		return "CONFLICT"
	}

	// If no valid commits remain after analysis, check why:
	if len(analysis.ValidCommits) == 0 {
		// Check if all commits were filtered due to change-ids (truly landed)
		// vs empty cherry-picks (branch exists but changes already incorporated)
		mainChangeIDs, err := getChangeIDsInRef(mainBranch, branchName)
		if err != nil {
			return "ERROR"
		}

		// Count how many commits were filtered by change-id vs other reasons
		changeIdFiltered := 0
		for _, commit := range commits {
			for _, changeID := range commit.ChangeIDs {
				if mainChangeIDs[changeID] {
					changeIdFiltered++
					break
				}
			}
		}

		// If all commits were filtered by change-id, they're truly landed
		if changeIdFiltered == len(commits) {
			return "LANDED"
		}

		// Otherwise, commits exist but would be empty cherry-picks
		return "EMPTY"
	}

	return "CLEAN"
}
