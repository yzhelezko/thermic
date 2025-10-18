// GraphModal component for displaying metric graphs on hover
export class GraphModal {
    constructor() {
        this.modal = null;
        this.canvas = null;
        this.ctx = null;
        this.isVisible = false;
        this.currentMetric = null;
        this.data = { timestamps: [], values: [] };
        this.animationFrame = null;
        this.isDarkTheme = true;
        
        this.createModal();
        this.setupThemeListener();
    }

    createModal() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.className = 'graph-modal';
        this.modal.style.display = 'none';
        
        // Create header
        const header = document.createElement('div');
        header.className = 'graph-modal-header';
        
        const title = document.createElement('span');
        title.className = 'graph-modal-title';
        title.textContent = 'Metric History';
        header.appendChild(title);
        
        const currentValue = document.createElement('span');
        currentValue.className = 'graph-modal-current';
        currentValue.textContent = '0%';
        header.appendChild(currentValue);
        
        this.modal.appendChild(header);
        
        // Create canvas (larger for multi-metric graphs)
        this.canvas = document.createElement('canvas');
        this.canvas.width = 400;
        this.canvas.height = 150;
        this.canvas.className = 'graph-modal-canvas';
        this.modal.appendChild(this.canvas);
        
        // Get context
        this.ctx = this.canvas.getContext('2d');
        
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

    show(metric, targetElement, data) {
        this.currentMetric = metric;
        
        // Support both single metric and multi-metric data
        // Multi-metric format: { cpu: {timestamps, values}, memory: {timestamps, values}, load: {timestamps, values} }
        // Single metric format: { timestamps: [], values: [] }
        this.data = data || { timestamps: [], values: [] };
        this.isMultiMetric = metric === 'system' && data && !Array.isArray(data.timestamps);
        
        this.isVisible = true;
        
        // Update title
        const title = this.modal.querySelector('.graph-modal-title');
        title.textContent = this.getMetricLabel(metric);
        
        // Position modal above target element
        this.position(targetElement);
        
        // Show modal
        this.modal.style.display = 'block';
        
        // Draw graph
        this.draw();
    }

    hide() {
        this.isVisible = false;
        this.modal.style.display = 'none';
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    position(targetElement) {
        if (!targetElement) return;
        
        const rect = targetElement.getBoundingClientRect();
        const modalHeight = 220; // Approx modal height (larger for multi-metric)
        const modalWidth = 400;
        
        // Position above the element
        let top = rect.top - modalHeight - 10;
        let left = rect.left + (rect.width / 2) - (modalWidth / 2);
        
        // Ensure modal stays within viewport
        if (top < 10) {
            // If not enough space above, show below
            top = rect.bottom + 10;
        }
        
        if (left < 10) {
            left = 10;
        } else if (left + modalWidth > window.innerWidth - 10) {
            left = window.innerWidth - modalWidth - 10;
        }
        
        this.modal.style.top = `${top}px`;
        this.modal.style.left = `${left}px`;
    }

    update(data) {
        this.data = data || { timestamps: [], values: [] };
        if (this.isVisible) {
            this.draw();
        }
    }

    draw() {
        if (!this.ctx || !this.canvas) return;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Get theme colors
        const colors = this.getThemeColors();
        
        if (this.isMultiMetric) {
            // Multi-metric graph (CPU + Memory + Load)
            this.drawMultiMetricGraph(colors);
        } else {
            // Single metric graph
            const { timestamps, values } = this.data;
            
            if (!timestamps || !values || timestamps.length === 0) {
                this.drawEmpty();
                return;
            }
            
            // Draw grid
            this.drawGrid(colors);
            
            // Draw line chart
            this.drawLineChart(timestamps, values, colors);
            
            // Update current value
            if (values.length > 0) {
                const currentValue = values[values.length - 1];
                const currentValueEl = this.modal.querySelector('.graph-modal-current');
                currentValueEl.textContent = this.formatValue(currentValue);
            }
        }
    }
    
    drawMultiMetricGraph(colors) {
        // Draw grid first
        this.drawGrid(colors);
        
        // Define metric colors
        const metricStyles = {
            cpu: { color: '#4A9EFF', label: 'CPU' },      // Blue
            memory: { color: '#4AFF8E', label: 'Memory' }, // Green
            load: { color: '#FFB84A', label: 'Load' }     // Orange
        };
        
        // Draw each metric line
        const metrics = ['cpu', 'memory', 'load'];
        let currentValues = {};
        
        for (const metric of metrics) {
            const metricData = this.data[metric];
            if (metricData && metricData.timestamps && metricData.values && metricData.timestamps.length > 0) {
                this.drawLineChartMulti(metricData.timestamps, metricData.values, metricStyles[metric].color);
                currentValues[metric] = metricData.values[metricData.values.length - 1];
            }
        }
        
        // Draw legend
        this.drawLegend(metricStyles, currentValues, colors);
        
        // Update current value display (combined)
        const currentValueEl = this.modal.querySelector('.graph-modal-current');
        const parts = [];
        if (currentValues.cpu !== undefined) parts.push(`CPU:${currentValues.cpu.toFixed(1)}%`);
        if (currentValues.memory !== undefined) {
            // Convert to GB if >= 1024 MB
            const memDisplay = currentValues.memory >= 1024 
                ? `${(currentValues.memory / 1024).toFixed(2)}Gb`
                : `${Math.round(currentValues.memory)}Mb`;
            parts.push(`RAM:${memDisplay}`);
        }
        if (currentValues.load !== undefined) parts.push(`L:${currentValues.load.toFixed(2)}`);
        currentValueEl.textContent = parts.join(' ');
    }
    
    drawLegend(metricStyles, currentValues, colors) {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = { top: 10, right: 10, bottom: 20, left: 40 };
        
        // Draw legend at the top right
        const legendX = width - padding.right - 100;
        const legendY = padding.top + 5;
        const lineHeight = 14;
        
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        let y = legendY;
        for (const [metric, style] of Object.entries(metricStyles)) {
            // Draw color indicator
            ctx.fillStyle = style.color;
            ctx.fillRect(legendX, y - 3, 12, 6);
            
            // Draw label
            ctx.fillStyle = colors.text;
            const value = currentValues[metric];
            let valueText = 'N/A';
            if (value !== undefined) {
                if (metric === 'memory') {
                    // Convert to GB if >= 1024 MB
                    valueText = value >= 1024 
                        ? `${(value / 1024).toFixed(2)}Gb`
                        : `${Math.round(value)}Mb`;
                } else if (metric === 'load') {
                    valueText = value.toFixed(2);
                } else {
                    valueText = `${value.toFixed(1)}%`;
                }
            }
            ctx.fillText(`${style.label}: ${valueText}`, legendX + 16, y);
            
            y += lineHeight;
        }
    }
    
    drawLineChartMulti(timestamps, values, color) {
        if (values.length === 0) return;
        
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = { top: 10, right: 10, bottom: 20, left: 40 };
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        // Find min/max values globally across all metrics for consistent scaling
        const maxValue = Math.max(...values, 100); // At least 100 for percentage-based scaling
        const minValue = 0;
        const valueRange = maxValue || 1;
        
        // Calculate scale
        const now = Date.now();
        const timeWindow = 60000; // 60 seconds
        
        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        
        let firstPoint = true;
        for (let i = 0; i < timestamps.length; i++) {
            const timestamp = timestamps[i];
            const value = values[i];
            
            // Calculate position
            const timeAgo = now - timestamp;
            const x = padding.left + chartWidth - (timeAgo / timeWindow) * chartWidth;
            const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    drawEmpty() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const colors = this.getThemeColors();
        this.ctx.fillStyle = colors.text;
        this.ctx.font = '12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('No data available', this.canvas.width / 2, this.canvas.height / 2);
    }

    drawGrid(colors) {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = { top: 10, right: 10, bottom: 20, left: 40 };
        
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        // Horizontal grid lines (5 lines)
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (height - padding.top - padding.bottom) * (i / 4);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
        
        // Vertical grid lines (6 lines for 60s)
        for (let i = 0; i <= 5; i++) {
            const x = padding.left + (width - padding.left - padding.right) * (i / 5);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height - padding.bottom);
            ctx.stroke();
        }
        
        ctx.setLineDash([]);
        
        // Draw axis labels
        ctx.fillStyle = colors.text;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        // Time labels (bottom)
        const timeLabels = ['60s', '50s', '40s', '30s', '20s', '10s', '0s'];
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 6; i++) {
            const x = padding.left + (width - padding.left - padding.right) * (i / 6);
            if (i % 2 === 0) { // Only show every other label to avoid crowding
                ctx.fillText(timeLabels[i], x, height - padding.bottom + 5);
            }
        }
    }

    drawLineChart(timestamps, values, colors) {
        if (values.length === 0) return;
        
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = { top: 10, right: 10, bottom: 20, left: 40 };
        
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        // Find min/max values
        const maxValue = Math.max(...values, 0);
        const minValue = Math.min(...values, 0);
        const valueRange = maxValue - minValue || 1;
        
        // Calculate scale
        const now = Date.now();
        const timeWindow = 60000; // 60 seconds
        
        // Draw line
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        let firstPoint = true;
        for (let i = 0; i < timestamps.length; i++) {
            const timestamp = timestamps[i];
            const value = values[i];
            
            // Calculate position
            const age = now - timestamp; // How old is this data point
            const x = padding.left + chartWidth * (1 - (age / timeWindow));
            const y = padding.top + chartHeight * (1 - (value - minValue) / valueRange);
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        
        // Draw area under line (gradient fill)
        ctx.lineTo(padding.left + chartWidth, height - padding.bottom);
        ctx.lineTo(padding.left, height - padding.bottom);
        ctx.closePath();
        
        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, colors.fillStart);
        gradient.addColorStop(1, colors.fillEnd);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw Y-axis labels
        ctx.fillStyle = colors.text;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        for (let i = 0; i <= 4; i++) {
            const value = maxValue - (maxValue - minValue) * (i / 4);
            const y = padding.top + chartHeight * (i / 4);
            ctx.fillText(this.formatValue(value), padding.left - 5, y);
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

    getMetricLabel(metric) {
        const labels = {
            'system': 'System Resources (CPU • Memory • Load)',
            'cpu': 'CPU Usage',
            'memory': 'Memory Usage',
            'disk-usage': 'Disk Usage',
            'disk-io': 'Disk I/O',
            'network': 'Network Activity',
            'load': 'Load Average',
            'uptime': 'System Uptime'
        };
        return labels[metric] || 'Metric History';
    }

    formatValue(value) {
        if (typeof value !== 'number') return '0';
        
        // Format based on metric type
        if (this.currentMetric === 'cpu' || this.currentMetric === 'memory' || this.currentMetric === 'disk-usage') {
            return `${value.toFixed(1)}%`;
        } else if (this.currentMetric === 'disk-io' || this.currentMetric === 'network') {
            return `${value.toFixed(1)} MB/s`;
        } else {
            return value.toFixed(2);
        }
    }

    destroy() {
        if (this.modal && this.modal.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
        }
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }
}

