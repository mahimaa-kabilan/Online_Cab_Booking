const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function initDB() {
    console.log('Connecting to MySQL server...');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
        multipleStatements: true
    });

    console.log('Creating database if not exists...');
    await connection.query('CREATE DATABASE IF NOT EXISTS cab_booking_db;');
    await connection.query('USE cab_booking_db;');

    console.log('Reading and executing schema.sql...');
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await connection.query(schemaSql);

    console.log('Checking and seeding default fare rules...');
    const [fares] = await connection.query('SELECT COUNT(*) as count FROM fare_rules');
    if (fares[0].count === 0) {
        await connection.query(`
            INSERT INTO fare_rules (vehicle_type, base_fare, per_km_rate, per_minute_rate, cancellation_fee, status) VALUES
            ('HATCHBACK', 40.00, 12.00, 1.50, 25.00, 'ACTIVE'),
            ('SEDAN', 50.00, 15.00, 2.00, 30.00, 'ACTIVE'),
            ('SUV', 75.00, 20.00, 2.50, 40.00, 'ACTIVE'),
            ('AUTO', 30.00, 10.00, 1.00, 15.00, 'ACTIVE');
        `);
        console.log('Fare rules seeded.');
    }

    console.log('Checking and seeding default service areas...');
    const [areas] = await connection.query('SELECT COUNT(*) as count FROM service_areas');
    if (areas[0].count === 0) {
        await connection.query(`
            INSERT INTO service_areas (area_name, city, state, status) VALUES
            ('Downtown Business District', 'Metro City', 'State Central', 'ACTIVE'),
            ('Airport International Terminal', 'Metro City', 'State Central', 'ACTIVE'),
            ('Tech Park & IT Hub', 'Metro City', 'State Central', 'ACTIVE'),
            ('Central Railway Station', 'Metro City', 'State Central', 'ACTIVE'),
            ('Suburban Residential West', 'Metro City', 'State Central', 'ACTIVE');
        `);
        console.log('Service areas seeded.');
    }

    console.log('Checking and seeding default demo accounts...');
    const [users] = await connection.query('SELECT COUNT(*) as count FROM users');
    if (users[0].count === 0) {
        // 1. Passenger: john@example.com / pass123
        const passHash = hashPassword('pass123');
        const [passUser] = await connection.query(`
            INSERT INTO users (name, email, password, mobile, role, status)
            VALUES ('John Doe', 'john@example.com', ?, '9876543210', 'PASSENGER', 'ACTIVE');
        `, [passHash]);
        await connection.query(`
            INSERT INTO passenger_profiles (user_id, default_address, emergency_contact)
            VALUES (?, '124 Park Avenue, Metro City', '9876543299');
        `, [passUser.insertId]);

        // 2. Driver 1: mike@example.com / driver123
        const driverHash = hashPassword('driver123');
        const [driverUser1] = await connection.query(`
            INSERT INTO users (name, email, password, mobile, role, status)
            VALUES ('Mike Ross', 'mike@example.com', ?, '9123456780', 'DRIVER', 'ACTIVE');
        `, [driverHash]);
        const [driverProf1] = await connection.query(`
            INSERT INTO driver_profiles (user_id, license_no, license_expiry, verification_status, rating, is_available)
            VALUES (?, 'DL-992384', '2028-12-31', 'APPROVED', 4.90, TRUE);
        `, [driverUser1.insertId]);
        await connection.query(`
            INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status)
            VALUES (?, 'DL-01-AB-1234', 'SEDAN', 'Toyota Camry', 4, 'ACTIVE');
        `, [driverProf1.insertId]);

        // 3. Driver 2: sam@example.com / driver123
        const [driverUser2] = await connection.query(`
            INSERT INTO users (name, email, password, mobile, role, status)
            VALUES ('Sam Wilson', 'sam@example.com', ?, '9123456781', 'DRIVER', 'ACTIVE');
        `, [driverHash]);
        const [driverProf2] = await connection.query(`
            INSERT INTO driver_profiles (user_id, license_no, license_expiry, verification_status, rating, is_available)
            VALUES (?, 'DL-881234', '2029-06-30', 'APPROVED', 4.85, TRUE);
        `, [driverUser2.insertId]);
        await connection.query(`
            INSERT INTO vehicles (driver_id, vehicle_number, vehicle_type, model, capacity, status)
            VALUES (?, 'DL-01-XY-5678', 'SUV', 'Hyundai Creta', 6, 'ACTIVE');
        `, [driverProf2.insertId]);

        // 4. Admin: admin@example.com / admin123
        const adminHash = hashPassword('admin123');
        await connection.query(`
            INSERT INTO users (name, email, password, mobile, role, status)
            VALUES ('Admin User', 'admin@example.com', ?, '9999999999', 'ADMIN', 'ACTIVE');
        `, [adminHash]);

        console.log('Demo accounts seeded successfully:');
        console.log('  Passenger: john@example.com / pass123');
        console.log('  Driver 1:  mike@example.com / driver123 (Sedan, Available)');
        console.log('  Driver 2:  sam@example.com  / driver123 (SUV, Available)');
        console.log('  Admin:     admin@example.com / admin123');
    }

    await connection.end();
    console.log('Database initialization completed successfully!');
}

initDB().catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});
