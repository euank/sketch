package main

import (
	"context"
	"flag"
	"fmt"

	"github.com/peterbourgon/ff/v3/ffcli"
)

// listCmd implements the list subcommand
func listCmd() *ffcli.Command {
	fs := flag.NewFlagSet("list", flag.ExitOnError)

	return &ffcli.Command{
		Name:       "list",
		ShortUsage: "palimp list",
		ShortHelp:  "List all sketch/* branches",
		LongHelp:   "List all branches of the form sketch/*, with ahead/behind info vs main branch, organized with the most recent tip commits first. Shows rebase/land status for each branch.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			return listBranches()
		},
	}
}

// lsCmd implements the ls alias for list
func lsCmd() *ffcli.Command {
	fs := flag.NewFlagSet("ls", flag.ExitOnError)

	return &ffcli.Command{
		Name:       "ls",
		ShortUsage: "palimp ls",
		ShortHelp:  "List all sketch/* branches (alias for list)",
		LongHelp:   "List all branches of the form sketch/*, with ahead/behind info vs main branch, organized with the most recent tip commits first. Shows rebase/land status for each branch.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			return listBranches()
		},
	}
}

// landCmd implements the land subcommand
func landCmd() *ffcli.Command {
	fs := flag.NewFlagSet("land", flag.ExitOnError)
	squash := fs.Bool("squash", false, "squash all new commits at the end")
	fs.BoolVar(squash, "s", false, "squash all new commits at the end (short form)")
	dryRun := fs.Bool("dry-run", false, "show what would be done without executing")
	fs.BoolVar(dryRun, "n", false, "show what would be done without executing (short form)")
	force := fs.Bool("force", false, "ignore main branch requirement")
	fs.BoolVar(force, "f", false, "ignore main branch requirement (short form)")
	useLLM := fs.Bool("llm", false, "use LLM to generate improved commit message when squashing")

	return &ffcli.Command{
		Name:       "land",
		ShortUsage: "palimp land [-squash|-s] [-dry-run|-n] [-force|-f] [-llm] <branch>",
		ShortHelp:  "Cherry-pick commits from sketch branch onto main",
		LongHelp:   "Cherry-pick all commits in sketch/BRANCH onto main branch, and on success, delete sketch/BRANCH. Uses change-id trailers to avoid duplicate commits.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			if len(args) != 1 {
				return fmt.Errorf("land requires exactly one branch name argument")
			}
			return landBranch(args[0], LandOptions{
				Squash: *squash,
				DryRun: *dryRun,
				Force:  *force,
				UseLLM: *useLLM,
			})
		},
	}
}

// yCmd implements the y alias for land
func yCmd() *ffcli.Command {
	fs := flag.NewFlagSet("y", flag.ExitOnError)
	squash := fs.Bool("squash", false, "squash all new commits at the end")
	fs.BoolVar(squash, "s", false, "squash all new commits at the end (short form)")
	dryRun := fs.Bool("dry-run", false, "show what would be done without executing")
	fs.BoolVar(dryRun, "n", false, "show what would be done without executing (short form)")
	force := fs.Bool("force", false, "ignore main branch requirement")
	fs.BoolVar(force, "f", false, "ignore main branch requirement (short form)")
	useLLM := fs.Bool("llm", false, "use LLM to generate improved commit message when squashing")

	return &ffcli.Command{
		Name:       "y",
		ShortUsage: "palimp y [-squash|-s] [-dry-run|-n] [-force|-f] [-llm] <branch>",
		ShortHelp:  "Cherry-pick commits from sketch branch onto main (alias for land)",
		LongHelp:   "Cherry-pick all commits in sketch/BRANCH onto main branch, and on success, delete sketch/BRANCH. Uses change-id trailers to avoid duplicate commits.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			if len(args) != 1 {
				return fmt.Errorf("land requires exactly one branch name argument")
			}
			return landBranch(args[0], LandOptions{
				Squash: *squash,
				DryRun: *dryRun,
				Force:  *force,
				UseLLM: *useLLM,
			})
		},
	}
}

// dropCmd implements the drop subcommand
func dropCmd() *ffcli.Command {
	fs := flag.NewFlagSet("drop", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "show what would be done without executing")
	fs.BoolVar(dryRun, "n", false, "show what would be done without executing (short form)")

	return &ffcli.Command{
		Name:       "drop",
		ShortUsage: "palimp drop [-dry-run|-n] <branch>",
		ShortHelp:  "Delete a sketch branch",
		LongHelp:   "Run git branch -D sketch/BRANCH to forcefully delete the branch.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			if len(args) != 1 {
				return fmt.Errorf("drop requires exactly one branch name argument")
			}
			return dropBranch(args[0], *dryRun)
		},
	}
}

// dCmd implements the d alias for drop
func dCmd() *ffcli.Command {
	fs := flag.NewFlagSet("d", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "show what would be done without executing")
	fs.BoolVar(dryRun, "n", false, "show what would be done without executing (short form)")

	return &ffcli.Command{
		Name:       "d",
		ShortUsage: "palimp d [-dry-run|-n] <branch>",
		ShortHelp:  "Delete a sketch branch (alias for drop)",
		LongHelp:   "Run git branch -D sketch/BRANCH to forcefully delete the branch.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			if len(args) != 1 {
				return fmt.Errorf("drop requires exactly one branch name argument")
			}
			return dropBranch(args[0], *dryRun)
		},
	}
}

// updateCmd implements the update subcommand
func updateCmd() *ffcli.Command {
	fs := flag.NewFlagSet("update", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "show what would be done without executing")
	fs.BoolVar(dryRun, "n", false, "show what would be done without executing (short form)")

	return &ffcli.Command{
		Name:       "update",
		ShortUsage: "palimp update [-dry-run|-n] <branch>",
		ShortHelp:  "Rebase sketch branch onto main",
		LongHelp:   "Rebase the sketch branch onto the latest main branch to incorporate recent changes. The branch is updated but not deleted, and main branch remains unchanged.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			if len(args) != 1 {
				return fmt.Errorf("update requires exactly one branch name argument")
			}
			return updateBranch(args[0], *dryRun)
		},
	}
}

// upCmd implements the up alias for update
func upCmd() *ffcli.Command {
	fs := flag.NewFlagSet("up", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "show what would be done without executing")
	fs.BoolVar(dryRun, "n", false, "show what would be done without executing (short form)")

	return &ffcli.Command{
		Name:       "up",
		ShortUsage: "palimp up [-dry-run|-n] <branch>",
		ShortHelp:  "Rebase sketch branch onto main (alias for update)",
		LongHelp:   "Rebase the sketch branch onto the latest main branch to incorporate recent changes. The branch is updated but not deleted, and main branch remains unchanged.",
		FlagSet:    fs,
		Exec: func(ctx context.Context, args []string) error {
			if len(args) != 1 {
				return fmt.Errorf("update requires exactly one branch name argument")
			}
			return updateBranch(args[0], *dryRun)
		},
	}
}

// helpCmd implements the help subcommand
func helpCmd() *ffcli.Command {
	return &ffcli.Command{
		Name:       "help",
		ShortUsage: "palimp help",
		ShortHelp:  "Show conceptual help and background",
		LongHelp:   "Show detailed conceptual help, background information, and usage guidance for palimp.",
		Exec: func(ctx context.Context, args []string) error {
			return showConceptualHelp()
		},
	}
}
