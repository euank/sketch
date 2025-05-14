import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * DiffFile interface representing a file in the diff
 */
export interface DiffFile {
  path: string;
  changeType: string; // 'A' (added), 'M' (modified), 'D' (deleted), 'R' (renamed)
  status?: string;
  oldPath?: string; // For renamed files
}

/**
 * Component for navigating between files in a diff
 */
@customElement("sketch-diff-navigation")
export class SketchDiffNavigation extends LitElement {
  @property({ type: Array })
  files: DiffFile[] = [];

  @property({ type: String })
  selectedFilePath: string = "";

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-family, system-ui, sans-serif);
      border-right: 1px solid var(--border-color, #e0e0e0);
      overflow-y: auto;
      height: 100%;
    }

    .nav-title {
      padding: 12px 16px;
      font-weight: 500;
      border-bottom: 1px solid var(--border-color, #e0e0e0);
      background-color: var(--background-light, #f5f5f5);
      margin: 0;
    }

    .file-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .file-item {
      padding: 8px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--border-color-light, #f0f0f0);
    }

    .file-item:hover {
      background-color: var(--hover-color, #f0f0f0);
    }

    .file-item.selected {
      background-color: var(--selected-color, #e6f7ff);
      font-weight: 500;
    }

    .file-icon {
      margin-right: 8px;
      color: var(--icon-color, #666);
    }

    .change-type {
      margin-right: 8px;
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-size: 10px;
      font-weight: bold;
    }

    .change-type.added {
      background-color: var(--added-color, #b6ffb6);
      color: var(--added-text-color, #0a6b0a);
    }

    .change-type.modified {
      background-color: var(--modified-color, #fff8c5);
      color: var(--modified-text-color, #735c0f);
    }

    .change-type.deleted {
      background-color: var(--deleted-color, #ffd7d5);
      color: var(--deleted-text-color, #b31d28);
    }

    .change-type.renamed {
      background-color: var(--renamed-color, #d0e8ff);
      color: var(--renamed-text-color, #0366d6);
    }

    .file-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  render() {
    return html`
      <h3 class="nav-title">Changed Files</h3>
      <ul class="file-list">
        ${this.renderFileList()}
      </ul>
    `;
  }

  renderFileList() {
    if (!this.files || this.files.length === 0) {
      return html`<li class="file-item">No files changed</li>`;
    }

    return this.files.map(
      (file) => html`
        <li
          class="file-item ${file.path === this.selectedFilePath ? 'selected' : ''}"
          @click="${() => this.selectFile(file)}"
        >
          <span class="change-type ${file.changeType.toLowerCase()}">
            ${this.getChangeTypeShort(file.changeType)}
          </span>
          <span class="file-path">${file.path}</span>
        </li>
      `
    );
  }

  /**
   * Get a short representation of the change type
   */
  getChangeTypeShort(changeType: string): string {
    switch (changeType.toUpperCase()) {
      case 'A': return 'A';
      case 'M': return 'M';
      case 'D': return 'D';
      case 'R': return 'R';
      default: return '?';
    }
  }

  /**
   * Handle file selection and dispatch a custom event
   */
  selectFile(file: DiffFile) {
    this.selectedFilePath = file.path;
    
    const event = new CustomEvent('file-selected', {
      detail: { file },
      bubbles: true,
      composed: true
    });
    
    this.dispatchEvent(event);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff-navigation": SketchDiffNavigation;
  }
}
