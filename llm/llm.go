// Package llm provides a unified interface for interacting with LLMs.
package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

type Service interface {
	// Do sends a request to an LLM.
	Do(context.Context, *Request) (*Response, error)
}

// MustSchema validates that schema is a valid JSON schema and returns it as a json.RawMessage.
// It panics if the schema is invalid.
func MustSchema(schema string) json.RawMessage {
	// TODO: validate schema, for now just make sure it's valid JSON
	schema = strings.TrimSpace(schema)
	bytes := []byte(schema)
	if !json.Valid(bytes) {
		panic("invalid JSON schema: " + schema)
	}
	return json.RawMessage(bytes)
}

type Request struct {
	Messages   []Message
	ToolChoice *ToolChoice
	Tools      []*Tool
	System     []SystemContent
}

// Message represents a message in the conversation.
type Message struct {
	Role    MessageRole
	Content []Content
	ToolUse *ToolUse // use to control whether/which tool to use
}

// ToolUse represents a tool use in the message content.
type ToolUse struct {
	ID   string
	Name string
}

type ToolChoice struct {
	Type ToolChoiceType
	Name string
}

type SystemContent struct {
	Text  string
	Type  string
	Cache bool
}

// Tool represents a tool available to an LLM.
type Tool struct {
	Name string
	// Type is used by the text editor tool; see
	// https://docs.anthropic.com/en/docs/build-with-claude/tool-use/text-editor-tool
	Type        string
	Description string
	InputSchema json.RawMessage
	// EndsTurn indicates that this tool should cause the model to end its turn when used
	EndsTurn bool

	// The Run function is automatically called when the tool is used.
	// Run functions may be called concurrently with each other and themselves.
	// The input to Run function is the input to the tool, as provided by Claude, in compliance with the input schema.
	// The outputs from Run will be sent back to Claude.
	// If you do not want to respond to the tool call request from Claude, return ErrDoNotRespond.
	// ctx contains extra (rarely used) tool call information; retrieve it with ToolCallInfoFromContext.
	Run func(ctx context.Context, input json.RawMessage) (string, error) `json:"-"`
}

type Content struct {
	ID   string
	Type ContentType
	Text string

	// Media type for image content
	MediaType string

	// for thinking
	Thinking  string
	Data      string // Used for both thinking/redacted_thinking and base64 image data
	Signature string

	// for tool_use
	ToolName  string
	ToolInput json.RawMessage

	// for tool_result
	ToolUseID  string
	ToolError  bool
	ToolResult []Content

	// timing information for tool_result; added externally; not sent to the LLM
	ToolUseStartTime *time.Time
	ToolUseEndTime   *time.Time

	Cache bool
}

func StringContent(s string) Content {
	return Content{Type: ContentTypeText, Text: s}
}

// ContentsAttr returns contents as a slog.Attr.
// It is meant for logging.
func ContentsAttr(contents []Content) slog.Attr {
	var contentAttrs []any // slog.Attr
	for _, content := range contents {
		var attrs []any // slog.Attr
		switch content.Type {
		case ContentTypeText:
			attrs = append(attrs, slog.String("text", content.Text))
		case ContentTypeToolUse:
			attrs = append(attrs, slog.String("tool_name", content.ToolName))
			attrs = append(attrs, slog.String("tool_input", string(content.ToolInput)))
		case ContentTypeToolResult:
			attrs = append(attrs, slog.Any("tool_result", content.ToolResult))
			attrs = append(attrs, slog.Bool("tool_error", content.ToolError))
		case ContentTypeThinking:
			attrs = append(attrs, slog.String("thinking", content.Text))
		default:
			attrs = append(attrs, slog.String("unknown_content_type", content.Type.String()))
			attrs = append(attrs, slog.Any("text", content)) // just log it all raw, better to have too much than not enough
		}
		contentAttrs = append(contentAttrs, slog.Group(content.ID, attrs...))
	}
	return slog.Group("contents", contentAttrs...)
}

type (
	MessageRole    int
	ContentType    int
	ToolChoiceType int
	StopReason     int
)

//go:generate go tool golang.org/x/tools/cmd/stringer -type=MessageRole,ContentType,ToolChoiceType,StopReason -output=llm_string.go

const (
	MessageRoleUser MessageRole = iota
	MessageRoleAssistant

	ContentTypeText ContentType = iota
	ContentTypeThinking
	ContentTypeRedactedThinking
	ContentTypeToolUse
	ContentTypeToolResult

	ToolChoiceTypeAuto ToolChoiceType = iota // default
	ToolChoiceTypeAny                        // any tool, but must use one
	ToolChoiceTypeNone                       // no tools allowed
	ToolChoiceTypeTool                       // must use the tool specified in the Name field

	StopReasonStopSequence StopReason = iota
	StopReasonMaxTokens
	StopReasonEndTurn
	StopReasonToolUse
)

type Response struct {
	ID           string
	Type         string
	Role         MessageRole
	Model        string
	Content      []Content
	StopReason   StopReason
	StopSequence *string
	Usage        Usage
	StartTime    *time.Time
	EndTime      *time.Time
}

func (m *Response) ToMessage() Message {
	return Message{
		Role:    m.Role,
		Content: m.Content,
	}
}

// Usage represents the billing and rate-limit usage.
// Most LLM structs do not have JSON tags, to avoid accidental direct use in specific providers.
// However, the front-end uses this struct, and it relies on its JSON serialization.
// Do NOT use this struct directly when implementing an llm.Service.
type Usage struct {
	InputTokens              uint64  `json:"input_tokens"`
	CacheCreationInputTokens uint64  `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     uint64  `json:"cache_read_input_tokens"`
	OutputTokens             uint64  `json:"output_tokens"`
	CostUSD                  float64 `json:"cost_usd"`
}

func (u *Usage) Add(other Usage) {
	u.InputTokens += other.InputTokens
	u.CacheCreationInputTokens += other.CacheCreationInputTokens
	u.CacheReadInputTokens += other.CacheReadInputTokens
	u.OutputTokens += other.OutputTokens
	u.CostUSD += other.CostUSD
}

func (u *Usage) String() string {
	return fmt.Sprintf("in: %d, out: %d", u.InputTokens, u.OutputTokens)
}

func (u *Usage) IsZero() bool {
	return *u == Usage{}
}

func (u *Usage) Attr() slog.Attr {
	return slog.Group("usage",
		slog.Uint64("input_tokens", u.InputTokens),
		slog.Uint64("output_tokens", u.OutputTokens),
		slog.Uint64("cache_creation_input_tokens", u.CacheCreationInputTokens),
		slog.Uint64("cache_read_input_tokens", u.CacheReadInputTokens),
		slog.Float64("cost_usd", u.CostUSD),
	)
}

// UserStringMessage creates a user message with a single text content item.
func UserStringMessage(text string) Message {
	return Message{
		Role:    MessageRoleUser,
		Content: []Content{StringContent(text)},
	}
}
