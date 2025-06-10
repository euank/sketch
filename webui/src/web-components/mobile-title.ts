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
  slug?: string;

  @property({ type: Boolean })
  linkToGitHub = false;

  @property({ type: String })
  gitOrigin?: string;

  @property({ type: String })
  pushedBranch?: string;

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

    .title {
      font-size: 18px;
      font-weight: 600;
      color: #212529;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .slug {
      font-size: 14px;
      font-weight: 400;
      color: #6c757d;
      background-color: #e9ecef;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 4px;
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

    .octocat-link {
      color: #586069;
      text-decoration: none;
      display: flex;
      align-items: center;
      transition: color 0.2s ease;
      margin-left: 4px;
    }

    .octocat-link:hover {
      color: #0366d6;
    }

    .octocat-icon {
      width: 16px;
      height: 16px;
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

  // Format GitHub repository information
  private formatGitHubRepo(url?: string) {
    if (!url) return null;

    // Common GitHub URL patterns
    const patterns = [
      // HTTPS URLs
      /https:\/\/github\.com\/([^/]+)\/([^/\s.]+)(?:\.git)?/,
      // SSH URLs
      /git@github\.com:([^/]+)\/([^/\s.]+)(?:\.git)?/,
      // Git protocol
      /git:\/\/github\.com\/([^/]+)\/([^/\s.]+)(?:\.git)?/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          formatted: `${match[1]}/${match[2]}`,
          url: `https://github.com/${match[1]}/${match[2]}`,
          owner: match[1],
          repo: match[2],
        };
      }
    }

    return null;
  }

  // Generate GitHub branch URL if linking is enabled
  private getGitHubBranchLink(branchName?: string) {
    if (!this.linkToGitHub || !branchName) {
      return null;
    }

    const github = this.formatGitHubRepo(this.gitOrigin);
    if (!github) {
      return null;
    }

    return `https://github.com/${github.owner}/${github.repo}/tree/${branchName}`;
  }

  render() {
    const githubLink = this.getGitHubBranchLink(this.pushedBranch);
    
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
          ${this.slug ? html`<span class="slug">${this.slug}</span>` : ""}
          ${githubLink
            ? html`<a
                href="${githubLink}"
                target="_blank"
                rel="noopener noreferrer"
                class="octocat-link"
                title="Open ${this.pushedBranch} on GitHub"
              >
                <svg
                  class="octocat-icon"
                  viewBox="0 0 16 16"
                  width="16"
                  height="16"
                >
                  <path
                    fill="currentColor"
                    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                  />
                </svg>
              </a>`
            : ""}
        </h1>

        <div class="status-indicator">
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
                <span>${this.getStatusText()}</span>
              `}
        </div>
      </div>
    `;
  }
}
