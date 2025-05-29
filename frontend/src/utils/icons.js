/**
 * Icon utility for loading SVG icons
 */

// Map of emoji to SVG file names
const EMOJI_TO_ICON = {
    '🖥️': 'terminal',
    '🎨': 'palette', 
    '⚙️': 'settings',
    'ℹ️': 'info',
    '❌': 'error',
    '⚠️': 'warning',
    '✅': 'success',
    '🔔': 'bell',
    '⭐': 'star',
    '🔧': 'wrench',
    '🛠️': 'tools',
    '💻': 'laptop',
    '🚀': 'rocket',
    '⚡': 'lightning',
    '🔥': 'fire',
    '✨': 'sparkles',
    '🔒': 'lock',
    '⌨️': 'keyboard',
    '📜': 'document',
    '📁': 'folder',
    '📂': 'folder-open',
    '🔗': 'link',
    '🔤': 'text',
    '📐': 'ruler',
    '🔄': 'refresh',
    '📤': 'export',
    '🐛': 'bug',
    '🙏': 'heart',
    '📋': 'clipboard',
    '📄': 'page',
    '🗑️': 'trash',
    '⬆️': 'arrow-up',
    '⬇️': 'arrow-down',
    '➕': 'plus',
    '🔍': 'search',
    '✏️': 'edit',
    '📑': 'copy',
    '📝': 'rename',
    '🗂️': 'files',
    '🌐': 'globe'
};

// Cache for loaded SVG content
const svgCache = new Map();

/**
 * Check if the app is in dark mode
 * @returns {boolean} - Whether dark mode is active
 */
function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ||
           document.body.classList.contains('dark-mode') ||
           (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/**
 * Get the SVG path for an emoji
 * @param {string} emoji - The emoji to convert
 * @returns {string} - The SVG file path
 */
export function getIconPath(emoji) {
    const iconName = EMOJI_TO_ICON[emoji];
    if (!iconName) {
        console.warn(`No SVG icon found for emoji: ${emoji}`);
        return null;
    }
    return `/src/assets/icons/${iconName}.svg`;
}

/**
 * Get the appropriate theme toggle icon based on current theme
 * @returns {string} - Path to sun or moon icon
 */
export function getThemeToggleIcon() {
    return isDarkMode() ? '/src/assets/icons/sun.svg' : '/src/assets/icons/moon.svg';
}

/**
 * Load and cache SVG content
 * @param {string} iconName - The icon name (without .svg extension)
 * @returns {Promise<string>} - The SVG content as a string
 */
export async function loadSvgContent(iconName) {
    if (svgCache.has(iconName)) {
        return svgCache.get(iconName);
    }
    
    try {
        const response = await fetch(`/src/assets/icons/${iconName}.svg`);
        if (!response.ok) {
            throw new Error(`Failed to load SVG: ${response.status}`);
        }
        const svgContent = await response.text();
        svgCache.set(iconName, svgContent);
        return svgContent;
    } catch (error) {
        console.error(`Failed to load SVG ${iconName}:`, error);
        return null;
    }
}

/**
 * Create an inline SVG icon element that responds to theme changes
 * @param {string} emoji - The emoji to convert
 * @param {string} className - CSS class to apply
 * @returns {Promise<string>} - HTML string for the inline SVG icon
 */
export async function createInlineIconElement(emoji, className = '') {
    const iconName = EMOJI_TO_ICON[emoji];
    if (!iconName) {
        return `<span class="${className}">${emoji}</span>`;
    }
    
    const svgContent = await loadSvgContent(iconName);
    if (!svgContent) {
        return `<span class="${className}">${emoji}</span>`;
    }
    
    // Add classes to the SVG element
    const svgWithClasses = svgContent.replace(
        '<svg',
        `<svg class="svg-icon inline-svg-icon ${className}"`
    );
    
    return svgWithClasses;
}

/**
 * Create an SVG icon element (fallback to img for compatibility)
 * @param {string} emoji - The emoji to convert
 * @param {string} className - CSS class to apply
 * @returns {string} - HTML string for the SVG icon
 */
export function createIconElement(emoji, className = '') {
    const iconPath = getIconPath(emoji);
    if (!iconPath) {
        return `<span class="${className}">${emoji}</span>`;
    }
    
    // For now, we'll use a simple approach with fetch
    // In a real app, you might want to preload these or use a build-time solution
    return `<img src="${iconPath}" class="svg-icon ${className}" alt="${emoji}">`;
}

/**
 * Replace emojis in HTML string with inline SVG icons
 * @param {string} html - HTML string containing emojis
 * @returns {Promise<string>} - HTML string with emojis replaced by inline SVG icons
 */
export async function replaceEmojisWithInlineIcons(html) {
    let result = html;
    
    for (const emoji of Object.keys(EMOJI_TO_ICON)) {
        if (result.includes(emoji)) {
            const iconHtml = await createInlineIconElement(emoji);
            result = result.replace(new RegExp(emoji, 'g'), iconHtml);
        }
    }
    
    return result;
}

/**
 * Replace emojis in HTML string with SVG icons
 * @param {string} html - HTML string containing emojis
 * @returns {string} - HTML string with emojis replaced by SVG icons
 */
export function replaceEmojisWithIcons(html) {
    let result = html;
    
    Object.keys(EMOJI_TO_ICON).forEach(emoji => {
        const iconPath = getIconPath(emoji);
        if (iconPath) {
            const iconHtml = `<img src="${iconPath}" class="svg-icon" alt="${emoji}">`;
            result = result.replace(new RegExp(emoji, 'g'), iconHtml);
        }
    });
    
    return result;
}

/**
 * Update theme toggle icon when theme changes
 * @param {HTMLElement} element - The element containing the theme toggle icon
 */
export async function updateThemeToggleIcon(element) {
    const isDark = isDarkMode();
    const iconName = isDark ? 'sun' : 'moon';
    const altText = isDark ? 'Toggle to light mode' : 'Toggle to dark mode';
    
    try {
        const svgContent = await loadSvgContent(iconName);
        if (svgContent) {
            // Replace the content with inline SVG
            const svgWithClasses = svgContent.replace(
                '<svg',
                `<svg class="svg-icon theme-toggle-icon" alt="${altText}" width="20" height="20"`
            );
            element.innerHTML = svgWithClasses;
        } else {
            // Fallback to img
            const iconPath = `/src/assets/icons/${iconName}.svg`;
            element.innerHTML = `<img src="${iconPath}" class="svg-icon" alt="${altText}" width="20" height="20">`;
        }
    } catch (error) {
        console.error('Error updating theme toggle icon:', error);
        // Fallback to img
        const iconPath = isDark ? '/src/assets/icons/sun.svg' : '/src/assets/icons/moon.svg';
        element.innerHTML = `<img src="${iconPath}" class="svg-icon" alt="${altText}" width="20" height="20">`;
    }
}

/**
 * Get inline SVG content for an emoji (for better performance)
 * This would typically be done at build time
 */
export async function getInlineSvg(emoji) {
    const iconName = EMOJI_TO_ICON[emoji];
    if (!iconName) {
        return null;
    }
    
    return await loadSvgContent(iconName);
}

/**
 * Get all available emoji-to-icon mappings
 * @returns {Object} - Object with emoji keys and icon name values
 */
export function getAvailableIcons() {
    return { ...EMOJI_TO_ICON };
}

/**
 * Initialize the theme toggle icon based on current theme
 * This should be called on page load
 */
export async function initializeThemeToggleIcon() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) {
        console.warn('Theme toggle button not found during initialization');
        return;
    }
    
    await updateThemeToggleIcon(themeToggle);
}

/**
 * Update all SVG icons to use inline SVGs for proper theme support
 */
export async function updateAllIconsToInline() {
    const imgIcons = document.querySelectorAll('.svg-icon[src*="/src/assets/icons/"]');
    
    for (const img of imgIcons) {
        // Skip theme toggle as it's handled separately
        if (img.closest('#theme-toggle')) continue;
        
        const src = img.src;
        const iconName = src.split('/').pop().replace('.svg', '');
        
        try {
            const svgContent = await loadSvgContent(iconName);
            if (svgContent) {
                const svgWithClasses = svgContent.replace(
                    '<svg',
                    `<svg class="${img.className}"`
                );
                
                // Replace the img element with inline SVG
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = svgWithClasses;
                const svgElement = tempDiv.firstElementChild;
                
                img.parentNode.replaceChild(svgElement, img);
            }
        } catch (error) {
            console.warn(`Failed to convert ${iconName} to inline SVG:`, error);
        }
    }
}

/**
 * Debug function to check current theme state
 */
export function debugThemeState() {
    const theme = document.documentElement.getAttribute('data-theme') || 'not set';
    const bodyTheme = document.body.getAttribute('data-theme') || 'not set';
    const hasDarkClass = document.body.classList.contains('dark-mode');
    
    console.log('Theme Debug:', {
        htmlDataTheme: theme,
        bodyDataTheme: bodyTheme,
        hasDarkModeClass: hasDarkClass,
        isDarkMode: isDarkMode()
    });
    
    return {
        htmlDataTheme: theme,
        bodyDataTheme: bodyTheme,
        hasDarkModeClass: hasDarkClass,
        isDarkMode: isDarkMode()
    };
}

/**
 * Test function to verify theme switching
 * Call from browser console: testIconThemes()
 */
export function testIconThemes() {
    console.log('🎨 Testing icon theme system...');
    
    // Get current theme
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'not set';
    console.log('Current theme:', currentTheme);
    
    // Get CSS custom property values
    const rootStyles = getComputedStyle(document.documentElement);
    const iconFilter = rootStyles.getPropertyValue('--icon-filter').trim();
    const hoverFilter = rootStyles.getPropertyValue('--icon-hover-filter').trim();
    const activeFilter = rootStyles.getPropertyValue('--icon-active-filter').trim();
    const iconColor = rootStyles.getPropertyValue('--icon-color').trim();
    
    console.log('CSS Variables:', {
        iconFilter,
        hoverFilter,
        activeFilter,
        iconColor
    });
    
    // Test an icon element
    const testIcon = document.querySelector('.svg-icon');
    if (testIcon) {
        const computedStyle = getComputedStyle(testIcon);
        console.log('Test icon filter:', computedStyle.filter);
        console.log('Test icon color:', computedStyle.color);
        console.log('Test icon element:', testIcon);
        console.log('Is inline SVG:', !testIcon.hasAttribute('src'));
    }
    
    // Count different types of icons
    const imgIcons = document.querySelectorAll('.svg-icon[src]');
    const inlineIcons = document.querySelectorAll('.svg-icon:not([src])');
    console.log(`Found ${imgIcons.length} img-based icons and ${inlineIcons.length} inline SVG icons`);
    
    // Test theme toggle
    console.log('Testing theme toggle...');
    const themeButton = document.getElementById('theme-toggle');
    if (themeButton) {
        console.log('Theme toggle button found, simulating click...');
        themeButton.click();
        
        setTimeout(() => {
            const newTheme = document.documentElement.getAttribute('data-theme');
            console.log('New theme after toggle:', newTheme);
            
            const newIconFilter = getComputedStyle(document.documentElement).getPropertyValue('--icon-filter').trim();
            const newIconColor = getComputedStyle(document.documentElement).getPropertyValue('--icon-color').trim();
            console.log('New icon filter:', newIconFilter);
            console.log('New icon color:', newIconColor);
        }, 100);
    } else {
        console.error('Theme toggle button not found!');
    }
}

// Expose test function globally for console access
window.testIconThemes = testIconThemes;

/**
 * Initialize all icons in the UI (can be called on page load)
 */
export async function initializeIcons() {
    await initializeThemeToggleIcon();
    
    // Debug theme state on initialization
    console.log('Initializing icons with theme state:');
    debugThemeState();
    
    // Expose debug function globally
    window.debugThemeState = debugThemeState;
    
    // You can add more icon initialization here as needed
    // For example, updating any dynamic icon selectors, status icons, etc.
}

/**
 * Test function specifically for settings panel theme integration
 * Call from browser console: testSettingsThemeIntegration()
 */
export function testSettingsThemeIntegration() {
    console.log('🔧 Testing settings panel theme integration...');
    
    // Check if settings panel exists
    const settingsPanel = document.querySelector('.settings-panel');
    const settingsOverlay = document.getElementById('settings-overlay');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    
    console.log('Settings panel found:', !!settingsPanel);
    console.log('Settings overlay found:', !!settingsOverlay);
    console.log('Dark mode toggle found:', !!darkModeToggle);
    
    if (darkModeToggle) {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        console.log('Current theme:', currentTheme);
        console.log('Toggle checked:', darkModeToggle.checked);
        console.log('Toggle matches theme:', darkModeToggle.checked === (currentTheme === 'dark'));
    }
    
    // Count icons in settings panel
    if (settingsPanel) {
        const imgIcons = settingsPanel.querySelectorAll('.svg-icon[src]');
        const inlineIcons = settingsPanel.querySelectorAll('.svg-icon:not([src])');
        console.log(`Settings panel has ${imgIcons.length} img-based icons and ${inlineIcons.length} inline SVG icons`);
    }
    
    // Test the integration
    if (darkModeToggle && settingsOverlay && !settingsOverlay.classList.contains('active')) {
        console.log('Opening settings panel to test integration...');
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.click();
            
            setTimeout(() => {
                console.log('Settings panel should be open now. Testing theme toggle...');
                
                // Test the toggle
                const originalChecked = darkModeToggle.checked;
                console.log('Simulating dark mode toggle click...');
                darkModeToggle.click();
                
                setTimeout(() => {
                    const newTheme = document.documentElement.getAttribute('data-theme');
                    const newChecked = darkModeToggle.checked;
                    console.log('After toggle - Theme:', newTheme, 'Toggle checked:', newChecked);
                    console.log('Theme change successful:', originalChecked !== newChecked);
                    
                    // Check if icons updated
                    const newImgIcons = settingsPanel.querySelectorAll('.svg-icon[src]');
                    const newInlineIcons = settingsPanel.querySelectorAll('.svg-icon:not([src])');
                    console.log(`After toggle - ${newImgIcons.length} img-based icons and ${newInlineIcons.length} inline SVG icons`);
                }, 500);
            }, 500);
        }
    } else if (settingsOverlay?.classList.contains('active')) {
        console.log('Settings panel already open, testing toggle directly...');
        if (darkModeToggle) {
            const originalChecked = darkModeToggle.checked;
            console.log('Simulating dark mode toggle click...');
            darkModeToggle.click();
            
            setTimeout(() => {
                const newTheme = document.documentElement.getAttribute('data-theme');
                const newChecked = darkModeToggle.checked;
                console.log('After toggle - Theme:', newTheme, 'Toggle checked:', newChecked);
                console.log('Theme change successful:', originalChecked !== newChecked);
            }, 500);
        }
    }
}

// Expose test function globally for console access
window.testSettingsThemeIntegration = testSettingsThemeIntegration;

/**
 * Test function to verify theme toggle is working correctly
 * Call from browser console: testThemeToggle()
 */
export function testThemeToggle() {
    console.log('🔄 Testing theme toggle functionality...');
    
    const themeToggle = document.getElementById('theme-toggle');
    const currentTheme = document.documentElement.getAttribute('data-theme');
    
    console.log('Theme toggle button found:', !!themeToggle);
    console.log('Current theme before toggle:', currentTheme);
    
    if (themeToggle) {
        // Simulate click
        themeToggle.click();
        
        // Check theme after click
        setTimeout(() => {
            const newTheme = document.documentElement.getAttribute('data-theme');
            console.log('Theme after toggle:', newTheme);
            console.log('Toggle successful:', currentTheme !== newTheme);
            
            // Test second click
            setTimeout(() => {
                console.log('Testing second click...');
                const beforeSecondClick = document.documentElement.getAttribute('data-theme');
                themeToggle.click();
                
                setTimeout(() => {
                    const afterSecondClick = document.documentElement.getAttribute('data-theme');
                    console.log('Theme before second click:', beforeSecondClick);
                    console.log('Theme after second click:', afterSecondClick);
                    console.log('Second toggle successful:', beforeSecondClick !== afterSecondClick);
                    console.log('✅ Theme toggle test completed');
                }, 500);
            }, 1000);
        }, 500);
    } else {
        console.error('❌ Theme toggle button not found!');
    }
}

// Make the test function globally available
if (typeof window !== 'undefined') {
    window.testThemeToggle = testThemeToggle;
}

/**
 * Test function to verify theme configuration system is working
 * Call from browser console: testThemeConfig()
 */
export async function testThemeConfig() {
    console.log('🔧 Testing theme configuration system...');
    
    try {
        // Test GetTheme
        if (window.go?.main?.App?.GetTheme) {
            const currentTheme = await window.go.main.App.GetTheme();
            console.log('Current theme from config:', currentTheme);
            
            // Test SetTheme
            if (window.go?.main?.App?.SetTheme) {
                const testTheme = currentTheme === 'dark' ? 'light' : 'dark';
                console.log('Testing theme change to:', testTheme);
                
                await window.go.main.App.SetTheme(testTheme);
                console.log('Theme set successfully');
                
                // Verify the change
                const newTheme = await window.go.main.App.GetTheme();
                console.log('New theme from config:', newTheme);
                console.log('Theme change successful:', newTheme === testTheme);
                
                // Revert back
                setTimeout(async () => {
                    await window.go.main.App.SetTheme(currentTheme);
                    console.log('Reverted theme back to:', currentTheme);
                    console.log('✅ Theme configuration test completed');
                }, 2000);
            } else {
                console.error('❌ SetTheme method not available');
            }
        } else {
            console.error('❌ GetTheme method not available');
        }
    } catch (error) {
        console.error('❌ Theme configuration test failed:', error);
    }
}

// Make the test function globally available
if (typeof window !== 'undefined') {
    window.testThemeConfig = testThemeConfig;
}

/**
 * Test function specifically for settings panel theme saving
 * Call from browser console: debugSettingsThemeSave()
 */
export async function debugSettingsThemeSave() {
    console.log('🔧 Debugging settings panel theme save...');
    
    // Check if settings panel is open
    const settingsOverlay = document.getElementById('settings-overlay');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    
    console.log('Settings overlay found:', !!settingsOverlay);
    console.log('Settings overlay active:', settingsOverlay?.classList.contains('active'));
    console.log('Settings overlay HTML content:', settingsOverlay?.innerHTML?.length > 0 ? 'Present' : 'Empty');
    console.log('Dark mode toggle found:', !!darkModeToggle);
    
    if (!settingsOverlay?.classList.contains('active')) {
        console.log('Opening settings panel...');
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Re-check after opening
            const darkModeToggleAfter = document.getElementById('dark-mode-toggle');
            console.log('Dark mode toggle found after opening:', !!darkModeToggleAfter);
        }
    }
    
    const finalDarkModeToggle = document.getElementById('dark-mode-toggle');
    if (finalDarkModeToggle) {
        console.log('Current toggle state:', finalDarkModeToggle.checked);
        console.log('Current DOM theme:', document.documentElement.getAttribute('data-theme'));
        
        // Check if Wails bindings are available
        console.log('Wails App available:', !!window.go?.main?.App);
        console.log('SetTheme available:', !!window.go?.main?.App?.SetTheme);
        console.log('GetTheme available:', !!window.go?.main?.App?.GetTheme);
        
        if (window.go?.main?.App?.GetTheme) {
            try {
                const currentConfigTheme = await window.go.main.App.GetTheme();
                console.log('Current config theme:', currentConfigTheme);
            } catch (error) {
                console.error('Error reading current config theme:', error);
            }
        }
        
        // Test toggle
        console.log('Simulating toggle click...');
        const originalState = finalDarkModeToggle.checked;
        finalDarkModeToggle.click();
        
        // Wait and check results
        setTimeout(async () => {
            console.log('After toggle:');
            console.log('  Toggle state:', finalDarkModeToggle.checked);
            console.log('  DOM theme:', document.documentElement.getAttribute('data-theme'));
            
            if (window.go?.main?.App?.GetTheme) {
                try {
                    const newConfigTheme = await window.go.main.App.GetTheme();
                    console.log('  Config theme:', newConfigTheme);
                    console.log('  ✅ Save successful:', newConfigTheme === (finalDarkModeToggle.checked ? 'dark' : 'light'));
                } catch (error) {
                    console.error('  ❌ Error reading new config theme:', error);
                }
            }
            
            // Revert
            setTimeout(() => {
                console.log('Reverting toggle...');
                finalDarkModeToggle.click();
            }, 1000);
        }, 1000);
        
    } else {
        console.error('❌ Dark mode toggle still not found after opening settings!');
        
        // Debug what we do have in settings panel
        const settingsPanel = document.querySelector('.settings-panel');
        if (settingsPanel) {
            console.log('Settings panel found, checking for appearance tab...');
            const appearanceTab = document.querySelector('[data-tab-target="#settings-tab-appearance"]');
            console.log('Appearance tab found:', !!appearanceTab);
            
            if (appearanceTab) {
                console.log('Clicking appearance tab...');
                appearanceTab.click();
                setTimeout(() => {
                    const toggleAfterTabSwitch = document.getElementById('dark-mode-toggle');
                    console.log('Dark mode toggle found after tab switch:', !!toggleAfterTabSwitch);
                }, 500);
            }
        }
    }
}

// Make the test function globally available
if (typeof window !== 'undefined') {
    window.debugSettingsThemeSave = debugSettingsThemeSave;
}

/**
 * Simple test function to diagnose settings panel issues
 * Call from browser console: testSettingsPanelStatus()
 */
export function testSettingsPanelStatus() {
    console.log('🔍 Settings Panel Status Check');
    console.log('================================');
    
    // Check overlay
    const overlay = document.getElementById('settings-overlay');
    console.log('Settings overlay exists:', !!overlay);
    console.log('Settings overlay innerHTML length:', overlay?.innerHTML?.length || 0);
    console.log('Settings overlay classes:', overlay?.className);
    
    // Check settings button
    const settingsBtn = document.getElementById('settings-btn');
    console.log('Settings button exists:', !!settingsBtn);
    
    // Check if settings panel content exists
    const settingsPanel = document.querySelector('.settings-panel');
    console.log('Settings panel exists:', !!settingsPanel);
    
    // Check tabs
    const settingsTabs = document.querySelectorAll('.settings-tab');
    console.log('Settings tabs count:', settingsTabs.length);
    
    // Check dark mode toggle specifically
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    console.log('Dark mode toggle exists:', !!darkModeToggle);
    
    // Check appearance tab content
    const appearanceTabPane = document.getElementById('settings-tab-appearance');
    console.log('Appearance tab pane exists:', !!appearanceTabPane);
    console.log('Appearance tab pane innerHTML length:', appearanceTabPane?.innerHTML?.length || 0);
    
    // Check current theme
    const currentTheme = document.documentElement.getAttribute('data-theme');
    console.log('Current DOM theme:', currentTheme);
    
    // Check if DOMManager was called
    console.log('Window.thermicApp exists:', !!window.thermicApp);
    console.log('Window.activityBarManager exists:', !!window.activityBarManager);
    
    return {
        overlay: !!overlay,
        overlayHasContent: (overlay?.innerHTML?.length || 0) > 0,
        settingsPanel: !!settingsPanel,
        darkModeToggle: !!darkModeToggle,
        tabsCount: settingsTabs.length,
        currentTheme: currentTheme
    };
}

// Make test functions globally available
if (typeof window !== 'undefined') {
    window.testSettingsPanelStatus = testSettingsPanelStatus;
}

/**
 * Clear SVG cache for specific icon (useful when icon files are updated)
 * @param {string} iconName - The icon name to clear from cache
 */
export function clearIconCache(iconName) {
    if (svgCache.has(iconName)) {
        svgCache.delete(iconName);
        console.log(`Cleared cache for icon: ${iconName}`);
    }
}

/**
 * Clear all SVG cache
 */
export function clearAllIconCache() {
    svgCache.clear();
    console.log('Cleared all icon cache');
}

/**
 * Refresh the settings icon (useful after updating the icon file)
 * Call from browser console: refreshSettingsIcon()
 */
export async function refreshSettingsIcon() {
    console.log('🔄 Refreshing settings icon...');
    
    // Clear the settings icon from cache
    clearIconCache('settings');
    
    // Find all settings icons and update them
    const settingsIcons = document.querySelectorAll('img[src*="/settings.svg"], .svg-icon[src*="/settings.svg"]');
    console.log(`Found ${settingsIcons.length} settings icon images to update`);
    
    for (const icon of settingsIcons) {
        try {
            // Force reload by updating src
            const originalSrc = icon.src;
            icon.src = originalSrc + '?t=' + Date.now();
        } catch (error) {
            console.warn('Error refreshing settings icon:', error);
        }
    }
    
    // Also update any inline SVG settings icons
    const inlineSettingsIcons = document.querySelectorAll('.svg-icon:not([src])');
    console.log(`Found ${inlineSettingsIcons.length} inline SVG icons to check`);
    
    // Force update all icons to inline SVGs to pick up the new settings icon
    await updateAllIconsToInline();
    
    console.log('✅ Settings icon refresh completed');
}

// Make cache and refresh functions globally available
if (typeof window !== 'undefined') {
    window.testSettingsPanelStatus = testSettingsPanelStatus;
    window.clearIconCache = clearIconCache;
    window.clearAllIconCache = clearAllIconCache;
    window.refreshSettingsIcon = refreshSettingsIcon;
} 