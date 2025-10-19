// GraphModal component for displaying metric graphs on hover
export class GraphModal {
    constructor() {
        this.modal = null;
        this.canvases = {};
        this.contexts = {};
        this.isVisible = false;
        this.currentMetric = null;
        this.data = { timestamps: [], values: [] };
        this.animationFrame = null;
        this.isDarkTheme = true;
        this.hideTimeout = null;
        this.closeCallback = null;
        this.isInitialLoad = false;
        
        this.createModal();
        this.setupThemeListener();
        this.setupClickOutside();
    }

    createModal() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.className = 'graph-modal graph-modal-extended';
        this.modal.style.display = 'none';
        
        // Create header
        const header = document.createElement('div');
        header.className = 'graph-modal-header';
        
        const title = document.createElement('span');
        title.className = 'graph-modal-title';
        title.textContent = 'System Resources';
        header.appendChild(title);
        
        this.modal.appendChild(header);
        
        // Create grid container for multiple graphs
        const gridContainer = document.createElement('div');
        gridContainer.className = 'graph-modal-grid';
        
        // Create individual graph sections
        const metrics = [
            { key: 'cpu', label: 'CPU Usage', height: 100 },
            { key: 'memory', label: 'RAM Usage', height: 100 },
            { key: 'load', label: 'Load Average', height: 100 },
            { key: 'disk_usage', label: 'Disk Usage', height: 100 },
            { key: 'disk_io', label: 'Disk I/O', height: 100 },
            { key: 'network', label: 'Network', height: 100 }
        ];
        
        for (const metric of metrics) {
            const section = document.createElement('div');
            section.className = 'graph-section';
            
            const sectionHeader = document.createElement('div');
            sectionHeader.className = 'graph-section-header';
            
            const label = document.createElement('span');
            label.className = 'graph-section-label';
            label.textContent = metric.label;
            sectionHeader.appendChild(label);
            
            const value = document.createElement('span');
            value.className = 'graph-section-value';
            value.id = `graph-value-${metric.key}`;
            value.textContent = '--';
            sectionHeader.appendChild(value);
            
            section.appendChild(sectionHeader);
            
            const canvas = document.createElement('canvas');
            canvas.width = 260;
            canvas.height = metric.height;
            canvas.className = 'graph-section-canvas';
            canvas.id = `graph-canvas-${metric.key}`;
            section.appendChild(canvas);
            
            gridContainer.appendChild(section);
            
            this.canvases[metric.key] = canvas;
            this.contexts[metric.key] = canvas.getContext('2d');
        }
        
        this.modal.appendChild(gridContainer);
        
        // Create uptime section
        const uptimeSection = document.createElement('div');
        uptimeSection.className = 'graph-uptime-section';
        
        const uptimeLabel = document.createElement('span');
        uptimeLabel.className = 'graph-uptime-label';
        uptimeLabel.textContent = 'System Uptime:';
        uptimeSection.appendChild(uptimeLabel);
        
        const uptimeValue = document.createElement('span');
        uptimeValue.className = 'graph-uptime-value';
        uptimeValue.id = 'graph-uptime-value';
        uptimeValue.textContent = 'N/A';
        uptimeSection.appendChild(uptimeValue);
        
        this.modal.appendChild(uptimeSection);
        
        // Add to body
        document.body.appendChild(this.modal);
    }

    setupThemeListener() {
        // Listen for theme changes
        const observer = new MutationObserver(() => {
            const theme = document.body.getAttribute('data-theme');
            this.isDarkTheme = theme === 'dark';
            if (this.isVisible) {
                this.draw();
            }
        });
        
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    setupClickOutside() {
        // Use a single global click handler (check if already exists to prevent duplicates)
        if (!this.clickHandler) {
            this.clickHandler = (e) => {
                if (this.isVisible && this.modal && !this.modal.contains(e.target)) {
                    // Check if click is on the monitored element that triggered the modal
                    const monitoringSection = document.querySelector('.status-monitoring');
                    if (monitoringSection && !monitoringSection.contains(e.target)) {
                        this.hide();
                        if (this.closeCallback) {
                            this.closeCallback();
                            this.closeCallback = null;
                        }
                    }
                }
            };
            document.addEventListener('click', this.clickHandler);
        }
        
        // Prevent modal from closing when clicking inside it
        this.modal.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Cancel hide when mouse enters modal
        this.modal.addEventListener('mouseenter', () => {
            this.cancelHide();
        });
        
        // Start hide delay when mouse leaves modal
        this.modal.addEventListener('mouseleave', () => {
            this.hideWithDelay(300);
        });
    }

    show(metric, targetElement, data, closeCallback) {
        // Clear any pending hide timeout
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
        
        this.currentMetric = metric;
        this.closeCallback = closeCallback;
        
        // Mark as initial load if no data provided or empty data
        this.isInitialLoad = !data || Object.keys(data).length === 0 || 
                            (data.cpu && (!data.cpu.timestamps || data.cpu.timestamps.length === 0));
        
        // Store the data which should contain all metrics
        this.data = data || {};
        this.isMultiMetric = true; // Always multi-metric mode now
        
        this.isVisible = true;
        
        // Position modal above target element
        this.position(targetElement);
        
        // Show modal
        this.modal.style.display = 'block';
        
        // Update metadata displays
        this.updateMetadata();
        
        // Draw all graphs
        this.draw();
    }

    hide() {
        this.isVisible = false;
        this.modal.style.display = 'none';
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        // Clear any pending hide timeout
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }
    
    hideWithDelay(delay = 300) {
        // Clear any existing timeout
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }
        
        // Set new timeout
        this.hideTimeout = setTimeout(() => {
            this.hide();
            if (this.closeCallback) {
                this.closeCallback();
                this.closeCallback = null;
            }
        }, delay);
    }
    
    cancelHide() {
        // Cancel any pending hide
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    position(targetElement) {
        if (!targetElement) return;
        
        const rect = targetElement.getBoundingClientRect();
        const modalHeight = 500; // Modal height with 3-column layout
        const modalWidth = 900;
        
        // Position above the element, centered
        let top = rect.top - modalHeight - 10;
        let left = rect.left + (rect.width / 2) - (modalWidth / 2);
        
        // Ensure modal stays within viewport
        if (top < 10) {
            // If not enough space above, show below
            top = rect.bottom + 10;
        }
        
        // Keep modal within horizontal bounds
        if (left < 10) {
            left = 10;
        } else if (left + modalWidth > window.innerWidth - 10) {
            left = window.innerWidth - modalWidth - 10;
        }
        
        // Keep modal within vertical bounds
        if (top + modalHeight > window.innerHeight - 10) {
            top = window.innerHeight - modalHeight - 10;
        }
        if (top < 10) {
            top = 10;
        }
        
        this.modal.style.top = `${top}px`;
        this.modal.style.left = `${left}px`;
    }

    update(data) {
        this.data = data || {};
        
        // Once we receive data with timestamps, we're no longer in initial load state
        if (data && data.cpu && data.cpu.timestamps && data.cpu.timestamps.length > 0) {
            this.isInitialLoad = false;
        }
        
        if (this.isVisible) {
            this.draw();
        }
    }

    draw() {
        // Get theme colors
        const colors = this.getThemeColors();
        
        // Draw each metric graph
        this.drawMetricGraph('cpu', colors, '#4A9EFF');
        this.drawMetricGraph('memory', colors, '#4AFF8E');
        this.drawMetricGraph('load', colors, '#FFB84A');
        this.drawMetricGraph('disk_usage', colors, '#FF6B9D');
        this.drawMetricGraph('disk_io', colors, '#9D6BFF');
        this.drawMetricGraph('network', colors, '#FF9D4A');
        
        // Update uptime
        this.updateUptime();
    }
    
    drawMetricGraph(metricKey, colors, lineColor) {
        const canvas = this.canvases[metricKey];
        const ctx = this.contexts[metricKey];
        
        if (!canvas || !ctx) return;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Get data for this metric
        const metricData = this.data[metricKey];
        
        if (!metricData || !metricData.timestamps || !metricData.values || metricData.timestamps.length === 0) {
            this.drawEmptyGraph(ctx, canvas, colors);
            this.updateMetricValue(metricKey, '--');
            return;
        }
        
        // Calculate max value for scaling
        const maxValue = Math.max(...metricData.values, this.getDefaultMax(metricKey));
        
        // Draw grid with Y-axis labels
        this.drawGridForMetric(ctx, canvas, colors, maxValue, metricKey);
        
        // Draw line chart
        this.drawLineForMetric(ctx, canvas, metricData.timestamps, metricData.values, lineColor, maxValue);
        
        // Update current value display
        if (metricData.values.length > 0) {
            const currentValue = metricData.values[metricData.values.length - 1];
            this.updateMetricValue(metricKey, currentValue);
        }
    }
    
    getDefaultMax(metricKey) {
        // Return sensible default max values for each metric type
        if (metricKey === 'cpu' || metricKey === 'disk_usage') {
            return 100; // Percentage
        } else if (metricKey === 'memory') {
            return 1024; // 1GB in MB
        } else if (metricKey === 'load') {
            return 4; // Load average
        } else if (metricKey === 'disk_io' || metricKey === 'network') {
            return 10; // 10 MB/s
        }
        return 100;
    }
    
    updateMetricValue(metricKey, value) {
        const valueEl = document.getElementById(`graph-value-${metricKey}`);
        if (!valueEl) return;
        
        if (value === '--') {
            valueEl.textContent = '--';
            return;
        }
        
        // Get metadata for max values
        const metadata = this.data.metadata || {};
        
        // Format based on metric type
        if (metricKey === 'cpu') {
            const cpuCount = metadata.cpu_count || '';
            const suffix = cpuCount ? ` / ${cpuCount} cores` : '';
            valueEl.textContent = `${value.toFixed(1)}%${suffix}`;
        } else if (metricKey === 'disk_usage') {
            const diskCapacity = metadata.disk_capacity || 0;
            const suffix = diskCapacity > 0 ? ` / ${diskCapacity.toFixed(0)} GB` : '';
            valueEl.textContent = `${value.toFixed(1)}%${suffix}`;
        } else if (metricKey === 'memory') {
                    // Convert to GB if >= 1024 MB
            const memDisplay = value >= 1024 
                ? `${(value / 1024).toFixed(2)} GB`
                : `${Math.round(value)} MB`;
            const memTotal = metadata.memory_total || 0;
            const suffix = memTotal > 0 ? ` / ${(memTotal / 1024).toFixed(1)} GB` : '';
            valueEl.textContent = memDisplay + suffix;
        } else if (metricKey === 'load') {
            valueEl.textContent = value.toFixed(2);
        } else if (metricKey === 'disk_io' || metricKey === 'network') {
            valueEl.textContent = `${value.toFixed(1)} MB/s`;
                } else {
            valueEl.textContent = value.toFixed(2);
        }
    }
    
    updateMetadata() {
        // Metadata is now included in this.data, just trigger value updates
        // The updateMetricValue method will use metadata automatically
    }
    
    updateUptime() {
        const uptimeEl = document.getElementById('graph-uptime-value');
        if (!uptimeEl) return;
        
        const uptime = this.data.uptime;
        if (uptime && uptime !== 'unknown' && uptime !== 'N/A') {
            uptimeEl.textContent = uptime;
            } else {
            uptimeEl.textContent = 'N/A';
        }
    }
    
    drawEmptyGraph(ctx, canvas, colors) {
        ctx.fillStyle = colors.text;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Show "Loading..." if modal was just opened, otherwise "No data"
        const message = this.isInitialLoad ? 'Loading...' : 'No data';
        ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    }
    
    drawGridForMetric(ctx, canvas, colors, maxValue, metricKey) {
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 10, right: 10, bottom: 15, left: 40 };
        
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        // Horizontal grid lines (3 lines)
        for (let i = 0; i <= 2; i++) {
            const y = padding.top + (height - padding.top - padding.bottom) * (i / 2);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
        
        ctx.setLineDash([]);
        
        // Draw Y-axis labels
        ctx.fillStyle = colors.text;
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        // Draw 3 labels (max, mid, 0)
        for (let i = 0; i <= 2; i++) {
            const value = maxValue * (1 - i / 2);
            const y = padding.top + (height - padding.top - padding.bottom) * (i / 2);
            
            let label = '';
            if (metricKey === 'cpu' || metricKey === 'disk_usage') {
                label = `${value.toFixed(0)}%`;
            } else if (metricKey === 'memory') {
                if (value >= 1024) {
                    label = `${(value / 1024).toFixed(1)}G`;
                } else {
                    label = `${Math.round(value)}M`;
                }
            } else if (metricKey === 'load') {
                label = value.toFixed(1);
            } else if (metricKey === 'disk_io' || metricKey === 'network') {
                label = `${value.toFixed(1)}`;
            } else {
                label = value.toFixed(0);
            }
            
            ctx.fillText(label, padding.left - 5, y);
        }
    }
    
    drawLineForMetric(ctx, canvas, timestamps, values, color, maxValue) {
        if (values.length === 0) return;
        
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 10, right: 10, bottom: 15, left: 40 };
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        // Use provided maxValue for consistent scaling
        const minValue = 0; // Start from 0 for most metrics
        const valueRange = maxValue || 1;
        
        // Calculate time scale
        const now = Date.now();
        const timeWindow = 60000; // 60 seconds
        
        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        let firstPoint = true;
        for (let i = 0; i < timestamps.length; i++) {
            const timestamp = timestamps[i];
            const value = values[i];
            
            // Calculate position
            const age = now - timestamp;
            const x = padding.left + chartWidth * (1 - (age / timeWindow));
            const y = padding.top + chartHeight * (1 - (value - minValue) / valueRange);
            
            if (x >= padding.left && x <= width - padding.right) {
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
                }
            }
        }
        
        ctx.stroke();
        
        // Draw filled area under line
        if (!firstPoint) {
            ctx.lineTo(width - padding.right, height - padding.bottom);
        ctx.lineTo(padding.left, height - padding.bottom);
        ctx.closePath();
        
        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
            gradient.addColorStop(0, color + '40'); // Add alpha
            gradient.addColorStop(1, color + '00');
        ctx.fillStyle = gradient;
        ctx.fill();
        }
    }

    getThemeColors() {
        if (this.isDarkTheme) {
            return {
                background: '#1e1e1e',
                text: '#cccccc',
                grid: '#333333',
                line: '#007acc',
                fillStart: 'rgba(0, 122, 204, 0.3)',
                fillEnd: 'rgba(0, 122, 204, 0.0)'
            };
        } else {
            return {
                background: '#ffffff',
                text: '#333333',
                grid: '#e0e0e0',
                line: '#007acc',
                fillStart: 'rgba(0, 122, 204, 0.2)',
                fillEnd: 'rgba(0, 122, 204, 0.0)'
            };
        }
    }


    destroy() {
        // Remove global click handler
        if (this.clickHandler) {
            document.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
        
        if (this.modal && this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }
}

