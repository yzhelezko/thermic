// Utility functions and constants

export const THEMES = {
    DARK: {
        background: '#0c0c0c',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selection: '#ffffff40',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
    },
    LIGHT: {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#333333',
        selection: '#0078d440',
        black: '#000000',
        red: '#e81123',
        green: '#107c10',
        yellow: '#ff8c00',
        blue: '#0078d4',
        magenta: '#881798',
        cyan: '#3a96dd',
        white: '#cccccc',
        brightBlack: '#808080',
        brightRed: '#ff0000',
        brightGreen: '#00ff00',
        brightYellow: '#ffff00',
        brightBlue: '#0000ff',
        brightMagenta: '#ff00ff',
        brightCyan: '#00ffff',
        brightWhite: '#ffffff'
    }
};

export const DEFAULT_TERMINAL_OPTIONS = {
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Consolas, Monaco, "Lucida Console", monospace',
    allowTransparency: false,
    rightClickSelectsWord: true,
    cols: 120,
    rows: 30,
    // Scrolling configuration
    scrollback: 10000,           // Keep 10,000 lines of scrollback
    fastScrollModifier: 'alt',   // Use Alt key for fast scrolling
    fastScrollSensitivity: 5,    // Scroll 5 lines at a time with Alt
    scrollSensitivity: 1,        // Normal scroll sensitivity
    smoothScrollDuration: 0,     // Disable smooth scrolling for better performance
    convertEol: true,            // Convert EOL sequences
    disableStdin: false          // Allow input
};

export function generateSessionId() {
    return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

export function formatShellName(shell) {
    if (shell.startsWith('wsl::')) {
        const distName = shell.replace('wsl::', '');
        return `WSL - ${distName}`;
    } else if (shell === 'powershell.exe') {
        return 'PowerShell';
    } else if (shell === 'pwsh.exe') {
        return 'PowerShell Core';
    } else if (shell === 'cmd.exe') {
        return 'Command Prompt';
    }
    return shell;
}

export function showNotification(message, type = 'info', duration = 3000) {
    // Use the universal notification component
    if (window.notification) {
        return window.notification.showNotification(message, type, duration);
    }
    
    // If notification component not available, just log to console
    console.log(`Notification: ${message} (${type})`);
}

export function updateStatus(message) {
    const statusInfo = document.getElementById('status-info');
    if (statusInfo) {
        statusInfo.textContent = message;
    }
}

export function setPermanentStatus(message, color = '') {
    if (window.notification) {
        window.notification.setPermanentStatus(message, color);
    } else {
        // Fallback to direct DOM manipulation
        const statusInfo = document.getElementById('status-info');
        if (statusInfo) {
            statusInfo.textContent = message;
            statusInfo.style.color = color;
        }
    }
}

export function clearPermanentStatus() {
    if (window.notification) {
        window.notification.clearPermanentStatus();
    } else {
        // Fallback to direct DOM manipulation
        const statusInfo = document.getElementById('status-info');
        if (statusInfo) {
            statusInfo.textContent = 'Ready';
            statusInfo.style.color = '';
        }
    }
} 