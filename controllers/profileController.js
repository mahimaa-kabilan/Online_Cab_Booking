const pool = require('../config/db');

async function getProfile(req, res, userPayload) {
    try {
        const userId = userPayload.user_id;
        const [users] = await pool.query(
            'SELECT user_id, name, email, mobile, role, status, created_at FROM users WHERE user_id = ?',
            [userId]
        );

        if (users.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'User not found.' }));
        }

        const user = users[0];
        let profileData = { ...user };

        if (user.role === 'PASSENGER') {
            const [p] = await pool.query('SELECT * FROM passenger_profiles WHERE user_id = ?', [userId]);
            if (p.length > 0) {
                profileData.passenger_id = p[0].passenger_id;
                profileData.default_address = p[0].default_address;
                profileData.emergency_contact = p[0].emergency_contact;
            }
        } else if (user.role === 'DRIVER') {
            const [d] = await pool.query(`
                SELECT d.*, v.vehicle_id, v.vehicle_number, v.vehicle_type, v.model, v.capacity
                FROM driver_profiles d
                LEFT JOIN vehicles v ON d.driver_id = v.driver_id
                WHERE d.user_id = ?
            `, [userId]);
            if (d.length > 0) {
                profileData = { ...profileData, ...d[0] };
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, profile: profileData }));
    } catch (err) {
        console.error('getProfile error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to retrieve profile.' }));
    }
}

async function updateProfile(req, res, userPayload, body) {
    try {
        const userId = userPayload.user_id;
        const { name, mobile, default_address, emergency_contact } = body;

        if (!name || !mobile) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Name and mobile number are required.' }));
        }

        await pool.query('UPDATE users SET name = ?, mobile = ? WHERE user_id = ?', [name, mobile, userId]);

        if (userPayload.role === 'PASSENGER') {
            await pool.query(
                'UPDATE passenger_profiles SET default_address = ?, emergency_contact = ? WHERE user_id = ?',
                [default_address || '', emergency_contact || '', userId]
            );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Profile updated successfully.' }));
    } catch (err) {
        console.error('updateProfile error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to update profile.' }));
    }
}

module.exports = {
    getProfile,
    updateProfile
};
