package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"sketch.dev/llm"
	"sketch.dev/llm/ant"
)

// generateLLMCommitMessage uses Claude to create a unified commit message
// from multiple commit messages and the complete diff
func generateLLMCommitMessage(commits []GitCommit) (string, error) {
	// Get API key from environment
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("ANTHROPIC_API_KEY environment variable is not set")
	}

	// Configure Claude service
	service := &ant.Service{
		APIKey: apiKey,
	}

	// Get the complete diff for all commits
	diff, err := getCommitsDiff(commits)
	if err != nil {
		return "", fmt.Errorf("failed to get diff: %w", err)
	}

	// Create the prompt
	prompt := createCommitMessagePrompt(commits, diff)

	// Call LLM
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	request := &llm.Request{
		Messages: []llm.Message{
			llm.UserStringMessage(prompt),
		},
	}

	response, err := service.Do(ctx, request)
	if err != nil {
		return "", fmt.Errorf("LLM request failed: %w", err)
	}

	// Extract text from response
	if len(response.Content) == 0 {
		return "", fmt.Errorf("LLM returned empty response")
	}

	for _, content := range response.Content {
		if content.Type == llm.ContentTypeText {
			return strings.TrimSpace(content.Text), nil
		}
	}

	return "", fmt.Errorf("LLM response contained no text content")
}

// getCommitsDiff gets the complete diff for a series of commits
func getCommitsDiff(commits []GitCommit) (string, error) {
	if len(commits) == 0 {
		return "", nil
	}

	// Get the parent of the first commit
	firstCommit := commits[0].Hash
	cmd := exec.Command("git", "rev-parse", firstCommit+"^")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get parent commit: %w", err)
	}
	parentCommit := strings.TrimSpace(string(output))

	// Get the last commit
	lastCommit := commits[len(commits)-1].Hash

	// Get diff from parent to last commit
	cmd = exec.Command("git", "diff", parentCommit+".."+lastCommit)
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get diff: %w", err)
	}

	return string(output), nil
}

// createCommitMessagePrompt creates the prompt for the LLM
func createCommitMessagePrompt(commits []GitCommit, diff string) string {
	var prompt strings.Builder

	prompt.WriteString("I have a series of commits that I want to squash into a single commit. ")
	prompt.WriteString("Please create a unified commit message that:\n\n")
	prompt.WriteString("1. Includes all important information from all the input commit messages\n")
	prompt.WriteString("2. Correctly describes the actual changes (the code wins if there's a discrepancy)\n")
	prompt.WriteString("3. Includes ALL Change-ID trailers present in the input commits\n")
	prompt.WriteString("4. Follows the predominant style of the commit messages\n\n")

	prompt.WriteString("<commit_messages>\n")
	for _, commit := range commits {
		prompt.WriteString("<commit_message>\n")
		prompt.WriteString(commit.Message)
		prompt.WriteString("\n</commit_message>\n")
	}
	prompt.WriteString("</commit_messages>\n\n")

	prompt.WriteString("<diff>\n")
	prompt.WriteString(diff)
	prompt.WriteString("</diff>\n\n")

	prompt.WriteString("Please write the unified commit message. ")
	prompt.WriteString("Do not include any markdown formatting or code blocks in your response - just the raw commit message.")

	return prompt.String()
}

// validateLLMResponse checks if the LLM response is a valid commit message
// and includes all required Change-IDs
func validateLLMResponse(response string, expectedChangeIDs []string) error {
	lines := strings.Split(response, "\n")
	if len(lines) == 0 {
		return fmt.Errorf("empty commit message")
	}

	// Check for subject line
	if strings.TrimSpace(lines[0]) == "" {
		return fmt.Errorf("missing subject line")
	}

	// Extract Change-IDs from response
	responseChangeIDs := extractChangeIDs(response)

	// Check that all expected Change-IDs are present
	expectedSet := make(map[string]bool)
	for _, id := range expectedChangeIDs {
		expectedSet[id] = true
	}

	for _, id := range responseChangeIDs {
		delete(expectedSet, id)
	}

	if len(expectedSet) > 0 {
		missing := make([]string, 0, len(expectedSet))
		for id := range expectedSet {
			missing = append(missing, id)
		}
		return fmt.Errorf("missing Change-IDs: %s", strings.Join(missing, ", "))
	}

	return nil
}
