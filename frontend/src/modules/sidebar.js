// Sidebar management module
import { updateStatus } from './utils.js';

export class SidebarManager {
    constructor() {
        // Initialize with connections content as default
    }

    initSidebar() {
        this.setupSidebarInteractions();
    }

    setupSidebarInteractions() {
        // Tree item interactions
        document.addEventListener('click', (e) => {
            if (e.target.closest('.tree-item')) {
                const item = e.target.closest('.tree-item');
                
                // Remove selected class from all items
                document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
                
                // Add selected class to clicked item
                item.classList.add('selected');

                // Handle selection (placeholder)
                const text = item.textContent.trim();
                updateStatus(`Selected: ${text}`);
                document.getElementById('selected-shell').textContent = text;
            }
        });
    }

    updateSidebarContent(activeButton) {
        const sidebarHeader = document.querySelector('.sidebar-header');
        const sidebarContent = document.querySelector('.sidebar-content');

        switch (activeButton) {
            case 'btn-explorer':
                sidebarHeader.textContent = 'Connections';
                sidebarContent.innerHTML = this.getConnectionsContent();
                break;
            case 'btn-filemanager':
                sidebarHeader.textContent = 'File Explorer';
                sidebarContent.innerHTML = this.getFileManagerContent();
                break;
            case 'btn-search':
                sidebarHeader.textContent = 'Search';
                sidebarContent.innerHTML = this.getSearchContent();
                break;
        }
    }

    getConnectionsContent() {
        return `
            <div class="tree-item folder selected">
                <span class="tree-icon">📁</span>
                <span>Local Terminals</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">💻</span>
                <span>PowerShell</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">💻</span>
                <span>Command Prompt</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">🐧</span>
                <span>WSL Ubuntu</span>
            </div>
            
            <div class="tree-item folder" style="margin-top: 8px;">
                <span class="tree-icon">📁</span>
                <span>SSH Connections</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">🌐</span>
                <span>Production Server</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">🌐</span>
                <span>Development Server</span>
            </div>
            
            <div class="tree-item folder" style="margin-top: 8px;">
                <span class="tree-icon">📁</span>
                <span>Docker Containers</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">🐳</span>
                <span>web-container</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">🐳</span>
                <span>db-container</span>
            </div>
        `;
    }

    getFileManagerContent() {
        return `
            <div class="tree-item folder">
                <span class="tree-icon">📁</span>
                <span>Documents</span>
            </div>
            <div class="tree-item folder">
                <span class="tree-icon">📁</span>
                <span>Downloads</span>
            </div>
            <div class="tree-item folder">
                <span class="tree-icon">📁</span>
                <span>Desktop</span>
            </div>
            <div class="tree-item folder">
                <span class="tree-icon">📁</span>
                <span>Projects</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">📄</span>
                <span>project1</span>
            </div>
            <div class="tree-item tree-indent">
                <span class="tree-icon">📄</span>
                <span>project2</span>
            </div>
        `;
    }

    getSearchContent() {
        return `
            <div style="padding: 8px;">
                <input type="text" placeholder="Search terminals..." style="width: 100%; padding: 4px 8px; background: var(--bg-quaternary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); font-size: 12px;">
            </div>
            <div class="tree-item">
                <span class="tree-icon">🔍</span>
                <span>Search results will appear here</span>
            </div>
        `;
    }
} 