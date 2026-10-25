/**
 * Shared UI component & Navigation Manager
 */

document.addEventListener('DOMContentLoaded', () => {
    initNavbar();
});

function initNavbar() {
    const navUserContainer = document.getElementById('nav-user-container');
    if (!navUserContainer) return;

    const user = api.getUser();

    if (user) {
        let dashboardLink = '/passenger/passenger-dashboard.html';
        if (user.role === 'DRIVER') {
            dashboardLink = '/driver/driver-dashboard.html';
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
                api.logout();
            });
        }
    } else {
        navUserContainer.innerHTML = `
            <a href="/index.html" class="btn btn-primary btn-sm">Sign In</a>
        `;
    }
}
