import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { createRef, Ref, ref } from "lit/directives/ref.js";

// See https://rodydavis.com/posts/lit-monaco-editor for some ideas.

import * as monaco from "monaco-editor";

// Define Monaco CSS styles as a string constant
const monacoStyles = `
  /* Import Monaco editor styles */
  @import url('/static/monaco/min/vs/editor/editor.main.css');
  
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
self.MonacoEnvironment = {
  getWorkerUrl: function (_moduleId, label) {
    if (label === "json") {
      return "/static/language/json/json.worker.js";
    }
    if (label === "css" || label === "scss" || label === "less") {
      return "/static/language/css/css.worker.js";
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return "/static/language/html/html.worker.js";
    }
    if (label === "typescript" || label === "javascript") {
      return "/static/language/typescript/ts.worker.js";
    }
    return "/static/editor/editor.worker.js";
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
      --editor-height: 500px;
      display: block;
    }
    main {
      width: var(--editor-width);
      height: var(--editor-height);
      border: 1px solid #e0e0e0;
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
    if (this.editor) {
      const model = this.editor.getOriginalEditor().getModel();
      if (model) {
        model.setValue(code);
        if (filename) {
          monaco.editor.setModelLanguage(model, this.getLanguageForFile(filename));
        }
      }
    }
    this.originalCode = code;
    if (filename) {
      this.originalFilename = filename;
    }
  }

  setModifiedCode(code: string, filename?: string) {
    if (this.editor) {
      const model = this.editor.getModifiedEditor().getModel();
      if (model) {
        model.setValue(code);
        if (filename) {
          monaco.editor.setModelLanguage(model, this.getLanguageForFile(filename));
        }
      }
    }
    this.modifiedCode = code;
    if (filename) {
      this.modifiedFilename = filename;
    }
  }

  private getLanguageForFile(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown',
      'go': 'go'
    };
    return langMap[extension] || this.language || 'plaintext';
  }

  setOptions(value: monaco.editor.IDiffEditorConstructionOptions) {
    this.editor!.updateOptions(value);
  }

  firstUpdated() {
    // Create both original and modified models
    const originalModel = monaco.editor.createModel(
      this.originalCode || '',
      this.getLanguageForFile(this.originalFilename || ''),
      monaco.Uri.parse(this.originalFilename || 'original')
    );

    const modifiedModel = monaco.editor.createModel(
      this.modifiedCode || '',
      this.getLanguageForFile(this.modifiedFilename || ''),
      monaco.Uri.parse(this.modifiedFilename || 'modified')
    );

    // Create the diff editor
    this.editor = monaco.editor.createDiffEditor(this.container.value!, {
      automaticLayout: true,
      readOnly: this.readOnly ?? false,
      theme: 'vs', // Always use light mode
      renderSideBySide: true,
      ignoreTrimWhitespace: false
    });

    // Set the models
    this.editor.setModel({
      original: originalModel,
      modified: modifiedModel
    });
    
    console.log('Monaco diff editor initialized');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-monaco-view": CodeDiffEditor;
  }
}
