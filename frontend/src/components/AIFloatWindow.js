// AI Float Window Component for Terminal AI Assistant
import { showNotification } from '../modules/utils.js';

export class AIFloatWindow {
    constructor() {
        this.isVisible = false;
        this.isLoading = false;
        this.currentResponse = '';
        this.container = null;
        this.hiddenContext = '';
        this.conversationHistory = [];
        this.maxHistoryLength = 10;
        this.setupWindow();
        this.setupEventListeners();
    }

    setupWindow() {
        // Create the small, simple AI window HTML
        const windowHTML = `
            <div class="ai-float-window" id="ai-float-window">
                <div class="ai-window-header">
                    <div class="ai-window-title">
                        <img src="./icons/ai.svg" class="svg-icon" alt="🤖">
                        <span>AI Assistant</span>
                    </div>
                    <div class="ai-header-controls">
                        <div class="ai-history-control">
                            <button class="ai-control-btn" id="ai-clear-history-btn" title="Clear conversation history">
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                    <path d="M2 2h8v8H2z" stroke="currentColor" stroke-width="1.5" fill="none"/>
                                    <path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" stroke-width="1" fill="none"/>
                                </svg>
                            </button>
                            <span class="ai-history-count" id="ai-history-count" style="display: none;">0</span>
                        </div>
                        <button class="ai-control-btn" id="ai-close-btn" title="Close">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                <path d="M1 1l10 10M11 1l-10 10" stroke="currentColor" stroke-width="1.5" fill="none"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="ai-window-content">
                    <div class="ai-context-indicator" id="ai-context-indicator" style="display: none;">
                        <div class="ai-context-content">
                            <img src="./icons/document.svg" class="svg-icon" alt="📄">
                            <span class="ai-context-text" id="ai-context-text">Context attached</span>
                            <button class="ai-context-clear" id="ai-context-clear" title="Clear context">
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                    <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" fill="none"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="ai-input-container">
                        <input type="text" id="ai-prompt-input" class="ai-prompt-input" 
                            placeholder="Ask AI for help..." maxlength="200"
                            autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">
                        <button class="ai-send-btn" id="ai-send-btn" title="Send">
                            <img src="./icons/send.svg" class="svg-icon" alt="Send">
                        </button>
                    </div>
                    <div class="ai-response-container" id="ai-response-container">
                        <div class="ai-response-content" id="ai-response-content">
                            Press Enter or click Send to ask AI
                        </div>
                        <div class="ai-response-actions" id="ai-response-actions">
                            <button class="ai-action-btn" id="ai-paste-btn" title="Paste to terminal">
                                <img src="./icons/terminal.svg" class="svg-icon" alt="Paste">
                                Paste
                            </button>
                        </div>
                    </div>
                    <div class="ai-loading" id="ai-loading">
                        <div class="ai-spinner"></div>
                        <span>AI thinking...</span>
                    </div>
                </div>
            </div>
        `;

        // Add to document
        document.body.insertAdjacentHTML('beforeend', windowHTML);
        this.container = document.getElementById('ai-float-window');
        
        console.log('AI window created:', this.container); // Debug log
    }

    setupEventListeners() {
        // Send button
        document.getElementById('ai-send-btn').addEventListener('click', () => {
            this.sendPrompt();
        });

        // Enter key in prompt
        document.getElementById('ai-prompt-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendPrompt();
            }
        });

        // Close button
        document.getElementById('ai-close-btn').addEventListener('click', () => {
            this.hide();
        });

        // Paste to terminal button
        document.getElementById('ai-paste-btn').addEventListener('click', () => {
            this.pasteToTerminal();
        });

        // Clear context button
        document.getElementById('ai-context-clear').addEventListener('click', () => {
            this.clearContext();
        });

        // Clear history button
        document.getElementById('ai-clear-history-btn').addEventListener('click', () => {
            this.clearHistory();
        });

        // Make window draggable
        this.makeDraggable();

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });

        console.log('AI window event listeners set up'); // Debug log
    }

    makeDraggable() {
        const header = this.container.querySelector('.ai-window-header');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = this.container.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            const newLeft = startLeft + deltaX;
            const newTop = startTop + deltaY;
            
            // Keep window within viewport
            const maxLeft = window.innerWidth - this.container.offsetWidth;
            const maxTop = window.innerHeight - this.container.offsetHeight;
            
            this.container.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
            this.container.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = 'grab';
            }
        });
    }

    show() {
        if (this.isVisible) return;
        
        console.log('Showing AI window...'); // Debug log
        
        this.isVisible = true;
        this.container.style.display = 'block';
        this.container.classList.add('visible');
        
        // Position in center-right of screen (smaller window)
        const windowWidth = 350;
        const windowHeight = 200;
        const left = window.innerWidth - windowWidth - 20;
        const top = 100; // Fixed top position
        
        this.container.style.left = left + 'px';
        this.container.style.top = top + 'px';
        this.container.style.width = windowWidth + 'px';
        
        console.log('AI window positioned at:', left, top); // Debug log
        
        // Check for selected text and prefill
        this.prefillWithSelectedText();
        
        // Focus input
        setTimeout(() => {
            const input = document.getElementById('ai-prompt-input');
            if (input) {
                input.focus();
                console.log('AI input focused'); // Debug log
            }
        }, 100);
    }

    prefillWithSelectedText() {
        if (this.terminalManager && this.terminalManager.getSelectedText) {
            const selectedText = this.terminalManager.getSelectedText();
            if (selectedText && selectedText.trim()) {
                this.setContext(selectedText.trim());
                console.log('AI context set with selected text:', selectedText.trim());
            }
        }
    }

    hide() {
        if (!this.isVisible) return;
        
        console.log('Hiding AI window...'); // Debug log
        this.isVisible = false;
        this.container.classList.remove('visible');
        this.container.style.display = 'none';
    }

    async sendPrompt() {
        const promptInput = document.getElementById('ai-prompt-input');
        const prompt = promptInput.value.trim();
        
        if (!prompt) {
            showNotification('Please enter a prompt', 'warning');
            return;
        }

        // Build full prompt with history and context
        let fullPrompt = this.buildFullPrompt(prompt);

        if (this.isLoading) {
            showNotification('AI is already processing a request', 'warning');
            return;
        }

        try {
            this.setLoading(true);
            
            // Check if AI is enabled
            const isEnabled = await window.go.main.App.IsAIEnabled();
            if (!isEnabled) {
                throw new Error('AI features are disabled. Please enable them in settings.');
            }

            // Send request to backend
            const response = await window.go.main.App.SendAIRequest(fullPrompt);
            
            console.log('AI Response received:', response); // Debug log
            
            // Handle both direct response and wrapped response
            let content, error;
            if (response.result) {
                // Wrapped response format
                content = response.result.content;
                error = response.error;
            } else {
                // Direct response format
                content = response.Content || response.content;
                error = response.Error || response.error;
            }
            
            if (error) {
                throw new Error(error);
            }
            
            if (!content) {
                throw new Error('No content received from AI');
            }
            
            this.displayResponse(content);
            this.currentResponse = content;
            
            // Add to conversation history
            this.addToHistory('user', prompt);
            this.addToHistory('assistant', content);
            
            // Clear input
            promptInput.value = '';
            
        } catch (error) {
            console.error('AI request failed:', error);
            this.displayError(error.message || 'Failed to get AI response');
            showNotification('AI request failed: ' + (error.message || 'Unknown error'), 'error');
        } finally {
            this.setLoading(false);
        }
    }

    setLoading(loading) {
        this.isLoading = loading;
        const loadingEl = document.getElementById('ai-loading');
        const responseContainer = document.getElementById('ai-response-container');
        const sendBtn = document.getElementById('ai-send-btn');
        
        if (loading) {
            loadingEl.style.display = 'flex';
            responseContainer.style.display = 'none';
            sendBtn.disabled = true;
        } else {
            loadingEl.style.display = 'none';
            responseContainer.style.display = 'block';
            sendBtn.disabled = false;
        }
    }

    displayResponse(content) {
        const responseContent = document.getElementById('ai-response-content');
        const responseActions = document.getElementById('ai-response-actions');
        
        // Parse commands and create buttons
        const { formattedContent, commands } = this.parseResponseWithCommands(content);
        
        // If we have commands, hide the response content and show only buttons
        if (commands.length > 0) {
            responseContent.style.display = 'none';
            this.addCommandButtons(commands);
        } else {
            // If no commands, show the response content
            responseContent.style.display = 'block';
            responseContent.innerHTML = formattedContent;
        }
        
        responseActions.style.display = 'flex';
    }

    displayError(error) {
        const responseContent = document.getElementById('ai-response-content');
        const responseActions = document.getElementById('ai-response-actions');
        
        responseContent.style.display = 'block';
        responseContent.innerHTML = `<div class="ai-error">❌ ${error}</div>`;
        responseActions.style.display = 'none';
    }

    parseResponseWithCommands(content) {
        // Handle undefined/null content
        if (!content || typeof content !== 'string') {
            console.error('Invalid content for formatting:', content);
            return { 
                formattedContent: 'Error: Invalid response content', 
                commands: [] 
            };
        }
        
        // Split content into lines and detect commands
        const lines = content.split('\n');
        const commands = [];
        let processedContent = content;
        
        // Pattern to detect command lines (lines that look like shell commands)
        const commandPattern = /^([\$#>]\s*)?([a-zA-Z0-9\-_\.\/\\]+(?:\s+[^\n]+)?)$/;
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Skip empty lines or lines with explanatory text
            if (!trimmed || trimmed.length < 3) return;
            
            // Check if line looks like a command
            if (commandPattern.test(trimmed)) {
                // Remove prompt characters if present
                let command = trimmed.replace(/^[\$#>]\s*/, '');
                
                // Skip if it's just explanatory text (contains common words)
                const explanatoryWords = ['the', 'this', 'you', 'can', 'will', 'would', 'should', 'here', 'there', 'what', 'how', 'why', 'when'];
                const words = command.toLowerCase().split(/\s+/);
                const hasExplanatoryWords = explanatoryWords.some(word => words.includes(word));
                
                // Only add if it doesn't contain too many explanatory words and starts with a command-like word
                if (!hasExplanatoryWords && command.length > 0) {
                    // Check if first word looks like a command
                    const firstWord = words[0];
                    if (firstWord && (
                        firstWord.includes('.') ||  // has extension
                        firstWord.includes('/') ||  // has path
                        firstWord.includes('\\') || // windows path
                        firstWord.length <= 15      // short command name
                    )) {
                        commands.push({
                            command: command,
                            index: index,
                            original: line
                        });
                    }
                }
            }
        });
        
        // Format the content with markdown-like formatting and highlight commands
        let formatted = processedContent;
        
        // Highlight detected commands
        commands.forEach(cmd => {
            const escapedOriginal = cmd.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            formatted = formatted.replace(
                new RegExp(escapedOriginal, 'g'), 
                `<div class="ai-command-line">${cmd.original}</div>`
            );
        });
        
        // Apply other formatting
        formatted = formatted
            .replace(/```([\s\S]*?)```/g, '<pre class="ai-code-block"><code>$1</code></pre>')
            .replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
        
        return { 
            formattedContent: formatted, 
            commands: commands.map(cmd => cmd.command)
        };
    }

    formatResponse(content) {
        // Legacy method for backward compatibility
        const result = this.parseResponseWithCommands(content);
        return result.formattedContent;
    }

    addCommandButtons(commands) {
        const responseActions = document.getElementById('ai-response-actions');
        
        // Clear all existing buttons (both command buttons and general buttons)
        responseActions.innerHTML = '';
        
        // Add new command buttons only
        commands.forEach((command, index) => {
            const button = document.createElement('button');
            button.className = 'ai-command-button';
            button.title = `Click to paste: ${command}`;
            button.innerHTML = `<img src="./icons/terminal.svg" class="svg-icon" alt="$"> ${command}`;
            
            button.addEventListener('click', () => {
                this.pasteCommandToTerminal(command);
            });
            
            responseActions.appendChild(button);
        });
    }

    truncateCommand(command) {
        if (command.length <= 30) return command;
        return command.substring(0, 27) + '...';
    }

    async pasteCommandToTerminal(command) {
        try {
            // Use the terminal manager reference provided during initialization
            if (this.terminalManager && this.terminalManager.pasteText) {
                const success = this.terminalManager.pasteText(command);
                if (success) {
                    showNotification(`Command pasted: ${this.truncateCommand(command)}`, 'success');
                } else {
                    // Fallback: copy to clipboard
                    await navigator.clipboard.writeText(command);
                    showNotification('Command copied to clipboard (paste with Ctrl+V)', 'info');
                }
            } else {
                // Fallback: copy to clipboard
                await navigator.clipboard.writeText(command);
                showNotification('Command copied to clipboard (paste with Ctrl+V)', 'info');
            }
        } catch (error) {
            console.error('Paste command failed:', error);
            showNotification('Failed to paste command', 'error');
        }
    }

    async copyResponse() {
        if (!this.currentResponse) {
            showNotification('No response to copy', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(this.currentResponse);
            showNotification('Response copied to clipboard', 'success');
        } catch (error) {
            console.error('Copy failed:', error);
            showNotification('Failed to copy response', 'error');
        }
    }

    async pasteToTerminal() {
        if (!this.currentResponse) {
            showNotification('No response to paste', 'warning');
            return;
        }

        try {
            // Use the terminal manager reference provided during initialization
            if (this.terminalManager && this.terminalManager.pasteText) {
                const success = this.terminalManager.pasteText(this.currentResponse);
                if (success) {
                    showNotification('Response pasted to terminal', 'success');
                } else {
                    // Fallback: copy to clipboard
                    await navigator.clipboard.writeText(this.currentResponse);
                    showNotification('Response copied to clipboard (paste with Ctrl+V)', 'info');
                }
            } else {
                // Fallback: copy to clipboard
                await navigator.clipboard.writeText(this.currentResponse);
                showNotification('Response copied to clipboard (paste with Ctrl+V)', 'info');
            }
        } catch (error) {
            console.error('Paste failed:', error);
            showNotification('Failed to paste to terminal', 'error');
        }
    }

    // Method to pre-fill prompt with selected text
    setPrompt(text) {
        const promptInput = document.getElementById('ai-prompt-input');
        promptInput.value = text;
        if (this.isVisible) {
            promptInput.focus();
        }
    }

    // Method to append context to hidden context
    addContext(context) {
        if (this.hiddenContext) {
            this.hiddenContext += `\n\n${context}`;
        } else {
            this.hiddenContext = context;
        }
        this.updateContextIndicator();
    }

    // Set hidden context
    setContext(context) {
        this.hiddenContext = context;
        this.updateContextIndicator();
    }

    // Clear hidden context
    clearContext() {
        this.hiddenContext = '';
        this.updateContextIndicator();
    }

    // Update context indicator visibility and text
    updateContextIndicator() {
        const indicator = document.getElementById('ai-context-indicator');
        const contextText = document.getElementById('ai-context-text');
        
        if (this.hiddenContext) {
            indicator.style.display = 'block';
            // Show truncated context
            const truncated = this.hiddenContext.length > 50 
                ? this.hiddenContext.substring(0, 47) + '...'
                : this.hiddenContext;
            contextText.textContent = `Context: ${truncated}`;
        } else {
            indicator.style.display = 'none';
        }
    }

    // Add message to conversation history
    addToHistory(role, content) {
        this.conversationHistory.push({
            role: role, // 'user' or 'assistant'
            content: content,
            timestamp: new Date()
        });

        // Keep only recent messages (limit history size)
        if (this.conversationHistory.length > this.maxHistoryLength) {
            this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
        }

        console.log('Added to history:', role, content.substring(0, 50) + '...');
        console.log('History length:', this.conversationHistory.length);
        
        // Update history count indicator
        this.updateHistoryCount();
    }

    // Build full prompt with conversation history and context
    buildFullPrompt(userPrompt) {
        let fullPrompt = '';

        // Add conversation history first
        if (this.conversationHistory.length > 0) {
            fullPrompt += 'Previous conversation:\n';
            this.conversationHistory.forEach(msg => {
                const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
                fullPrompt += `${roleLabel}: ${msg.content}\n`;
            });
            fullPrompt += '\n';
        }

        // Add current context if present
        if (this.hiddenContext) {
            fullPrompt += `Current context: ${this.hiddenContext}\n\n`;
        }

        // Add current user question
        fullPrompt += `User: ${userPrompt}`;

        return fullPrompt;
    }

    // Clear conversation history
    clearHistory() {
        this.conversationHistory = [];
        console.log('Conversation history cleared');
        showNotification('Conversation history cleared', 'info');
        
        // Update history count indicator
        this.updateHistoryCount();
    }

    // Update history count indicator
    updateHistoryCount() {
        const countElement = document.getElementById('ai-history-count');
        const messageCount = this.conversationHistory.length;
        
        if (messageCount > 0) {
            countElement.textContent = messageCount;
            countElement.style.display = 'inline';
            countElement.title = `${messageCount} messages in conversation`;
        } else {
            countElement.style.display = 'none';
        }
    }
} 