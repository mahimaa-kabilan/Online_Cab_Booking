/**
 * Admin Controller - Pure Node.js + MySQL
 * Handles System Analytics and User Oversight
 */
const db = require('../config/db');

const sendJSON = (res, statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

module.exports = {
    // GET /api/admin/stats
    async getSystemStats(req, res) {
        try {
            const [[{ totalPassengers }]] = await db.query(
                `SELECT COUNT(*) as totalPassengers FROM users WHERE role = 'PASSENGER'`
            );
            const [[{ totalDrivers }]] = await db.query(
                `SELECT COUNT(*) as totalDrivers FROM users WHERE role = 'DRIVER'`
            );
            const [[{ activeTrips }]] = await db.query(
                `SELECT COUNT(*) as activeTrips FROM trips WHERE trip_status IN ('CONFIRMED', 'STARTED')`
            );
            const [[{ totalRevenue }]] = await db.query(
                `SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM payments WHERE payment_status = 'PAID'`
            );

            sendJSON(res, 200, {
                success: true,
                stats: { totalPassengers, totalDrivers, activeTrips, totalRevenue }
            });
        } catch (err) {
            console.error(err);
            sendJSON(res, 500, { success: false, message: 'Database error fetching stats' });
        }
    },

    // GET /api/admin/users
    async getUsers(req, res) {
        try {
            const [users] = await db.query(`
                SELECT user_id, name, email, mobile, role, status, created_at 
                FROM users 
                ORDER BY created_at DESC
            `);
            sendJSON(res, 200, { success: true, users });
        } catch (err) {
            console.error(err);
            sendJSON(res, 500, { success: false, message: 'Database error fetching users' });
        }
    },

    // POST /api/admin/toggle-status
    async toggleUserStatus(req, res, body) {
        try {
            const { user_id, status } = body;
            if (!user_id || !status) {
                return sendJSON(res, 400, { success: false, message: 'Missing user_id or status' });
            }

            await db.query(`UPDATE users SET status = ? WHERE user_id = ?`, [status, user_id]);
            sendJSON(res, 200, { success: true, message: `User status updated to ${status}` });
        } catch (err) {
            console.error(err);
            sendJSON(res, 500, { success: false, message: 'Failed to update user status' });
        }
    }
};