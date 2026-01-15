// Terminal management module
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
    GetAvailableShells,
    StartShell,
    WriteToShell,
    ResizeShell,
    CloseShell,
    ShowMessageDialog,
    WaitForSessionClose,
    ConfigGet,
    ConfigSet,
    ApproveHostKeyUpdate,
} from "../../wailsjs/go/main/App";
import { EventsOn, EventsEmit, BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import {
    THEMES,
    DEFAULT_TERMINAL_OPTIONS,
    generateSessionId,
    formatShellName,
    updateStatus,
} from "./utils.js";
import { AIFloatWindow } from "../components/AIFloatWindow.js";

export class TerminalManager {
    constructor(tabsManager = null) {
        this.terminals = new Map(); // sessionId -> { terminal, fitAddon, container, isConnected }
        this.activeSessionId = null;
        this.currentShell = null;
        this.isDarkTheme = true;

        // Default terminal instance for compatibility
        this.terminal = null;
        this.fitAddon = null;
        this.sessionId = null;
        this.isConnected = false;
        this.eventUnsubscribe = null;

        // Global terminal output handler - single listener for all sessions
        this.globalOutputListener = null;
        this.globalTabStatusListener = null;
        this.globalTabSwitchListener = null;
        this.globalSizeSyncListener = null;
        this.globalConfigListener = null;
        this.globalListenerSetup = false;
        this.globalOutputListenerSetup = false;
        this.tabsManager = tabsManager; // Reference to tabs manager for reconnection

        // Resource management
        this.maxSessions = 50;
        this.resizeObserver = null;
        this.cleanupInterval = null;

        // NEW: Terminal sizing system
        this.pendingSizeQueue = new Set(); // Sessions that need sizing when visible
        this.containerObservers = new Map(); // ResizeObserver for each container
        this.visibilityObserver = null; // MutationObserver for visibility changes
        this.sizingInProgress = new Set(); // Track ongoing sizing operations

        // Host key prompt mode
        this.hostKeyPromptMode = {
            active: false,
            sessionId: null,
            keydownHandler: null,
        };

        // Terminal configuration
        this.scrollbackLines = 10000; // Will be loaded from backend
        this.maxBufferLines = this.scrollbackLines; // Updated when scrollbackLines changes
        this.openLinksInExternalBrowser = true; // Will be loaded from backend

        // Load terminal config from backend
        this.loadTerminalConfig();

        // Set up terminal size sync system for SSH connections
        this.setupTerminalSizeSync();

        // Set up config change listeners
        this.setupConfigListeners();

        // Start resource monitoring
        this.startResourceMonitoring();

        // NEW: Initialize visibility monitoring
        this.setupVisibilityMonitoring();

        // NEW: Start periodic pending size processor
        this.startPendingSizeProcessor();

        // Initialize AI float window after DOM is ready
        this.aiFloatWindow = null;

        // Expose resize method globally for debugging
        window.forceResizeTerminals = () => this.forceResizeAllTerminals();

        // NEW: Expose pending queue processing for debugging
        window.processPendingSizes = () => this.processPendingSizeQueue();

        // CRITICAL: Set up global event listeners immediately on initialization
        // This ensures tab-status-update and sftp-reconnected events are captured
        // even before the first terminal is created
        this.setupGlobalOutputListener();

        // NEW: Phase 2 - Expose enhanced sizing for debugging
        window.enhanceTerminalSizing = (sessionId) => {
            if (sessionId) {
                return this.performEnhancedSizing(sessionId);
            } else {
                // Enhance all visible terminals
                const promises = [];
                for (const [sid, session] of this.terminals) {
                    if (
                        session.container &&
                        this.isContainerVisible(session.container)
                    ) {
                        promises.push(this.performEnhancedSizing(sid));
                    }
                }
                return Promise.all(promises);
            }
        };

        // NEW: Phase 2 - Debug method to check terminal states
        window.debugTerminalStates = () => {
            const states = {};
            for (const [sessionId, session] of this.terminals) {
                states[sessionId] = {
                    visible: session.container
                        ? this.isContainerVisible(session.container)
                        : false,
                    validDimensions: session.container
                        ? this.validateEnhancedContainerDimensions(
                              session.container,
                          )
                        : false,
                    containerSize: session.container
                        ? {
                              offset: `${session.container.offsetWidth}x${session.container.offsetHeight}`,
                              client: `${session.container.clientWidth}x${session.container.clientHeight}`,
                          }
                        : null,
                    terminalSize: session.terminal
                        ? `${session.terminal.cols}x${session.terminal.rows}`
                        : null,
                    retryCount: session.retryCount || 0,
                    isConnected: session.isConnected,
                    hasObserver: !!session.containerObserver,
                };
            }
            console.table(states);
            return states;
        };
    }

    initializeAIWindow() {
        try {
            console.log("Initializing AI float window in terminal...");
            this.aiFloatWindow = new AIFloatWindow();

            // Set up the AI window to use this terminal manager for pasting
            this.aiFloatWindow.terminalManager = this;

            // Expose globally for accessibility from other modules if needed
            window.aiFloatWindow = this.aiFloatWindow;

            console.log("AI float window initialized successfully");
        } catch (error) {
            console.error("Failed to initialize AI float window:", error);
            this.aiFloatWindow = null;
        }
    }

    setupGlobalOutputListener() {
        if (!this.globalListenerSetup) {
            console.log("Setting up global event listeners");
            try {
                // Set up terminal output listener
                this.globalOutputListener = EventsOn(
                    "terminal-output",
                    (data) => {
                        // Validate data first
                        if (!data || !data.sessionId) {
                            console.warn(
                                "Invalid terminal output data received:",
                                data,
                            );
                            return;
                        }

                        const sessionId = data.sessionId;
                        console.log(
                            `Global listener received output for session: ${sessionId}`,
                        );

                        // Track activity for inactive tabs
                        if (
                            this.tabsManager &&
                            sessionId !== this.activeSessionId
                        ) {
                            // Filter out certain types of output that shouldn't trigger activity
                            if (this.shouldTriggerActivity(data.data)) {
                                // Find the tab associated with this session
                                const tabId =
                                    this.findTabBySessionId(sessionId);
                                if (tabId) {
                                    this.tabsManager.markTabActivity(tabId);
                                }
                            }
                        }

                        // Route output to the correct terminal session
                        const terminalSession = this.terminals.get(sessionId);

                        // RDP sessions use bitmap updates, not terminal output - skip terminal output for RDP
                        if (terminalSession && terminalSession.type === 'rdp') {
                            console.log(
                                `✅ RDP: Ignoring terminal output for RDP session ${sessionId} (uses bitmap updates instead)`,
                            );
                            return;
                        }

                        if (
                            terminalSession &&
                            terminalSession.isConnected &&
                            terminalSession.terminal
                        ) {
                            try {
                                console.log(
                                    `Writing output to terminal session: ${sessionId}`,
                                );

                                // Check if we're at the bottom before writing
                                const isAtBottom =
                                    terminalSession.terminal.buffer.active
                                        .viewportY >=
                                    terminalSession.terminal.buffer.active
                                        .baseY;

                                // Process SSH status messages for better display
                                const processedData = this.processSSHMessage(
                                    data.data,
                                    sessionId,
                                );
                                terminalSession.terminal.write(processedData);

                                // Auto-scroll to bottom if we were already at the bottom
                                if (
                                    isAtBottom ||
                                    terminalSession.terminal.buffer.active
                                        .length === 0
                                ) {
                                    setTimeout(() => {
                                        // Double-check session still exists and is connected
                                        const currentSession =
                                            this.terminals.get(sessionId);
                                        if (
                                            currentSession &&
                                            currentSession.terminal &&
                                            currentSession.isConnected
                                        ) {
                                            currentSession.terminal.scrollToBottom();
                                        }
                                    }, 0);
                                }
                            } catch (error) {
                                console.error(
                                    `Error writing to terminal session ${sessionId}:`,
                                    error,
                                );
                                // Mark session as problematic to avoid further errors
                                if (terminalSession) {
                                    terminalSession.isConnected = false;
                                }
                            }
                        } else if (!terminalSession) {
                            // This is expected after closing a tab - backend might still send some final output
                            console.log(
                                `Ignoring output for closed session: ${sessionId}`,
                            );
                        } else if (!terminalSession.isConnected) {
                            console.log(
                                `Ignoring output for disconnected session: ${sessionId}`,
                            );
                        } else {
                            console.warn(
                                `Session ${sessionId} exists but terminal is missing:`,
                                terminalSession,
                            );
                        }
                    },
                );

                // Set up tab status update listener
                this.globalTabStatusListener = EventsOn(
                    "tab-status-update",
                    (data) => {
                        console.log(
                            "Global listener received tab status update:",
                            data,
                        );

                        // Forward to tabs manager if it exists
                        if (
                            window.tabsManager &&
                            typeof window.tabsManager.handleTabStatusUpdate ===
                                "function"
                        ) {
                            window.tabsManager.handleTabStatusUpdate(data);
                        } else {
                            console.warn(
                                "TabsManager not available for status update:",
                                data,
                            );
                        }

                        // Forward to remote explorer manager if it exists
                        if (
                            window.remoteExplorerManager &&
                            typeof window.remoteExplorerManager
                                .handleTabStatusUpdate === "function"
                        ) {
                            window.remoteExplorerManager.handleTabStatusUpdate(
                                data,
                            );
                        }
                    },
                );

                // Set up SFTP reconnection listener
                this.globalSftpReconnectedListener = EventsOn(
                    "sftp-reconnected",
                    (data) => {
                        console.log(
                            "Global listener received sftp-reconnected event:",
                            data,
                        );

                        // Forward to remote explorer manager if it exists
                        if (
                            window.remoteExplorerManager &&
                            typeof window.remoteExplorerManager
                                .handleSftpReconnected === "function"
                        ) {
                            window.remoteExplorerManager.handleSftpReconnected(
                                data,
                            );
                        } else {
                            console.warn(
                                "RemoteExplorerManager not available for sftp-reconnected:",
                                data,
                            );
                        }
                    },
                );

                // Set up SFTP upload progress listener
                this.globalSftpUploadProgressListener = EventsOn(
                    "sftp-upload-progress",
                    (data) => {
                        if (
                            window.remoteExplorerManager &&
                            typeof window.remoteExplorerManager
                                .handleTransferProgressEvent === "function"
                        ) {
                            window.remoteExplorerManager.handleTransferProgressEvent(
                                data,
                                "upload",
                            );
                        }
                    },
                );

                // Set up SFTP download progress listener
                this.globalSftpDownloadProgressListener = EventsOn(
                    "sftp-download-progress",
                    (data) => {
                        if (
                            window.remoteExplorerManager &&
                            typeof window.remoteExplorerManager
                                .handleTransferProgressEvent === "function"
                        ) {
                            window.remoteExplorerManager.handleTransferProgressEvent(
                                data,
                                "download",
                            );
                        }
                    },
                );

                // Set up tab switch listener for status bar updates
                this.globalTabSwitchListener = EventsOn(
                    "tab-switched",
                    (data) => {
                        console.log(
                            "Global listener received tab switch event:",
                            data,
                        );

                        // Forward to status manager if it exists
                        if (
                            window.statusManager &&
                            typeof window.statusManager.onTabSwitch ===
                                "function"
                        ) {
                            window.statusManager.onTabSwitch(data.tabId);
                        } else {
                            console.warn(
                                "StatusManager not available for tab switch:",
                                data,
                            );
                        }
                    },
                );

                // NEW: Set up reconnection sizing listener to handle enhanced sizing after tab reconnection
                this.globalReconnectionSizingListener = EventsOn(
                    "tab-reconnected-sizing",
                    (data) => {
                        console.log(
                            "Global listener received tab reconnection sizing event:",
                            data,
                        );
                        const { sessionId, tabId, immediate } = data;

                        if (!sessionId) {
                            console.warn(
                                "Tab reconnection sizing event missing sessionId",
                            );
                            return;
                        }

                        // Trigger enhanced terminal sizing for reconnected tab
                        this.handleReconnectionSizing(
                            sessionId,
                            immediate,
                        ).catch((error) => {
                            console.error(
                                "Failed to handle reconnection sizing:",
                                error,
                            );
                        });
                    },
                );

                // Set up host key prompt listener
                this.globalHostKeyPromptListener = EventsOn(
                    "host-key-prompt",
                    (data) => {
                        console.log(
                            "Global listener received host key prompt:",
                            data,
                        );
                        this.enableHostKeyPromptMode(data.sessionId);
                    },
                );

                this.globalListenerSetup = true;
                console.log("Global event listeners set up successfully");
            } catch (error) {
                console.error("Failed to set up global listeners:", error);
            }
        } else {
            console.log("Global event listeners already set up");
        }
    }

    initTerminal() {
        // Initialize the main terminal container
        const terminalElement = document.getElementById("terminal");
        if (!terminalElement) {
            console.error("Terminal container not found");
            return;
        }

        // Initialize AI float window now that DOM is ready
        this.initializeAIWindow();

        // Create initial terminal session (will be managed by tabs)
        this.updateTerminalContainer();
    }

    // ============================================================================
    // RDP Canvas Creation and Rendering
    // ============================================================================

    createRDPCanvas(sessionId) {
        console.log(`✅ RDP: Creating canvas for session: ${sessionId}`);

        // Create canvas element with initial size
        const canvas = document.createElement('canvas');
        canvas.id = `rdp-canvas-${sessionId}`;
        canvas.className = 'rdp-canvas';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.backgroundColor = '#1a1a1a'; // Dark background for debugging
        
        // Set initial canvas resolution (will be adjusted on resize)
        canvas.width = 1024;
        canvas.height = 768;

        // Get 2D context for rendering with image smoothing enabled
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Create container for the canvas
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'terminal-instance rdp-instance';
        canvasContainer.dataset.sessionId = sessionId;
        canvasContainer.style.display = 'none'; // Initially hidden
        canvasContainer.style.width = '100%';
        canvasContainer.style.height = '100%';
        canvasContainer.style.overflow = 'hidden';
        canvasContainer.appendChild(canvas);

        // Add to main terminal container
        const mainContainer = document.getElementById('terminal');
        mainContainer.appendChild(canvasContainer);

        // Store in terminals map with RDP type
        const sessionData = {
            canvas: canvas,
            context: ctx,
            container: canvasContainer,
            type: 'rdp',
            isConnected: false,
            lastActivity: Date.now(),
        };
        this.terminals.set(sessionId, sessionData);

        // Set up RDP event listeners
        this.setupRDPEventListeners();

        console.log(`✅ RDP: Canvas created successfully`, { 
            sessionId, 
            type: 'rdp', 
            canvasId: canvas.id,
            canvasSize: `${canvas.width}x${canvas.height}`
        });
        
        return canvas;
    }

    setupRDPEventListeners() {
        // Only set up once
        if (this.rdpListenersSetup) {
            return;
        }

        console.log('Setting up RDP event listeners');

        // Listen for bitmap updates from backend
        EventsOn('rdp-bitmap-update', (data) => {
            const { sessionId, x, y, width, height, imageData } = data;
            console.log(`📥 RDP bitmap update for ${sessionId}: ${width}x${height} at (${x},${y}), data length: ${imageData?.length || 0}`);
            this.renderRDPBitmap(sessionId, x, y, width, height, imageData);
        });

        // Listen for RDP ready event
        EventsOn('rdp-ready', (data) => {
            const { sessionId } = data;
            console.log(`✅ RDP session ready: ${sessionId}`);
            const session = this.terminals.get(sessionId);
            if (session && session.type === 'rdp') {
                session.isConnected = true;
            }
        });

        // Listen for RDP errors
        EventsOn('rdp-error', (data) => {
            const { sessionId, error } = data;
            console.error(`❌ RDP error for ${sessionId}:`, error);
        });

        // Listen for RDP closed event
        EventsOn('rdp-closed', (data) => {
            const { sessionId } = data;
            console.log(`🔌 RDP connection closed: ${sessionId}`);
            const session = this.terminals.get(sessionId);
            if (session && session.type === 'rdp') {
                session.isConnected = false;
            }
        });

        this.rdpListenersSetup = true;
    }

    renderRDPBitmap(sessionId, x, y, width, height, base64ImageData) {
        const session = this.terminals.get(sessionId);
        if (!session || session.type !== 'rdp') {
            console.warn(`⚠️ RDP session ${sessionId} not found or not RDP type`);
            return;
        }

        if (!base64ImageData) {
            console.error(`❌ No image data provided for RDP bitmap for ${sessionId}`);
            return;
        }

        // Create image from base64 data
        const img = new Image();
        img.onload = () => {
            try {
                // Draw image to canvas at specified coordinates
                session.context.drawImage(img, x, y, width, height);
                console.log(`✅ RDP bitmap rendered for ${sessionId} at (${x},${y}) size ${width}x${height}`);
                
                // Mark session as having received data
                session.lastActivity = Date.now();
            } catch (error) {
                console.error(`❌ Error drawing RDP bitmap for ${sessionId}:`, error);
            }
        };
        img.onerror = (error) => {
            console.error(`❌ Failed to load RDP bitmap image for ${sessionId}:`, error);
            console.error(`Base64 data preview:`, base64ImageData?.substring(0, 100));
        };
        
        try {
            img.src = `data:image/png;base64,${base64ImageData}`;
        } catch (error) {
            console.error(`❌ Error setting image src for ${sessionId}:`, error);
        }
    }

    resizeRDPCanvas(sessionId) {
        const session = this.terminals.get(sessionId);
        if (!session || session.type !== 'rdp') {
            return;
        }

        const container = session.container;
        const canvas = session.canvas;

        if (!container || !canvas) {
            console.warn(`Cannot resize RDP canvas - missing container or canvas for ${sessionId}`);
            return;
        }

        // Force a layout reflow to get accurate dimensions
        container.offsetWidth;
        container.offsetHeight;

        // Get container dimensions
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Skip if dimensions are invalid or too small
        if (width <= 100 || height <= 100) {
            console.warn(`Invalid RDP canvas dimensions for ${sessionId}: ${width}x${height}, will retry...`);
            // Retry after a delay
            setTimeout(() => this.resizeRDPCanvas(sessionId), 200);
            return;
        }

        console.log(`✅ Resizing RDP canvas ${sessionId} to ${width}x${height}`);

        // Set canvas actual dimensions (backing buffer)
        canvas.width = width;
        canvas.height = height;

        // Notify backend of new dimensions using the ResizeShell function
        // Backend now handles the case where session is still being established
        ResizeShell(sessionId, width, height)
            .then(() => {
                console.log(`✅ Backend notified of RDP resize for ${sessionId}: ${width}x${height}`);
            })
            .catch((error) => {
                // Don't log as error if it's just that the session is still connecting
                const errorStr = String(error);
                if (errorStr.includes('not found')) {
                    console.log(`⏳ RDP session ${sessionId} still connecting, resize will apply when ready`);
                } else {
                    console.error(`❌ Failed to notify backend of RDP resize for ${sessionId}:`, error);
                }
            });
    }

    // TODO: Phase 3 - Add mouse and keyboard event handlers for RDP
    // setupRDPInputHandlers(sessionId) {
    //     const session = this.terminals.get(sessionId);
    //     if (!session || session.type !== 'rdp') return;
    //     
    //     session.canvas.addEventListener('mousedown', (e) => { ... });
    //     session.canvas.addEventListener('mousemove', (e) => { ... });
    //     session.canvas.addEventListener('mouseup', (e) => { ... });
    //     session.canvas.addEventListener('keydown', (e) => { ... });
    //     session.canvas.addEventListener('keyup', (e) => { ... });
    // }

    createTerminalSession(sessionId, connectionType = 'local') {
        console.log(`✅ RDP: createTerminalSession called with sessionId=${sessionId}, connectionType=${connectionType}`);
        
        // Check session limits
        if (this.terminals.size >= this.maxSessions) {
            throw new Error(
                `Maximum terminal sessions (${this.maxSessions}) reached`,
            );
        }

        // Ensure global output listener is set up
        this.setupGlobalOutputListener();

        // Handle RDP connections differently - create canvas instead of terminal
        if (connectionType === 'rdp') {
            console.log(`✅ RDP: Detected RDP connection type, creating canvas instead of terminal`);
            return this.createRDPCanvas(sessionId);
        }
        
        console.log(`✅ RDP: Creating regular xterm.js terminal for ${connectionType} connection`);

        // Create terminal instance with current theme and backend config
        const initialTheme = this.isDarkTheme ? THEMES.DARK : THEMES.LIGHT;
        console.log(
            `Creating terminal session ${sessionId} with theme:`,
            this.isDarkTheme ? "dark" : "light",
        );

        const terminal = new Terminal({
            ...DEFAULT_TERMINAL_OPTIONS,
            theme: initialTheme,
            scrollback: this.scrollbackLines, // Use backend config
        });

        // Add addons
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        // Configure WebLinksAddon to open URLs in external browser if enabled
        terminal.loadAddon(new WebLinksAddon((event, uri) => {
            if (this.openLinksInExternalBrowser) {
                event.preventDefault();
                BrowserOpenURL(uri);
            }
            // If setting is disabled, default browser behavior will occur (open in same window)
        }));

        // Create terminal container div with wrapper for proper padding
        const terminalContainer = document.createElement("div");
        terminalContainer.className = "terminal-instance";
        terminalContainer.dataset.sessionId = sessionId;
        terminalContainer.style.display = "none"; // Initially hidden

        // Create wrapper div for padding
        const terminalWrapper = document.createElement("div");
        terminalWrapper.className = "terminal-wrapper";
        terminalContainer.appendChild(terminalWrapper);

        // Add to main terminal container
        const mainContainer = document.getElementById("terminal");
        mainContainer.appendChild(terminalContainer);

        // Open terminal in the wrapper (not the container)
        terminal.open(terminalWrapper);

        // DON'T call fit() here - container is hidden so measurements will be wrong
        // NEW: Add to pending size queue for when container becomes visible
        this.addToPendingSizeQueue(sessionId);

        // Handle terminal input - send to shell
        terminal.onData((data) => {
            console.log(
                `Terminal input received for session ${sessionId}:`,
                data.charCodeAt(0),
            );
            const terminalSession = this.terminals.get(sessionId);

            // Update last activity
            if (terminalSession) {
                terminalSession.lastActivity = Date.now();
            }

            // Check for Enter key (char code 13) and if we should trigger reconnection
            if (data.charCodeAt(0) === 13 && this.tabsManager) {
                const shouldReconnect = this.checkForReconnection(sessionId);
                if (shouldReconnect) {
                    console.log(
                        `Enter key pressed - triggering reconnection for session ${sessionId}`,
                    );
                    return; // Don't send Enter to shell, just trigger reconnection
                }
            }

            if (terminalSession && terminalSession.isConnected) {
                console.log(`Sending input to shell for session ${sessionId}`);
                WriteToShell(sessionId, data).catch((error) => {
                    console.error(
                        `Failed to write to shell ${sessionId}:`,
                        error,
                    );
                });
            } else {
                console.warn(
                    `Cannot send input to shell ${sessionId} - session not connected`,
                );
            }
        });

        // Add keyboard shortcuts for terminal functions
        terminal.attachCustomKeyEventHandler((event) => {
            // Ctrl+Home - scroll to top
            if (event.ctrlKey && event.code === "Home") {
                terminal.scrollToTop();
                return false;
            }
            // Ctrl+End - scroll to bottom
            if (event.ctrlKey && event.code === "End") {
                terminal.scrollToBottom();
                return false;
            }
            // Ctrl+L - clear terminal (common shell shortcut)
            if (event.ctrlKey && event.code === "KeyL") {
                const terminalSession = this.terminals.get(sessionId);
                if (terminalSession && terminalSession.isConnected) {
                    // Use frontend terminal clearing that respects clearScrollback setting
                    this.clearTerminal(sessionId);
                }
                return false;
            }
            // Ctrl+T - new tab
            if (event.ctrlKey && event.code === "KeyT") {
                // Emit event for new tab
                document.dispatchEvent(new CustomEvent("terminal:new-tab"));
                return false;
            }
            // Ctrl+W - close tab
            if (event.ctrlKey && event.code === "KeyW") {
                // Emit event for close tab
                document.dispatchEvent(
                    new CustomEvent("terminal:close-tab", {
                        detail: { sessionId },
                    }),
                );
                return false;
            }
            // Ctrl+K - AI Assistant
            if (
                event.ctrlKey &&
                event.code === "KeyK" &&
                !event.shiftKey &&
                !event.altKey
            ) {
                console.log(
                    "Ctrl+K pressed in terminal, AI window:",
                    this.aiFloatWindow,
                );
                if (this.aiFloatWindow) {
                    if (this.aiFloatWindow.isVisible) {
                        // Window is already open - add selected text as context
                        const selectedText = this.getSelectedText();
                        if (selectedText.trim()) {
                            this.aiFloatWindow.addContext(selectedText);
                            console.log(
                                "Added selected text as context:",
                                selectedText,
                            );
                        }
                    } else {
                        this.aiFloatWindow.show();
                    }
                } else {
                    console.error("AI window not initialized in terminal!");
                }
                return false;
            }
            return true;
        });

        // Auto-focus when terminal container is clicked
        terminalContainer.addEventListener("click", () => {
            terminal.focus();
        });

        // Store terminal session (no individual event listener needed)
        const terminalSession = {
            terminal,
            fitAddon,
            container: terminalContainer,
            isConnected: false,
            created: Date.now(),
            lastActivity: Date.now(),
            resizeHandler: null,
            resizeTimeout: null,
            // NEW: Phase 2 - Enhanced resize coordination
            containerObserver: null,
            retryCount: 0,
            maxRetries: 5,
            retryBackoff: 100, // Start with 100ms, exponential backoff
            lastSizeAttempt: 0,
            sizeAttemptDelay: 50, // Minimum delay between size attempts
        };

        this.terminals.set(sessionId, terminalSession);

        // Set up resize handling for this terminal
        this.setupTerminalResize(sessionId);

        // NEW: Phase 2 - Set up container-specific resize observer
        this.setupContainerResizeObserver(sessionId);

        return terminalSession;
    }

    setupTerminalResize(sessionId) {
        // Handle resize for specific terminal with debouncing using the new forceResize method
        let resizeTimeout;
        const resizeHandler = () => {
            // Clear previous timeout to debounce rapid resize events
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
            }

            resizeTimeout = setTimeout(() => {
                const terminalSession = this.terminals.get(sessionId);
                if (terminalSession && sessionId === this.activeSessionId) {
                    console.log(
                        `Window resize triggered for active session: ${sessionId}`,
                    );

                    // Use the new force resize method which handles all the complexity
                    this.forceResizeSession(sessionId).catch((error) => {
                        console.warn(
                            `Error during resize for session ${sessionId}:`,
                            error,
                        );

                        // Fallback to basic fit on error
                        try {
                            terminalSession.fitAddon.fit();
                        } catch (fallbackError) {
                            console.error(
                                "Fallback fit also failed:",
                                fallbackError,
                            );
                        }
                    });
                }
            }, 150); // Slightly increased debounce for better performance
        };

        window.addEventListener("resize", resizeHandler);

        // Store resize handler for cleanup
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession) {
            terminalSession.resizeHandler = resizeHandler;
            terminalSession.resizeTimeout = resizeTimeout;
        }
    }

    async loadShells() {
        try {
            const shells = await GetAvailableShells();
            const defaultShell = await ConfigGet("DefaultShell");

            const shellSelector = document.getElementById("shell-selector");
            shellSelector.innerHTML = "";

            if (shells.length === 0) {
                shellSelector.innerHTML =
                    '<option value="">No shells found</option>';
                return;
            }

            shells.forEach((shell) => {
                const option = document.createElement("option");
                option.value = shell;

                let displayName = formatShellName(shell);

                option.textContent = displayName;
                if (shell === defaultShell) {
                    option.textContent += " (default)";
                }
                shellSelector.appendChild(option);
            });

            updateStatus(`${shells.length} shell(s) available`);
            return { shells, defaultShell };
        } catch (error) {
            console.error("Failed to load shells:", error);
            updateStatus("Failed to load shells");
            throw error;
        }
    }

    async startShell(shell) {
        try {
            if (this.sessionId) {
                updateStatus("Closing previous session...");
                await this.cleanupSession();

                updateStatus(
                    "Previous session closed. Preparing new session...",
                );
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            updateStatus(`Starting ${shell}...`);

            this.sessionId = generateSessionId();

            this.terminal.clear();

            this.eventUnsubscribe = EventsOn("terminal-output", (data) => {
                if (data.sessionId === this.sessionId && this.isConnected) {
                    // Check if we're at the bottom before writing
                    const isAtBottom =
                        this.terminal.buffer.active.viewportY >=
                        this.terminal.buffer.active.baseY;

                    this.terminal.write(data.data);

                    // Auto-scroll to bottom if we were already at the bottom
                    // or if this is the first output
                    if (
                        isAtBottom ||
                        this.terminal.buffer.active.length === 0
                    ) {
                        // Use setTimeout to ensure the write operation completes first
                        setTimeout(() => {
                            this.terminal.scrollToBottom();
                        }, 0);
                    }
                }
            });

            await StartShell(shell, this.sessionId);

            this.isConnected = true;
            this.currentShell = shell;
            updateStatus(`Running ${shell} - Terminal active`);

            // Auto-scroll to bottom for new shell
            setTimeout(() => {
                if (this.terminal) {
                    this.terminal.scrollToBottom();
                }
            }, 100);

            setTimeout(async () => {
                if (this.isConnected && this.sessionId) {
                    const cols = this.terminal.cols;
                    const rows = this.terminal.rows;
                    await ResizeShell(this.sessionId, cols, rows);
                }
            }, 300);
        } catch (error) {
            console.error("Failed to start shell:", error);
            this.terminal.writeln(
                `\x1b[1;31mFailed to start ${shell}: ${error.message}\x1b[0m`,
            );
            updateStatus("Failed to start shell");

            await ShowMessageDialog(
                "Shell Error",
                `Failed to start ${shell}: ${error.message}`,
            );

            if (this.eventUnsubscribe) {
                this.eventUnsubscribe();
                this.eventUnsubscribe = null;
            }

            this.isConnected = false;
            this.sessionId = null;
        }
    }

    async cleanupSession() {
        if (this.sessionId) {
            const sessionToClose = this.sessionId;

            if (this.eventUnsubscribe) {
                this.eventUnsubscribe();
                this.eventUnsubscribe = null;
            }

            this.isConnected = false;

            try {
                await CloseShell(sessionToClose);
                await WaitForSessionClose(sessionToClose);
            } catch (error) {
                console.warn("Error during session cleanup:", error);
            }

            this.sessionId = null;
            this.currentShell = null;
        }
    }

    updateTheme(isDarkTheme) {
        this.isDarkTheme = isDarkTheme;
        const newTheme = isDarkTheme ? THEMES.DARK : THEMES.LIGHT;

        console.log(
            `Updating terminal theme to: ${isDarkTheme ? "dark" : "light"}`,
        );

        // Update all terminal sessions, not just the active one
        for (const [sessionId, terminalSession] of this.terminals) {
            if (terminalSession.terminal) {
                // Update the theme
                terminalSession.terminal.options.theme = newTheme;

                // Force a refresh to apply the new theme immediately
                try {
                    terminalSession.terminal.refresh(
                        0,
                        terminalSession.terminal.rows - 1,
                    );
                    console.log(
                        `Updated and refreshed theme for session ${sessionId}`,
                    );
                } catch (error) {
                    console.warn(
                        `Error refreshing terminal session ${sessionId}:`,
                        error,
                    );
                }
            }
        }

        // Also update the legacy terminal instance for backward compatibility
        if (this.terminal) {
            this.terminal.options.theme = newTheme;
            try {
                this.terminal.refresh(0, this.terminal.rows - 1);
                console.log(
                    "Updated and refreshed theme for legacy terminal instance",
                );
            } catch (error) {
                console.warn("Error refreshing legacy terminal:", error);
            }
        }

        this.updateTerminalContainer();
        console.log("Terminal theme update completed");
    }

    updateTerminalContainer() {
        const terminalContainer = document.querySelector(".terminal-container");
        if (terminalContainer) {
            terminalContainer.style.backgroundColor = this.isDarkTheme
                ? "#0c0c0c"
                : "#ffffff";
        }
    }

    setupResizeObserver() {
        // Cleanup existing observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        this.resizeObserver = new ResizeObserver(() => {
            if (this.fitAddon) {
                setTimeout(() => {
                    this.fitAddon.fit();
                    if (this.isConnected && this.sessionId) {
                        const cols = this.terminal.cols;
                        const rows = this.terminal.rows;
                        ResizeShell(this.sessionId, cols, rows);
                    }
                }, 100);
            }
        });

        const terminalContainer = document.querySelector(".terminal-container");
        if (terminalContainer) {
            this.resizeObserver.observe(terminalContainer);
        }
    }

    setupBeforeUnloadHandler() {
        window.addEventListener("beforeunload", () => {
            if (this.sessionId) {
                if (this.eventUnsubscribe) {
                    this.eventUnsubscribe();
                }
                CloseShell(this.sessionId);
            }
        });
    }

    connectToSession(sessionId) {
        console.log(`Connecting to session: ${sessionId}`);

        // Create terminal session if it doesn't exist
        if (!this.terminals.has(sessionId)) {
            console.log(`Creating new terminal session: ${sessionId}`);
            this.createTerminalSession(sessionId);
        }

        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession) {
            console.error(`Failed to get terminal session: ${sessionId}`);
            return;
        }

        // Reset terminal state for reconnections
        if (terminalSession.terminal) {
            console.log(`Resetting terminal state for session: ${sessionId}`);
            this.resetTerminalState(terminalSession.terminal);
        }

        // Mark session as connected (global output listener will handle routing)
        terminalSession.isConnected = true;
        console.log(
            `Session ${sessionId} marked as connected - using global output listener`,
        );

        this.sessionId = sessionId; // For backward compatibility
        this.isConnected = true; // For backward compatibility

        // Switch to this session to make it visible
        this.switchToSession(sessionId);
    }

    resetTerminalState(terminal) {
        try {
            // Reset terminal state without clearing the screen (backend will handle that)
            // This ensures the frontend terminal is in a clean state

            // Reset cursor and scrolling state
            terminal.reset();

            // Clear any selection
            terminal.clearSelection();

            // Ensure we're at the bottom of the buffer
            terminal.scrollToBottom();

            console.log("Terminal state reset successfully");
        } catch (error) {
            console.warn("Error resetting terminal state:", error);
        }
    }

    async switchToSession(sessionId) {
        console.log(
            `Switching to session: ${sessionId}, current active: ${this.activeSessionId}`,
        );

        // Skip if already active
        if (this.activeSessionId === sessionId) {
            console.log(`Session ${sessionId} is already active`);
            return;
        }

        // Hide current active terminal
        if (this.activeSessionId) {
            const currentSession = this.terminals.get(this.activeSessionId);
            if (currentSession && currentSession.container) {
                console.log(`Hiding current session: ${this.activeSessionId}`);
                try {
                    currentSession.container.style.display = "none";
                } catch (error) {
                    console.warn("Error hiding current session:", error);
                }
            }
        }

        // Show and activate new terminal or RDP canvas
        const newSession = this.terminals.get(sessionId);
        console.log(`✅ RDP: Attempting to show session ${sessionId}`, newSession);
        
        if (newSession && newSession.container && (newSession.terminal || newSession.canvas)) {
            console.log(`✅ RDP: Showing session ${sessionId} | Type: ${newSession.type || 'terminal'} | Has canvas: ${!!newSession.canvas} | Has terminal: ${!!newSession.terminal}`);
            try {
                // Update active session first
                this.activeSessionId = sessionId;

                // Update backward compatibility properties (for terminal sessions)
                if (newSession.terminal) {
                    this.terminal = newSession.terminal;
                    this.fitAddon = newSession.fitAddon;
                }
                this.sessionId = sessionId;
                this.isConnected = newSession.isConnected;
                this.eventUnsubscribe = this.globalOutputListener;

                // Show the container
                newSession.container.style.display = "block";
                console.log(`✅ RDP: Container display set to block for ${sessionId}`);

                // Handle RDP canvas resize
                if (newSession.type === 'rdp') {
                    console.log(`✅ RDP: This is an RDP session, resizing canvas for ${sessionId}`);
                    // Wait for container to be fully visible and sized
                    await this.waitForLayoutSettle();
                    
                    // Give extra time for canvas container to stabilize
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Perform RDP canvas resize
                    this.resizeRDPCanvas(sessionId);
                } else {
                    console.log(`✅ RDP: This is a terminal session, not RDP`);
                    // Handle regular terminal sizing
                    // NEW: Wait for layout to settle after making visible
                    await this.waitForLayoutSettle();

                    // NEW: Validate container dimensions before sizing
                    if (!this.validateContainerDimensions(newSession.container)) {
                        console.warn(
                            `Container for session ${sessionId} has invalid dimensions after becoming visible`,
                        );
                        // Add to pending queue for retry
                        this.addToPendingSizeQueue(sessionId);
                    } else {
                        // NEW: Phase 2 - Use enhanced sizing if available, fallback to visibility-aware
                        try {
                            await this.performEnhancedSizing(sessionId);
                        } catch (error) {
                            console.warn(
                                `Enhanced sizing failed for ${sessionId}, using fallback:`,
                                error,
                            );
                            await this.performVisibilityAwareSizing(sessionId);
                        }
                    }

                    // Focus the terminal (only for terminal sessions)
                    try {
                        newSession.terminal.focus();
                        console.log(
                            `Successfully switched to session: ${sessionId}`,
                        );
                    } catch (error) {
                        console.warn("Error focusing terminal:", error);
                    }
                }
            } catch (error) {
                console.error("Error during session switch:", error);
            }
        } else {
            console.error(`Session ${sessionId} not found or incomplete`);

            // Try to create session if it doesn't exist (but don't block)
            if (!this.terminals.has(sessionId)) {
                console.log(
                    `Attempting to create missing session: ${sessionId}`,
                );
                console.warn(
                    `Session ${sessionId} was missing - this indicates the terminal session was lost`,
                );
                console.warn(
                    `Frontend terminal will be created but backend shell may need to be restarted`,
                );
                try {
                    this.createTerminalSession(sessionId);
                    // Try switching again after a short delay
                    setTimeout(() => {
                        if (this.terminals.has(sessionId)) {
                            this.switchToSession(sessionId);
                        }
                    }, 100);
                } catch (error) {
                    console.error("Error creating missing session:", error);
                }
            }
        }
    }

    // NEW: Perform visibility-aware sizing with proper timing
    async performVisibilityAwareSizing(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.fitAddon) {
            console.warn(
                `Cannot perform visibility-aware sizing for ${sessionId} - session invalid`,
            );
            return;
        }

        console.log(
            `Performing visibility-aware sizing for session: ${sessionId}`,
        );

        try {
            // Remove from pending queue since we're processing it now
            this.pendingSizeQueue.delete(sessionId);
            this.sizingInProgress.add(sessionId);

            // Force reflow to ensure accurate measurements
            terminalSession.container.offsetWidth;
            terminalSession.container.offsetHeight;

            // Wait one more frame for measurements to be accurate
            await new Promise((resolve) => requestAnimationFrame(resolve));

            // Get proposed dimensions - this should be accurate now
            const proposedDimensions =
                terminalSession.fitAddon.proposeDimensions();

            if (
                proposedDimensions &&
                proposedDimensions.cols > 0 &&
                proposedDimensions.rows > 0
            ) {
                console.log(
                    `Using proposed dimensions for ${sessionId}: ${proposedDimensions.cols}x${proposedDimensions.rows}`,
                );

                // Resize terminal to proposed dimensions
                terminalSession.terminal.resize(
                    proposedDimensions.cols,
                    proposedDimensions.rows,
                );

                // Wait for resize to take effect
                await new Promise((resolve) => setTimeout(resolve, 10));

                // Follow up with fit to ensure proper layout
                terminalSession.fitAddon.fit();

                // Get final dimensions
                const finalCols = terminalSession.terminal.cols;
                const finalRows = terminalSession.terminal.rows;

                console.log(
                    `Visibility-aware sizing complete for ${sessionId}: ${finalCols}x${finalRows}`,
                );

                // Update backend if connected
                if (terminalSession.isConnected) {
                    await ResizeShell(sessionId, finalCols, finalRows).catch(
                        (error) => {
                            console.warn(
                                "Error updating backend shell size:",
                                error,
                            );
                        },
                    );
                }
            } else {
                console.warn(
                    `Proposed dimensions invalid for ${sessionId}, using fallback`,
                );
                // Fallback to multiple fits
                terminalSession.fitAddon.fit();
                await new Promise((resolve) => setTimeout(resolve, 20));
                terminalSession.fitAddon.fit();

                const finalCols = terminalSession.terminal.cols;
                const finalRows = terminalSession.terminal.rows;

                console.log(
                    `Fallback sizing complete for ${sessionId}: ${finalCols}x${finalRows}`,
                );

                // Update backend if connected
                if (terminalSession.isConnected) {
                    await ResizeShell(sessionId, finalCols, finalRows).catch(
                        (error) => {
                            console.warn(
                                "Error updating backend shell size:",
                                error,
                            );
                        },
                    );
                }
            }
        } catch (error) {
            console.error(
                `Error during visibility-aware sizing for ${sessionId}:`,
                error,
            );
        } finally {
            this.sizingInProgress.delete(sessionId);
        }
    }

    disconnectSession(sessionId) {
        console.log(`Disconnecting session: ${sessionId}`);
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession) {
            // Mark as disconnected first to stop any ongoing operations
            terminalSession.isConnected = false;

            // Cleanup resize timeout if it exists
            if (terminalSession.resizeTimeout) {
                try {
                    clearTimeout(terminalSession.resizeTimeout);
                } catch (error) {
                    console.warn("Error clearing resize timeout:", error);
                }
                terminalSession.resizeTimeout = null;
            }

            // Cleanup resize handler safely
            if (terminalSession.resizeHandler) {
                try {
                    window.removeEventListener(
                        "resize",
                        terminalSession.resizeHandler,
                    );
                } catch (error) {
                    console.warn("Error removing resize handler:", error);
                }
                terminalSession.resizeHandler = null;
            }

            // NEW: Phase 2 - Cleanup container observer
            if (terminalSession.containerObserver) {
                try {
                    terminalSession.containerObserver.disconnect();
                    console.log(
                        `Container observer disconnected for session: ${sessionId}`,
                    );
                } catch (error) {
                    console.warn(
                        `Error disconnecting container observer for ${sessionId}:`,
                        error,
                    );
                }
                terminalSession.containerObserver = null;
                this.containerObservers.delete(sessionId);
            }

            // Properly dispose of the terminal instance to free memory and event listeners
            if (terminalSession.terminal) {
                try {
                    // Clear any selection and reset state
                    terminalSession.terminal.clearSelection();

                    // Dispose of the terminal instance properly
                    terminalSession.terminal.dispose();
                    console.log(
                        `Terminal instance disposed for session ${sessionId}`,
                    );
                } catch (error) {
                    console.warn("Error disposing terminal instance:", error);
                }
                terminalSession.terminal = null;
            }

            // Hide and remove terminal container safely
            if (terminalSession.container) {
                try {
                    terminalSession.container.style.display = "none";

                    // Remove all event listeners from container
                    const newContainer =
                        terminalSession.container.cloneNode(true);
                    terminalSession.container.parentNode.replaceChild(
                        newContainer,
                        terminalSession.container,
                    );
                    newContainer.remove();
                } catch (error) {
                    console.warn("Error removing terminal container:", error);
                }
                terminalSession.container = null;
            }

            // Clear fitAddon reference
            if (terminalSession.fitAddon) {
                terminalSession.fitAddon = null;
            }

            // Remove from sessions
            this.terminals.delete(sessionId);

            // If this was the active session, clear active session only if no other sessions exist
            if (this.activeSessionId === sessionId) {
                // Check if there are other sessions available
                const remainingSessions = Array.from(this.terminals.keys());
                if (remainingSessions.length > 0) {
                    // Don't clear active session, let the switching logic handle it
                    console.log(
                        `Session ${sessionId} was active, but ${remainingSessions.length} sessions remain`,
                    );
                } else {
                    // No other sessions, clear active session
                    this.activeSessionId = null;
                    this.terminal = null;
                    this.fitAddon = null;
                    this.sessionId = null;
                    this.isConnected = false;
                    this.eventUnsubscribe = this.globalOutputListener;
                }
            }

            console.log(
                `Session ${sessionId} disconnected and cleaned up successfully`,
            );
        } else {
            console.warn(`Session ${sessionId} not found for disconnection`);
        }
    }

    async getDefaultShell() {
        try {
            return await ConfigGet("DefaultShell");
        } catch (error) {
            console.error("Failed to get default shell:", error);
            return "cmd.exe"; // Fallback for Windows
        }
    }

    // Enhanced fit method with better error handling and forced recalculation
    fit() {
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession && terminalSession.fitAddon) {
                try {
                    // Use proposeDimensions for more accurate sizing
                    const proposedDimensions =
                        terminalSession.fitAddon.proposeDimensions();

                    if (
                        proposedDimensions &&
                        proposedDimensions.cols > 0 &&
                        proposedDimensions.rows > 0
                    ) {
                        // Use the proposed dimensions to ensure exact fit
                        terminalSession.terminal.resize(
                            proposedDimensions.cols,
                            proposedDimensions.rows,
                        );

                        // Follow up with fit to ensure proper layout
                        setTimeout(() => {
                            if (terminalSession.fitAddon) {
                                terminalSession.fitAddon.fit();

                                // Update shell size if connected
                                if (terminalSession.isConnected) {
                                    const cols = terminalSession.terminal.cols;
                                    const rows = terminalSession.terminal.rows;
                                    ResizeShell(
                                        this.activeSessionId,
                                        cols,
                                        rows,
                                    ).catch((error) => {
                                        console.warn(
                                            "Error resizing shell in fit():",
                                            error,
                                        );
                                    });
                                }
                            }
                        }, 10);
                    } else {
                        // Fallback to regular fit if proposeDimensions fails
                        terminalSession.fitAddon.fit();
                        setTimeout(() => {
                            if (terminalSession.fitAddon) {
                                terminalSession.fitAddon.fit();

                                // Update shell size if connected
                                if (terminalSession.isConnected) {
                                    const cols = terminalSession.terminal.cols;
                                    const rows = terminalSession.terminal.rows;
                                    ResizeShell(
                                        this.activeSessionId,
                                        cols,
                                        rows,
                                    ).catch((error) => {
                                        console.warn(
                                            "Error resizing shell in fit():",
                                            error,
                                        );
                                    });
                                }
                            }
                        }, 10);
                    }
                } catch (error) {
                    console.warn("Error in fit() method:", error);
                    // Fallback to basic fit
                    try {
                        terminalSession.fitAddon.fit();
                    } catch (fallbackError) {
                        console.error(
                            "Fallback fit also failed:",
                            fallbackError,
                        );
                    }
                }
            }
        } else if (this.fitAddon) {
            this.fitAddon.fit();
        }
    }

    // Force resize a terminal session with aggressive dimension recalculation
    async forceResizeSession(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (
            !terminalSession ||
            !terminalSession.terminal ||
            !terminalSession.fitAddon
        ) {
            console.warn(`Cannot force resize - session ${sessionId} invalid`);
            return;
        }

        console.log(`Force resizing session ${sessionId}...`);

        try {
            // Clear any cached dimensions and force recalculation
            const container = terminalSession.container;

            // Ensure container is visible and has dimensions
            if (container.style.display === "none") {
                console.warn("Container is hidden, cannot resize properly");
                return;
            }

            // Force reflow multiple times to ensure accurate measurements
            container.offsetWidth;
            container.offsetHeight;

            // Wait a frame for layout to settle
            await new Promise((resolve) => requestAnimationFrame(resolve));

            // Get proposed dimensions - this should be most accurate
            const proposedDimensions =
                terminalSession.fitAddon.proposeDimensions();

            if (
                proposedDimensions &&
                proposedDimensions.cols > 0 &&
                proposedDimensions.rows > 0
            ) {
                console.log(
                    `Using proposed dimensions: ${proposedDimensions.cols}x${proposedDimensions.rows}`,
                );

                // First resize to proposed dimensions
                terminalSession.terminal.resize(
                    proposedDimensions.cols,
                    proposedDimensions.rows,
                );

                // Wait for resize to take effect
                await new Promise((resolve) => setTimeout(resolve, 10));

                // Then fit to ensure proper layout
                terminalSession.fitAddon.fit();

                // Get final dimensions
                const finalCols = terminalSession.terminal.cols;
                const finalRows = terminalSession.terminal.rows;

                console.log(`Force resize complete: ${finalCols}x${finalRows}`);

                // Update backend if connected
                if (terminalSession.isConnected) {
                    await ResizeShell(sessionId, finalCols, finalRows).catch(
                        (error) => {
                            console.warn(
                                "Error updating backend shell size:",
                                error,
                            );
                        },
                    );
                }
            } else {
                // Fallback - use multiple fits
                console.log(
                    "Proposed dimensions failed, using fallback method",
                );

                // Multiple fits with delays to ensure proper sizing
                terminalSession.fitAddon.fit();
                await new Promise((resolve) => setTimeout(resolve, 20));

                terminalSession.fitAddon.fit();
                await new Promise((resolve) => setTimeout(resolve, 20));

                // Final fit
                terminalSession.fitAddon.fit();

                const finalCols = terminalSession.terminal.cols;
                const finalRows = terminalSession.terminal.rows;

                console.log(
                    `Fallback resize complete: ${finalCols}x${finalRows}`,
                );

                // Update backend if connected
                if (terminalSession.isConnected) {
                    await ResizeShell(sessionId, finalCols, finalRows).catch(
                        (error) => {
                            console.warn(
                                "Error updating backend shell size:",
                                error,
                            );
                        },
                    );
                }
            }
        } catch (error) {
            console.error(
                `Error during force resize of session ${sessionId}:`,
                error,
            );

            // Last resort fallback
            try {
                terminalSession.fitAddon.fit();
            } catch (fallbackError) {
                console.error("Even fallback fit failed:", fallbackError);
            }
        }
    }

    handleResize() {
        // Handle window resize - aggressively resize all terminals
        console.log("Handling window resize...");

        // NEW: Use the new sizing system for better coordination

        // Force resize the active session immediately with proper validation
        if (this.activeSessionId) {
            const activeSession = this.terminals.get(this.activeSessionId);
            if (
                activeSession &&
                activeSession.container &&
                this.isContainerVisible(activeSession.container)
            ) {
                // NEW: Phase 2 - Use enhanced validation and sizing
                if (
                    this.validateEnhancedContainerDimensions(
                        activeSession.container,
                    )
                ) {
                    this.performEnhancedSizing(this.activeSessionId).catch(
                        (error) => {
                            console.warn(
                                "Enhanced resize failed for active session:",
                                error,
                            );
                            // Fallback to visibility-aware sizing
                            this.performVisibilityAwareSizing(
                                this.activeSessionId,
                            ).catch((fallbackError) => {
                                console.warn(
                                    "Visibility-aware fallback failed:",
                                    fallbackError,
                                );
                                // Final fallback to old method
                                this.forceResizeSession(
                                    this.activeSessionId,
                                ).catch((finalError) => {
                                    console.warn(
                                        "Final fallback resize also failed:",
                                        finalError,
                                    );
                                });
                            });
                        },
                    );
                } else {
                    // Add to pending queue for retry
                    this.addToPendingSizeQueue(this.activeSessionId);
                }
            }
        }

        // Process any terminals that became visible due to the resize
        setTimeout(() => {
            this.processPendingSizeQueue().catch((error) => {
                console.warn("Error processing pending size queue:", error);
            });
        }, 50);

        // Also resize any other visible terminals (with a small delay to avoid overwhelming)
        setTimeout(() => {
            for (const [sessionId, terminalSession] of this.terminals) {
                if (
                    sessionId !== this.activeSessionId &&
                    terminalSession &&
                    terminalSession.fitAddon &&
                    terminalSession.container &&
                    this.isContainerVisible(terminalSession.container)
                ) {
                    // NEW: Phase 2 - Use enhanced sizing method if container is valid
                    if (
                        this.validateEnhancedContainerDimensions(
                            terminalSession.container,
                        )
                    ) {
                        this.performEnhancedSizing(sessionId).catch((error) => {
                            console.warn(
                                `Enhanced resize failed for session ${sessionId}:`,
                                error,
                            );
                            // Fallback to visibility-aware sizing
                            this.performVisibilityAwareSizing(sessionId).catch(
                                (fallbackError) => {
                                    console.warn(
                                        `Visibility-aware fallback failed for session ${sessionId}:`,
                                        fallbackError,
                                    );
                                },
                            );
                        });
                    } else {
                        // Add to pending queue for retry
                        this.addToPendingSizeQueue(sessionId);
                    }
                }
            }
        }, 100);

        // Emit resize event to backend to save window state
        try {
            EventsEmit("frontend:window:resized").catch((error) => {
                console.warn("Error emitting window resize event:", error);
            });
        } catch (error) {
            console.warn("Error emitting resize event to backend:", error);
        }
    }

    // Public method to force resize all terminals - useful for debugging or manual fixes
    async forceResizeAllTerminals() {
        console.log("Force resizing all terminals...");

        const resizePromises = [];

        for (const [sessionId, terminalSession] of this.terminals) {
            if (
                terminalSession &&
                terminalSession.terminal &&
                terminalSession.fitAddon
            ) {
                console.log(`Force resizing terminal session: ${sessionId}`);

                // NEW: Phase 2 - Use enhanced sizing if container is visible
                if (
                    terminalSession.container &&
                    this.isContainerVisible(terminalSession.container)
                ) {
                    if (
                        this.validateEnhancedContainerDimensions(
                            terminalSession.container,
                        )
                    ) {
                        resizePromises.push(
                            this.performEnhancedSizing(sessionId).catch(
                                (error) => {
                                    console.warn(
                                        `Enhanced resize failed for session ${sessionId}:`,
                                        error,
                                    );
                                    // Fallback to visibility-aware sizing
                                    return this.performVisibilityAwareSizing(
                                        sessionId,
                                    ).catch((fallbackError) => {
                                        console.warn(
                                            `Visibility-aware fallback failed for ${sessionId}:`,
                                            fallbackError,
                                        );
                                        // Final fallback to old method
                                        return this.forceResizeSession(
                                            sessionId,
                                        ).catch((finalError) => {
                                            console.warn(
                                                `Final fallback resize also failed for ${sessionId}:`,
                                                finalError,
                                            );
                                        });
                                    });
                                },
                            ),
                        );
                    } else {
                        // Add to pending queue for later processing
                        this.addToPendingSizeQueue(sessionId);
                    }
                } else {
                    // Container not visible, use old method as fallback
                    resizePromises.push(
                        this.forceResizeSession(sessionId).catch((error) => {
                            console.warn(
                                `Failed to resize session ${sessionId}:`,
                                error,
                            );
                        }),
                    );
                }
            }
        }

        await Promise.all(resizePromises);

        // Also process any pending size operations
        await this.processPendingSizeQueue();

        console.log("All terminals resize complete");
    }

    // NEW: Start periodic processing of pending size queue
    startPendingSizeProcessor() {
        // Process pending size queue every 2 seconds
        setInterval(() => {
            if (this.pendingSizeQueue.size > 0) {
                console.log(
                    `Processing ${this.pendingSizeQueue.size} pending size operations`,
                );
                this.processPendingSizeQueue().catch((error) => {
                    console.warn(
                        "Error in periodic pending size processing:",
                        error,
                    );
                });
            }
        }, 2000);
    }

    scrollToBottom() {
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession) {
                terminalSession.terminal.scrollToBottom();
            }
        } else if (this.terminal) {
            this.terminal.scrollToBottom();
        }
    }

    focus() {
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession) {
                terminalSession.terminal.focus();
            }
        } else if (this.terminal) {
            this.terminal.focus();
        }
    }

    pasteText(text) {
        // Paste text into the active terminal using xterm.js native paste handling
        // This properly handles bracketed paste mode for multiline commands
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (
                terminalSession &&
                terminalSession.terminal &&
                terminalSession.isConnected
            ) {
                try {
                    // Use xterm.js native paste method which handles bracketed paste mode
                    terminalSession.terminal.paste(text);
                    console.log(
                        "Text pasted to active terminal via xterm.js native paste",
                    );
                    return true;
                } catch (error) {
                    console.error(
                        "Failed to paste text to active terminal:",
                        error,
                    );
                    // Fallback to direct shell write if native paste fails
                    try {
                        WriteToShell(this.activeSessionId, text);
                        console.log(
                            "Text pasted to active terminal via backend fallback",
                        );
                        return true;
                    } catch (fallbackError) {
                        console.error(
                            "Failed to paste text via fallback:",
                            fallbackError,
                        );
                    }
                }
            }
        } else if (this.terminal && this.isConnected) {
            // Fallback to default terminal
            try {
                // Use xterm.js native paste method
                this.terminal.paste(text);
                console.log(
                    "Text pasted to default terminal via xterm.js native paste",
                );
                return true;
            } catch (error) {
                console.error(
                    "Failed to paste text to default terminal:",
                    error,
                );
                // Fallback to direct shell write if native paste fails
                try {
                    WriteToShell(this.sessionId, text);
                    console.log(
                        "Text pasted to default terminal via backend fallback",
                    );
                    return true;
                } catch (fallbackError) {
                    console.error(
                        "Failed to paste text via fallback:",
                        fallbackError,
                    );
                }
            }
        } else {
            console.warn("No active terminal session to paste text into");
        }
        return false;
    }

    getSelectedText() {
        // Get selected text from the active terminal
        if (this.activeSessionId) {
            const terminalSession = this.terminals.get(this.activeSessionId);
            if (terminalSession && terminalSession.terminal) {
                return terminalSession.terminal.getSelection();
            }
        } else if (this.terminal) {
            return this.terminal.getSelection();
        }
        return "";
    }

    findTabBySessionId(sessionId) {
        if (!this.tabsManager) return null;

        for (const [tabId, tab] of this.tabsManager.tabs) {
            if (tab.sessionId === sessionId) {
                return tabId;
            }
        }
        return null;
    }

    shouldTriggerActivity(data) {
        // Don't trigger activity for certain types of output
        if (!data || typeof data !== "string") return false;

        // Filter out SSH connection status messages with new format
        if (
            data.includes("SSH Connection") ||
            data.includes("Connecting...") ||
            data.includes("Connected to") ||
            data.includes("Connection established") ||
            data.includes("╭─") ||
            data.includes("╰─") || // SSH status borders
            data.match(/^\033\[[0-9;]*[mK]$/) || // Pure ANSI escape sequences
            data.trim() === "" || // Empty content
            data === "\r" || // Just carriage returns
            data.length < 2
        ) {
            // Very short content
            return false;
        }

        // Filter out new formatted SSH status messages (they shouldn't trigger activity)
        if (
            data.includes("● Authentication:") ||
            data.includes("⏳ Connecting to") ||
            data.includes("⏳ Creating session") ||
            data.includes("⏳ Loading key:") ||
            data.includes("⏳ Discovering authentication") ||
            data.includes("✓ Connection established") ||
            data.includes("✓ SSH session ready") ||
            data.includes("● New host:") ||
            (data.includes("⏳ Adding") && data.includes("to known hosts")) ||
            (data.includes("✓ Host") && data.includes("verified and added"))
        ) {
            return false;
        }

        // Trigger activity for actual user content and important warnings/errors
        return true;
    }

    processSSHMessage(data, sessionId) {
        // Don't process empty or non-string data
        if (!data || typeof data !== "string") {
            return data;
        }

        // Check if this is an SSH connection message by looking for our new format
        const isSSHMessage =
            data.includes("●") ||
            data.includes("✓") ||
            data.includes("⚠") ||
            data.includes("⏳") ||
            data.includes("✗");

        if (!isSSHMessage) {
            return data; // Return original data if not an SSH status message
        }

        // Add some spacing and formatting improvements for SSH messages
        let processedData = data;

        // Add subtle animation effect for progress messages
        if (data.includes("⏳")) {
            // Add a subtle pulse effect using ANSI sequences (optional enhancement)
            processedData = data.replace("⏳", "\x1b[2m⏳\x1b[0m\x1b[90m");
        }

        // Make success messages slightly more prominent
        if (data.includes("✓")) {
            processedData = data.replace("✓", "\x1b[1m✓\x1b[0m");
        }

        // Make warning messages more noticeable
        if (data.includes("⚠")) {
            processedData = data.replace("⚠", "\x1b[1m⚠\x1b[0m");
        }

        // Add subtle visual separation for SSH connection flow
        if (data.includes("✓ SSH session ready")) {
            // Update tab status for successful connection
            this.updateSSHConnectionStatus(sessionId, "connected");
        }

        // Handle connection errors
        if (
            data.includes("✗") &&
            (data.includes("failed") || data.includes("error"))
        ) {
            this.updateSSHConnectionStatus(sessionId, "failed");
        }

        // Handle warnings
        if (data.includes("⚠") && data.includes("Host key changed")) {
            this.updateSSHConnectionStatus(sessionId, "warning");
        }

        return processedData;
    }

    updateSSHConnectionStatus(sessionId, status) {
        // Find the tab associated with this session and update its visual state
        if (this.tabsManager) {
            const tabId = this.findTabBySessionId(sessionId);
            if (tabId) {
                // Emit a custom event that the tabs manager can listen to
                const event = new CustomEvent("ssh-connection-status", {
                    detail: {
                        sessionId,
                        tabId,
                        status,
                        timestamp: Date.now(),
                    },
                });
                document.dispatchEvent(event);

                // Also log for debugging
                console.log(
                    `SSH connection status updated: ${sessionId} -> ${status}`,
                );
            }
        }
    }

    async loadTerminalConfig() {
        try {
            const scrollbackLines = await ConfigGet("ScrollbackLines");
            const openLinksExternal = await ConfigGet("OpenLinksInExternalBrowser");

            this.scrollbackLines = scrollbackLines;
            this.maxBufferLines = scrollbackLines;
            this.openLinksInExternalBrowser = openLinksExternal;

            console.log(
                `Loaded terminal config: scrollback=${scrollbackLines}, openLinksExternal=${openLinksExternal}`,
            );

            // Update existing terminals with new config
            this.applyConfigToAllTerminals();
        } catch (error) {
            console.warn("Failed to load terminal config from backend:", error);
            // Use defaults if backend fails
            this.scrollbackLines = 10000;
            this.maxBufferLines = 10000;
            this.openLinksInExternalBrowser = true;
        }
    }

    setupConfigListeners() {
        // Listen for config changes from backend
        EventsOn("config:scrollback-lines-changed", (data) => {
            const { scrollbackLines } = data;
            console.log(`Scrollback lines changed to: ${scrollbackLines}`);
            this.scrollbackLines = scrollbackLines;
            this.maxBufferLines = scrollbackLines;
            this.applyConfigToAllTerminals();
        });

        // Listen for URL opening preference changes
        EventsOn("config:open-links-external-changed", (data) => {
            const openLinksExternal = data.OpenLinksInExternalBrowser;
            console.log(`Open links in external browser changed to: ${openLinksExternal}`);
            this.openLinksInExternalBrowser = openLinksExternal;
            // No need to apply to terminals - the handler checks the property at runtime
        });
    }

    applyConfigToAllTerminals() {
        // Update all existing terminal sessions with new config
        for (const [sessionId, terminalSession] of this.terminals) {
            if (terminalSession.terminal) {
                try {
                    // Update terminal options
                    terminalSession.terminal.options.scrollback =
                        this.scrollbackLines;
                    console.log(
                        `Updated scrollback for session ${sessionId} to ${this.scrollbackLines} lines`,
                    );
                } catch (error) {
                    console.warn(
                        `Error updating config for session ${sessionId}:`,
                        error,
                    );
                }
            }
        }
    }

    // Host key prompt mode methods
    enableHostKeyPromptMode(sessionId) {
        console.log(`Enabling host key prompt mode for session: ${sessionId}`);

        this.hostKeyPromptMode.active = true;
        this.hostKeyPromptMode.sessionId = sessionId;

        // Add visual indicator to the terminal
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession && terminalSession.container) {
            terminalSession.container.classList.add("host-key-prompt-active");
        }

        // Set up global keyboard listener
        this.hostKeyPromptMode.keydownHandler = (event) => {
            this.handleHostKeyPromptInput(event);
        };

        document.addEventListener(
            "keydown",
            this.hostKeyPromptMode.keydownHandler,
            true,
        );
        console.log(
            "Host key prompt mode enabled - listening for keyboard input",
        );
    }

    disableHostKeyPromptMode() {
        console.log("Disabling host key prompt mode");

        const sessionId = this.hostKeyPromptMode.sessionId;
        this.hostKeyPromptMode.active = false;
        this.hostKeyPromptMode.sessionId = null;

        // Remove visual indicator
        if (sessionId) {
            const terminalSession = this.terminals.get(sessionId);
            if (terminalSession && terminalSession.container) {
                terminalSession.container.classList.remove(
                    "host-key-prompt-active",
                );
            }
        }

        // Remove keyboard event listener
        if (this.hostKeyPromptMode.keydownHandler) {
            document.removeEventListener(
                "keydown",
                this.hostKeyPromptMode.keydownHandler,
                true,
            );
            this.hostKeyPromptMode.keydownHandler = null;
        }

        console.log("Host key prompt mode disabled");
    }

    handleHostKeyPromptInput(event) {
        if (!this.hostKeyPromptMode.active) return;

        const sessionId = this.hostKeyPromptMode.sessionId;
        console.log(
            `Host key prompt input: ${event.key} for session: ${sessionId}`,
        );

        // Handle Enter key (approve)
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, true);
            this.disableHostKeyPromptMode();
        }
        // Handle Escape key (reject)
        else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, false);
            this.disableHostKeyPromptMode();
        }
        // Handle 'y' or 'Y' for yes
        else if (event.key.toLowerCase() === "y") {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, true);
            this.disableHostKeyPromptMode();
        }
        // Handle 'n' or 'N' for no
        else if (event.key.toLowerCase() === "n") {
            event.preventDefault();
            event.stopPropagation();
            this.approveHostKey(sessionId, false);
            this.disableHostKeyPromptMode();
        }
    }

    async approveHostKey(sessionId, approved) {
        try {
            console.log(
                `Host key ${approved ? "approved" : "rejected"} for session: ${sessionId}`,
            );

            await ApproveHostKeyUpdate(sessionId, approved);

            if (approved) {
                console.log(
                    "Host key updated successfully. You can now retry the connection.",
                );
            } else {
                console.log("Host key update cancelled by user.");
            }
        } catch (error) {
            console.error("Failed to process host key approval:", error);
        }
    }

    cleanup() {
        console.log("Starting terminal cleanup...");

        // NEW: Clean up sizing system first
        console.log("Cleaning up sizing system...");

        // Clean up visibility observer
        if (this.visibilityObserver) {
            try {
                this.visibilityObserver.disconnect();
                console.log("Visibility observer disconnected");
            } catch (error) {
                console.warn("Error disconnecting visibility observer:", error);
            }
            this.visibilityObserver = null;
        }

        // Clean up container observers
        for (const [sessionId, observer] of this.containerObservers) {
            try {
                observer.disconnect();
                console.log(
                    `Container observer disconnected for session: ${sessionId}`,
                );
            } catch (error) {
                console.warn(
                    `Error disconnecting container observer for ${sessionId}:`,
                    error,
                );
            }
        }
        this.containerObservers.clear();

        // Clear sizing queues and tracking
        this.pendingSizeQueue.clear();
        this.sizingInProgress.clear();
        console.log("Sizing queues cleared");

        // Stop resource monitoring
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Cleanup resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        // Cleanup global listeners
        if (this.globalOutputListener) {
            try {
                this.globalOutputListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global output listener:",
                    error,
                );
            }
            this.globalOutputListener = null;
        }

        if (this.globalTabStatusListener) {
            try {
                this.globalTabStatusListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global tab status listener:",
                    error,
                );
            }
            this.globalTabStatusListener = null;
        }

        if (this.globalTabSwitchListener) {
            try {
                this.globalTabSwitchListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global tab switch listener:",
                    error,
                );
            }
            this.globalTabSwitchListener = null;
        }

        // NEW: Clean up global reconnection sizing listener
        if (this.globalReconnectionSizingListener) {
            try {
                this.globalReconnectionSizingListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global reconnection sizing listener:",
                    error,
                );
            }
            this.globalReconnectionSizingListener = null;
        }

        if (this.globalSizeSyncListener) {
            try {
                this.globalSizeSyncListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global size sync listener:",
                    error,
                );
            }
            this.globalSizeSyncListener = null;
        }

        if (this.globalConfigListener) {
            try {
                this.globalConfigListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global config listener:",
                    error,
                );
            }
            this.globalConfigListener = null;
        }

        if (this.globalHostKeyPromptListener) {
            try {
                this.globalHostKeyPromptListener();
            } catch (error) {
                console.warn(
                    "Error cleaning up global host key prompt listener:",
                    error,
                );
            }
            this.globalHostKeyPromptListener = null;
        }

        // Disable host key prompt mode if active
        if (this.hostKeyPromptMode.active) {
            this.disableHostKeyPromptMode();
        }

        // Cleanup AI float window
        if (this.aiFloatWindow) {
            try {
                this.aiFloatWindow.hide();
                this.aiFloatWindow.terminalManager = null;
                console.log("AI float window cleaned up");
            } catch (error) {
                console.warn("Error cleaning up AI float window:", error);
            }
            this.aiFloatWindow = null;
        }

        // Cleanup all terminal sessions
        for (const [sessionId, terminalSession] of this.terminals) {
            this.disconnectSession(sessionId);
        }

        // Clear terminals map
        this.terminals.clear();

        console.log("Terminal cleanup completed successfully");
    }

    checkForReconnection(sessionId) {
        // Find the tab associated with this session
        for (const [tabId, tab] of this.tabsManager.tabs) {
            if (tab.sessionId === sessionId) {
                // Check if it's an SSH tab that is disconnected/failed/hanging
                const isSSH = tab.connectionType === "ssh";
                const needsReconnection =
                    tab.status === "failed" ||
                    tab.status === "disconnected" ||
                    tab.status === "hanging";

                if (isSSH && needsReconnection) {
                    // Trigger reconnection
                    this.tabsManager.reconnectTab(tabId).catch((error) => {
                        console.error(
                            "Failed to reconnect tab via Enter key:",
                            error,
                        );
                    });
                    return true;
                }
                break;
            }
        }
        return false;
    }

    setupTerminalSizeSync() {
        // Clean up existing listeners first
        if (this.globalSizeSyncListener) {
            try {
                this.globalSizeSyncListener();
            } catch (error) {
                console.warn("Error cleaning up size sync listener:", error);
            }
        }

        // Listen for terminal size requests from backend using Wails EventsOn
        this.globalSizeSyncListener = EventsOn(
            "terminal-size-request",
            (data) => {
                const { sessionId } = data;
                console.log(
                    `Received terminal size request for session: ${sessionId}`,
                );
                this.handleTerminalSizeRequest(sessionId);
            },
        );

        // Listen for immediate terminal size sync requests (for SSH connections)
        EventsOn("terminal-size-sync-request", (data) => {
            const { sessionId, immediate } = data;
            console.log(
                `Received terminal size sync request for session: ${sessionId}, immediate: ${immediate}`,
            );
            if (immediate) {
                // For immediate requests, do aggressive terminal fitting and sizing
                setTimeout(() => {
                    this.handleImmediateTerminalSizeSync(sessionId);
                }, 50); // Shorter delay for immediate requests
            } else {
                this.handleTerminalSizeRequest(sessionId);
            }
        });

        // Reduce periodic size sync to prevent constant resizing
        // Only sync SSH connections and only every 30 seconds to avoid disrupting VIM/editors
        setInterval(() => {
            this.syncSSHTerminalSizes();
        }, 30000); // Sync every 30 seconds instead of 5
    }

    handleTerminalSizeRequest(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.terminal) {
            console.warn(
                `Terminal size request for unknown session: ${sessionId}`,
            );
            return;
        }

        // Only resize if the terminal is visible and active to avoid disrupting editors
        const isActiveSession = sessionId === this.activeSessionId;
        if (!isActiveSession) {
            console.log(
                `Skipping size sync for inactive session: ${sessionId}`,
            );
            return;
        }

        // Get current dimensions without forcing a fit (to avoid disruption)
        const currentCols = terminalSession.terminal.cols || 80;
        const currentRows = terminalSession.terminal.rows || 24;

        // Check if size has actually changed since last sync
        const lastSyncedSize = terminalSession.lastSyncedSize;
        if (
            lastSyncedSize &&
            lastSyncedSize.cols === currentCols &&
            lastSyncedSize.rows === currentRows
        ) {
            console.log(
                `Terminal size unchanged for ${sessionId}: ${currentCols}x${currentRows}`,
            );
            return;
        }

        console.log(
            `Syncing terminal size for ${sessionId}: ${currentCols}x${currentRows}`,
        );

        // Store the size we're syncing to avoid redundant calls
        terminalSession.lastSyncedSize = {
            cols: currentCols,
            rows: currentRows,
        };

        // Send current size to backend
        ResizeShell(sessionId, currentCols, currentRows).catch((error) => {
            console.warn(
                `Failed to sync terminal size for ${sessionId}:`,
                error,
            );
            // Clear the stored size on error so we can retry later
            delete terminalSession.lastSyncedSize;
        });
    }

    handleImmediateTerminalSizeSync(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.terminal) {
            console.warn(
                `Immediate terminal size sync for unknown session: ${sessionId}`,
            );
            return;
        }

        console.log(`Performing immediate terminal size sync for ${sessionId}`);

        // For immediate sync (SSH connections), always force fit and get accurate dimensions
        if (terminalSession.fitAddon) {
            // Force multiple fits to ensure accurate sizing
            terminalSession.fitAddon.fit();

            // Use proposeDimensions for most accurate sizing
            const proposedDimensions =
                terminalSession.fitAddon.proposeDimensions();

            if (
                proposedDimensions &&
                proposedDimensions.cols > 0 &&
                proposedDimensions.rows > 0
            ) {
                // Resize terminal to proposed dimensions first
                terminalSession.terminal.resize(
                    proposedDimensions.cols,
                    proposedDimensions.rows,
                );

                // Then fit again to ensure proper layout
                setTimeout(() => {
                    if (terminalSession.fitAddon) {
                        terminalSession.fitAddon.fit();

                        // Get final dimensions and send to backend
                        const finalCols =
                            terminalSession.terminal.cols ||
                            proposedDimensions.cols;
                        const finalRows =
                            terminalSession.terminal.rows ||
                            proposedDimensions.rows;

                        console.log(
                            `Immediate sync - final dimensions for ${sessionId}: ${finalCols}x${finalRows}`,
                        );

                        // Clear any cached size to force the update
                        delete terminalSession.lastSyncedSize;

                        // Send size to backend
                        ResizeShell(sessionId, finalCols, finalRows).catch(
                            (error) => {
                                console.warn(
                                    `Failed to sync immediate terminal size for ${sessionId}:`,
                                    error,
                                );
                            },
                        );
                    }
                }, 10);
            } else {
                // Fallback to regular terminal dimensions
                const cols = terminalSession.terminal.cols || 80;
                const rows = terminalSession.terminal.rows || 24;

                console.log(
                    `Immediate sync - fallback dimensions for ${sessionId}: ${cols}x${rows}`,
                );

                // Clear any cached size to force the update
                delete terminalSession.lastSyncedSize;

                ResizeShell(sessionId, cols, rows).catch((error) => {
                    console.warn(
                        `Failed to sync immediate terminal size (fallback) for ${sessionId}:`,
                        error,
                    );
                });
            }
        } else {
            // No fit addon available, use current dimensions
            const cols = terminalSession.terminal.cols || 80;
            const rows = terminalSession.terminal.rows || 24;

            console.log(
                `Immediate sync - no fitAddon, using current dimensions for ${sessionId}: ${cols}x${rows}`,
            );

            // Clear any cached size to force the update
            delete terminalSession.lastSyncedSize;

            ResizeShell(sessionId, cols, rows).catch((error) => {
                console.warn(
                    `Failed to sync immediate terminal size (no addon) for ${sessionId}:`,
                    error,
                );
            });
        }
    }

    syncSSHTerminalSizes() {
        // Only sync SSH connections and only if they haven't been resized recently
        this.terminals.forEach((terminalSession, sessionId) => {
            if (terminalSession.isConnected && terminalSession.terminal) {
                // Check if this is an SSH connection
                const isSSH = this.isSSHConnection(sessionId);
                if (isSSH) {
                    // Only sync if the session is active or if it's been a while since last sync
                    const isActiveSession = sessionId === this.activeSessionId;
                    const now = Date.now();
                    const lastSync = terminalSession.lastSizeSync || 0;
                    const timeSinceLastSync = now - lastSync;

                    // Sync if it's the active session or if it's been more than 2 minutes
                    if (isActiveSession || timeSinceLastSync > 120000) {
                        console.log(
                            `Syncing SSH terminal size for session: ${sessionId}`,
                        );
                        this.handleTerminalSizeRequest(sessionId);
                        terminalSession.lastSizeSync = now;
                    }
                }
            }
        });
    }

    isSSHConnection(sessionId) {
        // Check if this session belongs to an SSH tab
        // This is a simple check - you could enhance this by storing connection type
        const tabManager = window.tabsManager;
        if (!tabManager) return false;

        for (const [tabId, tab] of tabManager.tabs) {
            if (tab.sessionId === sessionId && tab.connectionType === "ssh") {
                return true;
            }
        }
        return false;
    }

    startResourceMonitoring() {
        // Monitor resource usage every 30 seconds
        this.cleanupInterval = setInterval(() => {
            this.performResourceCleanup();
        }, 30000);
    }

    performResourceCleanup() {
        try {
            // Cleanup disconnected sessions
            for (const [sessionId, terminalSession] of this.terminals) {
                if (!terminalSession.isConnected && !terminalSession.terminal) {
                    console.log(`Cleaning up orphaned session: ${sessionId}`);
                    this.terminals.delete(sessionId);
                }

                // Note: Removed automatic terminal clearing when buffer gets large
                // xterm.js handles buffer limits naturally by scrolling old content out
                // Auto-clearing was disruptive to user experience
            }

            // Enforce session limits
            if (this.terminals.size > this.maxSessions) {
                console.warn(
                    `Too many terminal sessions (${this.terminals.size}), cleaning up oldest`,
                );
                this.cleanupOldestSessions(
                    this.terminals.size - this.maxSessions,
                );
            }
        } catch (error) {
            console.warn("Error during resource cleanup:", error);
        }
    }

    cleanupOldestSessions(count) {
        // Sort by last activity or creation time
        const sessions = Array.from(this.terminals.entries())
            .filter(([_, session]) => !session.isConnected)
            .sort((a, b) => (a[1].lastActivity || 0) - (b[1].lastActivity || 0))
            .slice(0, count);

        for (const [sessionId] of sessions) {
            console.log(`Force cleaning up old session: ${sessionId}`);
            this.disconnectSession(sessionId);
        }
    }

    clearTerminal(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (terminalSession && terminalSession.terminal) {
            // Always clear everything including scrollback buffer
            terminalSession.terminal.reset();
        }
    }

    // NEW: Initialize visibility monitoring
    setupVisibilityMonitoring() {
        // Set up MutationObserver to detect when terminal containers become visible
        this.visibilityObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "style"
                ) {
                    const target = mutation.target;
                    if (target.classList.contains("terminal-instance")) {
                        const sessionId = target.dataset.sessionId;
                        if (sessionId && this.isContainerVisible(target)) {
                            console.log(
                                `Terminal container became visible: ${sessionId}`,
                            );
                            this.handleContainerBecameVisible(sessionId);
                        }
                    }
                }
            });
        });

        // Observe the main terminal container for changes
        const mainContainer = document.getElementById("terminal");
        if (mainContainer) {
            this.visibilityObserver.observe(mainContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["style"],
            });
        }
    }

    // NEW: Check if container is visible and has valid dimensions
    isContainerVisible(container) {
        if (!container) return false;

        const computedStyle = window.getComputedStyle(container);
        if (
            computedStyle.display === "none" ||
            computedStyle.visibility === "hidden"
        ) {
            return false;
        }

        const rect = container.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    // NEW: Validate container dimensions for terminal fitting
    validateContainerDimensions(container, minWidth = 100, minHeight = 50) {
        if (!container) {
            console.warn("Container validation failed: no container provided");
            return false;
        }

        const rect = container.getBoundingClientRect();
        const isValid = rect.width >= minWidth && rect.height >= minHeight;

        if (!isValid) {
            console.warn(
                `Container dimensions invalid: ${rect.width}x${rect.height} (min: ${minWidth}x${minHeight})`,
            );
        }

        return isValid;
    }

    // NEW: Handle when a container becomes visible
    async handleContainerBecameVisible(sessionId) {
        // Avoid duplicate processing
        if (this.sizingInProgress.has(sessionId)) {
            console.log(
                `Sizing already in progress for ${sessionId}, skipping`,
            );
            return;
        }

        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.container) {
            console.warn(
                `No terminal session found for visible container: ${sessionId}`,
            );
            return;
        }

        // Remove from pending queue if it was waiting
        this.pendingSizeQueue.delete(sessionId);

        // Wait for layout to settle after visibility change
        await this.waitForLayoutSettle();

        // Validate container before attempting to size
        if (!this.validateContainerDimensions(terminalSession.container)) {
            console.warn(
                `Container ${sessionId} became visible but dimensions are invalid, will retry`,
            );
            // Add back to pending queue for retry
            this.pendingSizeQueue.add(sessionId);
            return;
        }

        // Perform the sizing operation
        await this.performDeferredSizing(sessionId);
    }

    // NEW: Wait for DOM layout to settle
    async waitForLayoutSettle() {
        // Wait for multiple animation frames to ensure layout is complete
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // Additional small delay for complex layouts
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // NEW: Perform deferred sizing for a terminal
    async performDeferredSizing(sessionId) {
        this.sizingInProgress.add(sessionId);

        try {
            console.log(`Performing deferred sizing for session: ${sessionId}`);

            // NEW: Phase 2 - Try enhanced sizing first, with fallbacks
            const terminalSession = this.terminals.get(sessionId);
            if (terminalSession && terminalSession.container) {
                if (
                    this.validateEnhancedContainerDimensions(
                        terminalSession.container,
                    )
                ) {
                    await this.performEnhancedSizing(sessionId);
                } else if (
                    this.validateContainerDimensions(terminalSession.container)
                ) {
                    await this.performVisibilityAwareSizing(sessionId);
                } else {
                    await this.forceResizeSession(sessionId);
                }
            } else {
                await this.forceResizeSession(sessionId);
            }

            console.log(`Deferred sizing completed for session: ${sessionId}`);
        } catch (error) {
            console.error(
                `Deferred sizing failed for session ${sessionId}:`,
                error,
            );
        } finally {
            this.sizingInProgress.delete(sessionId);
        }
    }

    // NEW: Add session to pending size queue
    addToPendingSizeQueue(sessionId) {
        this.pendingSizeQueue.add(sessionId);
        console.log(`Added ${sessionId} to pending size queue`);
    }

    // NEW: Process pending size queue
    async processPendingSizeQueue() {
        const pending = Array.from(this.pendingSizeQueue);
        console.log(`Processing ${pending.length} pending size operations`);

        for (const sessionId of pending) {
            const terminalSession = this.terminals.get(sessionId);
            if (
                terminalSession &&
                terminalSession.container &&
                this.isContainerVisible(terminalSession.container)
            ) {
                await this.handleContainerBecameVisible(sessionId);
            }
        }
    }

    // NEW: Phase 2 - Set up container-specific resize observer
    setupContainerResizeObserver(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.container) {
            console.warn(
                `Cannot setup container observer for ${sessionId} - session invalid`,
            );
            return;
        }

        console.log(
            `Setting up container resize observer for session: ${sessionId}`,
        );

        // Create ResizeObserver for this specific container
        const containerObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target === terminalSession.container) {
                    // Debounce resize events to prevent overwhelming
                    const now = Date.now();
                    if (
                        now - terminalSession.lastSizeAttempt <
                        terminalSession.sizeAttemptDelay
                    ) {
                        console.log(
                            `Skipping resize for ${sessionId} - too soon after last attempt`,
                        );
                        return;
                    }
                    terminalSession.lastSizeAttempt = now;

                    console.log(
                        `Container size changed for ${sessionId}:`,
                        entry.contentRect.width,
                        "x",
                        entry.contentRect.height,
                    );

                    // Only trigger if container is visible and has valid dimensions
                    if (
                        this.isContainerVisible(terminalSession.container) &&
                        this.validateContainerDimensions(
                            terminalSession.container,
                        )
                    ) {
                        // Use enhanced sizing with retry logic
                        this.performEnhancedSizing(sessionId).catch((error) => {
                            console.warn(
                                `Enhanced sizing failed for ${sessionId}:`,
                                error,
                            );
                        });
                    } else {
                        // Add to pending queue for later processing
                        this.addToPendingSizeQueue(sessionId);
                    }
                    break;
                }
            }
        });

        // Start observing the container
        containerObserver.observe(terminalSession.container);

        // Store the observer for cleanup
        terminalSession.containerObserver = containerObserver;
        this.containerObservers.set(sessionId, containerObserver);

        console.log(
            `Container resize observer set up for session: ${sessionId}`,
        );
    }

    // NEW: Phase 2 - Enhanced sizing with retry logic and fallback
    async performEnhancedSizing(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.fitAddon) {
            console.warn(
                `Cannot perform enhanced sizing for ${sessionId} - session invalid`,
            );
            return;
        }

        // Avoid concurrent sizing operations for the same session
        if (this.sizingInProgress.has(sessionId)) {
            console.log(
                `Sizing already in progress for ${sessionId}, skipping enhanced sizing`,
            );
            return;
        }

        console.log(
            `Performing enhanced sizing for session: ${sessionId} (attempt ${terminalSession.retryCount + 1})`,
        );
        this.sizingInProgress.add(sessionId);

        try {
            // Reset retry count on successful start
            terminalSession.retryCount = 0;

            // Enhanced layout settling - wait for multiple conditions
            await this.waitForEnhancedLayoutSettle(terminalSession.container);

            // Validate container dimensions with enhanced checks
            if (
                !this.validateEnhancedContainerDimensions(
                    terminalSession.container,
                )
            ) {
                throw new Error("Container dimensions validation failed");
            }

            // Perform the actual sizing with enhanced precision
            const success = await this.performPrecisionSizing(sessionId);

            if (!success) {
                throw new Error("Precision sizing failed");
            }

            console.log(
                `Enhanced sizing completed successfully for session: ${sessionId}`,
            );

            // Remove from pending queue on success
            this.pendingSizeQueue.delete(sessionId);
        } catch (error) {
            console.warn(
                `Enhanced sizing failed for session ${sessionId}:`,
                error,
            );

            // Implement exponential backoff retry
            if (terminalSession.retryCount < terminalSession.maxRetries) {
                terminalSession.retryCount++;
                const delay =
                    terminalSession.retryBackoff *
                    Math.pow(2, terminalSession.retryCount - 1);

                console.log(
                    `Retrying enhanced sizing for ${sessionId} in ${delay}ms (attempt ${terminalSession.retryCount})`,
                );

                setTimeout(() => {
                    if (
                        this.terminals.has(sessionId) &&
                        this.isContainerVisible(terminalSession.container)
                    ) {
                        this.performEnhancedSizing(sessionId);
                    }
                }, delay);
            } else {
                console.warn(
                    `Max retries reached for enhanced sizing of ${sessionId}, adding to pending queue`,
                );
                this.addToPendingSizeQueue(sessionId);
                // Reset retry count for future attempts
                terminalSession.retryCount = 0;
            }
        } finally {
            this.sizingInProgress.delete(sessionId);
        }
    }

    // NEW: Phase 2 - Enhanced layout settling with multiple validation checks
    async waitForEnhancedLayoutSettle(container) {
        // Wait for multiple animation frames
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));

        // Wait for layout to stabilize by checking if dimensions change
        let previousWidth = container.offsetWidth;
        let previousHeight = container.offsetHeight;

        // Check stability over multiple frames
        for (let i = 0; i < 3; i++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));

            const currentWidth = container.offsetWidth;
            const currentHeight = container.offsetHeight;

            if (
                currentWidth !== previousWidth ||
                currentHeight !== previousHeight
            ) {
                console.log("Layout still settling, waiting more...");
                previousWidth = currentWidth;
                previousHeight = currentHeight;
                // Add small delay for complex layouts
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        // Final small delay to ensure layout is completely stable
        await new Promise((resolve) => setTimeout(resolve, 15));
    }

    // NEW: Phase 2 - Enhanced container validation with more thorough checks
    validateEnhancedContainerDimensions(
        container,
        minWidth = 100,
        minHeight = 50,
    ) {
        if (!container) {
            console.warn("Enhanced validation failed: no container provided");
            return false;
        }

        // Check if container is actually in the DOM
        if (!container.isConnected) {
            console.warn("Enhanced validation failed: container not in DOM");
            return false;
        }

        // Check computed styles
        const computedStyle = window.getComputedStyle(container);
        if (
            computedStyle.display === "none" ||
            computedStyle.visibility === "hidden"
        ) {
            console.warn("Enhanced validation failed: container is hidden");
            return false;
        }

        // Check both offset and client dimensions
        const offsetValid =
            container.offsetWidth >= minWidth &&
            container.offsetHeight >= minHeight;
        const clientValid =
            container.clientWidth >= minWidth &&
            container.clientHeight >= minHeight;

        if (!offsetValid || !clientValid) {
            console.warn(`Enhanced validation failed: dimensions too small`, {
                offset: `${container.offsetWidth}x${container.offsetHeight}`,
                client: `${container.clientWidth}x${container.clientHeight}`,
                required: `${minWidth}x${minHeight}`,
            });
            return false;
        }

        // Check if container has a valid bounding rect
        const rect = container.getBoundingClientRect();
        if (rect.width < minWidth || rect.height < minHeight) {
            console.warn(
                `Enhanced validation failed: bounding rect too small`,
                {
                    rect: `${rect.width}x${rect.height}`,
                    required: `${minWidth}x${minHeight}`,
                },
            );
            return false;
        }

        return true;
    }

    // NEW: Phase 2 - Precision sizing with multiple techniques
    async performPrecisionSizing(sessionId) {
        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.fitAddon) {
            console.warn(
                `Cannot perform precision sizing for ${sessionId} - session invalid`,
            );
            return false;
        }

        console.log(`Performing precision sizing for session: ${sessionId}`);

        try {
            // Method 1: Use proposeDimensions (most accurate)
            const proposedDimensions =
                terminalSession.fitAddon.proposeDimensions();

            if (
                proposedDimensions &&
                proposedDimensions.cols > 0 &&
                proposedDimensions.rows > 0
            ) {
                console.log(
                    `Using proposed dimensions for ${sessionId}: ${proposedDimensions.cols}x${proposedDimensions.rows}`,
                );

                // Resize terminal to proposed dimensions
                terminalSession.terminal.resize(
                    proposedDimensions.cols,
                    proposedDimensions.rows,
                );

                // Wait for resize to take effect
                await new Promise((resolve) => setTimeout(resolve, 10));

                // Follow up with fit to ensure proper layout
                terminalSession.fitAddon.fit();

                // Verify the sizing worked
                const finalCols = terminalSession.terminal.cols;
                const finalRows = terminalSession.terminal.rows;

                if (finalCols > 0 && finalRows > 0) {
                    console.log(
                        `Precision sizing successful for ${sessionId}: ${finalCols}x${finalRows}`,
                    );

                    // Update backend if connected
                    if (terminalSession.isConnected) {
                        await ResizeShell(
                            sessionId,
                            finalCols,
                            finalRows,
                        ).catch((error) => {
                            console.warn(
                                "Error updating backend shell size:",
                                error,
                            );
                        });
                    }

                    return true;
                }
            }

            // Method 2: Fallback to multiple fits with validation
            console.log(
                `Proposed dimensions failed for ${sessionId}, using fallback method`,
            );

            // Force container reflow
            terminalSession.container.offsetWidth;
            terminalSession.container.offsetHeight;

            // Progressive fitting with validation
            for (let attempt = 0; attempt < 3; attempt++) {
                terminalSession.fitAddon.fit();
                await new Promise((resolve) => setTimeout(resolve, 20));

                const cols = terminalSession.terminal.cols;
                const rows = terminalSession.terminal.rows;

                if (cols > 0 && rows > 0) {
                    console.log(
                        `Fallback sizing successful for ${sessionId}: ${cols}x${rows} (attempt ${attempt + 1})`,
                    );

                    // Update backend if connected
                    if (terminalSession.isConnected) {
                        await ResizeShell(sessionId, cols, rows).catch(
                            (error) => {
                                console.warn(
                                    "Error updating backend shell size:",
                                    error,
                                );
                            },
                        );
                    }

                    return true;
                }
            }

            console.warn(
                `All precision sizing methods failed for ${sessionId}`,
            );
            return false;
        } catch (error) {
            console.error(
                `Error during precision sizing for ${sessionId}:`,
                error,
            );
            return false;
        }
    }

    // NEW: Handle enhanced terminal sizing for reconnected tabs
    async handleReconnectionSizing(sessionId, immediate = true) {
        console.log(
            `Handling reconnection sizing for session: ${sessionId}, immediate: ${immediate}`,
        );

        const terminalSession = this.terminals.get(sessionId);
        if (!terminalSession || !terminalSession.terminal) {
            console.warn(
                `Cannot handle reconnection sizing for ${sessionId} - session invalid`,
            );
            return;
        }

        // IMPORTANT: Do NOT reset terminal state to preserve SSH login banner and content
        // Only reset sizing-related cache and state information

        // Clear any cached size information to force fresh sizing
        delete terminalSession.lastSyncedSize;
        delete terminalSession.lastSizeSync;
        terminalSession.retryCount = 0; // Reset retry count for fresh attempts

        // For immediate reconnection sizing, use aggressive enhanced sizing approach
        if (immediate) {
            console.log(
                `Performing immediate reconnection sizing for ${sessionId}`,
            );

            // Wait for terminal to be ready after reconnection
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Check if container is visible and validate dimensions
            if (this.isContainerVisible(terminalSession.container)) {
                if (
                    this.validateEnhancedContainerDimensions(
                        terminalSession.container,
                    )
                ) {
                    // Use Phase 2 enhanced sizing system
                    await this.performEnhancedSizing(sessionId);
                } else {
                    console.log(
                        `Container not ready for enhanced sizing, using fallback for ${sessionId}`,
                    );
                    // Wait a bit more and try fallback
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    await this.performVisibilityAwareSizing(sessionId);
                }
            } else {
                console.log(
                    `Container not visible for ${sessionId}, adding to pending queue`,
                );
                // Add to pending queue for processing when visible
                this.addToPendingSizeQueue(sessionId);
            }
        } else {
            // For non-immediate reconnection sizing, use standard approach
            console.log(
                `Performing deferred reconnection sizing for ${sessionId}`,
            );
            await this.performDeferredSizing(sessionId);
        }

        // Additional sizing attempts for SSH reconnections to ensure stability
        setTimeout(async () => {
            if (this.terminals.has(sessionId) && terminalSession.isConnected) {
                console.log(
                    `Follow-up sizing for reconnected session: ${sessionId}`,
                );
                try {
                    // Force another enhanced sizing attempt
                    if (
                        this.isContainerVisible(terminalSession.container) &&
                        this.validateEnhancedContainerDimensions(
                            terminalSession.container,
                        )
                    ) {
                        await this.performEnhancedSizing(sessionId);
                    }
                } catch (error) {
                    console.warn(
                        `Follow-up sizing failed for ${sessionId}:`,
                        error,
                    );
                }
            }
        }, 1000); // Secondary attempt after 1 second for stability
    }
}

// NEW: Debug tools for reconnection sizing (available globally for console testing)
window.debugReconnectionSizing = function (sessionId) {
    if (!window.terminalManager) {
        console.error("Terminal manager not available");
        return;
    }

    console.log("=== Reconnection Sizing Debug ===");
    const terminalSession = window.terminalManager.terminals.get(sessionId);

    if (!terminalSession) {
        console.error(`Session ${sessionId} not found`);
        return;
    }

    console.log(`Session ID: ${sessionId}`);
    console.log(`Terminal connected: ${terminalSession.isConnected}`);
    console.log(
        `Container visible: ${window.terminalManager.isContainerVisible(terminalSession.container)}`,
    );
    console.log(
        `Enhanced validation: ${window.terminalManager.validateEnhancedContainerDimensions(terminalSession.container)}`,
    );
    console.log(
        `Basic validation: ${window.terminalManager.validateContainerDimensions(terminalSession.container)}`,
    );
    console.log(`Retry count: ${terminalSession.retryCount}`);
    console.log(
        `In sizing queue: ${window.terminalManager.pendingSizeQueue.has(sessionId)}`,
    );
    console.log(
        `Sizing in progress: ${window.terminalManager.sizingInProgress.has(sessionId)}`,
    );

    if (terminalSession.container) {
        const rect = terminalSession.container.getBoundingClientRect();
        console.log(
            `Container dimensions: ${terminalSession.container.offsetWidth}x${terminalSession.container.offsetHeight}`,
        );
        console.log(
            `Container client: ${terminalSession.container.clientWidth}x${terminalSession.container.clientHeight}`,
        );
        console.log(`Container rect: ${rect.width}x${rect.height}`);
    }

    if (terminalSession.terminal) {
        console.log(
            `Terminal dimensions: ${terminalSession.terminal.cols}x${terminalSession.terminal.rows}`,
        );
    }

    console.log("=== End Debug ===");
};

window.testReconnectionSizing = function (sessionId) {
    if (!window.terminalManager) {
        console.error("Terminal manager not available");
        return;
    }

    console.log(`Testing reconnection sizing for session: ${sessionId}`);
    window.terminalManager
        .handleReconnectionSizing(sessionId, true)
        .catch((error) => {
            console.error("Test reconnection sizing failed:", error);
        });
};
