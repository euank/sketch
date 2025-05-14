import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
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
  `;

  render() {
    return html`
      <style>
        ${monacoStyles}
      </style>
      <main ${ref(this.container)}></main>
    `;
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

  setOptions(value: monaco.editor.IDiffEditorConstructionOptions) {
    this.editor!.updateOptions(value);
  }

  // Static URIs for consistency to avoid creating many models
  private static readonly ORIGINAL_URI = monaco.Uri.parse(
    "internal://original",
  );
  private static readonly MODIFIED_URI = monaco.Uri.parse(
    "internal://modified",
  );
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
        });

        console.log("Monaco diff editor created");
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

  private updateModels() {
    // Get or create models
    const originalLang = this.getLanguageForFile(this.originalFilename || "");
    const modifiedLang = this.getLanguageForFile(this.modifiedFilename || "");

    // Create or reuse original model
    if (!this.originalModel) {
      const existingModel = monaco.editor.getModel(CodeDiffEditor.ORIGINAL_URI);
      if (existingModel) {
        existingModel.dispose();
      }
      this.originalModel = monaco.editor.createModel(
        this.originalCode || "",
        originalLang,
        CodeDiffEditor.ORIGINAL_URI,
      );
    } else {
      // Update existing model
      this.originalModel.setValue(this.originalCode || "");
      monaco.editor.setModelLanguage(this.originalModel, originalLang);
    }

    // Create or reuse modified model
    if (!this.modifiedModel) {
      const existingModel = monaco.editor.getModel(CodeDiffEditor.MODIFIED_URI);
      if (existingModel) {
        existingModel.dispose();
      }
      this.modifiedModel = monaco.editor.createModel(
        this.modifiedCode || "",
        modifiedLang,
        CodeDiffEditor.MODIFIED_URI,
      );
    } else {
      // Update existing model
      this.modifiedModel.setValue(this.modifiedCode || "");
      monaco.editor.setModelLanguage(this.modifiedModel, modifiedLang);
    }

    // Update editor models
    if (this.editor) {
      this.editor.setModel({
        original: this.originalModel,
        modified: this.modifiedModel,
      });
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
  }

  // disconnectedCallback implementation is defined below
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-monaco-view": CodeDiffEditor;
  }
}
