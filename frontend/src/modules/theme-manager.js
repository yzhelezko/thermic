/**
 * Theme Manager - Handles theme switching and icon updates
 */

import { getThemeToggleIcon, updateThemeToggleIcon, updateAllIconsToInline } from '../utils/icons.js';

class ThemeManager {
    constructor() {
        this.currentTheme = this.detectCurrentTheme();
        this.observers = [];
        this.init();
    }

    async init() {
        // Listen for theme changes
        this.setupThemeToggleButton();
        this.setupThemeObserver();
        await this.updateThemeIcons();
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
            themeToggleBtn.addEventListener('click', () => {
                this.toggleTheme();
            });
        }
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
        
        // Store preference
        try {
            localStorage.setItem('theme', theme);
        } catch (e) {
            console.warn('Could not save theme preference:', e);
        }

        this.currentTheme = theme;
        await this.updateThemeIcons();
        this.notifyObservers();
    }

    async updateThemeIcons() {
        try {
            // Update theme toggle button icon
            const themeToggleBtn = document.getElementById('theme-toggle');
            if (themeToggleBtn) {
                await updateThemeToggleIcon(themeToggleBtn);
            }

            // Update any other theme-aware icons
            const themeIcons = document.querySelectorAll('.theme-toggle-icon');
            for (const icon of themeIcons) {
                await updateThemeToggleIcon(icon);
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