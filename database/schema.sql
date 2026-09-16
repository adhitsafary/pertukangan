-- SKEMA DATABASE MITRATUKANG PLATFORM (MYSQL / MARIADB)

CREATE DATABASE IF NOT EXISTS mitratukang_db;
USE mitratukang_db;

-- 1. Tabel Users & Autentikasi
CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NULL,
    full_name VARCHAR(150) NOT NULL,
    avatar_url TEXT NULL,
    role ENUM('worker', 'employer', 'admin') NOT NULL,
    kyc_status ENUM('unverified', 'pending', 'verified', 'rejected') DEFAULT 'unverified',
    wallet_balance DECIMAL(15, 2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Data Detail Verifikasi KTP (UU PDP Compliance: Field sensitif dienkripsi AES-256)
CREATE TABLE IF NOT EXISTS kyc_verifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    id_card_number_encrypted TEXT NOT NULL, -- Nomor KTP (Enkripsi AES-256)
    id_card_photo_path TEXT NOT NULL,
    selfie_photo_path TEXT NOT NULL,
    verified_by BIGINT UNSIGNED NULL,
    rejection_reason TEXT NULL,
    verified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id)
);

-- 3. Detail Profil Tukang
CREATE TABLE IF NOT EXISTS worker_profiles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED UNIQUE NOT NULL,
    category ENUM('batu', 'kayu', 'cat', 'las', 'listrik', 'pipa', 'serabutan') NOT NULL,
    experience_years INT UNSIGNED DEFAULT 0,
    hourly_rate DECIMAL(12, 2) NULL,
    daily_rate DECIMAL(12, 2) NULL,
    current_latitude DECIMAL(10, 8) NULL,
    current_longitude DECIMAL(11, 8) NULL,
    is_available BOOLEAN DEFAULT TRUE,
    rating_average DECIMAL(3, 2) DEFAULT 0.00,
    rating_count INT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Order Proyek / Pekerjaan
CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_code VARCHAR(32) UNIQUE NOT NULL,
    employer_id BIGINT UNSIGNED NOT NULL,
    worker_id BIGINT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    job_type ENUM('daily', 'project_based') NOT NULL,
    address TEXT NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    base_price DECIMAL(15, 2) NOT NULL,
    admin_fee DECIMAL(15, 2) NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    status ENUM('draft', 'pending_acceptance', 'open_bidding', 'waiting_escrow', 'escrow_held', 'in_progress', 'work_submitted', 'completed', 'in_dispute', 'refunded', 'cancelled') DEFAULT 'draft',
    work_submitted_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employer_id) REFERENCES users(id),
    FOREIGN KEY (worker_id) REFERENCES users(id)
);

-- 5. Rekam Jejak Transaksi Escrow & Dompet
CREATE TABLE IF NOT EXISTS escrow_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    payment_gateway_ref VARCHAR(100) NULL,
    amount DECIMAL(15, 2) NOT NULL,
    platform_cut DECIMAL(15, 2) NOT NULL,
    worker_net_income DECIMAL(15, 2) NOT NULL,
    status ENUM('holding', 'released', 'refunded', 'partially_refunded') DEFAULT 'holding',
    released_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- 6. Tiket Sengketa (Dispute)
CREATE TABLE IF NOT EXISTS dispute_tickets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    raised_by BIGINT UNSIGNED NOT NULL,
    reason TEXT NOT NULL,
    evidence_urls JSON NOT NULL,
    status ENUM('open', 'under_investigation', 'resolved_worker_won', 'resolved_employer_won', 'resolved_split') DEFAULT 'open',
    resolution_notes TEXT NULL,
    handled_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (raised_by) REFERENCES users(id),
    FOREIGN KEY (handled_by) REFERENCES users(id)
);
