// sketch-diff-range-picker.ts
// Component for selecting commit range for diffs

import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GitDataService, DefaultGitDataService } from "./git-data-service";
import { GitLogEntry } from "../types";

/**
 * Range type for diff views
 */
export type DiffRange = 
  | { type: 'range'; from: string; to: string } 
  | { type: 'single'; commit: string };

/**
 * Component for selecting commit range for diffs
 */
@customElement("sketch-diff-range-picker")
export class SketchDiffRangePicker extends LitElement {
  @property({ type: Array })
  commits: GitLogEntry[] = [];

  @state()
  private rangeType: 'range' | 'single' = 'range';

  @state()
  private fromCommit: string = '';

  @state()
  private toCommit: string = '';

  @state()
  private singleCommit: string = '';

  @state()
  private loading: boolean = true;

  @state()
  private error: string | null = null;
  
  @property({ attribute: false, type: Object })
  gitService!: GitDataService;
  
  constructor() {
    super();
    console.log('SketchDiffRangePicker initialized');
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      font-family: var(--font-family, system-ui, sans-serif);
      color: var(--text-color, #333);
    }

    .range-picker {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background-color: var(--background-light, #f8f8f8);
      border-radius: 4px;
      border: 1px solid var(--border-color, #e0e0e0);
      flex-wrap: wrap; /* Allow wrapping on small screens */
      width: 100%;
      box-sizing: border-box;
    }

    .range-type-selector {
      display: flex;
      gap: 16px;
      flex-shrink: 0;
    }

    .range-type-option {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      white-space: nowrap;
    }

    .commit-selectors {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      flex: 1;
      flex-wrap: wrap; /* Allow wrapping on small screens */
    }

    .commit-selector {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 200px;
      max-width: calc(50% - 12px); /* Half width minus half the gap */
      overflow: hidden;
    }

    select {
      padding: 6px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-color, #e0e0e0);
      background-color: var(--background, #fff);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    label {
      font-weight: 500;
      font-size: 14px;
    }

    .loading {
      font-style: italic;
      color: var(--text-muted, #666);
    }

    .error {
      color: var(--error-color, #dc3545);
      font-size: 14px;
    }
    
    @media (max-width: 768px) {
      .commit-selector {
        max-width: 100%;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    // Wait for DOM to be fully loaded to ensure proper initialization order
    if (document.readyState === 'complete') {
      this.loadCommits();
    } else {
      window.addEventListener('load', () => {
        setTimeout(() => this.loadCommits(), 0); // Give time for provider initialization
      });
    }
  }

  render() {
    return html`
      <div class="range-picker">
        ${this.loading
          ? html`<div class="loading">Loading commits...</div>`
          : this.error
          ? html`<div class="error">${this.error}</div>`
          : this.renderRangePicker()
        }
      </div>
    `;
  }

  renderRangePicker() {
    return html`
      <div class="range-type-selector">
        <label class="range-type-option">
          <input
            type="radio"
            name="rangeType"
            value="range"
            ?checked=${this.rangeType === 'range'}
            @change=${() => this.setRangeType('range')}
          />
          Commit Range
        </label>
        <label class="range-type-option">
          <input
            type="radio"
            name="rangeType"
            value="single"
            ?checked=${this.rangeType === 'single'}
            @change=${() => this.setRangeType('single')}
          />
          Single Commit
        </label>
      </div>

      <div class="commit-selectors">
        ${this.rangeType === 'range'
          ? this.renderRangeSelectors()
          : this.renderSingleSelector()
        }
      </div>
    `;
  }

  renderRangeSelectors() {
    return html`
      <div class="commit-selector">
        <label for="fromCommit">From:</label>
        <select
          id="fromCommit"
          .value=${this.fromCommit}
          @change=${this.handleFromChange}
        >
          ${this.commits.map(
            commit => html`
              <option value=${commit.hash} ?selected=${commit.hash === this.fromCommit}>
                ${this.formatCommitOption(commit)}
              </option>
            `
          )}
        </select>
      </div>
      <div class="commit-selector">
        <label for="toCommit">To:</label>
        <select
          id="toCommit"
          .value=${this.toCommit}
          @change=${this.handleToChange}
        >
          <option value="" ?selected=${this.toCommit === ''}>Uncommitted Changes</option>
          ${this.commits.map(
            commit => html`
              <option value=${commit.hash} ?selected=${commit.hash === this.toCommit}>
                ${this.formatCommitOption(commit)}
              </option>
            `
          )}
        </select>
      </div>
    `;
  }

  renderSingleSelector() {
    return html`
      <div class="commit-selector">
        <label for="singleCommit">Commit:</label>
        <select
          id="singleCommit"
          .value=${this.singleCommit}
          @change=${this.handleSingleChange}
        >
          ${this.commits.map(
            commit => html`
              <option value=${commit.hash} ?selected=${commit.hash === this.singleCommit}>
                ${this.formatCommitOption(commit)}
              </option>
            `
          )}
        </select>
      </div>
    `;
  }

  /**
   * Format a commit for display in the dropdown
   */
  formatCommitOption(commit: GitLogEntry): string {
    const shortHash = commit.hash.substring(0, 7);
    let label = `${shortHash} ${commit.subject}`;
    
    if (commit.refs && commit.refs.length > 0) {
      label += ` (${commit.refs.join(', ')})`;
    }
    
    return label;
  }

  /**
   * Load commits from the Git data service
   */
  async loadCommits() {
    this.loading = true;
    this.error = null;

    if (!this.gitService) {
      console.error('GitService was not provided to sketch-diff-range-picker');
      throw Error();
    }

    try {
      // Get the base commit reference
      const baseCommitRef = await this.gitService.getBaseCommitRef();
      
      // Load commit history
      this.commits = await this.gitService.getCommitHistory(baseCommitRef);
      
      // Set default selections
      if (this.commits.length > 0) {
        // For range, default is base to HEAD
        // TODO: is sketch-base right in the unsafe context, where it's sketch-base-...
        // should this be startswith?
        const baseCommit = this.commits.find(c => 
          c.refs && c.refs.some(ref => ref.includes('sketch-base'))
        );
        
        this.fromCommit = baseCommit ? baseCommit.hash : this.commits[this.commits.length - 1].hash;
        // Default to Uncommitted Changes by setting toCommit to empty string
        this.toCommit = ''; // Empty string represents uncommitted changes
        
        // For single, default to HEAD
        this.singleCommit = this.commits[0].hash;
        
        // Dispatch initial range event
        this.dispatchRangeEvent();
      }
    } catch (error) {
      console.error('Error loading commits:', error);
      this.error = `Error loading commits: ${error.message}`;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Handle range type change
   */
  setRangeType(type: 'range' | 'single') {
    this.rangeType = type;
    this.dispatchRangeEvent();
  }

  /**
   * Handle From commit change
   */
  handleFromChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.fromCommit = select.value;
    this.dispatchRangeEvent();
  }

  /**
   * Handle To commit change
   */
  handleToChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.toCommit = select.value;
    this.dispatchRangeEvent();
  }

  /**
   * Handle Single commit change
   */
  handleSingleChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.singleCommit = select.value;
    this.dispatchRangeEvent();
  }

  /**
   * Dispatch range change event
   */
  dispatchRangeEvent() {
    const range: DiffRange = this.rangeType === 'range'
      ? { type: 'range', from: this.fromCommit, to: this.toCommit }
      : { type: 'single', commit: this.singleCommit };
    
    const event = new CustomEvent('range-change', {
      detail: { range },
      bubbles: true,
      composed: true
    });
    
    this.dispatchEvent(event);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-diff-range-picker": SketchDiffRangePicker;
  }
}
