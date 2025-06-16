import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ConnectionStatus } from "../data";

@customElement("mobile-title")
export class MobileTitle extends LitElement {
  @property({ type: String })
  connectionStatus: ConnectionStatus = "disconnected";

  @property({ type: Boolean })
  isThinking = false;

  @property({ type: String })
  skabandAddr?: string;

  @property({ type: String })
  currentView: "chat" | "diff" = "chat";

  static styles = css`
    :host {
      display: block;
      background-color: #f8f9fa;
      border-bottom: 1px solid #e9ecef;
      padding: 12px 16px;
    }

    .title-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .right-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .view-selector {
      background: none;
      border: 1px solid #e9ecef;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #495057;
      min-width: 60px;
    }

    .view-selector:hover {
      background-color: #f8f9fa;
      border-color: #dee2e6;
    }

    .view-selector:focus {
      outline: none;
      border-color: #007acc;
      box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
    }

    .title {
      font-size: 18px;
      font-weight: 600;
      color: #212529;
      margin: 0;
    }

    .title a {
      color: inherit;
      text-decoration: none;
      transition: opacity 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title a:hover {
      opacity: 0.8;
      text-decoration: underline;
    }

    .title img {
      width: 18px;
      height: 18px;
      border-radius: 3px;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.connected {
      background-color: #28a745;
    }

    .status-dot.connecting {
      background-color: #ffc107;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .status-dot.disconnected {
      background-color: #dc3545;
    }

    .thinking-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #6c757d;
      font-size: 13px;
    }

    .thinking-dots {
      display: flex;
      gap: 2px;
    }

    .thinking-dot {
      width: 4px;
      height: 4px;
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

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }

    @keyframes thinking {
      0%,
      80%,
      100% {
        transform: scale(0);
      }
      40% {
        transform: scale(1);
      }
    }
  `;

  private getStatusText() {
    switch (this.connectionStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Disconnected";
      default:
        return "Unknown";
    }
  }

  private handleViewChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const view = select.value as "chat" | "diff";
    if (view !== this.currentView) {
      const changeEvent = new CustomEvent("view-change", {
        detail: { view },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(changeEvent);
    }
  }

  render() {
    return html`
      <div class="title-container">
        <h1 class="title">
          ${this.skabandAddr
            ? html`<a
                href="${this.skabandAddr}"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img src="${this.skabandAddr}/sketch.dev.png" alt="sketch" />
                Sketch
              </a>`
            : html`Sketch`}
        </h1>

        <div class="right-section">
          <select
            class="view-selector"
            .value=${this.currentView}
            @change=${this.handleViewChange}
          >
            <option value="chat">Chat</option>
            <option value="diff">Diff</option>
          </select>

          ${this.isThinking
            ? html`
                <div class="thinking-indicator">
                  <span>thinking</span>
                  <div class="thinking-dots">
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                  </div>
                </div>
              `
            : html`
                <span class="status-dot ${this.connectionStatus}"></span>
              `}
        </div>
      </div>
    `;
  }
}
