// Package browse provides browser automation tools for the agent
package browse

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
	"github.com/google/uuid"
	"sketch.dev/llm"
)

// ScreenshotDir is the directory where screenshots are stored
const ScreenshotDir = "/tmp/sketch-screenshots"

// BrowseTools contains all browser tools and manages a shared browser instance
type BrowseTools struct {
	ctx              context.Context
	cancel           context.CancelFunc
	browserCtx       context.Context
	browserCtxCancel context.CancelFunc
	mux              sync.Mutex
	initOnce         sync.Once
	initialized      bool
	initErr          error
	// Map to track screenshots by ID and their creation time
	screenshots      map[string]time.Time
	screenshotsMutex sync.Mutex
	// Console logs storage
	consoleLogs      []*runtime.EventConsoleAPICalled
	consoleLogsMutex sync.Mutex
	maxConsoleLogs   int
}

// NewBrowseTools creates a new set of browser automation tools
func NewBrowseTools(ctx context.Context) *BrowseTools {
	ctx, cancel := context.WithCancel(ctx)

	// Ensure the screenshot directory exists
	if err := os.MkdirAll(ScreenshotDir, 0o755); err != nil {
		log.Printf("Failed to create screenshot directory: %v", err)
	}

	b := &BrowseTools{
		ctx:            ctx,
		cancel:         cancel,
		screenshots:    make(map[string]time.Time),
		consoleLogs:    make([]*runtime.EventConsoleAPICalled, 0),
		maxConsoleLogs: 100,
	}

	return b
}

// Initialize starts the browser if it's not already running
func (b *BrowseTools) Initialize() error {
	b.mux.Lock()
	defer b.mux.Unlock()

	b.initOnce.Do(func() {
		// ChromeDP.ExecPath has a list of common places to find Chrome...
		opts := chromedp.DefaultExecAllocatorOptions[:]
		// This is the default when running as root, but we generally need it
		// when running in a container, even when we aren't root (which is largely
		// the case for tests).
		opts = append(opts, chromedp.NoSandbox)
		// Setting 'DBUS_SESSION_BUS_ADDRESS=""' or this flag allows tests to pass
		// in GitHub runner contexts. It's a mystery why the failure isn't clear when this fails.
		opts = append(opts, chromedp.Flag("--disable-dbus", true))
		// This can be pretty slow in tests
		opts = append(opts, chromedp.WSURLReadTimeout(30*time.Second))
		allocCtx, _ := chromedp.NewExecAllocator(b.ctx, opts...)
		browserCtx, browserCancel := chromedp.NewContext(
			allocCtx,
			chromedp.WithLogf(log.Printf), chromedp.WithErrorf(log.Printf), chromedp.WithBrowserOption(chromedp.WithDialTimeout(30*time.Second)),
		)

		b.browserCtx = browserCtx
		b.browserCtxCancel = browserCancel

		// Set up console log listener
		chromedp.ListenTarget(browserCtx, func(ev any) {
			switch e := ev.(type) {
			case *runtime.EventConsoleAPICalled:
				b.captureConsoleLog(e)
			}
		})

		// Ensure the browser starts
		if err := chromedp.Run(browserCtx); err != nil {
			b.initErr = fmt.Errorf("failed to start browser (please apt get chromium or equivalent): %w", err)
			return
		}

		// Set default viewport size to 1280x720 (16:9 widescreen)
		if err := chromedp.Run(browserCtx, chromedp.EmulateViewport(1280, 720)); err != nil {
			b.initErr = fmt.Errorf("failed to set default viewport: %w", err)
			return
		}

		b.initialized = true
	})

	return b.initErr
}

// Close shuts down the browser
func (b *BrowseTools) Close() {
	b.mux.Lock()
	defer b.mux.Unlock()

	if b.browserCtxCancel != nil {
		b.browserCtxCancel()
		b.browserCtxCancel = nil
	}

	if b.cancel != nil {
		b.cancel()
	}

	b.initialized = false
	log.Println("Browser closed")
}

// GetBrowserContext returns the context for browser operations
func (b *BrowseTools) GetBrowserContext() (context.Context, error) {
	if err := b.Initialize(); err != nil {
		return nil, err
	}
	return b.browserCtx, nil
}

// All tools return this as a response when successful
type baseResponse struct {
	Status string `json:"status,omitempty"`
}

func successResponse() string {
	return `{"status":"success"}`
}

func errorResponse(err error) string {
	return fmt.Sprintf(`{"status":"error","error":"%s"}`, err.Error())
}

// NavigateTool definition
type navigateInput struct {
	URL     string `json:"url"`
	Timeout string `json:"timeout,omitempty"`
}

// isPort80 reports whether urlStr definitely uses port 80.
func isPort80(urlStr string) bool {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return false
	}
	port := parsedURL.Port()
	return port == "80" || (port == "" && parsedURL.Scheme == "http")
}

// NewNavigateTool creates a tool for navigating to URLs
func (b *BrowseTools) NewNavigateTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_navigate",
		Description: "Navigate the browser to a specific URL and wait for page to load",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"url": {
					"type": "string",
					"description": "The URL to navigate to"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["url"]
		}`),
		Run: b.navigateRun,
	}
}

func (b *BrowseTools) navigateRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input navigateInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	if isPort80(input.URL) {
		return llm.TextContent(errorResponse(fmt.Errorf("port 80 is not the port you're looking for--it is the main sketch server"))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	err = chromedp.Run(timeoutCtx,
		chromedp.Navigate(input.URL),
		chromedp.WaitReady("body"),
	)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	return llm.TextContent(successResponse()), nil
}

// ClickTool definition
type clickInput struct {
	Selector    string `json:"selector"`
	WaitVisible bool   `json:"wait_visible,omitempty"`
	Timeout     string `json:"timeout,omitempty"`
}

// NewClickTool creates a tool for clicking elements
func (b *BrowseTools) NewClickTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_click",
		Description: "Click the first element matching a CSS selector",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"selector": {
					"type": "string",
					"description": "CSS selector for the element to click"
				},
				"wait_visible": {
					"type": "boolean",
					"description": "Wait for the element to be visible before clicking"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["selector"]
		}`),
		Run: b.clickRun,
	}
}

func (b *BrowseTools) clickRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input clickInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	actions := []chromedp.Action{
		chromedp.WaitReady(input.Selector),
	}

	if input.WaitVisible {
		actions = append(actions, chromedp.WaitVisible(input.Selector))
	}

	actions = append(actions, chromedp.Click(input.Selector))

	err = chromedp.Run(timeoutCtx, actions...)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	return llm.TextContent(successResponse()), nil
}

// TypeTool definition
type typeInput struct {
	Selector string `json:"selector"`
	Text     string `json:"text"`
	Clear    bool   `json:"clear,omitempty"`
	Timeout  string `json:"timeout,omitempty"`
}

// NewTypeTool creates a tool for typing into input elements
func (b *BrowseTools) NewTypeTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_type",
		Description: "Type text into an input or textarea element",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"selector": {
					"type": "string",
					"description": "CSS selector for the input element"
				},
				"text": {
					"type": "string",
					"description": "Text to type into the element"
				},
				"clear": {
					"type": "boolean",
					"description": "Clear the input field before typing"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["selector", "text"]
		}`),
		Run: b.typeRun,
	}
}

func (b *BrowseTools) typeRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input typeInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	actions := []chromedp.Action{
		chromedp.WaitReady(input.Selector),
		chromedp.WaitVisible(input.Selector),
	}

	if input.Clear {
		actions = append(actions, chromedp.Clear(input.Selector))
	}

	actions = append(actions, chromedp.SendKeys(input.Selector, input.Text))

	err = chromedp.Run(timeoutCtx, actions...)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	return llm.TextContent(successResponse()), nil
}

// WaitForTool definition
type waitForInput struct {
	Selector string `json:"selector"`
	Timeout  string `json:"timeout,omitempty"`
}

// NewWaitForTool creates a tool for waiting for elements
func (b *BrowseTools) NewWaitForTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_wait_for",
		Description: "Wait for an element to be present in the DOM",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"selector": {
					"type": "string",
					"description": "CSS selector for the element to wait for"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["selector"]
		}`),
		Run: b.waitForRun,
	}
}

func (b *BrowseTools) waitForRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input waitForInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	err = chromedp.Run(timeoutCtx, chromedp.WaitReady(input.Selector))
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	return llm.TextContent(successResponse()), nil
}

// GetTextTool definition
type getTextInput struct {
	Selector string `json:"selector"`
	Timeout  string `json:"timeout,omitempty"`
}

type getTextOutput struct {
	Text string `json:"text"`
}

// NewGetTextTool creates a tool for getting text from elements
func (b *BrowseTools) NewGetTextTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_get_text",
		Description: "Get the innerText of an element. Can be used to read the web page.",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"selector": {
					"type": "string",
					"description": "CSS selector for the element to get text from"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["selector"]
		}`),
		Run: b.getTextRun,
	}
}

func (b *BrowseTools) getTextRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input getTextInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	var text string
	err = chromedp.Run(timeoutCtx,
		chromedp.WaitReady(input.Selector),
		chromedp.Text(input.Selector, &text),
	)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	output := getTextOutput{Text: text}
	result, err := json.Marshal(output)
	if err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("failed to marshal response: %w", err))), nil
	}

	return llm.TextContent(string(result)), nil
}

// EvalTool definition
type evalInput struct {
	Expression string `json:"expression"`
	Timeout    string `json:"timeout,omitempty"`
}

type evalOutput struct {
	Result any `json:"result"`
}

// NewEvalTool creates a tool for evaluating JavaScript
func (b *BrowseTools) NewEvalTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_eval",
		Description: "Evaluate JavaScript in the browser context",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"expression": {
					"type": "string",
					"description": "JavaScript expression to evaluate"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["expression"]
		}`),
		Run: b.evalRun,
	}
}

func (b *BrowseTools) evalRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input evalInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	var result any
	err = chromedp.Run(timeoutCtx, chromedp.Evaluate(input.Expression, &result))
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	output := evalOutput{Result: result}
	response, err := json.Marshal(output)
	if err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("failed to marshal response: %w", err))), nil
	}

	return llm.TextContent(string(response)), nil
}

// ScreenshotTool definition
type screenshotInput struct {
	Selector string `json:"selector,omitempty"`
	Format   string `json:"format,omitempty"`
	Timeout  string `json:"timeout,omitempty"`
}

// NewScreenshotTool creates a tool for taking screenshots
func (b *BrowseTools) NewScreenshotTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_take_screenshot",
		Description: "Take a screenshot of the page or a specific element",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"selector": {
					"type": "string",
					"description": "CSS selector for the element to screenshot (optional)"
				},
				"format": {
					"type": "string",
					"description": "Output format ('base64' or 'png'), defaults to 'base64'",
					"enum": ["base64", "png"]
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			}
		}`),
		Run: b.screenshotRun,
	}
}

func (b *BrowseTools) screenshotRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input screenshotInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	var buf []byte
	var actions []chromedp.Action

	if input.Selector != "" {
		// Take screenshot of specific element
		actions = append(actions,
			chromedp.WaitReady(input.Selector),
			chromedp.Screenshot(input.Selector, &buf, chromedp.NodeVisible),
		)
	} else {
		// Take full page screenshot
		actions = append(actions, chromedp.CaptureScreenshot(&buf))
	}

	err = chromedp.Run(timeoutCtx, actions...)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Save the screenshot and get its ID for potential future reference
	id := b.SaveScreenshot(buf)
	if id == "" {
		return llm.TextContent(errorResponse(fmt.Errorf("failed to save screenshot"))), nil
	}

	// Get the full path to the screenshot
	screenshotPath := GetScreenshotPath(id)

	// Encode the image as base64
	base64Data := base64.StdEncoding.EncodeToString(buf)

	// Return the screenshot directly to the LLM
	return []llm.Content{
		{
			Type: llm.ContentTypeText,
			Text: fmt.Sprintf("Screenshot taken (saved as %s)", screenshotPath),
		},
		{
			Type:      llm.ContentTypeText, // Will be mapped to image in content array
			MediaType: "image/png",
			Data:      base64Data,
		},
	}, nil
}

// ScrollIntoViewTool definition
type scrollIntoViewInput struct {
	Selector string `json:"selector"`
	Timeout  string `json:"timeout,omitempty"`
}

// NewScrollIntoViewTool creates a tool for scrolling elements into view
func (b *BrowseTools) NewScrollIntoViewTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_scroll_into_view",
		Description: "Scroll an element into view if it's not visible",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"selector": {
					"type": "string",
					"description": "CSS selector for the element to scroll into view"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["selector"]
		}`),
		Run: b.scrollIntoViewRun,
	}
}

func (b *BrowseTools) scrollIntoViewRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input scrollIntoViewInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	script := fmt.Sprintf(`
		const el = document.querySelector('%s');
		if (el) {
			el.scrollIntoView({behavior: 'smooth', block: 'center'});
			return true;
		}
		return false;
	`, input.Selector)

	var result bool
	err = chromedp.Run(timeoutCtx,
		chromedp.WaitReady(input.Selector),
		chromedp.Evaluate(script, &result),
	)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	if !result {
		return llm.TextContent(errorResponse(fmt.Errorf("element not found: %s", input.Selector))), nil
	}

	return llm.TextContent(successResponse()), nil
}

// ResizeTool definition
type resizeInput struct {
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Timeout string `json:"timeout,omitempty"`
}

// NewResizeTool creates a tool for resizing the browser window
func (b *BrowseTools) NewResizeTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_resize",
		Description: "Resize the browser window to a specific width and height",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"width": {
					"type": "integer",
					"description": "Window width in pixels"
				},
				"height": {
					"type": "integer",
					"description": "Window height in pixels"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["width", "height"]
		}`),
		Run: b.resizeRun,
	}
}

func (b *BrowseTools) resizeRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input resizeInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	browserCtx, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Create a timeout context for this operation
	timeoutCtx, cancel := context.WithTimeout(browserCtx, parseTimeout(input.Timeout))
	defer cancel()

	// Validate dimensions
	if input.Width <= 0 || input.Height <= 0 {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid dimensions: width and height must be positive"))), nil
	}

	// Resize the browser window
	err = chromedp.Run(timeoutCtx,
		chromedp.EmulateViewport(int64(input.Width), int64(input.Height)),
	)
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	return llm.TextContent(successResponse()), nil
}

// GetTools returns browser tools, optionally filtering out screenshot-related tools
func (b *BrowseTools) GetTools(includeScreenshotTools bool) []*llm.Tool {
	tools := []*llm.Tool{
		b.NewNavigateTool(),
		b.NewClickTool(),
		b.NewTypeTool(),
		b.NewWaitForTool(),
		b.NewGetTextTool(),
		b.NewEvalTool(),
		b.NewScrollIntoViewTool(),
		b.NewResizeTool(),
		b.NewRecentConsoleLogsTool(),
		b.NewClearConsoleLogsTool(),
	}

	// Add screenshot-related tools if supported
	if includeScreenshotTools {
		tools = append(tools, b.NewScreenshotTool())
		tools = append(tools, b.NewReadImageTool())
	}

	return tools
}

// SaveScreenshot saves a screenshot to disk and returns its ID
func (b *BrowseTools) SaveScreenshot(data []byte) string {
	// Generate a unique ID
	id := uuid.New().String()

	// Save the file
	filePath := filepath.Join(ScreenshotDir, id+".png")
	if err := os.WriteFile(filePath, data, 0o644); err != nil {
		log.Printf("Failed to save screenshot: %v", err)
		return ""
	}

	// Track this screenshot
	b.screenshotsMutex.Lock()
	b.screenshots[id] = time.Now()
	b.screenshotsMutex.Unlock()

	return id
}

// GetScreenshotPath returns the full path to a screenshot by ID
func GetScreenshotPath(id string) string {
	return filepath.Join(ScreenshotDir, id+".png")
}

// ReadImageTool definition
type readImageInput struct {
	Path    string `json:"path"`
	Timeout string `json:"timeout,omitempty"`
}

// NewReadImageTool creates a tool for reading images and returning them as base64 encoded data
func (b *BrowseTools) NewReadImageTool() *llm.Tool {
	return &llm.Tool{
		Name:        "read_image",
		Description: "Read an image file (such as a screenshot) and encode it for sending to the LLM",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"path": {
					"type": "string",
					"description": "Path to the image file to read"
				},
				"timeout": {
					"type": "string",
					"description": "Timeout as a Go duration string (default: 5s)"
				}
			},
			"required": ["path"]
		}`),
		Run: b.readImageRun,
	}
}

func (b *BrowseTools) readImageRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input readImageInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	// Check if the path exists
	if _, err := os.Stat(input.Path); os.IsNotExist(err) {
		return llm.TextContent(errorResponse(fmt.Errorf("image file not found: %s", input.Path))), nil
	}

	// Read the file
	imageData, err := os.ReadFile(input.Path)
	if err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("failed to read image file: %w", err))), nil
	}

	// Detect the image type
	imageType := http.DetectContentType(imageData)
	if !strings.HasPrefix(imageType, "image/") {
		return llm.TextContent(errorResponse(fmt.Errorf("file is not an image: %s", imageType))), nil
	}

	// Encode the image as base64
	base64Data := base64.StdEncoding.EncodeToString(imageData)

	// Create a Content object that includes both text and the image
	return []llm.Content{
		{
			Type: llm.ContentTypeText,
			Text: fmt.Sprintf("Image from %s (type: %s)", input.Path, imageType),
		},
		{
			Type:      llm.ContentTypeText, // Will be mapped to image in content array
			MediaType: imageType,
			Data:      base64Data,
		},
	}, nil
}

// parseTimeout parses a timeout string and returns a time.Duration
// It returns a default of 5 seconds if the timeout is empty or invalid
func parseTimeout(timeout string) time.Duration {
	if timeout == "" {
		return 5 * time.Second // default 5 seconds
	}

	dur, err := time.ParseDuration(timeout)
	if err != nil {
		// If parsing fails, return the default
		return 5 * time.Second
	}

	return dur
}

// captureConsoleLog captures a console log event and stores it
func (b *BrowseTools) captureConsoleLog(e *runtime.EventConsoleAPICalled) {
	// Add to logs with mutex protection
	b.consoleLogsMutex.Lock()
	defer b.consoleLogsMutex.Unlock()

	// Add the log and maintain max size
	b.consoleLogs = append(b.consoleLogs, e)
	if len(b.consoleLogs) > b.maxConsoleLogs {
		b.consoleLogs = b.consoleLogs[len(b.consoleLogs)-b.maxConsoleLogs:]
	}
}

// RecentConsoleLogsTool definition
type recentConsoleLogsInput struct {
	Limit int `json:"limit,omitempty"`
}

// NewRecentConsoleLogsTool creates a tool for retrieving recent console logs
func (b *BrowseTools) NewRecentConsoleLogsTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_recent_console_logs",
		Description: "Get recent browser console logs",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"limit": {
					"type": "integer",
					"description": "Maximum number of log entries to return (default: 100)"
				}
			}
		}`),
		Run: b.recentConsoleLogsRun,
	}
}

func (b *BrowseTools) recentConsoleLogsRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input recentConsoleLogsInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	// Ensure browser is initialized
	_, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Apply limit (default to 100 if not specified)
	limit := 100
	if input.Limit > 0 {
		limit = input.Limit
	}

	// Get console logs with mutex protection
	b.consoleLogsMutex.Lock()
	logs := make([]*runtime.EventConsoleAPICalled, 0, len(b.consoleLogs))
	start := 0
	if len(b.consoleLogs) > limit {
		start = len(b.consoleLogs) - limit
	}
	logs = append(logs, b.consoleLogs[start:]...)
	b.consoleLogsMutex.Unlock()

	// Format the logs as JSON
	logData, err := json.MarshalIndent(logs, "", "  ")
	if err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("failed to serialize logs: %w", err))), nil
	}

	// Format the logs
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Retrieved %d console log entries:\n\n", len(logs)))

	if len(logs) == 0 {
		sb.WriteString("No console logs captured.")
	} else {
		// Add the JSON data for full details
		sb.WriteString(string(logData))
	}

	return llm.TextContent(sb.String()), nil
}

// ClearConsoleLogsTool definition
type clearConsoleLogsInput struct{}

// NewClearConsoleLogsTool creates a tool for clearing console logs
func (b *BrowseTools) NewClearConsoleLogsTool() *llm.Tool {
	return &llm.Tool{
		Name:        "browser_clear_console_logs",
		Description: "Clear all captured browser console logs",
		InputSchema: llm.EmptySchema(),
		Run:         b.clearConsoleLogsRun,
	}
}

func (b *BrowseTools) clearConsoleLogsRun(ctx context.Context, m json.RawMessage) ([]llm.Content, error) {
	var input clearConsoleLogsInput
	if err := json.Unmarshal(m, &input); err != nil {
		return llm.TextContent(errorResponse(fmt.Errorf("invalid input: %w", err))), nil
	}

	// Ensure browser is initialized
	_, err := b.GetBrowserContext()
	if err != nil {
		return llm.TextContent(errorResponse(err)), nil
	}

	// Clear console logs with mutex protection
	b.consoleLogsMutex.Lock()
	logCount := len(b.consoleLogs)
	b.consoleLogs = make([]*runtime.EventConsoleAPICalled, 0)
	b.consoleLogsMutex.Unlock()

	return llm.TextContent(fmt.Sprintf("Cleared %d console log entries.", logCount)), nil
}
