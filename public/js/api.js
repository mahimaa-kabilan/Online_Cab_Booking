/**
 * Common AJAX/Fetch API and Client State Manager
 * Uses Vanilla Fetch API & DOM (No frameworks)
 */

const api = {
    baseUrl: '/api',

    getToken() {
        return localStorage.getItem('cab_auth_token');
    },

    setToken(token) {
        if (token) {
            localStorage.setItem('cab_auth_token', token);
        } else {
            localStorage.removeItem('cab_auth_token');
        }
    },

    getUser() {
        const userStr = localStorage.getItem('cab_user');
        try {
            return userStr ? JSON.parse(userStr) : null;
        } catch {
            return null;
        }
    },

    setUser(user) {
        if (user) {
            localStorage.setItem('cab_user', JSON.stringify(user));
        } else {
            localStorage.removeItem('cab_user');
        }
    },

    logout() {
        this.setToken(null);
        this.setUser(null);
        window.location.href = '/index.html';
    },

    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json().catch(() => ({}));

            if (response.status === 401) {
                // Unauthorized / expired token
                if (window.location.pathname !== '/index.html' && window.location.pathname !== '/') {
                    this.logout();
                }
            }

            if (!response.ok) {
                throw new Error(data.message || `HTTP error ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('Fetch error:', error);
            throw error;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data || {})
        });
    },

    put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data || {})
        });
    },

    toast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'success' ? '✓' : type === 'danger' ? '✕' : 'ℹ';
        toast.innerHTML = `<span><strong>${icon}</strong> ${message}</span>`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    },

    requireAuth(allowedRole = null) {
        const token = this.getToken();
        const user = this.getUser();

        if (!token || !user) {
            window.location.href = '/index.html';
            return false;
        }

        if (allowedRole && user.role !== allowedRole) {
            if (user.role === 'PASSENGER') {
                window.location.href = '/passenger/passenger-dashboard.html';
            } else if (user.role === 'DRIVER') {
                window.location.href = '/driver/driver-dashboard.html';
            } else {
                window.location.href = '/index.html';
            }
            return false;
        }

        return true;
    },

    formatCurrency(val) {
        const num = parseFloat(val) || 0;
        return `₹${num.toFixed(2)}`;
    },

    formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    }
};

window.api = api;
