package conversation

import (
	"context"
	"testing"
	"time"

	"sketch.dev/llm"
)

// TestNewWithExistingUsage tests creating a conversation with existing usage
func TestNewWithExistingUsage(t *testing.T) {
	// Create a mock service
	mockService := &MockService{}

	// Create existing usage
	existingUsage := &CumulativeUsage{
		StartTime:    time.Now().Add(-time.Hour),
		Responses:    3,
		InputTokens:  1000,
		OutputTokens: 500,
		TotalCostUSD: 1.50,
		ToolUses:     map[string]int{"bash": 5, "patch": 2},
	}

	// Create conversation with existing usage
	ctx := context.Background()
	conv := New(ctx, mockService, existingUsage)

	// Set last usage
	lastUsage := llm.Usage{
		InputTokens:  200,
		OutputTokens: 100,
		CostUSD:      0.30,
	}
	conv.SetLastUsage(lastUsage)

	// Verify that usage was properly preserved
	cumulativeUsage := conv.CumulativeUsage()

	// Check that values are correct
	if cumulativeUsage.Responses != 3 {
		t.Errorf("Expected 3 responses, got %d", cumulativeUsage.Responses)
	}
	if cumulativeUsage.InputTokens != 1000 {
		t.Errorf("Expected 1000 input tokens, got %d", cumulativeUsage.InputTokens)
	}
	if cumulativeUsage.OutputTokens != 500 {
		t.Errorf("Expected 500 output tokens, got %d", cumulativeUsage.OutputTokens)
	}
	if cumulativeUsage.TotalCostUSD != 1.50 {
		t.Errorf("Expected $1.50 total cost, got $%.2f", cumulativeUsage.TotalCostUSD)
	}

	// Check that tool uses were preserved
	if cumulativeUsage.ToolUses["bash"] != 5 {
		t.Errorf("Expected 5 bash tool uses, got %d", cumulativeUsage.ToolUses["bash"])
	}
	if cumulativeUsage.ToolUses["patch"] != 2 {
		t.Errorf("Expected 2 patch tool uses, got %d", cumulativeUsage.ToolUses["patch"])
	}

	// Check that start time was preserved
	if !cumulativeUsage.StartTime.Equal(existingUsage.StartTime) {
		t.Errorf("Expected start time to be preserved")
	}

	// Check that last usage was set
	retrievedLastUsage := conv.LastUsage()
	if retrievedLastUsage.InputTokens != 200 {
		t.Errorf("Expected last usage input tokens to be 200, got %d", retrievedLastUsage.InputTokens)
	}
	if retrievedLastUsage.OutputTokens != 100 {
		t.Errorf("Expected last usage output tokens to be 100, got %d", retrievedLastUsage.OutputTokens)
	}
	if retrievedLastUsage.CostUSD != 0.30 {
		t.Errorf("Expected last usage cost to be $0.30, got $%.2f", retrievedLastUsage.CostUSD)
	}
}

// TestPreserveUsageForNewConversation tests the PreserveUsageForNewConversation function
func TestPreserveUsageForNewConversation(t *testing.T) {
	originalTime := time.Now().Add(-2 * time.Hour)

	existingUsage := &CumulativeUsage{
		StartTime:    originalTime,
		Responses:    2,
		InputTokens:  800,
		OutputTokens: 400,
		TotalCostUSD: 1.20,
		ToolUses:     map[string]int{"bash": 3, "patch": 1},
	}

	preservedUsage := PreserveUsageForNewConversation(existingUsage)

	if preservedUsage.Responses != 2 {
		t.Errorf("Expected 2 responses, got %d", preservedUsage.Responses)
	}
	if preservedUsage.InputTokens != 800 {
		t.Errorf("Expected 800 input tokens, got %d", preservedUsage.InputTokens)
	}
	if preservedUsage.OutputTokens != 400 {
		t.Errorf("Expected 400 output tokens, got %d", preservedUsage.OutputTokens)
	}
	if preservedUsage.TotalCostUSD != 1.20 {
		t.Errorf("Expected $1.20 total cost, got $%.2f", preservedUsage.TotalCostUSD)
	}

	// Check tool uses
	if preservedUsage.ToolUses["bash"] != 3 {
		t.Errorf("Expected 3 bash tool uses, got %d", preservedUsage.ToolUses["bash"])
	}
	if preservedUsage.ToolUses["patch"] != 1 {
		t.Errorf("Expected 1 patch tool use, got %d", preservedUsage.ToolUses["patch"])
	}

	// Check that the start time was preserved
	if !preservedUsage.StartTime.Equal(originalTime) {
		t.Errorf("Expected start time to be preserved, got %v, expected %v", preservedUsage.StartTime, originalTime)
	}

	// Test with nil input
	nilPreserved := PreserveUsageForNewConversation(nil)
	if nilPreserved == nil {
		t.Error("Expected non-nil result for nil input")
	}
	if nilPreserved.Responses != 0 {
		t.Errorf("Expected 0 responses for nil input, got %d", nilPreserved.Responses)
	}
}

// MockService is a mock implementation of llm.Service for testing
type MockService struct{}

func (m *MockService) Do(ctx context.Context, req *llm.Request) (*llm.Response, error) {
	return &llm.Response{}, nil
}

func (m *MockService) TokenContextWindow() int {
	return 200000
}
