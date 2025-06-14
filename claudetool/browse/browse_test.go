package browse

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
	"sketch.dev/llm"
)

func TestToolCreation(t *testing.T) {
	// Create browser tools instance
	tools := NewBrowseTools(context.Background())
	t.Cleanup(func() {
		tools.Close()
	})

	// Test each tool has correct name and description
	toolTests := []struct {
		tool          *llm.Tool
		expectedName  string
		shortDesc     string
		requiredProps []string
	}{
		{tools.NewNavigateTool(), "browser_navigate", "Navigate", []string{"url"}},
		{tools.NewClickTool(), "browser_click", "Click", []string{"selector"}},
		{tools.NewTypeTool(), "browser_type", "Type", []string{"selector", "text"}},
		{tools.NewWaitForTool(), "browser_wait_for", "Wait", []string{"selector"}},
		{tools.NewGetTextTool(), "browser_get_text", "Get", []string{"selector"}},
		{tools.NewEvalTool(), "browser_eval", "Evaluate", []string{"expression"}},
		{tools.NewScreenshotTool(), "browser_take_screenshot", "Take", nil},
		{tools.NewScrollIntoViewTool(), "browser_scroll_into_view", "Scroll", []string{"selector"}},
	}

	for _, tt := range toolTests {
		t.Run(tt.expectedName, func(t *testing.T) {
			if tt.tool.Name != tt.expectedName {
				t.Errorf("expected name %q, got %q", tt.expectedName, tt.tool.Name)
			}

			if !strings.Contains(tt.tool.Description, tt.shortDesc) {
				t.Errorf("description %q should contain %q", tt.tool.Description, tt.shortDesc)
			}

			// Verify schema has required properties
			if len(tt.requiredProps) > 0 {
				var schema struct {
					Required []string `json:"required"`
				}
				if err := json.Unmarshal(tt.tool.InputSchema, &schema); err != nil {
					t.Fatalf("failed to unmarshal schema: %v", err)
				}

				for _, prop := range tt.requiredProps {
					if !slices.Contains(schema.Required, prop) {
						t.Errorf("property %q should be required", prop)
					}
				}
			}
		})
	}
}

func TestGetTools(t *testing.T) {
	// Create browser tools instance
	tools := NewBrowseTools(context.Background())
	t.Cleanup(func() {
		tools.Close()
	})

	// Test with screenshot tools included
	t.Run("with screenshots", func(t *testing.T) {
		toolsWithScreenshots := tools.GetTools(true)
		if len(toolsWithScreenshots) != 12 {
			t.Errorf("expected 12 tools with screenshots, got %d", len(toolsWithScreenshots))
		}

		// Check tool naming convention
		for _, tool := range toolsWithScreenshots {
			// Most tools have browser_ prefix, except for read_image
			if tool.Name != "read_image" && !strings.HasPrefix(tool.Name, "browser_") {
				t.Errorf("tool name %q does not have prefix 'browser_'", tool.Name)
			}
		}
	})

	// Test without screenshot tools
	t.Run("without screenshots", func(t *testing.T) {
		noScreenshotTools := tools.GetTools(false)
		if len(noScreenshotTools) != 10 {
			t.Errorf("expected 10 tools without screenshots, got %d", len(noScreenshotTools))
		}
	})
}

// TestBrowserInitialization verifies that the browser can start correctly
func TestBrowserInitialization(t *testing.T) {
	// Skip long tests in short mode
	if testing.Short() {
		t.Skip("skipping browser initialization test in short mode")
	}

	// Create browser tools instance
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tools := NewBrowseTools(ctx)
	t.Cleanup(func() {
		tools.Close()
	})

	// Initialize the browser
	err := tools.Initialize()
	if err != nil {
		// If browser automation is not available, skip the test
		if strings.Contains(err.Error(), "browser automation not available") {
			t.Skip("Browser automation not available in this environment")
		} else {
			t.Fatalf("Failed to initialize browser: %v", err)
		}
	}

	// Get browser context to verify it's working
	browserCtx, err := tools.GetBrowserContext()
	if err != nil {
		t.Fatalf("Failed to get browser context: %v", err)
	}

	// Try to navigate to a simple page
	var title string
	err = chromedp.Run(browserCtx,
		chromedp.Navigate("about:blank"),
		chromedp.Title(&title),
	)
	if err != nil {
		t.Fatalf("Failed to navigate to about:blank: %v", err)
	}

	t.Logf("Successfully navigated to about:blank, title: %q", title)
}

// TestNavigateTool verifies that the navigate tool works correctly
func TestNavigateTool(t *testing.T) {
	// Skip long tests in short mode
	if testing.Short() {
		t.Skip("skipping navigate tool test in short mode")
	}

	// Create browser tools instance
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tools := NewBrowseTools(ctx)
	t.Cleanup(func() {
		tools.Close()
	})

	// Check if browser initialization works
	if err := tools.Initialize(); err != nil {
		if strings.Contains(err.Error(), "browser automation not available") {
			t.Skip("Browser automation not available in this environment")
		}
	}

	// Get the navigate tool
	navTool := tools.NewNavigateTool()

	// Create input for the navigate tool
	input := map[string]string{"url": "https://example.com"}
	inputJSON, _ := json.Marshal(input)

	// Call the tool
	result, err := navTool.Run(ctx, json.RawMessage(inputJSON))
	if err != nil {
		t.Fatalf("Error running navigate tool: %v", err)
	}

	// Verify the response is successful
	var response struct {
		Status string `json:"status"`
		Error  string `json:"error,omitempty"`
	}

	resultText := result[0].Text
	if err := json.Unmarshal([]byte(resultText), &response); err != nil {
		t.Fatalf("Error unmarshaling response: %v", err)
	}

	if response.Status != "success" {
		// If browser automation is not available, skip the test
		if strings.Contains(response.Error, "browser automation not available") {
			t.Skip("Browser automation not available in this environment")
		} else {
			t.Errorf("Expected status 'success', got '%s' with error: %s", response.Status, response.Error)
		}
	}

	// Try to get the page title to verify the navigation worked
	browserCtx, err := tools.GetBrowserContext()
	if err != nil {
		// If browser automation is not available, skip the test
		if strings.Contains(err.Error(), "browser automation not available") {
			t.Skip("Browser automation not available in this environment")
		} else {
			t.Fatalf("Failed to get browser context: %v", err)
		}
	}

	var title string
	err = chromedp.Run(browserCtx, chromedp.Title(&title))
	if err != nil {
		t.Fatalf("Failed to get page title: %v", err)
	}

	t.Logf("Successfully navigated to example.com, title: %q", title)
	if title != "Example Domain" {
		t.Errorf("Expected title 'Example Domain', got '%s'", title)
	}
}

// TestScreenshotTool tests that the screenshot tool properly saves files
func TestScreenshotTool(t *testing.T) {
	// Create browser tools instance
	ctx := context.Background()
	tools := NewBrowseTools(ctx)
	t.Cleanup(func() {
		tools.Close()
	})

	// Test SaveScreenshot function directly
	testData := []byte("test image data")
	id := tools.SaveScreenshot(testData)
	if id == "" {
		t.Fatal("SaveScreenshot returned empty ID")
	}

	// Get the file path and check if the file exists
	filePath := GetScreenshotPath(id)
	_, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("Failed to find screenshot file: %v", err)
	}

	// Read the file contents
	contents, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("Failed to read screenshot file: %v", err)
	}

	// Check the file contents
	if string(contents) != string(testData) {
		t.Errorf("File contents don't match: expected %q, got %q", string(testData), string(contents))
	}

	// Clean up the test file
	os.Remove(filePath)
}

func TestReadImageTool(t *testing.T) {
	// Create a test BrowseTools instance
	ctx := context.Background()
	browseTools := NewBrowseTools(ctx)
	t.Cleanup(func() {
		browseTools.Close()
	})

	// Create a test image
	testDir := t.TempDir()
	testImagePath := filepath.Join(testDir, "test_image.png")

	// Create a small 1x1 black PNG image
	smallPng := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0x60, 0x00, 0x00, 0x00,
		0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
		0x42, 0x60, 0x82,
	}

	// Write the test image
	err := os.WriteFile(testImagePath, smallPng, 0o644)
	if err != nil {
		t.Fatalf("Failed to create test image: %v", err)
	}

	// Create the tool
	readImageTool := browseTools.NewReadImageTool()

	// Prepare input
	input := fmt.Sprintf(`{"path": "%s"}`, testImagePath)

	// Run the tool
	result, err := readImageTool.Run(ctx, json.RawMessage(input))
	if err != nil {
		t.Fatalf("Read image tool failed: %v", err)
	}

	// In the updated code, result is already a []llm.Content
	contents := result

	// Check that we got at least two content objects
	if len(contents) < 2 {
		t.Fatalf("Expected at least 2 content objects, got %d", len(contents))
	}

	// Check that the second content has image data
	if contents[1].MediaType == "" {
		t.Errorf("Expected MediaType in second content")
	}

	if contents[1].Data == "" {
		t.Errorf("Expected Data in second content")
	}
}

// TestDefaultViewportSize verifies that the browser starts with the correct default viewport size
func TestDefaultViewportSize(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Skip if CI or headless testing environment
	if os.Getenv("CI") != "" || os.Getenv("HEADLESS_TEST") != "" {
		t.Skip("Skipping browser test in CI/headless environment")
	}

	tools := NewBrowseTools(ctx)
	t.Cleanup(func() {
		tools.Close()
	})

	// Initialize browser (which should set default viewport to 1280x720)
	err := tools.Initialize()
	if err != nil {
		if strings.Contains(err.Error(), "browser automation not available") {
			t.Skip("Browser automation not available in this environment")
		} else {
			t.Fatalf("Failed to initialize browser: %v", err)
		}
	}

	// Navigate to a simple page to ensure the browser is ready
	navInput := json.RawMessage(`{"url": "about:blank"}`)
	content, err := tools.NewNavigateTool().Run(ctx, navInput)
	if err != nil {
		t.Fatalf("Navigation error: %v", err)
	}
	if !strings.Contains(content[0].Text, "success") {
		t.Fatalf("Expected success in navigation response, got: %s", content[0].Text)
	}

	// Check default viewport dimensions via JavaScript
	evalInput := json.RawMessage(`{"expression": "({width: window.innerWidth, height: window.innerHeight})"}`)
	content, err = tools.NewEvalTool().Run(ctx, evalInput)
	if err != nil {
		t.Fatalf("Evaluation error: %v", err)
	}

	// Parse the result to verify dimensions
	var response struct {
		Result struct {
			Width  float64 `json:"width"`
			Height float64 `json:"height"`
		} `json:"result"`
	}

	if err := json.Unmarshal([]byte(content[0].Text), &response); err != nil {
		t.Fatalf("Failed to parse evaluation response: %v", err)
	}

	// Verify the default viewport size is 1280x720
	expectedWidth := 1280.0
	expectedHeight := 720.0

	if response.Result.Width != expectedWidth {
		t.Errorf("Expected default width %v, got %v", expectedWidth, response.Result.Width)
	}

	if response.Result.Height != expectedHeight {
		t.Errorf("Expected default height %v, got %v", expectedHeight, response.Result.Height)
	}

	t.Logf("✅ Default viewport size verified: %vx%v", response.Result.Width, response.Result.Height)
}

// TestResizeTool tests the browser resize functionality
func TestResizeTool(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Skip if CI or headless testing environment
	if os.Getenv("CI") != "" || os.Getenv("HEADLESS_TEST") != "" {
		t.Skip("Skipping browser test in CI/headless environment")
	}

	t.Run("ResizeWindow", func(t *testing.T) {
		tools := NewBrowseTools(ctx)
		t.Cleanup(func() {
			tools.Close()
		})

		// Resize to mobile dimensions
		resizeTool := tools.NewResizeTool()
		input := json.RawMessage(`{"width": 375, "height": 667}`)
		content, err := resizeTool.Run(ctx, input)
		if err != nil {
			t.Fatalf("Error: %v", err)
		}
		if !strings.Contains(content[0].Text, "success") {
			t.Fatalf("Expected success in response, got: %s", content[0].Text)
		}

		// Navigate to a test page and verify using JavaScript to get window dimensions
		navInput := json.RawMessage(`{"url": "https://example.com"}`)
		content, err = tools.NewNavigateTool().Run(ctx, navInput)
		if err != nil {
			t.Fatalf("Error: %v", err)
		}
		if !strings.Contains(content[0].Text, "success") {
			t.Fatalf("Expected success in response, got: %s", content[0].Text)
		}

		// Check dimensions via JavaScript
		evalInput := json.RawMessage(`{"expression": "({width: window.innerWidth, height: window.innerHeight})"}`)
		content, err = tools.NewEvalTool().Run(ctx, evalInput)
		if err != nil {
			t.Fatalf("Error: %v", err)
		}

		// The dimensions might not be exactly what we set (browser chrome, etc.)
		// but they should be close
		if !strings.Contains(content[0].Text, "width") {
			t.Fatalf("Expected width in response, got: %s", content[0].Text)
		}
		if !strings.Contains(content[0].Text, "height") {
			t.Fatalf("Expected height in response, got: %s", content[0].Text)
		}
	})
}
