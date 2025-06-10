import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ConnectionStatus, DataManager } from "../data";
import { AgentMessage, GitLogEntry, State } from "../types";
import { aggregateAgentMessages } from "./aggregateAgentMessages";

import "./sketch-chat-input";
import "./sketch-container-status";

import "./sketch-diff2-view";
import { SketchDiff2View } from "./sketch-diff2-view";
import { DefaultGitDataService } from "./git-data-service";
import "./sketch-monaco-view";
import "./sketch-network-status";
import "./sketch-call-status";
import "./sketch-terminal";
import "./sketch-timeline";
import "./sketch-view-mode-select";
import "./sketch-todo-panel";

import { createRef, ref } from "lit/directives/ref.js";
import { SketchChatInput } from "./sketch-chat-input";

type ViewMode = "chat" | "diff2" | "terminal";

@customElement("sketch-app-shell")
export class SketchAppShell extends LitElement {
  // Current view mode (chat, diff, terminal)
  @state()
  viewMode: ViewMode = "chat";

  // Current commit hash for diff view
  @state()
  currentCommitHash: string = "";

  // Last commit information
  @state()

  // Reference to the container status element
  containerStatusElement: any = null;

  // See https://lit.dev/docs/components/styles/ for how lit-element handles CSS.
  // Note that these styles only apply to the scope of this web component's
  // shadow DOM node, so they won't leak out or collide with CSS declared in
  // other components or the containing web page (...unless you want it to do that).
  static styles = css`
    .copied-indicator {
      position: absolute;
      top: -20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(40, 167, 69, 0.9);
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-family: system-ui, sans-serif;
      animation: fadeInOut 2s ease;
      pointer-events: none;
    }

    @keyframes fadeInOut {
      0% {
        opacity: 0;
      }
      20% {
        opacity: 1;
      }
      80% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }

    .commit-branch-indicator {
      color: #28a745;
    }

    .commit-hash-indicator {
      color: #0366d6;
    }
    :host {
      display: block;
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        sans-serif;
      color: #333;
      line-height: 1.4;
      height: 100vh;
      width: 100%;
      position: relative;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Top banner with combined elements */
    #top-banner {
      display: flex;
      align-self: stretch;
      justify-content: space-between;
      align-items: center;
      padding: 0 20px;
      margin-bottom: 0;
      border-bottom: 1px solid #eee;
      gap: 20px;
      background: white;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      width: 100%;
      height: 48px;
      padding-right: 30px; /* Extra padding on the right to prevent elements from hitting the edge */
    }

    /* View mode container styles - mirroring timeline.css structure */
    #view-container {
      align-self: stretch;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0; /* Critical for proper flex child behavior */
    }

    #view-container-inner {
      max-width: 1200px;
      width: calc(100% - 40px);
      margin: 0 auto;
      position: relative;
      padding-bottom: 10px;
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      height: 100%; /* Ensure it takes full height of parent */
    }

    /* Adjust view container when todo panel is visible in chat mode */
    #view-container-inner.with-todo-panel {
      max-width: none;
      width: 100%;
      margin: 0;
      padding-left: 20px;
      padding-right: 20px;
    }

    #chat-input {
      align-self: flex-end;
      width: 100%;
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
    }

    .banner-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      min-width: 6em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .banner-title a {
      color: inherit;
      text-decoration: none;
      transition: opacity 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .banner-title a:hover {
      opacity: 0.8;
      text-decoration: underline;
    }

    .banner-title img {
      width: 20px;
      height: 20px;
      border-radius: 3px;
    }

    /* Mobile-specific styles for banner link */
    @media (max-width: 768px) {
      .title-container {
        max-width: 50%; /* Allow more space on mobile */
      }

      .banner-title {
        font-size: 16px; /* Slightly smaller on mobile */
      }

      .banner-title img {
        width: 18px;
        height: 18px;
      }
    }

    @media (max-width: 480px) {
      .title-container {
        max-width: 60%; /* Even more space on very small screens */
      }

      .banner-title {
        font-size: 14px;
      }

      .banner-title img {
        width: 16px;
        height: 16px;
      }
    }

    .slug-title {
      margin: 0;
      padding: 0;
      color: rgba(82, 82, 82, 0.85);
      font-size: 14px;
      font-weight: normal;
      font-style: italic;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Allow the container to expand to full width and height in diff mode */
    #view-container-inner.diff2-active {
      max-width: 100%;
      width: 100%;
      height: 100%;
      padding: 0; /* Remove padding for more space */
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0; /* Critical for flex behavior */
    }

    /* Individual view styles */
    .chat-view,
    .diff2-view,
    .terminal-view {
      display: none; /* Hidden by default */
      width: 100%;
      height: 100%;
    }

    /* Make chat view take full width available */
    .chat-view.view-active {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }

    /* Chat timeline container - takes full width, memory panel will be positioned separately */
    .chat-timeline-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      margin-right: 0; /* Default - no memory panel */
      transition: margin-right 0.2s ease; /* Smooth transition */
    }

    /* Adjust chat timeline container when todo panel is visible */
    .chat-timeline-container.with-todo-panel {
      margin-right: 400px; /* Make space for fixed todo panel */
      width: calc(100% - 400px); /* Explicitly set width to prevent overlap */
    }

    /* Todo panel container - fixed to right side */
    .todo-panel-container {
      position: fixed;
      top: 48px; /* Below top banner */
      right: 15px; /* Leave space for scroll bar */
      width: 400px;
      bottom: var(
        --chat-input-height,
        90px
      ); /* Dynamic height based on chat input size */
      background-color: #fafafa;
      border-left: 1px solid #e0e0e0;
      z-index: 100;
      display: none; /* Hidden by default */
      transition: bottom 0.2s ease; /* Smooth transition when height changes */
      /* Add fuzzy gradient at bottom to blend with text entry */
      background: linear-gradient(
        to bottom,
        #fafafa 0%,
        #fafafa 90%,
        rgba(250, 250, 250, 0.5) 95%,
        rgba(250, 250, 250, 0.2) 100%
      );
    }

    .todo-panel-container.visible {
      display: block;
    }

    /* Responsive adjustments for todo panel */
    @media (max-width: 1200px) {
      .todo-panel-container {
        width: 350px;
        /* bottom is still controlled by --chat-input-height CSS variable */
      }
      .chat-timeline-container.with-todo-panel {
        margin-right: 350px;
        width: calc(100% - 350px);
      }
    }

    @media (max-width: 900px) {
      .todo-panel-container {
        width: 300px;
        /* bottom is still controlled by --chat-input-height CSS variable */
      }
      .chat-timeline-container.with-todo-panel {
        margin-right: 300px;
        width: calc(100% - 300px);
      }
    }

    /* On very small screens, hide todo panel or make it overlay */
    @media (max-width: 768px) {
      .todo-panel-container.visible {
        display: none; /* Hide on mobile */
      }
      .chat-timeline-container.with-todo-panel {
        margin-right: 0;
        width: 100%;
      }
    }

    /* Monaco diff2 view needs to take all available space */
    .diff2-view.view-active {
      flex: 1;
      overflow: hidden;
      min-height: 0; /* Required for proper flex child behavior */
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    /* Active view styles - these will be applied via JavaScript */
    .view-active {
      display: flex;
      flex-direction: column;
    }

    .title-container {
      display: flex;
      flex-direction: column;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 30%;
      padding: 6px 0;
    }

    .refresh-control {
      display: flex;
      align-items: center;
      margin-bottom: 0;
      flex-wrap: nowrap;
      white-space: nowrap;
      flex-shrink: 0;
      gap: 15px;
      padding-left: 15px;
      margin-right: 50px;
    }

    .stop-button,
    .end-button {
      background: #2196f3;
      color: white;
      border: none;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-right: 5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stop-button {
      background: #dc3545;
      color: white;
    }

    .stop-button:hover:not(:disabled) {
      background-color: #c82333;
    }

    .stop-button:disabled {
      background-color: #e9a8ad;
      cursor: not-allowed;
      opacity: 0.7;
    }

    .stop-button:disabled:hover {
      background-color: #e9a8ad;
    }

    .end-button {
      background: #6c757d;
      color: white;
    }

    .end-button:hover:not(:disabled) {
      background-color: #5a6268;
    }

    .end-button:disabled {
      background-color: #a9acaf;
      cursor: not-allowed;
      opacity: 0.7;
    }

    .button-icon {
      width: 16px;
      height: 16px;
    }

    @media (max-width: 1400px) {
      .button-text {
        display: none;
      }

      .stop-button {
        padding: 6px;
      }
    }

    /* Removed poll-updates class */

    .notifications-toggle {
      display: flex;
      align-items: center;
      font-size: 12px;
      margin-right: 10px;
      cursor: pointer;
    }

    .bell-icon {
      width: 20px;
      height: 20px;
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .bell-disabled::before {
      content: "";
      position: absolute;
      width: 2px;
      height: 24px;
      background-color: #dc3545;
      transform: rotate(45deg);
      transform-origin: center center;
    }
  `;

  // Header bar: Network connection status details
  @property()
  connectionStatus: ConnectionStatus = "disconnected";

  // Track if the last commit info has been copied
  @state()
  // lastCommitCopied moved to sketch-container-status

  // Track notification preferences
  @state()
  notificationsEnabled: boolean = false;

  // Track if the window is focused to control notifications
  @state()
  private _windowFocused: boolean = document.hasFocus();

  // Track if the todo panel should be visible
  @state()
  private _todoPanelVisible: boolean = false;

  // ResizeObserver for tracking chat input height changes
  private chatInputResizeObserver: ResizeObserver | null = null;

  @property()
  connectionErrorMessage: string = "";

  // Chat messages
  @property({ attribute: false })
  messages: AgentMessage[] = [];

  @property()
  set slug(value: string) {
    const oldValue = this._slug;
    this._slug = value;
    this.requestUpdate("slug", oldValue);
    // Update document title when slug property changes
    this.updateDocumentTitle();
  }

  get slug(): string {
    return this._slug;
  }

  private _slug: string = "";

  private dataManager = new DataManager();

  @property({ attribute: false })
  containerState: State = {
    state_version: 2,
    slug: "",
    os: "",
    message_count: 0,
    hostname: "",
    working_dir: "",
    initial_commit: "",
    outstanding_llm_calls: 0,
    outstanding_tool_calls: [],
    session_id: "",
    ssh_available: false,
    ssh_error: "",
    in_container: false,
    first_message_index: 0,
  };

  // Mutation observer to detect when new messages are added
  private mutationObserver: MutationObserver | null = null;

  constructor() {
    super();

    // Reference to the container status element
    this.containerStatusElement = null;

    // Binding methods to this
    this._handleViewModeSelect = this._handleViewModeSelect.bind(this);
    this._handlePopState = this._handlePopState.bind(this);
    this._handleShowCommitDiff = this._handleShowCommitDiff.bind(this);
    this._handleMutlipleChoiceSelected =
      this._handleMutlipleChoiceSelected.bind(this);
    this._handleStopClick = this._handleStopClick.bind(this);
    this._handleEndClick = this._handleEndClick.bind(this);
    this._handleNotificationsToggle =
      this._handleNotificationsToggle.bind(this);
    this._handleWindowFocus = this._handleWindowFocus.bind(this);
    this._handleWindowBlur = this._handleWindowBlur.bind(this);

    // Load notification preference from localStorage
    try {
      const savedPref = localStorage.getItem("sketch-notifications-enabled");
      if (savedPref !== null) {
        this.notificationsEnabled = savedPref === "true";
      }
    } catch (error) {
      console.error("Error loading notification preference:", error);
    }
  }

  // See https://lit.dev/docs/components/lifecycle/
  connectedCallback() {
    super.connectedCallback();

    // Get reference to the container status element
    setTimeout(() => {
      this.containerStatusElement =
        this.shadowRoot?.getElementById("container-status");
    }, 0);

    // Initialize client-side nav history.
    const url = new URL(window.location.href);
    const mode = url.searchParams.get("view") || "chat";
    window.history.replaceState({ mode }, "", url.toString());

    this.toggleViewMode(mode as ViewMode, false);
    // Add popstate event listener to handle browser back/forward navigation
    window.addEventListener("popstate", this._handlePopState);

    // Add event listeners
    window.addEventListener("view-mode-select", this._handleViewModeSelect);
    window.addEventListener("show-commit-diff", this._handleShowCommitDiff);

    // Add window focus/blur listeners for controlling notifications
    window.addEventListener("focus", this._handleWindowFocus);
    window.addEventListener("blur", this._handleWindowBlur);
    window.addEventListener(
      "multiple-choice-selected",
      this._handleMutlipleChoiceSelected,
    );

    // register event listeners
    this.dataManager.addEventListener(
      "dataChanged",
      this.handleDataChanged.bind(this),
    );
    this.dataManager.addEventListener(
      "connectionStatusChanged",
      this.handleConnectionStatusChanged.bind(this),
    );

    // Set initial document title
    this.updateDocumentTitle();

    // Initialize the data manager
    this.dataManager.initialize();

    // Process existing messages for commit info
    if (this.messages && this.messages.length > 0) {
      // Update last commit info via container status component
      setTimeout(() => {
        if (this.containerStatusElement) {
          this.containerStatusElement.updateLastCommitInfo(this.messages);
        }
      }, 100);
    }

    // Check if todo panel should be visible on initial load
    this.checkTodoPanelVisibility();

    // Set up ResizeObserver for chat input to update todo panel height
    this.setupChatInputObserver();
  }

  // See https://lit.dev/docs/components/lifecycle/
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._handlePopState);

    // Remove event listeners
    window.removeEventListener("view-mode-select", this._handleViewModeSelect);
    window.removeEventListener("show-commit-diff", this._handleShowCommitDiff);
    window.removeEventListener("focus", this._handleWindowFocus);
    window.removeEventListener("blur", this._handleWindowBlur);
    window.removeEventListener(
      "multiple-choice-selected",
      this._handleMutlipleChoiceSelected,
    );

    // unregister data manager event listeners
    this.dataManager.removeEventListener(
      "dataChanged",
      this.handleDataChanged.bind(this),
    );
    this.dataManager.removeEventListener(
      "connectionStatusChanged",
      this.handleConnectionStatusChanged.bind(this),
    );

    // Disconnect mutation observer if it exists
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // Disconnect chat input resize observer if it exists
    if (this.chatInputResizeObserver) {
      this.chatInputResizeObserver.disconnect();
      this.chatInputResizeObserver = null;
    }
  }

  updateUrlForViewMode(mode: ViewMode): void {
    // Get the current URL without search parameters
    const url = new URL(window.location.href);

    // Clear existing parameters
    url.search = "";

    // Only add view parameter if not in default chat view
    if (mode !== "chat") {
      url.searchParams.set("view", mode);
      const diff2View = this.shadowRoot?.querySelector(
        "sketch-diff2-view",
      ) as SketchDiff2View;

      // If in diff2 view and there's a commit hash, include that too
      if (mode === "diff2" && diff2View?.commit) {
        url.searchParams.set("commit", diff2View.commit);
      }
    }

    // Update the browser history without reloading the page
    window.history.pushState({ mode }, "", url.toString());
  }

  private _handlePopState(event: PopStateEvent) {
    if (event.state && event.state.mode) {
      this.toggleViewMode(event.state.mode, false);
    } else {
      this.toggleViewMode("chat", false);
    }
  }

  /**
   * Handle view mode selection event
   */
  private _handleViewModeSelect(event: CustomEvent) {
    const mode = event.detail.mode as "chat" | "diff2" | "terminal";
    this.toggleViewMode(mode, true);
  }

  /**
   * Handle show commit diff event
   */
  private _handleShowCommitDiff(event: CustomEvent) {
    const { commitHash } = event.detail;
    if (commitHash) {
      this.showCommitDiff(commitHash);
    }
  }

  private _handleMultipleChoice(event: CustomEvent) {
    window.console.log("_handleMultipleChoice", event);
    this._sendChat;
  }

  private _handleDiffComment(event: CustomEvent) {
    // Empty stub required by the event binding in the template
    // Actual handling occurs at global level in sketch-chat-input component
  }
  /**
   * Listen for commit diff event
   * @param commitHash The commit hash to show diff for
   */
  private showCommitDiff(commitHash: string): void {
    // Store the commit hash
    this.currentCommitHash = commitHash;

    this.toggleViewMode("diff2", true);

    this.updateComplete.then(() => {
      const diff2View = this.shadowRoot?.querySelector("sketch-diff2-view");
      if (diff2View) {
        (diff2View as SketchDiff2View).refreshDiffView();
      }
    });
  }

  /**
   * Toggle between different view modes: chat, diff2, terminal
   */
  private toggleViewMode(mode: ViewMode, updateHistory: boolean): void {
    // Don't do anything if the mode is already active
    if (this.viewMode === mode) return;

    // Update the view mode
    this.viewMode = mode;

    if (updateHistory) {
      // Update URL with the current view mode
      this.updateUrlForViewMode(mode);
    }

    // Wait for DOM update to complete
    this.updateComplete.then(() => {
      // Update active view
      const viewContainerInner = this.shadowRoot?.querySelector(
        "#view-container-inner",
      );
      const chatView = this.shadowRoot?.querySelector(".chat-view");
      const diff2View = this.shadowRoot?.querySelector(".diff2-view");
      const terminalView = this.shadowRoot?.querySelector(".terminal-view");

      // Remove active class from all views
      chatView?.classList.remove("view-active");
      diff2View?.classList.remove("view-active");
      terminalView?.classList.remove("view-active");

      // Add/remove diff2-active class on view container
      if (mode === "diff2") {
        viewContainerInner?.classList.add("diff2-active");
      } else {
        viewContainerInner?.classList.remove("diff2-active");
      }

      // Add active class to the selected view
      switch (mode) {
        case "chat":
          chatView?.classList.add("view-active");
          break;

        case "diff2":
          diff2View?.classList.add("view-active");
          // Refresh git/recentlog when Monaco diff view is opened
          // This ensures branch information is always up-to-date, as branches can change frequently
          const diff2ViewComp =
            this.shadowRoot?.querySelector("sketch-diff2-view");
          if (diff2ViewComp) {
            (diff2ViewComp as SketchDiff2View).refreshDiffView();
          }
          break;

        case "terminal":
          terminalView?.classList.add("view-active");
          break;
      }

      // Update view mode buttons
      const viewModeSelect = this.shadowRoot?.querySelector(
        "sketch-view-mode-select",
      );
      if (viewModeSelect) {
        const event = new CustomEvent("update-active-mode", {
          detail: { mode },
          bubbles: true,
          composed: true,
        });
        viewModeSelect.dispatchEvent(event);
      }
    });
  }

  /**
   * Updates the document title based on current slug and connection status
   */
  private updateDocumentTitle(): void {
    let docTitle = `sk: ${this.slug || "untitled"}`;

    // Add red circle emoji if disconnected
    if (this.connectionStatus === "disconnected") {
      docTitle += " 🔴";
    }

    document.title = docTitle;
  }

  // Check and request notification permission if needed
  private async checkNotificationPermission(): Promise<boolean> {
    // Check if the Notification API is supported
    if (!("Notification" in window)) {
      console.log("This browser does not support notifications");
      return false;
    }

    // Check if permission is already granted
    if (Notification.permission === "granted") {
      return true;
    }

    // If permission is not denied, request it
    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }

    return false;
  }

  // Handle notifications toggle click
  private _handleNotificationsToggle(): void {
    this.notificationsEnabled = !this.notificationsEnabled;

    // If enabling notifications, check permissions
    if (this.notificationsEnabled) {
      this.checkNotificationPermission();
    }

    // Save preference to localStorage
    try {
      localStorage.setItem(
        "sketch-notifications-enabled",
        String(this.notificationsEnabled),
      );
    } catch (error) {
      console.error("Error saving notification preference:", error);
    }
  }

  // Handle window focus event
  private _handleWindowFocus(): void {
    this._windowFocused = true;
  }

  // Handle window blur event
  private _handleWindowBlur(): void {
    this._windowFocused = false;
  }

  // Show notification for message with EndOfTurn=true
  private async showEndOfTurnNotification(
    message: AgentMessage,
  ): Promise<void> {
    // Don't show notifications if they're disabled
    if (!this.notificationsEnabled) return;

    // Don't show notifications if the window is focused
    if (this._windowFocused) return;

    // Check if we have permission to show notifications
    const hasPermission = await this.checkNotificationPermission();
    if (!hasPermission) return;

    // Only show notifications for agent messages with end_of_turn=true and no parent_conversation_id
    if (
      message.type !== "agent" ||
      !message.end_of_turn ||
      message.parent_conversation_id
    )
      return;

    // Create a title that includes the sketch slug
    const notificationTitle = `Sketch: ${this.slug || "untitled"}`;

    // Extract the beginning of the message content (first 100 chars)
    const messagePreview = message.content
      ? message.content.substring(0, 100) +
        (message.content.length > 100 ? "..." : "")
      : "Agent has completed its turn";

    // Create and show the notification
    try {
      new Notification(notificationTitle, {
        body: messagePreview,
        icon: "https://sketch.dev/favicon.ico", // Use sketch.dev favicon for notification
      });
    } catch (error) {
      console.error("Error showing notification:", error);
    }
  }

  // Check if todo panel should be visible based on latest todo content from messages or state
  private checkTodoPanelVisibility(): void {
    // Find the latest todo content from messages first
    let latestTodoContent = "";
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.todo_content !== undefined) {
        latestTodoContent = message.todo_content || "";
        break;
      }
    }

    // If no todo content found in messages, check the current state
    if (latestTodoContent === "" && this.containerState?.todo_content) {
      latestTodoContent = this.containerState.todo_content;
    }

    // Parse the todo data to check if there are any actual todos
    let hasTodos = false;
    if (latestTodoContent.trim()) {
      try {
        const todoData = JSON.parse(latestTodoContent);
        hasTodos = todoData.items && todoData.items.length > 0;
      } catch (error) {
        // Invalid JSON, treat as no todos
        hasTodos = false;
      }
    }

    this._todoPanelVisible = hasTodos;

    // Update todo panel content if visible
    if (hasTodos) {
      const todoPanel = this.shadowRoot?.querySelector(
        "sketch-todo-panel",
      ) as any;
      if (todoPanel && todoPanel.updateTodoContent) {
        todoPanel.updateTodoContent(latestTodoContent);
      }
    }
  }

  private handleDataChanged(eventData: {
    state: State;
    newMessages: AgentMessage[];
  }): void {
    const { state, newMessages } = eventData;

    // Update state if we received it
    if (state) {
      // Ensure we're using the latest call status to prevent indicators from being stuck
      if (
        state.outstanding_llm_calls === 0 &&
        state.outstanding_tool_calls.length === 0
      ) {
        // Force reset containerState calls when nothing is reported as in progress
        state.outstanding_llm_calls = 0;
        state.outstanding_tool_calls = [];
      }

      this.containerState = state;
      this.slug = state.slug || "";

      // Update document title when sketch slug changes
      this.updateDocumentTitle();
    }

    // Update messages
    this.messages = aggregateAgentMessages(this.messages, newMessages);

    // Process new messages to find commit messages
    // Update last commit info via container status component
    if (this.containerStatusElement) {
      this.containerStatusElement.updateLastCommitInfo(newMessages);
    }

    // Check for agent messages with end_of_turn=true and show notifications
    if (newMessages && newMessages.length > 0) {
      for (const message of newMessages) {
        if (
          message.type === "agent" &&
          message.end_of_turn &&
          !message.parent_conversation_id
        ) {
          this.showEndOfTurnNotification(message);
          break; // Only show one notification per batch of messages
        }
      }
    }

    // Check if todo panel should be visible after agent loop iteration
    this.checkTodoPanelVisibility();

    // Ensure chat input observer is set up when new data comes in
    if (!this.chatInputResizeObserver) {
      this.setupChatInputObserver();
    }
  }

  private handleConnectionStatusChanged(
    status: ConnectionStatus,
    errorMessage?: string,
  ): void {
    this.connectionStatus = status;
    this.connectionErrorMessage = errorMessage || "";

    // Update document title when connection status changes
    this.updateDocumentTitle();
  }

  private async _handleStopClick(): Promise<void> {
    try {
      const response = await fetch("cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "user requested cancellation" }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(
          `Failed to stop operation: ${response.status} - ${errorData}`,
        );
      }

      // Stop request sent
    } catch (error) {
      console.error("Error stopping operation:", error);
    }
  }

  private async _handleEndClick(event?: Event): Promise<void> {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    // Show confirmation dialog
    const confirmed = window.confirm(
      "Ending the session will shut down the underlying container. Are you sure?",
    );
    if (!confirmed) return;

    try {
      const response = await fetch("end", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "user requested end of session" }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(
          `Failed to end session: ${response.status} - ${errorData}`,
        );
      }

      // After successful response, redirect to messages view
      // Extract the session ID from the URL
      const currentUrl = window.location.href;
      // The URL pattern should be like https://sketch.dev/s/cs71-8qa6-1124-aw79/
      const urlParts = currentUrl.split("/");
      let sessionId = "";

      // Find the session ID in the URL (should be after /s/)
      for (let i = 0; i < urlParts.length; i++) {
        if (urlParts[i] === "s" && i + 1 < urlParts.length) {
          sessionId = urlParts[i + 1];
          break;
        }
      }

      if (sessionId) {
        // Create the messages URL
        const messagesUrl = `/messages/${sessionId}`;
        // Redirect to messages view
        window.location.href = messagesUrl;
      }

      // End request sent - connection will be closed by server
    } catch (error) {
      console.error("Error ending session:", error);
    }
  }

  async _handleMutlipleChoiceSelected(e: CustomEvent) {
    const chatInput = this.shadowRoot?.querySelector(
      "sketch-chat-input",
    ) as SketchChatInput;
    if (chatInput) {
      if (chatInput.content && chatInput.content.trim() !== "") {
        chatInput.content += "\n\n";
      }
      chatInput.content += e.detail.responseText;
      chatInput.focus();
      // Adjust textarea height to accommodate new content
      requestAnimationFrame(() => {
        if (chatInput.adjustChatSpacing) {
          chatInput.adjustChatSpacing();
        }
      });
    }
  }

  async _sendChat(e: CustomEvent) {
    console.log("app shell: _sendChat", e);
    e.preventDefault();
    e.stopPropagation();
    const message = e.detail.message?.trim();
    if (message == "") {
      return;
    }
    try {
      // Always switch to chat view when sending a message so user can see processing
      if (this.viewMode !== "chat") {
        this.toggleViewMode("chat", true);
      }

      // Send the message to the server
      const response = await fetch("chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorData}`);
      }
    } catch (error) {
      console.error("Error sending chat message:", error);
      const statusText = document.getElementById("statusText");
      if (statusText) {
        statusText.textContent = "Error sending message";
      }
    }
  }

  private scrollContainerRef = createRef<HTMLElement>();

  /**
   * Set up ResizeObserver to monitor chat input height changes
   */
  private setupChatInputObserver(): void {
    // Wait for DOM to be ready
    this.updateComplete.then(() => {
      const chatInputElement = this.shadowRoot?.querySelector("#chat-input");
      if (chatInputElement && !this.chatInputResizeObserver) {
        this.chatInputResizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            this.updateTodoPanelHeight(entry.contentRect.height);
          }
        });

        this.chatInputResizeObserver.observe(chatInputElement);

        // Initial height calculation
        const rect = chatInputElement.getBoundingClientRect();
        this.updateTodoPanelHeight(rect.height);
      }
    });
  }

  /**
   * Update the CSS custom property that controls todo panel bottom position
   */
  private updateTodoPanelHeight(chatInputHeight: number): void {
    // Add some padding (20px) between todo panel and chat input
    const bottomOffset = chatInputHeight;

    // Update the CSS custom property on the host element
    this.style.setProperty("--chat-input-height", `${bottomOffset}px`);
  }

  render() {
    return html`
      <div id="top-banner">
        <div class="title-container">
          <h1 class="banner-title">
            ${this.containerState?.skaband_addr
              ? html`<a
                  href="${this.containerState.skaband_addr}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src="${this.containerState.skaband_addr}/sketch.dev.png"
                    alt="sketch"
                  />
                  sketch
                </a>`
              : html`sketch`}
          </h1>
          <h2 class="slug-title">${this.slug}</h2>
        </div>

        <!-- Container status info moved above tabs -->
        <sketch-container-status
          .state=${this.containerState}
          id="container-status"
        ></sketch-container-status>

        <!-- Last Commit section moved to sketch-container-status -->

        <!-- Views section with tabs -->
        <sketch-view-mode-select></sketch-view-mode-select>

        <div class="refresh-control">
          <button
            id="stopButton"
            class="stop-button"
            ?disabled=${(this.containerState?.outstanding_llm_calls || 0) ===
              0 &&
            (this.containerState?.outstanding_tool_calls || []).length === 0}
          >
            <svg
              class="button-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="6" y="6" width="12" height="12" />
            </svg>
            <span class="button-text">Stop</span>
          </button>
          <button
            id="endButton"
            class="end-button"
            @click=${this._handleEndClick}
          >
            <svg
              class="button-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
            <span class="button-text">End</span>
          </button>

          <div
            class="notifications-toggle"
            @click=${this._handleNotificationsToggle}
            title="${this.notificationsEnabled
              ? "Disable"
              : "Enable"} notifications when the agent completes its turn"
          >
            <div
              class="bell-icon ${!this.notificationsEnabled
                ? "bell-disabled"
                : ""}"
            >
              <!-- Bell SVG icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path
                  d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z"
                />
              </svg>
            </div>
          </div>

          <sketch-call-status
            .agentState=${this.containerState?.agent_state}
            .llmCalls=${this.containerState?.outstanding_llm_calls || 0}
            .toolCalls=${this.containerState?.outstanding_tool_calls || []}
            .isIdle=${this.messages.length > 0
              ? this.messages[this.messages.length - 1]?.end_of_turn &&
                !this.messages[this.messages.length - 1]?.parent_conversation_id
              : true}
            .isDisconnected=${this.connectionStatus === "disconnected"}
          ></sketch-call-status>

          <sketch-network-status
            connection=${this.connectionStatus}
            error=${this.connectionErrorMessage}
          ></sketch-network-status>
        </div>
      </div>

      <div id="view-container" ${ref(this.scrollContainerRef)}>
        <div
          id="view-container-inner"
          class="${this._todoPanelVisible && this.viewMode === "chat"
            ? "with-todo-panel"
            : ""}"
        >
          <div
            class="chat-view ${this.viewMode === "chat" ? "view-active" : ""}"
          >
            <div
              class="chat-timeline-container ${this._todoPanelVisible &&
              this.viewMode === "chat"
                ? "with-todo-panel"
                : ""}"
            >
              <sketch-timeline
                .messages=${this.messages}
                .scrollContainer=${this.scrollContainerRef}
                .agentState=${this.containerState?.agent_state}
                .llmCalls=${this.containerState?.outstanding_llm_calls || 0}
                .toolCalls=${this.containerState?.outstanding_tool_calls || []}
                .firstMessageIndex=${this.containerState?.first_message_index ||
                0}
                .state=${this.containerState}
              ></sketch-timeline>
            </div>
          </div>

          <!-- Todo panel positioned outside the main flow - only visible in chat view -->
          <div
            class="todo-panel-container ${this._todoPanelVisible &&
            this.viewMode === "chat"
              ? "visible"
              : ""}"
          >
            <sketch-todo-panel
              .visible=${this._todoPanelVisible && this.viewMode === "chat"}
            ></sketch-todo-panel>
          </div>
          <div
            class="diff2-view ${this.viewMode === "diff2" ? "view-active" : ""}"
          >
            <sketch-diff2-view
              .commit=${this.currentCommitHash}
              .gitService=${new DefaultGitDataService()}
              @diff-comment="${this._handleDiffComment}"
            ></sketch-diff2-view>
          </div>

          <div
            class="terminal-view ${this.viewMode === "terminal"
              ? "view-active"
              : ""}"
          >
            <sketch-terminal></sketch-terminal>
          </div>
        </div>
      </div>

      <div id="chat-input">
        <sketch-chat-input @send-chat="${this._sendChat}"></sketch-chat-input>
      </div>
    `;
  }

  /**
   * Lifecycle callback when component is first connected to DOM
   */
  firstUpdated(): void {
    if (this.viewMode !== "chat") {
      return;
    }

    // Initial scroll to bottom when component is first rendered
    setTimeout(
      () => this.scrollTo({ top: this.scrollHeight, behavior: "smooth" }),
      50,
    );

    // Setup stop button
    const stopButton = this.renderRoot?.querySelector(
      "#stopButton",
    ) as HTMLButtonElement;
    stopButton?.addEventListener("click", async () => {
      try {
        const response = await fetch("cancel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: "User clicked stop button" }),
        });
        if (!response.ok) {
          console.error("Failed to cancel:", await response.text());
        }
      } catch (error) {
        console.error("Error cancelling operation:", error);
      }
    });

    // Setup end button
    const endButton = this.renderRoot?.querySelector(
      "#endButton",
    ) as HTMLButtonElement;
    // We're already using the @click binding in the HTML, so manual event listener not needed here

    // Process any existing messages to find commit information
    if (this.messages && this.messages.length > 0) {
      // Update last commit info via container status component
      if (this.containerStatusElement) {
        this.containerStatusElement.updateLastCommitInfo(this.messages);
      }
    }

    // Set up chat input height observer for todo panel
    this.setupChatInputObserver();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-app-shell": SketchAppShell;
  }
}
