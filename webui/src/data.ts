import { AgentMessage, State } from "./types";
import { formatNumber } from "./utils";

/**
 * Event types for data manager
 */
export type DataManagerEventType = "dataChanged" | "connectionStatusChanged" | "initialLoadComplete";

/**
 * Connection status types
 */
export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "disabled";

/**
 * DataManager - Class to manage timeline data, fetching, and SSE streaming
 */
export class DataManager {
  // State variables
  private messages: AgentMessage[] = [];
  private timelineState: State | null = null;
  private isFirstLoad: boolean = true;
  private lastHeartbeatTime: number = 0;
  private connectionStatus: ConnectionStatus = "disconnected";
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt: number = 0;
  private maxReconnectDelayMs: number = 60000; // Max delay of 60 seconds
  private baseReconnectDelayMs: number = 1000; // Start with 1 second
  
  // Initial load completion tracking
  private expectedMessageCount: number | null = null;
  private isInitialLoadComplete: boolean = false;

  // Event listeners
  private eventListeners: Map<
    DataManagerEventType,
    Array<(...args: any[]) => void>
  > = new Map();

  constructor() {
    // Initialize empty arrays for each event type
    this.eventListeners.set("dataChanged", []);
    this.eventListeners.set("connectionStatusChanged", []);
    this.eventListeners.set("initialLoadComplete", []);

    // Check connection status periodically
    setInterval(() => this.checkConnectionStatus(), 5000);
  }

  /**
   * Initialize the data manager and connect to the SSE stream
   */
  public async initialize(): Promise<void> {
    // Connect to the SSE stream
    this.connect();
  }

  /**
   * Connect to the SSE stream
   */
  private connect(): void {
    // If we're already connecting or connected, don't start another connection attempt
    if (
      this.eventSource &&
      (this.connectionStatus === "connecting" ||
        this.connectionStatus === "connected")
    ) {
      return;
    }

    // Close any existing connection
    this.closeEventSource();

    // Reset initial load state for new connection
    this.expectedMessageCount = null;
    this.isInitialLoadComplete = false;

    // Update connection status to connecting
    this.updateConnectionStatus("connecting", "Connecting...");

    // Determine the starting point for the stream based on what we already have
    const fromIndex =
      this.messages.length > 0
        ? this.messages[this.messages.length - 1].idx + 1
        : 0;

    // Create a new EventSource connection
    this.eventSource = new EventSource(`stream?from=${fromIndex}`);

    // Set up event handlers
    this.eventSource.addEventListener("open", () => {
      console.log("SSE stream opened");
      this.reconnectAttempt = 0; // Reset reconnect attempt counter on successful connection
      this.updateConnectionStatus("connected");
      this.lastHeartbeatTime = Date.now(); // Set initial heartbeat time
    });

    this.eventSource.addEventListener("error", (event) => {
      console.error("SSE stream error:", event);
      this.closeEventSource();
      this.updateConnectionStatus("disconnected", "Connection lost");
      this.scheduleReconnect();
    });

    // Handle incoming messages
    this.eventSource.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as AgentMessage;
      this.processNewMessage(message);
    });

    // Handle state updates
    this.eventSource.addEventListener("state", (event) => {
      const state = JSON.parse(event.data) as State;
      this.timelineState = state;
      
      // Store expected message count for initial load detection
      if (this.expectedMessageCount === null) {
        this.expectedMessageCount = state.message_count;
        console.log(`Initial load expects ${this.expectedMessageCount} messages`);
        
        // Handle empty conversation case - immediately mark as complete
        if (this.expectedMessageCount === 0) {
          this.isInitialLoadComplete = true;
          console.log(`Initial load complete: Empty conversation (0 messages)`);
          this.emitEvent("initialLoadComplete", { 
            messageCount: 0,
            expectedCount: 0 
          });
        }
      }
      
      this.checkInitialLoadComplete();
      this.emitEvent("dataChanged", { state, newMessages: [] });
    });

    // Handle heartbeats
    this.eventSource.addEventListener("heartbeat", () => {
      this.lastHeartbeatTime = Date.now();
      // Make sure connection status is updated if it wasn't already
      if (this.connectionStatus !== "connected") {
        this.updateConnectionStatus("connected");
      }
    });
  }

  /**
   * Close the current EventSource connection
   */
  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Calculate backoff delay with exponential increase and maximum limit
    const delay = Math.min(
      this.baseReconnectDelayMs * Math.pow(1.5, this.reconnectAttempt),
      this.maxReconnectDelayMs,
    );

    console.log(
      `Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt + 1})`,
    );

    // Increment reconnect attempt counter
    this.reconnectAttempt++;

    // Schedule the reconnect
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Check heartbeat status to determine if connection is still active
   */
  private checkConnectionStatus(): void {
    if (this.connectionStatus !== "connected") {
      return; // Only check if we think we're connected
    }

    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTime;
    if (timeSinceLastHeartbeat > 90000) {
      // 90 seconds without heartbeat
      console.warn(
        "No heartbeat received in 90 seconds, connection appears to be lost",
      );
      this.closeEventSource();
      this.updateConnectionStatus(
        "disconnected",
        "Connection timed out (no heartbeat)",
      );
      this.scheduleReconnect();
    }
  }

  /**
   * Check if initial load is complete based on expected message count
   */
  private checkInitialLoadComplete(): void {
    if (this.expectedMessageCount !== null && 
        this.expectedMessageCount > 0 &&
        this.messages.length >= this.expectedMessageCount && 
        !this.isInitialLoadComplete) {
      
      this.isInitialLoadComplete = true;
      console.log(`Initial load complete: ${this.messages.length}/${this.expectedMessageCount} messages loaded`);
      
      this.emitEvent("initialLoadComplete", { 
        messageCount: this.messages.length,
        expectedCount: this.expectedMessageCount 
      });
    }
  }

  /**
   * Process a new message from the SSE stream
   */
  private processNewMessage(message: AgentMessage): void {
    // Find the message's position in the array
    const existingIndex = this.messages.findIndex((m) => m.idx === message.idx);

    if (existingIndex >= 0) {
      // This shouldn't happen - we should never receive duplicates
      console.error(
        `Received duplicate message with idx ${message.idx}`,
        message,
      );
      return;
    } else {
      // Add the new message to our array
      this.messages.push(message);
      // Sort messages by idx to ensure they're in the correct order
      this.messages.sort((a, b) => a.idx - b.idx);
    }

    // Mark that we've completed first load
    if (this.isFirstLoad) {
      this.isFirstLoad = false;
    }

    // Check if initial load is now complete
    this.checkInitialLoadComplete();

    // Emit an event that data has changed
    this.emitEvent("dataChanged", {
      state: this.timelineState,
      newMessages: [message],
      isFirstFetch: this.isInitialLoadComplete,
    });
  }

  /**
   * Get all messages
   */
  public getMessages(): AgentMessage[] {
    return this.messages;
  }

  /**
   * Get the current state
   */
  public getState(): State | null {
    return this.timelineState;
  }

  /**
   * Get the connection status
   */
  public getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Get the isFirstLoad flag
   */
  public getIsFirstLoad(): boolean {
    return this.isFirstLoad;
  }

  /**
   * Get the initial load completion status
   */
  public getIsInitialLoadComplete(): boolean {
    return this.isInitialLoadComplete;
  }

  /**
   * Get the expected message count for initial load
   */
  public getExpectedMessageCount(): number | null {
    return this.expectedMessageCount;
  }

  /**
   * Add an event listener
   */
  public addEventListener(
    event: DataManagerEventType,
    callback: (...args: any[]) => void,
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);
  }

  /**
   * Remove an event listener
   */
  public removeEventListener(
    event: DataManagerEventType,
    callback: (...args: any[]) => void,
  ): void {
    const listeners = this.eventListeners.get(event) || [];
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
      this.eventListeners.set(event, listeners);
    }
  }

  /**
   * Emit an event
   */
  private emitEvent(event: DataManagerEventType, ...args: any[]): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach((callback) => callback(...args));
  }

  /**
   * Update the connection status
   */
  private updateConnectionStatus(
    status: ConnectionStatus,
    message?: string,
  ): void {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.emitEvent("connectionStatusChanged", status, message || "");
    }
  }

  /**
   * Send a message to the agent
   */
  public async send(message: string): Promise<boolean> {
    // Attempt to connect if we're not already connected
    if (
      this.connectionStatus !== "connected" &&
      this.connectionStatus !== "connecting"
    ) {
      this.connect();
    }

    try {
      const response = await fetch("chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      return false;
    }
  }

  /**
   * Cancel the current conversation
   */
  public async cancel(): Promise<boolean> {
    try {
      const response = await fetch("cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "User cancelled" }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error("Error cancelling conversation:", error);
      return false;
    }
  }

  /**
   * Cancel a specific tool call
   */
  public async cancelToolUse(toolCallId: string): Promise<boolean> {
    try {
      const response = await fetch("cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "User cancelled tool use",
          tool_call_id: toolCallId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error("Error cancelling tool use:", error);
      return false;
    }
  }

  /**
   * Download the conversation data
   */
  public downloadConversation(): void {
    window.location.href = "download";
  }

  /**
   * Get a suggested reprompt
   */
  public async getSuggestedReprompt(): Promise<string | null> {
    try {
      const response = await fetch("suggest-reprompt");
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data.prompt;
    } catch (error) {
      console.error("Error getting suggested reprompt:", error);
      return null;
    }
  }

  /**
   * Get description for a commit
   */
  public async getCommitDescription(revision: string): Promise<string | null> {
    try {
      const response = await fetch(
        `commit-description?revision=${encodeURIComponent(revision)}`,
      );
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data.description;
    } catch (error) {
      console.error("Error getting commit description:", error);
      return null;
    }
  }
}
