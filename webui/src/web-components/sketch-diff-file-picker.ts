// sketch-diff-file-picker.ts
// Component for selecting files from a diff

import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GitDiffFile } from "./git-data-service";

/**
 * Component for selecting files from a diff with next/previous navigation
 */
@customElement("sketch-diff-file-picker")
export class SketchDiffFilePicker extends LitElement {
  @property({ type: Array })
  files: GitDiffFile[] = [];

  @property({ type: String })
  selectedPath: string = "";



  @state()
  private selectedIndex: number = -1;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      font-family: var(--font-family, system-ui, sans-serif);
    }

    .file-picker {
      display: flex;
      gap: 8px;
      align-items: center;
      background-color: var(--background-light, #f8f8f8);
      border-radius: 4px;
      border: 1px solid var(--border-color, #e0e0e0);
      padding: 8px 12px;
      width: 100%;
      box-sizing: border-box;
    }

    .file-select {
      flex: 1;
      min-width: 200px;
      max-width: calc(
        100% - 230px
      ); /* Leave space for the navigation buttons and file info */
      overflow: hidden;
    }

    select {
      width: 100%;
      max-width: 100%;
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid var(--border-color, #e0e0e0);
      background-color: white;
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .navigation-buttons {
      display: flex;
      gap: 8px;
    }

    button {
      padding: 8px 12px;
      background-color: var(--button-bg, #4a7dfc);
      color: var(--button-text, white);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.2s;
    }

    button:hover {
      background-color: var(--button-hover, #3a6eee);
    }

    button:disabled {
      background-color: var(--button-disabled, #cccccc);
      cursor: not-allowed;
    }

    .file-position {
      font-size: 14px;
      color: var(--text-muted, #666);
      font-weight: 500;
      padding: 0 12px;
      display: flex;
      align-items: center;
      white-space: nowrap;
    }

    .no-files {
      color: var(--text-muted, #666);
      font-style: italic;
    }

    @media (max-width: 768px) {
      .file-picker {
        flex-direction: column;
        align-items: stretch;
      }

      .file-select {
        max-width: 100%; /* Full width on small screens */
        margin-bottom: 8px;
      }

      .navigation-buttons {
        width: 100%;
        justify-content: space-between;
      }

      .file-info {
        margin-left: 0;
        margin-top: 8px;
        text-align: center;
      }
    }
  `;

  updated(changedProperties: Map<string, any>) {
    // If files changed, reset the selection
    if (changedProperties.has("files")) {
      this.updateSelectedIndex();
    }

    // If selectedPath changed externally, update the index
    if (changedProperties.has("selectedPath")) {
      this.updateSelectedIndex();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Initialize the selection when the component is connected, but only if files exist
    if (this.files && this.files.length > 0) {
      this.updateSelectedIndex();

      // Explicitly trigger file selection event for the first file when there's only one file
      // This ensures the diff view is updated even when navigation buttons aren't clicked
      if (this.files.length === 1) {
        this.selectFileByIndex(0);
      }
    }
  }

  render() {
    if (!this.files || this.files.length === 0) {
      return html`<div class="no-files">No files to display</div>`;
    }

    return html`
      <div class="file-picker">
        <div class="file-select">
          <select @change=${this.handleSelect}>
            ${this.files.map(
              (file, index) => html`
                <option
                  value=${index}
                  ?selected=${index === this.selectedIndex}
                >
                  ${this.formatFileOption(file)}
                </option>
              `,
            )}
          </select>
        </div>

        <div class="navigation-buttons">
          <button
            @click=${this.handlePrevious}
            ?disabled=${this.selectedIndex <= 0}
          >
            Previous
          </button>
          ${this.selectedIndex >= 0 ? this.renderFilePosition() : ""}
          <button
            @click=${this.handleNext}
            ?disabled=${this.selectedIndex >= this.files.length - 1}
          >
            Next
          </button>
        </div>
      </div>
    `;
  }

  renderFilePosition() {
    return html`
      <div class="file-position">
        ${this.selectedIndex + 1} of ${this.files.length}
      </div>
    `;
  }



  /**
   * Format a file for display in the dropdown
   */
  formatFileOption(file: GitDiffFile): string {
    const statusSymbol = this.getFileStatusSymbol(file.status);
    const changesInfo = this.getChangesInfo(file);
    return `${statusSymbol} ${file.path}${changesInfo}`;
  }

  /**
   * Get changes information (+/-) for display
   */
  getChangesInfo(file: GitDiffFile): string {
    const additions = file.additions || 0;
    const deletions = file.deletions || 0;
    
    if (additions === 0 && deletions === 0) {
      return "";
    }
    
    const parts = [];
    if (additions > 0) {
      parts.push(`+${additions}`);
    }
    if (deletions > 0) {
      parts.push(`-${deletions}`);
    }
    
    return ` (${parts.join(", ")})`;
  }

  /**
   * Get a short symbol for the file status
   */
  getFileStatusSymbol(status: string): string {
    switch (status.toUpperCase()) {
      case "A":
        return "+";
      case "M":
        return "M";
      case "D":
        return "-";
      case "R":
        return "R";
      default:
        return "?";
    }
  }

  /**
   * Get a descriptive name for the file status
   */
  getFileStatusName(status: string): string {
    switch (status.toUpperCase()) {
      case "A":
        return "Added";
      case "M":
        return "Modified";
      case "D":
        return "Deleted";
      case "R":
        return "Renamed";
      default:
        return "Unknown";
    }
  }

  /**
   * Handle file selection from dropdown
   */
  handleSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    const index = parseInt(select.value, 10);
    this.selectFileByIndex(index);
  }

  /**
   * Handle previous button click
   */
  handlePrevious() {
    if (this.selectedIndex > 0) {
      this.selectFileByIndex(this.selectedIndex - 1);
    }
  }

  /**
   * Handle next button click
   */
  handleNext() {
    if (this.selectedIndex < this.files.length - 1) {
      this.selectFileByIndex(this.selectedIndex + 1);
    }
  }

  /**
   * Select a file by index and dispatch event
   */
  selectFileByIndex(index: number) {
    if (index >= 0 && index < this.files.length) {
      this.selectedIndex = index;
      this.selectedPath = this.files[index].path;

      const event = new CustomEvent("file-selected", {
        detail: { file: this.files[index] },
        bubbles: true,
        composed: true,
      });

      this.dispatchEvent(event);
    }
  }

  /**
   * Update the selected index based on the selectedPath
   */
  private updateSelectedIndex() {
    // Add defensive check for files array
    if (!this.files || this.files.length === 0) {
      this.selectedIndex = -1;
      return;
    }

    if (this.selectedPath) {
      // Find the file with the matching path
      const index = this.files.findIndex(
        (file) => file.path === this.selectedPath,
      );
      if (index >= 0) {
        this.selectedIndex = index;
        return;
      }
    }

    // Default to first file if no match or no path
    this.selectedIndex = 0;
    const newSelectedPath = this.files[0].path;

    // Only dispatch event if the path has actually changed and files exist
    if (
      this.selectedPath !== newSelectedPath &&
      this.files &&
      this.files.length > 0
    ) {
      this.selectedPath = newSelectedPath;

      // Dispatch the event directly - we've already checked the files array
      const event = new CustomEvent("file-selected", {
        detail: { file: this.files[0] },
        bubbles: true,
        composed: true,
      });

      this.dispatchEvent(event);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff-file-picker": SketchDiffFilePicker;
  }
}
