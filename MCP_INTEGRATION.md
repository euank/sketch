# MCP Server Integration for Sketch

## Overview

This PR adds support for Model Context Protocol (MCP) servers to Sketch, allowing the agent to connect to external MCP servers and use their tools.

## Features Added

### 1. Command Line Flag
- Added `-mcp` flag that can be specified multiple times
- Each flag specifies an MCP server to connect to
- Examples:
  - `-mcp "uvx mcp-server-time"` (stdio-based server)
  - `-mcp "http://localhost:8080/mcp"` (HTTP-based server, future)

### 2. MCP Client Implementation
- New `MCPClient` in `loop/mcp.go`
- Supports stdio-based MCP servers (HTTP support can be added later)
- Connects to servers in parallel with timeout
- Graceful error handling - failed connections don't break startup

### 3. Tool Integration
- MCP tools are automatically converted to `llm.Tool` format
- Tools are prefixed with server name for uniqueness (e.g., `mcp_uvx_get_current_time`)
- Tool descriptions include MCP server information
- Tool execution includes 60-second timeout

### 4. Architecture
- Flag passing from "outtie" (host) to "innie" (container)
- MCP connections initialized during agent startup
- Tools added to conversation alongside built-in tools
- Proper cleanup on agent shutdown

## Testing

Successfully tested with MCP time server:

```bash
# Test MCP connection and tool discovery
go run test_mcp.go
# Output: Found 2 MCP tools (get_current_time, convert_time)

# Test MCP tool execution
go run test_mcp_call.go
# Output: Successfully called get_current_time tool
```

## Example Usage

Once built, sketch can be used with MCP servers:

```bash
# Run sketch with MCP time server
sketch -mcp "uvx mcp-server-time" -prompt "What time is it in UTC?"

# Run with multiple MCP servers
sketch -mcp "uvx mcp-server-time" -mcp "uvx mcp-server-weather" -prompt "What's the weather?"
```

## Implementation Details

### Files Modified
- `cmd/sketch/main.go`: Added MCP flag parsing and passing
- `dockerimg/dockerimg.go`: Added MCP server passing to container
- `loop/agent.go`: Added MCP client integration
- `loop/mcp.go`: New MCP client implementation

### Dependencies Added
- `github.com/mark3labs/mcp-go@v0.32.0`: MCP protocol implementation

### Key Functions
- `MCPClient.ConnectToServers()`: Parallel connection to MCP servers
- `MCPClient.GetAllTools()`: Retrieve all tools from connected servers
- `convertMCPTool()`: Convert MCP tool format to Sketch tool format

## Future Improvements

1. **HTTP MCP Support**: Add support for HTTP-based MCP servers
2. **Tool Caching**: Cache tool schemas to avoid repeated queries
3. **Dynamic Discovery**: Support for MCP servers that announce tools dynamically
4. **Authentication**: Add support for authenticated MCP servers
5. **Configuration**: Support for MCP server configuration files

## Error Handling

- Connection failures to MCP servers are logged but don't prevent startup
- Tool execution failures are properly reported to the LLM
- Timeout handling for both connections and tool calls
- Graceful shutdown of MCP connections

## Performance

- Parallel connection establishment
- 30-second timeout for initial connections
- 60-second timeout for tool execution
- Minimal overhead when no MCP servers are specified
