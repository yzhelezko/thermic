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

// Cache for loaded SVG content with version to prevent corruption
const SVG_CACHE_VERSION = '1.2'; // Increment to invalidate old cache
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
    // Use relative path that works in both dev and production
    return `./icons/${iconName}.svg`;
}

/**
 * Get the appropriate theme toggle icon based on current theme
 * @returns {string} - Path to sun or moon icon
 */
export function getThemeToggleIcon() {
    return isDarkMode() ? './icons/sun.svg' : './icons/moon.svg';
}

/**
 * Load and cache SVG content
 * @param {string} iconName - The icon name (without .svg extension)
 * @returns {Promise<string>} - The SVG content as a string
 */
export async function loadSvgContent(iconName) {
    const cacheKey = `${iconName}_v${SVG_CACHE_VERSION}`;
    
    if (svgCache.has(cacheKey)) {
        return svgCache.get(cacheKey);
    }
    
    try {
        // Use relative path that works in both dev and production
        const response = await fetch(`./icons/${iconName}.svg`);
        if (!response.ok) {
            throw new Error(`Failed to load SVG: ${response.status}`);
        }
        const svgContent = await response.text();
        
        // Store with versioned key and clean up old versions
        svgCache.set(cacheKey, svgContent);
        
        // Clean up old cache entries for this icon
        for (const key of svgCache.keys()) {
            if (key.startsWith(`${iconName}_v`) && key !== cacheKey) {
                svgCache.delete(key);
            }
        }
        
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
 * @param {boolean|null} isDark - Optional: explicitly set dark mode state. If null, will auto-detect.
 */
export async function updateThemeToggleIcon(element, isDark = null) {
    // Use provided theme state or auto-detect as fallback
    const darkMode = isDark !== null ? isDark : isDarkMode();
    const altText = darkMode ? 'Toggle to light mode' : 'Toggle to dark mode';
    
    try {
        // Check if this is the activity bar theme toggle (has inline SVG)
        const svgElement = element.querySelector('svg.theme-toggle-icon');
        
        if (svgElement) {
            // Activity bar theme toggle - update inline SVG path
            const pathElement = svgElement.querySelector('path');
            if (pathElement) {
                if (darkMode) {
                    // Dark mode shows sun icon
                    svgElement.innerHTML = `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0m-5 0h1m8-9v1m8 8h1m-9 8v1M5.6 5.6l.7.7m12.1-.7l-.7.7m0 11.4l.7.7m-12.1-.7l-.7.7"/>`;
                    element.title = 'Toggle to light mode';
                } else {
                    // Light mode shows moon icon
                    svgElement.innerHTML = `<path fill="currentColor" d="M21.64 13a1 1 0 0 0-1.05-.14a8.05 8.05 0 0 1-3.37.73a8.15 8.15 0 0 1-8.14-8.1a8.59 8.59 0 0 1 .25-2A1 1 0 0 0 8 2.36a10.14 10.14 0 1 0 14 11.69a1 1 0 0 0-.36-1.05Zm-9.5 6.69A8.14 8.14 0 0 1 7.08 5.22v.27a10.15 10.15 0 0 0 10.14 10.14a9.79 9.79 0 0 0 2.1-.22a8.11 8.11 0 0 1-7.18 4.32Z"/>`;
                    element.title = 'Toggle to dark mode';
                }
                return; // Successfully updated inline SVG
            }
        }
        
        // Fallback for other theme toggles or legacy implementations
        const iconName = darkMode ? 'sun' : 'moon';
        const svgContent = await loadSvgContent(iconName);
        
        if (svgContent) {
            // Clean the SVG content and ensure proper attributes
            let cleanSvgContent = svgContent.trim();
            
            // Remove any existing class, alt, width, height attributes to avoid duplication
            cleanSvgContent = cleanSvgContent.replace(/\s+class="[^"]*"/g, '');
            cleanSvgContent = cleanSvgContent.replace(/\s+alt="[^"]*"/g, '');
            cleanSvgContent = cleanSvgContent.replace(/\s+width="[^"]*"/g, '');
            cleanSvgContent = cleanSvgContent.replace(/\s+height="[^"]*"/g, '');
            
            // Keep original viewBox for proper proportions
            // The size difference will be handled by CSS
            
            // Add our attributes
            const svgWithClasses = cleanSvgContent.replace(
                '<svg',
                `<svg class="svg-icon theme-toggle-icon" alt="${altText}" width="24" height="24"`
            );
            
            // Completely replace the innerHTML to avoid nested SVGs
            element.innerHTML = '';
            element.innerHTML = svgWithClasses;
        } else {
            // Fallback to img
            const iconPath = `./icons/${iconName}.svg`;
            element.innerHTML = `<img src="${iconPath}" class="svg-icon" alt="${altText}" width="24" height="24">`;
        }
    } catch (error) {
        console.error('Error updating theme toggle icon:', error);
        // Fallback to img
        const iconPath = darkMode ? './icons/sun.svg' : './icons/moon.svg';
        element.innerHTML = `<img src="${iconPath}" class="svg-icon" alt="${altText}" width="24" height="24">`;
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
    const imgIcons = document.querySelectorAll('.svg-icon[src*="./icons/"], .svg-icon[src*="/icons/"]');
    
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

// Debug function to manually test theme icon update
window.testThemeIconUpdate = async function() {
    console.log('🧪 Manual theme icon test starting...');
    const themeButton = document.getElementById('theme-toggle');
    if (!themeButton) {
        console.error('❌ Theme button not found!');
        return;
    }
    
    console.log('🔍 Current button HTML:', themeButton.innerHTML);
    
    // Check computed styles
    const buttonStyles = getComputedStyle(themeButton);
    const svgElement = themeButton.querySelector('svg');
    if (svgElement) {
        const svgStyles = getComputedStyle(svgElement);
        console.log('🎨 Button computed styles:', {
            color: buttonStyles.color,
            backgroundColor: buttonStyles.backgroundColor,
            display: buttonStyles.display,
            visibility: buttonStyles.visibility,
            opacity: buttonStyles.opacity,
            width: buttonStyles.width,
            height: buttonStyles.height
        });
        console.log('🎨 SVG computed styles:', {
            color: svgStyles.color,
            fill: svgStyles.fill,
            stroke: svgStyles.stroke,
            display: svgStyles.display,
            visibility: svgStyles.visibility,
            opacity: svgStyles.opacity,
            width: svgStyles.width,
            height: svgStyles.height
        });
    }
    
    // Test both sun and moon
    console.log('🌙 Testing moon icon...');
    await updateThemeToggleIcon(themeButton, false); // Light mode shows moon
    console.log('🔍 After moon update:', themeButton.innerHTML);
    
    setTimeout(async () => {
        console.log('☀️ Testing sun icon...');
        await updateThemeToggleIcon(themeButton, true); // Dark mode shows sun
        console.log('🔍 After sun update:', themeButton.innerHTML);
        
        // Check styles again after update
        const svgAfterUpdate = themeButton.querySelector('svg');
        if (svgAfterUpdate) {
            const svgStylesAfter = getComputedStyle(svgAfterUpdate);
            console.log('🎨 SVG styles after sun update:', {
                color: svgStylesAfter.color,
                fill: svgStylesAfter.fill,
                stroke: svgStylesAfter.stroke,
                display: svgStylesAfter.display,
                visibility: svgStylesAfter.visibility,
                opacity: svgStylesAfter.opacity
            });
        }
    }, 2000);
};

/**
 * Initialize all icons in the UI (can be called on page load)
 */
export async function initializeIcons() {
    // Clear potentially corrupted theme icon cache from previous versions
    clearIconCache('sun');
    clearIconCache('moon');
    console.log('🧹 Cleared theme icon cache to prevent corruption');
    
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
        // Test ConfigGet for theme
        if (window.go?.main?.App?.ConfigGet) {
            const currentTheme = await window.go.main.App.ConfigGet("Theme");
            console.log('Current theme from config:', currentTheme);
            
            // Test ConfigSet for theme
            if (window.go?.main?.App?.ConfigSet) {
                const testTheme = currentTheme === 'dark' ? 'light' : 'dark';
                console.log('Testing theme change to:', testTheme);
                
                await window.go.main.App.ConfigSet("Theme", testTheme);
                console.log('Theme set successfully');
                
                // Verify the change
                const newTheme = await window.go.main.App.ConfigGet("Theme");
                console.log('New theme from config:', newTheme);
                console.log('Theme change successful:', newTheme === testTheme);
                
                // Revert back
                setTimeout(async () => {
                    await window.go.main.App.ConfigSet("Theme", currentTheme);
                    console.log('Reverted theme back to:', currentTheme);
                    console.log('✅ Theme configuration test completed');
                }, 2000);
            } else {
                console.error('❌ ConfigSet method not available');
            }
        } else {
            console.error('❌ ConfigGet method not available');
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
        console.log('ConfigSet available:', !!window.go?.main?.App?.ConfigSet);
        console.log('ConfigGet available:', !!window.go?.main?.App?.ConfigGet);
        
        if (window.go?.main?.App?.ConfigGet) {
            try {
                const currentConfigTheme = await window.go.main.App.ConfigGet("Theme");
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
            
            if (window.go?.main?.App?.ConfigGet) {
                try {
                    const newConfigTheme = await window.go.main.App.ConfigGet("Theme");
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
    let cleared = false;
    // Clear all versions of this icon from cache
    for (const key of svgCache.keys()) {
        if (key.startsWith(`${iconName}_v`)) {
            svgCache.delete(key);
            cleared = true;
        }
    }
    
    if (cleared) {
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

/**
 * Force update theme toggle icon (useful for fixing stuck icons)
 * @param {boolean} isDark - The intended dark mode state
 */
export async function forceUpdateThemeToggleIcon(isDark) {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        console.log('Force updating theme toggle icon to:', isDark ? 'dark (sun icon)' : 'light (moon icon)');
        await updateThemeToggleIcon(themeToggle, isDark);
    } else {
        console.warn('Theme toggle button not found for force update');
    }
}

// Expose force update function globally for debugging in production
window.forceUpdateThemeToggleIcon = forceUpdateThemeToggleIcon;

// Debug function to test if the issue is color-related
window.testSunVisibility = function() {
    console.log('🔍 Testing sun icon visibility...');
    const themeButton = document.getElementById('theme-toggle');
    if (!themeButton) {
        console.error('❌ Theme button not found!');
        return;
    }
    
    const svg = themeButton.querySelector('svg');
    if (!svg) {
        console.error('❌ No SVG found in theme button!');
        return;
    }
    
    console.log('🎯 Current SVG:', svg.outerHTML);
    
    // Test with different colors
    console.log('🎨 Testing with red color...');
    svg.style.color = 'red';
    svg.style.fill = 'red';
    
    setTimeout(() => {
        console.log('🎨 Testing with white color...');
        svg.style.color = 'white';
        svg.style.fill = 'white';
        
        setTimeout(() => {
            console.log('🎨 Testing with yellow color...');
            svg.style.color = 'yellow';
            svg.style.fill = 'yellow';
            
            setTimeout(() => {
                console.log('🔄 Removing manual styles...');
                svg.style.color = '';
                svg.style.fill = '';
                console.log('✅ Visibility test completed');
            }, 2000);
        }, 2000);
    }, 2000);
};

/**
 * Global debug function for theme icon issues (useful in production)
 * Call from browser console: fixThemeIcon()
 */
window.fixThemeIcon = async function() {
    console.log('🔧 Attempting to fix theme icon...');
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const isDark = currentTheme === 'dark';
    console.log('Current theme:', currentTheme, 'isDark:', isDark);
    
    try {
        // Clear corrupted cache first
        clearIconCache('sun');
        clearIconCache('moon');
        await forceUpdateThemeToggleIcon(isDark);
        console.log('✅ Theme icon fix attempted');
    } catch (error) {
        console.error('❌ Failed to fix theme icon:', error);
    }
}; 