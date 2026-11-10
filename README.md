# Online Cab Booking System

A modular, clean, full-stack Online Cab Booking System developed with **Vanilla HTML/CSS**, **JavaScript DOM manipulation**, **AJAX/Fetch API**, **Node.js (using built-in modules only — no Express or frontend frameworks)**, and **MySQL**.

---

## Technology Stack & Constraints Followed

- **Backend**: Node.js built-in modules (`http`, `url`, `fs`, `path`, `crypto`)
- **Database**: MySQL (relational schema with primary keys, foreign keys, cascading constraints, and pooling via `mysql2`)
- **Frontend**: Vanilla HTML5, Modern CSS Design System (no Tailwind/Bootstrap), Vanilla JavaScript & DOM manipulation
- **Communication**: Asynchronous REST APIs called via AJAX (`fetch`) without unnecessary full-page reloads
- **Authentication**: Stateless HMAC-SHA256 tokens generated and validated with Node.js built-in `crypto`

---

## Project Structure

```
WebTech/
├── config/
│   └── db.js                       # MySQL connection pool configuration
├── controllers/
│   ├── authController.js           # Registration, login, and user auth APIs
│   ├── driverController.js         # Driver availability, requests, active trip & earnings
│   ├── profileController.js        # Profile fetching & updating
│   └── rideController.js           # Fares, estimates, booking, cancellations & ratings
├── lib/
│   └── auth.js                     # Password hashing (SHA-256) & HMAC token management
├── public/                         # Public and Role-based Frontend UI
│   ├── css/
│   │   └── style.css               # Modern vanilla CSS design system
│   ├── js/
│   │   ├── api.js                  # Central AJAX / Fetch client with auth & toasts
│   │   └── main.js                 # Dynamic navbar, session badge & logout
│   ├── index.html                  # Public home landing page
│   ├── login.html                  # Public unified login page (with demo auto-fill buttons)
│   ├── register.html               # Public registration page (Passenger & Driver tabs)
│   ├── search-ride.html            # Public search & fare estimator + live drivers
│   ├── passenger/
│   │   ├── passenger-dashboard.html# Passenger dashboard with active alert & recent trips
│   │   ├── book-ride.html          # Book ride with live fare estimate calculation
│   │   ├── active-trip.html        # Live passenger trip monitor & rating submission
│   │   ├── trip-history.html       # Trip history log with status filters
│   │   └── profile.html            # Passenger profile view & edit
│   └── driver/
│       ├── driver-dashboard.html   # Driver dashboard with duty status toggle & earnings
│       ├── ride-requests.html      # Real-time AJAX polling for incoming ride requests
│       └── active-trip.html        # Driver console to start/complete trip & collect payment
├── scripts/
│   ├── init-db.js                  # Database creation and seed data script
│   └── test-integration.js         # Automated end-to-end integration test
├── schema.sql                      # Complete MySQL 12-table relational schema
├── package.json
└── server.js                       # Native Node.js HTTP server & REST API router
```

---

## Database Tables Implemented

1. `users` (user_id, name, email, password, mobile, role, status, created_at)
2. `passenger_profiles` (passenger_id, user_id, default_address, emergency_contact)
3. `driver_profiles` (driver_id, user_id, license_no, license_expiry, verification_status, rating, is_available)
4. `vehicles` (vehicle_id, driver_id, vehicle_number, vehicle_type, model, capacity, status)
5. `service_areas` (area_id, area_name, city, state, status)
6. `fare_rules` (fare_id, vehicle_type, base_fare, per_km_rate, per_minute_rate, cancellation_fee, status)
7. `ride_requests` (request_id, passenger_id, pickup_location, destination, vehicle_type, distance_km, estimated_fare, status)
8. `trips` (trip_id, request_id, passenger_id, driver_id, vehicle_id, start_time, end_time, distance_km, fare, trip_status)
9. `payments` (payment_id, trip_id, passenger_id, amount, payment_method, payment_status, paid_at)
10. `ratings_reviews` (review_id, trip_id, reviewer_id, reviewed_user_id, rating, comment, created_at)
11. `admin_permissions` (permission_id, admin_id, permission_name)
12. `system_logs` (log_id, user_id, action, description, ip_address, created_at)

---

## How to Run

### 1. Database Setup
The database script automatically connects to your MySQL server (configured with default user `root` and password `root`), creates `cab_booking_db`, creates all 12 tables, and seeds initial fare rules, service areas, and test accounts:

```bash
npm run setup-db
```

### 2. Start the Application
Start the native Node.js HTTP server:

```bash
npm start
```
The application will be accessible at:
**`http://localhost:3000`**

### 3. Run Integration Test
To run an automated test that validates registration, login, ride request, driver acceptance, starting the trip, completing the trip, and rating:

```bash
node scripts/test-integration.js
```

---

## Pre-Seeded Test Accounts

| Role | Name | Email | Password | Details |
| :--- | :--- | :--- | :--- | :--- |
| **Passenger** | John Doe | `john@example.com` | `pass123` | Active passenger with default address |
| **Driver 1** | Mike Ross | `mike@example.com` | `driver123` | Sedan (Toyota Camry, DL-01-AB-1234), Rating 4.9 |
| **Driver 2** | Sam Wilson | `sam@example.com` | `driver123` | SUV (Hyundai Creta, DL-01-XY-5678), Rating 4.85 |
| **Admin** | Admin User | `admin@example.com` | `admin123` | Administrator account |
| **Super Admin** | Super Admin User | `superadmin@example.com` | `superadmin123` | Super admin with full privileges |
