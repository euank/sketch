# palimp - Git Branch Management for Sketch

palimp is a command-line tool for managing git branches created by sketch. It provides operations for listing, landing, dropping, cleaning, and updating sketch branches.

## Installation

Build and install palimp:

```bash
cd cmd/palimp
go build -o palimp .
sudo cp palimp /usr/local/bin/
```

## Commands

### list, ls
List all sketch/* branches with ahead/behind information:
```bash
palimp list
palimp list -v  # verbose with status and LLM summaries
palimp ls       # alias
palimp ls -v    # verbose alias
```

Verbose mode (`-v`) adds two additional columns:
- **STATUS**: Indicates if the branch can rebase/land cleanly (CLEAN, CONFLICT, LANDED, EMPTY, ERROR)
- **SUMMARY**: LLM-generated 6-8 word summary of the branch's work (requires TOGETHER_API_KEY)

### land, y
Cherry-pick commits from a sketch branch onto main:
```bash
palimp land feature-name
palimp land sketch/feature-name  # both forms work
palimp land --squash feature-name  # squash commits
palimp land --dry-run feature-name  # preview changes
palimp y feature-name  # alias
```

### drop, d
Delete a sketch branch:
```bash
palimp drop feature-name
palimp drop --dry-run feature-name  # preview
palimp d feature-name  # alias
```

### clean, c
Delete branches where landing would be a no-op:
```bash
palimp clean
palimp clean --dry-run  # preview
palimp c  # alias
```

### update, up
Rebase a sketch branch onto main:
```bash
palimp update feature-name
palimp update --dry-run feature-name  # preview
palimp up feature-name  # alias
```

### help
Show comprehensive conceptual help and background:
```bash
palimp help                          # detailed workflow guidance
```

## ⚠️ Experimental Tool Warning

**palimp is EXPERIMENTAL, NOT STABLE, and expected to change or disappear in future versions.**
This tool is substantially vibe-coded. Comfort with git reflog is STRONGLY recommended.

## Requirements

- Most commands must be run from the main branch (except `drop` which works from any branch)
- Repository must be in a clean state (no staged/unstaged changes)
- Detects main branch automatically from: main, master, trunk, develop, default, stable

## Features

- **Change-ID deduplication**: Avoids duplicate commits using change-id trailers
- **Safety checks**: Prevents operations on dirty or inconsistent repositories
- **Dry-run support**: Preview operations before executing
- **Smart branch detection**: Works with both full and short branch names

