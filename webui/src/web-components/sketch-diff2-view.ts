import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./sketch-monaco-view";
import "./sketch-diff-range-picker";
// import "./sketch-diff-file-picker"; // No longer needed for multi-file view
import "./sketch-diff-empty-view";
import {
  GitDiffFile,
  GitDataService,
  DefaultGitDataService,
} from "./git-data-service";
import { DiffRange } from "./sketch-diff-range-picker";

/**
 * A component that displays diffs using Monaco editor with range and file pickers
 */
@customElement("sketch-diff2-view")
export class SketchDiff2View extends LitElement {
  /**
   * Handles comment events from the Monaco editor and forwards them to the chat input
   * using the same event format as the original diff view for consistency.
   */
  private handleMonacoComment(event: CustomEvent) {
    try {
      // Validate incoming data
      if (!event.detail || !event.detail.formattedComment) {
        console.error("Invalid comment data received");
        return;
      }

      // Create and dispatch event using the standardized format
      const commentEvent = new CustomEvent("diff-comment", {
        detail: { comment: event.detail.formattedComment },
        bubbles: true,
        composed: true,
      });

      this.dispatchEvent(commentEvent);
    } catch (error) {
      console.error("Error handling Monaco comment:", error);
    }
  }

  /**
   * Handle height change events from the Monaco editor
   */
  private handleMonacoHeightChange(event: CustomEvent) {
    try {
      // Get the monaco view that emitted the event
      const monacoView = event.target as HTMLElement;
      if (!monacoView) return;

      // Find the parent file-diff-editor container
      const fileDiffEditor = monacoView.closest(
        ".file-diff-editor",
      ) as HTMLElement;
      if (!fileDiffEditor) return;

      // Get the new height from the event
      const newHeight = event.detail.height;

      // Only update if the height actually changed to avoid unnecessary layout
      const currentHeight = fileDiffEditor.style.height;
      const newHeightStr = `${newHeight}px`;

      if (currentHeight !== newHeightStr) {
        // Update the file-diff-editor height to match monaco's height
        fileDiffEditor.style.height = newHeightStr;

        // Remove any previous min-height constraint that might interfere
        fileDiffEditor.style.minHeight = "auto";

        // IMPORTANT: Tell Monaco to relayout after its container size changed
        // Monaco has automaticLayout: false, so it won't detect container changes
        setTimeout(() => {
          const monacoComponent = monacoView as any;
          if (monacoComponent && monacoComponent.editor) {
            // Force layout with explicit dimensions to ensure Monaco fills the space
            const editorWidth = fileDiffEditor.offsetWidth;
            monacoComponent.editor.layout({
              width: editorWidth,
              height: newHeight,
            });
          }
        }, 0);
      }
    } catch (error) {
      console.error("Error handling Monaco height change:", error);
    }
  }

  /**
   * Handle save events from the Monaco editor
   */
  private async handleMonacoSave(event: CustomEvent) {
    try {
      // Validate incoming data
      if (
        !event.detail ||
        !event.detail.path ||
        event.detail.content === undefined
      ) {
        console.error("Invalid save data received");
        return;
      }

      const { path, content } = event.detail;

      // Get Monaco view component
      const monacoView = this.shadowRoot?.querySelector("sketch-monaco-view");
      if (!monacoView) {
        console.error("Monaco view not found");
        return;
      }

      try {
        await this.gitService?.saveFileContent(path, content);
        console.log(`File saved: ${path}`);
        (monacoView as any).notifySaveComplete(true);
      } catch (error) {
        console.error(
          `Error saving file: ${error instanceof Error ? error.message : String(error)}`,
        );
        (monacoView as any).notifySaveComplete(false);
      }
    } catch (error) {
      console.error("Error handling save:", error);
    }
  }

  /**
   * Handle delete events from the Monaco editor
   */
  private async handleMonacoDelete(event: CustomEvent) {
    try {
      // Validate incoming data
      if (!event.detail || !event.detail.path) {
        console.error("Invalid delete data received");
        return;
      }

      const { path } = event.detail;

      // Get Monaco view component that triggered the event
      const monacoView = event.target as any;
      if (!monacoView) {
        console.error("Monaco view not found");
        return;
      }

      try {
        await this.gitService?.deleteFile(path);
        console.log(`File deleted: ${path}`);
        monacoView.notifyDeleteComplete(true);
        
        // Refresh the diff view to show the updated state
        this.loadDiffData();
      } catch (error) {
        console.error(
          `Error deleting file: ${error instanceof Error ? error.message : String(error)}`,
        );
        monacoView.notifyDeleteComplete(false);
      }
    } catch (error) {
      console.error("Error handling delete:", error);
    }
  }
  @property({ type: String })
  initialCommit: string = "";

  // The commit to show - used when showing a specific commit from timeline
  @property({ type: String })
  commit: string = "";

  @property({ type: String })
  selectedFilePath: string = "";

  @state()
  private files: GitDiffFile[] = [];

  @state()
  private currentRange: DiffRange = { type: "range", from: "", to: "HEAD" };

  @state()
  private fileContents: Map<
    string,
    { original: string; modified: string; editable: boolean }
  > = new Map();

  @state()
  private fileExpandStates: Map<string, boolean> = new Map();

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  private selectedFile: string = ""; // Empty string means "All files"

  @state()
  private viewMode: "all" | "single" = "all";

  static styles = css`
    :host {
      display: flex;
      height: 100%;
      flex: 1;
      flex-direction: column;
      min-height: 0; /* Critical for flex child behavior */
      overflow: hidden;
      position: relative; /* Establish positioning context */
    }

    .controls {
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-color, #e0e0e0);
      background-color: var(--background-light, #f8f8f8);
      flex-shrink: 0; /* Prevent controls from shrinking */
    }

    .controls-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .range-row {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .file-selector-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-selector {
      min-width: 200px;
      padding: 8px 12px;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 4px;
      background-color: var(--background-color, #fff);
      font-family: var(--font-family, system-ui, sans-serif);
      font-size: 14px;
      cursor: pointer;
    }

    .file-selector:focus {
      outline: none;
      border-color: var(--accent-color, #007acc);
      box-shadow: 0 0 0 2px var(--accent-color-light, rgba(0, 122, 204, 0.2));
    }

    .file-selector:disabled {
      background-color: var(--background-disabled, #f5f5f5);
      color: var(--text-disabled, #999);
      cursor: not-allowed;
    }

    .spacer {
      flex: 1;
    }

    sketch-diff-range-picker {
      flex: 1;
      min-width: 400px; /* Ensure minimum width for range picker */
    }

    sketch-diff-file-picker {
      flex: 1;
    }

    .view-toggle-button,
    .header-expand-button {
      background-color: transparent;
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      min-height: 32px;
    }

    .view-toggle-button:hover,
    .header-expand-button:hover {
      background-color: var(--background-hover, #e8e8e8);
    }

    .diff-container {
      flex: 1;
      overflow: auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      position: relative;
      height: 100%;
    }

    .diff-content {
      flex: 1;
      overflow: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      position: relative;
      height: 100%;
    }

    .multi-file-diff-container {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 100%;
    }

    .file-diff-section {
      display: flex;
      flex-direction: column;
      border-bottom: 3px solid var(--border-color, #e0e0e0);
      margin-bottom: 0;
    }

    .file-diff-section:last-child {
      border-bottom: none;
    }

    .file-header {
      background-color: var(--background-light, #f8f8f8);
      border-bottom: 1px solid var(--border-color, #e0e0e0);
      padding: 8px 16px;
      font-family: var(--font-family, system-ui, sans-serif);
      font-weight: 500;
      font-size: 14px;
      color: var(--text-primary-color, #333);
      position: sticky;
      top: 0;
      z-index: 10;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .file-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-header-right {
      display: flex;
      align-items: center;
    }

    .file-expand-button {
      background-color: transparent;
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      min-height: 32px;
    }

    .file-expand-button:hover {
      background-color: var(--background-hover, #e8e8e8);
    }

    .file-path {
      font-family: monospace;
      font-weight: normal;
      color: var(--text-secondary-color, #666);
    }

    .file-status {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
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
      color: var(--text-secondary-color, #666);
    }

    .file-diff-editor {
      display: flex;
      flex-direction: column;
      min-height: 200px;
      /* Height will be set dynamically by monaco editor */
      overflow: visible; /* Ensure content is not clipped */
    }

    .loading,
    .empty-diff {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-family: var(--font-family, system-ui, sans-serif);
    }

    .empty-diff {
      color: var(--text-secondary-color, #666);
      font-size: 16px;
      text-align: center;
    }

    .error {
      color: var(--error-color, #dc3545);
      padding: 16px;
      font-family: var(--font-family, system-ui, sans-serif);
    }

    sketch-monaco-view {
      --editor-width: 100%;
      --editor-height: 100%;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 200px;
      /* Ensure Monaco view takes full container space */
      flex: 1;
    }

    /* Single file view styles */
    .single-file-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .single-file-monaco {
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
  `;

  @property({ attribute: false, type: Object })
  gitService!: GitDataService;

  // The gitService must be passed from parent to ensure proper dependency injection

  constructor() {
    super();
    console.log("SketchDiff2View initialized");

    // Fix for monaco-aria-container positioning and hide scrollbars globally
    // Add a global style to ensure proper positioning of aria containers and hide scrollbars
    const styleElement = document.createElement("style");
    styleElement.textContent = `
      .monaco-aria-container {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 1px !important;
        height: 1px !important;
        overflow: hidden !important;
        clip: rect(1px, 1px, 1px, 1px) !important;
        white-space: nowrap !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        z-index: -1 !important;
      }
      
      /* Aggressively hide all Monaco scrollbar elements */
      .monaco-editor .scrollbar,
      .monaco-editor .scroll-decoration,
      .monaco-editor .invisible.scrollbar,
      .monaco-editor .slider,
      .monaco-editor .vertical.scrollbar,
      .monaco-editor .horizontal.scrollbar,
      .monaco-diff-editor .scrollbar,
      .monaco-diff-editor .scroll-decoration,
      .monaco-diff-editor .invisible.scrollbar,
      .monaco-diff-editor .slider,
      .monaco-diff-editor .vertical.scrollbar,
      .monaco-diff-editor .horizontal.scrollbar {
        display: none !important;
        visibility: hidden !important;
        width: 0 !important;
        height: 0 !important;
        opacity: 0 !important;
      }
      
      /* Target the specific scrollbar classes that Monaco uses */
      .monaco-scrollable-element > .scrollbar,
      .monaco-scrollable-element > .scroll-decoration,
      .monaco-scrollable-element .slider {
        display: none !important;
        visibility: hidden !important;
        width: 0 !important;
        height: 0 !important;
      }
      
      /* Remove scrollbar space/padding from content area */
      .monaco-editor .monaco-scrollable-element,
      .monaco-diff-editor .monaco-scrollable-element {
        padding-right: 0 !important;
        padding-bottom: 0 !important;
        margin-right: 0 !important;
        margin-bottom: 0 !important;
      }
      
      /* Ensure the diff content takes full width without scrollbar space */
      .monaco-diff-editor .editor.modified,
      .monaco-diff-editor .editor.original {
        margin-right: 0 !important;
        padding-right: 0 !important;
      }
    `;
    document.head.appendChild(styleElement);
  }

  connectedCallback() {
    super.connectedCallback();
    // Initialize with default range and load data
    // Get base commit if not set
    if (
      this.currentRange.type === "range" &&
      !("from" in this.currentRange && this.currentRange.from)
    ) {
      this.gitService
        .getBaseCommitRef()
        .then((baseRef) => {
          this.currentRange = { type: "range", from: baseRef, to: "HEAD" };
          this.loadDiffData();
        })
        .catch((error) => {
          console.error("Error getting base commit ref:", error);
          // Use default range
          this.loadDiffData();
        });
    } else {
      this.loadDiffData();
    }
  }

  // Toggle hideUnchangedRegions setting for a specific file
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

  render() {
    return html`
      <div class="controls">
        <div class="controls-container">
          <div class="range-row">
            <sketch-diff-range-picker
              .gitService="${this.gitService}"
              @range-change="${this.handleRangeChange}"
            ></sketch-diff-range-picker>
            <div class="spacer"></div>
            ${this.renderFileSelector()}
          </div>
        </div>
      </div>

      <div class="diff-container">
        <div class="diff-content">${this.renderDiffContent()}</div>
      </div>
    `;
  }

  renderFileSelector() {
    const fileCount = this.files.length;

    return html`
      <div class="file-selector-container">
        <select
          class="file-selector"
          .value="${this.selectedFile}"
          @change="${this.handleFileSelection}"
          ?disabled="${fileCount === 0}"
        >
          <option value="">All files (${fileCount})</option>
          ${this.files.map(
            (file) => html`
              <option value="${file.path}">
                ${this.getFileDisplayName(file)}
              </option>
            `,
          )}
        </select>
        ${this.selectedFile ? this.renderSingleFileExpandButton() : ""}
      </div>
    `;
  }

  renderDiffContent() {
    if (this.loading) {
      return html`<div class="loading">Loading diff...</div>`;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    if (this.files.length === 0) {
      return html`<sketch-diff-empty-view></sketch-diff-empty-view>`;
    }

    // Render single file view if a specific file is selected
    if (this.selectedFile && this.viewMode === "single") {
      return this.renderSingleFileView();
    }

    // Render multi-file view
    return html`
      <div class="multi-file-diff-container">
        ${this.files.map((file, index) => this.renderFileDiff(file, index))}
      </div>
    `;
  }

  /**
   * Load diff data for the current range
   */
  async loadDiffData() {
    this.loading = true;
    this.error = null;

    try {
      // Initialize files as empty array if undefined
      if (!this.files) {
        this.files = [];
      }

      // Load diff data for the range
      this.files = await this.gitService.getDiff(
        this.currentRange.from,
        this.currentRange.to,
      );

      // Ensure files is always an array, even when API returns null
      if (!this.files) {
        this.files = [];
      }

      // Load content for all files
      if (this.files.length > 0) {
        // Initialize expand states for new files (default to collapsed)
        this.files.forEach((file) => {
          if (!this.fileExpandStates.has(file.path)) {
            this.fileExpandStates.set(file.path, false); // false = collapsed (hide unchanged regions)
          }
        });
        await this.loadAllFileContents();
      } else {
        // No files to display - reset the view to initial state
        this.selectedFilePath = "";
        this.selectedFile = "";
        this.viewMode = "all";
        this.fileContents.clear();
        this.fileExpandStates.clear();
      }
    } catch (error) {
      console.error("Error loading diff data:", error);
      this.error = `Error loading diff data: ${error.message}`;
      // Ensure files is an empty array when an error occurs
      this.files = [];
      // Reset the view to initial state
      this.selectedFilePath = "";
      this.selectedFile = "";
      this.viewMode = "all";
      this.fileContents.clear();
      this.fileExpandStates.clear();
    } finally {
      this.loading = false;
    }
  }

  /**
   * Load content for all files in the diff
   */
  async loadAllFileContents() {
    this.loading = true;
    this.error = null;
    this.fileContents.clear();

    try {
      let fromCommit: string;
      let toCommit: string;
      let isUnstagedChanges = false;

      // Determine the commits to compare based on the current range
      fromCommit = this.currentRange.from;
      toCommit = this.currentRange.to;
      // Check if this is an unstaged changes view
      isUnstagedChanges = toCommit === "";

      // Load content for all files
      const promises = this.files.map(async (file) => {
        try {
          let originalCode = "";
          let modifiedCode = "";
          let editable = isUnstagedChanges;

          // Load the original code based on file status
          if (file.status !== "A") {
            // For modified, renamed, or deleted files: load original content
            originalCode = await this.gitService.getFileContent(
              file.old_hash || "",
            );
          }

          // For modified code, always use working copy when editable
          if (editable) {
            try {
              // Always use working copy when editable, regardless of diff status
              modifiedCode = await this.gitService.getWorkingCopyContent(
                file.path,
              );
            } catch (error) {
              if (file.status === "D") {
                // For deleted files, silently use empty content
                console.warn(
                  `Could not get working copy for deleted file ${file.path}, using empty content`,
                );
                modifiedCode = "";
              } else {
                // For any other file status, propagate the error
                console.error(
                  `Failed to get working copy for ${file.path}:`,
                  error,
                );
                throw error;
              }
            }
          } else {
            // For non-editable view, use git content based on file status
            if (file.status === "D") {
              // Deleted file: empty modified
              modifiedCode = "";
            } else {
              // Added/modified/renamed: use the content from git
              modifiedCode = await this.gitService.getFileContent(
                file.new_hash || "",
              );
            }
          }

          // Don't make deleted files editable
          if (file.status === "D") {
            editable = false;
          }

          this.fileContents.set(file.path, {
            original: originalCode,
            modified: modifiedCode,
            editable,
          });
        } catch (error) {
          console.error(`Error loading content for file ${file.path}:`, error);
          // Store empty content for failed files to prevent blocking
          this.fileContents.set(file.path, {
            original: "",
            modified: "",
            editable: false,
          });
        }
      });

      await Promise.all(promises);
    } catch (error) {
      console.error("Error loading file contents:", error);
      this.error = `Error loading file contents: ${error.message}`;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Handle range change event from the range picker
   */
  handleRangeChange(event: CustomEvent) {
    const { range } = event.detail;
    console.log("Range changed:", range);
    this.currentRange = range;

    // Load diff data for the new range
    this.loadDiffData();
  }

  /**
   * Render a single file diff section
   */
  renderFileDiff(file: GitDiffFile, index: number) {
    const content = this.fileContents.get(file.path);
    if (!content) {
      return html`
        <div class="file-diff-section">
          <div class="file-header">${this.renderFileHeader(file)}</div>
          <div class="loading">Loading ${file.path}...</div>
        </div>
      `;
    }

    return html`
      <div class="file-diff-section">
        <div class="file-header">${this.renderFileHeader(file)}</div>
        <div class="file-diff-editor">
          <sketch-monaco-view
            .originalCode="${content.original}"
            .modifiedCode="${content.modified}"
            .originalFilename="${file.path}"
            .modifiedFilename="${file.path}"
            ?readOnly="${!content.editable}"
            ?editable-right="${content.editable}"
            @monaco-comment="${this.handleMonacoComment}"
            @monaco-save="${this.handleMonacoSave}"
            @monaco-delete="${this.handleMonacoDelete}"
            @monaco-height-changed="${this.handleMonacoHeightChange}"
            data-file-index="${index}"
            data-file-path="${file.path}"
          ></sketch-monaco-view>
        </div>
      </div>
    `;
  }

  /**
   * Render file header with status and path info
   */
  renderFileHeader(file: GitDiffFile) {
    const statusClass = this.getFileStatusClass(file.status);
    const statusText = this.getFileStatusText(file.status);
    const changesInfo = this.getChangesInfo(file);
    const pathInfo = this.getPathInfo(file);

    const isExpanded = this.fileExpandStates.get(file.path) ?? false;

    return html`
      <div class="file-header-left">
        <span class="file-status ${statusClass}">${statusText}</span>
        <span class="file-path">${pathInfo}</span>
        ${changesInfo
          ? html`<span class="file-changes">${changesInfo}</span>`
          : ""}
      </div>
      <div class="file-header-right">
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
    `;
  }

  /**
   * Get CSS class for file status
   */
  getFileStatusClass(status: string): string {
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

  /**
   * Get display text for file status
   */
  getFileStatusText(status: string): string {
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

    return `(${parts.join(", ")})`;
  }

  /**
   * Get path information for display, handling renames
   */
  getPathInfo(file: GitDiffFile): string {
    if (file.old_path && file.old_path !== "") {
      // For renames, show old_path → new_path
      return `${file.old_path} → ${file.path}`;
    }
    // For regular files, just show the path
    return file.path;
  }

  /**
   * Render expand all icon (dotted line with arrows pointing away)
   */
  renderExpandAllIcon() {
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

  /**
   * Render collapse icon (arrows pointing towards dotted line)
   */
  renderCollapseIcon() {
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

  /**
   * Handle file selection change from the dropdown
   */
  handleFileSelection(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const selectedValue = selectElement.value;

    this.selectedFile = selectedValue;
    this.viewMode = selectedValue ? "single" : "all";

    // Force re-render
    this.requestUpdate();
  }

  /**
   * Get display name for file in the selector
   */
  getFileDisplayName(file: GitDiffFile): string {
    const status = this.getFileStatusText(file.status);
    const pathInfo = this.getPathInfo(file);
    return `${status}: ${pathInfo}`;
  }

  /**
   * Render expand/collapse button for single file view in header
   */
  renderSingleFileExpandButton() {
    if (!this.selectedFile) return "";

    const isExpanded = this.fileExpandStates.get(this.selectedFile) ?? false;

    return html`
      <button
        class="header-expand-button"
        @click="${() => this.toggleFileExpansion(this.selectedFile)}"
        title="${isExpanded
          ? "Collapse: Hide unchanged regions to focus on changes"
          : "Expand: Show all lines including unchanged regions"}"
      >
        ${isExpanded ? this.renderCollapseIcon() : this.renderExpandAllIcon()}
      </button>
    `;
  }

  /**
   * Render single file view with full-screen Monaco editor
   */
  renderSingleFileView() {
    const selectedFileData = this.files.find(
      (f) => f.path === this.selectedFile,
    );
    if (!selectedFileData) {
      return html`<div class="error">Selected file not found</div>`;
    }

    const content = this.fileContents.get(this.selectedFile);
    if (!content) {
      return html`<div class="loading">Loading ${this.selectedFile}...</div>`;
    }

    return html`
      <div class="single-file-view">
        <sketch-monaco-view
          class="single-file-monaco"
          .originalCode="${content.original}"
          .modifiedCode="${content.modified}"
          .originalFilename="${selectedFileData.path}"
          .modifiedFilename="${selectedFileData.path}"
          ?readOnly="${!content.editable}"
          ?editable-right="${content.editable}"
          @monaco-comment="${this.handleMonacoComment}"
          @monaco-save="${this.handleMonacoSave}"
          @monaco-delete="${this.handleMonacoDelete}"
          data-file-path="${selectedFileData.path}"
        ></sketch-monaco-view>
      </div>
    `;
  }

  /**
   * Refresh the diff view by reloading commits and diff data
   *
   * This is called when the Monaco diff tab is activated to ensure:
   * 1. Branch information from git/recentlog is current (branches can change frequently)
   * 2. The diff content is synchronized with the latest repository state
   * 3. Users always see up-to-date information without manual refresh
   */
  refreshDiffView() {
    // First refresh the range picker to get updated branch information
    const rangePicker = this.shadowRoot?.querySelector(
      "sketch-diff-range-picker",
    );
    if (rangePicker) {
      (rangePicker as any).loadCommits();
    }

    if (this.commit) {
      // Convert single commit to range (commit^ to commit)
      this.currentRange = {
        type: "range",
        from: `${this.commit}^`,
        to: this.commit,
      };
    }

    // Then reload diff data based on the current range
    this.loadDiffData();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff2-view": SketchDiff2View;
  }
}
