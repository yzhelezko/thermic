// Reusable Live Search Component
export class LiveSearch {
    constructor(options = {}) {
        this.containerSelector = options.containerSelector;
        this.itemSelector = options.itemSelector;
        this.searchIndicatorClass = options.searchIndicatorClass || 'live-search-indicator';
        this.onSearchCallback = options.onSearch; // Custom search logic
        this.getItemData = options.getItemData; // Function to extract searchable data from item
        this.clearManagerCallback = options.clearManagerCallback; // Callback to clear manager reference
        
        // Search state
        this.searchQuery = '';
        this.searchTimeout = null;
        this.isEnabled = false;
        this.isSearchActive = false;
        
        // Default ignored keys
        this.ignoredKeys = [
            'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'Home', 'End', 'PageUp', 'PageDown',
            'Insert', 'Delete', 'Tab', 'Enter', 'Escape',
            'CapsLock', 'Shift', 'Control', 'Alt', 'Meta'
        ];
        
        // Bind methods
        this.handleKeydown = this.handleKeydown.bind(this);
    }

    enable() {
        if (this.isEnabled) return;
        
        this.isEnabled = true;
        document.addEventListener('keydown', this.handleKeydown);
        console.log('🔍 Live search enabled for', this.containerSelector);
    }

    disable() {
        if (!this.isEnabled) return;
        
        this.isEnabled = false;
        document.removeEventListener('keydown', this.handleKeydown);
        this.clearSearch();
        console.log('🔍 Live search disabled for', this.containerSelector);
    }

    handleKeydown(e) {
        if (!this.isEnabled) return;
        
        // Don't trigger search on special keys or when modifiers are pressed
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        
        // Ignore special keys
        if (this.ignoredKeys.includes(e.key)) return;
        
        // Check if we're in the correct context (container is visible)
        const container = document.querySelector(this.containerSelector);
        if (!container || !this.isContainerVisible(container)) return;
        
        // Check if input fields are focused or modals are open
        if (this.shouldIgnoreKeypress()) return;
        
        // Handle backspace
        if (e.key === 'Backspace') {
            if (this.searchQuery.length > 0) {
                e.preventDefault();
                this.searchQuery = this.searchQuery.slice(0, -1);
                this.performSearch();
            }
            return;
        }
        
        // Handle regular typing
        if (e.key.length === 1) {
            e.preventDefault();
            this.searchQuery += e.key.toLowerCase();
            this.performSearch();
        }
    }

    isContainerVisible(container) {
        // Check if container is visible and active
        return container.offsetParent !== null && 
               !container.hidden && 
               container.style.display !== 'none';
    }

    shouldIgnoreKeypress() {
        const activeElement = document.activeElement;
        if (activeElement && (
            activeElement.tagName === 'INPUT' || 
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.contentEditable === 'true' ||
            activeElement.closest('.modal-overlay') ||
            activeElement.closest('.profile-panel') ||
            activeElement.closest('.file-preview-overlay')
        )) {
            return true;
        }
        return false;
    }

    performSearch() {
        console.log('🔍 Searching for:', this.searchQuery);
        
        // Clear previous timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        // Debounce search
        this.searchTimeout = setTimeout(() => {
            if (!this.searchQuery) {
                this.clearSearch();
                return;
            }
            
            this.isSearchActive = true;
            
            if (this.onSearchCallback) {
                // Use custom search logic
                this.onSearchCallback(this.searchQuery);
            } else {
                // Use default search logic
                this.defaultSearch();
            }
            
            // Show search UI
            this.showSearchUI();
            
        }, 100); // 100ms debounce
    }

    defaultSearch() {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;
        
        const items = container.querySelectorAll(this.itemSelector);
        let matchCount = 0;
        
        items.forEach(item => {
            const itemData = this.getItemData ? this.getItemData(item) : this.getDefaultItemData(item);
            const matches = this.itemMatches(itemData, this.searchQuery);
            
            if (matches) {
                item.style.display = '';
                matchCount++;
            } else {
                item.style.display = 'none';
            }
        });
        
        this.updateSearchResults(matchCount);
    }

    getDefaultItemData(item) {
        // Default way to extract searchable data from an item
        const textContent = item.textContent || '';
        const dataName = item.dataset.name || '';
        const dataPath = item.dataset.path || '';
        
        return {
            text: textContent,
            name: dataName,
            path: dataPath
        };
    }

    itemMatches(itemData, query) {
        // Default matching logic - check if any of the item data contains the query
        const searchFields = [itemData.text, itemData.name, itemData.path].filter(Boolean);
        return searchFields.some(field => 
            field.toLowerCase().includes(query.toLowerCase())
        );
    }

    showSearchUI() {
        const container = document.querySelector(this.containerSelector);
        if (!container) return;
        
        // Create or update search indicator
        let searchIndicator = container.querySelector(`.${this.searchIndicatorClass}`);
        if (!searchIndicator) {
            searchIndicator = document.createElement('div');
            searchIndicator.className = this.searchIndicatorClass;
            container.insertBefore(searchIndicator, container.firstChild);
        }
        
        searchIndicator.innerHTML = `
            <div class="search-info">
                <span class="search-icon">🔍</span>
                <span class="search-query">${this.searchQuery}</span>
                <span class="search-results" id="search-results-count-${this.getSearchId()}">Searching...</span>
                <button class="search-clear">×</button>
            </div>
        `;
        
        // Add event listener to the clear button instead of inline onclick
        const clearButton = searchIndicator.querySelector('.search-clear');
        if (clearButton) {
            clearButton.addEventListener('click', () => {
                if (this.clearManagerCallback && typeof this.clearManagerCallback === 'function') {
                    // Use function callback
                    this.clearManagerCallback();
                } else if (this.clearManagerCallback && typeof this.clearManagerCallback === 'string') {
                    // Execute the callback string (for backward compatibility)
                    try {
                        eval(this.clearManagerCallback);
                    } catch (error) {
                        console.warn('Failed to execute clear callback:', error);
                        this.clearSearch();
                    }
                } else {
                    // Default behavior
                    this.clearSearch();
                }
            });
        }
        
        searchIndicator.style.display = 'block';
    }

    updateSearchResults(count) {
        const resultsElement = document.getElementById(`search-results-count-${this.getSearchId()}`);
        if (resultsElement) {
            const text = count === 0 ? 'No matches' : 
                         count === 1 ? '1 match' : 
                         `${count} matches`;
            resultsElement.textContent = text;
        }
    }

    getSearchId() {
        // Generate a unique ID based on container selector
        return this.containerSelector.replace(/[^a-zA-Z0-9]/g, '');
    }

    clearSearch() {
        console.log('🔍 Clearing search');
        
        this.searchQuery = '';
        this.isSearchActive = false;
        
        // Clear timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
        
        // Show all items
        const container = document.querySelector(this.containerSelector);
        if (container) {
            const items = container.querySelectorAll(this.itemSelector);
            items.forEach(item => {
                item.style.display = '';
            });
        }
        
        // Hide search UI
        this.hideSearchUI();
    }

    hideSearchUI() {
        const container = document.querySelector(this.containerSelector);
        if (container) {
            const searchIndicator = container.querySelector(`.${this.searchIndicatorClass}`);
            if (searchIndicator) {
                searchIndicator.style.display = 'none';
            }
        }
    }

    destroy() {
        this.disable();
        this.clearSearch();
    }

    // Public API
    getQuery() {
        return this.searchQuery;
    }

    isActive() {
        return this.isSearchActive;
    }

    setQuery(query) {
        this.searchQuery = query;
        this.performSearch();
    }
} 