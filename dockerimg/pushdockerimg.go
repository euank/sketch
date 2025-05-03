//go:build ignore
// +build ignore

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"sketch.dev/dockerimg"
)

func main() {
	// Display setup instructions for vanilla Ubuntu
	fmt.Print(`SETUP INSTRUCTIONS FOR VANILLA UBUNTU:

# Install Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Install QEMU for multi-arch builds
sudo apt-get install -y qemu-user-static

# Install GitHub CLI
sudo apt-get install -y gh

# Login to Docker with GitHub credentials
gh auth token | docker login ghcr.io -u $(gh api user --jq .login) --password-stdin
`)

	// Ensure we have proper user confirmation
	fmt.Print("\nThis script will build and push multi-architecture Docker images to ghcr.io.\n")
	fmt.Print("Ensure you have followed the setup instructions above and are logged in to Docker and GitHub.\n")
	fmt.Print("Press Enter to continue or Ctrl+C to abort...")
	fmt.Scanln()

	// Create a temporary directory for building
	dir, err := os.MkdirTemp("", "sketch-pushdockerimg-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)

	// Get default image information
	name, dockerfile, tag := dockerimg.DefaultImage()

	// Write the Dockerfile to the temporary directory
	if err := os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte(dockerfile), 0o666); err != nil {
		panic(err)
	}

	// Helper function to run commands
	run := func(args ...string) {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		fmt.Printf("running %v\n", cmd.Args)
		if err := cmd.Run(); err != nil {
			panic(err)
		}
	}

	path := name + ":" + tag

	// Set up BuildX for multi-arch builds
	run("docker", "buildx", "create", "--name", "multiarch-builder", "--use")

	// Make sure the builder is using the proper driver for multi-arch builds
	run("docker", "buildx", "inspect", "--bootstrap")

	// Build and push the multi-arch image in a single command
	run("docker", "buildx", "build",
		"--platform", "linux/amd64,linux/arm64",
		"-t", path,
		"--push",
		".",
	)

	// Inspect the built image to verify it contains both architectures
	run("docker", "buildx", "imagetools", "inspect", path)

	// Clean up the builder
	run("docker", "buildx", "rm", "multiarch-builder")

	fmt.Printf("\n✅ Successfully built and pushed multi-arch image: %s\n", path)
}
