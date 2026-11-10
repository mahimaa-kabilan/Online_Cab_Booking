const pool = require('../config/db');
const { hashPassword, generateToken } = require('../lib/auth');

async function register(req, res, body) {
    try {
        const { name, email, password, mobile, role, default_address, emergency_contact, license_no, license_expiry, vehicle_number, vehicle_type, model, capacity } = body;

        if (!name || !email || !password || !mobile || !role) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'All required fields must be provided.' }));
        }

        const validRole = role.toUpperCase();
        if (validRole !== 'PASSENGER' && validRole !== 'DRIVER') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Invalid role. Must be PASSENGER or DRIVER.' }));
        }

        // Check if email already exists
        const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Email is already registered.' }));
        }

        const hashed = hashPassword(password);
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [userResult] = await connection.query(
                'INSERT INTO users (name, email, password, mobile, role, status) VALUES (?, ?, ?, ?, ?, ?)',
                [name, email, hashed, mobile, validRole, 'ACTIVE']
            );
            const userId = userResult.insertId;

            let specificId = null;

            if (validRole === 'PASSENGER') {
                const [pResult] = await connection.query(
                    'INSERT INTO passenger_profiles (user_id, default_address, emergency_contact) VALUES (?, ?, ?)',
                    [userId, default_address || '', emergency_contact || '']
                );
                specificId = pResult.insertId;
            } else if (validRole === 'DRIVER') {
                const [dResult] = await connection.query(
                    'INSERT INTO driver_profiles (user_id, license_no, license_expiry, verification_status, rating, is_available) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, license_no || 'PENDING-LIC', license_expiry || '2030-01-01', 'APPROVED', 5.00, true]
                );
                specificId = dResult.insertId;

                // Create vehicle record
                await connection.query(
                    'INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [specificId, vehicle_number || `CAB-${userId}-${Date.now().toString().slice(-4)}`, vehicle_type || 'SEDAN', model || 'Standard Sedan', capacity || 4, 'ACTIVE']
                );
            }

            // Log activity
            await connection.query(
                'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
                [userId, 'USER_REGISTER', `New ${validRole} account registered: ${email}`, req.socket.remoteAddress || '']
            );

            await connection.commit();

            const token = generateToken({
                user_id: userId,
                role: validRole,
                email,
                name,
                passenger_id: validRole === 'PASSENGER' ? specificId : null,
                driver_id: validRole === 'DRIVER' ? specificId : null
            });

            res.writeHead(201, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: true,
                message: 'Registration successful!',
                token,
                user: {
                    user_id: userId,
                    name,
                    email,
                    mobile,
                    role: validRole,
                    passenger_id: validRole === 'PASSENGER' ? specificId : null,
                    driver_id: validRole === 'DRIVER' ? specificId : null
                }
            }));
        } catch (dbErr) {
            await connection.rollback();
            throw dbErr;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error('Register error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Server error during registration.' }));
    }
}

async function login(req, res, body) {
    try {
        const { email, password } = body;
        if (!email || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Email and password are required.' }));
        }

        const cleanEmail = email.toLowerCase().trim();
        const hashed = hashPassword(password);

        // 1. Ensure `users` role enum supports 'SUPER ADMIN'
        try {
            await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('PASSENGER', 'DRIVER', 'ADMIN', 'SUPER ADMIN') NOT NULL");
        } catch (alterErr) {}

        // 2. Ensure admin_permissions and system_settings tables exist
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS admin_permissions (
                    permission_id INT AUTO_INCREMENT PRIMARY KEY,
                    admin_id INT NOT NULL,
                    permission_name VARCHAR(100) NOT NULL,
                    FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
                )
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    setting_id INT AUTO_INCREMENT PRIMARY KEY,
                    setting_key VARCHAR(100) UNIQUE NOT NULL,
                    setting_value TEXT NOT NULL,
                    description VARCHAR(255),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
        } catch (tableErr) {}

        // 3. Auto-sync demo Admin account if requested
        if (cleanEmail === 'admin@example.com' && password === 'admin123') {
            const [checkAdmin] = await pool.query('SELECT user_id FROM users WHERE email = ?', [cleanEmail]);
            if (checkAdmin.length === 0) {
                await pool.query(
                    "INSERT INTO users (name, email, password, mobile, role, status) VALUES ('Admin User', 'admin@example.com', ?, '9999999999', 'ADMIN', 'ACTIVE')",
                    [hashed]
                );
            } else {
                await pool.query(
                    "UPDATE users SET password = ?, role = 'ADMIN', status = 'ACTIVE' WHERE email = 'admin@example.com'",
                    [hashed]
                );
            }
        }

        // 4. Auto-sync demo Super Admin account if requested
        if (cleanEmail === 'superadmin@example.com' && password === 'super123') {
            const [checkSuper] = await pool.query('SELECT user_id FROM users WHERE email = ?', [cleanEmail]);
            if (checkSuper.length === 0) {
                await pool.query(
                    "INSERT INTO users (name, email, password, mobile, role, status) VALUES ('Super Administrator', 'superadmin@example.com', ?, '9888888888', 'SUPER ADMIN', 'ACTIVE')",
                    [hashed]
                );
            } else {
                await pool.query(
                    "UPDATE users SET password = ?, role = 'SUPER ADMIN', status = 'ACTIVE' WHERE email = 'superadmin@example.com'",
                    [hashed]
                );
            }
        }

        let [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
        if (rows.length === 0) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Invalid email or password.' }));
        }

        const user = rows[0];
        if (user.password !== hashed) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Invalid email or password.' }));
        }

        if (user.status === 'BLOCKED') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Your account has been blocked. Please contact support.' }));
        }

        // Auto-seed permissions for Admin on login
        if (user.role === 'ADMIN') {
            try {
                const { DEFAULT_ADMIN_PERMISSIONS } = require('../lib/permissions');
                for (const perm of DEFAULT_ADMIN_PERMISSIONS) {
                    const [existingPerm] = await pool.query(
                        'SELECT permission_id FROM admin_permissions WHERE admin_id = ? AND permission_name = ?',
                        [user.user_id, perm]
                    );
                    if (existingPerm.length === 0) {
                        await pool.query(
                            'INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)',
                            [user.user_id, perm]
                        );
                    }
                }
            } catch (pErr) {
                console.error('Error auto-seeding admin permissions on login:', pErr);
            }
        }

        let passenger_id = null;
        let driver_id = null;

        if (user.role === 'PASSENGER') {
            const [p] = await pool.query('SELECT passenger_id FROM passenger_profiles WHERE user_id = ?', [user.user_id]);
            if (p.length > 0) passenger_id = p[0].passenger_id;
        } else if (user.role === 'DRIVER') {
            const [d] = await pool.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [user.user_id]);
            if (d.length > 0) driver_id = d[0].driver_id;
        }

        const token = generateToken({
            user_id: user.user_id,
            role: user.role,
            email: user.email,
            name: user.name,
            passenger_id,
            driver_id
        });

        // Log activity
        await pool.query(
            'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [user.user_id, 'USER_LOGIN', `User ${user.email} logged in.`, req.socket.remoteAddress || '']
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            message: 'Login successful!',
            token,
            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                status: user.status,
                passenger_id,
                driver_id
            }
        }));
    } catch (err) {
        console.error('Login error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Server error during login.' }));
    }
}

async function getMe(req, res, userPayload) {
    try {
        const [users] = await pool.query('SELECT user_id, name, email, mobile, role, status, created_at FROM users WHERE user_id = ?', [userPayload.user_id]);
        if (users.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'User not found.' }));
        }

        const user = users[0];
        let extra = {};

        if (user.role === 'PASSENGER') {
            const [p] = await pool.query('SELECT * FROM passenger_profiles WHERE user_id = ?', [user.user_id]);
            if (p.length > 0) extra = { passenger: p[0] };
        } else if (user.role === 'DRIVER') {
            const [d] = await pool.query(`
                SELECT d.*, v.vehicle_id, v.vehicle_number, v.vehicle_type, v.model, v.capacity
                FROM driver_profiles d
                LEFT JOIN vehicles v ON d.driver_id = v.driver_id
                WHERE d.user_id = ?
            `, [user.user_id]);
            if (d.length > 0) extra = { driver: d[0] };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            user: { ...user, ...extra }
        }));
    } catch (err) {
        console.error('getMe error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Server error fetching user.' }));
    }
}

module.exports = {
    register,
    login,
    getMe
};
