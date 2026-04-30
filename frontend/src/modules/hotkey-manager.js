// Centralised hotkey manager.
// Modules call register(actionID, handler) to attach a global handler, or match(event, actionID)
// to test a specific keystroke during their own listener (xterm's attachCustomKeyEventHandler).
// The user-customised key map is loaded from the backend and refreshed when the
// `config:hotkeys-changed` event fires.
//
// Combos are stored in a canonical, platform-neutral form using a `mod` token that maps
// to Cmd on macOS and Ctrl on Windows/Linux — that way a single config works on every
// platform. Display strings translate `mod` back to the native modifier name.
import { GetHotkeys } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime.js';

// Keys whose .key value isn't a single printable character; lower-case them as-is.
const SPECIAL_KEY_NAMES = new Set([
    'enter', 'tab', 'escape', 'backspace', 'space', 'delete', 'insert',
    'home', 'end', 'pageup', 'pagedown',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'
]);

// Best-effort platform detection. We can't ask the backend synchronously, but
// navigator.platform / userAgentData are reliable enough to drive UI labels and
// modifier matching on the renderer side.
function detectIsMac() {
    try {
        const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
        return /mac/i.test(platform);
    } catch (_) {
        return false;
    }
}

class HotkeyManagerImpl {
    constructor() {
        this.bindings = new Map(); // actionID -> combo string (canonical, with `mod` token)
        this.handlers = new Map(); // actionID -> handler fn
        this.initialized = false;
        this.isMac = detectIsMac();
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
     * Normalize a KeyboardEvent into a canonical combo string like "mod+shift+t".
     * `mod` represents the platform's primary modifier — Cmd on macOS, Ctrl elsewhere.
     * Returns null for pure-modifier events (Shift alone, etc.).
     */
    eventToCombo(event) {
        const parts = [];
        // Treat ctrl OR meta as the same canonical modifier so users get the same combo
        // regardless of which platform they're on.
        if (event.ctrlKey || event.metaKey) parts.push('mod');
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
     * Normalize a stored combo string. ctrl/cmd/meta all collapse to the canonical
     * `mod` token so a single config works across platforms.
     */
    normalizeCombo(combo) {
        if (!combo) return '';
        const tokens = combo.toLowerCase().split('+').map(t => t.trim()).filter(Boolean);
        let hasMod = false, hasAlt = false, hasShift = false;
        let key = '';
        for (const tok of tokens) {
            if (tok === 'mod' || tok === 'ctrl' || tok === 'control' || tok === 'cmd' || tok === 'command' || tok === 'meta' || tok === 'super') {
                hasMod = true;
            } else if (tok === 'alt' || tok === 'option') {
                hasAlt = true;
            } else if (tok === 'shift') {
                hasShift = true;
            } else {
                key = tok;
            }
        }
        const parts = [];
        if (hasMod) parts.push('mod');
        if (hasAlt) parts.push('alt');
        if (hasShift) parts.push('shift');
        if (key) parts.push(key);
        return parts.join('+');
    }

    /**
     * Replace the `mod` token in a stored combo with the platform-appropriate name
     * (and capitalize segments) for display in the UI.
     */
    formatComboForDisplay(combo) {
        if (!combo) return '';
        return combo.split('+').map(seg => {
            if (seg === 'mod') return this.isMac ? 'Cmd' : 'Ctrl';
            if (seg === 'alt') return this.isMac ? 'Option' : 'Alt';
            if (seg === 'shift') return 'Shift';
            if (seg.length === 1) return seg.toUpperCase();
            // Capitalize multi-letter keys (home, end, pageup, etc.)
            return seg.charAt(0).toUpperCase() + seg.slice(1);
        }).join('+');
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
