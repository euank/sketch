import { css, html, LitElement, PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";

@customElement("sketch-chat-input")
export class SketchChatInput extends LitElement {
  @state()
  content: string = "";

  @state()
  isDraggingOver: boolean = false;

  @state()
  uploadsInProgress: number = 0;

  @state()
  showUploadInProgressMessage: boolean = false;

  // See https://lit.dev/docs/components/styles/ for how lit-element handles CSS.
  // Note that these styles only apply to the scope of this web component's
  // shadow DOM node, so they won't leak out or collide with CSS declared in
  // other components or the containing web page (...unless you want it to do that).
  static styles = css`
    /* Chat styles - exactly matching timeline.css */
    .chat-container {
      width: 100%;
      background: var(--bg-secondary);
      padding: 15px;
      min-height: 40px; /* Ensure minimum height */
      position: relative;
    }

    .chat-input-wrapper {
      display: flex;
      max-width: 1200px;
      margin: 0 auto;
      gap: 10px;
    }

    #chatInput {
      flex: 1;
      padding: 12px;
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      resize: vertical;
      font-family: monospace;
      font-size: 12px;
      min-height: 40px;
      max-height: 300px;
      background: var(--bg-tertiary);
      overflow-y: auto;
      box-sizing: border-box; /* Ensure padding is included in height calculation */
      line-height: 1.4; /* Consistent line height for better height calculation */
    }

    #sendChatButton {
      background-color: var(--accent-primary);
      color: var(--text-inverse);
      border: none;
      border-radius: 4px;
      padding: 0 20px;
      cursor: pointer;
      font-weight: 600;
      align-self: center;
      height: 40px;
    }

    #sendChatButton:hover {
      background-color: var(--accent-hover);
    }

    #sendChatButton:disabled {
      background-color: var(--accent-disabled);
      cursor: not-allowed;
    }

    /* Drop zone styling */
    .drop-zone-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--info-bg);
      border: 2px dashed var(--accent-primary);
      border-radius: 4px;
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10;
      pointer-events: none;
    }

    .drop-zone-message,
    .upload-progress-message {
      background-color: #ffffff;
      padding: 15px 20px;
      border-radius: 4px;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .upload-progress-message {
      position: absolute;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      background-color: #fff9c4;
      border: 1px solid #fbc02d;
      z-index: 20;
      font-size: 14px;
      animation: fadeIn 0.3s ease-in-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  `;

  constructor() {
    super();
    this._handleDiffComment = this._handleDiffComment.bind(this);
    this._handleTodoComment = this._handleTodoComment.bind(this);
    this._handleDragOver = this._handleDragOver.bind(this);
    this._handleDragEnter = this._handleDragEnter.bind(this);
    this._handleDragLeave = this._handleDragLeave.bind(this);
    this._handleDrop = this._handleDrop.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("diff-comment", this._handleDiffComment);
    window.addEventListener("todo-comment", this._handleTodoComment);
  }

  // Utility function to handle file uploads (used by both paste and drop handlers)
  private async _uploadFile(file: File, insertPosition: number) {
    // Insert a placeholder at the cursor position
    const textBefore = this.content.substring(0, insertPosition);
    const textAfter = this.content.substring(insertPosition);

    // Add a loading indicator with a visual cue
    const loadingText = `[🔄 Uploading ${file.name}...]`;
    this.content = `${textBefore}${loadingText}${textAfter}`;

    // Increment uploads in progress counter
    this.uploadsInProgress++;

    // Adjust spacing immediately to show loading indicator
    requestAnimationFrame(() => this.adjustChatSpacing());

    try {
      // Create a FormData object to send the file
      const formData = new FormData();
      formData.append("file", file);

      // Upload the file to the server using a relative path
      const response = await fetch("./upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();

      // Replace the loading placeholder with the actual file path
      this.content = this.content.replace(loadingText, `[${data.path}]`);

      return data.path;
    } catch (error) {
      console.error("Failed to upload file:", error);

      // Replace loading indicator with error message
      const errorText = `[Upload failed: ${error.message}]`;
      this.content = this.content.replace(loadingText, errorText);

      // Adjust spacing to show error message
      requestAnimationFrame(() => {
        this.adjustChatSpacing();
        this.chatInput.focus();
      });

      throw error;
    } finally {
      // Always decrement the counter, even if there was an error
      this.uploadsInProgress--;
    }
  }

  // Handle paste events for files (including images)
  private _handlePaste = async (event: ClipboardEvent) => {
    // Check if the clipboard contains files
    if (event.clipboardData && event.clipboardData.files.length > 0) {
      const file = event.clipboardData.files[0];

      // Handle the file upload (for any file type, not just images)
      event.preventDefault(); // Prevent default paste behavior

      // Get the current cursor position
      const cursorPos = this.chatInput.selectionStart;
      await this._uploadFile(file, cursorPos);
    }
  };

  // Handle drag events for file drop operation
  private _handleDragOver(event: DragEvent) {
    event.preventDefault(); // Necessary to allow dropping
    event.stopPropagation();
  }

  private _handleDragEnter(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver = true;
  }

  private _handleDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    // Only set to false if we're leaving the container (not entering a child element)
    if (event.target === this.renderRoot.querySelector(".chat-container")) {
      this.isDraggingOver = false;
    }
  }

  private _handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver = false;

    // Check if the dataTransfer contains files
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      // Process all dropped files
      for (let i = 0; i < event.dataTransfer.files.length; i++) {
        const file = event.dataTransfer.files[i];
        try {
          // For the first file, insert at the cursor position
          // For subsequent files, append at the end of the content
          const insertPosition =
            i === 0 ? this.chatInput.selectionStart : this.content.length;
          await this._uploadFile(file, insertPosition);

          // Add a space between multiple files
          if (i < event.dataTransfer.files.length - 1) {
            this.content += " ";
          }
        } catch (error) {
          // Error already handled in _uploadFile
          console.error("Failed to process dropped file:", error);
          // Continue with the next file
        }
      }
    }
  };

  private _handleDiffComment(event: CustomEvent) {
    const { comment } = event.detail;
    if (!comment) return;

    if (this.content != "") {
      this.content += "\n\n";
    }
    this.content += comment;
    requestAnimationFrame(() => this.adjustChatSpacing());
  }

  private _handleTodoComment(event: CustomEvent) {
    const { comment } = event.detail;
    if (!comment) return;

    if (this.content != "") {
      this.content += "\n\n";
    }
    this.content += comment;
    requestAnimationFrame(() => this.adjustChatSpacing());
  }

  // See https://lit.dev/docs/components/lifecycle/
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("diff-comment", this._handleDiffComment);
    window.removeEventListener("todo-comment", this._handleTodoComment);

    // Clean up drag and drop event listeners
    const container = this.renderRoot.querySelector(".chat-container");
    if (container) {
      container.removeEventListener("dragover", this._handleDragOver);
      container.removeEventListener("dragenter", this._handleDragEnter);
      container.removeEventListener("dragleave", this._handleDragLeave);
      container.removeEventListener("drop", this._handleDrop);
    }

    // Clean up paste event listener
    if (this.chatInput) {
      this.chatInput.removeEventListener("paste", this._handlePaste);
    }
  }

  sendChatMessage() {
    // Prevent sending if there are uploads in progress
    if (this.uploadsInProgress > 0) {
      console.log(
        `Message send prevented: ${this.uploadsInProgress} uploads in progress`,
      );

      // Show message to user
      this.showUploadInProgressMessage = true;

      // Hide the message after 3 seconds
      setTimeout(() => {
        this.showUploadInProgressMessage = false;
      }, 3000);

      return;
    }

    // Only send if there's actual content (not just whitespace)
    if (this.content.trim()) {
      const event = new CustomEvent("send-chat", {
        detail: { message: this.content },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);

      // TODO(philip?): Ideally we only clear the content if the send is successful.
      this.content = ""; // Clear content after sending
    }
  }

  adjustChatSpacing() {
    if (!this.chatInput) return;

    // Reset height to minimal value to correctly calculate scrollHeight
    this.chatInput.style.height = "auto";

    // Get the scroll height (content height)
    const scrollHeight = this.chatInput.scrollHeight;

    // Set the height to match content (up to max-height which is handled by CSS)
    this.chatInput.style.height = `${scrollHeight}px`;
  }

  async _sendChatClicked() {
    this.sendChatMessage();
    this.chatInput.focus(); // Refocus the input after sending
    // Reset height after sending a message
    requestAnimationFrame(() => this.adjustChatSpacing());
  }

  _chatInputKeyDown(event: KeyboardEvent) {
    // Send message if Enter is pressed without Shift key
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); // Prevent default newline
      this.sendChatMessage();
    }
  }

  _chatInputChanged(event) {
    this.content = event.target.value;
    // Use requestAnimationFrame to ensure DOM updates have completed
    requestAnimationFrame(() => this.adjustChatSpacing());
  }

  @query("#chatInput")
  chatInput: HTMLTextAreaElement;

  protected firstUpdated(): void {
    if (this.chatInput) {
      this.chatInput.focus();
      // Initialize the input height
      this.adjustChatSpacing();

      // Add paste event listener for image handling
      this.chatInput.addEventListener("paste", this._handlePaste);

      // Add drag and drop event listeners
      const container = this.renderRoot.querySelector(".chat-container");
      if (container) {
        container.addEventListener("dragover", this._handleDragOver);
        container.addEventListener("dragenter", this._handleDragEnter);
        container.addEventListener("dragleave", this._handleDragLeave);
        container.addEventListener("drop", this._handleDrop);
      }
    }

    // Add window.onload handler to ensure the input is focused when the page fully loads
    window.addEventListener(
      "load",
      () => {
        if (this.chatInput) {
          this.chatInput.focus();
        }
      },
      { once: true },
    );
  }

  render() {
    return html`
      <div class="chat-container">
        <div class="chat-input-wrapper">
          <textarea
            id="chatInput"
            placeholder="Type your message here and press Enter to send..."
            autofocus
            @keydown="${this._chatInputKeyDown}"
            @input="${this._chatInputChanged}"
            .value=${this.content || ""}
          ></textarea>
          <button
            @click="${this._sendChatClicked}"
            id="sendChatButton"
            ?disabled=${this.uploadsInProgress > 0}
          >
            ${this.uploadsInProgress > 0 ? "Uploading..." : "Send"}
          </button>
        </div>
        ${this.isDraggingOver
          ? html`
              <div class="drop-zone-overlay">
                <div class="drop-zone-message">Drop files here</div>
              </div>
            `
          : ""}
        ${this.showUploadInProgressMessage
          ? html`
              <div class="upload-progress-message">
                Please wait for file upload to complete before sending
              </div>
            `
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-chat-input": SketchChatInput;
  }
}
