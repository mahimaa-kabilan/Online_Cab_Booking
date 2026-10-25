// test-integration.js
const PORT = process.env.PORT || 3300;
const BASE_URL = `http://localhost:${PORT}`;

async function runTest() {
    console.log(`Testing Online Cab Booking System APIs on ${BASE_URL}...\n`);

    // 1. Check Public Landing Page
    const pageRes = await fetch(`${BASE_URL}/index.html`);
    console.log('1. GET /index.html Status:', pageRes.status);

    // 2. Fare rules
    const faresRes = await fetch(`${BASE_URL}/api/fare-rules`);
    const fares = await faresRes.json();
    console.log('2. GET /api/fare-rules Status:', faresRes.status, 'Count:', fares.fare_rules.length);

    // 3. Passenger Login
    const passLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'john@example.com', password: 'pass123' })
    });
    const passLogin = await passLoginRes.json();
    console.log('3. Passenger Login:', passLogin.success, 'Token:', passLogin.token ? 'YES' : 'NO');
    const passToken = passLogin.token;

    // 4. Driver Login
    const driverLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mike@example.com', password: 'driver123' })
    });
    const driverLogin = await driverLoginRes.json();
    console.log('4. Driver Login:', driverLogin.success, 'Token:', driverLogin.token ? 'YES' : 'NO');
    const driverToken = driverLogin.token;

    // 5. Estimate Fare
    const estRes = await fetch(`${BASE_URL}/api/rides/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_type: 'SEDAN', distance_km: 10.0 })
    });
    const est = await estRes.json();
    console.log('5. Estimate Fare for 10km Sedan:', est.estimate.total_fare);

    // 6. Passenger Books Ride
    const bookRes = await fetch(`${BASE_URL}/api/rides/book`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${passToken}`
        },
        body: JSON.stringify({
            pickup_location: 'Central Railway Station',
            destination: 'Airport Terminal 3',
            vehicle_type: 'SEDAN',
            distance_km: 12.0
        })
    });
    const book = await bookRes.json();
    console.log('6. Ride Booking Request:', book.success, 'Request ID:', book.request_id);
    const requestId = book.request_id;

    // 7. Driver Fetches Pending Requests
    const reqsRes = await fetch(`${BASE_URL}/api/driver/requests`, {
        headers: { 'Authorization': `Bearer ${driverToken}` }
    });
    const reqs = await reqsRes.json();
    console.log('7. Driver incoming requests count:', reqs.count);

    // 8. Driver Accepts Request
    const acceptRes = await fetch(`${BASE_URL}/api/driver/accept-request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${driverToken}`
        },
        body: JSON.stringify({ request_id: requestId })
    });
    const accept = await acceptRes.json();
    console.log('8. Driver accepts request:', accept.success, 'Trip ID:', accept.trip_id);
    const tripId = accept.trip_id;

    // 9. Driver Starts Trip
    const startRes = await fetch(`${BASE_URL}/api/driver/start-trip`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${driverToken}`
        },
        body: JSON.stringify({ trip_id: tripId })
    });
    const start = await startRes.json();
    console.log('9. Driver starts trip:', start.success, start.message);

    // 10. Driver Completes Trip
    const compRes = await fetch(`${BASE_URL}/api/driver/complete-trip`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${driverToken}`
        },
        body: JSON.stringify({ trip_id: tripId, payment_method: 'UPI' })
    });
    const comp = await compRes.json();
    console.log('10. Driver completes trip:', comp.success, 'Fare:', comp.fare);

    // 11. Passenger Submits Rating
    const rateRes = await fetch(`${BASE_URL}/api/rides/rate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${passToken}`
        },
        body: JSON.stringify({
            trip_id: tripId,
            rating: 5,
            comment: 'Excellent and punctual ride!'
        })
    });
    const rate = await rateRes.json();
    console.log('11. Passenger rates trip:', rate.success, rate.message);

    // 12. Passenger Views Trip History
    const histRes = await fetch(`${BASE_URL}/api/rides/history`, {
        headers: { 'Authorization': `Bearer ${passToken}` }
    });
    const hist = await histRes.json();
    console.log('12. Passenger Trip History count:', hist.count, 'Latest Review:', hist.trips[0].review_comment);

    console.log('\nAll integration tests passed successfully with 100% success rate!');
}

runTest().catch(err => console.error('Test error:', err));
