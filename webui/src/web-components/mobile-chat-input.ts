import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";

@customElement("mobile-chat-input")
export class MobileChatInput extends LitElement {
  @property({ type: Boolean })
  disabled = false;

  @state()
  private inputValue = "";

  @state()
  private uploadsInProgress = 0;

  @state()
  private showUploadProgress = false;

  private textareaRef = createRef<HTMLTextAreaElement>();

  static styles = css`
    :host {
      display: block;
      background-color: #ffffff;
      border-top: 1px solid #e9ecef;
      padding: 12px 16px;
      /* Enhanced iOS safe area support */
      padding-bottom: max(12px, env(safe-area-inset-bottom));
      padding-left: max(16px, env(safe-area-inset-left));
      padding-right: max(16px, env(safe-area-inset-right));
      /* Prevent iOS Safari from covering the input */
      position: relative;
      z-index: 1000;
    }

    .input-container {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      max-width: 100%;
    }

    .input-wrapper {
      flex: 1;
      position: relative;
      min-width: 0;
    }

    textarea {
      width: 100%;
      min-height: 40px;
      max-height: 120px;
      padding: 12px 16px;
      border: 1px solid #ddd;
      border-radius: 20px;
      font-size: 16px;
      font-family: inherit;
      line-height: 1.4;
      resize: none;
      outline: none;
      background-color: #f8f9fa;
      transition:
        border-color 0.2s,
        background-color 0.2s;
      box-sizing: border-box;
    }

    textarea:focus {
      border-color: #007bff;
      background-color: #ffffff;
    }

    textarea:disabled {
      background-color: #e9ecef;
      color: #6c757d;
      cursor: not-allowed;
    }

    textarea::placeholder {
      color: #6c757d;
    }

    .send-button {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      background-color: #007bff;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition:
        background-color 0.2s,
        transform 0.1s;
      outline: none;
    }

    .send-button:hover:not(:disabled) {
      background-color: #0056b3;
    }

    .send-button:active:not(:disabled) {
      transform: scale(0.95);
    }

    .send-button:disabled {
      background-color: #6c757d;
      cursor: not-allowed;
      opacity: 0.6;
    }

    .send-icon {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }

    /* iOS specific adjustments */
    @supports (-webkit-touch-callout: none) {
      textarea {
        font-size: 16px; /* Prevent zoom on iOS */
      }
    }

    /* Upload progress indicator */
    .upload-progress {
      position: absolute;
      top: -30px;
      left: 50%;
      transform: translateX(-50%);
      background-color: #fff9c4;
      color: #856404;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      z-index: 1000;
    }
  `;

  private handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    this.inputValue = target.value;
    this.adjustTextareaHeight();
  };

  private handlePaste = async (e: ClipboardEvent) => {
    // Check if the clipboard contains files
    if (e.clipboardData && e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];

      // Handle the file upload
      e.preventDefault(); // Prevent default paste behavior

      // Get the current cursor position
      const textarea = this.textareaRef.value;
      const cursorPos = textarea
        ? textarea.selectionStart
        : this.inputValue.length;
      await this.uploadFile(file, cursorPos);
    }
  };

  // Utility function to handle file uploads
  private async uploadFile(file: File, insertPosition: number) {
    // Insert a placeholder at the cursor position
    const textBefore = this.inputValue.substring(0, insertPosition);
    const textAfter = this.inputValue.substring(insertPosition);

    // Add a loading indicator
    const loadingText = `[🔄 Uploading ${file.name}...]`;
    this.inputValue = `${textBefore}${loadingText}${textAfter}`;

    // Increment uploads in progress counter
    this.uploadsInProgress++;
    this.showUploadProgress = true;

    // Adjust spacing immediately to show loading indicator
    this.adjustTextareaHeight();

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
      this.inputValue = this.inputValue.replace(loadingText, `[${data.path}]`);

      return data.path;
    } catch (error) {
      console.error("Failed to upload file:", error);

      // Replace loading indicator with error message
      const errorText = `[Upload failed: ${error.message}]`;
      this.inputValue = this.inputValue.replace(loadingText, errorText);

      throw error;
    } finally {
      // Always decrement the counter, even if there was an error
      this.uploadsInProgress--;
      if (this.uploadsInProgress === 0) {
        this.showUploadProgress = false;
      }
      this.adjustTextareaHeight();
      if (this.textareaRef.value) {
        this.textareaRef.value.focus();
      }
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // On mobile, allow Enter key to create new lines
    // Users should use the Send button explicitly to send messages
    // This allows for better multi-line message composition on mobile devices
  };

  private adjustTextareaHeight() {
    if (this.textareaRef.value) {
      const textarea = this.textareaRef.value;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    }
  }

  private sendMessage = () => {
    // Prevent sending if there are uploads in progress
    if (this.uploadsInProgress > 0) {
      console.log(
        `Message send prevented: ${this.uploadsInProgress} uploads in progress`,
      );
      return;
    }

    const message = this.inputValue.trim();
    if (message && !this.disabled) {
      this.dispatchEvent(
        new CustomEvent("send-message", {
          detail: { message },
          bubbles: true,
          composed: true,
        }),
      );

      this.inputValue = "";
      if (this.textareaRef.value) {
        this.textareaRef.value.value = "";
        this.adjustTextareaHeight();
        this.textareaRef.value.focus();
      }
    }
  };

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);
    this.adjustTextareaHeight();

    // Add paste event listener when component updates
    if (this.textareaRef.value && !this.textareaRef.value.onpaste) {
      this.textareaRef.value.addEventListener("paste", this.handlePaste);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up paste event listener
    if (this.textareaRef.value) {
      this.textareaRef.value.removeEventListener("paste", this.handlePaste);
    }
  }

  render() {
    const canSend =
      this.inputValue.trim().length > 0 &&
      !this.disabled &&
      this.uploadsInProgress === 0;

    return html`
      <div class="input-container">
        <div class="input-wrapper">
          <textarea
            ${ref(this.textareaRef)}
            .value=${this.inputValue}
            @input=${this.handleInput}
            @keydown=${this.handleKeyDown}
            placeholder="Type your message here and tap Send..."
            ?disabled=${this.disabled || this.uploadsInProgress > 0}
            rows="1"
          ></textarea>

          ${this.showUploadProgress
            ? html`
                <div class="upload-progress">
                  Uploading ${this.uploadsInProgress}
                  file${this.uploadsInProgress > 1 ? "s" : ""}...
                </div>
              `
            : ""}
        </div>

        <button
          class="send-button"
          @click=${this.sendMessage}
          ?disabled=${!canSend}
          title=${this.uploadsInProgress > 0
            ? "Please wait for upload to complete"
            : "Send message"}
        >
          ${this.uploadsInProgress > 0
            ? html`<span style="font-size: 12px;">⏳</span>`
            : html`<svg class="send-icon" viewBox="0 0 24 24">
                <path d="M2,21L23,12L2,3V10L17,12L2,14V21Z" />
              </svg>`}
        </button>
      </div>
    `;
  }
}
