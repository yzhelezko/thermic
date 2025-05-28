# Universal Components

This directory contains reusable UI components that can be used throughout the application.

## Modal Component (`Modal.js`)

A flexible dialog system for user interactions.

### Features
- Customizable title, message, icon, and buttons
- Multiple button styles (primary, secondary, danger, success)
- Keyboard navigation (Escape to close)
- Backdrop blur and smooth animations
- Convenience methods for common dialogs

### Usage

```javascript
import { modal } from '../components/Modal.js';

// Basic confirmation
const result = await modal.confirm('Delete this item?');
if (result === 'confirm') {
    // User confirmed
}

// Delete confirmation with item name
const result = await modal.confirmDelete('My Profile', 'profile');
if (result === 'confirm') {
    // User confirmed deletion
}

// Information dialog
await modal.info('Operation completed successfully');

// Error dialog
await modal.error('Something went wrong');

// Success dialog
await modal.success('Profile created successfully');

// Custom dialog
const result = await modal.show({
    title: 'Custom Dialog',
    message: 'Choose an option:',
    icon: '🤔',
    buttons: [
        { text: 'Cancel', style: 'secondary', action: 'cancel' },
        { text: 'Option A', style: 'primary', action: 'option-a' },
        { text: 'Option B', style: 'danger', action: 'option-b' }
    ]
});
```

### Button Styles
- `primary` - Blue button for main actions
- `secondary` - Gray button for secondary actions
- `danger` - Red button for destructive actions
- `success` - Green button for positive actions

## Notification Component (`Notification.js`)

A comprehensive notification system with status bar integration and history.

### Features
- Toast notifications with auto-dismiss
- Status bar integration (replaces old showNotification)
- Notification history with clickable status indicator
- Multiple notification types (success, error, warning, info)
- Progress bars for auto-dismiss countdown
- Stacking support for multiple notifications
- Legacy compatibility with existing showNotification calls

### Usage

```javascript
import { notification } from '../components/Notification.js';

// Success notification
notification.success('Profile created successfully');

// Error notification (longer duration)
notification.error('Failed to delete profile');

// Warning notification
notification.warning('This action cannot be undone');

// Info notification
notification.info('Loading profiles...');

// Custom notification
notification.show({
    type: 'success',
    title: 'Custom Title',
    message: 'Custom message with more details',
    icon: '🎉',
    duration: 10000, // 10 seconds
    showToast: true, // Show toast notification
    showInStatus: true // Show in status bar
});

// Legacy compatibility (only shows in status bar)
showNotification('Status message', 'info', 3000);
```

### Status Bar Integration

The notification system integrates with the existing status bar:

- **Status Display**: Notifications appear in the left status area
- **Clickable History**: Click the status text to view notification history
- **Visual Indicator**: Red dot appears when there are notifications in history
- **Color Coding**: Status text color changes based on notification type

### Notification History

- **Automatic Storage**: All notifications are automatically saved to history
- **Persistent During Session**: History persists while the app is running
- **Time Formatting**: Smart time formatting (Just now, 5m ago, 2h ago, etc.)
- **Type Indicators**: Color-coded borders for different notification types (text-only, no icons)
- **Clear All**: Button to clear entire history
- **Limit**: Maximum 100 notifications stored

### Notification Types

1. **Success** (`success`)
   - Color: Green (#28a745)
   - Icon: ✅
   - Duration: 5 seconds
   - Use for: Successful operations, confirmations

2. **Error** (`error`)
   - Color: Red (#dc3545)
   - Icon: ❌
   - Duration: 8 seconds (longer for errors)
   - Use for: Failed operations, critical issues

3. **Warning** (`warning`)
   - Color: Yellow (#ffc107)
   - Icon: ⚠️
   - Duration: 6 seconds
   - Use for: Important notices, potential issues

4. **Info** (`info`)
   - Color: Blue (#17a2b8)
   - Icon: ℹ️
   - Duration: 5 seconds
   - Use for: General information, status updates

### Configuration Options

```javascript
notification.show({
    type: 'info',              // Notification type
    title: 'Title',            // Main title text
    message: 'Message',        // Optional detailed message
    icon: '🔔',               // Custom icon (emoji or HTML)
    duration: 5000,           // Auto-dismiss time (0 = no auto-dismiss)
    closable: true,           // Show close button
    showInStatus: true,       // Show in status bar
    showToast: true           // Show toast notification
});
```

### Global Access

Both components are available globally:

```javascript
// Available anywhere in the application
window.modal.confirm('Are you sure?');
window.notification.success('Done!');
```

## Best Practices

### Modal Usage
- Use `confirmDelete()` for all deletion confirmations
- Use `confirm()` for simple yes/no questions
- Use `info()`, `error()`, `success()` for single-button dialogs
- Use custom `show()` for complex multi-option dialogs

### Notification Usage
- Use `success()` for completed operations
- Use `error()` for failed operations with clear error messages
- Use `warning()` for important notices that need attention
- Use `info()` for general status updates
- Keep messages concise but informative
- Use the title for the main message, message for additional details

### Integration Notes
- Both components automatically initialize when imported
- CSS styles are injected automatically
- Components work with the existing theme system
- Keyboard shortcuts are handled automatically (Escape to close)
- Components are responsive and work on different screen sizes

## Migration from Legacy Systems

### Old showNotification → New Notification
```javascript
// Old way
showNotification('Profile created', 'success', 3000);

// New way (automatic via utils.js)
showNotification('Profile created', 'success', 3000); // Still works!

// Or use new methods directly
notification.success('Profile created');
```

### Old confirm() → New Modal
```javascript
// Old way
if (confirm('Delete this profile?')) {
    // Delete
}

// New way
const result = await modal.confirmDelete('Profile Name', 'profile');
if (result === 'confirm') {
    // Delete
}
```

## Examples in Context

### Profile Deletion
```javascript
// In sidebar or context menu
async deleteProfile(profileId) {
    const profile = this.getProfileById(profileId);
    const result = await modal.confirmDelete(profile.name, 'profile');
    
    if (result === 'confirm') {
        try {
            await window.go.main.App.DeleteProfileAPI(profileId);
            notification.success('Profile Deleted', `${profile.name} was deleted successfully`);
            this.refreshProfileTree();
        } catch (error) {
            notification.error('Delete Failed', `Could not delete ${profile.name}: ${error.message}`);
        }
    }
}
```

### Form Validation
```javascript
// In form submission
async saveProfile() {
    try {
        await this.validateAndSaveProfile();
        notification.success('Profile Saved', 'Your profile has been saved successfully');
        this.closeForm();
    } catch (error) {
        if (error.type === 'validation') {
            notification.warning('Validation Error', error.message);
        } else {
            notification.error('Save Failed', 'Could not save profile. Please try again.');
        }
    }
}
```

### Loading States
```javascript
// For long operations
async loadProfiles() {
    const loadingId = notification.info('Loading', 'Loading profiles...', { duration: 0 });
    
    try {
        await this.fetchProfiles();
        notification.dismiss(loadingId);
        notification.success('Loaded', 'Profiles loaded successfully');
    } catch (error) {
        notification.dismiss(loadingId);
        notification.error('Load Failed', 'Could not load profiles');
    }
}
``` 