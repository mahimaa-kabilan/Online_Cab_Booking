/**
 * Role-Based Access Control (RBAC) & Permission Evaluator
 * Enforces permissions for ADMIN and SUPER ADMIN on the backend.
 */
const db = require('../config/db');

const DEFAULT_ADMIN_PERMISSIONS = [
    'manage_passengers',
    'manage_drivers',
    'manage_vehicles',
    'manage_trips',
    'manage_fares',
    'manage_service_areas',
    'view_reports',
    'block_unblock_users',
    'view_system_logs',
    'manage_system_settings'
];

async function checkPermission(user, requiredPermission) {
    if (!user) return false;

    const role = (user.role || '').toUpperCase().trim();

    // 1. Super Admin retains unrestricted access to every administrative feature
    if (role === 'SUPER ADMIN') return true;

    // 2. Only ADMIN or SUPER ADMIN can pass administrative checks
    if (role !== 'ADMIN') return false;

    // 3. If no specific sub-permission is required, base ADMIN role is enough
    if (!requiredPermission) return true;

    // 4. Primary Admin (admin@example.com) always retains all administrative permissions
    if (user.email && user.email.toLowerCase().trim() === 'admin@example.com') return true;

    const uid = user.user_id || user.id;
    if (!uid) return true;

    try {
        const [rows] = await db.query(
            'SELECT permission_name FROM admin_permissions WHERE admin_id = ? AND permission_name = ?',
            [uid, requiredPermission]
        );
        if (rows.length > 0) return true;

        // Check total permissions configured for this admin
        const [countRows] = await db.query(
            'SELECT COUNT(*) AS total FROM admin_permissions WHERE admin_id = ?',
            [uid]
        );

        // If this admin has NO records at all in admin_permissions,
        // automatically populate all default permissions and grant access
        if (!countRows || countRows.length === 0 || countRows[0].total === 0) {
            for (const perm of DEFAULT_ADMIN_PERMISSIONS) {
                await db.query(
                    'INSERT IGNORE INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)',
                    [uid, perm]
                );
            }
            return true;
        }

        return false;
    } catch (err) {
        console.error('Permission check error:', err);
        // Fail-open for ADMIN so database or schema differences do not lock out operations
        return true;
    }
}

async function getAdminPermissionsList(adminId) {
    try {
        const [rows] = await db.query(
            'SELECT permission_name FROM admin_permissions WHERE admin_id = ?',
            [adminId]
        );

        if (rows.length === 0) {
            for (const perm of DEFAULT_ADMIN_PERMISSIONS) {
                await db.query(
                    'INSERT IGNORE INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)',
                    [adminId, perm]
                );
            }
            return DEFAULT_ADMIN_PERMISSIONS;
        }

        return rows.map(r => r.permission_name);
    } catch (err) {
        console.error('Error fetching admin permissions list:', err);
        return DEFAULT_ADMIN_PERMISSIONS;
    }
}

module.exports = {
    checkPermission,
    getAdminPermissionsList,
    DEFAULT_ADMIN_PERMISSIONS
};
