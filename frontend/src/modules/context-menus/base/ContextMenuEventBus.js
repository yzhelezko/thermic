// Event bus for decoupled communication between context menu domains
export class ContextMenuEventBus {
    constructor() {
        this.listeners = new Map();
        this.onceListeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return this;
    }

    once(event, callback) {
        if (!this.onceListeners.has(event)) {
            this.onceListeners.set(event, []);
        }
        this.onceListeners.get(event).push(callback);
        return this;
    }

    emit(event, data) {
        // Handle regular listeners
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });

        // Handle once listeners and remove them
        const onceCallbacks = this.onceListeners.get(event) || [];
        onceCallbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in once event listener for ${event}:`, error);
            }
        });
        if (onceCallbacks.length > 0) {
            this.onceListeners.delete(event);
        }

        return this;
    }

    off(event, callback) {
        // Remove from regular listeners
        const callbacks = this.listeners.get(event) || [];
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
            if (callbacks.length === 0) {
                this.listeners.delete(event);
            }
        }

        // Remove from once listeners
        const onceCallbacks = this.onceListeners.get(event) || [];
        const onceIndex = onceCallbacks.indexOf(callback);
        if (onceIndex > -1) {
            onceCallbacks.splice(onceIndex, 1);
            if (onceCallbacks.length === 0) {
                this.onceListeners.delete(event);
            }
        }

        return this;
    }

    removeAllListeners(event = null) {
        if (event) {
            this.listeners.delete(event);
            this.onceListeners.delete(event);
        } else {
            this.listeners.clear();
            this.onceListeners.clear();
        }
        return this;
    }

    hasListeners(event) {
        return (this.listeners.has(event) && this.listeners.get(event).length > 0) ||
               (this.onceListeners.has(event) && this.onceListeners.get(event).length > 0);
    }
}

// Global event bus instance
export const contextMenuEventBus = new ContextMenuEventBus(); 