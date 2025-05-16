import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./sketch-monaco-view";
import "./sketch-diff-range-picker";
import "./sketch-diff-file-picker";
import "./sketch-diff-empty-view";
import { GitDiffFile, GitDataService, DefaultGitDataService } from "./git-data-service";
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
        console.error('Invalid comment data received');
        return;
      }
      
      // Create and dispatch event using the standardized format
      const commentEvent = new CustomEvent('diff-comment', {
        detail: { comment: event.detail.formattedComment },
        bubbles: true,
        composed: true
      });
      
      this.dispatchEvent(commentEvent);
    } catch (error) {
      console.error('Error handling Monaco comment:', error);
    }
  }
  
  /**
   * Handle save events from the Monaco editor
   */
  private async handleMonacoSave(event: CustomEvent) {
    try {
      // Validate incoming data
      if (!event.detail || !event.detail.path || event.detail.content === undefined) {
        console.error('Invalid save data received');
        return;
      }
      
      const { path, content } = event.detail;
      
      // Get Monaco view component
      const monacoView = this.shadowRoot?.querySelector('sketch-monaco-view');
      if (!monacoView) {
        console.error('Monaco view not found');
        return;
      }
      
      try {
        await this.gitService?.saveFileContent(path, content);
        console.log(`File saved: ${path}`);
        (monacoView as any).notifySaveComplete(true);
      } catch (error) {
        console.error(`Error saving file: ${error instanceof Error ? error.message : String(error)}`);
        (monacoView as any).notifySaveComplete(false);
      }
    } catch (error) {
      console.error('Error handling save:', error);
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
  private currentRange: DiffRange = { type: 'range', from: '', to: 'HEAD' };

  @state()
  private originalCode: string = "";

  @state()
  private modifiedCode: string = "";
  
  @state()
  private isRightEditable: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

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
    }
    
    .file-row {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    
    sketch-diff-range-picker {
      width: 100%;
    }
    
    sketch-diff-file-picker {
      flex: 1;
    }
    
    .view-toggle-button {
      background-color: #f0f0f0;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.2s;
    }
    
    .view-toggle-button:hover {
      background-color: #e0e0e0;
    }

    .diff-container {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0; /* Critical for flex child to respect parent height */
      position: relative; /* Establish positioning context */
      height: 100%; /* Take full height */
    }

    .diff-content {
      flex: 1;
      overflow: hidden;
      min-height: 0; /* Required for proper flex behavior */
      display: flex; /* Required for child to take full height */
      position: relative; /* Establish positioning context */
      height: 100%; /* Take full height */
    }

    .loading, .empty-diff {
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
      flex: 1; /* Make Monaco view take full height */
      display: flex; /* Required for child to take full height */
      position: absolute; /* Absolute positioning to take full space */
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: 100%; /* Take full height */
      width: 100%;  /* Take full width */
    }
  `;

  @property({ attribute: false, type: Object })
  gitService!: GitDataService;
  
  // The gitService must be passed from parent to ensure proper dependency injection

  constructor() {
    super();
    console.log('SketchDiff2View initialized');
    
    // Fix for monaco-aria-container positioning
    // Add a global style to ensure proper positioning of aria containers
    const styleElement = document.createElement('style');
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
    `;
    document.head.appendChild(styleElement);
  }

  connectedCallback() {
    super.connectedCallback();
    // Initialize with default range and load data
    // Get base commit if not set
    if (this.currentRange.type === 'range' && !('from' in this.currentRange && this.currentRange.from)) {
      this.gitService.getBaseCommitRef().then(baseRef => {
        this.currentRange = { type: 'range', from: baseRef, to: 'HEAD' };
        this.loadDiffData();
      }).catch(error => {
        console.error('Error getting base commit ref:', error);
        // Use default range
        this.loadDiffData();
      });
    } else {
      this.loadDiffData();
    }
  }

  // Toggle hideUnchangedRegions setting
  @state()
  private hideUnchangedRegionsEnabled: boolean = true;
  
  // Toggle hideUnchangedRegions setting
  private toggleHideUnchangedRegions() {
    this.hideUnchangedRegionsEnabled = !this.hideUnchangedRegionsEnabled;
    
    // Get the Monaco view component
    const monacoView = this.shadowRoot?.querySelector('sketch-monaco-view');
    if (monacoView) {
      (monacoView as any).toggleHideUnchangedRegions(this.hideUnchangedRegionsEnabled);
    }
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
          </div>
          
          <div class="file-row">
            <sketch-diff-file-picker
              .files="${this.files}"
              .selectedPath="${this.selectedFilePath}"
              @file-selected="${this.handleFileSelected}"
            ></sketch-diff-file-picker>
            
            <div style="display: flex; gap: 8px;">
              ${this.isRightEditable ? html`
                <div class="editable-indicator" title="This file is editable">
                  <span style="padding: 6px 12px; background-color: #e9ecef; border-radius: 4px; font-size: 12px; color: #495057;">
                    Editable
                  </span>
                </div>
              ` : ''}
              <button 
                class="view-toggle-button"
                @click="${this.toggleHideUnchangedRegions}"
                title="${this.hideUnchangedRegionsEnabled ? 'Expand All' : 'Hide Unchanged'}"
              >
                ${this.hideUnchangedRegionsEnabled ? 'Expand All' : 'Hide Unchanged'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="diff-container">
        <div class="diff-content">
          ${this.renderDiffContent()}
        </div>
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
    
    if (!this.selectedFilePath) {
      return html`<div class="loading">Select a file to view diff</div>`;
    }

    return html`
      <sketch-monaco-view
        .originalCode="${this.originalCode}"
        .modifiedCode="${this.modifiedCode}"
        .originalFilename="${this.selectedFilePath}"
        .modifiedFilename="${this.selectedFilePath}"
        ?readOnly="${!this.isRightEditable}"
        ?editable-right="${this.isRightEditable}"
        @monaco-comment="${this.handleMonacoComment}"
        @monaco-save="${this.handleMonacoSave}"
      ></sketch-monaco-view>
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

      // Load diff data based on the current range type
      if (this.currentRange.type === 'single') {
        this.files = await this.gitService.getCommitDiff(this.currentRange.commit);
      } else {
        this.files = await this.gitService.getDiff(this.currentRange.from, this.currentRange.to);
      }

      // Ensure files is always an array, even when API returns null
      if (!this.files) {
        this.files = [];
      }
      
      // If we have files, select the first one and load its content
      if (this.files.length > 0) {
        const firstFile = this.files[0];
        this.selectedFilePath = firstFile.path;
        
        // Directly load the file content, especially important when there's only one file
        // as sometimes the file-selected event might not fire in that case
        this.loadFileContent(firstFile);
      } else {
        // No files to display - reset the view to initial state
        this.selectedFilePath = '';
        this.originalCode = '';
        this.modifiedCode = '';
      }
    } catch (error) {
      console.error('Error loading diff data:', error);
      this.error = `Error loading diff data: ${error.message}`;
      // Ensure files is an empty array when an error occurs
      this.files = [];
      // Reset the view to initial state
      this.selectedFilePath = '';
      this.originalCode = '';
      this.modifiedCode = '';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Load the content of the selected file
   */
  async loadFileContent(file: GitDiffFile) {
    this.loading = true;
    this.error = null;

    try {
      let fromCommit: string;
      let toCommit: string;
      let isUnstagedChanges = false;
      
      // Determine the commits to compare based on the current range
      if (this.currentRange.type === 'single') {
        fromCommit = `${this.currentRange.commit}^`;
        toCommit = this.currentRange.commit;
      } else {
        fromCommit = this.currentRange.from;
        toCommit = this.currentRange.to;
        // Check if this is an unstaged changes view
        isUnstagedChanges = toCommit === '';
      }

      // Set editability based on whether we're showing uncommitted changes
      this.isRightEditable = isUnstagedChanges;

      // Load the original code based on file status
      if (file.status === 'A') {
        // Added file: empty original
        this.originalCode = '';
      } else {
        // For modified, renamed, or deleted files: load original content
        this.originalCode = await this.gitService.getFileContent(file.old_hash || '');
      }
      
      // For modified code, always use working copy when editable
      if (this.isRightEditable) {
        try {
          // Always use working copy when editable, regardless of diff status
          // This ensures we have the latest content even if the diff hasn't been refreshed
          this.modifiedCode = await this.gitService.getWorkingCopyContent(file.path);
        } catch (error) {
          if (file.status === 'D') {
            // For deleted files, silently use empty content
            console.warn(`Could not get working copy for deleted file ${file.path}, using empty content`);
            this.modifiedCode = '';
          } else {
            // For any other file status, propagate the error
            console.error(`Failed to get working copy for ${file.path}:`, error);
            throw error; // Rethrow to be caught by the outer try/catch
          }
        }
      } else {
        // For non-editable view, use git content based on file status
        if (file.status === 'D') {
          // Deleted file: empty modified
          this.modifiedCode = '';
        } else {
          // Added/modified/renamed: use the content from git
          this.modifiedCode = await this.gitService.getFileContent(file.new_hash || '');
        }
      }
      
      // Don't make deleted files editable
      if (file.status === 'D') {
        this.isRightEditable = false;
      }
    } catch (error) {
      console.error('Error loading file content:', error);
      this.error = `Error loading file content: ${error.message}`;
      this.isRightEditable = false;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Handle range change event from the range picker
   */
  handleRangeChange(event: CustomEvent) {
    const { range } = event.detail;
    console.log('Range changed:', range);
    this.currentRange = range;
    
    // Load diff data for the new range
    this.loadDiffData();
  }

  /**
   * Handle file selection event from the file picker
   */
  handleFileSelected(event: CustomEvent) {
    const file = event.detail.file as GitDiffFile;
    this.selectedFilePath = file.path;
    this.loadFileContent(file);
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
    const rangePicker = this.shadowRoot?.querySelector('sketch-diff-range-picker');
    if (rangePicker) {
      (rangePicker as any).loadCommits();
    }
    
    if (this.commit) {
      this.currentRange = { type: 'single', commit: this.commit };
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
