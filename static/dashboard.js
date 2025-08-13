// Dashboard JavaScript functionality
class TaskDashboard {
    constructor() {
        this.tasksData = null;
        this.currentFilter = 'all';
        this.currentSort = 'deadline-asc';
        this.pieChart = null;
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
    }

    async loadData() {
        try {
            this.showLoading();
            const response = await fetch('/api/tasks');
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            this.tasksData = data;
            this.updateDashboard();
            this.hideLoading();
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError();
        }
    }

    showLoading() {
        document.getElementById('loading').classList.remove('hidden');
        document.getElementById('dashboard-content').classList.add('hidden');
        document.getElementById('error-message').classList.add('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('dashboard-content').classList.remove('hidden');
        document.getElementById('error-message').classList.add('hidden');
    }

    showError() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('dashboard-content').classList.add('hidden');
        document.getElementById('error-message').classList.remove('hidden');
    }

    updateDashboard() {
        this.updateStatistics();
        this.updatePieChart();
        this.renderStageDashboard();
        this.renderTaskCards();
    }

    updateStatistics() {
        const stats = this.tasksData.statistics;
        document.getElementById('total-tasks').textContent = stats.total;
        document.getElementById('done-tasks').textContent = stats.done;
        document.getElementById('overdue-tasks').textContent = stats.overdue;
        document.getElementById('progress-tasks').textContent = stats.in_progress;
    }

    updatePieChart() {
        const ctx = document.getElementById('taskPieChart').getContext('2d');
        const stats = this.tasksData.statistics;
        
        // Destroy existing chart if it exists
        if (this.pieChart) {
            this.pieChart.destroy();
        }

        // Only show chart if there are tasks
        if (stats.total === 0) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.fillStyle = '#6b7280';
            ctx.font = '16px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('No tasks available', ctx.canvas.width / 2, ctx.canvas.height / 2);
            return;
        }

        this.pieChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Overdue', 'In Progress', 'Completed'],
                datasets: [{
                    data: [stats.overdue, stats.in_progress, stats.done],
                    backgroundColor: [
                        '#ef4444', // Red for overdue
                        '#f59e0b',  // Orange for in progress
                        '#10b981' // Green for completed
                    ],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            font: {
                                family: 'Inter',
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label;
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((value / total) * 100);
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                },
                cutout: '60%',
                animation: {
                    animateRotate: true,
                    duration: 1000
                }
            }
        });
    }

    renderStageDashboard() {
        const stageDashboard = document.getElementById('stage-dashboard');
        const stageStats = this.tasksData.stage_statistics;
        
        if (!stageStats || Object.keys(stageStats).length === 0) {
            stageDashboard.innerHTML = '<p class="no-data">No stage data available</p>';
            return;
        }

        // Sort stages by total task count (descending)
        const sortedStages = Object.entries(stageStats).sort((a, b) => b[1].total - a[1].total);
        
        stageDashboard.innerHTML = sortedStages.map(([stageName, stats]) => {
            return `
                <div class="stage-item">
                    <div class="stage-header">
                        <h3 class="stage-name">${this.escapeHtml(stageName)}</h3>
                        <span class="stage-total">${stats.total} task${stats.total !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="stage-progress">
                        <div class="progress-bar">
                            <div class="progress-segment done" 
                                 style="width: ${stats.done_percentage}%"
                                 title="Completed: ${stats.done_count} tasks (${stats.done_percentage}%)"></div>
                            <div class="progress-segment in-progress" 
                                 style="width: ${stats.in_progress_percentage}%"
                                 title="In Progress: ${stats.in_progress_count} tasks (${stats.in_progress_percentage}%)"></div>
                            <div class="progress-segment overdue" 
                                 style="width: ${stats.overdue_percentage}%"
                                 title="Overdue: ${stats.overdue_count} tasks (${stats.overdue_percentage}%)"></div>
                        </div>
                        <div class="stage-legend">
                            <div class="legend-item">
                                <span class="legend-dot done"></span>
                                <span class="legend-text">Completed ${stats.done_percentage}%</span>
                            </div>
                            <div class="legend-item">
                                <span class="legend-dot in-progress"></span>
                                <span class="legend-text">In Progress ${stats.in_progress_percentage}%</span>
                            </div>
                            <div class="legend-item">
                                <span class="legend-dot overdue"></span>
                                <span class="legend-text">Overdue ${stats.overdue_percentage}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderTaskCards() {
        const container = document.getElementById('tasks-container');
        container.innerHTML = '';

        const filteredTasks = this.getFilteredTasks();

        if (filteredTasks.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #6b7280;">
                    <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 15px;"></i>
                    <p>No tasks found for the selected filter.</p>
                </div>
            `;
            return;
        }

        filteredTasks.forEach(task => {
            const taskCard = this.createTaskCard(task);
            container.appendChild(taskCard);
        });
    }

    getFilteredTasks() {
        if (!this.tasksData || !this.tasksData.tasks) return [];

        const filteredTasks = this.tasksData.tasks.filter(task => {
            switch (this.currentFilter) {
                case 'done':
                    return task.is_done;
                case 'overdue':
                    return task.is_overdue && !task.is_done;
                case 'progress':
                    return !task.is_done && !task.is_overdue;
                case 'all':
                default:
                    return true;
            }
        });

        return this.getSortedTasks(filteredTasks);
    }

    getSortedTasks(tasks) {
        return tasks.sort((a, b) => {
            const dateA = new Date(a.deadline);
            const dateB = new Date(b.deadline);
            
            switch (this.currentSort) {
                case 'deadline-desc':
                    return dateB - dateA; // Latest first
                case 'deadline-asc':
                default:
                    return dateA - dateB; // Earliest first
            }
        });
    }

    createTaskCard(task) {
        const card = document.createElement('div');
        card.className = `task-card ${this.getTaskClass(task)}`;

        const deadline = new Date(task.deadline);
        const formattedDeadline = deadline.toLocaleDateString('en-GB', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const weekday = deadline.toLocaleDateString('en-GB', { weekday: 'short' });

        const assigneesHtml = task.assignees.length > 0 
            ? task.assignees.map(assignee => `<span class="assignee-tag">${assignee}</span>`).join('')
            : '<span class="assignee-tag">No Assignees</span>';

        // Generate deadline info based on task status
        let deadlineInfo = '';
        if (task.is_overdue && task.is_deadline_today) {
            deadlineInfo = `<span class="overdue-badge">today</span>`;
        } else if (task.is_overdue && task.days_overdue > 0) {
            deadlineInfo = `<span class="overdue-badge">${task.days_overdue} days overdue</span>`;
        } else if (!task.is_done && !task.is_overdue && task.is_deadline_today) {
            // Show "Today" for in-progress tasks with today's deadline
            deadlineInfo = `<span class="progress-badge">Today</span>`;
        } else if (!task.is_done && !task.is_overdue && task.calendar_days_to_deadline > 0) {
            // Special handling for one day difference
            if (task.calendar_days_to_deadline === 1) {
                deadlineInfo = `<span class="progress-badge">Tomorrow</span>`;
            // Special handling for weekend deadlines
            } else if (task.is_deadline_weekend && task.working_days_to_deadline === 0) {
                deadlineInfo = `<span class="progress-badge">${task.calendar_days_to_deadline} days (0 working days - deadline in weekend)</span>`;
            } else {
                deadlineInfo = `<span class="progress-badge">${task.calendar_days_to_deadline} days to the deadline (${task.working_days_to_deadline} working days)</span>`;
            }
        }

        card.innerHTML = `
            <div class="task-header">
                <div>
                    <div class="task-name">${this.escapeHtml(task.name)}</div>
                </div>
                <span class="task-status ${this.getStatusClass(task)}">${this.getStatusText(task)}</span>
            </div>
            
            <div class="task-info">
                <div class="info-item">
                    <span class="info-label">Project</span>
                    <span class="info-value">${this.escapeHtml(task.project_name)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Manager</span>
                    <span class="info-value">${this.escapeHtml(task.manager)}</span>
                </div>
            </div>
            
            <div class="task-deadline">
                <i class="fas fa-calendar-alt"></i>
                <span>Deadline: ${weekday}, ${formattedDeadline}</span>
                ${deadlineInfo}
            </div>
            
            <div style="margin-top: 15px;">
                <span class="info-label">Assigned to:</span>
                <div class="assignees" style="margin-top: 8px;">
                    ${assigneesHtml}
                </div>
            </div>
        `;

        return card;
    }

    getTaskClass(task) {
        if (task.is_done) return 'done';
        if (task.is_overdue) return 'overdue';
        return 'progress';
    }

    getStatusClass(task) {
        if (task.is_done) return 'done';
        if (task.is_overdue) return 'overdue';
        return 'progress';
    }

    getStatusText(task) {
        if (task.is_done) return 'Done';
        if (task.is_overdue) return 'Overdue';
        return 'In Progress';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupEventListeners() {
        // Filter buttons
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all buttons
                filterButtons.forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                button.classList.add('active');
                
                // Update current filter
                this.currentFilter = button.dataset.filter;
                
                // Re-render task cards
                this.renderTaskCards();
            });
        });

        // Sort buttons
        const sortButtons = document.querySelectorAll('.sort-btn');
        sortButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all sort buttons
                sortButtons.forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                button.classList.add('active');
                
                // Update current sort
                this.currentSort = button.dataset.sort;
                
                // Re-render task cards
                this.renderTaskCards();
            });
        });

        // Refresh button
        const refreshButton = document.querySelector('.refresh-button');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                this.loadData();
            });
        }
    }
}

// Global refresh function for the refresh button
function refreshData() {
    if (window.dashboard) {
        window.dashboard.loadData();
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new TaskDashboard();
});

// Auto-refresh every 5 minutes
setInterval(() => {
    if (window.dashboard) {
        window.dashboard.loadData();
    }
}, 300000); // 5 minutes in milliseconds