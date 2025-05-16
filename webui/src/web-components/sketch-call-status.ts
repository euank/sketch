import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

@customElement("sketch-call-status")
export class SketchCallStatus extends LitElement {
  @property()
  llmCalls: number = 0;

  @property()
  toolCalls: string[] = [];

  @property()
  agentState: string | null = null;

  @property()
  isIdle: boolean = false;
  
  @property()
  isDisconnected: boolean = false;

  static styles = css`
    @keyframes gentle-pulse {
      0% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.15);
        opacity: 0.8;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    .call-status-container {
      display: flex;
      position: relative;
      align-items: center;
      padding: 0 10px;
    }

    .indicators-container {
      display: flex;
      align-items: center;
      gap: 10px;
      position: relative;
    }

    .indicator {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 32px;
      height: 32px;
      border-radius: 4px;
      transition: all 0.2s ease;
      position: relative;
    }

    /* LLM indicator (lightbulb) */
    .llm-indicator {
      background-color: transparent;
      color: #9ca3af; /* Gray when inactive */
    }

    .llm-indicator.active {
      background-color: #fef3c7; /* Light yellow */
      color: #f59e0b; /* Yellow/amber when active */
      animation: gentle-pulse 1.5s infinite ease-in-out;
    }

    /* Tool indicator (wrench) */
    .tool-indicator {
      background-color: transparent;
      color: #9ca3af; /* Gray when inactive */
    }

    .tool-indicator.active {
      background-color: #dbeafe; /* Light blue */
      color: #3b82f6; /* Blue when active */
      animation: gentle-pulse 1.5s infinite ease-in-out;
    }

    svg {
      width: 20px;
      height: 20px;
    }

    .status-banner {
      position: absolute;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.5px;
      width: 104px; /* Wider to accommodate DISCONNECTED text */
      left: 50%;
      transform: translateX(-50%);
      top: 60%; /* Position a little below center */
      z-index: 10; /* Ensure it appears above the icons */
      opacity: 0.9;
    }

    .status-working {
      background-color: #ffeecc;
      color: #e65100;
    }

    .status-idle {
      background-color: #e6f4ea;
      color: #0d652d;
    }
    
    .status-disconnected {
      background-color: #ffebee; /* Light red */
      color: #d32f2f; /* Red */
      font-weight: bold;
    }
  `;

  render() {
    const lightbulbSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path>
      <path d="M9 18h6"></path>
      <path d="M10 22h4"></path>
    </svg>`;

    const wrenchSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
    </svg>`;

    const agentState = `${this.agentState ? " (" + this.agentState + ")" : ""}`;

    // Determine state - disconnected takes precedence, then working vs idle
    let statusClass = "status-idle";
    let statusText = "IDLE";
    
    if (this.isDisconnected) {
      statusClass = "status-disconnected";
      statusText = "DISCONNECTED";
    } else if (!this.isIdle) {
      statusClass = "status-working";
      statusText = "WORKING";
    }

    return html`
      <div class="call-status-container">
        <div class="indicators-container">
          <div
            class="indicator llm-indicator ${this.llmCalls > 0 ? "active" : ""}"
            title="${this.llmCalls > 0
              ? `${this.llmCalls} LLM ${this.llmCalls === 1 ? "call" : "calls"} in progress`
              : "No LLM calls in progress"}${agentState}"
          >
            ${unsafeHTML(lightbulbSVG)}
          </div>
          <div
            class="indicator tool-indicator ${this.toolCalls.length > 0
              ? "active"
              : ""}"
            title="${this.toolCalls.length > 0
              ? `${this.toolCalls.length} tool ${this.toolCalls.length === 1 ? "call" : "calls"} in progress: ${this.toolCalls.join(", ")}`
              : "No tool calls in progress"}${agentState}"
          >
            ${unsafeHTML(wrenchSVG)}
          </div>
        </div>
        <div
          class="status-banner ${statusClass}"
        >
          ${statusText}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-call-status": SketchCallStatus;
  }
}
