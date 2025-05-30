// Package main provides a tool for managing git branches created by sketch.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/peterbourgon/ff/v3/ffcli"
)

func main() {
	err := run()
	if err != nil {
		fmt.Fprintf(os.Stderr, "palimp: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	root := &ffcli.Command{
		Name:       "palimp",
		ShortUsage: "palimp <subcommand> [flags] [args...]",
		ShortHelp:  "Manage git branches created by sketch",
		LongHelp: `⚠️  EXPERIMENTAL TOOL - USE AT YOUR OWN RISK ⚠️

palimp is EXPERIMENTAL, NOT STABLE, and expected to change or disappear in future versions.
This tool is substantially vibe-coded. Comfort with git reflog is recommended.

palimp manages git branches created by sketch.

All operations require being on the main branch with a clean repository state.
The main branch is detected as the first existing branch from: main, master, trunk, develop, default, stable.

For conceptual help and background: palimp help`,
		Subcommands: []*ffcli.Command{
			listCmd(),
			lsCmd(),
			landCmd(),
			yCmd(),
			dropCmd(),
			dCmd(),
			updateCmd(),
			upCmd(),
			helpCmd(),
		},
		Exec: func(ctx context.Context, args []string) error {
			return fmt.Errorf("please specify a subcommand; run 'palimp -h' for help")
		},
	}

	return root.ParseAndRun(context.Background(), os.Args[1:])
}
