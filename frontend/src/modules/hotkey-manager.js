// Centralised hotkey manager.
// Modules call register(actionID, handler) to attach a global handler, or match(event, actionID)
// to test a specific keystroke during their own listener (xterm's attachCustomKeyEventHandler).
// The user-customised key map is loaded from the backend and refreshed when the
// `config:hotkeys-changed` event fires.
import { GetHotkeys } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime.js';

// Keys whose .key value isn't a single printable character; lower-case them as-is.
const SPECIAL_KEY_NAMES = new Set([
    'enter', 'tab', 'escape', 'backspace', 'space', 'delete', 'insert',
    'home', 'end', 'pageup', 'pagedown',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'
]);

class HotkeyManagerImpl {
    constructor() {
        this.bindings = new Map(); // actionID -> combo string
        this.handlers = new Map(); // actionID -> handler fn
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;

        try {
            const map = await GetHotkeys();
            this.applyBindings(map || {});
        } catch (error) {
            console.warn('HotkeyManager: failed to load bindings, using empty set', error);
        }

        EventsOn('config:hotkeys-changed', (map) => {
            this.applyBindings(map || {});
        });

        document.addEventListener('keydown', (event) => this.onGlobalKeydown(event), true);
    }

    applyBindings(map) {
        this.bindings.clear();
        for (const [actionID, combo] of Object.entries(map)) {
            if (combo) this.bindings.set(actionID, this.normalizeCombo(combo));
        }
    }

    register(actionID, handler) {
        this.handlers.set(actionID, handler);
    }

    unregister(actionID) {
        this.handlers.delete(actionID);
    }

    getCombo(actionID) {
        return this.bindings.get(actionID) || null;
    }

    /**
     * Normalize a KeyboardEvent into a canonical combo string like "ctrl+shift+t".
     * Returns null for pure-modifier events (Shift alone, etc.).
     */
    eventToCombo(event) {
        const parts = [];
        if (event.ctrlKey) parts.push('ctrl');
        if (event.metaKey) parts.push('cmd');
        if (event.altKey) parts.push('alt');
        if (event.shiftKey) parts.push('shift');

        const key = event.key;
        if (!key || ['Control', 'Meta', 'Alt', 'Shift'].includes(key)) {
            return null;
        }

        let normalized = key.toLowerCase();
        // Map a few non-printables to friendlier names matching SPECIAL_KEY_NAMES
        if (normalized === ' ') normalized = 'space';

        parts.push(normalized);
        return parts.join('+');
    }

    /**
     * Normalize a stored combo string (in case user-saved values came from a different
     * shape). Lower-case, drop whitespace, sort modifiers in canonical order.
     */
    normalizeCombo(combo) {
        if (!combo) return '';
        const tokens = combo.toLowerCase().split('+').map(t => t.trim()).filter(Boolean);
        const modifiers = [];
        let key = '';
        for (const tok of tokens) {
            if (tok === 'ctrl' || tok === 'control') modifiers.push('ctrl');
            else if (tok === 'cmd' || tok === 'meta' || tok === 'super') modifiers.push('cmd');
            else if (tok === 'alt' || tok === 'option') modifiers.push('alt');
            else if (tok === 'shift') modifiers.push('shift');
            else key = tok;
        }
        // Canonical order: ctrl, cmd, alt, shift, key
        const order = ['ctrl', 'cmd', 'alt', 'shift'];
        const sortedMods = order.filter(m => modifiers.includes(m));
        return [...sortedMods, key].filter(Boolean).join('+');
    }

    /** True if the event matches the binding stored for actionID. */
    match(event, actionID) {
        const combo = this.bindings.get(actionID);
        if (!combo) return false;
        const eventCombo = this.eventToCombo(event);
        return eventCombo === combo;
    }

    /**
     * Find the first action whose combo matches the given event. Returns null if none.
     */
    findActionForEvent(event) {
        const eventCombo = this.eventToCombo(event);
        if (!eventCombo) return null;
        for (const [actionID, combo] of this.bindings) {
            if (combo === eventCombo) return actionID;
        }
        return null;
    }

    onGlobalKeydown(event) {
        // Skip when typing in editable controls (inputs, textareas, contenteditable).
        // Terminal canvases are NOT editable in this sense — xterm uses a hidden textarea
        // but our hotkey routing for the terminal happens via attachCustomKeyEventHandler instead.
        const target = event.target;
        if (target instanceof HTMLElement) {
            const tag = target.tagName;
            const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
            if (isEditable) {
                // Allow ESC to bubble out of inputs as a built-in convenience
                return;
            }
        }

        const actionID = this.findActionForEvent(event);
        if (!actionID) return;
        const handler = this.handlers.get(actionID);
        if (!handler) return;
        event.preventDefault();
        event.stopPropagation();
        try {
            handler(event);
        } catch (error) {
            console.error(`Hotkey handler for ${actionID} threw:`, error);
        }
    }
}

export const hotkeyManager = new HotkeyManagerImpl();
export const SPECIAL_KEYS = SPECIAL_KEY_NAMES;
