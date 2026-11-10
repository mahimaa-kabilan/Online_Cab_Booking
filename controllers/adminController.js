/**
 * Admin Controller - Pure Node.js + MySQL
 * Implements complete administrative functionalities with RBAC permission enforcement.
 */
const db = require('../config/db');
const { checkPermission, getAdminPermissionsList } = require('../lib/permissions');

const sendJSON = (res, statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

module.exports = {
    // -------------------------------------------------------------
    // 0. ADMIN PERMISSIONS FOR CURRENT SESSION
    // -------------------------------------------------------------
    async getMyPermissions(req, res, user) {
        try {
            if (user.role === 'SUPER ADMIN') {
                return sendJSON(res, 200, {
                    success: true,
                    isSuperAdmin: true,
                    permissions: [
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
                    ]
                });
            }

            const permissions = await getAdminPermissionsList(user.user_id);
            sendJSON(res, 200, {
                success: true,
                isSuperAdmin: false,
                permissions
            });
        } catch (err) {
            console.error('Error in getMyPermissions:', err);
            sendJSON(res, 500, { success: false, message: 'Server error retrieving permissions' });
        }
    },

    // -------------------------------------------------------------
    // 1. DASHBOARD & SYSTEM STATS
    // -------------------------------------------------------------
    async getSystemStats(req, res, user) {
        try {
            const [[{ totalPassengers }]] = await db.query(
                `SELECT COUNT(*) as totalPassengers FROM users WHERE role = 'PASSENGER'`
            );
            const [[{ totalDrivers }]] = await db.query(
                `SELECT COUNT(*) as totalDrivers FROM users WHERE role = 'DRIVER'`
            );
            const [[{ totalVehicles }]] = await db.query(
                `SELECT COUNT(*) as totalVehicles FROM vehicles`
            );
            const [[{ totalRides }]] = await db.query(
                `SELECT COUNT(*) as totalRides FROM trips`
            );
            const [[{ activeRides }]] = await db.query(
                `SELECT COUNT(*) as activeRides FROM trips WHERE trip_status IN ('CONFIRMED', 'STARTED')`
            );
            const [[{ completedRides }]] = await db.query(
                `SELECT COUNT(*) as completedRides FROM trips WHERE trip_status = 'COMPLETED'`
            );
            const [[{ cancelledRides }]] = await db.query(
                `SELECT COUNT(*) as cancelledRides FROM trips WHERE trip_status = 'CANCELLED'`
            );
            const [[{ totalRevenue }]] = await db.query(
                `SELECT COALESCE(SUM(amount), 0) as totalRevenue FROM payments WHERE payment_status = 'PAID'`
            );

            // Recent 5 trips
            const [recentTrips] = await db.query(`
                SELECT t.trip_id, t.fare, t.trip_status, t.start_time,
                       pu.name as passenger_name, du.name as driver_name,
                       r.pickup_location, r.destination, r.vehicle_type
                FROM trips t
                JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                JOIN users pu ON pp.user_id = pu.user_id
                JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                JOIN users du ON dp.user_id = du.user_id
                JOIN ride_requests r ON t.request_id = r.request_id
                ORDER BY t.trip_id DESC
                LIMIT 5
            `);

            sendJSON(res, 200, {
                success: true,
                stats: {
                    totalPassengers,
                    totalDrivers,
                    totalVehicles,
                    totalRides,
                    activeRides,
                    completedRides,
                    cancelledRides,
                    totalRevenue
                },
                recentTrips
            });
        } catch (err) {
            console.error('Error fetching admin stats:', err);
            sendJSON(res, 500, { success: false, message: 'Database error fetching stats' });
        }
    },

    // -------------------------------------------------------------
    // 2. MANAGE PASSENGERS
    // -------------------------------------------------------------
    async getPassengers(req, res, user, queryParams = {}) {
        try {
            if (!(await checkPermission(user, 'manage_passengers'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_passengers" permission.' });
            }

            const search = (queryParams.search || '').trim();
            let sql = `
                SELECT u.user_id, u.name, u.email, u.mobile, u.status, u.created_at,
                       p.passenger_id, p.default_address, p.emergency_contact,
                       (SELECT COUNT(*) FROM trips t WHERE t.passenger_id = p.passenger_id) AS total_trips,
                       (SELECT COALESCE(SUM(fare), 0) FROM trips t WHERE t.passenger_id = p.passenger_id AND t.trip_status = 'COMPLETED') AS total_spent
                FROM users u
                JOIN passenger_profiles p ON u.user_id = p.user_id
                WHERE u.role = 'PASSENGER'
            `;
            const params = [];

            if (search) {
                sql += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term);
            }

            sql += ` ORDER BY u.user_id DESC`;
            const [passengers] = await db.query(sql, params);
            sendJSON(res, 200, { success: true, passengers });
        } catch (err) {
            console.error('Error in getPassengers:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve passengers' });
        }
    },

    async getPassengerDetails(req, res, user, userId) {
        try {
            if (!(await checkPermission(user, 'manage_passengers'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_passengers" permission.' });
            }

            const [rows] = await db.query(`
                SELECT u.user_id, u.name, u.email, u.mobile, u.status, u.created_at,
                       p.passenger_id, p.default_address, p.emergency_contact
                FROM users u
                JOIN passenger_profiles p ON u.user_id = p.user_id
                WHERE u.user_id = ?
            `, [userId]);

            if (rows.length === 0) {
                return sendJSON(res, 404, { success: false, message: 'Passenger not found.' });
            }

            const passenger = rows[0];

            // Fetch ride history
            const [trips] = await db.query(`
                SELECT t.trip_id, t.start_time, t.end_time, t.distance_km, t.fare, t.trip_status,
                       r.pickup_location, r.destination, r.vehicle_type,
                       du.name AS driver_name, v.vehicle_number
                FROM trips t
                JOIN ride_requests r ON t.request_id = r.request_id
                JOIN driver_profiles d ON t.driver_id = d.driver_id
                JOIN users du ON d.user_id = du.user_id
                LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                WHERE t.passenger_id = ?
                ORDER BY t.trip_id DESC
            `, [passenger.passenger_id]);

            sendJSON(res, 200, { success: true, passenger, trips });
        } catch (err) {
            console.error('Error in getPassengerDetails:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to load passenger details' });
        }
    },

    // -------------------------------------------------------------
    // 3. MANAGE DRIVERS
    // -------------------------------------------------------------
    async getDrivers(req, res, user, queryParams = {}) {
        try {
            if (!(await checkPermission(user, 'manage_drivers'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_drivers" permission.' });
            }

            const search = (queryParams.search || '').trim();
            const verification = (queryParams.verification || '').trim();
            let sql = `
                SELECT u.user_id, u.name, u.email, u.mobile, u.status, u.created_at,
                       d.driver_id, d.license_no, d.license_expiry, d.verification_status, d.rating, d.is_available,
                       v.vehicle_id, v.vehicle_number, v.vehicle_type, v.model,
                       (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.driver_id AND t.trip_status = 'COMPLETED') AS completed_trips
                FROM users u
                JOIN driver_profiles d ON u.user_id = d.user_id
                LEFT JOIN vehicles v ON d.driver_id = v.driver_id
                WHERE u.role = 'DRIVER'
            `;
            const params = [];

            if (search) {
                sql += ` AND (u.name LIKE ? OR u.email LIKE ? OR d.license_no LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term);
            }

            if (verification) {
                sql += ` AND d.verification_status = ?`;
                params.push(verification);
            }

            sql += ` ORDER BY u.user_id DESC`;
            const [drivers] = await db.query(sql, params);
            sendJSON(res, 200, { success: true, drivers });
        } catch (err) {
            console.error('Error in getDrivers:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve drivers' });
        }
    },

    async getDriverDetails(req, res, user, userId) {
        try {
            if (!(await checkPermission(user, 'manage_drivers'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_drivers" permission.' });
            }

            const [rows] = await db.query(`
                SELECT u.user_id, u.name, u.email, u.mobile, u.status, u.created_at,
                       d.driver_id, d.license_no, d.license_expiry, d.verification_status, d.rating, d.is_available,
                       v.vehicle_id, v.vehicle_number, v.vehicle_type, v.model, v.capacity, v.status AS vehicle_status
                FROM users u
                JOIN driver_profiles d ON u.user_id = d.user_id
                LEFT JOIN vehicles v ON d.driver_id = v.driver_id
                WHERE u.user_id = ?
            `, [userId]);

            if (rows.length === 0) {
                return sendJSON(res, 404, { success: false, message: 'Driver not found.' });
            }

            const driver = rows[0];

            // Trip history for driver
            const [trips] = await db.query(`
                SELECT t.trip_id, t.start_time, t.end_time, t.distance_km, t.fare, t.trip_status,
                       r.pickup_location, r.destination, r.vehicle_type,
                       pu.name AS passenger_name,
                       rr.rating AS review_rating, rr.comment AS review_comment
                FROM trips t
                JOIN ride_requests r ON t.request_id = r.request_id
                JOIN passenger_profiles p ON t.passenger_id = p.passenger_id
                JOIN users pu ON p.user_id = pu.user_id
                LEFT JOIN ratings_reviews rr ON t.trip_id = rr.trip_id
                WHERE t.driver_id = ?
                ORDER BY t.trip_id DESC
            `, [driver.driver_id]);

            sendJSON(res, 200, { success: true, driver, trips });
        } catch (err) {
            console.error('Error in getDriverDetails:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to load driver details' });
        }
    },

    async updateDriverVerification(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'manage_drivers'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_drivers" permission.' });
            }

            const { driver_id, verification_status } = body;
            if (!driver_id || !['PENDING', 'APPROVED', 'REJECTED'].includes(verification_status)) {
                return sendJSON(res, 400, { success: false, message: 'Invalid driver_id or verification_status' });
            }

            await db.query(
                `UPDATE driver_profiles SET verification_status = ? WHERE driver_id = ?`,
                [verification_status, driver_id]
            );

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'DRIVER_VERIFICATION_UPDATE', `Driver #${driver_id} verification set to ${verification_status}`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 200, { success: true, message: `Driver verification set to ${verification_status}` });
        } catch (err) {
            console.error('Error in updateDriverVerification:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to update verification status' });
        }
    },

    // -------------------------------------------------------------
    // 4. BLOCK / UNBLOCK USERS (PASSENGERS & DRIVERS)
    // -------------------------------------------------------------
    async toggleUserStatus(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'block_unblock_users'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "block_unblock_users" permission.' });
            }

            const { user_id, status } = body;
            if (!user_id || !['ACTIVE', 'BLOCKED', 'INACTIVE'].includes(status)) {
                return sendJSON(res, 400, { success: false, message: 'Valid user_id and status (ACTIVE/BLOCKED/INACTIVE) required.' });
            }

            // Guard: Regular Admin cannot block an Admin or Super Admin
            const [target] = await db.query(`SELECT role, name FROM users WHERE user_id = ?`, [user_id]);
            if (target.length === 0) {
                return sendJSON(res, 404, { success: false, message: 'Target user not found.' });
            }

            if ((target[0].role === 'ADMIN' || target[0].role === 'SUPER ADMIN') && user.role !== 'SUPER ADMIN') {
                return sendJSON(res, 403, { success: false, message: 'Admin accounts can only be modified by Super Admin.' });
            }

            await db.query(`UPDATE users SET status = ? WHERE user_id = ?`, [status, user_id]);

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'USER_STATUS_CHANGE', `Changed user #${user_id} (${target[0].name}) status to ${status}`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 200, { success: true, message: `User status updated to ${status}` });
        } catch (err) {
            console.error('Error in toggleUserStatus:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to update user status' });
        }
    },

    // -------------------------------------------------------------
    // 5. MANAGE VEHICLES
    // -------------------------------------------------------------
    async getVehicles(req, res, user) {
        try {
            if (!(await checkPermission(user, 'manage_vehicles'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_vehicles" permission.' });
            }

            const [vehicles] = await db.query(`
                SELECT v.vehicle_id, v.driver_id, v.vehicle_number, v.vehicle_type, v.model, v.capacity, v.status,
                       u.name AS driver_name, u.mobile AS driver_mobile, d.license_no, d.verification_status
                FROM vehicles v
                JOIN driver_profiles d ON v.driver_id = d.driver_id
                JOIN users u ON d.user_id = u.user_id
                ORDER BY v.vehicle_id DESC
            `);

            sendJSON(res, 200, { success: true, vehicles });
        } catch (err) {
            console.error('Error in getVehicles:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve vehicles' });
        }
    },

    async getAvailableDriversForVehicle(req, res, user) {
        try {
            if (!(await checkPermission(user, 'manage_vehicles'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied.' });
            }

            const [drivers] = await db.query(`
                SELECT d.driver_id, u.name, d.license_no, d.verification_status
                FROM driver_profiles d
                JOIN users u ON d.user_id = u.user_id
                WHERE u.status = 'ACTIVE'
                ORDER BY u.name ASC
            `);

            sendJSON(res, 200, { success: true, drivers });
        } catch (err) {
            console.error('Error in getAvailableDriversForVehicle:', err);
            sendJSON(res, 500, { success: false, message: 'Database error' });
        }
    },

    async addVehicle(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'manage_vehicles'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_vehicles" permission.' });
            }

            const { driver_id, vehicle_number, vehicle_type, model, capacity } = body;
            if (!driver_id || !vehicle_number || !vehicle_type || !model) {
                return sendJSON(res, 400, { success: false, message: 'All required vehicle fields must be provided.' });
            }

            // Check duplicate plate
            const [existing] = await db.query(`SELECT vehicle_id FROM vehicles WHERE vehicle_number = ?`, [vehicle_number]);
            if (existing.length > 0) {
                return sendJSON(res, 409, { success: false, message: 'Vehicle with this plate number already exists.' });
            }

            const [result] = await db.query(`
                INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE')
            `, [driver_id, vehicle_number, vehicle_type, model, parseInt(capacity, 10) || 4]);

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'VEHICLE_ADD', `Added vehicle ${vehicle_number} (${model}) for driver #${driver_id}`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 201, { success: true, message: 'Vehicle added successfully', vehicle_id: result.insertId });
        } catch (err) {
            console.error('Error in addVehicle:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to add vehicle' });
        }
    },

    async updateVehicle(req, res, user, vehicleId, body) {
        try {
            if (!(await checkPermission(user, 'manage_vehicles'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_vehicles" permission.' });
            }

            const { vehicle_number, vehicle_type, model, capacity, status } = body;
            if (!vehicle_number || !vehicle_type || !model) {
                return sendJSON(res, 400, { success: false, message: 'Vehicle number, category, and model are required.' });
            }

            await db.query(`
                UPDATE vehicles 
                SET vehicle_number = ?, vehicle_type = ?, model = ?, capacity = ?, status = ?
                WHERE vehicle_id = ?
            `, [vehicle_number, vehicle_type, model, parseInt(capacity, 10) || 4, status || 'ACTIVE', vehicleId]);

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'VEHICLE_UPDATE', `Updated vehicle #${vehicleId} (${vehicle_number})`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 200, { success: true, message: 'Vehicle updated successfully' });
        } catch (err) {
            console.error('Error in updateVehicle:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to update vehicle' });
        }
    },

    // -------------------------------------------------------------
    // 6. MANAGE TRIPS & RIDE REQUESTS
    // -------------------------------------------------------------
    async getTrips(req, res, user, queryParams = {}) {
        try {
            if (!(await checkPermission(user, 'manage_trips'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_trips" permission.' });
            }

            const status = (queryParams.status || '').trim();
            const search = (queryParams.search || '').trim();

            let sql = `
                SELECT t.trip_id, t.request_id, t.passenger_id, t.driver_id, t.vehicle_id,
                       t.start_time, t.end_time, t.distance_km, t.fare, t.trip_status,
                       r.pickup_location, r.destination, r.vehicle_type, r.requested_at,
                       pu.name AS passenger_name, pu.mobile AS passenger_mobile,
                       du.name AS driver_name, du.mobile AS driver_mobile,
                       v.vehicle_number, v.model AS vehicle_model,
                       p.payment_method, p.payment_status
                FROM trips t
                JOIN ride_requests r ON t.request_id = r.request_id
                JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
                JOIN users pu ON pp.user_id = pu.user_id
                JOIN driver_profiles dp ON t.driver_id = dp.driver_id
                JOIN users du ON dp.user_id = du.user_id
                LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id
                LEFT JOIN payments p ON t.trip_id = p.trip_id
                WHERE 1=1
            `;
            const params = [];

            if (status && status !== 'ALL') {
                sql += ` AND t.trip_status = ?`;
                params.push(status);
            }

            if (search) {
                sql += ` AND (pu.name LIKE ? OR du.name LIKE ? OR r.pickup_location LIKE ? OR r.destination LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term, term);
            }

            sql += ` ORDER BY t.trip_id DESC`;
            const [trips] = await db.query(sql, params);

            // Also retrieve pending ride requests that are not yet trips
            const [pendingRequests] = await db.query(`
                SELECT r.request_id, r.passenger_id, r.pickup_location, r.destination,
                       r.vehicle_type, r.distance_km, r.estimated_fare AS fare, r.status AS trip_status, r.requested_at,
                       pu.name AS passenger_name, pu.mobile AS passenger_mobile
                FROM ride_requests r
                JOIN passenger_profiles pp ON r.passenger_id = pp.passenger_id
                JOIN users pu ON pp.user_id = pu.user_id
                WHERE r.status = 'PENDING'
                ORDER BY r.request_id DESC
            `);

            sendJSON(res, 200, { success: true, trips, pendingRequests });
        } catch (err) {
            console.error('Error in getTrips:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve trips' });
        }
    },

    async startTripAdmin(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'manage_trips'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_trips" permission.' });
            }

            const { trip_id } = body;
            const [trips] = await db.query(`SELECT * FROM trips WHERE trip_id = ?`, [trip_id]);
            if (trips.length === 0) {
                return sendJSON(res, 404, { success: false, message: 'Trip not found.' });
            }

            if (trips[0].trip_status !== 'CONFIRMED') {
                return sendJSON(res, 400, { success: false, message: `Cannot start trip in ${trips[0].trip_status} state.` });
            }

            await db.query(`UPDATE trips SET trip_status = 'STARTED', start_time = NOW() WHERE trip_id = ?`, [trip_id]);

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'ADMIN_START_TRIP', `Admin started Trip #${trip_id}`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 200, { success: true, message: 'Trip successfully started by Administrator.' });
        } catch (err) {
            console.error('Error in startTripAdmin:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to start trip' });
        }
    },

    async completeTripAdmin(req, res, user, body) {
        const connection = await db.getConnection();
        try {
            if (!(await checkPermission(user, 'manage_trips'))) {
                connection.release();
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_trips" permission.' });
            }

            const { trip_id, payment_method } = body;
            const [trips] = await connection.query(`SELECT * FROM trips WHERE trip_id = ?`, [trip_id]);
            if (trips.length === 0) {
                connection.release();
                return sendJSON(res, 404, { success: false, message: 'Trip not found.' });
            }

            const trip = trips[0];
            if (trip.trip_status === 'COMPLETED' || trip.trip_status === 'CANCELLED') {
                connection.release();
                return sendJSON(res, 400, { success: false, message: `Trip is already ${trip.trip_status}.` });
            }

            await connection.beginTransaction();

            await connection.query(`UPDATE trips SET trip_status = 'COMPLETED', end_time = NOW() WHERE trip_id = ?`, [trip_id]);
            await connection.query(`UPDATE ride_requests SET status = 'COMPLETED' WHERE request_id = ?`, [trip.request_id]);

            // Create or update payment
            await connection.query(`
                INSERT INTO payments (trip_id, passenger_id, amount, payment_method, payment_status, paid_at)
                VALUES (?, ?, ?, ?, 'PAID', NOW())
                ON DUPLICATE KEY UPDATE payment_status = 'PAID', paid_at = NOW()
            `, [trip_id, trip.passenger_id, trip.fare, payment_method || 'CASH']);

            // Free driver
            await connection.query(`UPDATE driver_profiles SET is_available = TRUE WHERE driver_id = ?`, [trip.driver_id]);

            await connection.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'ADMIN_COMPLETE_TRIP', `Admin completed Trip #${trip_id}`, req.socket.remoteAddress || '']
            );

            await connection.commit();
            connection.release();

            sendJSON(res, 200, { success: true, message: 'Trip completed and payment settled successfully.' });
        } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('Error in completeTripAdmin:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to complete trip' });
        }
    },

    async cancelTripAdmin(req, res, user, body) {
        const connection = await db.getConnection();
        try {
            if (!(await checkPermission(user, 'manage_trips'))) {
                connection.release();
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_trips" permission.' });
            }

            const { trip_id } = body;
            const [trips] = await connection.query(`SELECT * FROM trips WHERE trip_id = ?`, [trip_id]);
            if (trips.length === 0) {
                connection.release();
                return sendJSON(res, 404, { success: false, message: 'Trip not found.' });
            }

            const trip = trips[0];
            await connection.beginTransaction();

            await connection.query(`UPDATE trips SET trip_status = 'CANCELLED' WHERE trip_id = ?`, [trip_id]);
            await connection.query(`UPDATE ride_requests SET status = 'CANCELLED' WHERE request_id = ?`, [trip.request_id]);
            await connection.query(`UPDATE driver_profiles SET is_available = TRUE WHERE driver_id = ?`, [trip.driver_id]);

            await connection.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'ADMIN_CANCEL_TRIP', `Admin cancelled Trip #${trip_id}`, req.socket.remoteAddress || '']
            );

            await connection.commit();
            connection.release();

            sendJSON(res, 200, { success: true, message: 'Trip successfully cancelled by Administrator.' });
        } catch (err) {
            await connection.rollback();
            connection.release();
            console.error('Error in cancelTripAdmin:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to cancel trip' });
        }
    },

    // -------------------------------------------------------------
    // 7. MANAGE SERVICE AREAS
    // -------------------------------------------------------------
    async getServiceAreas(req, res, user) {
        try {
            if (!(await checkPermission(user, 'manage_service_areas'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_service_areas" permission.' });
            }

            const [areas] = await db.query(`SELECT * FROM service_areas ORDER BY area_id ASC`);
            sendJSON(res, 200, { success: true, areas, serviceAreas: areas });
        } catch (err) {
            console.error('Error in getServiceAreas:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve service areas' });
        }
    },

    async addServiceArea(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'manage_service_areas'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_service_areas" permission.' });
            }

            const { area_name, city, state } = body;
            if (!area_name || !city || !state) {
                return sendJSON(res, 400, { success: false, message: 'Area name, city, and state are required.' });
            }

            const [result] = await db.query(
                `INSERT INTO service_areas (area_name, city, state, status) VALUES (?, ?, ?, 'ACTIVE')`,
                [area_name.trim(), city.trim(), state.trim()]
            );

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'SERVICE_AREA_ADD', `Added service area "${area_name}" (${city})`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 201, { success: true, message: 'Service area created successfully', area_id: result.insertId });
        } catch (err) {
            console.error('Error in addServiceArea:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to add service area' });
        }
    },

    async updateServiceArea(req, res, user, areaId, body) {
        try {
            if (!(await checkPermission(user, 'manage_service_areas'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_service_areas" permission.' });
            }

            const { area_name, city, state, status } = body;
            await db.query(
                `UPDATE service_areas SET area_name = ?, city = ?, state = ?, status = ? WHERE area_id = ?`,
                [area_name.trim(), city.trim(), state.trim(), status || 'ACTIVE', areaId]
            );

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'SERVICE_AREA_UPDATE', `Updated service area #${areaId} (${area_name})`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 200, { success: true, message: 'Service area updated successfully' });
        } catch (err) {
            console.error('Error in updateServiceArea:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to update service area' });
        }
    },

    async toggleServiceAreaStatus(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'manage_service_areas'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_service_areas" permission.' });
            }

            const { area_id, status } = body;
            await db.query(`UPDATE service_areas SET status = ? WHERE area_id = ?`, [status, area_id]);
            sendJSON(res, 200, { success: true, message: `Service area status changed to ${status}` });
        } catch (err) {
            console.error('Error in toggleServiceAreaStatus:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to toggle service area status' });
        }
    },

    // -------------------------------------------------------------
    // 8. MANAGE FARE RULES
    // -------------------------------------------------------------
    async getFareRules(req, res, user) {
        try {
            if (!(await checkPermission(user, 'manage_fares'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_fares" permission.' });
            }

            const [rules] = await db.query(`SELECT * FROM fare_rules ORDER BY fare_id ASC`);
            sendJSON(res, 200, { success: true, rules, fareRules: rules });
        } catch (err) {
            console.error('Error in getFareRules:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve fare rules' });
        }
    },

    async updateFareRule(req, res, user, fareId, body) {
        try {
            if (!(await checkPermission(user, 'manage_fares'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_fares" permission.' });
            }

            const { base_fare, per_km_rate, per_minute_rate, cancellation_fee, status } = body;
            await db.query(`
                UPDATE fare_rules 
                SET base_fare = ?, per_km_rate = ?, per_minute_rate = ?, cancellation_fee = ?, status = ?
                WHERE fare_id = ?
            `, [parseFloat(base_fare), parseFloat(per_km_rate), parseFloat(per_minute_rate), parseFloat(cancellation_fee), status || 'ACTIVE', fareId]);

            await db.query(
                `INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)`,
                [user.user_id, 'FARE_RULE_UPDATE', `Updated fare rule #${fareId}`, req.socket.remoteAddress || '']
            );

            sendJSON(res, 200, { success: true, message: 'Fare rule updated successfully' });
        } catch (err) {
            console.error('Error in updateFareRule:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to update fare rule' });
        }
    },

    async toggleFareRuleStatus(req, res, user, body) {
        try {
            if (!(await checkPermission(user, 'manage_fares'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "manage_fares" permission.' });
            }

            const { fare_id, status } = body;
            await db.query(`UPDATE fare_rules SET status = ? WHERE fare_id = ?`, [status, fare_id]);
            sendJSON(res, 200, { success: true, message: `Fare rule status changed to ${status}` });
        } catch (err) {
            console.error('Error in toggleFareRuleStatus:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to toggle fare rule status' });
        }
    },

    // -------------------------------------------------------------
    // 9. REPORTS & ANALYTICS
    // -------------------------------------------------------------
    async getReports(req, res, user, queryParams = {}) {
        try {
            if (!(await checkPermission(user, 'view_reports'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "view_reports" permission.' });
            }

            // 1. Overall Totals
            const [[totals]] = await db.query(`
                SELECT 
                    COUNT(*) AS total_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_trips,
                    COALESCE(SUM(CASE WHEN trip_status = 'COMPLETED' THEN fare ELSE 0 END), 0) AS total_revenue,
                    COALESCE(AVG(CASE WHEN trip_status = 'COMPLETED' THEN fare ELSE NULL END), 0) AS avg_fare
                FROM trips
            `);

            // 2. Breakdown by Vehicle Type
            const [vehicleStats] = await db.query(`
                SELECT r.vehicle_type, COUNT(t.trip_id) AS trips_count, COALESCE(SUM(t.fare), 0) AS revenue
                FROM trips t
                JOIN ride_requests r ON t.request_id = r.request_id
                WHERE t.trip_status = 'COMPLETED'
                GROUP BY r.vehicle_type
            `);

            // 3. Driver Performance Leaders
            const [driverPerformance] = await db.query(`
                SELECT u.name AS driver_name, u.mobile, d.rating, d.license_no,
                       COUNT(t.trip_id) AS completed_trips,
                       COALESCE(SUM(t.fare), 0) AS total_earnings
                FROM driver_profiles d
                JOIN users u ON d.user_id = u.user_id
                LEFT JOIN trips t ON d.driver_id = t.driver_id AND t.trip_status = 'COMPLETED'
                GROUP BY d.driver_id, u.name, u.mobile, d.rating, d.license_no
                ORDER BY completed_trips DESC, total_earnings DESC
                LIMIT 10
            `);

            // 4. Passenger Activity Leaders
            const [passengerActivity] = await db.query(`
                SELECT u.name AS passenger_name, u.email, u.mobile,
                       COUNT(t.trip_id) AS total_trips,
                       COALESCE(SUM(t.fare), 0) AS total_spent
                FROM passenger_profiles p
                JOIN users u ON p.user_id = u.user_id
                LEFT JOIN trips t ON p.passenger_id = t.passenger_id AND t.trip_status = 'COMPLETED'
                GROUP BY p.passenger_id, u.name, u.email, u.mobile
                ORDER BY total_trips DESC, total_spent DESC
                LIMIT 10
            `);

            sendJSON(res, 200, {
                success: true,
                reports: {
                    totals,
                    vehicleStats,
                    driverPerformance,
                    passengerActivity
                },
                summary: totals,
                vehicleCategoryBreakdown: vehicleStats,
                topDrivers: driverPerformance,
                passengerActivity
            });
        } catch (err) {
            console.error('Error in getReports:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to generate reports' });
        }
    },

    // -------------------------------------------------------------
    // 10. SYSTEM ACTIVITY LOGS (ADMIN LIMITED VIEW)
    // -------------------------------------------------------------
    async getSystemActivity(req, res, user) {
        try {
            if (!(await checkPermission(user, 'view_system_logs'))) {
                return sendJSON(res, 403, { success: false, message: 'Access Denied: Missing "view_system_logs" permission.' });
            }

            const [logs] = await db.query(`
                SELECT l.log_id, l.user_id, l.action, l.description, l.ip_address, l.created_at,
                       u.name AS user_name, u.role AS user_role
                FROM system_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.log_id DESC
                LIMIT 50
            `);

            sendJSON(res, 200, { success: true, logs });
        } catch (err) {
            console.error('Error in getSystemActivity:', err);
            sendJSON(res, 500, { success: false, message: 'Failed to retrieve system activity' });
        }
    }
};
