const http = require('http');
const fs = require('fs');
const path = require('path');
const adminController = require('./controllers/adminController');

const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;

    // --- ADMIN API ENDPOINTS ---
    if (url === '/api/admin/stats' && method === 'GET') {
        return adminController.getSystemStats(req, res);
    }
    if (url === '/api/admin/users' && method === 'GET') {
        return adminController.getUsers(req, res);
    }
    if (url === '/api/admin/toggle-status' && method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            adminController.toggleUserStatus(req, res, JSON.parse(body || '{}'));
        });
        return;
    }

    // --- STATIC FILE ROUTER ---
    let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
    if (!path.extname(filePath)) {
        filePath += '.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const PORT = process.env.PORT || 5500;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));