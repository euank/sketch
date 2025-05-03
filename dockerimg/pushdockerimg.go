//go:build ignore
// +build ignore

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"sketch.dev/dockerimg"
)

func main() {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		fmt.Fprintf(os.Stderr, "pushdockerimg.go: requires ubuntu linux/amd64\n")
		os.Exit(2)
	}
	// Display setup instructions for vanilla Ubuntu
	fmt.Print(`Push a sketch docker image to the public GitHub container registry.

	# One-off setup instructions:
	sudo apt-get update
	sudo apt-get install docker.io docker-buildx qemu-user-static
	# Login to Docker with GitHub credentials
	# You can get $GH_ACCESS_TOK from github.com or from 'gh auth token'.
	# On github.com, User icon in top right...Settings...Developer Settings.
	# Make sure the token is configured to write containers for the boldsoftware org.
	echo $GH_ACCESS_TOK | docker login ghcr.io -u $GH_USER --password-stdin

This script will build and push multi-architecture Docker images to ghcr.io.
Ensure you have followed the setup instructions above and are logged in to Docker and GitHub.

Press Enter to continue or Ctrl+C to abort...`)
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
