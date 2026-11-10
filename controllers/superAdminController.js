/**
 * Super Admin Controller - Pure Node.js + MySQL
 * Implements master administrative oversight, admin management, RBAC permission assignment,
 * complete system audit logging, and global configuration.
 */
const db = require('../config/db');
const { hashPassword } = require('../lib/auth');

const sendJSON = (res, statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

// Guard function to ensure ONLY SUPER ADMIN can invoke these methods
function ensureSuperAdmin(user, res) {
    if (!user || user.role !== 'SUPER ADMIN') {
        sendJSON(res, 403, {
            success: false,
            message: 'Access Denied: Only Super Administrators have authority to access this operation.'
        });
        return false;
    }
    return true;
}

const ALL_SYSTEM_PERMISSIONS = [
    { key: 'manage_passengers', label: 'Manage Passengers', desc: 'Search, view details, and manage passenger accounts' },
    { key: 'manage_drivers', label: 'Manage Drivers', desc: 'Approve or reject verification, inspect ratings and duty status' },
    { key: 'manage_vehicles', label: 'Manage Vehicles', desc: 'Register, edit, and assign vehicles to drivers' },
    { key: 'manage_trips', label: 'Manage Trips', desc: 'Monitor ride requests, start or complete trips on administrative order' },
    { key: 'manage_fares', label: 'Manage Fares', desc: 'Configure base fares, per-km rates, and cancellation charges' },
    { key: 'manage_service_areas', label: 'Manage Service Areas', desc: 'Add, update, and activate operating service zones' },
    { key: 'view_reports', label: 'View Reports', desc: 'Access platform revenue, driver performance, and booking statistics' },
    { key: 'block_unblock_users', label: 'Block & Unblock Users', desc: 'Suspend or restore customer and driver accounts' },
    { key: 'view_system_logs', label: 'View System Logs', desc: 'Inspect recent user activity and security audit entries' },
    { key: 'manage_system_settings', label: 'Manage System Settings', desc: 'View and adjust platform operating parameters' }
];

module.exports = {
    // -------------------------------------------------------------
    // 1. SUPER ADMIN METRICS & DASHBOARD
    // -------------------------------------------------------------
    async getSuperAdminStats(req, res, user) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const [[{ totalAdmins }]] = await db.query(
                `SELECT COUNT(*) as totalAdmins FROM users WHERE role = 'ADMIN'`
            );
            const [[{ activeAdmins }]] = await db.query(
                `SELECT COUNT(*) as activeAdmins FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`
            );
            const [[{ inactiveAdmins }]] = await db.query(
                `SELECT COUNT(*) as inactiveAdmins FROM users WHERE role = 'ADMIN' AND status != 'ACTIVE'`
            );
            const [[{ totalPassengers }]] = await db.query(
                `SELECT COUNT(*) as totalPassengers FROM users WHERE role = 'PASSENGER'`
            );
            const [[{ totalDrivers }]] = await db.query(
                `SELECT COUNT(*) as totalDrivers FROM users WHERE role = 'DRIVER'`
            );
            const [[{ totalVehicles }]] = await db.query(
                `SELECT COUNT(*) as totalVehicles FROM vehicles`
            );
            const [[{ totalTrips }]] = await db.query(
                `SELECT COUNT(*) as totalTrips FROM trips`
            );
            const [[{ systemRevenue }]] = await db.query(
                `SELECT COALESCE(SUM(amount), 0) as systemRevenue FROM payments WHERE payment_status = 'PAID'`
            );

            // Recent 6 system activities
            const [recentLogs] = await db.query(`
                SELECT l.log_id, l.user_id, l.action, l.description, l.ip_address, l.created_at,
                       u.name AS user_name, u.role AS user_role
                FROM system_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.log_id DESC
                LIMIT 6
            `);

            sendJSON(res, 200, {
                success: true,
                stats: {
                    totalAdmins,
                    activeAdmins,
                    inactiveAdmins,
                    totalPassengers,
                    totalDrivers,
                    totalVehicles,
                    totalTrips,
                    systemRevenue
                },
                recentLogs
            });
        } catch (err) {
            console.error('Error in getSuperAdminStats:', err);
            sendJSON(res, 500, { success: false, message: 'Database error fetching super admin stats' });
        }
    },

    // -------------------------------------------------------------
    // 2. MANAGE ADMINISTRATOR ACCOUNTS
    // -------------------------------------------------------------
    async getAdmins(req, res, user, queryParams = {}) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const search = (queryParams.search || '').trim();
            let sql = `
                SELECT u.user_id, u.name, u.email, u.mobile, u.status, u.created_at,
                       (SELECT COUNT(*) FROM admin_permissions ap WHERE ap.admin_id = u.user_id) AS permissions_count
                FROM users u
                WHERE u.role = 'ADMIN'
            `;
            const params = [];

            if (search) {
                sql += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term);
            }

            sql += ` ORDER BY u.user_id DESC`;
            const [admins] = await db.query(sql, params);

            sendJSON(res, 200, { success: true, admins });
        } catch (err) {
            console.error('Error in getAdmins:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve administrators' });
        }
    },

    async createAdmin(req, res, user, body) {
        if (!ensureSuperAdmin(user, res)) return;

        const connection = await db.getConnection();
        try {
            const { name, email, password, mobile, permissions = [] } = body;
            if (!name || !email || !password || !mobile) {
                connection.release();
                return sendJSON(res, 400, { success: false, message: 'Name, email, password, and mobile number are required.' });
            }

            // Check if email already exists
            const [existing] = await connection.query(`SELECT user_id FROM users WHERE email = ?`, [email.trim()]);
            if (existing.length > 0) {
                connection.release();
                return sendJSON(res, 409, { success: false, message: 'An account with this email already exists.' });
            }

            await connection.beginTransaction();

            const hashedPassword = hashPassword(password);
            const [result] = await connection.query(`
                INSERT INTO users (name, email, password, mobile, role, status)
                VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE')
            `, [name.trim(), email.trim().toLowerCase(), hashedPassword, mobile.trim()]);

            const newAdminId = result.insertId;

            // Insert initial permissions
            if (Array.isArray(permissions) && permissions.length > 0) {
                for (const perm of permissions) {
                    await connection.query(`
                        INSERT INTO admin_permissions (admin_id, permission_name)
                        VALUES (?, ?)
                    `, [newAdminId, perm]);
                }
            }

            await connection.query(`
                INSERT INTO system_logs (user_id, action, description, ip_address)
                VALUES (?, ?, ?, ?)
            `, [user.user_id, 'SUPER_ADMIN_CREATE_ADMIN', `Created new Administrator "${name}" (${email}) with ${permissions.length} permissions`, req.socket.remoteAddress || '']);

            await connection.commit();
            connection.release();

            sendJSON(res, 201, {
                success: true,
                message: 'Administrator account created successfully!',
                admin_id: newAdminId
            });
        } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('Error in createAdmin:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to create administrator account' });
        }
    },

    async updateAdmin(req, res, user, adminId, body) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const { name, email, mobile, password } = body;
            if (!name || !email || !mobile) {
                return sendJSON(res, 400, { success: false, message: 'Name, email, and mobile are required.' });
            }

            // Verify admin exists
            const [target] = await db.query(`SELECT * FROM users WHERE user_id = ? AND role = 'ADMIN'`, [adminId]);
            if (target.length === 0) {
                return sendJSON(res, 404, { success: false, message: 'Administrator not found.' });
            }

            let sql = `UPDATE users SET name = ?, email = ?, mobile = ?`;
            const params = [name.trim(), email.trim().toLowerCase(), mobile.trim()];

            if (password && password.trim().length >= 6) {
                sql += `, password = ?`;
                params.push(hashPassword(password.trim()));
            }

            sql += ` WHERE user_id = ?`;
            params.push(adminId);

            await db.query(sql, params);

            await db.query(`
                INSERT INTO system_logs (user_id, action, description, ip_address)
                VALUES (?, ?, ?, ?)
            `, [user.user_id, 'SUPER_ADMIN_UPDATE_ADMIN', `Updated Administrator details for #${adminId} (${name})`, req.socket.remoteAddress || '']);

            sendJSON(res, 200, { success: true, message: 'Administrator details updated successfully' });
        } catch (err) {
            console.error('Error in updateAdmin:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to update administrator' });
        }
    },

    async toggleAdminStatus(req, res, user, body) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const { admin_id, status } = body;
            if (!admin_id || !['ACTIVE', 'INACTIVE', 'BLOCKED'].includes(status)) {
                return sendJSON(res, 400, { success: false, message: 'Valid admin_id and status required.' });
            }

            if (parseInt(admin_id, 10) === parseInt(user.user_id, 10)) {
                return sendJSON(res, 400, { success: false, message: 'Super Administrator cannot deactivate their own account.' });
            }

            const [result] = await db.query(
                `UPDATE users SET status = ? WHERE user_id = ? AND role = 'ADMIN'`,
                [status, admin_id]
            );

            if (result.affectedRows === 0) {
                return sendJSON(res, 404, { success: false, message: 'Administrator not found.' });
            }

            await db.query(`
                INSERT INTO system_logs (user_id, action, description, ip_address)
                VALUES (?, ?, ?, ?)
            `, [user.user_id, 'SUPER_ADMIN_TOGGLE_ADMIN_STATUS', `Set Admin #${admin_id} status to ${status}`, req.socket.remoteAddress || '']);

            sendJSON(res, 200, { success: true, message: `Administrator status set to ${status}` });
        } catch (err) {
            console.error('Error in toggleAdminStatus:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to change admin status' });
        }
    },

    async deleteAdmin(req, res, user, adminId) {
        if (!ensureSuperAdmin(user, res)) return;

        const connection = await db.getConnection();
        try {
            if (parseInt(adminId, 10) === parseInt(user.user_id, 10)) {
                connection.release();
                return sendJSON(res, 400, { success: false, message: 'You cannot delete your own Super Administrator account.' });
            }

            const [target] = await connection.query(`SELECT user_id, name, role FROM users WHERE user_id = ?`, [adminId]);
            if (target.length === 0 || target[0].role !== 'ADMIN') {
                connection.release();
                return sendJSON(res, 404, { success: false, message: 'Administrator not found or cannot be deleted.' });
            }

            await connection.beginTransaction();

            await connection.query(`DELETE FROM admin_permissions WHERE admin_id = ?`, [adminId]);
            await connection.query(`DELETE FROM users WHERE user_id = ?`, [adminId]);

            await connection.query(`
                INSERT INTO system_logs (user_id, action, description, ip_address)
                VALUES (?, ?, ?, ?)
            `, [user.user_id, 'SUPER_ADMIN_DELETE_ADMIN', `Permanently deleted Administrator #${adminId} (${target[0].name})`, req.socket.remoteAddress || '']);

            await connection.commit();
            connection.release();

            sendJSON(res, 200, { success: true, message: 'Administrator deleted successfully.' });
        } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('Error in deleteAdmin:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to delete administrator' });
        }
    },

    // -------------------------------------------------------------
    // 3. MANAGE ADMINISTRATOR PERMISSIONS (RBAC)
    // -------------------------------------------------------------
    async getAdminPermissions(req, res, user, adminId) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const [adminRows] = await db.query(
                `SELECT user_id, name, email, status FROM users WHERE user_id = ? AND role = 'ADMIN'`,
                [adminId]
            );

            if (adminRows.length === 0) {
                return sendJSON(res, 404, { success: false, message: 'Administrator account not found.' });
            }

            const [permRows] = await db.query(
                `SELECT permission_name FROM admin_permissions WHERE admin_id = ?`,
                [adminId]
            );
            const assignedPermissions = permRows.map(r => r.permission_name);

            sendJSON(res, 200, {
                success: true,
                admin: adminRows[0],
                assignedPermissions,
                permissions: assignedPermissions,
                allPermissions: ALL_SYSTEM_PERMISSIONS,
                allAvailablePermissions: ALL_SYSTEM_PERMISSIONS
            });
        } catch (err) {
            console.error('Error in getAdminPermissions:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to load administrator permissions' });
        }
    },

    async updateAdminPermissions(req, res, user, body) {
        if (!ensureSuperAdmin(user, res)) return;

        const connection = await db.getConnection();
        try {
            const { admin_id, permissions = [] } = body;
            if (!admin_id || !Array.isArray(permissions)) {
                connection.release();
                return sendJSON(res, 400, { success: false, message: 'Valid admin_id and permissions array are required.' });
            }

            const [target] = await connection.query(`SELECT user_id, name, role FROM users WHERE user_id = ?`, [admin_id]);
            if (target.length === 0 || target[0].role !== 'ADMIN') {
                connection.release();
                return sendJSON(res, 404, { success: false, message: 'Administrator not found.' });
            }

            await connection.beginTransaction();

            // Clear existing permissions
            await connection.query(`DELETE FROM admin_permissions WHERE admin_id = ?`, [admin_id]);

            // Insert new permissions
            for (const perm of permissions) {
                await connection.query(
                    `INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)`,
                    [admin_id, perm]
                );
            }

            await connection.query(`
                INSERT INTO system_logs (user_id, action, description, ip_address)
                VALUES (?, ?, ?, ?)
            `, [user.user_id, 'SUPER_ADMIN_UPDATE_PERMISSIONS', `Updated permissions for Admin #${admin_id} (${target[0].name}): ${permissions.length} active permissions`, req.socket.remoteAddress || '']);

            await connection.commit();
            connection.release();

            sendJSON(res, 200, {
                success: true,
                message: `Permissions updated successfully for ${target[0].name} (${permissions.length} granted).`
            });
        } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('Error in updateAdminPermissions:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to save admin permissions' });
        }
    },

    // -------------------------------------------------------------
    // 4. FULL SYSTEM LOGS AUDIT TRAIL
    // -------------------------------------------------------------
    async getSystemLogs(req, res, user, queryParams = {}) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const action = (queryParams.action || '').trim();
            const search = (queryParams.search || '').trim();
            const limit = parseInt(queryParams.limit, 10) || 100;

            let sql = `
                SELECT l.log_id, l.user_id, l.action, l.description, l.ip_address, l.created_at,
                       u.name AS user_name, u.role AS user_role, u.email AS user_email
                FROM system_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                WHERE 1=1
            `;
            const params = [];

            if (action) {
                sql += ` AND l.action = ?`;
                params.push(action);
            }

            if (search) {
                sql += ` AND (l.description LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR l.ip_address LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term, term);
            }

            sql += ` ORDER BY l.log_id DESC LIMIT ?`;
            params.push(limit);

            const [logs] = await db.query(sql, params);

            // Fetch distinct actions for filter dropdown
            const [actionRows] = await db.query(`SELECT DISTINCT action FROM system_logs ORDER BY action ASC`);
            const availableActions = actionRows.map(r => r.action);

            sendJSON(res, 200, { success: true, logs, availableActions });
        } catch (err) {
            console.error('Error in getSystemLogs:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to load system logs' });
        }
    },

    // -------------------------------------------------------------
    // 5. SYSTEM SETTINGS MANAGEMENT
    // -------------------------------------------------------------
    async getSystemSettings(req, res, user) {
        if (!ensureSuperAdmin(user, res)) return;

        try {
            const [settings] = await db.query(`SELECT * FROM system_settings ORDER BY setting_id ASC`);
            const dict = {};
            settings.forEach(s => { dict[s.setting_key] = s.setting_value; });
            sendJSON(res, 200, { success: true, settings: dict, settingsList: settings });
        } catch (err) {
            console.error('Error in getSystemSettings:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve system settings' });
        }
    },

    async updateSystemSettings(req, res, user, body) {
        if (!ensureSuperAdmin(user, res)) return;

        const connection = await db.getConnection();
        try {
            const settingsObj = body.settings || body;
            if (!settingsObj || typeof settingsObj !== 'object') {
                connection.release();
                return sendJSON(res, 400, { success: false, message: 'Valid settings object is required.' });
            }

            await connection.beginTransaction();

            for (const [key, val] of Object.entries(settingsObj)) {
                await connection.query(
                    `UPDATE system_settings SET setting_value = ? WHERE setting_key = ?`,
                    [String(val), key]
                );
            }

            await connection.query(`
                INSERT INTO system_logs (user_id, action, description, ip_address)
                VALUES (?, ?, ?, ?)
            `, [user.user_id, 'SUPER_ADMIN_UPDATE_SETTINGS', `Updated ${Object.keys(settingsObj).length} system configuration parameters`, req.socket.remoteAddress || '']);

            await connection.commit();
            connection.release();

            sendJSON(res, 200, { success: true, message: 'System configurations saved successfully!' });
        } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('Error in updateSystemSettings:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to save system settings' });
        }
    }
};
