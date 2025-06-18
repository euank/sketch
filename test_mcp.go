package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"sketch.dev/loop"
)

func main() {
	// Test MCP client connection
	mcpClient := loop.NewMCPClient()

	// Try to connect to the time server
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Use uvx to run the time server
	servers := []string{"uvx mcp-server-time"}

	fmt.Println("Testing MCP connection...")
	err := mcpClient.ConnectToServers(ctx, servers)
	if err != nil {
		log.Fatalf("Failed to connect to MCP servers: %v", err)
	}

	// Get available tools
	tools := mcpClient.GetAllTools()
	fmt.Printf("Found %d MCP tools:\n", len(tools))
	for _, tool := range tools {
		fmt.Printf("- %s: %s\n", tool.Name, tool.Description)
	}

	// Clean up
	mcpClient.Close()
	fmt.Println("Test completed successfully!")
}
