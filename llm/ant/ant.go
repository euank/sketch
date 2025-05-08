package ant

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strings"
	"testing"
	"time"

	"sketch.dev/llm"
)

const (
	DefaultModel = Claude37Sonnet
	// See https://docs.anthropic.com/en/docs/about-claude/models/all-models for
	// current maximums. There's currently a flag to enable 128k output (output-128k-2025-02-19)
	DefaultMaxTokens = 8192
	DefaultURL       = "https://api.anthropic.com/v1/messages"
)

const (
	Claude35Sonnet = "claude-3-5-sonnet-20241022"
	Claude35Haiku  = "claude-3-5-haiku-20241022"
	Claude37Sonnet = "claude-3-7-sonnet-20250219"
)

// Service provides Claude completions.
// Fields should not be altered concurrently with calling any method on Service.
type Service struct {
	HTTPC     *http.Client // defaults to http.DefaultClient if nil
	URL       string       // defaults to DefaultURL if empty
	APIKey    string       // must be non-empty
	Model     string       // defaults to DefaultModel if empty
	MaxTokens int          // defaults to DefaultMaxTokens if zero
}

var _ llm.Service = (*Service)(nil)

type content struct {
	// TODO: image support?
	// https://docs.anthropic.com/en/api/messages
	ID        string `json:"id,omitempty"`
	Type      string `json:"type,omitempty"`
	Text      string `json:"text,omitempty"`
	MediaType string `json:"media_type,omitempty"` // for image

	// for thinking
	Thinking  string `json:"thinking,omitempty"`
	Data      string `json:"data,omitempty"`      // for redacted_thinking or image
	Signature string `json:"signature,omitempty"` // for thinking

	// for tool_use
	ToolName  string          `json:"name,omitempty"`
	ToolInput json.RawMessage `json:"input,omitempty"`

	// for tool_result
	ToolUseID  string    `json:"tool_use_id,omitempty"`
	ToolError  bool      `json:"is_error,omitempty"`
	ToolResult []content `json:"content,omitempty"`

	// timing information for tool_result; not sent to Claude
	StartTime *time.Time `json:"-"`
	EndTime   *time.Time `json:"-"`

	CacheControl json.RawMessage `json:"cache_control,omitempty"`
}

// message represents a message in the conversation.
type message struct {
	Role    string    `json:"role"`
	Content []content `json:"content"`
	ToolUse *toolUse  `json:"tool_use,omitempty"` // use to control whether/which tool to use
}

// toolUse represents a tool use in the message content.
type toolUse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// tool represents a tool available to Claude.
type tool struct {
	Name string `json:"name"`
	// Type is used by the text editor tool; see
	// https://docs.anthropic.com/en/docs/build-with-claude/tool-use/text-editor-tool
	Type        string          `json:"type,omitempty"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"input_schema,omitempty"`
}

// usage represents the billing and rate-limit usage.
type usage struct {
	InputTokens              uint64  `json:"input_tokens"`
	CacheCreationInputTokens uint64  `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     uint64  `json:"cache_read_input_tokens"`
	OutputTokens             uint64  `json:"output_tokens"`
	CostUSD                  float64 `json:"cost_usd"`
}

func (u *usage) Add(other usage) {
	u.InputTokens += other.InputTokens
	u.CacheCreationInputTokens += other.CacheCreationInputTokens
	u.CacheReadInputTokens += other.CacheReadInputTokens
	u.OutputTokens += other.OutputTokens
	u.CostUSD += other.CostUSD
}

type errorResponse struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// response represents the response from the message API.
type response struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"`
	Role         string    `json:"role"`
	Model        string    `json:"model"`
	Content      []content `json:"content"`
	StopReason   string    `json:"stop_reason"`
	StopSequence *string   `json:"stop_sequence,omitempty"`
	Usage        usage     `json:"usage"`
}

type toolChoice struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

// https://docs.anthropic.com/en/api/messages#body-system
type systemContent struct {
	Text         string          `json:"text,omitempty"`
	Type         string          `json:"type,omitempty"`
	CacheControl json.RawMessage `json:"cache_control,omitempty"`
}

// request represents the request payload for creating a message.
type request struct {
	Model         string          `json:"model"`
	Messages      []message       `json:"messages"`
	ToolChoice    *toolChoice     `json:"tool_choice,omitempty"`
	MaxTokens     int             `json:"max_tokens"`
	Tools         []*tool         `json:"tools,omitempty"`
	Stream        bool            `json:"stream,omitempty"`
	System        []systemContent `json:"system,omitempty"`
	Temperature   float64         `json:"temperature,omitempty"`
	TopK          int             `json:"top_k,omitempty"`
	TopP          float64         `json:"top_p,omitempty"`
	StopSequences []string        `json:"stop_sequences,omitempty"`

	TokenEfficientToolUse bool `json:"-"` // DO NOT USE, broken on Anthropic's side as of 2025-02-28
}

const dumpText = false // debugging toggle to see raw communications with Claude

func mapped[Slice ~[]E, E, T any](s Slice, f func(E) T) []T {
	out := make([]T, len(s))
	for i, v := range s {
		out[i] = f(v)
	}
	return out
}

func inverted[K, V cmp.Ordered](m map[K]V) map[V]K {
	inv := make(map[V]K)
	for k, v := range m {
		if _, ok := inv[v]; ok {
			panic(fmt.Errorf("inverted map has multiple keys for value %v", v))
		}
		inv[v] = k
	}
	return inv
}

var (
	fromLLMRole = map[llm.MessageRole]string{
		llm.MessageRoleAssistant: "assistant",
		llm.MessageRoleUser:      "user",
	}
	toLLMRole = inverted(fromLLMRole)

	fromLLMContentType = map[llm.ContentType]string{
		llm.ContentTypeText:             "text",
		llm.ContentTypeThinking:         "thinking",
		llm.ContentTypeRedactedThinking: "redacted_thinking",
		llm.ContentTypeToolUse:          "tool_use",
		llm.ContentTypeToolResult:       "tool_result",
	}
	toLLMContentType = inverted(fromLLMContentType)

	fromLLMToolChoiceType = map[llm.ToolChoiceType]string{
		llm.ToolChoiceTypeAuto: "auto",
		llm.ToolChoiceTypeAny:  "any",
		llm.ToolChoiceTypeNone: "none",
		llm.ToolChoiceTypeTool: "tool",
	}

	toLLMStopReason = map[string]llm.StopReason{
		"stop_sequence": llm.StopReasonStopSequence,
		"max_tokens":    llm.StopReasonMaxTokens,
		"end_turn":      llm.StopReasonEndTurn,
		"tool_use":      llm.StopReasonToolUse,
	}
)

func fromLLMCache(c bool) json.RawMessage {
	if !c {
		return nil
	}
	return json.RawMessage(`{"type":"ephemeral"}`)
}

func fromLLMContent(c llm.Content) content {
	toolResult := make([]content, len(c.ToolResult))
	for i, tr := range c.ToolResult {
		toolResult[i] = fromLLMContent(tr)
	}

	return content{
		ID:           c.ID,
		Type:         fromLLMContentType[c.Type],
		Text:         c.Text,
		Thinking:     c.Thinking,
		Data:         c.Data,
		Signature:    c.Signature,
		ToolName:     c.ToolName,
		ToolInput:    c.ToolInput,
		ToolUseID:    c.ToolUseID,
		ToolError:    c.ToolError,
		ToolResult:   toolResult,
		CacheControl: fromLLMCache(c.Cache),
	}
}

func fromLLMToolUse(tu *llm.ToolUse) *toolUse {
	if tu == nil {
		return nil
	}
	return &toolUse{
		ID:   tu.ID,
		Name: tu.Name,
	}
}

func fromLLMMessage(msg llm.Message) message {
	return message{
		Role:    fromLLMRole[msg.Role],
		Content: mapped(msg.Content, fromLLMContent),
		ToolUse: fromLLMToolUse(msg.ToolUse),
	}
}

func fromLLMToolChoice(tc *llm.ToolChoice) *toolChoice {
	if tc == nil {
		return nil
	}
	return &toolChoice{
		Type: fromLLMToolChoiceType[tc.Type],
		Name: tc.Name,
	}
}

func fromLLMTool(t *llm.Tool) *tool {
	return &tool{
		Name:        t.Name,
		Type:        t.Type,
		Description: t.Description,
		InputSchema: t.InputSchema,
	}
}

func fromLLMSystem(s llm.SystemContent) systemContent {
	return systemContent{
		Text:         s.Text,
		Type:         s.Type,
		CacheControl: fromLLMCache(s.Cache),
	}
}

func (s *Service) fromLLMRequest(r *llm.Request) *request {
	return &request{
		Model:      cmp.Or(s.Model, DefaultModel),
		Messages:   mapped(r.Messages, fromLLMMessage),
		MaxTokens:  cmp.Or(s.MaxTokens, DefaultMaxTokens),
		ToolChoice: fromLLMToolChoice(r.ToolChoice),
		Tools:      mapped(r.Tools, fromLLMTool),
		System:     mapped(r.System, fromLLMSystem),
	}
}

func toLLMUsage(u usage) llm.Usage {
	return llm.Usage{
		InputTokens:              u.InputTokens,
		CacheCreationInputTokens: u.CacheCreationInputTokens,
		CacheReadInputTokens:     u.CacheReadInputTokens,
		OutputTokens:             u.OutputTokens,
		CostUSD:                  u.CostUSD,
	}
}

func toLLMContent(c content) llm.Content {
	return llm.Content{
		ID:         c.ID,
		Type:       toLLMContentType[c.Type],
		Text:       c.Text,
		Thinking:   c.Thinking,
		Data:       c.Data,
		Signature:  c.Signature,
		ToolName:   c.ToolName,
		ToolInput:  c.ToolInput,
		ToolUseID:  c.ToolUseID,
		ToolError:  c.ToolError,
		ToolResult: c.ToolResult,
	}
}

func toLLMResponse(r *response) *llm.Response {
	return &llm.Response{
		ID:           r.ID,
		Type:         r.Type,
		Role:         toLLMRole[r.Role],
		Model:        r.Model,
		Content:      mapped(r.Content, toLLMContent),
		StopReason:   toLLMStopReason[r.StopReason],
		StopSequence: r.StopSequence,
		Usage:        toLLMUsage(r.Usage),
	}
}

// Do sends a request to Anthropic.
func (s *Service) Do(ctx context.Context, ir *llm.Request) (*llm.Response, error) {
	request := s.fromLLMRequest(ir)

	var payload []byte
	var err error
	if dumpText || testing.Testing() {
		payload, err = json.MarshalIndent(request, "", " ")
	} else {
		payload, err = json.Marshal(request)
		payload = append(payload, '\n')
	}
	if err != nil {
		return nil, err
	}

	if false {
		fmt.Printf("claude request payload:\n%s\n", payload)
	}

	backoff := []time.Duration{15 * time.Second, 30 * time.Second, time.Minute}
	largerMaxTokens := false
	var partialUsage usage

	url := cmp.Or(s.URL, DefaultURL)
	httpc := cmp.Or(s.HTTPC, http.DefaultClient)

	// retry loop
	for attempts := 0; ; attempts++ {
		if dumpText {
			fmt.Printf("RAW REQUEST:\n%s\n\n", payload)
		}
		req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-Key", s.APIKey)
		req.Header.Set("Anthropic-Version", "2023-06-01")

		var features []string
		if request.TokenEfficientToolUse {
			features = append(features, "token-efficient-tool-use-2025-02-19")
		}
		if largerMaxTokens {
			features = append(features, "output-128k-2025-02-19")
			request.MaxTokens = 128 * 1024
		}
		if len(features) > 0 {
			req.Header.Set("anthropic-beta", strings.Join(features, ","))
		}

		resp, err := httpc.Do(req)
		if err != nil {
			return nil, err
		}
		buf, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		switch {
		case resp.StatusCode == http.StatusOK:
			if dumpText {
				fmt.Printf("RAW RESPONSE:\n%s\n\n", buf)
			}
			var response response
			err = json.NewDecoder(bytes.NewReader(buf)).Decode(&response)
			if err != nil {
				return nil, err
			}
			if response.StopReason == "max_tokens" && !largerMaxTokens {
				slog.InfoContext(ctx, "anthropic_retrying_with_larger_tokens", "message", "Retrying Anthropic API call with larger max tokens size")
				// Retry with more output tokens.
				largerMaxTokens = true
				response.Usage.CostUSD = response.TotalDollars()
				partialUsage = response.Usage
				continue
			}

			// Calculate and set the cost_usd field
			if largerMaxTokens {
				response.Usage.Add(partialUsage)
			}
			response.Usage.CostUSD = response.TotalDollars()

			return toLLMResponse(&response), nil
		case resp.StatusCode >= 500 && resp.StatusCode < 600:
			// overloaded or unhappy, in one form or another
			sleep := backoff[min(attempts, len(backoff)-1)] + time.Duration(rand.Int64N(int64(time.Second)))
			slog.WarnContext(ctx, "anthropic_request_failed", "response", string(buf), "status_code", resp.StatusCode, "sleep", sleep)
			time.Sleep(sleep)
		case resp.StatusCode == 429:
			// rate limited. wait 1 minute as a starting point, because that's the rate limiting window.
			// and then add some additional time for backoff.
			sleep := time.Minute + backoff[min(attempts, len(backoff)-1)] + time.Duration(rand.Int64N(int64(time.Second)))
			slog.WarnContext(ctx, "anthropic_request_rate_limited", "response", string(buf), "sleep", sleep)
			time.Sleep(sleep)
		// case resp.StatusCode == 400:
		// TODO: parse ErrorResponse, make (*ErrorResponse) implement error
		default:
			return nil, fmt.Errorf("API request failed with status %s\n%s", resp.Status, buf)
		}
	}
}

// cents per million tokens
// (not dollars because i'm twitchy about using floats for money)
type centsPer1MTokens struct {
	Input         uint64
	Output        uint64
	CacheRead     uint64
	CacheCreation uint64
}

// https://www.anthropic.com/pricing#anthropic-api
var modelCost = map[string]centsPer1MTokens{
	Claude37Sonnet: {
		Input:         300,  // $3
		Output:        1500, // $15
		CacheRead:     30,   // $0.30
		CacheCreation: 375,  // $3.75
	},
	Claude35Haiku: {
		Input:         80,  // $0.80
		Output:        400, // $4.00
		CacheRead:     8,   // $0.08
		CacheCreation: 100, // $1.00
	},
	Claude35Sonnet: {
		Input:         300,  // $3
		Output:        1500, // $15
		CacheRead:     30,   // $0.30
		CacheCreation: 375,  // $3.75
	},
}

// TotalDollars returns the total cost to obtain this response, in dollars.
func (mr *response) TotalDollars() float64 {
	cpm, ok := modelCost[mr.Model]
	if !ok {
		panic(fmt.Sprintf("no pricing info for model: %s", mr.Model))
	}
	use := mr.Usage
	megaCents := use.InputTokens*cpm.Input +
		use.OutputTokens*cpm.Output +
		use.CacheReadInputTokens*cpm.CacheRead +
		use.CacheCreationInputTokens*cpm.CacheCreation
	cents := float64(megaCents) / 1_000_000.0
	return cents / 100.0
}
