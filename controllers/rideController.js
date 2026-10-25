const pool = require('../config/db');

async function getFareRules(req, res) {
    try {
        const [rows] = await pool.query('SELECT * FROM fare_rules WHERE status = "ACTIVE"');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, fare_rules: rows }));
    } catch (err) {
        console.error('getFareRules error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Failed to fetch fare rules.' }));
    }
}

async function getServiceAreas(req, res) {
    try {
        const [rows] = await pool.query('SELECT * FROM service_areas WHERE status = "ACTIVE" ORDER BY area_name ASC');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, service_areas: rows }));
    } catch (err) {
        console.error('getServiceAreas error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Failed to fetch service areas.' }));
    }
}

async function estimateFare(req, res, body) {
    try {
        const { vehicle_type, distance_km, pickup_location, destination } = body;
        const vType = (vehicle_type || 'SEDAN').toUpperCase();
        const dist = parseFloat(distance_km) || 5.0;

        const [rules] = await pool.query('SELECT * FROM fare_rules WHERE vehicle_type = ? AND status = "ACTIVE"', [vType]);
        if (rules.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: `Fare rule for ${vType} not found.` }));
        }

        const rule = rules[0];
        const estimatedMinutes = Math.round(dist * 2.5); // Approx 2.5 mins per km in city
        const distanceCharge = dist * rule.per_km_rate;
        const timeCharge = estimatedMinutes * rule.per_minute_rate;
        const totalFare = Math.round((rule.base_fare + distanceCharge + timeCharge) * 100) / 100;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            estimate: {
                vehicle_type: vType,
                distance_km: dist,
                estimated_minutes: estimatedMinutes,
                base_fare: rule.base_fare,
                per_km_rate: rule.per_km_rate,
                per_minute_rate: rule.per_minute_rate,
                distance_charge: distanceCharge,
                time_charge: timeCharge,
                total_fare: totalFare
            }
        }));
    } catch (err) {
        console.error('estimateFare error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to estimate fare.' }));
    }
}

async function getAvailableDrivers(req, res) {
    try {
        const [drivers] = await pool.query(`
            SELECT 
                d.driver_id,
                d.rating,
                u.name AS driver_name,
                u.mobile AS driver_phone,
                v.vehicle_id,
                v.vehicle_number,
                v.vehicle_type,
                v.model,
                v.capacity
            FROM driver_profiles d
            JOIN users u ON d.user_id = u.user_id
            JOIN vehicles v ON d.driver_id = v.driver_id
            WHERE d.is_available = TRUE 
              AND d.verification_status = 'APPROVED'
              AND u.status = 'ACTIVE'
              AND v.status = 'ACTIVE'
        `);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: drivers.length, drivers }));
    } catch (err) {
        console.error('getAvailableDrivers error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Failed to fetch available drivers.' }));
    }
}

async function bookRide(req, res, userPayload, body) {
    try {
        if (userPayload.role !== 'PASSENGER') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Only passengers can book rides.' }));
        }

        // Get passenger_id
        let passengerId = userPayload.passenger_id;
        if (!passengerId) {
            const [p] = await pool.query('SELECT passenger_id FROM passenger_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (p.length === 0) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Passenger profile not found.' }));
            }
            passengerId = p[0].passenger_id;
        }

        // Check if passenger already has a pending or active trip
        const [activeRequests] = await pool.query(`
            SELECT request_id, status FROM ride_requests 
            WHERE passenger_id = ? AND status IN ('PENDING', 'ACCEPTED')
        `, [passengerId]);

        if (activeRequests.length > 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: false,
                message: 'You already have an active or pending ride request.',
                active_request_id: activeRequests[0].request_id
            }));
        }

        const { pickup_location, destination, vehicle_type, distance_km } = body;
        if (!pickup_location || !destination) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Pickup and destination are required.' }));
        }

        const vType = (vehicle_type || 'SEDAN').toUpperCase();
        const dist = parseFloat(distance_km) || 5.0;

        // Calculate fare
        const [rules] = await pool.query('SELECT * FROM fare_rules WHERE vehicle_type = ? AND status = "ACTIVE"', [vType]);
        let estimatedFare = 150.00;
        if (rules.length > 0) {
            const rule = rules[0];
            const estMins = Math.round(dist * 2.5);
            estimatedFare = Math.round((rule.base_fare + (dist * rule.per_km_rate) + (estMins * rule.per_minute_rate)) * 100) / 100;
        }

        const [insertResult] = await pool.query(`
            INSERT INTO ride_requests (passenger_id, pickup_location, destination, vehicle_type, distance_km, estimated_fare, status)
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
        `, [passengerId, pickup_location, destination, vType, dist, estimatedFare]);

        const requestId = insertResult.insertId;

        // Log action
        await pool.query(
            'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [userPayload.user_id, 'RIDE_REQUEST_CREATED', `Ride request #${requestId} created from "${pickup_location}" to "${destination}"`, req.socket.remoteAddress || '']
        );

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            message: 'Ride request submitted successfully! Waiting for driver to accept.',
            request_id: requestId,
            estimated_fare: estimatedFare
        }));
    } catch (err) {
        console.error('bookRide error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to create ride booking.' }));
    }
}

async function getMyActiveRide(req, res, userPayload) {
    try {
        let passengerId = userPayload.passenger_id;
        if (!passengerId) {
            const [p] = await pool.query('SELECT passenger_id FROM passenger_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (p.length === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, active: false }));
            }
            passengerId = p[0].passenger_id;
        }

        // Check if there is an active confirmed/started trip
        const [activeTrips] = await pool.query(`
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
                r.requested_at,
                du.name AS driver_name,
                du.mobile AS driver_mobile,
                dp.rating AS driver_rating,
                v.vehicle_number,
                v.model AS vehicle_model
            FROM trips t
            JOIN ride_requests r ON t.request_id = r.request_id
            JOIN driver_profiles dp ON t.driver_id = dp.driver_id
            JOIN users du ON dp.user_id = du.user_id
            LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id
            WHERE t.passenger_id = ? AND t.trip_status IN ('CONFIRMED', 'STARTED')
            ORDER BY t.trip_id DESC
            LIMIT 1
        `, [passengerId]);

        if (activeTrips.length > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: true,
                active: true,
                type: 'TRIP',
                trip: activeTrips[0]
            }));
        }

        // Check if there is a pending request waiting for driver
        const [pendingRequests] = await pool.query(`
            SELECT request_id, pickup_location, destination, vehicle_type, distance_km, estimated_fare, requested_at, status
            FROM ride_requests
            WHERE passenger_id = ? AND status = 'PENDING'
            ORDER BY request_id DESC
            LIMIT 1
        `, [passengerId]);

        if (pendingRequests.length > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: true,
                active: true,
                type: 'REQUEST',
                request: pendingRequests[0]
            }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, active: false }));
    } catch (err) {
        console.error('getMyActiveRide error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to fetch active ride status.' }));
    }
}

async function cancelRide(req, res, userPayload, body) {
    try {
        const { request_id } = body;
        let passengerId = userPayload.passenger_id;
        if (!passengerId) {
            const [p] = await pool.query('SELECT passenger_id FROM passenger_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (p.length > 0) passengerId = p[0].passenger_id;
        }

        const [requests] = await pool.query(
            'SELECT * FROM ride_requests WHERE request_id = ? AND passenger_id = ?',
            [request_id, passengerId]
        );

        if (requests.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Ride request not found.' }));
        }

        const rideReq = requests[0];
        if (rideReq.status === 'COMPLETED' || rideReq.status === 'CANCELLED') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: `Cannot cancel a ride that is already ${rideReq.status}.` }));
        }

        // Update request status
        await pool.query('UPDATE ride_requests SET status = "CANCELLED" WHERE request_id = ?', [request_id]);

        // If a trip was created, mark trip cancelled as well and make driver available
        const [trips] = await pool.query('SELECT trip_id, driver_id FROM trips WHERE request_id = ?', [request_id]);
        if (trips.length > 0) {
            await pool.query('UPDATE trips SET trip_status = "CANCELLED" WHERE trip_id = ?', [trips[0].trip_id]);
            await pool.query('UPDATE driver_profiles SET is_available = TRUE WHERE driver_id = ?', [trips[0].driver_id]);
        }

        await pool.query(
            'INSERT INTO system_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [userPayload.user_id, 'RIDE_CANCELLED', `Ride request #${request_id} cancelled by passenger`, req.socket.remoteAddress || '']
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Ride has been successfully cancelled.' }));
    } catch (err) {
        console.error('cancelRide error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to cancel ride.' }));
    }
}

async function getTripHistory(req, res, userPayload) {
    try {
        let passengerId = userPayload.passenger_id;
        if (!passengerId) {
            const [p] = await pool.query('SELECT passenger_id FROM passenger_profiles WHERE user_id = ?', [userPayload.user_id]);
            if (p.length > 0) passengerId = p[0].passenger_id;
        }

        const [trips] = await pool.query(`
            SELECT 
                t.trip_id,
                t.request_id,
                t.start_time,
                t.end_time,
                t.distance_km,
                t.fare,
                t.trip_status,
                r.pickup_location,
                r.destination,
                r.vehicle_type,
                r.requested_at,
                du.name AS driver_name,
                du.mobile AS driver_mobile,
                v.vehicle_number,
                v.model AS vehicle_model,
                rev.rating AS review_rating,
                rev.comment AS review_comment
            FROM trips t
            JOIN ride_requests r ON t.request_id = r.request_id
            JOIN driver_profiles dp ON t.driver_id = dp.driver_id
            JOIN users du ON dp.user_id = du.user_id
            LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id
            LEFT JOIN ratings_reviews rev ON t.trip_id = rev.trip_id AND rev.reviewer_id = ?
            WHERE t.passenger_id = ?
            ORDER BY t.trip_id DESC
        `, [userPayload.user_id, passengerId]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: trips.length, trips }));
    } catch (err) {
        console.error('getTripHistory error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Failed to fetch trip history.' }));
    }
}

async function submitRating(req, res, userPayload, body) {
    try {
        const { trip_id, rating, comment } = body;
        const numRating = parseInt(rating, 10);
        if (!trip_id || isNaN(numRating) || numRating < 1 || numRating > 5) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Valid rating between 1 and 5 is required.' }));
        }

        // Check trip
        const [trips] = await pool.query(`
            SELECT t.*, dp.user_id AS driver_user_id, t.driver_id
            FROM trips t
            JOIN driver_profiles dp ON t.driver_id = dp.driver_id
            WHERE t.trip_id = ?
        `, [trip_id]);

        if (trips.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Trip not found.' }));
        }

        const trip = trips[0];

        // Check if already reviewed
        const [existing] = await pool.query('SELECT review_id FROM ratings_reviews WHERE trip_id = ? AND reviewer_id = ?', [trip_id, userPayload.user_id]);
        if (existing.length > 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'You have already rated this trip.' }));
        }

        await pool.query(`
            INSERT INTO ratings_reviews (trip_id, reviewer_id, reviewed_user_id, rating, comment)
            VALUES (?, ?, ?, ?, ?)
        `, [trip_id, userPayload.user_id, trip.driver_user_id, numRating, comment || '']);

        // Update driver's average rating
        const [avgResult] = await pool.query(`
            SELECT AVG(rating) as avg_rating
            FROM ratings_reviews
            WHERE reviewed_user_id = ?
        `, [trip.driver_user_id]);

        if (avgResult.length > 0 && avgResult[0].avg_rating) {
            const newAvg = parseFloat(avgResult[0].avg_rating).toFixed(2);
            await pool.query('UPDATE driver_profiles SET rating = ? WHERE driver_id = ?', [newAvg, trip.driver_id]);
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Rating submitted successfully!' }));
    } catch (err) {
        console.error('submitRating error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Failed to submit rating.' }));
    }
}

module.exports = {
    getFareRules,
    getServiceAreas,
    estimateFare,
    getAvailableDrivers,
    bookRide,
    getMyActiveRide,
    cancelRide,
    getTripHistory,
    submitRating
};
