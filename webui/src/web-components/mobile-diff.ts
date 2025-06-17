import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GitDiffFile, GitDataService, DefaultGitDataService } from "./git-data-service";
import "./sketch-monaco-view";

@customElement("mobile-diff")
export class MobileDiff extends LitElement {
  private gitService: GitDataService = new DefaultGitDataService();

  @state()
  private files: GitDiffFile[] = [];

  @state()
  private fileContents: Map<string, { original: string; modified: string }> = new Map();

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  private baseCommit: string = "";

  @state()
  private fileExpandStates: Map<string, boolean> = new Map();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background-color: #ffffff;
    }



    .diff-container {
      flex: 1;
      overflow: auto;
      min-height: 0;
      /* Ensure proper scrolling behavior */
      -webkit-overflow-scrolling: touch;
    }

    .loading,
    .error,
    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: 16px;
      color: #6c757d;
      text-align: center;
      padding: 20px;
    }

    .error {
      color: #dc3545;
    }

    .file-diff {
      margin-bottom: 16px;
    }

    .file-diff:last-child {
      margin-bottom: 0;
    }

    .file-header {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-bottom: none;
      padding: 12px 16px;
      font-family: monospace;
      font-size: 14px;
      font-weight: 500;
      color: #495057;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .file-status {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
      font-family: sans-serif;
    }

    .file-status.added {
      background-color: #d4edda;
      color: #155724;
    }

    .file-status.modified {
      background-color: #fff3cd;
      color: #856404;
    }

    .file-status.deleted {
      background-color: #f8d7da;
      color: #721c24;
    }

    .file-status.renamed {
      background-color: #d1ecf1;
      color: #0c5460;
    }

    .file-changes {
      margin-left: 8px;
      font-size: 12px;
      color: #6c757d;
    }

    .monaco-container {
      border: 1px solid #e9ecef;
      border-top: none;
      min-height: 200px;
      /* Prevent artifacts */
      overflow: hidden;
      background-color: #ffffff;
    }

    sketch-monaco-view {
      width: 100%;
      min-height: 200px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadDiffData();
  }

  private async loadDiffData() {
    this.loading = true;
    this.error = null;
    this.files = [];
    this.fileContents.clear();

    try {
      // Get base commit reference
      this.baseCommit = await this.gitService.getBaseCommitRef();
      
      // Get diff from base commit to untracked changes (empty string for working directory)
      this.files = await this.gitService.getDiff(this.baseCommit, "");

      // Ensure files is always an array
      if (!this.files) {
        this.files = [];
      }

      if (this.files.length > 0) {
        await this.loadAllFileContents();
      }
    } catch (error) {
      console.error("Error loading diff data:", error);
      this.error = `Error loading diff: ${error instanceof Error ? error.message : String(error)}`;
      // Ensure files is always an array even on error
      this.files = [];
    } finally {
      this.loading = false;
    }
  }

  private async loadAllFileContents() {
    try {
      const promises = this.files.map(async (file) => {
        try {
          let originalCode = "";
          let modifiedCode = "";

          // Load original content (from the base commit)
          if (file.status !== "A") {
            // For modified, renamed, or deleted files: load original content
            originalCode = await this.gitService.getFileContent(file.old_hash || "");
          }

          // Load modified content (from working directory)
          if (file.status === "D") {
            // Deleted file: empty modified content
            modifiedCode = "";
          } else {
            // Added/modified/renamed: use working copy content
            try {
              modifiedCode = await this.gitService.getWorkingCopyContent(file.path);
            } catch (error) {
              console.warn(`Could not get working copy for ${file.path}:`, error);
              modifiedCode = "";
            }
          }

          this.fileContents.set(file.path, {
            original: originalCode,
            modified: modifiedCode,
          });
        } catch (error) {
          console.error(`Error loading content for file ${file.path}:`, error);
          // Store empty content for failed files
          this.fileContents.set(file.path, {
            original: "",
            modified: "",
          });
        }
      });

      await Promise.all(promises);
    } catch (error) {
      console.error("Error loading file contents:", error);
      throw error;
    }
  }

  private getFileStatusClass(status: string): string {
    switch (status.toUpperCase()) {
      case "A":
        return "added";
      case "M":
        return "modified";
      case "D":
        return "deleted";
      case "R":
      default:
        if (status.toUpperCase().startsWith("R")) {
          return "renamed";
        }
        return "modified";
    }
  }

  private getFileStatusText(status: string): string {
    switch (status.toUpperCase()) {
      case "A":
        return "Added";
      case "M":
        return "Modified";
      case "D":
        return "Deleted";
      case "R":
      default:
        if (status.toUpperCase().startsWith("R")) {
          return "Renamed";
        }
        return "Modified";
    }
  }

  private getChangesInfo(file: GitDiffFile): string {
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

    return `(${parts.join(", ")})`;
  }

  private getPathInfo(file: GitDiffFile): string {
    if (file.old_path && file.old_path !== "") {
      // For renames, show old_path → new_path
      return `${file.old_path} → ${file.path}`;
    }
    // For regular files, just show the path
    return file.path;
  }

  private toggleFileExpansion(filePath: string) {
    const currentState = this.fileExpandStates.get(filePath) ?? false;
    const newState = !currentState;
    this.fileExpandStates.set(filePath, newState);

    // Apply to the specific Monaco view component for this file
    const monacoView = this.shadowRoot?.querySelector(
      `sketch-monaco-view[data-file-path="${filePath}"]`,
    );
    if (monacoView) {
      (monacoView as any).toggleHideUnchangedRegions(!newState); // inverted because true means "hide unchanged"
    }

    // Force a re-render to update the button state
    this.requestUpdate();
  }

  private renderExpandAllIcon() {
    return html`
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <!-- Dotted line in the middle -->
        <line
          x1="2"
          y1="8"
          x2="14"
          y2="8"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="2,1"
        />
        <!-- Large arrow pointing up -->
        <path d="M8 2 L5 6 L11 6 Z" fill="currentColor" />
        <!-- Large arrow pointing down -->
        <path d="M8 14 L5 10 L11 10 Z" fill="currentColor" />
      </svg>
    `;
  }

  private renderCollapseIcon() {
    return html`
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <!-- Dotted line in the middle -->
        <line
          x1="2"
          y1="8"
          x2="14"
          y2="8"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="2,1"
        />
        <!-- Large arrow pointing down towards line -->
        <path d="M8 6 L5 2 L11 2 Z" fill="currentColor" />
        <!-- Large arrow pointing up towards line -->
        <path d="M8 10 L5 14 L11 14 Z" fill="currentColor" />
      </svg>
    `;
  }

  private renderFileDiff(file: GitDiffFile) {
    const content = this.fileContents.get(file.path);
    const isExpanded = this.fileExpandStates.get(file.path) ?? false;
    
    if (!content) {
      return html`
        <div class="file-diff">
          <div class="file-header">
            <div class="file-header-left">
              <span class="file-status ${this.getFileStatusClass(file.status)}">
                ${this.getFileStatusText(file.status)}
              </span>
              ${this.getPathInfo(file)}
              ${this.getChangesInfo(file) ? html`<span class="file-changes">${this.getChangesInfo(file)}</span>` : ""}
            </div>
            <button class="file-expand-button" disabled>
              ${this.renderExpandAllIcon()}
            </button>
          </div>
          <div class="monaco-container">
            <div class="loading">Loading ${file.path}...</div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="file-diff">
        <div class="file-header">
          <div class="file-header-left">
            <span class="file-status ${this.getFileStatusClass(file.status)}">
              ${this.getFileStatusText(file.status)}
            </span>
            ${this.getPathInfo(file)}
            ${this.getChangesInfo(file) ? html`<span class="file-changes">${this.getChangesInfo(file)}</span>` : ""}
          </div>
          <button
            class="file-expand-button"
            @click="${() => this.toggleFileExpansion(file.path)}"
            title="${isExpanded
              ? "Collapse: Hide unchanged regions to focus on changes"
              : "Expand: Show all lines including unchanged regions"}"
          >
            ${isExpanded ? this.renderCollapseIcon() : this.renderExpandAllIcon()}
          </button>
        </div>
        <div class="monaco-container">
          <sketch-monaco-view
            .originalCode="${content.original}"
            .modifiedCode="${content.modified}"
            .originalFilename="${file.path}"
            .modifiedFilename="${file.path}"
            ?readOnly="true"
            ?inline="true"
            data-file-path="${file.path}"
          ></sketch-monaco-view>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="diff-container">
        ${this.loading
          ? html`<div class="loading">Loading diff...</div>`
          : this.error 
          ? html`<div class="error">${this.error}</div>`
          : !this.files || this.files.length === 0
          ? html`<div class="empty">No changes to show</div>`
          : this.files.map(file => this.renderFileDiff(file))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mobile-diff": MobileDiff;
  }
}