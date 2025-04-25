package loop

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestProxy tests the HTTP proxy functionality
func TestProxy(t *testing.T) {
	// Create a temporary directory for logs
	tempDir, err := os.MkdirTemp("", "proxy-test-")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a test server that we'll proxy to
	testContent := "Hello, proxied world!"
	testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprint(w, testContent)
		// Sleep a small amount to make the duration measurable
		time.Sleep(10 * time.Millisecond)
	}))
	defer testServer.Close()

	// Parse the server URL to get the port
	portStr := strings.Split(testServer.URL, ":")[2]

	// Create an agent with a proxy
	agent := NewAgent(AgentConfig{})
	agent.proxyLogDir = tempDir

	// Configure the proxy
	proxyName := "test-proxy"
	proxyConfig := ProxyConfig{
		Name: proxyName,
		Port: mustParseInt(portStr),
		Path: "/proxy/" + proxyName,
	}

	// Add the proxy
	err = agent.AddProxy(proxyConfig)
	if err != nil {
		t.Fatalf("Failed to add proxy: %v", err)
	}

	// Create a test request to the proxy
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/proxy/"+proxyName+"/some/path", nil)
	req.RemoteAddr = "127.0.0.1:1234" // Set a fake remote address

	// Handle the request through our proxy
	err = agent.HandleProxyRequest(w, req, proxyName)
	if err != nil {
		t.Fatalf("Proxy request failed: %v", err)
	}

	// Check the response
	if w.Code != http.StatusOK {
		t.Errorf("Expected status code %d, got %d", http.StatusOK, w.Code)
	}

	// Check the response body
	respBody, err := io.ReadAll(w.Body)
	if err != nil {
		t.Fatalf("Failed to read response body: %v", err)
	}

	if string(respBody) != testContent {
		t.Errorf("Expected response body %q, got %q", testContent, respBody)
	}

	// Check that the log file exists and contains a log entry
	logDir := filepath.Join(tempDir, "proxy_logs")
	files, err := os.ReadDir(logDir)
	if err != nil {
		t.Fatalf("Failed to read log directory: %v", err)
	}

	if len(files) == 0 {
		t.Fatal("No log files found")
	}

	// Read the log file and verify it contains expected content
	logPath := filepath.Join(logDir, files[0].Name())
	logContent, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("Failed to read log file: %v", err)
	}

	logStr := string(logContent)
	if !strings.Contains(logStr, "GET /some/path") {
		t.Errorf("Log does not contain expected request info: %s", logStr)
	}

	if !strings.Contains(logStr, "200 OK") {
		t.Errorf("Log does not contain expected status code: %s", logStr)
	}

	// Test non-existent proxy
	w = httptest.NewRecorder()
	err = agent.HandleProxyRequest(w, req, "non-existent-proxy")
	if err == nil {
		t.Error("Expected error for non-existent proxy, but got none")
	}

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status code %d for non-existent proxy, got %d", http.StatusNotFound, w.Code)
	}

	// Test removing the proxy
	if !agent.RemoveProxy(proxyName) {
		t.Errorf("Failed to remove proxy %s", proxyName)
	}

	// Verify it was removed
	if agent.RemoveProxy(proxyName) {
		t.Errorf("Removing already removed proxy %s returned true", proxyName)
	}

	// Verify that GetProxies returns the correct list
	proxies := agent.GetProxies()
	if len(proxies) != 0 {
		t.Errorf("Expected empty proxy list after removal, got %d proxies", len(proxies))
	}
}

// Helper function to parse port string to int
func mustParseInt(s string) int {
	port := 0
	fmt.Sscanf(s, "%d", &port)
	return port
}

// TestHttpProxyTool tests the http_proxy tool
func TestHttpProxyTool(t *testing.T) {
	// Create a temporary directory for logs
	tempDir, err := os.MkdirTemp("", "proxy-tool-test-")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a test server
	testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprint(w, "Hello from test server")
	}))
	defer testServer.Close()

	// Parse the server URL to get the port
	portStr := strings.Split(testServer.URL, ":")[2]
	port := mustParseInt(portStr)

	// Create an agent
	agent := NewAgent(AgentConfig{})
	agent.proxyLogDir = tempDir

	// Set a URL for the agent
	agent.url = "http://localhost:8080"

	// Create the http_proxy tool
	proxyTool := MakeHttpProxyTool(agent, tempDir)

	// Test starting a proxy
	startInput := fmt.Sprintf(`{"action":"start","name":"tool-test","port":%d}`, port)
	result, err := proxyTool.Run(context.Background(), []byte(startInput))
	if err != nil {
		t.Fatalf("Failed to start proxy via tool: %v", err)
	}

	if !strings.Contains(result, "Proxy created successfully") {
		t.Errorf("Unexpected result from proxy tool: %s", result)
	}

	// Verify the proxy was added
	proxies := agent.GetProxies()
	if len(proxies) != 1 || proxies[0].Name != "tool-test" {
		t.Errorf("Expected 1 proxy named 'tool-test', got %d proxies", len(proxies))
	}

	// Test stopping the proxy
	stopInput := `{"action":"stop","name":"tool-test"}`
	result, err = proxyTool.Run(context.Background(), []byte(stopInput))
	if err != nil {
		t.Fatalf("Failed to stop proxy via tool: %v", err)
	}

	if !strings.Contains(result, "has been stopped and removed") {
		t.Errorf("Unexpected result from proxy tool stop: %s", result)
	}

	// Verify the proxy was removed
	proxies = agent.GetProxies()
	if len(proxies) != 0 {
		t.Errorf("Expected 0 proxies after removal, got %d", len(proxies))
	}

	// Test stopping a non-existent proxy
	result, err = proxyTool.Run(context.Background(), []byte(stopInput))
	if err == nil {
		t.Error("Expected error when stopping non-existent proxy, but got none")
	}

	// Test invalid action
	invalidInput := `{"action":"invalid","name":"test"}`
	_, err = proxyTool.Run(context.Background(), []byte(invalidInput))
	if err == nil {
		t.Error("Expected error with invalid action, but got none")
	}

	// Test invalid name
	invalidNameInput := `{"action":"start","name":"UPPERCASE","port":8080}`
	_, err = proxyTool.Run(context.Background(), []byte(invalidNameInput))
	if err == nil {
		t.Error("Expected error with invalid name, but got none")
	}
}
