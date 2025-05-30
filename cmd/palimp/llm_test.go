package main

import (
	"strings"
	"testing"
)

func TestCreateCommitMessagePrompt(t *testing.T) {
	commits := []GitCommit{
		{Hash: "abc123", Subject: "Add feature X", Message: "Add feature X\n\nImplement new feature X with tests.\n\nChange-Id: I123456", ChangeIDs: []string{"I123456"}},
		{Hash: "def456", Subject: "Fix feature X", Message: "Fix feature X\n\nFix bug in feature X implementation.\n\nChange-Id: I789012", ChangeIDs: []string{"I789012"}},
	}
	diff := `@@ -0,0 +1 @@
+new feature
`

	prompt := createCommitMessagePrompt(commits, diff)

	// Check that the prompt contains expected elements
	if !strings.Contains(prompt, "Add feature X") {
		t.Error("Prompt should contain first commit subject")
	}
	if !strings.Contains(prompt, "Fix feature X") {
		t.Error("Prompt should contain second commit subject")
	}
	if !strings.Contains(prompt, "I123456") {
		t.Error("Prompt should contain first Change-ID")
	}
	if !strings.Contains(prompt, "I789012") {
		t.Error("Prompt should contain second Change-ID")
	}
	if !strings.Contains(prompt, "+new feature") {
		t.Error("Prompt should contain diff content")
	}
	if !strings.Contains(prompt, "unified commit message") {
		t.Error("Prompt should contain instructions")
	}
	// Check for XML-ish tags
	if !strings.Contains(prompt, "<commit_messages>") {
		t.Error("Prompt should contain <commit_messages> tag")
	}
	if !strings.Contains(prompt, "<commit_message>") {
		t.Error("Prompt should contain <commit_message> tag with hash")
	}
	if !strings.Contains(prompt, "</commit_message>") {
		t.Error("Prompt should contain closing </commit_message> tag")
	}
	if !strings.Contains(prompt, "<diff>") {
		t.Error("Prompt should contain <diff> tag")
	}
	if !strings.Contains(prompt, "</diff>") {
		t.Error("Prompt should contain closing </diff> tag")
	}
	// Check that full commit messages are included
	if !strings.Contains(prompt, "Implement new feature X with tests.") {
		t.Error("Prompt should contain full commit message content")
	}
	if !strings.Contains(prompt, "Fix bug in feature X implementation.") {
		t.Error("Prompt should contain full commit message content")
	}
}

func TestValidateLLMResponse(t *testing.T) {
	tests := []struct {
		name        string
		response    string
		expectedIDs []string
		wantError   bool
	}{
		{
			name:        "valid response with all change-ids",
			response:    "Add feature\n\nThis adds a new feature.\n\nChange-Id: I123456\nChange-Id: I789012",
			expectedIDs: []string{"I123456", "I789012"},
			wantError:   false,
		},
		{
			name:        "missing change-id",
			response:    "Add feature\n\nThis adds a new feature.\n\nChange-Id: I123456",
			expectedIDs: []string{"I123456", "I789012"},
			wantError:   true,
		},
		{
			name:        "empty response",
			response:    "",
			expectedIDs: []string{"I123456"},
			wantError:   true,
		},
		{
			name:        "no subject line",
			response:    "\n\nChange-Id: I123456",
			expectedIDs: []string{"I123456"},
			wantError:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateLLMResponse(tt.response, tt.expectedIDs)
			if (err != nil) != tt.wantError {
				t.Errorf("validateLLMResponse() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestGetCommitsDiff(t *testing.T) {
	// This test just ensures the function doesn't panic with empty input
	diff, err := getCommitsDiff([]GitCommit{})
	if err != nil {
		t.Errorf("getCommitsDiff() with empty commits should not error, got %v", err)
	}
	if diff != "" {
		t.Errorf("getCommitsDiff() with empty commits should return empty string, got %q", diff)
	}
}
