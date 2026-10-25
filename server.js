const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { parseAuthHeader } = require('./lib/auth');
const authController = require('./controllers/authController');
const rideController = require('./controllers/rideController');
const driverController = require('./controllers/driverController');
const profileController = require('./controllers/profileController');

const PORT = process.env.PORT || 3300;
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

const server = http.createServer(async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${host}`);
    let pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // REST API Handling
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

        // Public Auth Routes
        if (pathname === '/api/auth/register' && method === 'POST') {
            return authController.register(req, res, body);
        }
        if (pathname === '/api/auth/login' && method === 'POST') {
            return authController.login(req, res, body);
        }

        // Public Ride/Fare Routes
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

        // Protected Routes - require valid token
        if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Unauthorized. Please login first.' }));
        }

        // Profile Routes
        if (pathname === '/api/auth/me' && method === 'GET') {
            return authController.getMe(req, res, user);
        }
        if (pathname === '/api/profile' && method === 'GET') {
            return profileController.getProfile(req, res, user);
        }
        if (pathname === '/api/profile' && method === 'PUT') {
            return profileController.updateProfile(req, res, user, body);
        }

        // Passenger Routes
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

        // Driver Routes
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

        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'API endpoint not found.' }));
    }

    // Static Files Handling
    if (pathname === '/' || pathname === '' || pathname === '/login.html' || pathname === '/register.html') {
        pathname = '/index.html';
    }

    // Resolve static file path cleanly
    let targetPath = path.join(PUBLIC_DIR, pathname);

    // If file doesn't exist directly at targetPath, check in passenger or driver folders
    if (!fs.existsSync(targetPath)) {
        if (pathname === '/active-trip.html') {
            const referer = req.headers['referer'] || '';
            if (referer.includes('/driver')) {
                targetPath = path.join(PUBLIC_DIR, 'driver', 'active-trip.html');
            } else {
                targetPath = path.join(PUBLIC_DIR, 'passenger', 'active-trip.html');
            }
        } else {
            const passengerPath = path.join(PUBLIC_DIR, 'passenger', pathname);
            const driverPath = path.join(PUBLIC_DIR, 'driver', pathname);
            if (fs.existsSync(passengerPath)) {
                targetPath = passengerPath;
            } else if (fs.existsSync(driverPath)) {
                targetPath = driverPath;
            }
        }
    }

    serveStaticFile(res, targetPath);
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Online Cab Booking System Server Running!`);
    console.log(` Server URL: http://localhost:${PORT}`);
    console.log(` Environment: Node.js Built-in HTTP Server + MySQL`);
    console.log(`====================================================`);
});
