package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"sketch.dev/loop"
)

func main() {
	// Test MCP client connection and tool call
	mcpClient := loop.NewMCPClient()

	// Try to connect to the time server
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Use uvx to run the time server
	servers := []string{"uvx mcp-server-time"}

	fmt.Println("Testing MCP tool call...")
	err := mcpClient.ConnectToServers(ctx, servers)
	if err != nil {
		log.Fatalf("Failed to connect to MCP servers: %v", err)
	}

	// Get available tools
	tools := mcpClient.GetAllTools()
	fmt.Printf("Found %d MCP tools\n", len(tools))

	// Test calling the get_current_time tool
	if len(tools) > 0 {
		tool := tools[0] // Should be get_current_time
		fmt.Printf("Testing tool: %s\n", tool.Name)

		// Call the tool with timezone parameter
		input := map[string]interface{}{
			"timezone": "UTC",
		}
		inputJSON, _ := json.Marshal(input)

		result, err := tool.Run(ctx, inputJSON)
		if err != nil {
			fmt.Printf("Tool call failed: %v\n", err)
		} else {
			fmt.Printf("Tool call successful! Result: %v\n", result)
			for i, content := range result {
				fmt.Printf("  Content %d: %s\n", i+1, content.Text)
			}
		}
	}

	// Clean up
	mcpClient.Close()
	fmt.Println("Test completed!")
}
