import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./sketch-diff-navigation";
import "./sketch-monaco-view";
import { DiffFile } from "./sketch-diff-navigation";

/**
 * A component that displays diffs using Monaco editor with file navigation
 */
@customElement("sketch-diff2-view")
export class SketchDiff2View extends LitElement {
  @property({ type: String })
  commit: string = "HEAD";

  @property({ type: String })
  selectedFilePath: string = "";

  @state()
  private files: DiffFile[] = [];

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
    }

    .diff-container {
      display: flex;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }

    .navigation {
      width: 250px;
      flex-shrink: 0;
      border-right: 1px solid var(--border-color, #e0e0e0);
      overflow-y: auto;
      height: 100%;
    }

    .monaco-container {
      flex: 1;
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .diff-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color, #e0e0e0);
      background-color: var(--background-light, #f5f5f5);
      display: flex;
      justify-content: space-between;
      align-items: center;
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
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }

    .error {
      color: var(--error-color, #dc3545);
      padding: 16px;
    }

    sketch-monaco-view {
      --editor-width: 100%;
      --editor-height: 100%;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadDiffData();
  }

  render() {
    return html`
      <div class="diff-container">
        <div class="navigation">
          <sketch-diff-navigation
            .files="${this.files}"
            .selectedFilePath="${this.selectedFilePath}"
            @file-selected="${this.handleFileSelected}"
          ></sketch-diff-navigation>
        </div>
        <div class="monaco-container">
          <div class="diff-header">
            <h2>${this.selectedFilePath || 'Select a file'}</h2>
          </div>
          <div class="diff-content">
            ${this.renderDiffContent()}
          </div>
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
      ></sketch-monaco-view>
    `;
  }

  /**
   * Load diff data for the current commit
   */
  async loadDiffData() {
    this.loading = true;
    this.error = null;

    try {
      // Fetch the raw diff data
      const response = await fetch(`git/rawdiff?commit=${this.commit}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch diff: ${response.statusText}`);
      }

      const diffData = await response.json();
      this.files = this.processRawDiff(diffData);

      // If files are available, select the first one
      if (this.files.length > 0) {
        this.selectedFilePath = this.files[0].path;
        await this.loadFileContent(this.files[0]);
      }
    } catch (error) {
      console.error('Error loading diff data:', error);
      this.error = `Error loading diff data: ${error.message}`;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Process raw diff data into a list of files
   */
  processRawDiff(diffData: any): DiffFile[] {
    // Extract file information from the raw diff data
    // Format will depend on the output format of your /git/rawdiff endpoint
    // This is a placeholder implementation
    const files: DiffFile[] = [];

    if (diffData && Array.isArray(diffData.files)) {
      return diffData.files.map((file: any) => ({
        path: file.filename || file.path,
        changeType: file.status || 'M',
        oldPath: file.old_path || undefined
      }));
    }

    return files;
  }

  /**
   * Load the content of the selected file
   */
  async loadFileContent(file: DiffFile) {
    this.loading = true;
    this.error = null;

    try {
      // Determine how to fetch content based on the change type
      if (file.changeType === 'A') {
        // Added file: empty original, current content for modified
        this.originalCode = '';
        const modifiedResponse = await fetch(`git/show?hash=${this.commit}:${file.path}`);
        if (!modifiedResponse.ok) {
          throw new Error(`Failed to fetch modified content: ${modifiedResponse.statusText}`);
        }
        const modifiedData = await modifiedResponse.json();
        this.modifiedCode = modifiedData.output || '';
      } else if (file.changeType === 'D') {
        // Deleted file: original content, empty modified
        const originalResponse = await fetch(`git/show?hash=${this.commit}^:${file.path}`);
        if (!originalResponse.ok) {
          throw new Error(`Failed to fetch original content: ${originalResponse.statusText}`);
        }
        const originalData = await originalResponse.json();
        this.originalCode = originalData.output || '';
        this.modifiedCode = '';
      } else {
        // Modified or renamed file: need both contents
        const originalResponse = await fetch(`git/show?hash=${this.commit}^:${file.oldPath || file.path}`);
        if (!originalResponse.ok) {
          throw new Error(`Failed to fetch original content: ${originalResponse.statusText}`);
        }
        const originalData = await originalResponse.json();
        this.originalCode = originalData.output || '';

        const modifiedResponse = await fetch(`git/show?hash=${this.commit}:${file.path}`);
        if (!modifiedResponse.ok) {
          throw new Error(`Failed to fetch modified content: ${modifiedResponse.statusText}`);
        }
        const modifiedData = await modifiedResponse.json();
        this.modifiedCode = modifiedData.output || '';
      }
    } catch (error) {
      console.error('Error loading file content:', error);
      this.error = `Error loading file content: ${error.message}`;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Handle file selection event from the navigation component
   */
  handleFileSelected(event: CustomEvent) {
    const file = event.detail.file as DiffFile;
    this.selectedFilePath = file.path;
    this.loadFileContent(file);
  }

  /**
   * Update when properties change
   */
  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('commit')) {
      this.loadDiffData();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff2-view": SketchDiff2View;
  }
}
