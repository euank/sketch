package loop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"sketch.dev/ant"
)

type HttpProxyRequest struct {
	Action string `json:"action"` // "start" or "stop"
	Name   string `json:"name"`   // Name of the proxy, used in URL path
	Port   int    `json:"port"`   // Local port to proxy to
}

var nameRegex = regexp.MustCompile(`^[a-z0-9_-]+$`)

// MakeHttpProxyTool creates a tool that allows the agent to set up HTTP proxies
// for locally running services.
func MakeHttpProxyTool(agent *Agent, tempDir string) *ant.Tool {
	return &ant.Tool{
		Name:        "http_proxy",
		Description: fmt.Sprintf("Proxies a local service to make it accessible via the sketch UI or stops an existing proxy. The base URL for Sketch is %s", agent.URL()),
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {
					"type": "string",
					"enum": ["start", "stop"],
					"description": "Whether to start or stop the proxy"
				},
				"name": {
					"type": "string",
					"pattern": "^[a-z0-9_-]+$",
					"description": "Name of the proxy, used in the proxy URL path. Must contain only lowercase letters, numbers, underscores, and hyphens."
				},
				"port": {
					"type": "integer",
					"minimum": 1,
					"maximum": 65535,
					"description": "Local port to proxy to"
				}
			},
			"required": ["action", "name"]
		}`),
		Run: func(ctx context.Context, input json.RawMessage) (string, error) {
			// Create proxy log directory if it doesn't exist
			proxyLogDir := filepath.Join(tempDir, "proxy_logs")
			err := os.MkdirAll(proxyLogDir, 0755)
			if err != nil {
				return "", fmt.Errorf("failed to create proxy log directory: %w", err)
			}

			// Parse the request
			var req HttpProxyRequest
			if err := json.Unmarshal(input, &req); err != nil {
				return "", fmt.Errorf("failed to parse proxy request: %w", err)
			}

			// Validate the name
			if !nameRegex.MatchString(req.Name) {
				return "", errors.New("proxy name must match pattern [a-z0-9_-]+")
			}

			// Get the agent's URL to construct a valid link
			agentURL := agent.URL()

			// Handle the action
			switch req.Action {
			case "start":
				if req.Port <= 0 || req.Port > 65535 {
					return "", errors.New("port must be between 1 and 65535")
				}

				// Create a new log file for this proxy
				timestamp := time.Now().Format("20060102_150405")
				logFilePath := filepath.Join(proxyLogDir, fmt.Sprintf("%s_%s.log", req.Name, timestamp))

				logFile, err := os.Create(logFilePath)
				if err != nil {
					return "", fmt.Errorf("failed to create proxy log file: %w", err)
				}
				logFile.Close()

				proxyPath := fmt.Sprintf("/proxy/%s", url.PathEscape(req.Name))
				proxyConfig := ProxyConfig{
					Name: req.Name,
					Port: req.Port,
					Path: proxyPath,
				}

				// Set up the proxy by updating the Agent
				err = agent.AddProxy(proxyConfig)
				if err != nil {
					return "", fmt.Errorf("failed to add proxy: %w", err)
				}

				slog.Info("Proxy created", "name", req.Name, "port", req.Port, "path", proxyPath)

				proxyURL := fmt.Sprintf("%s%s", agentURL, proxyPath)
				return fmt.Sprintf("Proxy created successfully. You can access the service at %s\nProxy log file: %s", proxyURL, logFilePath), nil

			case "stop":
				// Remove the proxy by updating the Agent
				if !agent.RemoveProxy(req.Name) {
					return "", fmt.Errorf("no proxy with name '%s' found", req.Name)
				}

				slog.Info("Proxy removed", "name", req.Name)
				return fmt.Sprintf("Proxy '%s' has been stopped and removed", req.Name), nil

			default:
				return "", fmt.Errorf("invalid action: %s (must be 'start' or 'stop')", req.Action)
			}
		},
	}
}
