const pool = require('../config/db');

async function getDriverStatus(req, res, userPayload) {
    try {
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await pool.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Driver profile not found.' }));
            }
            driverId = d[0].driver_id;
        }

        const [rows] = await pool.query(`
            SELECT 
                d.driver_id,
                d.license_no,
                d.verification_status,
                d.rating,
                d.is_available,
                u.name,
                u.email,
                u.mobile,
                v.vehicle_id,
                v.vehicle_number,
                v.vehicle_type,
                v.model,
                v.capacity
            FROM driver_profiles d
            JOIN users u ON d.user_id = u.user_id
            LEFT JOIN vehicles v ON d.driver_id = v.driver_id
            WHERE d.driver_id = ?
        `, [driverId]);

        if (rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Driver profile not found.' }));
        }

        // Also check if driver has an active ongoing trip
        const [activeTrip] = await pool.query(`
            SELECT trip_id, trip_status FROM trips 
            WHERE driver_id = ? AND trip_status IN ('CONFIRMED', 'STARTED')
            LIMIT 1
        `, [driverId]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            driver: rows[0],
            has_active_trip: activeTrip.length > 0,
            active_trip_id: activeTrip.length > 0 ? activeTrip[0].trip_id : null
        }));
    } catch (err) {
        console.error('getDriverStatus error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to fetch driver status.' }));
    }
}

async function toggleAvailability(req, res, userPayload, body) {
    try {
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await pool.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length > 0) driverId = d[0].driver_id;
        }

        const { is_available } = body;
        const newStatus = !!is_available;

        await pool.query('UPDATE driver_profiles SET is_available = ? WHERE driver_id = ?', [newStatus, driverId]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            is_available: newStatus,
            message: `Driver status changed to ${newStatus ? 'ONLINE' : 'OFFLINE'}`
        }));
    } catch (err) {
        console.error('toggleAvailability error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to update availability.' }));
    }
}

async function getPendingRequests(req, res, userPayload) {
    try {
        const [requests] = await pool.query(`
            SELECT 
                r.request_id,
                r.passenger_id,
                r.pickup_location,
                r.destination,
                r.vehicle_type,
                r.distance_km,
                r.estimated_fare,
                r.requested_at,
                r.status,
                u.name AS passenger_name,
                u.mobile AS passenger_mobile
            FROM ride_requests r
            JOIN passenger_profiles p ON r.passenger_id = p.passenger_id
            JOIN users u ON p.user_id = u.user_id
            WHERE r.status = 'PENDING'
            ORDER BY r.request_id DESC
        `);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: requests.length, requests }));
    } catch (err) {
        console.error('getPendingRequests error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Failed to fetch ride requests.' }));
    }
}

async function acceptRequest(req, res, userPayload, body) {
    const connection = await pool.getConnection();
    try {
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await connection.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length > 0) driverId = d[0].driver_id;
        }

        const { request_id } = body;
        if (!request_id) {
            connection.release();
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'request_id is required.' }));
        }

        await connection.beginTransaction();

        // Check if request is still PENDING
        const [reqRows] = await connection.query('SELECT * FROM ride_requests WHERE request_id = ? FOR UPDATE', [request_id]);
        if (reqRows.length === 0 || reqRows[0].status !== 'PENDING') {
            await connection.rollback();
            connection.release();
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'This ride request is no longer available.' }));
        }

        const rideReq = reqRows[0];

        // Get driver's active vehicle
        const [vRows] = await connection.query('SELECT vehicle_id FROM vehicles WHERE driver_id = ? AND status = "ACTIVE" LIMIT 1', [driverId]);
        const vehicleId = vRows.length > 0 ? vRows[0].vehicle_id : null;

        // Update ride request status to ACCEPTED
        await connection.query('UPDATE ride_requests SET status = "ACCEPTED" WHERE request_id = ?', [request_id]);

        // Create trip
        const [tripResult] = await connection.query(`
            INSERT INTO trips (request_id, passenger_id, driver_id, vehicle_id, distance_km, fare, trip_status)
            VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED')
        `, [request_id, rideReq.passenger_id, driverId, vehicleId, rideReq.distance_km, rideReq.estimated_fare]);

        const tripId = tripResult.insertId;

        // Set driver offline during active trip
        await connection.query('UPDATE driver_profiles SET is_available = FALSE WHERE driver_id = ?', [driverId]);

        await connection.query(
            'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [userPayload.user_id, 'RIDE_ACCEPTED', `Driver accepted ride request #${request_id}, Trip #${tripId} initiated`, req.socket.remoteAddress || '']
        );

        await connection.commit();
        connection.release();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            message: 'Ride accepted successfully!',
            trip_id: tripId
        }));
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error('acceptRequest error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to accept ride request.' }));
    }
}

async function rejectRequest(req, res, userPayload, body) {
    try {
        const { request_id } = body;
        // Optionally mark request as rejected if specifically declined
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: `Request #${request_id} dismissed.` }));
    } catch (err) {
        console.error('rejectRequest error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to reject request.' }));
    }
}

async function getDriverActiveTrip(req, res, userPayload) {
    try {
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await pool.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length > 0) driverId = d[0].driver_id;
        }

        const [trips] = await pool.query(`
            SELECT 
                t.trip_id,
                t.request_id,
                t.passenger_id,
                t.driver_id,
                t.vehicle_id,
                t.start_time,
                t.end_time,
                t.distance_km,
                t.fare,
                t.trip_status,
                r.pickup_location,
                r.destination,
                r.vehicle_type,
                pu.name AS passenger_name,
                pu.mobile AS passenger_mobile,
                pp.emergency_contact
            FROM trips t
            JOIN ride_requests r ON t.request_id = r.request_id
            JOIN passenger_profiles pp ON t.passenger_id = pp.passenger_id
            JOIN users pu ON pp.user_id = pu.user_id
            WHERE t.driver_id = ? AND t.trip_status IN ('CONFIRMED', 'STARTED')
            ORDER BY t.trip_id DESC
            LIMIT 1
        `, [driverId]);

        if (trips.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, active: false }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            active: true,
            trip: trips[0]
        }));
    } catch (err) {
        console.error('getDriverActiveTrip error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to fetch active trip.' }));
    }
}

async function startTrip(req, res, userPayload, body) {
    try {
        const { trip_id } = body;
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await pool.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length > 0) driverId = d[0].driver_id;
        }

        const [trips] = await pool.query('SELECT * FROM trips WHERE trip_id = ? AND driver_id = ?', [trip_id, driverId]);
        if (trips.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Trip not found or does not belong to you.' }));
        }

        await pool.query('UPDATE trips SET trip_status = "STARTED", start_time = NOW() WHERE trip_id = ?', [trip_id]);

        await pool.query(
            'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [userPayload.user_id, 'TRIP_STARTED', `Driver started Trip #${trip_id}`, req.socket.remoteAddress || '']
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Trip has started! Drive safely.' }));
    } catch (err) {
        console.error('startTrip error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to start trip.' }));
    }
}

async function completeTrip(req, res, userPayload, body) {
    const connection = await pool.getConnection();
    try {
        const { trip_id, payment_method } = body;
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await connection.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length > 0) driverId = d[0].driver_id;
        }

        const [trips] = await connection.query('SELECT * FROM trips WHERE trip_id = ? AND driver_id = ?', [trip_id, driverId]);
        if (trips.length === 0) {
            connection.release();
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Trip not found.' }));
        }

        const trip = trips[0];
        await connection.beginTransaction();

        // 1. Update trip status
        await connection.query('UPDATE trips SET trip_status = "COMPLETED", end_time = NOW() WHERE trip_id = ?', [trip_id]);

        // 2. Update ride request status
        await connection.query('UPDATE ride_requests SET status = "COMPLETED" WHERE request_id = ?', [trip.request_id]);

        // 3. Create payment record
        await connection.query(`
            INSERT INTO payments (trip_id, passenger_id, amount, payment_method, payment_status, paid_at)
            VALUES (?, ?, ?, ?, 'PAID', NOW())
        `, [trip_id, trip.passenger_id, trip.fare, payment_method || 'UPI']);

        // 4. Mark driver available again
        await connection.query('UPDATE driver_profiles SET is_available = TRUE WHERE driver_id = ?', [driverId]);

        // 5. System log
        await connection.query(
            'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [userPayload.user_id, 'TRIP_COMPLETED', `Driver completed Trip #${trip_id}, Payment recorded: Rs.${trip.fare}`, req.socket.remoteAddress || '']
        );

        await connection.commit();
        connection.release();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            message: 'Trip successfully completed and payment recorded!',
            fare: trip.fare
        }));
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error('completeTrip error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to complete trip.' }));
    }
}

async function getDriverHistoryAndEarnings(req, res, userPayload) {
    try {
        let driverId = userPayload.driver_id;
        if (!driverId) {
            const [d] = await pool.query('SELECT driver_id FROM driver_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (d.length > 0) driverId = d[0].driver_id;
        }

        const [trips] = await pool.query(`
            SELECT 
                t.trip_id,
                t.distance_km,
                t.fare,
                t.start_time,
                t.end_time,
                t.trip_status,
                r.pickup_location,
                r.destination,
                u.name AS passenger_name,
                rev.rating AS passenger_rating,
                rev.comment AS passenger_comment
            FROM trips t
            JOIN ride_requests r ON t.request_id = r.request_id
            JOIN passenger_profiles p ON t.passenger_id = p.passenger_id
            JOIN users u ON p.user_id = u.user_id
            LEFT JOIN ratings_reviews rev ON t.trip_id = rev.trip_id
            WHERE t.driver_id = ? AND t.trip_status = 'COMPLETED'
            ORDER BY t.trip_id DESC
        `, [driverId]);

        const totalEarnings = trips.reduce((acc, curr) => acc + parseFloat(curr.fare || 0), 0);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            trips,
            totalEarnings: Math.round(totalEarnings * 100) / 100,
            completedTripsCount: trips.length
        }));
    } catch (err) {
        console.error('getDriverHistoryAndEarnings error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to fetch earnings.' }));
    }
}

module.exports = {
    getDriverStatus,
    toggleAvailability,
    getPendingRequests,
    acceptRequest,
    rejectRequest,
    getDriverActiveTrip,
    startTrip,
    completeTrip,
    getDriverHistoryAndEarnings
};
