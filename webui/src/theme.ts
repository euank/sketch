// Theme management system for Sketch
// Provides centralized theme switching and color management

export type Theme = 'light' | 'dark';

// Color definitions for both themes
export const themes = {
  light: {
    // Base colors
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f5f5f5',
    '--bg-tertiary': '#fafafa',
    '--bg-accent': '#e0e0e0',
    
    // Text colors
    '--text-primary': '#333333',
    '--text-secondary': '#666666',
    '--text-tertiary': '#999999',
    '--text-inverse': '#ffffff',
    
    // Border colors
    '--border-primary': '#e0e0e0',
    '--border-secondary': '#eeeee',
    '--border-focus': '#4285f4',
    
    // Interactive colors
    '--accent-primary': '#4285f4',
    '--accent-hover': '#3367d6',
    '--accent-disabled': '#a9acaf',
    
    // Status colors
    '--success': '#28a745',
    '--success-bg': 'rgba(40, 167, 69, 0.1)',
    '--warning': '#f0ad4e',
    '--warning-bg': 'rgba(240, 173, 78, 0.1)',
    '--error': '#dc3545',
    '--error-bg': 'rgba(220, 53, 69, 0.1)',
    '--info': '#5bc0de',
    '--info-bg': 'rgba(91, 192, 222, 0.1)',
    
    // Monaco editor specific
    '--monaco-editor-bg': '#ffffff',
    '--monaco-editor-margin': '#f5f5f5',
    
    // Shadows
    '--shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.1)',
    '--shadow-md': '0 2px 10px rgba(0, 0, 0, 0.1)',
    '--shadow-lg': '0 3px 10px rgba(0, 0, 0, 0.15)',
    
    // Component specific
    '--banner-bg': '#ffffff',
    '--timeline-bg': '#ffffff',
    '--chat-input-bg': '#ffffff',
    '--todo-panel-bg': '#fafafa',
    '--todo-panel-gradient': 'linear-gradient(to bottom, #fafafa 0%, #fafafa 90%, rgba(250, 250, 250, 0.5) 95%, rgba(250, 250, 250, 0.2) 100%)',
  },
  dark: {
    // Base colors
    '--bg-primary': '#1e1e1e',
    '--bg-secondary': '#2d2d2d',
    '--bg-tertiary': '#383838',
    '--bg-accent': '#4a4a4a',
    
    // Text colors
    '--text-primary': '#e0e0e0',
    '--text-secondary': '#b0b0b0',
    '--text-tertiary': '#888888',
    '--text-inverse': '#1e1e1e',
    
    // Border colors
    '--border-primary': '#4a4a4a',
    '--border-secondary': '#383838',
    '--border-focus': '#5a9fd4',
    
    // Interactive colors
    '--accent-primary': '#5a9fd4',
    '--accent-hover': '#4a8bc2',
    '--accent-disabled': '#666666',
    
    // Status colors
    '--success': '#4ade80',
    '--success-bg': 'rgba(74, 222, 128, 0.15)',
    '--warning': '#fbbf24',
    '--warning-bg': 'rgba(251, 191, 36, 0.15)',
    '--error': '#f87171',
    '--error-bg': 'rgba(248, 113, 113, 0.15)',
    '--info': '#60a5fa',
    '--info-bg': 'rgba(96, 165, 250, 0.15)',
    
    // Monaco editor specific
    '--monaco-editor-bg': '#1e1e1e',
    '--monaco-editor-margin': '#2d2d2d',
    
    // Shadows
    '--shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.3)',
    '--shadow-md': '0 2px 10px rgba(0, 0, 0, 0.3)',
    '--shadow-lg': '0 3px 10px rgba(0, 0, 0, 0.4)',
    
    // Component specific
    '--banner-bg': '#2d2d2d',
    '--timeline-bg': '#1e1e1e',
    '--chat-input-bg': '#2d2d2d',
    '--todo-panel-bg': '#2d2d2d',
    '--todo-panel-gradient': 'linear-gradient(to bottom, #2d2d2d 0%, #2d2d2d 90%, rgba(45, 45, 45, 0.5) 95%, rgba(45, 45, 45, 0.2) 100%)',
  }
};

// Theme manager class
export class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: Theme = 'light';
  private listeners: ((theme: Theme) => void)[] = [];
  
  private constructor() {
    this.loadTheme();
    this.applyTheme();
    
    // Listen for system theme changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', this.handleSystemThemeChange.bind(this));
    }
  }
  
  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }
  
  getCurrentTheme(): Theme {
    return this.currentTheme;
  }
  
  setTheme(theme: Theme): void {
    this.currentTheme = theme;
    this.saveTheme();
    this.applyTheme();
    this.notifyListeners();
  }
  
  toggleTheme(): void {
    this.setTheme(this.currentTheme === 'light' ? 'dark' : 'light');
  }
  
  addListener(listener: (theme: Theme) => void): void {
    this.listeners.push(listener);
  }
  
  removeListener(listener: (theme: Theme) => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }
  
  private loadTheme(): void {
    if (typeof window === 'undefined') return;
    
    try {
      const saved = localStorage.getItem('sketch-theme');
      if (saved === 'light' || saved === 'dark') {
        this.currentTheme = saved;
      } else {
        // Default to system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.currentTheme = prefersDark ? 'dark' : 'light';
      }
    } catch (error) {
      console.error('Error loading theme preference:', error);
    }
  }
  
  private saveTheme(): void {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem('sketch-theme', this.currentTheme);
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }
  
  private applyTheme(): void {
    if (typeof document === 'undefined') return;
    
    const themeVars = themes[this.currentTheme];
    const root = document.documentElement;
    
    // Apply all theme variables to the root element
    Object.entries(themeVars).forEach(([property, value]) => {
      root.style.setProperty(property, value);
    });
    
    // Add theme class to body for component-specific styling
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${this.currentTheme}`);
  }
  
  private handleSystemThemeChange(event: MediaQueryListEvent): void {
    // Only auto-switch if user hasn't manually set a preference
    const hasManualPreference = localStorage.getItem('sketch-theme');
    if (!hasManualPreference) {
      this.setTheme(event.matches ? 'dark' : 'light');
    }
  }
  
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.currentTheme));
  }
}

// Initialize theme manager when module is imported
if (typeof window !== 'undefined') {
  ThemeManager.getInstance();
}
