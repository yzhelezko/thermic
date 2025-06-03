/**
 * Theme Manager - Handles theme switching and icon updates
 */

import { getThemeToggleIcon, updateThemeToggleIcon, updateAllIconsToInline } from '../utils/icons.js';

class ThemeManager {
    constructor() {
        this.currentTheme = this.detectCurrentTheme();
        this.observers = [];
        this.isInitialized = false;
        // Don't call init() automatically - let it be called when DOM is ready
    }

    async init() {
        if (this.isInitialized) {
            console.warn('ThemeManager already initialized');
            return;
        }
        
        // Load saved theme from config first
        await this.loadThemeFromConfig();
        
        // Listen for theme changes
        this.setupThemeToggleButton();
        this.setupThemeObserver();
        await this.updateThemeIcons();
        this.isInitialized = true;
        
        console.log('✅ ThemeManager fully initialized with theme:', this.currentTheme);
    }

    async loadThemeFromConfig() {
        console.log('Loading theme from backend config...');
        try {
            // Try to load theme from backend config
            if (window.go?.main?.App?.ConfigGet) {
                const savedTheme = await window.go.main.App.ConfigGet("Theme");
                console.log('Loaded theme from config:', savedTheme);
                
                if (savedTheme && (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system')) {
                    // Handle 'system' theme by detecting system preference
                    let themeToApply = savedTheme;
                    if (savedTheme === 'system') {
                        themeToApply = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                        console.log('System theme detected as:', themeToApply);
                    }
                    
                    // Apply the theme to DOM immediately
                    document.documentElement.setAttribute('data-theme', themeToApply);
                    document.body.classList.toggle('dark-mode', themeToApply === 'dark');
                    
                    this.currentTheme = themeToApply;
                    console.log('✅ Applied theme from config:', themeToApply);
                    return;
                }
            } else {
                console.warn('ConfigGet not available - Wails bindings not ready yet');
            }
        } catch (error) {
            console.warn('Failed to load theme from config:', error);
        }
        
        // Fallback to detecting current theme
        console.log('Falling back to theme detection...');
        this.currentTheme = this.detectCurrentTheme();
        
        // Apply detected theme to DOM to ensure consistency
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        document.body.classList.toggle('dark-mode', this.currentTheme === 'dark');
        console.log('Applied fallback theme:', this.currentTheme);
    }

    detectCurrentTheme() {
        // Check data-theme attribute first
        const dataTheme = document.documentElement.getAttribute('data-theme');
        if (dataTheme) {
            return dataTheme;
        }

        // Check for dark-mode class
        if (document.body.classList.contains('dark-mode')) {
            return 'dark';
        }

        // Check system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }

        return 'light';
    }

    setupThemeToggleButton() {
        const themeToggleBtn = document.getElementById('theme-toggle');
        if (themeToggleBtn) {
            // Remove any existing listener to prevent duplicates
            themeToggleBtn.removeEventListener('click', this.themeToggleHandler);
            
            // Create bound handler if it doesn't exist
            if (!this.themeToggleHandler) {
                this.themeToggleHandler = () => this.toggleTheme();
            }
            
            themeToggleBtn.addEventListener('click', this.themeToggleHandler);
            console.log('✅ Theme toggle button event listener attached');
        } else {
            console.warn('❌ Theme toggle button not found in DOM');
        }
    }
    
    // Method to re-initialize theme toggle button (useful for late DOM initialization)
    reinitializeThemeToggleButton() {
        this.setupThemeToggleButton();
    }
    
    // Method to force update theme icons (useful for ensuring icons are set correctly)
    async forceUpdateThemeIcons() {
        await this.updateThemeIcons();
    }

    setupThemeObserver() {
        // Watch for changes to the data-theme attribute
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    this.currentTheme = this.detectCurrentTheme();
                    this.updateThemeIcons();
                    this.notifyObservers();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });

        // Watch for class changes on body
        const bodyObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const newTheme = this.detectCurrentTheme();
                    if (newTheme !== this.currentTheme) {
                        this.currentTheme = newTheme;
                        this.updateThemeIcons();
                        this.notifyObservers();
                    }
                }
            });
        });

        bodyObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });

        // Listen for system theme changes
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', () => {
                if (!document.documentElement.getAttribute('data-theme')) {
                    this.currentTheme = this.detectCurrentTheme();
                    this.updateThemeIcons();
                    this.notifyObservers();
                }
            });
        }
    }

    async toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        await this.setTheme(newTheme);
    }

    async setTheme(theme) {
        // Set the theme attribute
        document.documentElement.setAttribute('data-theme', theme);
        
        // Update body class for compatibility
        document.body.classList.toggle('dark-mode', theme === 'dark');
        
        // Save to backend config first (preferred)
        try {
            if (window.go?.main?.App?.ConfigSet) {
                await window.go.main.App.ConfigSet("Theme", theme);
                console.log('✅ Theme saved to backend config:', theme);
            } else {
                console.warn('ConfigSet not available - theme change will not persist');
            }
        } catch (error) {
            console.error('Failed to save theme to backend config:', error);
        }
        
        // Also store in localStorage as fallback
        try {
            localStorage.setItem('theme', theme);
        } catch (e) {
            console.warn('Could not save theme preference to localStorage:', e);
        }

        this.currentTheme = theme;
        await this.updateThemeIcons();
        this.notifyObservers();
    }

    async updateThemeIcons() {
        try {
            // Update theme toggle button icon with explicit theme state
            const themeToggleBtn = document.getElementById('theme-toggle');
            if (themeToggleBtn) {
                await updateThemeToggleIcon(themeToggleBtn, this.currentTheme === 'dark');
            }

            // Update any other theme-aware icons with explicit theme state
            const themeIcons = document.querySelectorAll('.theme-toggle-icon');
            for (const icon of themeIcons) {
                await updateThemeToggleIcon(icon, this.currentTheme === 'dark');
            }
            
            // Update all other icons to inline SVGs for proper theme support
            await updateAllIconsToInline();
        } catch (error) {
            console.error('Error updating theme icons:', error);
        }
    }

    addObserver(callback) {
        this.observers.push(callback);
    }

    removeObserver(callback) {
        this.observers = this.observers.filter(obs => obs !== callback);
    }

    notifyObservers() {
        this.observers.forEach(callback => {
            try {
                callback(this.currentTheme);
            } catch (e) {
                console.error('Theme observer error:', e);
            }
        });
    }

    getCurrentTheme() {
        return this.currentTheme;
    }

    isDarkMode() {
        return this.currentTheme === 'dark';
    }

    isLightMode() {
        return this.currentTheme === 'light';
    }
}

// Create and export singleton instance
export const themeManager = new ThemeManager();

// Export class for testing or custom instances
export { ThemeManager }; 