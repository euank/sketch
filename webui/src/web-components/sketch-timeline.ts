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

  // Keep track of current scroll container for cleanup
  private currentScrollContainer: HTMLElement | null = null;

  // Event-driven scroll handling without setTimeout
  private scrollDebounceFrame: number | null = null;

  // Loading operation management with proper cancellation
  private loadingAbortController: AbortController | null = null;
  private pendingScrollRestoration: (() => void) | null = null;

  // Track current loading operation for cancellation
  private currentLoadingOperation: Promise<void> | null = null;

  // Observers for event-driven DOM updates
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  @property({ attribute: false })
  firstMessageIndex: number = 0;

  @property({ attribute: false })
  state: State | null = null;

  // Track initial load completion for better rendering control
  @state()
  private isInitialLoadComplete: boolean = false;

  @property({ attribute: false })
  dataManager: any = null; // Reference to DataManager for event listening

  // Viewport rendering properties
  @property({ attribute: false })
  initialMessageCount: number = 30;

  @property({ attribute: false })
  loadChunkSize: number = 20;

  @state()
  private visibleMessageStartIndex: number = 0;

  @state()
  private isLoadingOlderMessages: boolean = false;

  // Threshold for triggering load more (pixels from top)
  private loadMoreThreshold: number = 100;

  // Timeout ID for loading operations
  private loadingTimeoutId: number | null = null;

  static styles = css`
    /* Hide message content initially to prevent flash of incomplete content */
    .timeline-container:not(.view-initialized) sketch-timeline-message {
      opacity: 0;
      transition: opacity 0.2s ease-in;
    }

    /* Show content once initial load is complete */
    .timeline-container.view-initialized sketch-timeline-message {
      opacity: 1;
    }

    /* Always show loading indicators */
    .timeline-container .loading-indicator {
      opacity: 1;
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
      min-height: 100px; /* Ensure container has height for loading indicator */
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
      height: 100%;
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

    /* Loading indicator styles */
    .loading-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #666;
      font-size: 14px;
      gap: 10px;
    }

    .loading-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #e0e0e0;
      border-top: 2px solid #666;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }

    /* Print styles for full timeline printing */
    @media print {
      .timeline-container {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        page-break-inside: avoid;
      }

      .timeline {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
      }

      #scroll-container {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        overflow-y: visible !important;
        overflow-x: visible !important;
      }

      /* Hide the jump to latest button during printing */
      #jump-to-latest {
        display: none !important;
      }

      /* Hide the thinking indicator during printing */
      .thinking-indicator {
        display: none !important;
      }

      /* Hide the loading indicator during printing */
      .loading-indicator {
        display: none !important;
      }

      /* Ensure welcome box prints properly if visible */
      .welcome-box {
        page-break-inside: avoid;
      }
    }
  `;
  constructor() {
    super();

    // Binding methods
    this._handleShowCommitDiff = this._handleShowCommitDiff.bind(this);
    this._handleScroll = this._handleScroll.bind(this);
  }

  /**
   * Safely add scroll event listener with proper cleanup tracking
   */
  private addScrollListener(container: HTMLElement): void {
    // Remove any existing listener first
    this.removeScrollListener();

    // Add new listener and track the container
    container.addEventListener("scroll", this._handleScroll);
    this.currentScrollContainer = container;
  }

  /**
   * Safely remove scroll event listener
   */
  private removeScrollListener(): void {
    if (this.currentScrollContainer) {
      this.currentScrollContainer.removeEventListener(
        "scroll",
        this._handleScroll,
      );
      this.currentScrollContainer = null;
    }

    // Clear any pending timeouts and operations
    this.clearAllPendingOperations();
  }

  /**
   * Clear all pending operations and observers to prevent race conditions
   */
  private clearAllPendingOperations(): void {
    // Clear scroll debounce frame
    if (this.scrollDebounceFrame) {
      cancelAnimationFrame(this.scrollDebounceFrame);
      this.scrollDebounceFrame = null;
    }

    // Abort loading operations
    if (this.loadingAbortController) {
      this.loadingAbortController.abort();
      this.loadingAbortController = null;
    }

    // Cancel pending scroll restoration
    if (this.pendingScrollRestoration) {
      this.pendingScrollRestoration = null;
    }

    // Clean up observers
    this.disconnectObservers();
  }

  /**
   * Disconnect all observers
   */
  private disconnectObservers(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }

  /**
   * Force a viewport reset to show the most recent messages
   * Useful when loading a new session or when messages change significantly
   */
  public resetViewport(): void {
    // Cancel any pending loading operations to prevent race conditions
    this.cancelCurrentLoadingOperation();

    // Reset viewport state
    this.visibleMessageStartIndex = 0;
    this.isLoadingOlderMessages = false;

    // Clear all pending operations
    this.clearAllPendingOperations();

    this.requestUpdate();
  }

  /**
   * Cancel current loading operation if in progress
   */
  private cancelCurrentLoadingOperation(): void {
    if (this.isLoadingOlderMessages) {
      this.isLoadingOlderMessages = false;

      // Abort the loading operation
      if (this.loadingAbortController) {
        this.loadingAbortController.abort();
        this.loadingAbortController = null;
      }

      // Cancel pending scroll restoration
      this.pendingScrollRestoration = null;
    }
  }

  /**
   * Get the filtered messages (excluding hidden ones)
   */
  private get filteredMessages(): AgentMessage[] {
    return this.messages.filter((msg) => !msg.hide_output);
  }

  /**
   * Get the currently visible messages based on viewport rendering
   * Race-condition safe implementation
   */
  private get visibleMessages(): AgentMessage[] {
    const filtered = this.filteredMessages;
    if (filtered.length === 0) return [];

    // Always show the most recent messages first
    // visibleMessageStartIndex represents how many additional older messages to show
    const totalVisible =
      this.initialMessageCount + this.visibleMessageStartIndex;
    const startIndex = Math.max(0, filtered.length - totalVisible);

    // Ensure we don't return an invalid slice during loading operations
    const endIndex = filtered.length;
    if (startIndex >= endIndex) {
      return [];
    }

    return filtered.slice(startIndex, endIndex);
  }

  /**
   * Check if the component is in a stable state for loading operations
   */
  private isStableForLoading(): boolean {
    return (
      this.scrollContainer.value !== null &&
      this.scrollContainer.value === this.currentScrollContainer &&
      this.scrollContainer.value.isConnected &&
      !this.isLoadingOlderMessages &&
      !this.currentLoadingOperation
    );
  }

  /**
   * Load more older messages by expanding the visible window
   * Race-condition safe implementation
   */
  private async loadOlderMessages(): Promise<void> {
    // Prevent concurrent loading operations
    if (this.isLoadingOlderMessages || this.currentLoadingOperation) {
      return;
    }

    const filtered = this.filteredMessages;
    const currentVisibleCount = this.visibleMessages.length;
    const totalAvailable = filtered.length;

    // Check if there are more messages to load
    if (currentVisibleCount >= totalAvailable) {
      return;
    }

    // Start loading operation with proper state management
    this.isLoadingOlderMessages = true;

    // Store current scroll position for restoration
    const container = this.scrollContainer.value;
    const previousScrollHeight = container?.scrollHeight || 0;
    const previousScrollTop = container?.scrollTop || 0;

    // Validate scroll container hasn't changed during setup
    if (!container || container !== this.currentScrollContainer) {
      this.isLoadingOlderMessages = false;
      return;
    }

    // Expand the visible window with bounds checking
    const additionalMessages = Math.min(
      this.loadChunkSize,
      totalAvailable - currentVisibleCount,
    );
    const newStartIndex = this.visibleMessageStartIndex + additionalMessages;

    // Ensure we don't exceed available messages
    const boundedStartIndex = Math.min(
      newStartIndex,
      totalAvailable - this.initialMessageCount,
    );
    this.visibleMessageStartIndex = Math.max(0, boundedStartIndex);

    // Create the loading operation with proper error handling and cleanup
    const loadingOperation = this.executeScrollPositionRestoration(
      container,
      previousScrollHeight,
      previousScrollTop,
    );

    this.currentLoadingOperation = loadingOperation;

    try {
      await loadingOperation;
    } catch (error) {
      console.warn("Loading operation failed:", error);
    } finally {
      // Ensure loading state is always cleared
      this.isLoadingOlderMessages = false;
      this.currentLoadingOperation = null;

      // Clear the loading timeout if it exists
      if (this.loadingTimeoutId) {
        clearTimeout(this.loadingTimeoutId);
        this.loadingTimeoutId = null;
      }
    }
  }

  /**
   * Execute scroll position restoration with event-driven approach
   */
  private async executeScrollPositionRestoration(
    container: HTMLElement,
    previousScrollHeight: number,
    previousScrollTop: number,
  ): Promise<void> {
    // Set up AbortController for proper cancellation
    this.loadingAbortController = new AbortController();
    const { signal } = this.loadingAbortController;

    // Create scroll restoration function
    const restoreScrollPosition = () => {
      // Check if operation was aborted
      if (signal.aborted) {
        return;
      }

      // Double-check container is still valid and connected
      if (
        !container ||
        !container.isConnected ||
        container !== this.currentScrollContainer
      ) {
        return;
      }

      try {
        const newScrollHeight = container.scrollHeight;
        const scrollDifference = newScrollHeight - previousScrollHeight;
        const newScrollTop = previousScrollTop + scrollDifference;

        // Validate all scroll calculations before applying
        const isValidRestoration =
          scrollDifference > 0 && // Content was added
          newScrollTop >= 0 && // New position is valid
          newScrollTop <= newScrollHeight && // Don't exceed max scroll
          previousScrollHeight > 0 && // Had valid previous height
          newScrollHeight > previousScrollHeight; // Height actually increased

        if (isValidRestoration) {
          container.scrollTop = newScrollTop;
        } else {
          // Log invalid restoration attempts for debugging
          console.debug("Skipped scroll restoration:", {
            scrollDifference,
            newScrollTop,
            newScrollHeight,
            previousScrollHeight,
            previousScrollTop,
          });
        }
      } catch (error) {
        console.warn("Scroll position restoration failed:", error);
      }
    };

    // Store the restoration function for potential cancellation
    this.pendingScrollRestoration = restoreScrollPosition;

    // Wait for DOM update and then restore scroll position
    await this.updateComplete;

    // Check if operation was cancelled during await
    if (
      !signal.aborted &&
      this.pendingScrollRestoration === restoreScrollPosition
    ) {
      // Use ResizeObserver to detect when content is actually ready
      await this.waitForContentReady(container, signal);

      if (!signal.aborted) {
        restoreScrollPosition();
        this.pendingScrollRestoration = null;
      }
    }
  }

  /**
   * Wait for content to be ready using ResizeObserver instead of setTimeout
   */
  private async waitForContentReady(
    container: HTMLElement,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Operation aborted"));
        return;
      }

      // Resolve immediately if container already has content
      if (container.scrollHeight > 0) {
        resolve();
        return;
      }

      // Set up ResizeObserver to detect content changes
      const observer = new ResizeObserver((entries) => {
        if (signal.aborted) {
          observer.disconnect();
          reject(new Error("Operation aborted"));
          return;
        }

        // Content is ready when height increases
        const entry = entries[0];
        if (entry && entry.contentRect.height > 0) {
          observer.disconnect();
          resolve();
        }
      });

      // Start observing
      observer.observe(container);

      // Clean up on abort
      signal.addEventListener("abort", () => {
        observer.disconnect();
        reject(new Error("Operation aborted"));
      });
    });
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
   * Scroll to bottom with event-driven approach using MutationObserver
   */
  private async scrollToBottomWithRetry(): Promise<void> {
    if (!this.scrollContainer.value) return;

    const container = this.scrollContainer.value;

    // Try immediate scroll first
    this.scrollToBottom();

    // Check if we're at the bottom
    const isAtBottom = () => {
      const targetScrollTop = container.scrollHeight - container.clientHeight;
      const actualScrollTop = container.scrollTop;
      return Math.abs(targetScrollTop - actualScrollTop) <= 1;
    };

    // If already at bottom, we're done
    if (isAtBottom()) {
      return;
    }

    // Use MutationObserver to detect content changes and retry
    return new Promise((resolve) => {
      let scrollAttempted = false;

      const observer = new MutationObserver(() => {
        if (!scrollAttempted) {
          scrollAttempted = true;

          // Use requestAnimationFrame to ensure DOM is painted
          requestAnimationFrame(() => {
            this.scrollToBottom();

            // Check if successful
            if (isAtBottom()) {
              observer.disconnect();
              resolve();
            } else {
              // Try one more time after another frame
              requestAnimationFrame(() => {
                this.scrollToBottom();
                observer.disconnect();
                resolve();
              });
            }
          });
        }
      });

      // Observe changes to the timeline container
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: false,
      });

      // Clean up after a reasonable time if no changes detected
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollAttempted) {
            observer.disconnect();
            resolve();
          }
        });
      });
    });
  }

  /**
   * Called after the component's properties have been updated
   */
  updated(changedProperties: PropertyValues): void {
    // Handle DataManager changes to set up event listeners
    if (changedProperties.has("dataManager")) {
      const oldDataManager = changedProperties.get("dataManager");

      // Remove old event listener if it exists
      if (oldDataManager) {
        oldDataManager.removeEventListener(
          "initialLoadComplete",
          this.handleInitialLoadComplete,
        );
      }

      // Add new event listener if dataManager is available
      if (this.dataManager) {
        this.dataManager.addEventListener(
          "initialLoadComplete",
          this.handleInitialLoadComplete,
        );

        // Check if initial load is already complete
        if (
          this.dataManager.getIsInitialLoadComplete &&
          this.dataManager.getIsInitialLoadComplete()
        ) {
          this.isInitialLoadComplete = true;
        }
      }
    }

    // Handle scroll container changes first to prevent race conditions
    if (changedProperties.has("scrollContainer")) {
      // Cancel any ongoing loading operations since container is changing
      this.cancelCurrentLoadingOperation();

      if (this.scrollContainer.value) {
        this.addScrollListener(this.scrollContainer.value);
      } else {
        this.removeScrollListener();
      }
    }

    // If messages have changed, handle viewport updates
    if (changedProperties.has("messages")) {
      const oldMessages =
        (changedProperties.get("messages") as AgentMessage[]) || [];
      const newMessages = this.messages || [];

      // Cancel loading operations if messages changed significantly
      const significantChange =
        oldMessages.length === 0 ||
        newMessages.length < oldMessages.length ||
        Math.abs(newMessages.length - oldMessages.length) > 20;

      if (significantChange) {
        // Cancel any ongoing operations and reset viewport
        this.cancelCurrentLoadingOperation();
        this.visibleMessageStartIndex = 0;
      }

      // Scroll to bottom if needed (only if not loading to prevent race conditions)
      if (
        this.messages.length > 0 &&
        this.scrollingState === "pinToLatest" &&
        !this.isLoadingOlderMessages
      ) {
        // Use async scroll without setTimeout
        this.scrollToBottomWithRetry().catch((error) => {
          console.warn("Scroll to bottom failed:", error);
        });
      }
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

  private _handleScroll(event) {
    if (!this.scrollContainer.value) return;

    const container = this.scrollContainer.value;

    // Verify this is still our tracked container to prevent race conditions
    if (container !== this.currentScrollContainer) {
      return;
    }

    const isAtBottom =
      Math.abs(
        container.scrollHeight - container.clientHeight - container.scrollTop,
      ) <= 3; // Increased tolerance to 3px for better detection

    const isNearTop = container.scrollTop <= this.loadMoreThreshold;

    // Update scroll state immediately for responsive UI
    if (isAtBottom) {
      this.scrollingState = "pinToLatest";
    } else {
      this.scrollingState = "floating";
    }

    // Use requestAnimationFrame for smooth debouncing instead of setTimeout
    if (this.scrollDebounceFrame) {
      cancelAnimationFrame(this.scrollDebounceFrame);
    }

    this.scrollDebounceFrame = requestAnimationFrame(() => {
      // Use stability check to ensure safe loading conditions
      if (isNearTop && this.isStableForLoading()) {
        this.loadOlderMessages().catch((error) => {
          console.warn("Async loadOlderMessages failed:", error);
        });
      }
      this.scrollDebounceFrame = null;
    });
  }

  // See https://lit.dev/docs/components/lifecycle/
  connectedCallback() {
    super.connectedCallback();

    // Listen for showCommitDiff events from the renderer
    document.addEventListener(
      "showCommitDiff",
      this._handleShowCommitDiff as EventListener,
    );

    // Set up scroll listener if container is available
    if (this.scrollContainer.value) {
      this.addScrollListener(this.scrollContainer.value);
    }

    // Initialize observers for event-driven behavior
    this.setupObservers();
  }

  /**
   * Handle initial load completion from DataManager
   */
  private handleInitialLoadComplete = (eventData: {
    messageCount: number;
    expectedCount: number;
  }): void => {
    console.log(
      `Timeline: Initial load complete - ${eventData.messageCount}/${eventData.expectedCount} messages`,
    );
    this.isInitialLoadComplete = true;
    this.requestUpdate();
  };

  /**
   * Set up observers for event-driven DOM monitoring
   */
  private setupObservers(): void {
    // ResizeObserver will be created on-demand in loading operations
    // MutationObserver will be created on-demand in scroll operations
    // This avoids creating observers that may not be needed
  }

  // See https://lit.dev/docs/component/lifecycle/
  disconnectedCallback() {
    super.disconnectedCallback();

    // Cancel any ongoing loading operations before cleanup
    this.cancelCurrentLoadingOperation();

    // Remove event listeners with guaranteed cleanup
    document.removeEventListener(
      "showCommitDiff",
      this._handleShowCommitDiff as EventListener,
    );

    // Remove DataManager event listener if connected
    if (this.dataManager) {
      this.dataManager.removeEventListener(
        "initialLoadComplete",
        this.handleInitialLoadComplete,
      );
    }

    // Use our safe cleanup method
    this.removeScrollListener();
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

    // Apply view-initialized class when initial load is complete
    const containerClass = this.isInitialLoadComplete
      ? "timeline-container view-initialized"
      : "timeline-container";

    return html`
      <div style="position: relative; height: 100%;">
        <div id="scroll-container">
          <div class="${containerClass}">
            ${!this.isInitialLoadComplete
              ? html`
                  <div class="loading-indicator">
                    <div class="loading-spinner"></div>
                    <span>Loading conversation...</span>
                  </div>
                `
              : ""}
            ${this.isLoadingOlderMessages
              ? html`
                  <div class="loading-indicator">
                    <div class="loading-spinner"></div>
                    <span>Loading older messages...</span>
                  </div>
                `
              : ""}
            ${this.isInitialLoadComplete
              ? repeat(
                  this.visibleMessages,
                  this.messageKey,
                  (message, index) => {
                    // Find the previous message in the full filtered messages array
                    const filteredMessages = this.filteredMessages;
                    const messageIndex = filteredMessages.findIndex(
                      (m) => m === message,
                    );
                    let previousMessage =
                      messageIndex > 0
                        ? filteredMessages[messageIndex - 1]
                        : undefined;

                    return html`<sketch-timeline-message
                      .message=${message}
                      .previousMessage=${previousMessage}
                      .open=${false}
                      .firstMessageIndex=${this.firstMessageIndex}
                      .state=${this.state}
                    ></sketch-timeline-message>`;
                  },
                )
              : ""}
            ${isThinking && this.isInitialLoadComplete
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
