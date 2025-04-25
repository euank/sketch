package loop

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// proxy supports allowing Sketch to proxy an HTTP server running inside its
// container to the outside world within its web server.
type proxy struct {
	Config       ProxyConfig
	ReverseProxy *httputil.ReverseProxy
	LogFile      *os.File
	LogMutex     sync.Mutex
	TargetURL    *url.URL
}

// AddProxy adds a new proxy configuration to the agent
// Returns error if the name is not unique or the proxy can't be created
func (a *Agent) AddProxy(config ProxyConfig) error {
	a.proxiesMu.Lock()
	defer a.proxiesMu.Unlock()

	// Verify name uniqueness
	if _, exists := a.proxies[config.Name]; exists {
		return fmt.Errorf("proxy with name '%s' already exists", config.Name)
	}

	// Create the target URL
	targetURL, err := url.Parse(fmt.Sprintf("http://localhost:%d", config.Port))
	if err != nil {
		return fmt.Errorf("failed to parse target URL: %w", err)
	}

	// Set up the logger
	logDir := filepath.Join(a.proxyLogDir, "proxy_logs")
	os.MkdirAll(logDir, 0755)
	logFilepath := filepath.Join(logDir, fmt.Sprintf("%s_requests.log", config.Name))
	logFile, err := os.OpenFile(logFilepath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open proxy log file: %w", err)
	}

	// Create the reverse proxy
	reverseProxy := httputil.NewSingleHostReverseProxy(targetURL)

	// Save the original director
	originalDirector := reverseProxy.Director

	// Create a new custom director that modifies the request
	reverseProxy.Director = func(req *http.Request) {
		// Call the original director first
		originalDirector(req)

		// Update the Host header to match the target
		req.Host = targetURL.Host

		// Strip the /proxy/{name} prefix from the path
		prefix := fmt.Sprintf("/proxy/%s", config.Name)
		req.URL.Path = strings.TrimPrefix(req.URL.Path, prefix)
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}

		// Strip Cookie header from outgoing request
		req.Header.Del("Cookie")
	}

	reverseProxy.ModifyResponse = func(resp *http.Response) error {
		// Remove Set-Cookie headers from the response
		resp.Header.Del("Set-Cookie")
		return nil
	}

	p := &proxy{
		Config:       config,
		ReverseProxy: reverseProxy,
		LogFile:      logFile,
		TargetURL:    targetURL,
	}

	// Create a custom transport that logs responses
	originalTransport := http.DefaultTransport
	reverseProxy.Transport = &loggingTransport{
		Transport: originalTransport,
		proxy:     p,
	}

	// Add the proxy to the agent's map
	a.proxies[config.Name] = p

	return nil
}

// RemoveProxy removes a proxy configuration by name
// Returns true if a proxy was found and removed, false otherwise
func (a *Agent) RemoveProxy(name string) bool {
	a.proxiesMu.Lock()
	defer a.proxiesMu.Unlock()

	if p, exists := a.proxies[name]; exists {
		// Close the log file
		if p.LogFile != nil {
			p.LogFile.Close()
		}

		// Remove from the map
		delete(a.proxies, name)
		return true
	}

	return false
}

// GetProxies returns all configured proxy services
func (a *Agent) GetProxies() []ProxyConfig {
	a.proxiesMu.Lock()
	defer a.proxiesMu.Unlock()

	// Return a copy of the proxy configs
	result := make([]ProxyConfig, 0, len(a.proxies))
	for _, p := range a.proxies {
		result = append(result, p.Config)
	}
	return result
}

// HandleProxyRequest handles an HTTP proxy request for a given name
func (a *Agent) HandleProxyRequest(w http.ResponseWriter, r *http.Request, name string) error {
	a.proxiesMu.Lock()
	p, exists := a.proxies[name]
	a.proxiesMu.Unlock()

	if !exists {
		http.Error(w, fmt.Sprintf("Proxy '%s' not found", name), http.StatusNotFound)
		return fmt.Errorf("proxy '%s' not found", name)
	}

	// Handle the request with the preexisting ReverseProxy
	// Logging happens in the transport's RoundTrip method
	p.ReverseProxy.ServeHTTP(w, r)

	return nil
}

// loggingTransport is a custom http.RoundTripper that logs responses
type loggingTransport struct {
	Transport http.RoundTripper
	proxy     *proxy
}

func (t *loggingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// Log the request and response in a single line
	t.proxy.LogMutex.Lock()
	defer t.proxy.LogMutex.Unlock()

	// Save the start time
	startTime := time.Now()
	timestamp := startTime.Format(time.RFC3339)

	// Forward the request to the actual target
	resp, err := t.Transport.RoundTrip(req)

	// Calculate request duration
	duration := time.Since(startTime)

	if err != nil {
		// Log error with request details
		fmt.Fprintf(t.proxy.LogFile, "[%s] %s %s %s → Error: %v (%s)\n",
			timestamp, req.Method, req.URL.Path, req.RemoteAddr, err, duration)
		return nil, err
	}

	// Log success with request details and status code
	status := resp.StatusCode
	statusText := http.StatusText(status)
	fmt.Fprintf(t.proxy.LogFile, "[%s] %s %s %s → %d %s (%s)\n",
		timestamp, req.Method, req.URL.Path, req.RemoteAddr, status, statusText, duration)

	return resp, nil
}
