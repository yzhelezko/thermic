// UI zoom manager — scales the whole interface using CSS `zoom`.
// Persists scale via the universal config system as setting `UIScale` (percent).
// VSCode-style hotkeys: Ctrl/Cmd +, Ctrl/Cmd -, Ctrl/Cmd 0.

const DEFAULT_SCALE = 100;
const MIN_SCALE = 50;
const MAX_SCALE = 300;
const STEP = 10;

export class UIZoomManager {
    constructor(terminalManager) {
        this.terminalManager = terminalManager;
        this.scale = DEFAULT_SCALE;
        this.saveTimer = null;
    }

    async init() {
        try {
            const stored = await window.go.main.App.ConfigGet('UIScale');
            const value = parseInt(stored, 10);
            if (!Number.isNaN(value)) {
                this.scale = this.clamp(value);
            }
        } catch (error) {
            console.warn('UIZoomManager: failed to load UIScale, using default', error);
        }

        this.apply(this.scale, { persist: false });
        this.bindHotkeys();
        this.bindIndicator();
        this.bindSettingsInput();

        // Backend may emit the change event from elsewhere (e.g. settings input on another path).
        if (window.runtime?.EventsOn) {
            window.runtime.EventsOn('config:ui-scale-changed', (data) => {
                const next = parseInt(data?.UIScale, 10);
                if (!Number.isNaN(next) && next !== this.scale) {
                    this.apply(next, { persist: false });
                }
            });
        }
    }

    clamp(value) {
        if (Number.isNaN(value)) return DEFAULT_SCALE;
        return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
    }

    apply(value, { persist = true } = {}) {
        const next = this.clamp(value);
        this.scale = next;

        // CSS `zoom` is supported in WebKit2GTK, WebView2 and WKWebView — the three Wails targets.
        // It scales layout (unlike transform: scale), so the terminal container reports the new size.
        const factor = next / 100;
        document.body.style.zoom = String(factor);

        this.updateIndicator();
        this.updateSettingsInput();

        // Refit the active terminal so xterm recomputes char dimensions in the new pixel grid.
        if (this.terminalManager?.handleResize) {
            requestAnimationFrame(() => {
                try {
                    this.terminalManager.handleResize();
                } catch (e) {
                    console.warn('UIZoomManager: handleResize after zoom change failed', e);
                }
            });
        }

        if (persist) {
            this.persist(next);
        }
    }

    persist(value) {
        // Debounce so holding the hotkey doesn't spam the backend.
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = null;
            try {
                await window.go.main.App.ConfigSet('UIScale', value);
            } catch (error) {
                console.error('UIZoomManager: failed to persist UIScale', error);
            }
        }, 250);
    }

    zoomIn() {
        this.apply(this.scale + STEP);
    }

    zoomOut() {
        this.apply(this.scale - STEP);
    }

    reset() {
        this.apply(DEFAULT_SCALE);
    }

    bindHotkeys() {
        document.addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod || e.altKey) return;

            // Don't intercept zoom shortcuts while typing in inputs/textareas, but DO accept them
            // from terminal canvases — xterm.js is the main target for users.
            const target = e.target;
            const isEditable = target instanceof HTMLElement && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            );
            // Allow on the UI scale input itself? Skip — the input handles its own value.
            if (isEditable && target.id !== 'ui-scale-input') return;

            // VSCode bindings:
            //   Ctrl/Cmd =      → zoom in (this is what `Ctrl +` produces on US layouts without Shift)
            //   Ctrl/Cmd Shift =→ also zoom in (the literal `+` key)
            //   Ctrl/Cmd -      → zoom out
            //   Ctrl/Cmd 0      → reset
            // We match by `e.key` rather than `code` so layout shifts don't break it.
            if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                this.zoomIn();
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this.zoomOut();
            } else if (e.key === '0') {
                e.preventDefault();
                this.reset();
            }
        });
    }

    bindIndicator() {
        const indicator = document.getElementById('ui-scale-indicator');
        if (!indicator) return;
        indicator.addEventListener('click', () => this.reset());
    }

    bindSettingsInput() {
        // The settings panel HTML is rendered lazily, so we bind on demand from settings.js.
        // Calling this here picks it up when the input already exists.
        const input = document.getElementById('ui-scale-input');
        if (!input) return;
        this.attachSettingsInput(input);
    }

    attachSettingsInput(input) {
        if (!input || input.dataset.uiZoomBound === '1') return;
        input.dataset.uiZoomBound = '1';
        input.value = String(this.scale);

        let debounce = null;
        input.addEventListener('input', (event) => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
                debounce = null;
                const raw = parseInt(event.target.value, 10);
                if (Number.isNaN(raw)) return;
                this.apply(raw);
            }, 200);
        });
    }

    updateIndicator() {
        const indicator = document.getElementById('ui-scale-indicator');
        if (!indicator) return;
        const valueEl = indicator.querySelector('.ui-scale-value');
        if (this.scale === DEFAULT_SCALE) {
            indicator.hidden = true;
        } else {
            indicator.hidden = false;
            if (valueEl) valueEl.textContent = `${this.scale}%`;
        }
    }

    updateSettingsInput() {
        const input = document.getElementById('ui-scale-input');
        if (!input) return;
        if (document.activeElement === input) return; // don't yank input mid-typing
        input.value = String(this.scale);
    }
}
