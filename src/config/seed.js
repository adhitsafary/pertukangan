const pool = require('./mysql');
const { encryptData } = require('../services/encryptionService');

async function seedDatabase() {
    try {
        const [users] = await pool.query('SELECT COUNT(*) as count FROM users');
        if (users[0].count === 0) {
            console.log('🔄 Seeding initial production data to MySQL...');

            // 1. Users
            await pool.query(`
                INSERT INTO users (id, phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance) VALUES
                (1, '081234567890', 'budi.klien@gmail.com', 'Budi Santoso (Klien)', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'employer', 'verified', 5000000.00),
                (2, '085711223344', 'ahmad.tukang@gmail.com', 'Ahmad Supriyadi (Tukang Ahli Kayu & Batu)', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'worker', 'verified', 750000.00),
                (3, '089988776655', 'admin@mitratukang.id', 'Super Administrator (Escrow Lead)', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'admin', 'verified', 1540000.00),
                (4, '081399882211', 'joko.pipa@gmail.com', 'Joko Widodo (Spesialis Pipa & Listrik)', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150', 'worker', 'verified', 420000.00)
            `);

            // 2. KYC Verifications (UU PDP Encrypted)
            const encKtp = encryptData('3204123456780001');
            await pool.query(`
                INSERT INTO kyc_verifications (id, user_id, id_card_number_encrypted, id_card_photo_path, selfie_photo_path, verified_by, verified_at) VALUES
                (1, 2, ?, '/uploads/kyc/ktp_ahmad.jpg', '/uploads/kyc/selfie_ahmad.jpg', 3, NOW())
            `, [encKtp]);

            // 3. Worker Profiles (Spatial Coordinates)
            await pool.query(`
                INSERT INTO worker_profiles (id, user_id, category, experience_years, hourly_rate, daily_rate, current_latitude, current_longitude, is_available, rating_average, rating_count) VALUES
                (1, 2, 'kayu', 6, 35000.00, 200000.00, -6.917464, 107.619123, 1, 4.9, 24),
                (2, 4, 'pipa', 4, 30000.00, 180000.00, -6.914744, 107.609810, 1, 4.8, 18)
            `);

            // 4. Orders
            await pool.query(`
                INSERT INTO orders (id, order_code, employer_id, worker_id, title, description, job_type, address, latitude, longitude, base_price, admin_fee, total_amount, status, created_at, updated_at) VALUES
                (1, 'MTK-202609-001', 1, 2, 'Perbaikan Atap Bocor & Plafon Kayu Ruang Tamu', 'Perbaikan plafon kayu yang keropos akibat bocor atap genteng, estimasi kerja 1 hari penuh.', 'daily', 'Jl. Riau No. 45, Citarum, Bandung', -6.917500, 107.619150, 250000.00, 10000.00, 260000.00, 'in_progress', NOW() - INTERVAL 3 HOUR, NOW() - INTERVAL 2 HOUR),
                (2, 'MTK-202609-002', 1, 2, 'Instalasi Keramik Kamar Mandi 3x2m', 'Pemasangan keramik lantai dan dinding baru.', 'project_based', 'Jl. Dago Asri No. 12, Bandung', -6.885000, 107.615000, 600000.00, 10000.00, 610000.00, 'work_submitted', NOW() - INTERVAL 30 HOUR, NOW() - INTERVAL 25 HOUR)
            `);

            // Update submitted timestamp for order 2 (25 hours ago for testing auto-release)
            await pool.query(`UPDATE orders SET work_submitted_at = NOW() - INTERVAL 25 HOUR WHERE id = 2`);

            // 5. Escrow Transactions
            await pool.query(`
                INSERT INTO escrow_transactions (id, order_id, payment_gateway_ref, amount, platform_cut, worker_net_income, status, created_at) VALUES
                (1, 1, 'PG-MIDTRANS-SETTLE-88912', 260000.00, 25000.00, 235000.00, 'holding', NOW() - INTERVAL 3 HOUR),
                (2, 2, 'PG-MIDTRANS-SETTLE-99012', 610000.00, 60000.00, 550000.00, 'holding', NOW() - INTERVAL 30 HOUR)
            `);

            console.log('✅ Seeding completed successfully!');
        }
    } catch (err) {
        console.error('Error seeding data:', err);
    }
}

module.exports = { seedDatabase };
