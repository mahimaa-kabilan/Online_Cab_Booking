-- Database Schema for Online Cab Booking System

CREATE DATABASE IF NOT EXISTS cab_booking_db;
USE cab_booking_db;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    role ENUM('PASSENGER', 'DRIVER', 'ADMIN', 'SUPER ADMIN') NOT NULL,
    status ENUM('ACTIVE', 'BLOCKED', 'INACTIVE') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Passenger Profiles Table
CREATE TABLE IF NOT EXISTS passenger_profiles (
    passenger_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    default_address VARCHAR(255),
    emergency_contact VARCHAR(20),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 3. Driver Profiles Table
CREATE TABLE IF NOT EXISTS driver_profiles (
    driver_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    license_no VARCHAR(50) NOT NULL,
    license_expiry DATE,
    verification_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'APPROVED',
    rating DECIMAL(3,2) DEFAULT 5.00,
    is_available BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 4. Vehicles Table
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id INT NOT NULL,
    vehicle_number VARCHAR(20) NOT NULL UNIQUE,
    vehicle_type ENUM('SEDAN', 'SUV', 'HATCHBACK', 'AUTO') NOT NULL,
    model VARCHAR(100) NOT NULL,
    capacity INT DEFAULT 4,
    status ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE') DEFAULT 'ACTIVE',
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id) ON DELETE CASCADE
);

-- 5. Service Areas Table
CREATE TABLE IF NOT EXISTS service_areas (
    area_id INT AUTO_INCREMENT PRIMARY KEY,
    area_name VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE'
);

-- 6. Fare Rules Table
CREATE TABLE IF NOT EXISTS fare_rules (
    fare_id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_type ENUM('SEDAN', 'SUV', 'HATCHBACK', 'AUTO') NOT NULL UNIQUE,
    base_fare DECIMAL(10,2) NOT NULL,
    per_km_rate DECIMAL(10,2) NOT NULL,
    per_minute_rate DECIMAL(10,2) NOT NULL,
    cancellation_fee DECIMAL(10,2) NOT NULL,
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE'
);

-- 7. Ride Requests Table
CREATE TABLE IF NOT EXISTS ride_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    passenger_id INT NOT NULL,
    pickup_location VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    vehicle_type ENUM('SEDAN', 'SUV', 'HATCHBACK', 'AUTO') DEFAULT 'SEDAN',
    distance_km DECIMAL(5,2) DEFAULT 5.00,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    estimated_fare DECIMAL(10,2) NOT NULL,
    status ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED') DEFAULT 'PENDING',
    FOREIGN KEY (passenger_id) REFERENCES passenger_profiles(passenger_id) ON DELETE CASCADE
);

-- 8. Trips Table
CREATE TABLE IF NOT EXISTS trips (
    trip_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    passenger_id INT NOT NULL,
    driver_id INT NOT NULL,
    vehicle_id INT,
    start_time DATETIME NULL,
    end_time DATETIME NULL,
    distance_km DECIMAL(10,2) NOT NULL,
    fare DECIMAL(10,2) NOT NULL,
    trip_status ENUM('CONFIRMED', 'STARTED', 'COMPLETED', 'CANCELLED') DEFAULT 'CONFIRMED',
    FOREIGN KEY (request_id) REFERENCES ride_requests(request_id) ON DELETE CASCADE,
    FOREIGN KEY (passenger_id) REFERENCES passenger_profiles(passenger_id) ON DELETE CASCADE,
    FOREIGN KEY (driver_id) REFERENCES driver_profiles(driver_id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE SET NULL
);

-- 9. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL,
    passenger_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method ENUM('CASH', 'CARD', 'UPI', 'WALLET') DEFAULT 'UPI',
    payment_status ENUM('PENDING', 'PAID', 'FAILED') DEFAULT 'PAID',
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE,
    FOREIGN KEY (passenger_id) REFERENCES passenger_profiles(passenger_id) ON DELETE CASCADE
);

-- 10. Ratings & Reviews Table
CREATE TABLE IF NOT EXISTS ratings_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    trip_id INT NOT NULL,
    reviewer_id INT NOT NULL,
    reviewed_user_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 11. Admin Permissions Table
CREATE TABLE IF NOT EXISTS admin_permissions (
    permission_id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    permission_name VARCHAR(100) NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 12. System Logs Table
CREATE TABLE IF NOT EXISTS system_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
