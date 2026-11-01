/**
 * Common AJAX/Fetch API and Client State Manager
 * Uses Vanilla Fetch API & DOM (No frameworks)
 * Includes mock fallbacks for local testing without MySQL
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
        const cleanEndpoint = endpoint.replace('/api', '');

        // --- LOCAL MOCK OVERRIDES (NO MYSQL REQUIRED) ---
        if (cleanEndpoint === '/auth/login' && options.method === 'POST') {
            const body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {});
            let mockUser = { user_id: 1, name: 'Sample Passenger', email: body.email || 'passenger@cabgo.com', role: 'PASSENGER' };

            if (body.role === 'ADMIN' || body.role === 'SUPER ADMIN' || (body.email && body.email.includes('admin'))) {
                mockUser = { user_id: 100, name: 'System Admin', email: 'admin@cabgo.com', role: 'ADMIN' };
            } else if (body.role === 'DRIVER' || (body.email && body.email.includes('driver'))) {
                mockUser = { user_id: 200, name: 'John Driver', email: 'driver@cabgo.com', role: 'DRIVER' };
            }

            const mockData = {
                success: true,
                message: 'Login successful',
                token: 'mock-jwt-token-xyz789',
                user: mockUser
            };

            this.setToken(mockData.token);
            this.setUser(mockData.user);
            return mockData;
        }

        if (cleanEndpoint === '/admin/stats') {
            return {
                success: true,
                stats: {
                    totalPassengers: 24,
                    totalDrivers: 8,
                    activeTrips: 4,
                    totalRevenue: 12850.00
                }
            };
        }

        if (cleanEndpoint === '/admin/users') {
            return {
                success: true,
                users: [
                    { user_id: 1, name: 'System Admin', email: 'admin@cabgo.com', mobile: '9876543210', role: 'ADMIN', status: 'ACTIVE', created_at: new Date().toISOString() },
                    { user_id: 2, name: 'John Driver', email: 'driver@cabgo.com', mobile: '9876543211', role: 'DRIVER', status: 'ACTIVE', created_at: new Date().toISOString() },
                    { user_id: 3, name: 'Jane Passenger', email: 'passenger@cabgo.com', mobile: '9876543212', role: 'PASSENGER', status: 'ACTIVE', created_at: new Date().toISOString() }
                ]
            };
        }

        if (cleanEndpoint === '/admin/toggle-status' && options.method === 'POST') {
            return { success: true, message: 'User status toggled successfully' };
        }

        if (cleanEndpoint === '/rides/my-active') {
            return { success: true, active: false };
        }

        if (cleanEndpoint === '/rides/history') {
            return { success: true, count: 0, trips: [] };
        }

        if (cleanEndpoint === '/profile') {
            const user = this.getUser() || { user_id: 1, name: 'Sample User', email: 'user@cabgo.com', role: 'PASSENGER' };
            return { success: true, profile: { ...user, default_address: '124 Park Street', emergency_contact: '9876543299' } };
        }

        // --- REAL FETCH BACKUP ---
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${cleanEndpoint}`;
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
            if (allowedRole === 'ADMIN' && (user.role === 'ADMIN' || user.role === 'SUPER ADMIN')) {
                return true;
            }

            if (user.role === 'PASSENGER') {
                window.location.href = '/passenger/passenger-dashboard.html';
            } else if (user.role === 'DRIVER') {
                window.location.href = '/driver/driver-dashboard.html';
            } else if (user.role === 'ADMIN' || user.role === 'SUPER ADMIN') {
                window.location.href = '/admin/admin-dashboard.html';
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