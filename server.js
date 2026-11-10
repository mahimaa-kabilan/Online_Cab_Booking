const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { parseAuthHeader } = require('./lib/auth');
const authController = require('./controllers/authController');
const rideController = require('./controllers/rideController');
const driverController = require('./controllers/driverController');
const profileController = require('./controllers/profileController');
const adminController = require('./controllers/adminController');
const superAdminController = require('./controllers/superAdminController');

const PORT = process.env.PORT || 5500;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 1e6) { // 1MB limit
                req.destroy();
                reject(new Error('Request payload too large'));
            }
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                resolve({});
            }
        });
        req.on('error', err => reject(err));
    });
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
                return res.end('<h1>404 Not Found</h1><p>The requested file does not exist.</p>');
            }
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('Server Error: ' + err.code);
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

let dbSetupDone = false;

const server = http.createServer(async (req, res) => {
    setCors(res);

    if (!dbSetupDone) {
        dbSetupDone = true;
        await ensureDatabaseSetup();
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${host}`);
    let pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();
    const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());

    // ==========================================
    // REST API Handling
    // ==========================================
    if (pathname.startsWith('/api/')) {
        let body = {};
        if (method === 'POST' || method === 'PUT') {
            try {
                body = await readBody(req);
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Invalid JSON payload' }));
            }
        }

        const user = parseAuthHeader(req);

        // --- PUBLIC AUTH ROUTES ---
        if (pathname === '/api/auth/register' && method === 'POST') {
            return authController.register(req, res, body);
        }
        if (pathname === '/api/auth/login' && method === 'POST') {
            return authController.login(req, res, body);
        }

        // --- PUBLIC RIDE / FARE ROUTES ---
        if (pathname === '/api/fare-rules' && method === 'GET') {
            return rideController.getFareRules(req, res);
        }
        if (pathname === '/api/service-areas' && method === 'GET') {
            return rideController.getServiceAreas(req, res);
        }
        if (pathname === '/api/rides/estimate' && method === 'POST') {
            return rideController.estimateFare(req, res, body);
        }
        if (pathname === '/api/rides/available-drivers' && method === 'GET') {
            return rideController.getAvailableDrivers(req, res);
        }

        // --- PROTECTED ROUTES (Require valid JWT Token) ---
        if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Unauthorized. Please login first.' }));
        }

        // --- Profile Routes ---
        if (pathname === '/api/auth/me' && method === 'GET') {
            return authController.getMe(req, res, user);
        }
        if (pathname === '/api/profile' && method === 'GET') {
            return profileController.getProfile(req, res, user);
        }
        if (pathname === '/api/profile' && method === 'PUT') {
            return profileController.updateProfile(req, res, user, body);
        }

        // --- Passenger Routes ---
        if (pathname === '/api/rides/book' && method === 'POST') {
            return rideController.bookRide(req, res, user, body);
        }
        if (pathname === '/api/rides/my-active' && method === 'GET') {
            return rideController.getMyActiveRide(req, res, user);
        }
        if (pathname === '/api/rides/cancel' && method === 'POST') {
            return rideController.cancelRide(req, res, user, body);
        }
        if (pathname === '/api/rides/history' && method === 'GET') {
            return rideController.getTripHistory(req, res, user);
        }
        if (pathname === '/api/rides/rate' && method === 'POST') {
            return rideController.submitRating(req, res, user, body);
        }

        // --- Driver Routes ---
        if (pathname === '/api/driver/status' && method === 'GET') {
            return driverController.getDriverStatus(req, res, user);
        }
        if (pathname === '/api/driver/toggle-availability' && method === 'POST') {
            return driverController.toggleAvailability(req, res, user, body);
        }
        if (pathname === '/api/driver/requests' && method === 'GET') {
            return driverController.getPendingRequests(req, res, user);
        }
        if (pathname === '/api/driver/accept-request' && method === 'POST') {
            return driverController.acceptRequest(req, res, user, body);
        }
        if (pathname === '/api/driver/reject-request' && method === 'POST') {
            return driverController.rejectRequest(req, res, user, body);
        }
        if (pathname === '/api/driver/active-trip' && method === 'GET') {
            return driverController.getDriverActiveTrip(req, res, user);
        }
        if (pathname === '/api/driver/start-trip' && method === 'POST') {
            return driverController.startTrip(req, res, user, body);
        }
        if (pathname === '/api/driver/complete-trip' && method === 'POST') {
            return driverController.completeTrip(req, res, user, body);
        }
        if (pathname === '/api/driver/earnings' && method === 'GET') {
            return driverController.getDriverHistoryAndEarnings(req, res, user);
        }

        // --- ADMIN API ROUTES ---
        if (pathname === '/api/admin/my-permissions' && method === 'GET') {
            return adminController.getMyPermissions(req, res, user);
        }
        if (pathname === '/api/admin/stats' && method === 'GET') {
            return adminController.getSystemStats(req, res, user);
        }
        if ((pathname === '/api/admin/users' || pathname === '/api/admin/passengers') && method === 'GET') {
            return adminController.getPassengers(req, res, user, queryParams);
        }
        if (pathname.startsWith('/api/admin/passengers/') && method === 'GET') {
            const passengerId = pathname.split('/')[4];
            return adminController.getPassengerDetails(req, res, user, passengerId);
        }
        if ((pathname === '/api/admin/toggle-status' && method === 'POST') ||
            (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/status') && (method === 'PUT' || method === 'POST'))) {
            const userId = pathname.startsWith('/api/admin/users/') ? pathname.split('/')[4] : (body.user_id || body.userId);
            return adminController.toggleUserStatus(req, res, user, { ...body, user_id: userId });
        }
        if (pathname === '/api/admin/drivers' && method === 'GET') {
            return adminController.getDrivers(req, res, user, queryParams);
        }
        if (pathname.startsWith('/api/admin/drivers/') && pathname.endsWith('/verification') && (method === 'PUT' || method === 'POST')) {
            const driverId = pathname.split('/')[4];
            return adminController.updateDriverVerification(req, res, user, { ...body, driver_id: driverId });
        }
        if (pathname === '/api/admin/drivers/verification' && method === 'POST') {
            return adminController.updateDriverVerification(req, res, user, body);
        }
        if (pathname.startsWith('/api/admin/drivers/') && method === 'GET') {
            const driverId = pathname.split('/')[4];
            return adminController.getDriverDetails(req, res, user, driverId);
        }
        if (pathname === '/api/admin/vehicles' && method === 'GET') {
            return adminController.getVehicles(req, res, user);
        }
        if (pathname === '/api/admin/vehicles' && method === 'POST') {
            return adminController.addVehicle(req, res, user, body);
        }
        if (pathname.startsWith('/api/admin/vehicles/') && method === 'PUT') {
            const vehicleId = pathname.split('/')[4];
            return adminController.updateVehicle(req, res, user, vehicleId, body);
        }
        if (pathname === '/api/admin/available-drivers-for-vehicle' && method === 'GET') {
            return adminController.getAvailableDriversForVehicle(req, res, user);
        }
        if (pathname === '/api/admin/trips' && method === 'GET') {
            return adminController.getTrips(req, res, user, queryParams);
        }
        if ((pathname === '/api/admin/trips/start' && method === 'POST') ||
            (pathname.startsWith('/api/admin/trips/') && pathname.endsWith('/start') && (method === 'PUT' || method === 'POST'))) {
            const tripId = pathname.startsWith('/api/admin/trips/') ? pathname.split('/')[4] : body.trip_id;
            return adminController.startTripAdmin(req, res, user, { ...body, trip_id: tripId });
        }
        if ((pathname === '/api/admin/trips/complete' && method === 'POST') ||
            (pathname.startsWith('/api/admin/trips/') && pathname.endsWith('/complete') && (method === 'PUT' || method === 'POST'))) {
            const tripId = pathname.startsWith('/api/admin/trips/') ? pathname.split('/')[4] : body.trip_id;
            return adminController.completeTripAdmin(req, res, user, { ...body, trip_id: tripId });
        }
        if ((pathname === '/api/admin/trips/cancel' && method === 'POST') ||
            (pathname.startsWith('/api/admin/trips/') && pathname.endsWith('/cancel') && (method === 'PUT' || method === 'POST'))) {
            const tripId = pathname.startsWith('/api/admin/trips/') ? pathname.split('/')[4] : body.trip_id;
            return adminController.cancelTripAdmin(req, res, user, { ...body, trip_id: tripId });
        }
        if (pathname === '/api/admin/service-areas' && method === 'GET') {
            return adminController.getServiceAreas(req, res, user);
        }
        if (pathname === '/api/admin/service-areas' && method === 'POST') {
            return adminController.addServiceArea(req, res, user, body);
        }
        if (pathname.startsWith('/api/admin/service-areas/') && pathname.endsWith('/status') && (method === 'PUT' || method === 'POST')) {
            const areaId = pathname.split('/')[4];
            const statusVal = body.status || (body.is_active !== undefined ? (body.is_active ? 'ACTIVE' : 'INACTIVE') : 'ACTIVE');
            return adminController.toggleServiceAreaStatus(req, res, user, { area_id: areaId, status: statusVal });
        }
        if (pathname.startsWith('/api/admin/service-areas/') && method === 'PUT') {
            const areaId = pathname.split('/')[4];
            return adminController.updateServiceArea(req, res, user, areaId, body);
        }
        if (pathname === '/api/admin/service-areas/toggle-status' && method === 'POST') {
            return adminController.toggleServiceAreaStatus(req, res, user, body);
        }
        if (pathname === '/api/admin/fare-rules' && method === 'GET') {
            return adminController.getFareRules(req, res, user);
        }
        if (pathname.startsWith('/api/admin/fare-rules/') && pathname.endsWith('/status') && (method === 'PUT' || method === 'POST')) {
            const fareId = pathname.split('/')[4];
            const statusVal = body.status || (body.is_active !== undefined ? (body.is_active ? 'ACTIVE' : 'INACTIVE') : 'ACTIVE');
            return adminController.toggleFareRuleStatus(req, res, user, { fare_id: fareId, status: statusVal });
        }
        if (pathname.startsWith('/api/admin/fare-rules/') && method === 'PUT') {
            const fareId = pathname.split('/')[4];
            return adminController.updateFareRule(req, res, user, fareId, body);
        }
        if (pathname === '/api/admin/fare-rules/toggle-status' && method === 'POST') {
            return adminController.toggleFareRuleStatus(req, res, user, body);
        }
        if (pathname === '/api/admin/reports' && method === 'GET') {
            return adminController.getReports(req, res, user, queryParams);
        }
        if (pathname === '/api/admin/activity' && method === 'GET') {
            return adminController.getSystemActivity(req, res, user);
        }

        // --- SUPER ADMIN API ROUTES ---
        if (pathname === '/api/superadmin/stats' && method === 'GET') {
            return superAdminController.getSuperAdminStats(req, res, user);
        }
        if (pathname === '/api/superadmin/admins' && method === 'GET') {
            return superAdminController.getAdmins(req, res, user, queryParams);
        }
        if (pathname === '/api/superadmin/admins' && method === 'POST') {
            return superAdminController.createAdmin(req, res, user, body);
        }
        if (pathname.startsWith('/api/superadmin/admins/') && pathname.endsWith('/status') && (method === 'PUT' || method === 'POST')) {
            const adminId = pathname.split('/')[4];
            return superAdminController.toggleAdminStatus(req, res, user, { ...body, admin_id: adminId });
        }
        if (pathname.startsWith('/api/superadmin/admins/') && pathname.endsWith('/permissions') && method === 'GET') {
            const adminId = pathname.split('/')[4];
            return superAdminController.getAdminPermissions(req, res, user, adminId);
        }
        if (pathname.startsWith('/api/superadmin/admins/') && pathname.endsWith('/permissions') && (method === 'PUT' || method === 'POST')) {
            const adminId = pathname.split('/')[4];
            return superAdminController.updateAdminPermissions(req, res, user, { ...body, admin_id: adminId });
        }
        if (pathname.startsWith('/api/superadmin/admins/') && method === 'PUT') {
            const adminId = pathname.split('/')[4];
            return superAdminController.updateAdmin(req, res, user, adminId, body);
        }
        if (pathname === '/api/superadmin/admins/status' && method === 'POST') {
            return superAdminController.toggleAdminStatus(req, res, user, body);
        }
        if (pathname.startsWith('/api/superadmin/admins/') && method === 'DELETE') {
            const adminId = pathname.split('/')[4];
            return superAdminController.deleteAdmin(req, res, user, adminId);
        }
        if (pathname.startsWith('/api/superadmin/permissions/') && method === 'GET') {
            const adminId = pathname.split('/')[4];
            return superAdminController.getAdminPermissions(req, res, user, adminId);
        }
        if (pathname === '/api/superadmin/permissions' && (method === 'POST' || method === 'PUT')) {
            return superAdminController.updateAdminPermissions(req, res, user, body);
        }
        if (pathname === '/api/superadmin/logs' && method === 'GET') {
            return superAdminController.getSystemLogs(req, res, user, queryParams);
        }
        if (pathname === '/api/superadmin/settings' && method === 'GET') {
            return superAdminController.getSystemSettings(req, res, user);
        }
        if (pathname === '/api/superadmin/settings' && (method === 'PUT' || method === 'POST')) {
            return superAdminController.updateSystemSettings(req, res, user, body);
        }

        // Unmatched API endpoint
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'API endpoint not found.' }));
    }

    // ==========================================
    // Static Files Handling
    // ==========================================
    if (pathname === '/' || pathname === '' || pathname === '/login.html' || pathname === '/register.html') {
        pathname = '/index.html';
    }

    // Resolve static file path cleanly
    let targetPath = path.join(PUBLIC_DIR, pathname);

    // If extension is omitted, default to .html
    if (!path.extname(targetPath)) {
        targetPath += '.html';
    }

    // If file doesn't exist directly at targetPath, check role subfolders
    if (!fs.existsSync(targetPath)) {
        const baseName = path.basename(targetPath);

        if (baseName === 'active-trip.html') {
            const referer = req.headers['referer'] || '';
            if (referer.includes('/driver')) {
                targetPath = path.join(PUBLIC_DIR, 'driver', 'active-trip.html');
            } else {
                targetPath = path.join(PUBLIC_DIR, 'passenger', 'active-trip.html');
            }
        } else {
            const passengerPath = path.join(PUBLIC_DIR, 'passenger', baseName);
            const driverPath = path.join(PUBLIC_DIR, 'driver', baseName);
            const adminPath = path.join(PUBLIC_DIR, 'admin', baseName);
            const superAdminPath = path.join(PUBLIC_DIR, 'superadmin', baseName);

            if (fs.existsSync(passengerPath)) {
                targetPath = passengerPath;
            } else if (fs.existsSync(driverPath)) {
                targetPath = driverPath;
            } else if (fs.existsSync(adminPath)) {
                targetPath = adminPath;
            } else if (fs.existsSync(superAdminPath)) {
                targetPath = superAdminPath;
            }
        }
    }

    serveStaticFile(res, targetPath);
});

server.listen(PORT, async () => {
    console.log(`====================================================`);
    console.log(` Online Cab Booking System Server Running!`);
    console.log(` Server URL: http://localhost:${PORT}`);
    console.log(` Environment: Node.js Built-in HTTP Server + MySQL`);
    console.log(`====================================================`);
    await ensureDatabaseSetup();
});

async function ensureDatabaseSetup() {
    try {
        const pool = require('./config/db');
        const { hashPassword } = require('./lib/auth');
        const { DEFAULT_ADMIN_PERMISSIONS } = require('./lib/permissions');

        try {
            await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('PASSENGER', 'DRIVER', 'ADMIN', 'SUPER ADMIN') NOT NULL");
        } catch (alterErr) {}

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

        const superHash = hashPassword('super123');
        const [superRows] = await pool.query("SELECT user_id FROM users WHERE email = 'superadmin@example.com'");
        if (superRows.length === 0) {
            await pool.query(
                "INSERT INTO users (name, email, password, mobile, role, status) VALUES ('Super Administrator', 'superadmin@example.com', ?, '9888888888', 'SUPER ADMIN', 'ACTIVE')",
                [superHash]
            );
            console.log('✓ Auto-provisioned Super Administrator: superadmin@example.com / super123');
        } else {
            await pool.query(
                "UPDATE users SET password = ?, role = 'SUPER ADMIN', status = 'ACTIVE' WHERE email = 'superadmin@example.com'",
                [superHash]
            );
        }

        const adminHash = hashPassword('admin123');
        const [adminRows] = await pool.query("SELECT user_id FROM users WHERE email = 'admin@example.com'");
        if (adminRows.length === 0) {
            const [newAdmin] = await pool.query(
                "INSERT INTO users (name, email, password, mobile, role, status) VALUES ('Admin User', 'admin@example.com', ?, '9999999999', 'ADMIN', 'ACTIVE')",
                [adminHash]
            );
            for (const perm of DEFAULT_ADMIN_PERMISSIONS) {
                await pool.query("INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)", [newAdmin.insertId, perm]);
            }
        } else {
            await pool.query("UPDATE users SET password = ?, role = 'ADMIN', status = 'ACTIVE' WHERE email = 'admin@example.com'", [adminHash]);
            const [allAdmins] = await pool.query("SELECT user_id FROM users WHERE role = 'ADMIN'");
            for (const admin of allAdmins) {
                for (const perm of DEFAULT_ADMIN_PERMISSIONS) {
                    const [existingPerm] = await pool.query(
                        "SELECT permission_id FROM admin_permissions WHERE admin_id = ? AND permission_name = ?",
                        [admin.user_id, perm]
                    );
                    if (existingPerm.length === 0) {
                        await pool.query("INSERT INTO admin_permissions (admin_id, permission_name) VALUES (?, ?)", [admin.user_id, perm]);
                    }
                }
            }
        }

        const defaultSettings = [
            ['app_name', 'CabGo Online Cab Booking', 'Platform Application Name'],
            ['support_email', 'support@cabgo.com', 'Customer Support Email Address'],
            ['support_phone', '+91 98765 43210', 'Helpline & Emergency Contact Phone'],
            ['surge_multiplier', '1.0', 'Peak Hour Surge Pricing Multiplier (1.0 = Standard)'],
            ['cancellation_time_limit_mins', '5', 'Free Passenger Cancellation Window (Minutes)'],
            ['max_active_bookings_per_passenger', '1', 'Maximum Concurrent Active Requests Allowed'],
            ['driver_commission_pct', '15', 'Platform Commission Deducted Per Completed Trip (%)']
        ];
        for (const [k, v, desc] of defaultSettings) {
            await pool.query(
                'INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
                [k, v, desc]
            );
        }
    } catch (err) {
        console.error('Database setup check warning:', err.message);
    }
}
