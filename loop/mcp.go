package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
	"sketch.dev/llm"
)

// MCPClient manages connections to MCP servers and provides tools
type MCPClient struct {
	servers map[string]*mcpServerConnection
	mu      sync.RWMutex
}

type mcpServerConnection struct {
	client client.MCPClient
	tools  []*llm.Tool
	addr   string
}

// NewMCPClient creates a new MCP client
func NewMCPClient() *MCPClient {
	return &MCPClient{
		servers: make(map[string]*mcpServerConnection),
	}
}

// ConnectToServers connects to all specified MCP servers in parallel
func (mc *MCPClient) ConnectToServers(ctx context.Context, serverAddrs []string) error {
	if len(serverAddrs) == 0 {
		return nil
	}

	slog.InfoContext(ctx, "Connecting to MCP servers", "count", len(serverAddrs))

	// Create a context with timeout for all connections
	connectCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Connect to servers in parallel
	var wg sync.WaitGroup
	for _, addr := range serverAddrs {
		wg.Add(1)
		go func(addr string) {
			defer wg.Done()
			if err := mc.connectToServer(connectCtx, addr); err != nil {
				slog.WarnContext(ctx, "Failed to connect to MCP server", "addr", addr, "error", err)
			} else {
				slog.InfoContext(ctx, "Successfully connected to MCP server", "addr", addr)
			}
		}(addr)
	}

	wg.Wait()

	mc.mu.RLock()
	connectedCount := len(mc.servers)
	mc.mu.RUnlock()

	slog.InfoContext(ctx, "MCP server connections completed", "requested", len(serverAddrs), "connected", connectedCount)
	return nil
}

// connectToServer connects to a single MCP server
func (mc *MCPClient) connectToServer(ctx context.Context, addr string) error {
	// Determine connection type based on address
	var mcpClient client.MCPClient
	var err error

	if isHTTPAddress(addr) {
		// TODO: Implement HTTP transport when available in mcp-go
		return fmt.Errorf("HTTP MCP servers not yet supported: %s", addr)
	} else {
		// Assume stdio transport - parse command and args
		cmdParts := strings.Fields(addr)
		if len(cmdParts) == 0 {
			return fmt.Errorf("empty command for stdio MCP server")
		}

		cmd := cmdParts[0]
		args := cmdParts[1:]

		// Create stdio transport
		stdioTransport := transport.NewStdio(cmd, nil, args...)
		if err := stdioTransport.Start(ctx); err != nil {
			return fmt.Errorf("failed to start stdio transport: %w", err)
		}

		// Create MCP client
		mcpClient = client.NewClient(stdioTransport)
	}

	// Initialize the connection
	initReq := mcp.InitializeRequest{
		Params: mcp.InitializeParams{
			ProtocolVersion: "2024-11-05",
			Capabilities: mcp.ClientCapabilities{
				Roots: &struct {
					ListChanged bool `json:"listChanged,omitempty"`
				}{
					ListChanged: true,
				},
			},
			ClientInfo: mcp.Implementation{
				Name:    "sketch",
				Version: "1.0.0",
			},
		},
	}

	_, err = mcpClient.Initialize(ctx, initReq)
	if err != nil {
		return fmt.Errorf("failed to initialize MCP client: %w", err)
	}

	// Get available tools
	toolsResp, err := mcpClient.ListTools(ctx, mcp.ListToolsRequest{})
	if err != nil {
		return fmt.Errorf("failed to list tools: %w", err)
	}

	// Convert MCP tools to llm.Tool
	tools := make([]*llm.Tool, 0, len(toolsResp.Tools))
	for _, mcpTool := range toolsResp.Tools {
		llmTool, err := mc.convertMCPTool(mcpTool, mcpClient, addr)
		if err != nil {
			slog.WarnContext(ctx, "Failed to convert MCP tool", "tool", mcpTool.Name, "error", err)
			continue
		}
		tools = append(tools, llmTool)
	}

	mc.mu.Lock()
	mc.servers[addr] = &mcpServerConnection{
		client: mcpClient,
		tools:  tools,
		addr:   addr,
	}
	mc.mu.Unlock()

	slog.InfoContext(ctx, "Connected to MCP server", "addr", addr, "tools", len(tools))
	return nil
}

// convertMCPTool converts an MCP tool to an llm.Tool
func (mc *MCPClient) convertMCPTool(mcpTool mcp.Tool, mcpClient client.MCPClient, serverAddr string) (*llm.Tool, error) {
	// Convert the input schema
	inputSchema, err := json.Marshal(mcpTool.InputSchema)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input schema: %w", err)
	}

	// Create the tool runner function
	runFunc := func(ctx context.Context, input json.RawMessage) ([]llm.Content, error) {
		// Add timeout for tool execution
		toolCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()

		// Parse input arguments
		var args map[string]interface{}
		if err := json.Unmarshal(input, &args); err != nil {
			return nil, fmt.Errorf("failed to parse tool input: %w", err)
		}

		// Call the MCP tool
		req := mcp.CallToolRequest{
			Params: mcp.CallToolParams{
				Name:      mcpTool.Name,
				Arguments: args,
			},
		}

		resp, err := mcpClient.CallTool(toolCtx, req)
		if err != nil {
			return nil, fmt.Errorf("MCP tool call failed: %w", err)
		}

		// Convert MCP response to llm.Content
		var contents []llm.Content
		for _, content := range resp.Content {
			// Type assertion for different content types
			switch c := content.(type) {
			case mcp.TextContent:
				contents = append(contents, llm.StringContent(c.Text))
			case mcp.ImageContent:
				// For now, just describe image content
				contents = append(contents, llm.StringContent(fmt.Sprintf("[Image: %s, type: %s]", c.Data[:50]+"...", c.MIMEType)))
			case mcp.AudioContent:
				// For now, just describe audio content
				contents = append(contents, llm.StringContent(fmt.Sprintf("[Audio: type %s]", c.MIMEType)))
			default:
				// Fallback for any other content types
				contents = append(contents, llm.StringContent(fmt.Sprintf("[Content: %v]", content)))
			}
		}

		if len(contents) == 0 {
			contents = append(contents, llm.StringContent("Tool executed successfully (no output)"))
		}

		return contents, nil
	}

	return &llm.Tool{
		Name:        fmt.Sprintf("mcp_%s_%s", sanitizeServerName(serverAddr), mcpTool.Name),
		Description: fmt.Sprintf("[MCP:%s] %s", serverAddr, mcpTool.Description),
		InputSchema: json.RawMessage(inputSchema),
		Run:         runFunc,
	}, nil
}

// GetAllTools returns all tools from all connected MCP servers
func (mc *MCPClient) GetAllTools() []*llm.Tool {
	mc.mu.RLock()
	defer mc.mu.RUnlock()

	var allTools []*llm.Tool
	for _, conn := range mc.servers {
		allTools = append(allTools, conn.tools...)
	}

	return allTools
}

// Close closes all MCP server connections
func (mc *MCPClient) Close() error {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	for addr, conn := range mc.servers {
		if conn.client != nil {
			if err := conn.client.Close(); err != nil {
				slog.Warn("Failed to close MCP client", "addr", addr, "error", err)
			}
		}
	}

	mc.servers = make(map[string]*mcpServerConnection)
	return nil
}

// isHTTPAddress checks if an address is an HTTP URL
func isHTTPAddress(addr string) bool {
	parsed, err := url.Parse(addr)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

// sanitizeServerName creates a safe name for use in tool names
func sanitizeServerName(addr string) string {
	// For stdio commands, use just the command name
	if !isHTTPAddress(addr) {
		parts := strings.Fields(addr)
		if len(parts) > 0 {
			cmd := parts[0]
			// Get just the command name without path
			if idx := strings.LastIndex(cmd, "/"); idx >= 0 {
				cmd = cmd[idx+1:]
			}
			if idx := strings.LastIndex(cmd, "\\"); idx >= 0 {
				cmd = cmd[idx+1:]
			}
			return strings.ReplaceAll(cmd, "-", "_")
		}
	}

	// For HTTP URLs, use the hostname
	if parsed, err := url.Parse(addr); err == nil {
		hostname := parsed.Hostname()
		return strings.ReplaceAll(hostname, ".", "_")
	}

	// Fallback
	return "unknown"
}
