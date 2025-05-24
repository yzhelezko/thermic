// Status management module
import { GetPlatformInfo } from '../../wailsjs/go/main/App';

export class StatusManager {
    constructor() {
        this.platformInfo = null;
        this.statusInterval = null;
    }

    async initStatus() {
        try {
            this.platformInfo = await GetPlatformInfo();
            this.updatePlatformInfo();
            this.startStatusUpdates();
        } catch (error) {
            console.error('Failed to get platform info:', error);
        }
    }

    updatePlatformInfo() {
        const platformInfo = document.getElementById('platform-info');
        if (platformInfo && this.platformInfo) {
            const hostname = this.platformInfo.hostname || 'Unknown';
            platformInfo.textContent = `${this.platformInfo.os}/${this.platformInfo.arch} @ ${hostname}`;
        }
    }

    startStatusUpdates() {
        // Demo CPU and RAM updates
        this.statusInterval = setInterval(() => {
            const cpuUsage = (Math.random() * 30 + 5).toFixed(1); // 5-35%
            const ramUsage = (Math.random() * 40 + 20).toFixed(1); // 20-60%
            
            const statusRight = document.querySelector('.status-right');
            if (statusRight) {
                const spans = statusRight.querySelectorAll('span');
                spans.forEach(span => {
                    if (span.textContent.startsWith('CPU:')) {
                        span.textContent = `CPU: ${cpuUsage}%`;
                    } else if (span.textContent.startsWith('RAM:')) {
                        span.textContent = `RAM: ${ramUsage}%`;
                    }
                });
            }
        }, 2000); // Update every 2 seconds
    }

    stopStatusUpdates() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    destroy() {
        this.stopStatusUpdates();
    }
} 