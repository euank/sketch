import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./sketch-monaco-view";
import "./sketch-diff-range-picker";
import "./sketch-diff-file-picker";
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
  @property({ type: String })
  initialCommit: string = "";

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

    .diff-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color, #e0e0e0);
      background-color: var(--background-light, #f5f5f5);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0; /* Prevent header from shrinking */
    }

    .diff-header h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .diff-content {
      flex: 1;
      overflow: hidden;
      min-height: 0; /* Required for proper flex behavior */
      display: flex; /* Required for child to take full height */
      position: relative; /* Establish positioning context */
      height: 100%; /* Take full height */
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-family: var(--font-family, system-ui, sans-serif);
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

  @property({ attribute: false })
  gitService?: GitDataService;

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
    // Ensure gitService is defined
    if (!this.gitService) {
      this.gitService = new DefaultGitDataService();
    }
    
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
            
            <button 
              class="view-toggle-button"
              @click="${this.toggleHideUnchangedRegions}"
              title="${this.hideUnchangedRegionsEnabled ? 'Show all code' : 'Focus on changes'}"
            >
              ${this.hideUnchangedRegionsEnabled ? 'Show All Code' : 'Focus on Changes'}
            </button>
          </div>
        </div>
      </div>

      <div class="diff-container">
        <div class="diff-header">
          <h2>${this.selectedFilePath || 'Select a file'}</h2>
        </div>
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

    if (!this.selectedFilePath) {
      return html`<div class="loading">Select a file to view diff</div>`;
    }

    return html`
      <sketch-monaco-view
        .originalCode="${this.originalCode}"
        .modifiedCode="${this.modifiedCode}"
        .originalFilename="${this.selectedFilePath}"
        .modifiedFilename="${this.selectedFilePath}"
        readOnly
        @monaco-comment="${this.handleMonacoComment}"
      ></sketch-monaco-view>
    `;
  }

  /**
   * Load diff data for the current range
   */
  async loadDiffData() {
    this.loading = true;
    this.error = null;

    // Ensure gitService is defined
    if (!this.gitService) {
      this.gitService = new DefaultGitDataService();
    }

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
      
      // Determine the commits to compare based on the current range
      if (this.currentRange.type === 'single') {
        fromCommit = `${this.currentRange.commit}^`;
        toCommit = this.currentRange.commit;
      } else {
        fromCommit = this.currentRange.from;
        toCommit = this.currentRange.to;
      }

      // Determine how to fetch content based on the file status
      if (file.status === 'A') {
        // Added file: empty original, current content for modified
        this.originalCode = '';
        this.modifiedCode = await this.gitService.getFileContent(toCommit, file.path);
      } else if (file.status === 'D') {
        // Deleted file: original content, empty modified
        this.originalCode = await this.gitService.getFileContent(fromCommit, file.path);
        this.modifiedCode = '';
      } else {
        // Modified or renamed file: need both contents
        const sourcePath = file.oldPath || file.path;
        this.originalCode = await this.gitService.getFileContent(fromCommit, sourcePath);
        this.modifiedCode = await this.gitService.getFileContent(toCommit, file.path);
      }
    } catch (error) {
      console.error('Error loading file content:', error);
      this.error = `Error loading file content: ${error.message}`;
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
    
    // Then reload diff data based on the current range
    this.loadDiffData();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff2-view": SketchDiff2View;
  }
}
