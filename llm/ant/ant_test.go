package ant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"sketch.dev/llm"
)

// TestMaxTokensNoRetry tests that the Anthropic service no longer retries
// with larger token limits when max tokens is reached
func TestMaxTokensNoRetry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Parse the request to check max_tokens
		body, _ := io.ReadAll(r.Body)
		var req request
		json.Unmarshal(body, &req)

		// Should not be using large max tokens (128k)
		if req.MaxTokens >= 128*1024 {
			t.Errorf("Service should not retry with large max tokens, got %d", req.MaxTokens)
		}

		// Return a max tokens response
		resp := response{
			ID:         "msg_123",
			Type:       "message",
			Role:       "assistant",
			Content:    []content{{Type: "text", Text: strPtr("Partial response")}},
			StopReason: "max_tokens",
			Usage: usage{
				InputTokens:  10,
				OutputTokens: 100,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	service := &Service{
		URL:   server.URL,
		Model: DefaultModel,
	}

	ctx := context.Background()
	req := &llm.Request{
		Messages: []llm.Message{
			{Role: llm.MessageRoleUser, Content: []llm.Content{{Type: llm.ContentTypeText, Text: "Hello"}}},
		},
	}

	resp, err := service.Do(ctx, req)
	if err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	// Should return max tokens stop reason without retrying
	if resp.StopReason != llm.StopReasonMaxTokens {
		t.Errorf("Expected StopReasonMaxTokens, got %v", resp.StopReason)
	}

	if len(resp.Content) == 0 || resp.Content[0].Text != "Partial response" {
		t.Error("Should return the partial response")
	}
}

// Helper function to create string pointer
func strPtr(s string) *string {
	return &s
}
