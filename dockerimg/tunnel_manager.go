package dockerimg

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"sketch.dev/loop"
)

// skipPorts defines system ports that should not be auto-tunneled
var skipPorts = map[string]bool{
	"22":  true, // SSH
	"80":  true, // HTTP (this is the main sketch web interface)
	"443": true, // HTTPS
	"25":  true, // SMTP
	"53":  true, // DNS
	"110": true, // POP3
	"143": true, // IMAP
	"993": true, // IMAPS
	"995": true, // POP3S
}

// TunnelManager manages automatic SSH tunnels for container ports
type TunnelManager struct {
	mu               sync.Mutex
	containerURL     string                // HTTP URL to container (e.g., "http://localhost:8080")
	containerSSHHost string                // SSH hostname for container (e.g., "sketch-abcd-efgh")
	activeTunnels    map[string]*sshTunnel // port -> tunnel mapping
	lastPollTime     time.Time
	maxActiveTunnels int // maximum number of concurrent tunnels allowed
}

// sshTunnel represents an active SSH tunnel
type sshTunnel struct {
	containerPort string
	hostPort      string
	cmd           *exec.Cmd
	cancel        context.CancelFunc
}

// NewTunnelManager creates a new tunnel manager
func NewTunnelManager(containerURL, containerSSHHost string, maxActiveTunnels int) *TunnelManager {
	return &TunnelManager{
		containerURL:     containerURL,
		containerSSHHost: containerSSHHost,
		activeTunnels:    make(map[string]*sshTunnel),
		lastPollTime:     time.Now(),
		maxActiveTunnels: maxActiveTunnels,
	}
}

// Start begins monitoring port events and managing tunnels
func (tm *TunnelManager) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Second) // Poll every 10 seconds
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				tm.cleanupAllTunnels()
				return
			case <-ticker.C:
				tm.pollPortEvents(ctx)
			}
		}
	}()
}

// pollPortEvents fetches recent port events from container and updates tunnels
func (tm *TunnelManager) pollPortEvents(ctx context.Context) {
	// Build URL with since parameter
	url := fmt.Sprintf("%s/port-events?since=%s", tm.containerURL, tm.lastPollTime.Format(time.RFC3339))

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		slog.DebugContext(ctx, "Failed to create port events request", "error", err)
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.DebugContext(ctx, "Failed to fetch port events", "error", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.DebugContext(ctx, "Port events request failed", "status", resp.StatusCode)
		return
	}

	var events []loop.PortEvent
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		slog.DebugContext(ctx, "Failed to decode port events", "error", err)
		return
	}

	// Process each event
	for _, event := range events {
		tm.processPortEvent(ctx, event)
		tm.mu.Lock()
		// Update last poll time to the latest event timestamp
		if event.Timestamp.After(tm.lastPollTime) {
			tm.lastPollTime = event.Timestamp
		}
		tm.mu.Unlock()
	}

	// Update poll time even if no events, to avoid re-fetching old events
	if len(events) == 0 {
		tm.lastPollTime = time.Now()
	}
}

// processPortEvent handles a single port event
func (tm *TunnelManager) processPortEvent(ctx context.Context, event loop.PortEvent) {
	// Extract port number from event.Port (format: "tcp:0.0.0.0:8080")
	containerPort := tm.extractPortNumber(event.Port)
	if containerPort == "" {
		slog.DebugContext(ctx, "Could not extract port number", "port", event.Port)
		return
	}

	// Skip common system ports that we don't want to tunnel
	if tm.shouldSkipPort(containerPort) {
		return
	}

	switch event.Type {
	case "opened":
		tm.createTunnel(ctx, containerPort)
	case "closed":
		tm.removeTunnel(ctx, containerPort)
	default:
		slog.DebugContext(ctx, "Unknown port event type", "type", event.Type)
	}
}

// extractPortNumber extracts port number from ss format like "tcp:0.0.0.0:8080"
func (tm *TunnelManager) extractPortNumber(portStr string) string {
	// Expected format: "tcp:0.0.0.0:8080" or "tcp:[::]:8080"
	// Find the last colon and extract the port
	for i := len(portStr) - 1; i >= 0; i-- {
		if portStr[i] == ':' {
			return portStr[i+1:]
		}
	}
	return ""
}

// shouldSkipPort returns true for ports we don't want to auto-tunnel
func (tm *TunnelManager) shouldSkipPort(port string) bool {
	return skipPorts[port]
}

// createTunnel creates an SSH tunnel for the given container port
func (tm *TunnelManager) createTunnel(ctx context.Context, containerPort string) {
	tm.mu.Lock()
	// Check if tunnel already exists
	if _, exists := tm.activeTunnels[containerPort]; exists {
		tm.mu.Unlock()
		slog.DebugContext(ctx, "Tunnel already exists for port", "port", containerPort)
		return
	}

	// Check if we've reached the maximum number of active tunnels
	if len(tm.activeTunnels) >= tm.maxActiveTunnels {
		tm.mu.Unlock()
		slog.WarnContext(ctx, "Maximum active tunnels reached, skipping port", "port", containerPort, "max", tm.maxActiveTunnels, "active", len(tm.activeTunnels))
		return
	}
	tm.mu.Unlock()

	// Use the same port on host as container for simplicity
	hostPort := containerPort

	// Create SSH tunnel command: ssh -L hostPort:127.0.0.1:containerPort containerSSHHost
	tunnelCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(tunnelCtx, "ssh",
		"-L", fmt.Sprintf("%s:127.0.0.1:%s", hostPort, containerPort),
		"-N", // Don't execute remote commands
		"-T", // Don't allocate TTY
		tm.containerSSHHost,
	)

	// Start the tunnel
	if err := cmd.Start(); err != nil {
		slog.ErrorContext(ctx, "Failed to start SSH tunnel", "port", containerPort, "error", err)
		cancel()
		return
	}

	// Store tunnel info
	tunnel := &sshTunnel{
		containerPort: containerPort,
		hostPort:      hostPort,
		cmd:           cmd,
		cancel:        cancel,
	}
	tm.mu.Lock()
	tm.activeTunnels[containerPort] = tunnel
	tm.mu.Unlock()

	slog.InfoContext(ctx, "Created SSH tunnel", "container_port", containerPort, "host_port", hostPort)

	// Monitor tunnel in background
	go func() {
		err := cmd.Wait()
		tm.mu.Lock()
		delete(tm.activeTunnels, containerPort)
		tm.mu.Unlock()
		if err != nil && tunnelCtx.Err() == nil {
			slog.ErrorContext(ctx, "SSH tunnel exited with error", "port", containerPort, "error", err)
		}
	}()
}

// removeTunnel removes an SSH tunnel for the given container port
func (tm *TunnelManager) removeTunnel(ctx context.Context, containerPort string) {
	tunnel, exists := tm.activeTunnels[containerPort]
	if !exists {
		return
	}

	// Cancel the tunnel context and clean up
	tunnel.cancel()
	delete(tm.activeTunnels, containerPort)

	slog.InfoContext(ctx, "Removed SSH tunnel", "container_port", containerPort, "host_port", tunnel.hostPort)
}

// cleanupAllTunnels stops all active tunnels
func (tm *TunnelManager) cleanupAllTunnels() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for port, tunnel := range tm.activeTunnels {
		tunnel.cancel()
		delete(tm.activeTunnels, port)
	}
}

// GetActiveTunnels returns a list of currently active tunnels
func (tm *TunnelManager) GetActiveTunnels() map[string]string {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	result := make(map[string]string)
	for containerPort, tunnel := range tm.activeTunnels {
		result[containerPort] = tunnel.hostPort
	}
	return result
}
