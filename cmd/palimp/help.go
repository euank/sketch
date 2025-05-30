package main

import (
	"fmt"
)

// showConceptualHelp displays comprehensive help and background information
func showConceptualHelp() error {
	fmt.Print(conceptualHelpText)
	return nil
}

const conceptualHelpText = `# What is palimp?

palimp (short for palimpsest) is a git branch management tool specifically designed for the sketch workflow.
It helps you manage the lifecycle of sketch/* branches - from creation through landing.

## The Sketch Workflow Problem

When using sketch, you end up with many sketch/* branches containing work in progress.
These branches need to be:
- Listed and reviewed
- Landed (cherry-picked) onto main
- Cleaned up when no longer needed
- Updated when main advances

Doing this manually with git commands is tedious and error-prone.

## Core Concepts

**sketch/* branches**: All branches created by sketch follow the pattern sketch/some-name.
These are feature branches containing commits you want to eventually land on main.

**Landing vs Merging**: palimp doesn't merge branches. It cherry-picks commits from
sketch branches onto main, preserving individual commit history while avoiding
merge commits. This keeps main's history linear and clean.

**Change-ID deduplication**: Commits with the same Change-ID trailer are considered
equivalent. palimp skips cherry-picking commits that are already on main via their
Change-ID, preventing duplicates even if the commit hashes differ.

**Main branch detection**: palimp automatically finds your main branch by checking
for the first existing branch from: main, master, trunk, develop, default, stable.

## Safety Model

palimp is paranoid about safety and will refuse to run unless:
- You're on the main branch
- Working directory is clean (no staged/unstaged changes)
- No ongoing git operations (merge, rebase, cherry-pick, etc.)

This prevents you from accidentally corrupting your repository state.

## Common Workflows

**Daily branch cleanup:**
  palimp list          # see what branches exist
  palimp drop my-old-branch  # manually delete specific branches

**Landing a feature:**
  palimp land -n my-feature  # preview what would be landed
  palimp land my-feature     # actually land it

**Updating an old branch:**
  palimp update -n my-feature  # preview rebase onto main
  palimp update my-feature     # rebase to get latest main changes

**Emergency branch removal:**
  palimp drop my-feature  # forcefully delete a branch

## Branch Name Flexibility

All commands accept branch names with or without the sketch/ prefix:
  palimp land my-feature        # same as...
  palimp land sketch/my-feature # ...this



## When Things Go Wrong

Since this tool is experimental and vibe-coded, things might go wrong.
Comfort with git reflog is essential for recovery:

  git reflog                    # see recent git operations
  git reset --hard HEAD@{3}    # go back to a previous state
  git cherry-pick <commit>      # manually re-apply commits

Always use --dry-run first to preview operations before committing to them.

## Philosophical Note

palimp embodies a particular philosophy about git workflows:
- Linear main branch history is valuable
- Individual commits should be preserved and meaningful
- Feature branches are temporary and should be cleaned up
- Automation should be safe and predictable

If this doesn't match your team's workflow, palimp might not be for you.

## Commands Quick Reference

  list, ls     List sketch branches with ahead/behind info
  land, y      Cherry-pick commits from sketch branch to main  
  drop, d      Force delete a sketch branch
  update, up   Rebase sketch branch onto latest main

  help         Show this help

All commands support --dry-run (-n) for previewing changes.
Use --help on any command for detailed flag information.

⚠️  Remember: This tool is experimental. Always double-check results and keep git reflog handy!
`
