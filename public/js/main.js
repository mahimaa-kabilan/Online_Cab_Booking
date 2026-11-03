/**
 * Shared UI component, Session Helpers & Direct Backend API Client
 * Connects directly to backend without intermediate layers or mock data.
 */

// --- SESSION STORAGE HELPERS ---
function getAuthToken() {
    return localStorage.getItem('cab_auth_token');
}

function getAuthUser() {
    const userStr = localStorage.getItem('cab_user');
    try {
        return userStr ? JSON.parse(userStr) : null;
    } catch {
        return null;
    }
}

function setAuthSession(token, user) {
    if (token) localStorage.setItem('cab_auth_token', token);
    else localStorage.removeItem('cab_auth_token');

    if (user) localStorage.setItem('cab_user', JSON.stringify(user));
    else localStorage.removeItem('cab_user');
}

function logout() {
    localStorage.removeItem('cab_auth_token');
    localStorage.removeItem('cab_user');
    window.location.href = '/index.html';
}

function requireAuth(allowedRole = null) {
    const token = getAuthToken();
    const user = getAuthUser();

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
}

function formatCurrency(val) {
    const num = parseFloat(val) || 0;
    return `₹${num.toFixed(2)}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function showToast(message, type = 'info') {
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
}

// Direct backend connection wrapper (no mock / simulated data)
window.api = {
    getToken: getAuthToken,
    setToken: (t) => { if (t) localStorage.setItem('cab_auth_token', t); else localStorage.removeItem('cab_auth_token'); },
    getUser: getAuthUser,
    setUser: (u) => { if (u) localStorage.setItem('cab_user', JSON.stringify(u)); else localStorage.removeItem('cab_user'); },
    logout: logout,
    requireAuth: requireAuth,
    formatCurrency: formatCurrency,
    formatDate: formatDate,
    toast: showToast,

    // Direct HTTP fetch to Node.js + MySQL backend
    async get(endpoint) {
        const token = getAuthToken();
        const res = await fetch('/api' + endpoint.replace('/api', ''), {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (res.status === 401 && window.location.pathname !== '/index.html' && window.location.pathname !== '/') {
            logout();
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        return data;
    },

    async post(endpoint, body) {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api' + endpoint.replace('/api', ''), {
            method: 'POST',
            headers,
            body: JSON.stringify(body || {})
        });
        if (res.status === 401 && endpoint !== '/auth/login' && window.location.pathname !== '/index.html') {
            logout();
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        return data;
    },

    async put(endpoint, body) {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api' + endpoint.replace('/api', ''), {
            method: 'PUT',
            headers,
            body: JSON.stringify(body || {})
        });
        if (res.status === 401 && window.location.pathname !== '/index.html') {
            logout();
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        return data;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
});

function initNavbar() {
    const navUserContainer = document.getElementById('nav-user-container');
    if (!navUserContainer) return;

    const user = getAuthUser();

    if (user) {
        let dashboardLink = '/passenger/passenger-dashboard.html';
        if (user.role === 'DRIVER') {
            dashboardLink = '/driver/driver-dashboard.html';
        } else if (user.role === 'ADMIN' || user.role === 'SUPER ADMIN') {
            dashboardLink = '/admin/admin-dashboard.html';
        }

        navUserContainer.innerHTML = `
            <div class="user-badge">
                <span>👤 <strong>${user.name}</strong></span>
            </div>
            <a href="${dashboardLink}" class="btn btn-outline btn-sm" style="color:#fff; border-color:#475569;">Dashboard</a>
            <button id="nav-logout-btn" class="btn btn-danger btn-sm">Logout</button>
        `;

        const logoutBtn = document.getElementById('nav-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                logout();
            });
        }
    } else {
        navUserContainer.innerHTML = `
            <a href="/index.html" class="btn btn-primary btn-sm">Sign In</a>
        `;
    }
}
