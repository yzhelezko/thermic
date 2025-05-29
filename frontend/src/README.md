# Thermic - Frontend Architecture

## Overview
The frontend uses a modern template-based modular architecture for optimal maintainability and separation of concerns. HTML is generated dynamically from templates, CSS is organized into component files, and JavaScript follows a clean modular pattern.

## File Structure

```
src/
├── main.js                 # Main application coordinator (template-based approach)
├── styles/                 # Modular CSS architecture
│   ├── main.css           # Main entry point - imports all CSS files
│   ├── variables.css      # CSS variables and theme definitions
│   ├── reset.css          # CSS reset and base styles
│   ├── layout.css         # Main layout and responsive styles
│   ├── header.css         # Header and toolbar components
│   ├── tabs.css           # Tabs component styles
│   ├── sidebar.css        # Sidebar and tree component styles
│   ├── status-bar.css     # Status bar component styles
│   ├── settings.css       # Settings panel and overlay styles
│   ├── forms.css          # Form controls and input components
│   └── README.md          # CSS architecture documentation
├── modules/
│   ├── utils.js            # Utility functions and constants
│   ├── terminal.js         # Terminal management (xterm, shells, PTY)
│   ├── ui.js              # UI interactions (theme, tabs, toolbar)
│   ├── settings.js        # Settings panel management
│   ├── sidebar.js         # Sidebar content and interactions
│   ├── status.js          # Status bar and platform information
│   ├── templates.js       # HTML template functions
│   └── dom.js             # DOM management and dynamic HTML generation
└── README.md              # This file

frontend/
└── index.html             # Minimal HTML structure with dynamic content generation
```

## Architecture Overview

### Template-Based Approach
- **HTML**: Minimal skeleton (`index.html`) with content generated dynamically
- **CSS**: Modular component-based files organized by purpose
- **JavaScript**: Clean module separation with template-driven UI generation

### Core Principles
1. **Dynamic HTML Generation**: All UI content created via templates
2. **Component Isolation**: Each UI component owns its template and styles
3. **Modular CSS**: Organized by component for easy maintenance
4. **Clean Dependencies**: Clear module boundaries and communication

## Module Responsibilities

### `main.js` (Application Coordinator)
- Application initialization and coordination
- Dynamic HTML content generation via DOM manager
- Inter-module communication setup
- Shell selector event handling
- Overall application lifecycle management

### CSS Modules (`src/styles/`)

#### `main.css` (Entry Point)
- Single import point for all styles
- Defines import order: Variables → Reset → Layout → Components
- Used by the main HTML file

#### `variables.css` (Theme System)
- CSS custom properties for colors and theming
- Dark theme (default) and light theme definitions
- Color palette and design tokens

#### Component CSS Files
- **`header.css`**: Header toolbar and action buttons
- **`tabs.css`**: Terminal tabs with add/close functionality  
- **`sidebar.css`**: Tree view for connections and files
- **`status-bar.css`**: Bottom status bar with system info
- **`settings.css`**: Settings overlay panel and tabs
- **`forms.css`**: Input controls, buttons, toggles
- **`layout.css`**: Main layout structure and responsive design
- **`reset.css`**: CSS reset and base typography

### JavaScript Modules (`src/modules/`)

#### `dom.js` (DOM Management)
- Dynamic HTML content generation
- Template rendering coordination
- DOM manipulation utilities
- Element creation and management helpers

#### `templates.js` (UI Templates)
- HTML template functions for each UI component
- Component-specific HTML generation
- Template composition and reuse
- Dynamic content templates

#### `utils.js` (Utilities)
- Theme definitions (dark/light terminal color schemes)
- Terminal configuration constants
- Utility functions (session ID generation, shell name formatting)
- Status update helpers

#### `terminal.js` (Terminal Management)
- xterm.js terminal initialization and management
- Shell operations (start, stop, resize, cleanup)
- Terminal theming and container management
- PTY communication with Wails backend
- Event handling for terminal input/output

#### `ui.js` (UI Interactions)
- Theme switching (dark/light mode)
- Tab management (add, close, switch tabs)
- Toolbar button interactions
- Resizable panel handling
- General UI event management

#### `settings.js` (Settings Panel)
- Settings panel overlay management
- Settings tabs (Signals, General, Packing, Common)
- Settings synchronization
- Keyboard shortcuts (escape to close)

#### `sidebar.js` (Sidebar Management)
- Sidebar content switching (Connections, Files, Search)
- Tree item interactions
- Connection tree population
- File explorer placeholder content

#### `status.js` (Status Bar)
- Platform information display
- System monitoring (CPU/RAM demo)
- Status bar updates
- Interval management for periodic updates

## Architecture Benefits

### Modern Template-Based Approach
1. **Component Ownership**: Each module owns its HTML template and CSS
2. **Dynamic Generation**: Content generated as needed
3. **Better Testing**: Individual components can be tested
4. **Maintainability**: Changes to a component are localized
5. **Flexibility**: Easy to modify component structure
6. **Reusability**: Template functions can be reused

### Modular CSS Architecture
1. **Component Isolation**: Each UI component has its own CSS file
2. **Easier Debugging**: Find styles quickly by component
3. **Better Caching**: Individual files cached separately
4. **Theme System**: Centralized variables in `variables.css`
5. **Development**: Edit specific component without affecting others

### Clean JavaScript Modules
1. **Separation of Concerns**: Each module has a focused responsibility
2. **Clear Dependencies**: Module imports are explicit
3. **Inter-module Communication**: Clean callback-based communication
4. **Scalability**: Easy to add new modules or extend existing ones

## Implementation Details

### HTML Structure
```html
<!-- Minimal skeleton - content generated dynamically -->
<div id="app">
    <div class="header" id="header"></div>
    <div class="tabs-container" id="tabs-container"></div>
    <!-- ... other containers ... -->
</div>
```

### Dynamic Content Generation
```javascript
// DOM manager populates all containers with template content
this.domManager.initializeDOM();

// Templates define component HTML
export function createHeaderTemplate() {
    return `<div class="header-left">...</div>`;
}
```

### Modular CSS Import
```css
/* main.css imports all component styles */
@import 'variables.css';
@import 'reset.css';
@import 'header.css';
/* ... */
```

## Development Workflow

### Adding New Features
1. **New Component**: 
   - Create template function in `templates.js`
   - Create CSS file in `styles/` and import in `main.css`
   - Add rendering logic to `dom.js`
   
2. **New Module**: 
   - Create module file in `modules/`
   - Add initialization to `main.js`
   - Set up communication callbacks

3. **Styling Changes**: 
   - Edit component-specific CSS file in `styles/`
   - Use CSS variables for theming

4. **Theme Changes**: 
   - Modify `variables.css` for colors/spacing

### Local Development
1. Edit individual CSS files for focused style changes
2. Modify templates in `templates.js` for HTML changes
3. Update modules for new functionality
4. Browser automatically reloads with changes

### Debugging
1. **CSS**: Use component-specific files for targeted debugging
2. **HTML**: Check template functions and DOM manager
3. **JavaScript**: Each module is focused and easy to debug
4. **Templates**: Dynamic content generation is centralized

## Performance Considerations

### Bundle Size
- **CSS**: ~26KB across 10 organized files
- **JavaScript**: Modular imports for better tree-shaking
- **HTML**: Minimal skeleton reduces initial download

### Runtime Performance
- **DOM Generation**: Happens once at startup
- **CSS**: Component isolation prevents cascade issues
- **JavaScript**: Clean module boundaries improve V8 optimization

### Development Performance
- **Hot Reload**: Component-specific changes reload faster
- **Debugging**: Targeted file structure improves debugging speed
- **Maintenance**: Clear structure reduces time to find/fix issues

## Migration and Extension

### Adding New Components
1. Create template function in `templates.js`
2. Add CSS file in `styles/` directory
3. Import CSS in `main.css`
4. Add DOM rendering in `dom.js`
5. Update documentation

### Extending Existing Components
1. Modify template function for HTML changes
2. Edit component CSS file for styling
3. Update module logic if needed

### Theme Customization
```css
/* Add new theme in variables.css */
[data-theme="custom"] {
    --bg-primary: #your-color;
    /* ... other variables ... */
}
```

## Icon System and Theme Support

### Day/Night Theme Issue Fix

**Problem**: SVG icons remained black when switching between day/night themes.

**Root Cause**: Icons were loaded as `<img>` tags, which cannot inherit CSS properties like `currentColor` from the parent document. The SVG files use `stroke="currentColor"` but this only works when SVGs are inline.

**Solution**: Implemented an inline SVG system that converts `<img>` based icons to inline SVGs that can properly inherit theme colors.

#### Key Changes:

1. **Enhanced Icon Utilities** (`utils/icons.js`):
   - Added `loadSvgContent()` function with caching
   - Added `createInlineIconElement()` for theme-aware inline SVGs
   - Updated `updateThemeToggleIcon()` to use inline SVGs
   - Added `updateAllIconsToInline()` to convert existing icons

2. **Updated CSS** (`styles/icons.css`):
   - Added support for both `img`-based and inline SVG icons
   - Inline SVGs use `color: var(--icon-color)` instead of filters
   - Added proper color variables for all themes
   - Separate styling for different icon states (hover, active, status)

3. **Theme Management**:
   - Updated Activity Bar Manager to use async icon functions
   - Enhanced Theme Manager with proper async handling
   - Automatic conversion of all icons on theme switch

#### Usage:

```javascript
// Create theme-aware inline SVG
const iconHtml = await createInlineIconElement('🎨', 'my-icon-class');

// Update all existing icons to inline SVGs
await updateAllIconsToInline();

// Test the system
testIconThemes(); // Available in browser console
```

#### CSS Classes:

- `.svg-icon[src]` - External image icons (fallback, uses filters)
- `.svg-icon.inline-svg-icon` - Inline SVGs (uses currentColor)
- `.svg-icon:not([src])` - All inline SVGs (uses currentColor)

The system now properly responds to theme changes, with icons automatically switching between light and dark appearances.

The template-based modular architecture provides a modern, maintainable foundation for the Thermic interface with excellent separation of concerns and developer experience. 