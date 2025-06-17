import { css, html, LitElement } from "lit";
import { PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import { AgentMessage, State } from "../types";
import "./sketch-timeline-message";
import { Ref } from "lit/directives/ref";

@customElement("sketch-timeline")
export class SketchTimeline extends LitElement {
  @property({ attribute: false })
  messages: AgentMessage[] = [];

  // Active state properties to show thinking indicator
  @property({ attribute: false })
  agentState: string | null = null;

  @property({ attribute: false })
  llmCalls: number = 0;

  @property({ attribute: false })
  toolCalls: string[] = [];

  // Track if we should scroll to the bottom
  @state()
  private scrollingState: "pinToLatest" | "floating" = "pinToLatest";

  @property({ attribute: false })
  scrollContainer: Ref<HTMLElement>;

  @property({ attribute: false })
  firstMessageIndex: number = 0;

  @property({ attribute: false })
  state: State | null = null;

  // Incremental loading properties
  @property({ attribute: false })
  hasMoreOlderMessages: boolean = false;

  @property({ attribute: false })
  isLoadingOlderMessages: boolean = false;

  @property({ attribute: false })
  onLoadOlderMessages?: () => Promise<boolean>;

  // Scroll detection state
  @state()
  private isNearTop: boolean = false;

  static styles = css`
    /* Hide views initially to prevent flash of content */
    .timeline-container .timeline,
    .timeline-container .diff-view,
    .timeline-container .chart-view,
    .timeline-container .terminal-view {
      visibility: hidden;
    }

    /* Will be set by JavaScript once we know which view to display */
    .timeline-container.view-initialized .timeline,
    .timeline-container.view-initialized .diff-view,
    .timeline-container.view-initialized .chart-view,
    .timeline-container.view-initialized .terminal-view {
      visibility: visible;
    }

    .timeline-container {
      width: 100%;
      position: relative;
      max-width: 100%;
      margin: 0 auto;
      padding: 0 15px;
      box-sizing: border-box;
      overflow-x: hidden;
      flex: 1;
    }

    /* Chat-like timeline styles */
    .timeline {
      position: relative;
      margin: 10px 0;
      scroll-behavior: smooth;
    }

    /* Remove the vertical timeline line */

    #scroll-container {
      overflow-y: auto;
      overflow-x: hidden;
      padding-left: 1em;
      max-width: 100%;
      width: 100%;
    }
    #jump-to-latest {
      display: none;
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: rgb(33, 150, 243);
      color: white;
      border-radius: 8px;
      padding: 0.5em;
      margin: 0.5em;
      font-size: x-large;
      opacity: 0.5;
      cursor: pointer;
      z-index: 50;
    }
    #jump-to-latest:hover {
      opacity: 1;
    }
    #jump-to-latest.floating {
      display: block;
    }

    /* Welcome box styles for the empty chat state */
    .welcome-box {
      margin: 2rem auto;
      max-width: 90%;
      width: 90%;
      padding: 2rem;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
      background-color: #ffffff;
      text-align: center;
    }

    .welcome-box-title {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      text-align: center;
      color: #333;
    }

    .welcome-box-content {
      color: #666; /* Slightly grey font color */
      line-height: 1.6;
      font-size: 1rem;
      text-align: left;
    }

    /* Thinking indicator styles */
    .thinking-indicator {
      padding-left: 85px;
      margin-top: 5px;
      margin-bottom: 15px;
      display: flex;
    }

    .thinking-bubble {
      background-color: #f1f1f1;
      border-radius: 15px;
      padding: 10px 15px;
      max-width: 80px;
      color: black;
      position: relative;
      border-bottom-left-radius: 5px;
    }

    .thinking-dots {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 14px;
    }

    .dot {
      width: 6px;
      height: 6px;
      background-color: #888;
      border-radius: 50%;
      opacity: 0.6;
    }

    .dot:nth-child(1) {
      animation: pulse 1.5s infinite ease-in-out;
    }

    .dot:nth-child(2) {
      animation: pulse 1.5s infinite ease-in-out 0.3s;
    }

    .dot:nth-child(3) {
      animation: pulse 1.5s infinite ease-in-out 0.6s;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 0.4;
        transform: scale(1);
      }
      50% {
        opacity: 1;
        transform: scale(1.2);
      }
    }

    /* Load more container and button styles */
    .load-more-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      margin-bottom: 10px;
    }

    .load-more-button {
      background-color: #f1f1f1;
      border: 1px solid #ddd;
      border-radius: 20px;
      padding: 10px 20px;
      cursor: pointer;
      font-size: 14px;
      color: #666;
      transition: all 0.2s ease;
    }

    .load-more-button:hover {
      background-color: #e9e9e9;
      border-color: #ccc;
      color: #333;
    }

    .loading-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      color: #666;
      font-size: 14px;
    }

    .loading-dots {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 14px;
    }

    .loading-dots .dot {
      width: 6px;
      height: 6px;
      background-color: #888;
      border-radius: 50%;
      opacity: 0.6;
    }

    .loading-dots .dot:nth-child(1) {
      animation: pulse 1.5s infinite ease-in-out;
    }

    .loading-dots .dot:nth-child(2) {
      animation: pulse 1.5s infinite ease-in-out 0.3s;
    }

    .loading-dots .dot:nth-child(3) {
      animation: pulse 1.5s infinite ease-in-out 0.6s;
    }
  `;

  constructor() {
    super();

    // Binding methods
    this._handleShowCommitDiff = this._handleShowCommitDiff.bind(this);
    this._handleScroll = this._handleScroll.bind(this);
  }

  /**
   * Scroll to the bottom of the timeline
   */
  private scrollToBottom(): void {
    if (!this.scrollContainer.value) return;

    // Use instant scroll to ensure we reach the exact bottom
    this.scrollContainer.value.scrollTo({
      top: this.scrollContainer.value.scrollHeight,
      behavior: "instant",
    });
  }

  /**
   * Scroll to bottom with retry logic to handle dynamic content
   */
  private scrollToBottomWithRetry(): void {
    if (!this.scrollContainer.value) return;

    let attempts = 0;
    const maxAttempts = 5;
    const retryInterval = 50;

    const tryScroll = () => {
      if (!this.scrollContainer.value) return;

      const container = this.scrollContainer.value;
      const targetScrollTop = container.scrollHeight - container.clientHeight;

      // Scroll to the calculated position
      container.scrollTo({
        top: targetScrollTop,
        behavior: "instant",
      });

      attempts++;

      // Check if we're actually at the bottom
      const actualScrollTop = container.scrollTop;
      const isAtBottom = Math.abs(targetScrollTop - actualScrollTop) <= 1;

      if (!isAtBottom && attempts < maxAttempts) {
        // Still not at bottom and we have attempts left, try again
        setTimeout(tryScroll, retryInterval);
      }
    };

    tryScroll();
  }

  /**
   * Called after the component's properties have been updated
   */
  updated(changedProperties: PropertyValues): void {
    // If messages have changed, scroll to bottom if needed
    if (changedProperties.has("messages") && this.messages.length > 0) {
      if (this.scrollingState == "pinToLatest") {
        // Use longer timeout and retry logic to handle dynamic content
        setTimeout(() => this.scrollToBottomWithRetry(), 100);
      }
    }
    if (changedProperties.has("scrollContainer")) {
      this.scrollContainer.value?.addEventListener(
        "scroll",
        this._handleScroll,
      );
    }
  }

  /**
   * Handle showCommitDiff event
   */
  private _handleShowCommitDiff(event: CustomEvent) {
    const { commitHash } = event.detail;
    if (commitHash) {
      // Bubble up the event to the app shell
      const newEvent = new CustomEvent("show-commit-diff", {
        detail: { commitHash },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(newEvent);
    }
  }

  /**
   * Handle loading older messages when scrolling near the top
   */
  private async handleLoadOlderMessages() {
    if (!this.onLoadOlderMessages || this.isLoadingOlderMessages || !this.hasMoreOlderMessages) {
      return;
    }

    try {
      const success = await this.onLoadOlderMessages();
      if (success) {
        // Scroll down a bit to maintain the user's position relative to the messages they were viewing
        setTimeout(() => {
          if (this.scrollContainer.value) {
            this.scrollContainer.value.scrollTop += 200;
          }
        }, 50);
      }
    } catch (error) {
      console.error("Error loading older messages:", error);
    }
  }

  private _handleScroll(event) {
    if (!this.scrollContainer.value) return;

    const container = this.scrollContainer.value;
    const isAtBottom =
      Math.abs(
        container.scrollHeight - container.clientHeight - container.scrollTop,
      ) <= 3; // Increased tolerance to 3px for better detection

    // Check if user is near the top for loading older messages
    const isNearTop = container.scrollTop <= 200; // Within 200px of the top
    
    if (isNearTop !== this.isNearTop) {
      this.isNearTop = isNearTop;
      
      // Trigger loading older messages when near top
      if (this.isNearTop && this.hasMoreOlderMessages && !this.isLoadingOlderMessages) {
        this.handleLoadOlderMessages();
      }
    }

    if (isAtBottom) {
      this.scrollingState = "pinToLatest";
    } else {
      // TODO: does scroll direction matter here?
      this.scrollingState = "floating";
    }
  }

  // See https://lit.dev/docs/components/lifecycle/
  connectedCallback() {
    super.connectedCallback();

    // Listen for showCommitDiff events from the renderer
    document.addEventListener(
      "showCommitDiff",
      this._handleShowCommitDiff as EventListener,
    );

    this.scrollContainer.value?.addEventListener("scroll", this._handleScroll);
  }

  // See https://lit.dev/docs/components/lifecycle/
  disconnectedCallback() {
    super.disconnectedCallback();

    // Remove event listeners
    document.removeEventListener(
      "showCommitDiff",
      this._handleShowCommitDiff as EventListener,
    );

    this.scrollContainer.value?.removeEventListener(
      "scroll",
      this._handleScroll,
    );
  }

  // messageKey uniquely identifes a AgentMessage based on its ID and tool_calls, so
  // that we only re-render <sketch-message> elements that we need to re-render.
  messageKey(message: AgentMessage): string {
    // If the message has tool calls, and any of the tool_calls get a response, we need to
    // re-render that message.
    const toolCallResponses = message.tool_calls
      ?.filter((tc) => tc.result_message)
      .map((tc) => tc.tool_call_id)
      .join("-");
    return `message-${message.idx}-${toolCallResponses}`;
  }

  render() {
    // Check if messages array is empty and render welcome box if it is
    if (this.messages.length === 0) {
      return html`
        <div style="position: relative; height: 100%;">
          <div id="scroll-container">
            <div class="welcome-box">
              <h2 class="welcome-box-title">How to use Sketch</h2>
              <p class="welcome-box-content">
                Sketch is an agentic coding assistant.
              </p>

              <p class="welcome-box-content">
                Sketch has created a container with your repo.
              </p>

              <p class="welcome-box-content">
                Ask it to implement a task or answer a question in the chat box
                below. It can edit and run your code, all in the container.
                Sketch will create commits in a newly created git branch, which
                you can look at and comment on in the Diff tab. Once you're
                done, you'll find that branch available in your (original) repo.
              </p>
              <p class="welcome-box-content">
                Because Sketch operates a container per session, you can run
                Sketch in parallel to work on multiple ideas or even the same
                idea with different approaches.
              </p>
            </div>
          </div>
        </div>
      `;
    }

    // Otherwise render the regular timeline with messages
    const isThinking =
      this.llmCalls > 0 || (this.toolCalls && this.toolCalls.length > 0);

    return html`
      <div style="position: relative; height: 100%;">
        <div id="scroll-container">
          <div class="timeline-container">
            ${this.hasMoreOlderMessages
              ? html`
                  <div class="load-more-container">
                    ${this.isLoadingOlderMessages
                      ? html`
                          <div class="loading-indicator">
                            <div class="loading-dots">
                              <div class="dot"></div>
                              <div class="dot"></div>
                              <div class="dot"></div>
                            </div>
                            <span>Loading older messages...</span>
                          </div>
                        `
                      : html`
                          <button
                            class="load-more-button"
                            @click=${this.handleLoadOlderMessages}
                          >
                            Load older messages
                          </button>
                        `}
                  </div>
                `
              : ""}
            ${repeat(
              this.messages.filter((msg) => !msg.hide_output),
              this.messageKey,
              (message, index) => {
                let previousMessageIndex =
                  this.messages.findIndex((m) => m === message) - 1;
                let previousMessage =
                  previousMessageIndex >= 0
                    ? this.messages[previousMessageIndex]
                    : undefined;

                // Skip hidden messages when determining previous message
                while (previousMessage && previousMessage.hide_output) {
                  previousMessageIndex--;
                  previousMessage =
                    previousMessageIndex >= 0
                      ? this.messages[previousMessageIndex]
                      : undefined;
                }

                return html`<sketch-timeline-message
                  .message=${message}
                  .previousMessage=${previousMessage}
                  .open=${false}
                  .firstMessageIndex=${this.firstMessageIndex}
                  .state=${this.state}
                ></sketch-timeline-message>`;
              },
            )}
            ${isThinking
              ? html`
                  <div class="thinking-indicator">
                    <div class="thinking-bubble">
                      <div class="thinking-dots">
                        <div class="dot"></div>
                        <div class="dot"></div>
                        <div class="dot"></div>
                      </div>
                    </div>
                  </div>
                `
              : ""}
          </div>
        </div>
        <div
          id="jump-to-latest"
          class="${this.scrollingState}"
          @click=${this.scrollToBottomWithRetry}
        >
          ⇩
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-timeline": SketchTimeline;
  }
}
