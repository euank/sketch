import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { AgentMessage } from "../types";
import { createRef, ref } from "lit/directives/ref.js";
import { marked, MarkedOptions, Renderer } from "marked";
import DOMPurify from "dompurify";

@customElement("mobile-chat")
export class MobileChat extends LitElement {
  @property({ type: Array })
  messages: AgentMessage[] = [];

  @property({ type: Boolean })
  isThinking = false;

  private scrollContainer = createRef<HTMLDivElement>();

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: hidden;
    }

    .chat-container {
      height: 100%;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
    }

    .message {
      display: flex;
      flex-direction: column;
      max-width: 85%;
      word-wrap: break-word;
    }

    .message.user {
      align-self: flex-end;
      align-items: flex-end;
    }

    .message.assistant {
      align-self: flex-start;
      align-items: flex-start;
    }

    .message-bubble {
      padding: 8px 12px;
      border-radius: 18px;
      font-size: 16px;
      line-height: 1.4;
    }

    .message.user .message-bubble {
      background-color: #007bff;
      color: white;
      border-bottom-right-radius: 6px;
    }

    .message.assistant .message-bubble {
      background-color: #f1f3f4;
      color: #333;
      border-bottom-left-radius: 6px;
    }

    .message.error .message-bubble {
      background-color: #ffebee;
      color: #d32f2f;
      border-radius: 18px;
    }

    .thinking-message {
      align-self: flex-start;
      align-items: flex-start;
      max-width: 85%;
    }

    .thinking-bubble {
      background-color: #f1f3f4;
      padding: 16px;
      border-radius: 18px;
      border-bottom-left-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .thinking-text {
      color: #6c757d;
      font-style: italic;
    }

    .thinking-dots {
      display: flex;
      gap: 3px;
    }

    .thinking-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #6c757d;
      animation: thinking 1.4s ease-in-out infinite both;
    }

    .thinking-dot:nth-child(1) {
      animation-delay: -0.32s;
    }
    .thinking-dot:nth-child(2) {
      animation-delay: -0.16s;
    }
    .thinking-dot:nth-child(3) {
      animation-delay: 0;
    }

    @keyframes thinking {
      0%,
      80%,
      100% {
        transform: scale(0.8);
        opacity: 0.5;
      }
      40% {
        transform: scale(1);
        opacity: 1;
      }
    }

    .empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6c757d;
      font-style: italic;
      text-align: center;
      padding: 32px;
    }

    /* Markdown content styling for mobile */
    .markdown-content {
      line-height: 1.5;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .markdown-content p {
      margin: 0.3em 0;
    }

    .markdown-content p:first-child {
      margin-top: 0;
    }

    .markdown-content p:last-child {
      margin-bottom: 0;
    }

    .markdown-content h1,
    .markdown-content h2,
    .markdown-content h3,
    .markdown-content h4,
    .markdown-content h5,
    .markdown-content h6 {
      margin: 0.5em 0 0.3em 0;
      font-weight: bold;
    }

    .markdown-content h1 {
      font-size: 1.2em;
    }
    .markdown-content h2 {
      font-size: 1.15em;
    }
    .markdown-content h3 {
      font-size: 1.1em;
    }
    .markdown-content h4,
    .markdown-content h5,
    .markdown-content h6 {
      font-size: 1.05em;
    }

    .markdown-content code {
      background-color: rgba(0, 0, 0, 0.08);
      padding: 2px 4px;
      border-radius: 3px;
      font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
      font-size: 0.9em;
    }

    .markdown-content pre {
      background-color: rgba(0, 0, 0, 0.08);
      padding: 8px;
      border-radius: 6px;
      margin: 0.5em 0;
      overflow-x: auto;
      font-size: 0.9em;
    }

    .markdown-content pre code {
      background: none;
      padding: 0;
    }

    .markdown-content ul,
    .markdown-content ol {
      margin: 0.5em 0;
      padding-left: 1.2em;
    }

    .markdown-content li {
      margin: 0.2em 0;
    }

    .markdown-content blockquote {
      border-left: 3px solid rgba(0, 0, 0, 0.2);
      margin: 0.5em 0;
      padding-left: 0.8em;
      font-style: italic;
    }

    .markdown-content a {
      color: inherit;
      text-decoration: underline;
    }

    .markdown-content strong,
    .markdown-content b {
      font-weight: bold;
    }

    .markdown-content em,
    .markdown-content i {
      font-style: italic;
    }

    /* Tool calls styling for mobile */
    .tool-calls {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .tool-call-item {
      background-color: rgba(0, 0, 0, 0.04);
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 12px;
      font-family: monospace;
      line-height: 1.3;
      border-left: 2px solid #666;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tool-call-item.bash {
      border-left-color: #28a745;
    }

    .tool-call-item.patch {
      border-left-color: #fd7e14;
    }

    .tool-call-item.think {
      border-left-color: #6f42c1;
    }

    .tool-call-item.keyword_search {
      border-left-color: #17a2b8;
    }

    .tool-call-item.browser_navigate {
      border-left-color: #007bff;
    }

    .tool-call-item.browser_take_screenshot {
      border-left-color: #e83e8c;
    }

    .tool-status-icon {
      flex-shrink: 0;
      font-size: 14px;
    }

    .tool-name {
      font-weight: bold;
      color: #333;
      flex-shrink: 0;
      margin-right: 2px;
    }

    .tool-summary {
      color: #555;
      flex-grow: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tool-duration {
      font-size: 10px;
      color: #888;
      flex-shrink: 0;
      margin-left: 4px;
    }
  `;

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    if (
      changedProperties.has("messages") ||
      changedProperties.has("isThinking")
    ) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom() {
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      if (this.scrollContainer.value) {
        this.scrollContainer.value.scrollTop =
          this.scrollContainer.value.scrollHeight;
      }
    });
  }

  private formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  private getMessageRole(message: AgentMessage): string {
    if (message.type === "user") {
      return "user";
    }
    if (message.type === "error") {
      return "error";
    }
    return "assistant";
  }

  private getMessageText(message: AgentMessage): string {
    return message.content || "";
  }

  private shouldShowMessage(message: AgentMessage): boolean {
    // Filter out hidden messages (subconversations) like the regular UI does
    if (message.hide_output) {
      return false;
    }

    // Show user, agent, and error messages with content
    return (
      (message.type === "user" ||
        message.type === "agent" ||
        message.type === "error") &&
      message.content &&
      message.content.trim().length > 0
    );
  }

  private renderMarkdown(markdownContent: string): string {
    try {
      // Create a custom renderer for mobile-optimized rendering
      const renderer = new Renderer();

      // Override code renderer to simplify for mobile
      renderer.code = function ({
        text,
        lang,
      }: {
        text: string;
        lang?: string;
      }): string {
        const langClass = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${langClass}>${text}</code></pre>`;
      };

      // Set markdown options for mobile
      const markedOptions: MarkedOptions = {
        gfm: true, // GitHub Flavored Markdown
        breaks: true, // Convert newlines to <br>
        async: false,
        renderer: renderer,
      };

      // Parse markdown and sanitize the output HTML
      const htmlOutput = marked.parse(markdownContent, markedOptions) as string;
      return DOMPurify.sanitize(htmlOutput, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "strong",
          "em",
          "b",
          "i",
          "u",
          "s",
          "code",
          "pre",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ul",
          "ol",
          "li",
          "blockquote",
          "a",
        ],
        ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
        KEEP_CONTENT: true,
      });
    } catch (error) {
      console.error("Error rendering markdown:", error);
      // Fallback to sanitized plain text if markdown parsing fails
      return DOMPurify.sanitize(markdownContent);
    }
  }

  private renderToolCalls(message: AgentMessage) {
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return "";
    }

    return html`
      <div class="tool-calls">
        ${message.tool_calls.map((toolCall) => {
          const statusIcon = this.getToolStatusIcon(toolCall);
          const summary = this.getToolSummary(toolCall);
          const duration = this.getToolDuration(toolCall);

          return html`
            <div class="tool-call-item ${toolCall.name}">
              <span class="tool-name">${toolCall.name}</span>
              <span class="tool-summary">${summary}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private getToolStatusIcon(toolCall: any): string {
    // Don't show status icons for mobile
    return "";
  }

  private getToolSummary(toolCall: any): string {
    try {
      const input = JSON.parse(toolCall.input || "{}");
      
      switch (toolCall.name) {
        case "bash":
          const command = input.command || "";
          const isBackground = input.background === true;
          const bgPrefix = isBackground ? "[bg] " : "";
          return bgPrefix + (command.length > 40 ? command.substring(0, 40) + "..." : command);
        
        case "patch":
          const path = input.path || "unknown";
          const patchCount = (input.patches || []).length;
          return `${path}: ${patchCount} edit${patchCount > 1 ? "s" : ""}`;
        
        case "think":
          const thoughts = input.thoughts || "";
          const firstLine = thoughts.split("\n")[0] || "";
          return firstLine.length > 50 ? firstLine.substring(0, 50) + "..." : firstLine;
        
        case "keyword_search":
          const query = input.query || "";
          return query.length > 50 ? query.substring(0, 50) + "..." : query;
        
        case "browser_navigate":
          return input.url || "";
        
        case "browser_take_screenshot":
          return "Taking screenshot";
        
        case "browser_click":
          return `Click: ${input.selector || ""}`;
        
        case "browser_type":
          const text = input.text || "";
          return `Type: ${text.length > 30 ? text.substring(0, 30) + "..." : text}`;
        
        case "todo_write":
          const tasks = input.tasks || [];
          return `${tasks.length} task${tasks.length > 1 ? "s" : ""}`;
        
        case "todo_read":
          return "Read todo list";
        
        case "set-slug":
          return `Slug: "${input.slug || ""}"`;
        
        case "multiplechoice":
          return input.question || "Multiple choice question";
        
        case "done":
          return "Task completion checklist";
        
        default:
          // For unknown tools, show first part of input
          const inputStr = JSON.stringify(input);
          return inputStr.length > 50 ? inputStr.substring(0, 50) + "..." : inputStr;
      }
    } catch (e) {
      return "Tool call";
    }
  }

  private getToolDuration(toolCall: any): string {
    // Don't show duration for mobile
    return "";
  }

  render() {
    const displayMessages = this.messages.filter((msg) =>
      this.shouldShowMessage(msg),
    );

    return html`
      <div class="chat-container" ${ref(this.scrollContainer)}>
        ${displayMessages.length === 0
          ? html`
              <div class="empty-state">Start a conversation with Sketch...</div>
            `
          : displayMessages.map((message) => {
              const role = this.getMessageRole(message);
              const text = this.getMessageText(message);
              const timestamp = message.timestamp;

              return html`
                <div class="message ${role}">
                  <div class="message-bubble">
                    ${role === "assistant"
                      ? html`<div class="markdown-content">
                          ${unsafeHTML(this.renderMarkdown(text))}
                        </div>`
                      : text}
                    ${this.renderToolCalls(message)}
                  </div>
                </div>
              `;
            })}
        ${this.isThinking
          ? html`
              <div class="thinking-message">
                <div class="thinking-bubble">
                  <span class="thinking-text">Sketch is thinking</span>
                  <div class="thinking-dots">
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                  </div>
                </div>
              </div>
            `
          : ""}
      </div>
    `;
  }
}
