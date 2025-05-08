package llm

import (
	"encoding/json"
	"testing"
)

func TestContentTypeJSONMarshaling(t *testing.T) {
	// Test marshaling
	testCases := []struct {
		contentType ContentType
		expected    string
	}{
		{ContentTypeText, "\"text\""},
		{ContentTypeThinking, "\"thinking\""},
		{ContentTypeRedactedThinking, "\"redacted_thinking\""},
		{ContentTypeToolUse, "\"tool_use\""},
		{ContentTypeToolResult, "\"tool_result\""},
	}

	for _, tc := range testCases {
		bytes, err := json.Marshal(tc.contentType)
		if err != nil {
			t.Errorf("Failed to marshal ContentType %v: %v", tc.contentType, err)
		}
		if string(bytes) != tc.expected {
			t.Errorf("Expected marshaled value of %v to be %s, got %s", tc.contentType, tc.expected, string(bytes))
		}
	}

	// Test unmarshaling
	for _, tc := range testCases {
		var ct ContentType
		err := json.Unmarshal([]byte(tc.expected), &ct)
		if err != nil {
			t.Errorf("Failed to unmarshal ContentType from %s: %v", tc.expected, err)
		}
		if ct != tc.contentType {
			t.Errorf("Expected unmarshaled value of %s to be %v, got %v", tc.expected, tc.contentType, ct)
		}
	}

	// Test backward compatibility with integers
	for _, tc := range testCases {
		intValue := int(tc.contentType)
		bytes := []byte(string(rune(intValue + '0')))
		var ct ContentType
		err := json.Unmarshal(bytes, &ct)
		if err == nil && ct != tc.contentType {
			t.Errorf("Expected unmarshaled value of %v to be %v, got %v", intValue, tc.contentType, ct)
		}
	}
}

func TestMessageRoleJSONMarshaling(t *testing.T) {
	// Test marshaling
	testCases := []struct {
		role     MessageRole
		expected string
	}{
		{MessageRoleUser, "\"user\""},
		{MessageRoleAssistant, "\"assistant\""},
	}

	for _, tc := range testCases {
		bytes, err := json.Marshal(tc.role)
		if err != nil {
			t.Errorf("Failed to marshal MessageRole %v: %v", tc.role, err)
		}
		if string(bytes) != tc.expected {
			t.Errorf("Expected marshaled value of %v to be %s, got %s", tc.role, tc.expected, string(bytes))
		}
	}

	// Test unmarshaling
	for _, tc := range testCases {
		var role MessageRole
		err := json.Unmarshal([]byte(tc.expected), &role)
		if err != nil {
			t.Errorf("Failed to unmarshal MessageRole from %s: %v", tc.expected, err)
		}
		if role != tc.role {
			t.Errorf("Expected unmarshaled value of %s to be %v, got %v", tc.expected, tc.role, role)
		}
	}
}

func TestContentJSONMarshaling(t *testing.T) {
	// Create a test Content object
	content := Content{
		Type: ContentTypeText,
		Text: "Hello, world!",
	}

	// Marshal to JSON
	bytes, err := json.Marshal(content)
	if err != nil {
		t.Fatalf("Failed to marshal Content: %v", err)
	}

	// Verify the Type field is marshaled as a string
	var result map[string]interface{}
	if err := json.Unmarshal(bytes, &result); err != nil {
		t.Fatalf("Failed to unmarshal Content: %v", err)
	}

	// Check that the type field is "text" (string) not a number
	if typeField, ok := result["type"].(string); !ok || typeField != "text" {
		t.Errorf("Expected type field to be string 'text', got %v", result["type"])
	}

	// Marshal and unmarshal a Content with a tool result
	toolResult := Content{
		Type:      ContentTypeToolResult,
		ToolUseID: "tool123",
		ToolResult: []Content{
			{
				Type: ContentTypeText,
				Text: "Tool result text",
			},
		},
	}

	bytes, err = json.Marshal(toolResult)
	if err != nil {
		t.Fatalf("Failed to marshal tool result Content: %v", err)
	}

	var unmarshaledToolResult Content
	if err := json.Unmarshal(bytes, &unmarshaledToolResult); err != nil {
		t.Fatalf("Failed to unmarshal tool result Content: %v", err)
	}

	if unmarshaledToolResult.Type != ContentTypeToolResult {
		t.Errorf("Expected unmarshaled tool result type to be ContentTypeToolResult, got %v", unmarshaledToolResult.Type)
	}

	if len(unmarshaledToolResult.ToolResult) != 1 {
		t.Fatalf("Expected unmarshaled tool result to have 1 item, got %d", len(unmarshaledToolResult.ToolResult))
	}

	if unmarshaledToolResult.ToolResult[0].Type != ContentTypeText {
		t.Errorf("Expected unmarshaled tool result item type to be ContentTypeText, got %v", unmarshaledToolResult.ToolResult[0].Type)
	}

	// Test that empty fields are omitted in JSON output
	emptyContent := Content{
		Type: ContentTypeText,
		Text: "Only has text",
	}

	bytes, err = json.Marshal(emptyContent)
	if err != nil {
		t.Fatalf("Failed to marshal empty Content: %v", err)
	}

	// Parse the JSON to check if empty fields are omitted
	var resultMap map[string]interface{}
	if err := json.Unmarshal(bytes, &resultMap); err != nil {
		t.Fatalf("Failed to unmarshal emptied Content json: %v", err)
	}

	// Verify that only non-empty fields are present
	expectedFields := map[string]bool{
		"type": true,
		"text": true,
	}

	for key := range resultMap {
		if !expectedFields[key] {
			t.Errorf("Unexpected field in JSON output: %s", key)
		}
	}

	// Verify all expected fields are present
	for field := range expectedFields {
		if _, ok := resultMap[field]; !ok {
			t.Errorf("Expected field %s missing from JSON output", field)
		}
	}
}
