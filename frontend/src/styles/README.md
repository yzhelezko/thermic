# Thermic - Modular CSS Architecture

## Overview
The CSS has been split into multiple organized files for better maintainability, easier debugging, and cleaner development workflow.

## File Structure

```
styles/
├── main.css           # Main entry point - imports all other CSS files
├── variables.css      # CSS variables and theme definitions
├── reset.css          # CSS reset and base styles
├── layout.css         # Main layout and responsive styles
├── header.css         # Header and toolbar components
├── tabs.css           # Tabs component styles
├── sidebar.css        # Sidebar and tree component styles
├── status-bar.css     # Status bar component styles
├── settings.css       # Settings panel and overlay styles
├── forms.css          # Form controls and input components
└── README.md          # This documentation file
```

## File Descriptions

### `main.css` (Entry Point)
- **Purpose**: Single import point for all styles
- **Size**: ~15 lines
- **Usage**: Link this file in your HTML: `<link rel="stylesheet" href="src/styles/main.css">`
- **Import Order**: Variables → Reset → Layout → Components → UI

### `variables.css` (Theme System)
- **Purpose**: CSS custom properties for colors, spacing, and theme definitions
- **Size**: ~40 lines
- **Contains**: Dark theme (default), Light theme, Color palette
- **Key Variables**: 
  - `--bg-primary/secondary/tertiary/quaternary` - Background colors
  - `--text-primary/secondary/tertiary` - Text colors
  - `--accent-color`, `--success-color`, `--error-color` - UI colors

### `reset.css` (Base Styles)
- **Purpose**: CSS reset, base typography, and global styles
- **Size**: ~35 lines
- **Contains**: Universal box-sizing, body styles, scrollbar styling
- **Dependencies**: Uses variables from `variables.css`

### `layout.css` (Layout System)
- **Purpose**: Main layout structure and responsive design
- **Size**: ~40 lines
- **Contains**: Main content area, terminal container, resize handles, media queries
- **Key Classes**: `.main-content`, `.terminal-area`, `.terminal-container`

### `header.css` (Header Component)
- **Purpose**: Top header bar with toolbar and action buttons
- **Size**: ~75 lines
- **Contains**: Header layout, toolbar buttons, icon buttons, hover states
- **Key Classes**: `.header`, `.toolbar-btn`, `.icon-btn`

### `tabs.css` (Tabs Component)
- **Purpose**: Terminal tabs system with add/close functionality
- **Size**: ~70 lines
- **Contains**: Tab container, individual tabs, close buttons, add button
- **Key Classes**: `.tabs-container`, `.tab`, `.tab-close`, `.tab-add`

### `sidebar.css` (Sidebar Component)
- **Purpose**: Left sidebar with tree view for connections and files
- **Size**: ~55 lines
- **Contains**: Sidebar layout, tree items, icons, selection states
- **Key Classes**: `.sidebar`, `.tree-item`, `.tree-icon`

### `status-bar.css` (Status Bar Component)
- **Purpose**: Bottom status bar with system information
- **Size**: ~20 lines
- **Contains**: Status bar layout, left/right sections
- **Key Classes**: `.status-bar`, `.status-left`, `.status-right`

### `settings.css` (Settings Panel)
- **Purpose**: Settings overlay panel with tabs and cards
- **Size**: ~140 lines
- **Contains**: Overlay, panel animation, tabs, cards, content areas
- **Key Classes**: `.settings-overlay`, `.settings-panel`, `.settings-card`

### `forms.css` (Form Controls)
- **Purpose**: Input controls, buttons, toggles, and form elements
- **Size**: ~140 lines
- **Contains**: Inputs, selects, buttons, checkboxes, toggle switches
- **Key Classes**: `.setting-input`, `.setting-button`, `.toggle-switch`

## CSS Import Order

The import order in `main.css` is critical for proper cascade:

1. **Variables** - Must be first so other files can use CSS custom properties
2. **Reset** - Base styles that everything else builds on
3. **Layout** - Core structural styles
4. **Components** - Individual UI components (order doesn't matter among these)

## Theme System

### CSS Variables Usage
```css
/* Good - Use variables */
.my-component {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
}

/* Avoid - Hard-coded colors */
.my-component {
    background: #2d2d30;
    color: #ffffff;
    border: 1px solid #3e3e42;
}
```

### Theme Switching
Themes are switched by changing the `data-theme` attribute on the body:
```javascript
// Switch to light theme
document.body.setAttribute('data-theme', 'light');

// Switch to dark theme (default)
document.body.setAttribute('data-theme', 'dark');
```

## Adding New Styles

### For New Components
1. Create a new CSS file: `frontend/src/styles/my-component.css`
2. Add styles using CSS variables for theming
3. Import in `main.css`: `@import 'my-component.css';`

### For Existing Components
1. Find the appropriate existing file
2. Add styles at the end of that file
3. Use consistent naming conventions

### Best Practices
- **Use CSS Variables**: Always use variables for colors, spacing
- **Component Isolation**: Keep component styles in their own files
- **Consistent Naming**: Use BEM-like naming (`component__element--modifier`)
- **Mobile First**: Add mobile styles first, then desktop overrides

## Development Workflow

### Local Development
1. Edit individual CSS files for focused changes
2. Browser will automatically reload with new styles
3. Use browser dev tools to inspect CSS cascade

### Adding Features
1. **Small UI Changes**: Edit existing component file
2. **New Components**: Create new CSS file and import in `main.css`
3. **Theme Changes**: Modify `variables.css`
4. **Layout Changes**: Modify `layout.css`

### Debugging Styles
1. **Check Import Order**: Ensure variables are imported first
2. **CSS Cascade**: Later imports override earlier ones
3. **Specificity**: Component files should have similar specificity
4. **Variables**: Verify CSS custom properties are defined

## Performance Considerations

### File Size (Total: ~745 lines split into 10 files)
- **Pros**: Better organization, easier maintenance
- **Cons**: Multiple HTTP requests (mitigated by HTTP/2)
- **Optimization**: Can be bundled for production

### Browser Caching
- Individual files can be cached separately
- Only changed files need to be re-downloaded
- Better for development iteration

### Bundle Size
```
Original:   styles.css (745 lines, ~25KB)
Modular:    main.css + 9 imports (745 lines total, ~26KB with imports)
```

## Migration Guide

### From Monolithic CSS
1. **Immediate**: Use `main.css` as drop-in replacement
2. **Gradual**: Edit individual component files
3. **Custom**: Add new components in separate files

### File Organization
```
Before: styles.css (everything mixed together)
After:  styles/
        ├── main.css (entry point)
        ├── variables.css (themes)
        ├── reset.css (base)
        ├── [component].css (focused styles)
```

## Integration with HTML

### Original HTML (`index.html`)
```html
<link rel="stylesheet" href="src/styles/main.css">
```

### Template-Based HTML (`index-modular.html`)
```html
<link rel="stylesheet" href="src/styles/main.css">
```

Both approaches use the same modular CSS system for consistency and maintainability.

## Extending the System

### Adding Themes
1. Add new theme block in `variables.css`:
```css
[data-theme="custom"] {
    --bg-primary: #your-color;
    /* ... other variables ... */
}
```

### Adding Components
1. Create component CSS file
2. Use existing variables for consistency
3. Import in `main.css`
4. Document in this README

The modular CSS architecture provides a solid foundation for maintaining and extending the Thermic interface while keeping code organized and maintainable. 