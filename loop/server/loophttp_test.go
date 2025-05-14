package server_test

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"sketch.dev/llm/conversation"
	"sketch.dev/loop"
	"sketch.dev/loop/server"
)

// mockAgent is a mock implementation of loop.CodingAgent for testing
type mockAgent struct {
	mu                       sync.RWMutex
	messages                 []loop.AgentMessage
	messageCount             int
	currentState             string
	subscribers              []chan *loop.AgentMessage
	stateTransitionListeners []chan loop.StateTransition
	initialCommit            string
	title                    string
	branchName               string
	workingDir               string
}

func (m *mockAgent) NewIterator(ctx context.Context, nextMessageIdx int) loop.MessageIterator {
	m.mu.RLock()
	// Send existing messages that should be available immediately
	ch := make(chan *loop.AgentMessage, 100)
	iter := &mockIterator{
		agent:          m,
		ctx:            ctx,
		nextMessageIdx: nextMessageIdx,
		ch:             ch,
	}
	m.mu.RUnlock()
	return iter
}

type mockIterator struct {
	agent          *mockAgent
	ctx            context.Context
	nextMessageIdx int
	ch             chan *loop.AgentMessage
	subscribed     bool
}

func (m *mockIterator) Next() *loop.AgentMessage {
	if !m.subscribed {
		m.agent.mu.Lock()
		m.agent.subscribers = append(m.agent.subscribers, m.ch)
		m.agent.mu.Unlock()
		m.subscribed = true
	}

	for {
		select {
		case <-m.ctx.Done():
			return nil
		case msg := <-m.ch:
			return msg
		}
	}
}

func (m *mockIterator) Close() {
	// Remove from subscribers using slices.Delete
	m.agent.mu.Lock()
	for i, ch := range m.agent.subscribers {
		if ch == m.ch {
			m.agent.subscribers = slices.Delete(m.agent.subscribers, i, i+1)
			break
		}
	}
	m.agent.mu.Unlock()
	close(m.ch)
}

func (m *mockAgent) Messages(start int, end int) []loop.AgentMessage {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if start >= len(m.messages) || end > len(m.messages) || start < 0 || end < 0 {
		return []loop.AgentMessage{}
	}
	return slices.Clone(m.messages[start:end])
}

func (m *mockAgent) MessageCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.messageCount
}

func (m *mockAgent) AddMessage(msg loop.AgentMessage) {
	m.mu.Lock()
	msg.Idx = m.messageCount
	m.messages = append(m.messages, msg)
	m.messageCount++

	// Create a copy of subscribers to avoid holding the lock while sending
	subscribers := make([]chan *loop.AgentMessage, len(m.subscribers))
	copy(subscribers, m.subscribers)
	m.mu.Unlock()

	// Notify subscribers
	msgCopy := msg // Create a copy to avoid race conditions
	for _, ch := range subscribers {
		ch <- &msgCopy
	}
}

func (m *mockAgent) NewStateTransitionIterator(ctx context.Context) loop.StateTransitionIterator {
	m.mu.Lock()
	ch := make(chan loop.StateTransition, 10)
	m.stateTransitionListeners = append(m.stateTransitionListeners, ch)
	m.mu.Unlock()

	return &mockStateTransitionIterator{
		agent: m,
		ctx:   ctx,
		ch:    ch,
	}
}

type mockStateTransitionIterator struct {
	agent *mockAgent
	ctx   context.Context
	ch    chan loop.StateTransition
}

func (m *mockStateTransitionIterator) Next() *loop.StateTransition {
	select {
	case <-m.ctx.Done():
		return nil
	case transition, ok := <-m.ch:
		if !ok {
			return nil
		}
		transitionCopy := transition
		return &transitionCopy
	}
}

func (m *mockStateTransitionIterator) Close() {
	m.agent.mu.Lock()
	for i, ch := range m.agent.stateTransitionListeners {
		if ch == m.ch {
			m.agent.stateTransitionListeners = slices.Delete(m.agent.stateTransitionListeners, i, i+1)
			break
		}
	}
	m.agent.mu.Unlock()
	close(m.ch)
}

func (m *mockAgent) CurrentStateName() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.currentState
}

func (m *mockAgent) TriggerStateTransition(from, to loop.State, event loop.TransitionEvent) {
	m.mu.Lock()
	m.currentState = to.String()
	transition := loop.StateTransition{
		From:  from,
		To:    to,
		Event: event,
	}

	// Create a copy of listeners to avoid holding the lock while sending
	listeners := make([]chan loop.StateTransition, len(m.stateTransitionListeners))
	copy(listeners, m.stateTransitionListeners)
	m.mu.Unlock()

	// Notify listeners
	for _, ch := range listeners {
		ch <- transition
	}
}

func (m *mockAgent) InitialCommit() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.initialCommit
}

func (m *mockAgent) SketchGitBase() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.initialCommit
}

func (m *mockAgent) Title() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.title
}

func (m *mockAgent) BranchName() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.branchName
}

// Other required methods of loop.CodingAgent with minimal implementation
func (m *mockAgent) Init(loop.AgentInit) error                   { return nil }
func (m *mockAgent) Ready() <-chan struct{}                      { ch := make(chan struct{}); close(ch); return ch }
func (m *mockAgent) URL() string                                 { return "http://localhost:8080" }
func (m *mockAgent) UserMessage(ctx context.Context, msg string) {}
func (m *mockAgent) Loop(ctx context.Context)                    {}
func (m *mockAgent) CancelTurn(cause error)                      {}
func (m *mockAgent) CancelToolUse(id string, cause error) error  { return nil }
func (m *mockAgent) TotalUsage() conversation.CumulativeUsage    { return conversation.CumulativeUsage{} }
func (m *mockAgent) OriginalBudget() conversation.Budget         { return conversation.Budget{} }
func (m *mockAgent) WorkingDir() string                          { return m.workingDir }
func (m *mockAgent) Diff(commit *string) (string, error)         { return "", nil }
func (m *mockAgent) OS() string                                  { return "linux" }
func (m *mockAgent) SessionID() string                           { return "test-session" }
func (m *mockAgent) OutstandingLLMCallCount() int                { return 0 }
func (m *mockAgent) OutstandingToolCalls() []string              { return nil }
func (m *mockAgent) OutsideOS() string                           { return "linux" }
func (m *mockAgent) OutsideHostname() string                     { return "test-host" }
func (m *mockAgent) OutsideWorkingDir() string                   { return "/app" }
func (m *mockAgent) GitOrigin() string                           { return "" }
func (m *mockAgent) OpenBrowser(url string)                      {}
func (m *mockAgent) RestartConversation(ctx context.Context, rev string, initialPrompt string) error {
	return nil
}
func (m *mockAgent) SuggestReprompt(ctx context.Context) (string, error) { return "", nil }
func (m *mockAgent) IsInContainer() bool                                 { return false }
func (m *mockAgent) FirstMessageIndex() int                              { return 0 }

// TestSSEStream tests the SSE stream endpoint
func TestSSEStream(t *testing.T) {
	// Create a mock agent with initial messages
	mockAgent := &mockAgent{
		messages:                 []loop.AgentMessage{},
		messageCount:             0,
		currentState:             "Ready",
		subscribers:              []chan *loop.AgentMessage{},
		stateTransitionListeners: []chan loop.StateTransition{},
		initialCommit:            "abcd1234",
		title:                    "Test Title",
		branchName:               "sketch/test-branch",
	}

	// Add the initial messages before creating the server
	// to ensure they're available in the Messages slice
	msg1 := loop.AgentMessage{
		Type:      loop.UserMessageType,
		Content:   "Hello, this is a test message",
		Timestamp: time.Now(),
	}
	mockAgent.messages = append(mockAgent.messages, msg1)
	msg1.Idx = mockAgent.messageCount
	mockAgent.messageCount++

	msg2 := loop.AgentMessage{
		Type:      loop.AgentMessageType,
		Content:   "This is a response message",
		Timestamp: time.Now(),
		EndOfTurn: true,
	}
	mockAgent.messages = append(mockAgent.messages, msg2)
	msg2.Idx = mockAgent.messageCount
	mockAgent.messageCount++

	// Create a server with the mock agent
	srv, err := server.New(mockAgent, nil)
	if err != nil {
		t.Fatalf("Failed to create server: %v", err)
	}

	// Create a test server
	ts := httptest.NewServer(srv)
	defer ts.Close()

	// Create a context with cancellation for the client request
	ctx, cancel := context.WithCancel(context.Background())

	// Create a request to the /stream endpoint
	req, err := http.NewRequestWithContext(ctx, "GET", ts.URL+"/stream?from=0", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	// Execute the request
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Failed to execute request: %v", err)
	}
	defer res.Body.Close()

	// Check response status
	if res.StatusCode != http.StatusOK {
		t.Fatalf("Expected status OK, got %v", res.Status)
	}

	// Check content type
	if contentType := res.Header.Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("Expected Content-Type text/event-stream, got %s", contentType)
	}

	// Read response events using a scanner
	scanner := bufio.NewScanner(res.Body)

	// Track events received
	eventsReceived := map[string]int{
		"state":     0,
		"message":   0,
		"heartbeat": 0,
	}

	// Read for a short time to capture initial state and messages
	dataLines := []string{}
	eventType := ""

	go func() {
		// After reading for a while, add a new message to test real-time updates
		time.Sleep(500 * time.Millisecond)

		mockAgent.AddMessage(loop.AgentMessage{
			Type:      loop.ToolUseMessageType,
			Content:   "This is a new real-time message",
			Timestamp: time.Now(),
			ToolName:  "test_tool",
		})

		// Trigger a state transition to test state updates
		time.Sleep(200 * time.Millisecond)
		mockAgent.TriggerStateTransition(loop.StateReady, loop.StateSendingToLLM, loop.TransitionEvent{
			Description: "Agent started thinking",
			Data:        "start_thinking",
		})

		// Let it process for longer
		time.Sleep(1000 * time.Millisecond)
		cancel() // Cancel to end the test
	}()

	// Read events
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			eventsReceived[eventType]++
		} else if strings.HasPrefix(line, "data: ") {
			dataLines = append(dataLines, line)
		} else if line == "" && eventType != "" {
			// End of event
			eventType = ""
		}

		// Break if context is done
		if ctx.Err() != nil {
			break
		}
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		t.Fatalf("Scanner error: %v", err)
	}

	// Simplified validation - just make sure we received something
	t.Logf("Events received: %v", eventsReceived)
	t.Logf("Data lines received: %d", len(dataLines))

	// Basic validation that we received at least some events
	if eventsReceived["state"] == 0 && eventsReceived["message"] == 0 {
		t.Errorf("Did not receive any events")
	}
}

func TestGitRawDiffHandler(t *testing.T) {
	// Create a mock agent
	mockAgent := &mockAgent{
		workingDir: t.TempDir(), // Use a temp directory
	}

	// Create the server with the mock agent
	server, err := server.New(mockAgent, nil)
	if err != nil {
		t.Fatalf("Failed to create server: %v", err)
	}

	// Create a test HTTP server
	testServer := httptest.NewServer(server)
	defer testServer.Close()

	// Test missing parameters
	resp, err := http.Get(testServer.URL + "/git/rawdiff")
	if err != nil {
		t.Fatalf("Failed to make HTTP request: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Expected status bad request, got: %d", resp.StatusCode)
	}

	// Test with commit parameter (this will fail due to no git repo, but we're testing the API, not git)
	resp, err = http.Get(testServer.URL + "/git/rawdiff?commit=HEAD")
	if err != nil {
		t.Fatalf("Failed to make HTTP request: %v", err)
	}
	// We expect an error since there's no git repository, but the request should be processed
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got: %d", resp.StatusCode)
	}

	// Test with from/to parameters
	resp, err = http.Get(testServer.URL + "/git/rawdiff?from=HEAD~1&to=HEAD")
	if err != nil {
		t.Fatalf("Failed to make HTTP request: %v", err)
	}
	// We expect an error since there's no git repository, but the request should be processed
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got: %d", resp.StatusCode)
	}
}

func TestGitShowHandler(t *testing.T) {
	// Create a mock agent
	mockAgent := &mockAgent{
		workingDir: t.TempDir(), // Use a temp directory
	}

	// Create the server with the mock agent
	server, err := server.New(mockAgent, nil)
	if err != nil {
		t.Fatalf("Failed to create server: %v", err)
	}

	// Create a test HTTP server
	testServer := httptest.NewServer(server)
	defer testServer.Close()

	// Test missing parameter
	resp, err := http.Get(testServer.URL + "/git/show")
	if err != nil {
		t.Fatalf("Failed to make HTTP request: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Expected status bad request, got: %d", resp.StatusCode)
	}

	// Test with hash parameter (this will fail due to no git repo, but we're testing the API, not git)
	resp, err = http.Get(testServer.URL + "/git/show?hash=HEAD")
	if err != nil {
		t.Fatalf("Failed to make HTTP request: %v", err)
	}
	// We expect an error since there's no git repository, but the request should be processed
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got: %d", resp.StatusCode)
	}
}

// Removing duplicate method definition
