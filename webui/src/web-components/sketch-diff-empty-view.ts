import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * A component that displays helpful information when the diff view is empty
 */
@customElement("sketch-diff-empty-view")
export class SketchDiffEmptyView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
      box-sizing: border-box;
    }

    .empty-diff-box {
      margin: 2rem auto;
      max-width: 1200px;
      width: 90%;
      padding: 2rem;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
      background-color: #ffffff;
      text-align: center;
    }

    .empty-diff-title {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      text-align: center;
      color: #333;
    }

    .empty-diff-content {
      color: #666;
      line-height: 1.6;
      font-size: 1rem;
      text-align: left;
      margin-bottom: 1rem;
    }

    strong {
      font-weight: 600;
      color: #333;
    }
  `;

  render() {
    return html`
      <div class="empty-diff-box">
        <h2 class="empty-diff-title">How to use the Diff View</h2>
        
        <p class="empty-diff-content">
          By default, the diff view shows differences between when you started Sketch (the "sketch-base" tag) and the current state. Choose a commit to look at, or, a range of commits, and navigate across files.
        </p>

        <p class="empty-diff-content">
          You can select text to leave comments on the code. These will be added to your chat window, and you can click Send to send them along to the agent, which will respond in the chat window.
        </p>

        <p class="empty-diff-content">
          If the range includes <strong>Uncommitted Changes</strong>, you can <strong>edit</strong> the text as well, and it auto-saves. If you want to clear up a comment or write your own text, just go ahead and do it! Once you're done, though, be sure to commit your changes, either by asking the agent to do so or in the Terminal view.
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff-empty-view": SketchDiffEmptyView;
  }
}
