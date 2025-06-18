import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ThemeManager, Theme } from "../theme";

@customElement("sketch-theme-toggle")
export class SketchThemeToggle extends LitElement {
  @state()
  private currentTheme: Theme = 'light';
  
  private themeManager = ThemeManager.getInstance();
  
  static styles = css`
    :host {
      display: flex;
      align-items: center;
    }
    
    .theme-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 6px;
      transition: background-color 0.2s ease;
      color: var(--text-secondary);
    }
    
    .theme-toggle:hover {
      background-color: var(--bg-accent);
      color: var(--text-primary);
    }
    
    .theme-toggle svg {
      width: 18px;
      height: 18px;
      transition: transform 0.2s ease;
    }
    
    .theme-toggle:hover svg {
      transform: scale(1.1);
    }
    
    /* Hide sun icon when in dark mode */
    :host(.theme-dark) .sun-icon {
      display: none;
    }
    
    /* Hide moon icon when in light mode */
    :host(.theme-light) .moon-icon {
      display: none;
    }
  `;
  
  connectedCallback() {
    super.connectedCallback();
    this.currentTheme = this.themeManager.getCurrentTheme();
    this.updateHostClass();
    
    // Listen for theme changes
    this.themeManager.addListener(this.handleThemeChange.bind(this));
  }
  
  disconnectedCallback() {
    super.disconnectedCallback();
    this.themeManager.removeListener(this.handleThemeChange.bind(this));
  }
  
  private handleThemeChange(theme: Theme) {
    this.currentTheme = theme;
    this.updateHostClass();
  }
  
  private updateHostClass() {
    this.classList.remove('theme-light', 'theme-dark');
    this.classList.add(`theme-${this.currentTheme}`);
  }
  
  private handleToggle() {
    this.themeManager.toggleTheme();
  }
  
  render() {
    const title = `Switch to ${this.currentTheme === 'light' ? 'dark' : 'light'} mode`;
    
    return html`
      <button 
        class="theme-toggle" 
        @click=${this.handleToggle}
        title="${title}"
        aria-label="${title}"
      >
        <!-- Sun icon for light mode -->
        <svg class="sun-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
        
        <!-- Moon icon for dark mode -->
        <svg class="moon-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sketch-theme-toggle": SketchThemeToggle;
  }
}
