package llm

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Custom JSON marshaling for ContentType
func (c ContentType) MarshalJSON() ([]byte, error) {
	// Use simpler names for JSON output
	switch c {
	case ContentTypeText:
		return json.Marshal("text")
	case ContentTypeThinking:
		return json.Marshal("thinking")
	case ContentTypeRedactedThinking:
		return json.Marshal("redacted_thinking")
	case ContentTypeToolUse:
		return json.Marshal("tool_use")
	case ContentTypeToolResult:
		return json.Marshal("tool_result")
	default:
		// Fall back to the string representation provided by stringer
		return json.Marshal(strings.ToLower(c.String()))
	}
}

// Custom JSON unmarshaling for ContentType
func (c *ContentType) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Try to unmarshal as integer if string unmarshal fails
		var i int
		if err := json.Unmarshal(data, &i); err != nil {
			return err
		}
		*c = ContentType(i)
		return nil
	}

	// Map the string representation back to the ContentType constant
	switch strings.ToLower(s) {
	case "text":
		*c = ContentTypeText
	case "thinking":
		*c = ContentTypeThinking
	case "redacted_thinking":
		*c = ContentTypeRedactedThinking
	case "tool_use":
		*c = ContentTypeToolUse
	case "tool_result":
		*c = ContentTypeToolResult
	default:
		// Try to match against the stringer-generated names
		switch strings.ToLower(s) {
		case strings.ToLower(ContentTypeText.String()):
			*c = ContentTypeText
		case strings.ToLower(ContentTypeThinking.String()):
			*c = ContentTypeThinking
		case strings.ToLower(ContentTypeRedactedThinking.String()):
			*c = ContentTypeRedactedThinking
		case strings.ToLower(ContentTypeToolUse.String()):
			*c = ContentTypeToolUse
		case strings.ToLower(ContentTypeToolResult.String()):
			*c = ContentTypeToolResult
		default:
			return fmt.Errorf("unknown ContentType: %s", s)
		}
	}

	return nil
}

// Custom JSON marshaling for MessageRole
func (m MessageRole) MarshalJSON() ([]byte, error) {
	switch m {
	case MessageRoleUser:
		return json.Marshal("user")
	case MessageRoleAssistant:
		return json.Marshal("assistant")
	default:
		return json.Marshal(strings.ToLower(m.String()))
	}
}

// Custom JSON unmarshaling for MessageRole
func (m *MessageRole) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Try to unmarshal as integer if string unmarshal fails
		var i int
		if err := json.Unmarshal(data, &i); err != nil {
			return err
		}
		*m = MessageRole(i)
		return nil
	}

	switch strings.ToLower(s) {
	case "user":
		*m = MessageRoleUser
	case "assistant":
		*m = MessageRoleAssistant
	default:
		// Try to match against the stringer-generated names
		switch strings.ToLower(s) {
		case strings.ToLower(MessageRoleUser.String()):
			*m = MessageRoleUser
		case strings.ToLower(MessageRoleAssistant.String()):
			*m = MessageRoleAssistant
		default:
			return fmt.Errorf("unknown MessageRole: %s", s)
		}
	}

	return nil
}

// Custom JSON marshaling for ToolChoiceType
func (t ToolChoiceType) MarshalJSON() ([]byte, error) {
	switch t {
	case ToolChoiceTypeAuto:
		return json.Marshal("auto")
	case ToolChoiceTypeAny:
		return json.Marshal("any")
	case ToolChoiceTypeNone:
		return json.Marshal("none")
	case ToolChoiceTypeTool:
		return json.Marshal("tool")
	default:
		return json.Marshal(strings.ToLower(t.String()))
	}
}

// Custom JSON unmarshaling for ToolChoiceType
func (t *ToolChoiceType) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		// Try to unmarshal as integer if string unmarshal fails
		var i int
		if err := json.Unmarshal(data, &i); err != nil {
			return err
		}
		*t = ToolChoiceType(i)
		return nil
	}

	switch strings.ToLower(s) {
	case "auto":
		*t = ToolChoiceTypeAuto
	case "any":
		*t = ToolChoiceTypeAny
	case "none":
		*t = ToolChoiceTypeNone
	case "tool":
		*t = ToolChoiceTypeTool
	default:
		// Try to match against the stringer-generated names
		switch strings.ToLower(s) {
		case strings.ToLower(ToolChoiceTypeAuto.String()):
			*t = ToolChoiceTypeAuto
		case strings.ToLower(ToolChoiceTypeAny.String()):
			*t = ToolChoiceTypeAny
		case strings.ToLower(ToolChoiceTypeNone.String()):
			*t = ToolChoiceTypeNone
		case strings.ToLower(ToolChoiceTypeTool.String()):
			*t = ToolChoiceTypeTool
		default:
			return fmt.Errorf("unknown ToolChoiceType: %s", s)
		}
	}

	return nil
}

// Custom JSON marshaling for StopReason
func (s StopReason) MarshalJSON() ([]byte, error) {
	switch s {
	case StopReasonStopSequence:
		return json.Marshal("stop_sequence")
	case StopReasonMaxTokens:
		return json.Marshal("max_tokens")
	case StopReasonEndTurn:
		return json.Marshal("end_turn")
	case StopReasonToolUse:
		return json.Marshal("tool_use")
	default:
		return json.Marshal(strings.ToLower(s.String()))
	}
}

// Custom JSON unmarshaling for StopReason
func (s *StopReason) UnmarshalJSON(data []byte) error {
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		// Try to unmarshal as integer if string unmarshal fails
		var i int
		if err := json.Unmarshal(data, &i); err != nil {
			return err
		}
		*s = StopReason(i)
		return nil
	}

	switch strings.ToLower(str) {
	case "stop_sequence":
		*s = StopReasonStopSequence
	case "max_tokens":
		*s = StopReasonMaxTokens
	case "end_turn":
		*s = StopReasonEndTurn
	case "tool_use":
		*s = StopReasonToolUse
	default:
		// Try to match against the stringer-generated names
		switch strings.ToLower(str) {
		case strings.ToLower(StopReasonStopSequence.String()):
			*s = StopReasonStopSequence
		case strings.ToLower(StopReasonMaxTokens.String()):
			*s = StopReasonMaxTokens
		case strings.ToLower(StopReasonEndTurn.String()):
			*s = StopReasonEndTurn
		case strings.ToLower(StopReasonToolUse.String()):
			*s = StopReasonToolUse
		default:
			return fmt.Errorf("unknown StopReason: %s", str)
		}
	}

	return nil
}
