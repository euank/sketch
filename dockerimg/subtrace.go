package dockerimg

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
)

// downloadSubtrace downloads the subtrace binary for the given architecture
// and caches it in ~/.cache/sketch/subtrace-{platform}-{arch}
func downloadSubtrace(ctx context.Context, platform, arch string) (string, error) {
	_ = ctx // ctx is reserved for future timeout/cancellation support
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}

	cacheDir := filepath.Join(homeDir, ".cache", "sketch")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create cache directory: %w", err)
	}

	binaryName := fmt.Sprintf("subtrace-%s-%s", platform, arch)
	binaryPath := filepath.Join(cacheDir, binaryName)

	// Check if the binary already exists
	if _, err := os.Stat(binaryPath); err == nil {
		// Binary exists, return the path
		return binaryPath, nil
	}

	// Download the binary
	downloadURL := fmt.Sprintf("https://subtrace.dev/download/latest/%s/%s/subtrace", platform, arch)

	resp, err := http.Get(downloadURL)
	if err != nil {
		return "", fmt.Errorf("failed to download subtrace from %s: %w", downloadURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download subtrace: HTTP %d", resp.StatusCode)
	}

	// Create the binary file
	file, err := os.Create(binaryPath)
	if err != nil {
		return "", fmt.Errorf("failed to create subtrace binary file: %w", err)
	}
	defer file.Close()

	// Copy the downloaded content to the file
	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to write subtrace binary: %w", err)
	}

	// Make the binary executable
	if err := os.Chmod(binaryPath, 0o755); err != nil {
		return "", fmt.Errorf("failed to make subtrace binary executable: %w", err)
	}

	return binaryPath, nil
}

// setupSubtraceBeforeStart downloads subtrace and uploads it to the container before it starts
func setupSubtraceBeforeStart(ctx context.Context, cntrName, subtraceToken string) error {
	if subtraceToken == "" {
		return nil
	}

	// Download subtrace binary
	subtracePath, err := downloadSubtrace(ctx, "linux", runtime.GOARCH)
	if err != nil {
		return fmt.Errorf("failed to download subtrace: %w", err)
	}

	// Copy subtrace binary to the container (container exists but isn't started)
	if out, err := combinedOutput(ctx, "docker", "cp", subtracePath, cntrName+":/usr/local/bin/subtrace"); err != nil {
		return fmt.Errorf("failed to copy subtrace to container: %s: %w", out, err)
	}

	return nil
}
