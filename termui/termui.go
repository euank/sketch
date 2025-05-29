package termui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"text/template"
	"time"

	"github.com/dustin/go-humanize"
	"github.com/fatih/color"
	"golang.org/x/term"
	"sketch.dev/loop"
)

var (
	// toolUseTemplTxt defines how tool invocations appear in the terminal UI.
	// Keep this template in sync with the tools defined in claudetool package
	// and registered in loop/agent.go.
	// Add formatting for new tools as they are created.
	// TODO: should this be part of tool definition to make it harder to forget to set up?
	toolUseTemplTxt = `{{if .msg.ToolError}}〰️ {{end -}}
{{if eq .msg.ToolName "think" -}}
 🧠 {{.input.thoughts -}}
{{else if eq .msg.ToolName "keyword_search" -}}
 🔍 {{ .input.query}}: {{.input.search_terms -}}
{{else if eq .msg.ToolName "bash" -}}
 🖥️{{if .input.background}}🔄{{end}}  {{ .input.command -}}
{{else if eq .msg.ToolName "patch" -}}
 ⌨️  {{.input.path -}}
{{else if eq .msg.ToolName "done" -}}
{{/* nothing to show here, the agent will write more in its next message */}}
{{else if eq .msg.ToolName "title" -}}
🏷️  {{.input.title}}
{{else if eq .msg.ToolName "precommit" -}}
🌱 git branch: sketch/{{.input.branch_name}}
{{else if eq .msg.ToolName "about_sketch" -}}
📚 About Sketch
{{else if eq .msg.ToolName "str_replace_editor" -}}
 ✏️  {{.input.file_path -}}
{{else if eq .msg.ToolName "codereview" -}}
 🐛  Running automated code review, may be slow
{{else if eq .msg.ToolName "multiplechoice" -}}
 📝 {{.input.question}}
{{ range .input.responseOptions -}}
  - {{ .caption}}: {{.responseText}}
{{end -}}
{{else -}}
 🛠️  {{ .msg.ToolName}}: {{.msg.ToolInput -}}
{{end -}}
`
	toolUseTmpl = template.Must(template.New("tool_use").Parse(toolUseTemplTxt))
)

type TermUI struct {
	stdin  *os.File
	stdout *os.File
	stderr *os.File

	agent   loop.CodingAgent
	httpURL string

	trm *term.Terminal

	// the chatMsgCh channel is for "conversation" messages, like responses to user input
	// from the LLM, or output from executing slash-commands issued by the user.
	chatMsgCh chan chatMessage

	// the log channel is for secondary messages, like logging, errors, and debug information
	// from local and remove subproceses.
	termLogCh chan string

	// protects following
	mu       sync.Mutex
	oldState *term.State
	// Tracks branches that were pushed during the session
	pushedBranches map[string]struct{}

	// Pending message count, for graceful shutdown
	messageWaitGroup sync.WaitGroup
}

type chatMessage struct {
	idx      int
	sender   string
	content  string
	thinking bool
}

func New(agent loop.CodingAgent, httpURL string) *TermUI {
	return &TermUI{
		agent:          agent,
		stdin:          os.Stdin,
		stdout:         os.Stdout,
		stderr:         os.Stderr,
		httpURL:        httpURL,
		chatMsgCh:      make(chan chatMessage, 1),
		termLogCh:      make(chan string, 1),
		pushedBranches: make(map[string]struct{}),
	}
}

func (ui *TermUI) Run(ctx context.Context) error {
	fmt.Println(`🌐 ` + ui.httpURL + `/`)
	fmt.Println(`💬 type 'help' for help`)
	fmt.Println()

	// Start up the main terminal UI:
	if err := ui.initializeTerminalUI(ctx); err != nil {
		return err
	}
	go ui.receiveMessagesLoop(ctx)
	if err := ui.inputLoop(ctx); err != nil {
		return err
	}
	return nil
}

func (ui *TermUI) LogToolUse(resp *loop.AgentMessage) {
	inputData := map[string]any{}
	if err := json.Unmarshal([]byte(resp.ToolInput), &inputData); err != nil {
		ui.AppendSystemMessage("error: %v", err)
		return
	}
	buf := bytes.Buffer{}
	if err := toolUseTmpl.Execute(&buf, map[string]any{"msg": resp, "input": inputData, "output": resp.ToolResult}); err != nil {
		ui.AppendSystemMessage("error: %v", err)
		return
	}
	ui.AppendSystemMessage("%s\n", buf.String())
}

func (ui *TermUI) receiveMessagesLoop(ctx context.Context) {
	it := ui.agent.NewIterator(ctx, 0)
	bold := color.New(color.Bold).SprintFunc()
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		resp := it.Next()
		if resp == nil {
			return
		}
		if resp.HideOutput {
			continue
		}
		// Typically a user message will start the thinking and a (top-level
		// conversation) end of turn will stop it.
		thinking := !(resp.EndOfTurn && resp.ParentConversationID == nil)

		switch resp.Type {
		case loop.AgentMessageType:
			ui.AppendChatMessage(chatMessage{thinking: thinking, idx: resp.Idx, sender: "🕴️ ", content: resp.Content})
		case loop.ToolUseMessageType:
			ui.LogToolUse(resp)
		case loop.ErrorMessageType:
			ui.AppendSystemMessage("❌ %s", resp.Content)
		case loop.BudgetMessageType:
			ui.AppendSystemMessage("💰 %s", resp.Content)
		case loop.AutoMessageType:
			ui.AppendSystemMessage("🧐 %s", resp.Content)
		case loop.UserMessageType:
			ui.AppendChatMessage(chatMessage{thinking: thinking, idx: resp.Idx, sender: "🦸", content: resp.Content})
		case loop.CommitMessageType:
			// Display each commit in the terminal
			for _, commit := range resp.Commits {
				if commit.PushedBranch != "" {
					ui.AppendSystemMessage("🔄 new commit: [%s] %s\npushed to: %s", commit.Hash[:8], commit.Subject, bold(commit.PushedBranch))

					// Track the pushed branch in our map
					ui.mu.Lock()
					ui.pushedBranches[commit.PushedBranch] = struct{}{}
					ui.mu.Unlock()
				} else {
					ui.AppendSystemMessage("🔄 new commit: [%s] %s", commit.Hash[:8], commit.Subject)
				}
			}
		default:
			ui.AppendSystemMessage("❌ Unexpected Message Type %s %v", resp.Type, resp)
		}
	}
}

func (ui *TermUI) inputLoop(ctx context.Context) error {
	for {
		line, err := ui.trm.ReadLine()
		if errors.Is(err, io.EOF) {
			ui.AppendSystemMessage("\n")
			line = "exit"
		} else if err != nil {
			return err
		}

		line = strings.TrimSpace(line)

		switch line {
		case "?", "help":
			ui.AppendSystemMessage(`General use:
Use chat to ask sketch to tackle a task or answer a question about this repo.

Special commands:
- help, ?             : Show this help message
- budget              : Show original budget
- usage, cost         : Show current token usage and cost
- browser, open, b    : Open current conversation in browser
- stop, cancel, abort : Cancel the current operation
- compact             : Compress conversation history to reduce context size
- exit, quit, q       : Exit sketch
- ! <command>         : Execute a shell command (e.g. !ls -la)`)
		case "budget":
			originalBudget := ui.agent.OriginalBudget()
			ui.AppendSystemMessage("💰 Budget summary:")
			if originalBudget.MaxResponses > 0 {
				ui.AppendSystemMessage("- Max responses: %d", originalBudget.MaxResponses)
			}
			if originalBudget.MaxWallTime > 0 {
				ui.AppendSystemMessage("- Max wall time: %v", originalBudget.MaxWallTime)
			}
			ui.AppendSystemMessage("- Max total cost: %0.2f", originalBudget.MaxDollars)
		case "browser", "open", "b":
			if ui.httpURL != "" {
				ui.AppendSystemMessage("🌐 Opening %s in browser", ui.httpURL)
				go ui.agent.OpenBrowser(ui.httpURL)
			} else {
				ui.AppendSystemMessage("❌ No web URL available for this session")
			}
		case "usage", "cost":
			totalUsage := ui.agent.TotalUsage()
			ui.AppendSystemMessage("💰 Current usage summary:")
			ui.AppendSystemMessage("- Input tokens: %s", humanize.Comma(int64(totalUsage.TotalInputTokens())))
			ui.AppendSystemMessage("- Output tokens: %s", humanize.Comma(int64(totalUsage.OutputTokens)))
			ui.AppendSystemMessage("- Responses: %d", totalUsage.Responses)
			ui.AppendSystemMessage("- Wall time: %s", totalUsage.WallTime().Round(time.Second))
			ui.AppendSystemMessage("- Total cost: $%0.2f", totalUsage.TotalCostUSD)
		case "bye", "exit", "q", "quit":
			ui.trm.SetPrompt("")
			// Display final usage stats
			totalUsage := ui.agent.TotalUsage()
			ui.AppendSystemMessage("💰 Final usage summary:")
			ui.AppendSystemMessage("- Input tokens: %s", humanize.Comma(int64(totalUsage.TotalInputTokens())))
			ui.AppendSystemMessage("- Output tokens: %s", humanize.Comma(int64(totalUsage.OutputTokens)))
			ui.AppendSystemMessage("- Responses: %d", totalUsage.Responses)
			ui.AppendSystemMessage("- Wall time: %s", totalUsage.WallTime().Round(time.Second))
			ui.AppendSystemMessage("- Total cost: $%0.2f", totalUsage.TotalCostUSD)

			// Display pushed branches
			ui.mu.Lock()
			if len(ui.pushedBranches) > 0 {
				// Convert map keys to a slice for display
				branches := make([]string, 0, len(ui.pushedBranches))
				for branch := range ui.pushedBranches {
					branches = append(branches, branch)
				}

				initialCommitRef := getShortSHA(ui.agent.SketchGitBase())
				if len(branches) == 1 {
					ui.AppendSystemMessage("\n🔄 Branch pushed during session: %s", branches[0])
					ui.AppendSystemMessage("🍒 Cherry-pick those changes: git cherry-pick %s..%s", initialCommitRef, branches[0])
					ui.AppendSystemMessage("🔀 Merge those changes:       git merge %s", branches[0])
					ui.AppendSystemMessage("🗑️  Delete the branch:         git branch -D %s", branches[0])
				} else {
					ui.AppendSystemMessage("\n🔄 Branches pushed during session:")
					for _, branch := range branches {
						ui.AppendSystemMessage("- %s", branch)
					}
					ui.AppendSystemMessage("\n🍒 To add all those changes to your branch:")
					for _, branch := range branches {
						ui.AppendSystemMessage("git cherry-pick %s..%s", initialCommitRef, branch)
					}
					ui.AppendSystemMessage("\n🔀                              or:")
					for _, branch := range branches {
						ui.AppendSystemMessage("git merge %s", branch)
					}

					ui.AppendSystemMessage("\n🗑️  To delete branches:")
					for _, branch := range branches {
						ui.AppendSystemMessage("git branch -D %s", branch)
					}
				}
			}
			ui.mu.Unlock()

			ui.AppendSystemMessage("\n👋 Goodbye!")
			// Wait for all pending messages to be processed before exiting
			ui.messageWaitGroup.Wait()
			return nil
		case "stop", "cancel", "abort":
			ui.agent.CancelTurn(fmt.Errorf("user canceled the operation"))
		case "compact":
			// Call the compact method on the agent's conversation
			ui.handleCompactCommand()
		case "panic":
			panic("user forced a panic")
		default:
			if line == "" {
				continue
			}
			if strings.HasPrefix(line, "!") {
				// Execute as shell command
				line = line[1:] // remove the '!' prefix
				sendToLLM := strings.HasPrefix(line, "!")
				if sendToLLM {
					line = line[1:] // remove the second '!'
				}

				// Create a cmd and run it
				// TODO: ui.trm contains a mutex inside its write call.
				// It is potentially safe to attach ui.trm directly to this
				// cmd object's Stdout/Stderr and stream the output.
				// That would make a big difference for, e.g. wget.
				cmd := exec.Command("bash", "-c", line)
				out, err := cmd.CombinedOutput()
				ui.AppendSystemMessage("%s", out)
				if err != nil {
					ui.AppendSystemMessage("❌ Command error: %v", err)
				}
				if sendToLLM {
					// Send the command and its output to the agent
					message := fmt.Sprintf("I ran the command: `%s`\nOutput:\n```\n%s```", line, out)
					if err != nil {
						message += fmt.Sprintf("\n\nError: %v", err)
					}
					ui.agent.UserMessage(ctx, message)
				}
				continue
			}

			// Send it to the LLM
			// chatMsg := chatMessage{sender: "you", content: line}
			// ui.sendChatMessage(chatMsg)
			ui.agent.UserMessage(ctx, line)
		}
	}
}

func (ui *TermUI) updatePrompt(thinking bool) {
	var t string

	if thinking {
		// Emoji don't seem to work here? Messes up my terminal.
		t = "*"
	}
	p := fmt.Sprintf("%s ($%0.2f/%0.2f)%s> ",
		ui.httpURL, ui.agent.TotalUsage().TotalCostUSD, ui.agent.OriginalBudget().MaxDollars, t)
	ui.trm.SetPrompt(p)
}

func (ui *TermUI) initializeTerminalUI(ctx context.Context) error {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	if !term.IsTerminal(int(ui.stdin.Fd())) {
		return fmt.Errorf("this command requires terminal I/O when termui=true")
	}

	oldState, err := term.MakeRaw(int(ui.stdin.Fd()))
	if err != nil {
		return err
	}
	ui.oldState = oldState
	ui.trm = term.NewTerminal(ui.stdin, "")
	width, height, err := term.GetSize(int(ui.stdin.Fd()))
	if err != nil {
		return fmt.Errorf("Error getting terminal size: %v\n", err)
	}
	ui.trm.SetSize(width, height)
	// Handle terminal resizes...
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGWINCH)
	go func() {
		for {
			<-sig
			newWidth, newHeight, err := term.GetSize(int(ui.stdin.Fd()))
			if err != nil {
				continue
			}
			if newWidth != width || newHeight != height {
				width, height = newWidth, newHeight
				ui.trm.SetSize(width, height)
			}
		}
	}()

	ui.updatePrompt(false)

	// This is the only place where we should call fe.trm.Write:
	go func() {
		var lastMsg *chatMessage
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-ui.chatMsgCh:
				func() {
					defer ui.messageWaitGroup.Done()
					// Update prompt before writing, because otherwise it doesn't redraw the prompt.
					ui.updatePrompt(msg.thinking)
					lastMsg = &msg
					// Sometimes claude doesn't say anything when it runs tools.
					// No need to output anything in that case.
					if strings.TrimSpace(msg.content) == "" {
						return
					}
					s := fmt.Sprintf("%s %s\n", msg.sender, msg.content)
					ui.trm.Write([]byte(s))
				}()
			case logLine := <-ui.termLogCh:
				func() {
					defer ui.messageWaitGroup.Done()
					if lastMsg != nil {
						ui.updatePrompt(lastMsg.thinking)
					} else {
						ui.updatePrompt(false)
					}
					b := []byte(logLine + "\n")
					ui.trm.Write(b)
				}()
			}
		}
	}()

	return nil
}

func (ui *TermUI) RestoreOldState() error {
	ui.mu.Lock()
	defer ui.mu.Unlock()
	return term.Restore(int(ui.stdin.Fd()), ui.oldState)
}

// AppendChatMessage is for showing responses the user's request, conversational dialog etc
func (ui *TermUI) AppendChatMessage(msg chatMessage) {
	ui.messageWaitGroup.Add(1)
	ui.chatMsgCh <- msg
}

// AppendSystemMessage is for debug information, errors and such that are not part of the "conversation" per se,
// but still need to be shown to the user.
func (ui *TermUI) AppendSystemMessage(fmtString string, args ...any) {
	ui.messageWaitGroup.Add(1)
	ui.termLogCh <- fmt.Sprintf(fmtString, args...)
}

// handleCompactCommand handles the /compact command by calling the conversation's Compact method
func (ui *TermUI) handleCompactCommand() {
	// We need to access the conversation's Compact method. Since the agent interface doesn't expose
	// the underlying conversation directly, we need to add a method to the CodingAgent interface.
	// For now, we'll use a type assertion to access the conversation.
	type ConversationCompactor interface {
		CompactConversation() int
	}

	if compactor, ok := ui.agent.(ConversationCompactor); ok {
		bytesCompacted := compactor.CompactConversation()
		if bytesCompacted > 0 {
			ui.AppendSystemMessage("🗜️ Compacted %d bytes from conversation history. Large tool responses and images have been replaced with placeholders.", bytesCompacted)
		} else {
			ui.AppendSystemMessage("🗜️ No content was compacted - conversation is already optimized.")
		}
	} else {
		ui.AppendSystemMessage("❌ Compact feature not available for this agent type.")
	}
}

// getShortSHA returns the short SHA for the given git reference, falling back to the original SHA on error.
func getShortSHA(sha string) string {
	cmd := exec.Command("git", "rev-parse", "--short", sha)
	shortSha, err := cmd.Output()
	if err == nil {
		shortStr := strings.TrimSpace(string(shortSha))
		if shortStr != "" {
			return shortStr
		}
	}
	return sha
}
