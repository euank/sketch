import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, Ref, ref } from "lit/directives/ref.js";

// See https://rodydavis.com/posts/lit-monaco-editor for some ideas.

// @ts-ignore - Monaco editor is loaded at runtime
import * as monaco from "monaco-editor";

// Configure Monaco to use local workers with correct relative paths
// @ts-ignore - MonacoEnvironment is added to window at runtime
window.MonacoEnvironment = {
  getWorkerUrl: function (workerId, label) {
    // Map specific worker types to their respective files using relative paths
    const workerPaths = {
      editor: "./static/editor.worker.js",
      typescript: "./static/typescript.worker.js",
      json: "./static/json.worker.js",
      html: "./static/html.worker.js",
      css: "./static/css.worker.js",
    };

    // Return specific worker based on label, or default worker
    return workerPaths[label] || "./static/editor/editor.worker.js";
  },
};

// Define Monaco CSS styles as a string constant
const monacoStyles = `
  /* Import Monaco editor styles */
  @import url('./static/monaco/min/vs/editor/editor.main.css');
  
  /* Import Monaco editor's Codicon font - this is critical for icons */
  @font-face {
    font-family: "codicon";
    font-display: block;
    src: url('/static/monaco/min/vs/base/browser/ui/codicons/codicon/codicon.ttf') format('truetype');
  }
  
  /* Custom Monaco styles */
  .monaco-editor {
    width: 100%;
    height: 100%;
  }
  
  /* Custom font stack - ensure we have good monospace fonts */
  .monaco-editor .view-lines,
  .monaco-editor .view-line,
  .monaco-editor-pane,
  .monaco-editor .inputarea {
    font-family: "Menlo", "Monaco", "Consolas", "Courier New", monospace !important;
    font-size: 13px !important;
    font-feature-settings: "liga" 0, "calt" 0 !important;
    line-height: 1.5 !important;
  }
  
  /* Ensure light theme colors */
  .monaco-editor, .monaco-editor-background, .monaco-editor .inputarea.ime-input {
    background-color: var(--monaco-editor-bg, #ffffff) !important;
  }
  
  .monaco-editor .margin {
    background-color: var(--monaco-editor-margin, #f5f5f5) !important;
  }
`;

// Configure Monaco Editor worker urls
// @ts-ignore - MonacoEnvironment is added to self at runtime
self.MonacoEnvironment = {
  getWorkerUrl: function (_moduleId, label) {
    if (label === "json") {
      return "./static/json.worker.js";
    }
    if (label === "css" || label === "scss" || label === "less") {
      return "./static/css.worker.js";
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return "./static/html.worker.js";
    }
    if (label === "typescript" || label === "javascript") {
      return "./static/ts.worker.js";
    }
    return "./static/editor.worker.js";
  },
};

@customElement("sketch-monaco-view")
export class CodeDiffEditor extends LitElement {
  private container: Ref<HTMLElement> = createRef();
  editor?: monaco.editor.IStandaloneDiffEditor;

  @property({ type: Boolean, attribute: "readonly" }) readOnly?: boolean;
  @property() language?: string = "javascript";
  @property() originalCode?: string = "// Original code here";
  @property() modifiedCode?: string = "// Modified code here";
  @property() originalFilename?: string = "original.js";
  @property() modifiedFilename?: string = "modified.js";

  /* Selected text and indicators */
  @state()
  private selectedText: string | null = null;

  @state() 
  private selectionRange: { startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number } | null = null;

  @state()
  private showCommentIndicator: boolean = false;

  @state()
  private indicatorPosition: { top: number, left: number } = { top: 0, left: 0 };

  @state()
  private showCommentBox: boolean = false;

  @state()
  private commentText: string = '';
  
  @state()
  private activeEditor: 'original' | 'modified' = 'modified'; // Track which editor is active

  static styles = css`
    :host {
      --editor-width: 100%;
      --editor-height: 100%;
      display: flex;
      flex: 1;
      min-height: 0; /* Critical for flex layout */
      position: relative; /* Establish positioning context */
      height: 100%; /* Take full height */
      width: 100%;  /* Take full width */
    }
    main {
      width: var(--editor-width);
      height: var(--editor-height);
      border: 1px solid #e0e0e0;
      flex: 1;
      min-height: 300px; /* Ensure a minimum height for the editor */
      position: absolute; /* Absolute positioning to take full space */
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }

    /* Comment indicator and box styles */
    .comment-indicator {
      position: fixed;
      background-color: rgba(66, 133, 244, 0.9);
      color: white;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      animation: fadeIn 0.2s ease-in-out;
      display: flex;
      align-items: center;
      gap: 4px;
      pointer-events: all;
    }

    .comment-indicator:hover {
      background-color: rgba(66, 133, 244, 1);
    }

    .comment-indicator span {
      line-height: 1;
    }

    .comment-box {
      position: fixed;
      background-color: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
      padding: 12px;
      z-index: 10001;
      width: 350px;
      animation: fadeIn 0.2s ease-in-out;
      max-height: 80vh;
      overflow-y: auto;
    }

    .comment-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .comment-box-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
    }

    .close-button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: #666;
      padding: 2px 6px;
    }

    .close-button:hover {
      color: #333;
    }

    .selected-text-preview {
      background-color: #f5f5f5;
      border: 1px solid #eee;
      border-radius: 3px;
      padding: 8px;
      margin-bottom: 10px;
      font-family: monospace;
      font-size: 12px;
      max-height: 80px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .comment-textarea {
      width: 100%;
      min-height: 80px;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 3px;
      resize: vertical;
      font-family: inherit;
      margin-bottom: 10px;
      box-sizing: border-box;
    }

    .comment-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .comment-actions button {
      padding: 6px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }

    .cancel-button {
      background-color: transparent;
      border: 1px solid #ddd;
    }

    .cancel-button:hover {
      background-color: #f5f5f5;
    }

    .submit-button {
      background-color: #4285f4;
      color: white;
      border: none;
    }

    .submit-button:hover {
      background-color: #3367d6;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;

  render() {
    return html`
      <style>
        ${monacoStyles}
      </style>
      <main ${ref(this.container)}></main>
      
      <!-- Comment indicator - shown when text is selected -->
      ${this.showCommentIndicator ? html`
        <div class="comment-indicator" 
             style="top: ${this.indicatorPosition.top}px; left: ${this.indicatorPosition.left}px;"
             @click="${this.handleIndicatorClick}"
             @mouseenter="${() => { this._isHovering = true; }}"
             @mouseleave="${() => { this._isHovering = false; }}">
          <span>💬</span>
          <span>Add comment</span>
        </div>
      ` : ''}
      
      <!-- Comment box - shown when indicator is clicked -->
      ${this.showCommentBox ? html`
        <div class="comment-box" 
             style="${this.calculateCommentBoxPosition()}"
             @mouseenter="${() => { this._isHovering = true; }}"
             @mouseleave="${() => { this._isHovering = false; }}">
          <div class="comment-box-header">
            <h3>Add comment</h3>
            <button class="close-button" @click="${this.closeCommentBox}">×</button>
          </div>
          <div class="selected-text-preview">${this.selectedText}</div>
          <textarea 
            class="comment-textarea" 
            placeholder="Type your comment here..."
            .value="${this.commentText}"
            @input="${this.handleCommentInput}"
          ></textarea>
          <div class="comment-actions">
            <button class="cancel-button" @click="${this.closeCommentBox}">Cancel</button>
            <button class="submit-button" @click="${this.submitComment}">Submit</button>
          </div>
        </div>
      ` : ''}
    `;
  }
  
  /**
   * Calculate the optimal position for the comment box to keep it in view
   */
  private calculateCommentBoxPosition(): string {
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Default position (below indicator)
    let top = this.indicatorPosition.top + 30;
    let left = this.indicatorPosition.left;
    
    // Estimated box dimensions
    const boxWidth = 350;
    const boxHeight = 300;
    
    // Check if box would go off the right edge
    if (left + boxWidth > viewportWidth) {
      left = viewportWidth - boxWidth - 20; // Keep 20px margin
    }
    
    // Check if box would go off the bottom
    const bottomSpace = viewportHeight - top;
    if (bottomSpace < boxHeight) {
      // Not enough space below, try to position above if possible
      if (this.indicatorPosition.top > boxHeight) {
        // Position above the indicator
        top = this.indicatorPosition.top - boxHeight - 10;
      } else {
        // Not enough space above either, position at top of viewport with margin
        top = 10;
      }
    }
    
    // Ensure box is never positioned off-screen
    top = Math.max(10, top);
    left = Math.max(10, left);
    
    return `top: ${top}px; left: ${left}px;`;
  }

  setOriginalCode(code: string, filename?: string) {
    this.originalCode = code;
    if (filename) {
      this.originalFilename = filename;
    }

    // Update the model if the editor is initialized
    if (this.editor) {
      const model = this.editor.getOriginalEditor().getModel();
      if (model) {
        model.setValue(code);
        if (filename) {
          monaco.editor.setModelLanguage(
            model,
            this.getLanguageForFile(filename),
          );
        }
      }
    }
  }

  setModifiedCode(code: string, filename?: string) {
    this.modifiedCode = code;
    if (filename) {
      this.modifiedFilename = filename;
    }

    // Update the model if the editor is initialized
    if (this.editor) {
      const model = this.editor.getModifiedEditor().getModel();
      if (model) {
        model.setValue(code);
        if (filename) {
          monaco.editor.setModelLanguage(
            model,
            this.getLanguageForFile(filename),
          );
        }
      }
    }
  }

  private getLanguageForFile(filename: string): string {
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      html: "html",
      css: "css",
      json: "json",
      md: "markdown",
      go: "go",
    };
    return langMap[extension] || this.language || "plaintext";
  }

  /**
   * Update editor options
   */
  setOptions(value: monaco.editor.IDiffEditorConstructionOptions) {
    if (this.editor) {
      this.editor.updateOptions(value);
    }
  }
  
  /**
   * Toggle hideUnchangedRegions feature
   */
  toggleHideUnchangedRegions(enabled: boolean) {
    if (this.editor) {
      this.editor.updateOptions({
        hideUnchangedRegions: {
          enabled: enabled,
          contextLineCount: 3,
          minimumLineCount: 3,
          revealLineCount: 10
        }
      });
    }
  }

  // Models for the editor
  private originalModel?: monaco.editor.ITextModel;
  private modifiedModel?: monaco.editor.ITextModel;

  private initializeEditor() {
    try {
      // First time initialization
      if (!this.editor) {
        // Create the diff editor only once
        this.editor = monaco.editor.createDiffEditor(this.container.value!, {
          automaticLayout: true,
          readOnly: this.readOnly ?? false,
          theme: "vs", // Always use light mode
          renderSideBySide: true,
          ignoreTrimWhitespace: false,
          // Focus on the differences by hiding unchanged regions
          hideUnchangedRegions: {
            enabled: true,              // Enable the feature
            contextLineCount: 3,        // Show 3 lines of context around each difference
            minimumLineCount: 3,        // Hide regions only when they're at least 3 lines
            revealLineCount: 10         // Show 10 lines when expanding a hidden region
          }
        });

        console.log("Monaco diff editor created");
        
        // Set up selection change event listeners for both editors
        this.setupSelectionChangeListeners();
      }

      // Create or update models
      this.updateModels();
      
      // Force layout recalculation after a short delay
      // This ensures the editor renders properly, especially with single files
      setTimeout(() => {
        if (this.editor) {
          this.editor.layout();
          console.log("Monaco diff editor layout updated");
        }
      }, 50);

      console.log("Monaco diff editor initialized");
    } catch (error) {
      console.error("Error initializing Monaco editor:", error);
    }
  }
  
  /**
   * Sets up event listeners for text selection in both editors.
   * This enables showing the comment UI when users select text and
   * manages the visibility of UI components based on user interactions.
   */
  private setupSelectionChangeListeners() {
    try {
      if (!this.editor) {
        console.log('Editor not available for setting up listeners');
        return;
      }
      
      // Get both original and modified editors
      const originalEditor = this.editor.getOriginalEditor();
      const modifiedEditor = this.editor.getModifiedEditor();
      
      if (!originalEditor || !modifiedEditor) {
        console.log('Original or modified editor not available');
        return;
      }
      
      // Add selection change listener to original editor
      originalEditor.onDidChangeCursorSelection((e) => {
        this.handleSelectionChange(e, originalEditor, 'original');
      });
      
      // Add selection change listener to modified editor
      modifiedEditor.onDidChangeCursorSelection((e) => {
        this.handleSelectionChange(e, modifiedEditor, 'modified');
      });
      
      // Create a debounced function for mouse move handling
      let mouseMoveTimeout: number | null = null;
      const handleMouseMove = () => {
        // Clear any existing timeout
        if (mouseMoveTimeout) {
          window.clearTimeout(mouseMoveTimeout);
        }
        
        // If there's text selected and we're not showing the comment box, keep indicator visible
        if (this.selectedText && !this.showCommentBox) {
          this.showCommentIndicator = true;
          this.requestUpdate();
        }
        
        // Set a new timeout to hide the indicator after a delay
        mouseMoveTimeout = window.setTimeout(() => {
          // Only hide if we're not showing the comment box and not actively hovering
          if (!this.showCommentBox && !this._isHovering) {
            this.showCommentIndicator = false;
            this.requestUpdate();
          }
        }, 2000); // Hide after 2 seconds of inactivity
      };
      
      // Add mouse move listeners with debouncing
      originalEditor.onMouseMove(() => handleMouseMove());
      modifiedEditor.onMouseMove(() => handleMouseMove());
      
      // Track hover state over the indicator and comment box
      this._isHovering = false;
      
      // Use the global document click handler to detect clicks outside
      this._documentClickHandler = (e: MouseEvent) => {
        try {
          const target = e.target as HTMLElement;
          const isIndicator = target.matches('.comment-indicator') || 
                            !!target.closest('.comment-indicator');
          const isCommentBox = target.matches('.comment-box') || 
                             !!target.closest('.comment-box');
          
          // If click is outside our UI elements
          if (!isIndicator && !isCommentBox) {
            // If we're not showing the comment box, hide the indicator
            if (!this.showCommentBox) {
              this.showCommentIndicator = false;
              this.requestUpdate();
            }
          }
        } catch (error) {
          console.error('Error in document click handler:', error);
        }
      };
      
      // Add the document click listener
      document.addEventListener('click', this._documentClickHandler);
      
      console.log('Selection change listeners set up successfully');
    } catch (error) {
      console.error('Error setting up selection listeners:', error);
    }
  }
  
  // Track mouse hover state
  private _isHovering = false;
  
  // Store document click handler for cleanup
  private _documentClickHandler: ((e: MouseEvent) => void) | null = null;
  
  /**
   * Handle selection change events from either editor
   */
  private handleSelectionChange(e: monaco.editor.ICursorSelectionChangedEvent, editor: monaco.editor.IStandaloneCodeEditor, editorType: 'original' | 'modified') {
    try {
      // If we're not making a selection (just moving cursor), do nothing
      if (e.selection.isEmpty()) {
        // Don't hide indicator or box if already shown
        if (!this.showCommentBox) {
          this.selectedText = null;
          this.selectionRange = null;
          this.showCommentIndicator = false;
        }
        return;
      }
      
      // Get selected text
      const model = editor.getModel();
      if (!model) {
        console.log('No model available for selection');
        return;
      }
      
      // Make sure selection is within valid range
      const lineCount = model.getLineCount();
      if (e.selection.startLineNumber > lineCount || e.selection.endLineNumber > lineCount) {
        console.log('Selection out of bounds');
        return;
      }
      
      // Store which editor is active
      this.activeEditor = editorType;
      
      // Store selection range
      this.selectionRange = {
        startLineNumber: e.selection.startLineNumber,
        startColumn: e.selection.startColumn,
        endLineNumber: e.selection.endLineNumber,
        endColumn: e.selection.endColumn
      };
      
      try {
        // Get the selected text
        this.selectedText = model.getValueInRange(e.selection);
      } catch (error) {
        console.error('Error getting selected text:', error);
        return;
      }
      
      // If there's selected text, show the indicator
      if (this.selectedText && this.selectedText.trim() !== '') {
        // Calculate indicator position safely
        try {
          // Use the editor's DOM node as positioning context
          const editorDomNode = editor.getDomNode();
          if (!editorDomNode) {
            console.log('No editor DOM node available');
            return;
          }
          
          // Get position from editor
          const position = {
            lineNumber: e.selection.endLineNumber,
            column: e.selection.endColumn
          };
          
          // Use editor's built-in method for coordinate conversion
          const selectionCoords = editor.getScrolledVisiblePosition(position);
          
          if (selectionCoords) {
            // Get accurate DOM position for the selection end
            const editorRect = editorDomNode.getBoundingClientRect();
            
            // Calculate the actual screen position
            const screenLeft = editorRect.left + selectionCoords.left;
            const screenTop = editorRect.top + selectionCoords.top;
            
            // Store absolute screen coordinates
            this.indicatorPosition = {
              top: screenTop,
              left: screenLeft + 10 // Slight offset
            };
            
            // Check window boundaries to ensure the indicator stays visible
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Keep indicator within viewport bounds
            if (this.indicatorPosition.left + 150 > viewportWidth) {
              this.indicatorPosition.left = viewportWidth - 160;
            }
            
            if (this.indicatorPosition.top + 40 > viewportHeight) {
              this.indicatorPosition.top = viewportHeight - 50;
            }
            
            // Show the indicator
            this.showCommentIndicator = true;
            
            // Request an update to ensure UI reflects changes
            this.requestUpdate();
          }
        } catch (error) {
          console.error('Error positioning comment indicator:', error);
        }
      }
    } catch (error) {
      console.error('Error handling selection change:', error);
    }
  }
  
  /**
   * Handle click on the comment indicator
   */
  private handleIndicatorClick(e: Event) {
    try {
      e.stopPropagation();
      e.preventDefault();
      
      this.showCommentBox = true;
      this.commentText = ''; // Reset comment text
      
      // Don't hide the indicator while comment box is shown
      this.showCommentIndicator = true;
      
      // Ensure UI updates
      this.requestUpdate();
    } catch (error) {
      console.error('Error handling indicator click:', error);
    }
  }
  
  /**
   * Handle changes to the comment text
   */
  private handleCommentInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.commentText = target.value;
  }
  
  /**
   * Close the comment box
   */
  private closeCommentBox() {
    this.showCommentBox = false;
    // Also hide the indicator
    this.showCommentIndicator = false;
  }
  
  /**
   * Submit the comment
   */
  private submitComment() {
    try {
      if (!this.selectedText || !this.commentText) {
        console.log('Missing selected text or comment');
        return;
      }
      
      // Get the correct filename based on active editor
      const fileContext = this.activeEditor === 'original' ? 
        this.originalFilename || 'Original file' : 
        this.modifiedFilename || 'Modified file';
      
      // Include editor info to make it clear which version was commented on
      const editorLabel = this.activeEditor === 'original' ? '[Original]' : '[Modified]';
      
      // Format the comment in a readable way
      const formattedComment = `\`\`\`\n${fileContext} ${editorLabel}:\n${this.selectedText}\n\`\`\`\n\n${this.commentText}`;
      
      // Close UI before dispatching to prevent interaction conflicts
      this.closeCommentBox();
      
      // Use setTimeout to ensure the UI has updated before sending the event
      setTimeout(() => {
        try {
          // Dispatch a custom event with the comment details
          const event = new CustomEvent('monaco-comment', {
            detail: {
              fileContext,
              selectedText: this.selectedText,
              commentText: this.commentText,
              formattedComment,
              selectionRange: this.selectionRange,
              activeEditor: this.activeEditor
            },
            bubbles: true,
            composed: true
          });
          
          this.dispatchEvent(event);
        } catch (error) {
          console.error('Error dispatching comment event:', error);
        }
      }, 0);
    } catch (error) {
      console.error('Error submitting comment:', error);
      this.closeCommentBox();
    }
  }

  private updateModels() {
    try {
      // Get language based on filename
      const originalLang = this.getLanguageForFile(this.originalFilename || "");
      const modifiedLang = this.getLanguageForFile(this.modifiedFilename || "");

      // Always create new models with unique URIs based on timestamp to avoid conflicts
      const timestamp = new Date().getTime();
      const originalUri = monaco.Uri.parse(`file:///original-${timestamp}.${originalLang}`);
      const modifiedUri = monaco.Uri.parse(`file:///modified-${timestamp}.${modifiedLang}`);

      // Dispose of old models if they exist
      if (this.originalModel) {
        this.originalModel.dispose();
      }
      
      if (this.modifiedModel) {
        this.modifiedModel.dispose();
      }

      // Create new models
      this.originalModel = monaco.editor.createModel(
        this.originalCode || "",
        originalLang,
        originalUri
      );

      this.modifiedModel = monaco.editor.createModel(
        this.modifiedCode || "",
        modifiedLang,
        modifiedUri
      );

      // Set the models on the editor
      if (this.editor) {
        this.editor.setModel({
          original: this.originalModel,
          modified: this.modifiedModel
        });
      }
    } catch (error) {
      console.error("Error updating Monaco models:", error);
    }
  }

  updated(changedProperties: Map<string, any>) {
    // If any relevant properties changed, just update the models
    if (
      changedProperties.has("originalCode") ||
      changedProperties.has("modifiedCode") ||
      changedProperties.has("originalFilename") ||
      changedProperties.has("modifiedFilename")
    ) {
      if (this.editor) {
        this.updateModels();
        
        // Force layout recalculation after model updates
        setTimeout(() => {
          if (this.editor) {
            this.editor.layout();
          }
        }, 50);
      } else {
        // If the editor isn't initialized yet but we received content,
        // initialize it now
        this.initializeEditor();
      }
    }
  }
  
  // Add resize observer to ensure editor resizes when container changes
  firstUpdated() {
    // Initialize the editor
    this.initializeEditor();
    
    // Create a ResizeObserver to monitor container size changes
    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        if (this.editor) {
          this.editor.layout();
        }
      });
      
      // Start observing the container
      if (this.container.value) {
        resizeObserver.observe(this.container.value);
      }
      
      // Store the observer for cleanup
      this._resizeObserver = resizeObserver;
    }
  }
  
  private _resizeObserver: ResizeObserver | null = null;
  
  disconnectedCallback() {
    super.disconnectedCallback();
    
    try {
      // Clean up resources when element is removed
      if (this.editor) {
        this.editor.dispose();
        this.editor = undefined;
      }
  
      // Dispose models to prevent memory leaks
      if (this.originalModel) {
        this.originalModel.dispose();
        this.originalModel = undefined;
      }
  
      if (this.modifiedModel) {
        this.modifiedModel.dispose();
        this.modifiedModel = undefined;
      }
      
      // Clean up resize observer
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      
      // Remove document click handler if set
      if (this._documentClickHandler) {
        document.removeEventListener('click', this._documentClickHandler);
        this._documentClickHandler = null;
      }
    } catch (error) {
      console.error('Error in disconnectedCallback:', error);
    }
  }

  // disconnectedCallback implementation is defined below
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-monaco-view": CodeDiffEditor;
  }
}
