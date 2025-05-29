package conversation

import (
	"cmp"
	"context"
	"net/http"
	"os"
	"strings"
	"testing"

	"sketch.dev/httprr"
	"sketch.dev/llm"
	"sketch.dev/llm/ant"
)

func TestBasicConvo(t *testing.T) {
	ctx := context.Background()
	rr, err := httprr.Open("testdata/basic_convo.httprr", http.DefaultTransport)
	if err != nil {
		t.Fatal(err)
	}
	rr.ScrubReq(func(req *http.Request) error {
		req.Header.Del("x-api-key")
		return nil
	})

	apiKey := cmp.Or(os.Getenv("OUTER_SKETCH_MODEL_API_KEY"), os.Getenv("ANTHROPIC_API_KEY"))
	srv := &ant.Service{
		APIKey: apiKey,
		HTTPC:  rr.Client(),
	}
	convo := New(ctx, srv)

	const name = "Cornelius"
	res, err := convo.SendUserTextMessage("Hi, my name is " + name)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range res.Content {
		t.Logf("%s", part.Text)
	}
	res, err = convo.SendUserTextMessage("What is my name?")
	if err != nil {
		t.Fatal(err)
	}
	got := ""
	for _, part := range res.Content {
		got += part.Text
	}
	if !strings.Contains(got, name) {
		t.Errorf("model does not know the given name %s: %q", name, got)
	}
}

// TestCancelToolUse tests the CancelToolUse function of the Convo struct
func TestCancelToolUse(t *testing.T) {
	tests := []struct {
		name         string
		setupToolUse bool
		toolUseID    string
		cancelErr    error
		expectError  bool
		expectCancel bool
	}{
		{
			name:         "Cancel existing tool use",
			setupToolUse: true,
			toolUseID:    "tool123",
			cancelErr:    nil,
			expectError:  false,
			expectCancel: true,
		},
		{
			name:         "Cancel existing tool use with error",
			setupToolUse: true,
			toolUseID:    "tool456",
			cancelErr:    context.Canceled,
			expectError:  false,
			expectCancel: true,
		},
		{
			name:         "Cancel non-existent tool use",
			setupToolUse: false,
			toolUseID:    "tool789",
			cancelErr:    nil,
			expectError:  true,
			expectCancel: false,
		},
	}

	srv := &ant.Service{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			convo := New(context.Background(), srv)

			var cancelCalled bool
			var cancelledWithErr error

			if tt.setupToolUse {
				// Setup a mock cancel function to track calls
				mockCancel := func(err error) {
					cancelCalled = true
					cancelledWithErr = err
				}

				convo.muToolUseCancel.Lock()
				convo.toolUseCancel[tt.toolUseID] = mockCancel
				convo.muToolUseCancel.Unlock()
			}

			err := convo.CancelToolUse(tt.toolUseID, tt.cancelErr)

			// Check if we got the expected error state
			if (err != nil) != tt.expectError {
				t.Errorf("CancelToolUse() error = %v, expectError %v", err, tt.expectError)
			}

			// Check if the cancel function was called as expected
			if cancelCalled != tt.expectCancel {
				t.Errorf("Cancel function called = %v, expectCancel %v", cancelCalled, tt.expectCancel)
			}

			// If we expected the cancel to be called, verify it was called with the right error
			if tt.expectCancel && cancelledWithErr != tt.cancelErr {
				t.Errorf("Cancel function called with error = %v, expected %v", cancelledWithErr, tt.cancelErr)
			}

			// Verify the toolUseID was removed from the map if it was initially added
			if tt.setupToolUse {
				convo.muToolUseCancel.Lock()
				_, exists := convo.toolUseCancel[tt.toolUseID]
				convo.muToolUseCancel.Unlock()

				if exists {
					t.Errorf("toolUseID %s still exists in the map after cancellation", tt.toolUseID)
				}
			}
		})
	}
}

type mockService struct{}

func (m *mockService) Do(ctx context.Context, req *llm.Request) (*llm.Response, error) {
	return nil, nil // Not needed for this test
}

func TestCompact(t *testing.T) {
	mockSvc := &mockService{}
	convo := New(context.Background(), mockSvc)

	// Create messages with tool results of various sizes
	messages := []llm.Message{
		// Message with short tool result (should not be compacted)
		{
			Role: llm.MessageRoleAssistant,
			Content: []llm.Content{
				{
					Type: llm.ContentTypeToolResult,
					Text: "short result",
					ToolResult: []llm.Content{{
						Type: llm.ContentTypeText,
						Text: "short text",
					}},
				},
			},
		},
		// Message with long tool result (should be compacted)
		{
			Role: llm.MessageRoleAssistant,
			Content: []llm.Content{
				{
					Type: llm.ContentTypeToolResult,
					Text: strings.Repeat("a", 200), // 200 bytes, > 100 threshold
					ToolResult: []llm.Content{{
						Type: llm.ContentTypeText,
						Text: strings.Repeat("b", 150), // 150 bytes, > 100 threshold
					}},
				},
			},
		},
		// Message with image content (should be compacted)
		{
			Role: llm.MessageRoleUser,
			Content: []llm.Content{
				{
					Type:      llm.ContentTypeText,
					Text:      "Original image text",
					MediaType: "image/jpeg",
					Data:      "base64imagedata123456789",
				},
			},
		},
	}

	// Add messages to conversation manually
	convo.messages = messages

	// Compact the conversation
	bytesCompacted := convo.Compact()

	// Verify that bytes were compacted
	if bytesCompacted == 0 {
		t.Errorf("Expected some bytes to be compacted, got 0")
	}

	// Check that large tool result text was compacted
	if convo.messages[1].Content[0].Text != "<compacted away>" {
		t.Errorf("Expected large tool result text to be compacted, got: %s", convo.messages[1].Content[0].Text)
	}

	// Check that nested tool result text was compacted
	if convo.messages[1].Content[0].ToolResult[0].Text != "<compacted away>" {
		t.Errorf("Expected large nested tool result text to be compacted, got: %s", convo.messages[1].Content[0].ToolResult[0].Text)
	}

	// Check that short tool result was NOT compacted
	if convo.messages[0].Content[0].Text == "<compacted away>" {
		t.Errorf("Expected short tool result text to NOT be compacted")
	}

	// Check that image data was compacted
	if convo.messages[2].Content[0].Data != "" {
		t.Errorf("Expected image data to be compacted, still has data: %s", convo.messages[2].Content[0].Data)
	}

	// Check that image text was compacted
	if convo.messages[2].Content[0].Text != "<compacted away>" {
		t.Errorf("Expected image text to be compacted, got: %s", convo.messages[2].Content[0].Text)
	}

	// Verify that short text was NOT compacted
	if convo.messages[0].Content[0].ToolResult[0].Text == "<compacted away>" {
		t.Errorf("Expected short nested tool result text to NOT be compacted")
	}
}
