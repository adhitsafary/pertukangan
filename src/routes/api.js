const express = require('express');
const router = express.Router();
const pool = require('../config/mysql');
const { validateGeofence, calculateHaversineDistance } = require('../services/spatialService');
const { encryptData, decryptData, generatePresignedUrl, validatePresignedToken } = require('../services/encryptionService');
const { sendOtpEmail } = require('../services/emailService');

// -------------------------------------------------------------
// CATALOG LAYANAN SPESIALIS KANGGO-STYLE
// -------------------------------------------------------------
const SERVICE_CATALOG = [
    {
        id: 'cat-pipa',
        category: 'pipa',
        name: 'Perbaikan Pipa & Saluran Air',
        icon: 'fa-faucet-drip',
        color: 'blue',
        base_estimate: 150000,
        warranty_days: 14,
        description: 'Perbaikan pipa bocor, instalasi tandon/toren air, pasang keran, pompa air, dan sanitasi mampet.'
    },
    {
        id: 'cat-atap',
        category: 'batu',
        name: 'Perbaikan Atap & Bocoran Genteng',
        icon: 'fa-house-chimney-crack',
        color: 'amber',
        base_estimate: 250000,
        warranty_days: 30,
        description: 'Bongkar pasang genteng, perbaikan talang air bocor, waterproofing dak beton, dan ganti seng.'
    },
    {
        id: 'cat-keramik',
        category: 'batu',
        name: 'Pemasangan Keramik & Lantai',
        icon: 'fa-trowel',
        color: 'emerald',
        base_estimate: 200000,
        warranty_days: 14,
        description: 'Pasang keramik lantai, dinding kamar mandi, granit, batu alam, plin lantai, dan perbaikan nat.'
    },
    {
        id: 'cat-listrik',
        category: 'listrik',
        name: 'Instalasi & Perbaikan Listrik',
        icon: 'fa-bolt',
        color: 'yellow',
        base_estimate: 180000,
        warranty_days: 14,
        description: 'Instalasi jalur kabel baru, ganti MCB/sekring, pasang fitting lampu, stop kontak, dan cek korsleting.'
    },
    {
        id: 'cat-cat',
        category: 'cat',
        name: 'Pengecatan Rumah & Plafon',
        icon: 'fa-paint-roller',
        color: 'purple',
        base_estimate: 175000,
        warranty_days: 14,
        description: 'Pengecatan interior/eksterior, plamir dinding, cat kusen/pintu, dan pelapis anti bocor dinding.'
    },
    {
        id: 'cat-kayu',
        category: 'kayu',
        name: 'Plafon Gypsum & Kusen Kayu',
        icon: 'fa-tree',
        color: 'amber',
        base_estimate: 220000,
        warranty_days: 14,
        description: 'Perbaikan plafon jebol, pasang rangka hollow/gypsum, pintu kayu seret, dan partisi ruangan.'
    },
    {
        id: 'cat-las',
        category: 'las',
        name: 'Teralis, Pagar & Kanopi Besi',
        icon: 'fa-fire-burner',
        color: 'rose',
        base_estimate: 350000,
        warranty_days: 30,
        description: 'Fabrikasi dan las kanopi baja ringan/hollow, pagar besi minimalis, pintu folding, dan railing tangga.'
    }
];

router.get('/services', (req, res) => {
    res.json({ success: true, data: SERVICE_CATALOG });
});

// -------------------------------------------------------------
// QRIS PLATFORM SETTINGS (DYNAMIC QRIS INPUT BY ADMIN)
// -------------------------------------------------------------
router.get('/settings/qris', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT setting_key, setting_value FROM platform_settings');
        const settings = {};
        rows.forEach(r => {
            settings[r.setting_key] = r.setting_value;
        });

        res.json({
            success: true,
            data: {
                qris_image_url: settings.qris_image_url || 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=MITRATUKANG-QRIS-DEFAULT',
                qris_merchant_name: settings.qris_merchant_name || 'MITRATUKANG ESCROW INDONESIA',
                qris_nmid: settings.qris_nmid || 'ID1020000123456',
                qris_raw_string: settings.qris_raw_string || ''
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal memuat setting QRIS', error: err.message });
    }
});

router.put('/settings/qris', async (req, res) => {
    try {
        const { qris_image_url, qris_merchant_name, qris_nmid, qris_raw_string } = req.body;

        const updateKey = async (key, val) => {
            if (val !== undefined) {
                await pool.query(`
                    INSERT INTO platform_settings (setting_key, setting_value)
                    VALUES (?, ?)
                    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
                `, [key, val]);
            }
        };

        await updateKey('qris_image_url', qris_image_url);
        await updateKey('qris_merchant_name', qris_merchant_name);
        await updateKey('qris_nmid', qris_nmid);
        await updateKey('qris_raw_string', qris_raw_string);

        res.json({
            success: true,
            message: 'Konfigurasi QRIS Escrow Admin berhasil diperbarui di database MySQL!'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal memperbarui QRIS', error: err.message });
    }
});

// -------------------------------------------------------------
// 0. AUTH & OTP EMAIL SYSTEM (MYSQL PERSISTED)
// -------------------------------------------------------------
router.post('/auth/request-otp', async (req, res) => {
    try {
        const { email, type } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Alamat email wajib diisi.' });
        }

        const cleanEmail = email.trim().toLowerCase();

        if (type === 'login') {
            const [users] = await pool.query('SELECT id, full_name, email FROM users WHERE email = ?', [cleanEmail]);
            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Email belum terdaftar. Silakan daftar akun baru terlebih dahulu.'
                });
            }
        }

        if (type === 'register') {
            const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
            if (users.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Email sudah terdaftar. Silakan langsung masuk di halaman login.'
                });
            }
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.query('UPDATE email_otps SET is_used = 1 WHERE email = ?', [cleanEmail]);

        await pool.query(`
            INSERT INTO email_otps (email, otp_code, type, expires_at, is_used)
            VALUES (?, ?, ?, NOW() + INTERVAL 10 MINUTE, 0)
        `, [cleanEmail, otpCode, type || 'login']);

        sendOtpEmail(cleanEmail, otpCode, type || 'login');

        res.json({
            success: true,
            message: `Kode OTP 6-digit berhasil digenerate untuk ${cleanEmail}.`,
            otp_code: otpCode,
            expires_in_minutes: 10
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal memproses OTP email', error: err.message });
    }
});

router.post('/auth/verify-login-otp', async (req, res) => {
    try {
        const { email, otp_code } = req.body;

        if (!email || !otp_code) {
            return res.status(400).json({ success: false, message: 'Email dan kode OTP wajib diisi.' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanOtp = otp_code.trim();

        const [otps] = await pool.query(`
            SELECT * FROM email_otps 
            WHERE email = ? AND otp_code = ? AND is_used = 0 AND expires_at >= NOW()
            ORDER BY id DESC LIMIT 1
        `, [cleanEmail, cleanOtp]);

        if (otps.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Kode OTP tidak valid atau sudah kedaluwarsa. Silakan minta kode baru.'
            });
        }

        await pool.query('UPDATE email_otps SET is_used = 1 WHERE id = ?', [otps[0].id]);

        const [users] = await pool.query(`
            SELECT id, phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance 
            FROM users WHERE email = ?
        `, [cleanEmail]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
        }

        res.json({
            success: true,
            message: 'Verifikasi OTP berhasil!',
            data: users[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Verifikasi OTP gagal', error: err.message });
    }
});

router.post('/auth/verify-register-otp', async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const { full_name, phone_number, email, role, nik, category, daily_rate, otp_code } = req.body;

        if (!email || !otp_code || !full_name || !phone_number) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: 'Semua field dan Kode OTP wajib diisi.' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanOtp = otp_code.trim();

        const [otps] = await connection.query(`
            SELECT * FROM email_otps 
            WHERE email = ? AND otp_code = ? AND is_used = 0 AND expires_at >= NOW()
            ORDER BY id DESC LIMIT 1
        `, [cleanEmail, cleanOtp]);

        if (otps.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(401).json({
                success: false,
                message: 'Kode OTP tidak valid atau sudah kedaluwarsa.'
            });
        }

        await connection.query('UPDATE email_otps SET is_used = 1 WHERE id = ?', [otps[0].id]);

        const [existing] = await connection.query(`
            SELECT id FROM users WHERE email = ? OR phone_number = ?
        `, [cleanEmail, phone_number]);

        if (existing.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(409).json({ success: false, message: 'Email atau Nomor HP sudah terdaftar di sistem.' });
        }

        const avatar = role === 'worker' 
            ? 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150' 
            : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150';

        const [userResult] = await connection.query(`
            INSERT INTO users (phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance)
            VALUES (?, ?, ?, ?, ?, 'verified', 0.00)
        `, [phone_number, cleanEmail, full_name, avatar, role || 'employer']);

        const newUserId = userResult.insertId;

        if (nik) {
            const encryptedNik = encryptData(nik);
            await connection.query(`
                INSERT INTO kyc_verifications (user_id, id_card_number_encrypted, id_card_photo_path, selfie_photo_path, verified_at)
                VALUES (?, ?, '/uploads/kyc/default_ktp.jpg', '/uploads/kyc/default_selfie.jpg', NOW())
            `, [newUserId, encryptedNik]);
        }

        if (role === 'worker') {
            await connection.query(`
                INSERT INTO worker_profiles (user_id, category, experience_years, hourly_rate, daily_rate, current_latitude, current_longitude, is_available, rating_average, rating_count)
                VALUES (?, ?, 3, ?, ?, -6.917500, 107.619150, 1, 5.0, 1)
            `, [newUserId, category || 'batu', Math.round((parseFloat(daily_rate) || 200000) / 7), parseFloat(daily_rate) || 200000]);
        }

        await connection.commit();
        connection.release();

        const newUser = {
            id: newUserId,
            phone_number,
            email: cleanEmail,
            full_name,
            avatar_url: avatar,
            role: role || 'employer',
            kyc_status: 'verified',
            wallet_balance: 0.00
        };

        res.json({
            success: true,
            message: 'Registrasi berhasil dan akun aktif!',
            data: newUser
        });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ success: false, message: 'Registrasi via OTP gagal', error: err.message });
    }
});

// -------------------------------------------------------------
// 1. GET ALL ORDERS & DETAILS
// -------------------------------------------------------------
router.get('/orders', async (req, res) => {
    try {
        const { employer_id, worker_id, status } = req.query;

        let query = `
            SELECT 
                o.*,
                u_emp.full_name AS employer_name,
                u_emp.phone_number AS employer_phone,
                u_wrk.full_name AS worker_name,
                u_wrk.phone_number AS worker_phone,
                e.id AS escrow_id,
                e.payment_gateway_ref,
                e.platform_cut,
                e.worker_net_income,
                e.status AS escrow_status,
                d.id AS dispute_id,
                d.reason AS dispute_reason,
                d.status AS dispute_status,
                d.resolution_notes AS dispute_resolution_notes
            FROM orders o
            LEFT JOIN users u_emp ON o.employer_id = u_emp.id
            LEFT JOIN users u_wrk ON o.worker_id = u_wrk.id
            LEFT JOIN escrow_transactions e ON e.order_id = o.id
            LEFT JOIN dispute_tickets d ON d.order_id = o.id
            WHERE 1=1
        `;
        const params = [];

        if (employer_id) {
            query += ` AND o.employer_id = ?`;
            params.push(parseInt(employer_id));
        }

        if (worker_id) {
            query += ` AND o.worker_id = ?`;
            params.push(parseInt(worker_id));
        }

        if (status) {
            query += ` AND o.status = ?`;
            params.push(status);
        }

        query += ` ORDER BY o.created_at DESC`;

        const [rows] = await pool.query(query, params);

        const formatted = rows.map(r => ({
            id: r.id,
            order_code: r.order_code,
            employer_id: r.employer_id,
            worker_id: r.worker_id,
            title: r.title,
            description: r.description,
            job_type: r.job_type,
            address: r.address,
            latitude: parseFloat(r.latitude),
            longitude: parseFloat(r.longitude),
            base_price: parseFloat(r.base_price),
            admin_fee: parseFloat(r.admin_fee),
            total_amount: parseFloat(r.total_amount),
            status: r.status,
            work_submitted_at: r.work_submitted_at,
            completed_at: r.completed_at,
            warranty_until: r.warranty_until,
            rating: r.rating,
            review_comment: r.review_comment,
            photo_before_urls: r.photo_before_urls ? JSON.parse(r.photo_before_urls) : [],
            photo_after_urls: r.photo_after_urls ? JSON.parse(r.photo_after_urls) : [],
            created_at: r.created_at,
            employer_name: r.employer_name || 'Klien',
            employer_phone: r.employer_phone || '-',
            worker_name: r.worker_name || 'Tukang Belum Dipilih',
            worker_phone: r.worker_phone || '-',
            escrow: r.escrow_id ? {
                id: r.escrow_id,
                payment_gateway_ref: r.payment_gateway_ref,
                platform_cut: parseFloat(r.platform_cut),
                worker_net_income: parseFloat(r.worker_net_income),
                status: r.escrow_status
            } : null,
            dispute: r.dispute_id ? {
                id: r.dispute_id,
                reason: r.dispute_reason,
                status: r.dispute_status,
                resolution_notes: r.dispute_resolution_notes
            } : null
        }));

        res.json({ success: true, data: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database query failed', error: err.message });
    }
});

// -------------------------------------------------------------
// 2. CREATE NEW ORDER (WAITING_ESCROW)
// -------------------------------------------------------------
router.post('/orders', async (req, res) => {
    try {
        const { employer_id, worker_id, title, description, job_type, address, latitude, longitude, base_price } = req.body;
        
        const base = parseFloat(base_price) || 250000;
        const adminFee = 10000;
        const total = base + adminFee;
        const orderCode = `MTK-${Date.now().toString().slice(-6)}`;
        const lat = parseFloat(latitude) || -6.917500;
        const lon = parseFloat(longitude) || 107.619150;
        const empId = parseInt(employer_id) || 1;
        const wrkId = worker_id ? parseInt(worker_id) : 2;

        const [result] = await pool.query(`
            INSERT INTO orders 
            (order_code, employer_id, worker_id, title, description, job_type, address, latitude, longitude, base_price, admin_fee, total_amount, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_escrow')
        `, [orderCode, empId, wrkId, title, description, job_type || 'daily', address, lat, lon, base, adminFee, total]);

        const newOrderId = result.insertId;

        res.json({
            success: true,
            message: 'Order berhasil dibuat ke database MySQL! Menunggu pembayaran rekening bersama (Escrow).',
            data: { id: newOrderId, order_code: orderCode, total_amount: total, status: 'waiting_escrow' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal membuat order', error: err.message });
    }
});

// -------------------------------------------------------------
// 3. PAYMENT WEBHOOK (SETTLE ESCROW TRANSACTION)
// -------------------------------------------------------------
router.post('/payment/webhook', async (req, res) => {
    try {
        const { order_id, transaction_status, transaction_id } = req.body;

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? OR order_code = ?', [order_id, order_id]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        if (transaction_status === 'settlement' || transaction_status === 'capture') {
            const platformCut = Math.round(order.base_price * 0.10);
            const workerNet = order.base_price - platformCut;
            const ref = transaction_id || `PG-${Date.now()}`;

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                await connection.query('UPDATE orders SET status = "escrow_held", updated_at = NOW() WHERE id = ?', [order.id]);

                const [existingEscrow] = await connection.query('SELECT * FROM escrow_transactions WHERE order_id = ?', [order.id]);
                if (existingEscrow.length === 0) {
                    await connection.query(`
                        INSERT INTO escrow_transactions (order_id, payment_gateway_ref, amount, platform_cut, worker_net_income, status)
                        VALUES (?, ?, ?, ?, ?, 'holding')
                    `, [order.id, ref, order.total_amount, platformCut, workerNet]);
                } else {
                    await connection.query('UPDATE escrow_transactions SET status = "holding", payment_gateway_ref = ? WHERE order_id = ?', [ref, order.id]);
                }

                await connection.commit();
                connection.release();

                return res.json({
                    success: true,
                    message: `Payment settled. Order ${order.order_code} status updated to ESCROW_HELD.`,
                    data: { order_id: order.id, status: 'escrow_held', worker_net_income: workerNet }
                });
            } catch (txErr) {
                await connection.rollback();
                connection.release();
                throw txErr;
            }
        }

        res.json({ success: true, message: `Webhook processed with status: ${transaction_status}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Webhook processing error', error: err.message });
    }
});

// -------------------------------------------------------------
// 4. TUKANG MULAI KERJA (GEOFENCING < 50M + FOTO BEFORE)
// -------------------------------------------------------------
router.post('/orders/:id/start-work', async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { worker_latitude, worker_longitude, photo_before } = req.body;

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        if (order.status !== 'escrow_held') {
            return res.status(400).json({
                success: false,
                message: `Gagal mulai kerja. Status order harus ESCROW_HELD (Status saat ini: ${order.status})`
            });
        }

        const geoValidation = validateGeofence(
            parseFloat(worker_latitude),
            parseFloat(worker_longitude),
            parseFloat(order.latitude),
            parseFloat(order.longitude),
            50
        );

        if (!geoValidation.isWithinRadius) {
            return res.status(422).json({
                success: false,
                message: `Check-in ditolak! Anda berada ${geoValidation.distanceMeters}m dari lokasi proyek (Maksimal radius 50m).`,
                distance_meters: geoValidation.distanceMeters
            });
        }

        const beforePhotos = photo_before && Array.isArray(photo_before) ? JSON.stringify(photo_before) : JSON.stringify([
            'https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?w=400'
        ]);

        await pool.query('UPDATE orders SET status = "in_progress", photo_before_urls = ?, updated_at = NOW() WHERE id = ?', [beforePhotos, orderId]);

        res.json({
            success: true,
            message: 'Validasi geofence GPS sukses & Foto kondisi awal tersimpan! Pekerjaan lapangan resmi dimulai.',
            data: { order_id: orderId, status: 'in_progress', distance_meters: geoValidation.distanceMeters }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Start work error', error: err.message });
    }
});

// -------------------------------------------------------------
// 5. TUKANG SUBMIT SELESAI KERJA (MINIMAL 2 FOTO AFTER)
// -------------------------------------------------------------
router.post('/orders/:id/submit-work', async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { evidence_photos, notes } = req.body;

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        if (order.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: `Gagal submit. Status harus IN_PROGRESS (Status saat ini: ${order.status})`
            });
        }

        if (!evidence_photos || !Array.isArray(evidence_photos) || evidence_photos.length < 2) {
            return res.status(422).json({
                success: false,
                message: 'Wajib menyertakan minimal 2 foto bukti hasil pekerjaan lapangan!'
            });
        }

        const afterPhotos = JSON.stringify(evidence_photos);

        await pool.query(`
            UPDATE orders 
            SET status = "work_submitted", 
                work_submitted_at = NOW(), 
                photo_after_urls = ?, 
                updated_at = NOW() 
            WHERE id = ?
        `, [afterPhotos, orderId]);

        res.json({
            success: true,
            message: 'Laporan hasil kerja berhasil diunggah. Menunggu konfirmasi klien atau garansi auto-release 24 jam.',
            data: { order_id: orderId, status: 'work_submitted' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Submit work error', error: err.message });
    }
});

// -------------------------------------------------------------
// 6. KLIEN MANUAL RELEASE ESCROW + GARANSI 14 HARI
// -------------------------------------------------------------
router.post('/orders/:id/release-escrow', async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const orderId = parseInt(req.params.id);
        const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (orders.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        if (order.status !== 'work_submitted') {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: `Status order bukan WORK_SUBMITTED (Status: ${order.status})` });
        }

        const [escrows] = await connection.query('SELECT * FROM escrow_transactions WHERE order_id = ?', [orderId]);
        if (escrows.length > 0 && escrows[0].status === 'holding') {
            const escrow = escrows[0];

            await connection.query('UPDATE escrow_transactions SET status = "released", released_at = NOW() WHERE id = ?', [escrow.id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [escrow.worker_net_income, order.worker_id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE role = "admin"', [escrow.platform_cut]);
        }

        await connection.query(`
            UPDATE orders 
            SET status = "completed", 
                completed_at = NOW(), 
                warranty_until = NOW() + INTERVAL 14 DAY, 
                updated_at = NOW() 
            WHERE id = ?
        `, [orderId]);

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: 'Pekerjaan telah disetujui! Dana escrow berhasil ditransfer ke saldo dompet tukang & Garansi Layanan 14 Hari aktif.',
            data: { order_id: orderId, status: 'completed' }
        });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ success: false, message: 'Release escrow failed', error: err.message });
    }
});

// -------------------------------------------------------------
// 7. ATURAN PEMBATALAN ORDER (CANCELLATION RULES PRD)
// -------------------------------------------------------------
router.post('/orders/:id/cancel', async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const orderId = parseInt(req.params.id);
        const { reason } = req.body;

        const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (orders.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'refunded') {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: `Order tidak dapat dibatalkan (Status: ${order.status})` });
        }

        const [escrows] = await connection.query('SELECT * FROM escrow_transactions WHERE order_id = ?', [orderId]);
        const escrow = escrows[0];

        // Skenario A: Sebelum Mulai Kerja (Status waiting_escrow / escrow_held) -> 100% Refund
        if (order.status === 'waiting_escrow' || order.status === 'escrow_held') {
            if (escrow && escrow.status === 'holding') {
                // Refund 100% ke saldo klien
                await connection.query('UPDATE escrow_transactions SET status = "refunded" WHERE id = ?', [escrow.id]);
                await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [escrow.amount, order.employer_id]);
            }

            await connection.query('UPDATE orders SET status = "cancelled", updated_at = NOW() WHERE id = ?', [orderId]);
            await connection.commit();
            connection.release();

            return res.json({
                success: true,
                message: 'Pesanan berhasil dibatalkan. Dana deposit escrow Anda telah dikembalikan 100% utuh ke saldo.',
                data: { order_id: orderId, status: 'cancelled' }
            });
        }

        // Skenario B: Setelah Mulai Kerja / Tukang Sudah Tiba (Status in_progress)
        // Klien wajib membayar biaya kompensasi kedatangan flat Rp50.000 ke dompet tukang, sisa dana dikembalikan ke klien
        if (order.status === 'in_progress' || order.status === 'work_submitted') {
            const compensation = 50000.00;
            const refundAmount = Math.max(0, order.total_amount - compensation);

            if (escrow && escrow.status === 'holding') {
                await connection.query('UPDATE escrow_transactions SET status = "partially_refunded" WHERE id = ?', [escrow.id]);
                // Transfer kompensasi ke tukang
                await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [compensation, order.worker_id]);
                // Refund sisa ke klien
                await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [refundAmount, order.employer_id]);
            }

            await connection.query('UPDATE orders SET status = "cancelled", updated_at = NOW() WHERE id = ?', [orderId]);
            await connection.commit();
            connection.release();

            return res.json({
                success: true,
                message: `Pesanan dibatalkan saat tukang sudah di lokasi. Kompensasi kedatangan Rp50.000 dialokasikan ke tukang, dan sisa dana Rp${refundAmount.toLocaleString('id-ID')} telah dikembalikan ke saldo dompet Anda.`,
                data: { order_id: orderId, status: 'cancelled', compensation, refund_amount: refundAmount }
            });
        }

        await connection.rollback();
        connection.release();
        res.status(400).json({ success: false, message: 'Status order tidak memenuhi syarat pembatalan.' });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal membatalkan pesanan', error: err.message });
    }
});

// -------------------------------------------------------------
// 8. SENGKETA / DISPUTE RESOLUTION (PRD RULE #9 & #10)
// -------------------------------------------------------------

// Warga Mengajukan Sengketa
router.post('/orders/:id/dispute', async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { raised_by, reason, evidence_urls } = req.body;

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        if (order.status !== 'work_submitted' && order.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: 'Pengajuan dispute hanya dapat dilakukan saat pekerjaan sedang berjalan atau dalam masa review 24 jam.'
            });
        }

        // Update status order ke IN_DISPUTE
        await pool.query('UPDATE orders SET status = "in_dispute", updated_at = NOW() WHERE id = ?', [orderId]);

        // Catat Tiket Dispute
        const evUrls = evidence_urls && Array.isArray(evidence_urls) ? JSON.stringify(evidence_urls) : JSON.stringify([
            'https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?w=400'
        ]);

        await pool.query(`
            INSERT INTO dispute_tickets (order_id, raised_by, reason, evidence_urls, status)
            VALUES (?, ?, ?, ?, 'open')
        `, [orderId, raised_by || order.employer_id, reason || 'Hasil pekerjaan tidak sesuai dengan kesepakatan awal.', evUrls]);

        res.json({
            success: true,
            message: 'Tiket sengketa berhasil diajukan! Dana escrow otomatis dibekukan dan diteruskan ke tim mediator Admin untuk investigasi.',
            data: { order_id: orderId, status: 'in_dispute' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal mengajukan sengketa', error: err.message });
    }
});

// Admin Mengambil Daftar Semua Tiket Dispute
router.get('/admin/disputes', async (req, res) => {
    try {
        const query = `
            SELECT 
                d.*,
                o.order_code,
                o.title AS order_title,
                o.total_amount,
                u_emp.full_name AS employer_name,
                u_wrk.full_name AS worker_name,
                e.worker_net_income,
                e.platform_cut
            FROM dispute_tickets d
            JOIN orders o ON d.order_id = o.id
            JOIN users u_emp ON o.employer_id = u_emp.id
            LEFT JOIN users u_wrk ON o.worker_id = u_wrk.id
            LEFT JOIN escrow_transactions e ON e.order_id = o.id
            ORDER BY d.created_at DESC
        `;
        const [rows] = await pool.query(query);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Get disputes error', error: err.message });
    }
});

// Admin Mengeksekusi Resolusi Sengketa (Split, Worker Won, Employer Won)
router.post('/admin/disputes/:id/resolve', async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const disputeId = parseInt(req.params.id);
        const { resolution_type, worker_percentage, employer_percentage, resolution_notes, handled_by } = req.body;
        // resolution_type: 'resolved_worker_won' | 'resolved_employer_won' | 'resolved_split'

        const [disputes] = await connection.query('SELECT * FROM dispute_tickets WHERE id = ? FOR UPDATE', [disputeId]);
        if (disputes.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ success: false, message: 'Tiket sengketa tidak ditemukan' });
        }
        const dispute = disputes[0];

        const [orders] = await connection.query('SELECT * FROM orders WHERE id = ?', [dispute.order_id]);
        const order = orders[0];

        const [escrows] = await connection.query('SELECT * FROM escrow_transactions WHERE order_id = ?', [order.id]);
        const escrow = escrows[0];

        let workerPayout = 0;
        let employerRefund = 0;

        if (resolution_type === 'resolved_worker_won') {
            workerPayout = escrow.worker_net_income;
            employerRefund = 0;
            await connection.query('UPDATE escrow_transactions SET status = "released", released_at = NOW() WHERE id = ?', [escrow.id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [workerPayout, order.worker_id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE role = "admin"', [escrow.platform_cut]);
            await connection.query('UPDATE orders SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [order.id]);
        } else if (resolution_type === 'resolved_employer_won') {
            workerPayout = 0;
            employerRefund = order.total_amount;
            await connection.query('UPDATE escrow_transactions SET status = "refunded" WHERE id = ?', [escrow.id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [employerRefund, order.employer_id]);
            await connection.query('UPDATE orders SET status = "refunded", updated_at = NOW() WHERE id = ?', [order.id]);
        } else if (resolution_type === 'resolved_split') {
            const wPct = parseFloat(worker_percentage) || 50;
            const ePct = parseFloat(employer_percentage) || 50;

            workerPayout = Math.round(order.base_price * (wPct / 100));
            employerRefund = Math.round(order.base_price * (ePct / 100));

            await connection.query('UPDATE escrow_transactions SET status = "partially_refunded", released_at = NOW() WHERE id = ?', [escrow.id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [workerPayout, order.worker_id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [employerRefund, order.employer_id]);
            await connection.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE role = "admin"', [escrow.platform_cut]);
            await connection.query('UPDATE orders SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [order.id]);
        }

        // Update Tiket Dispute
        await connection.query(`
            UPDATE dispute_tickets 
            SET status = ?, resolution_notes = ?, handled_by = ?, updated_at = NOW() 
            WHERE id = ?
        `, [resolution_type, resolution_notes || 'Dispute diselesaikan oleh Admin.', handled_by || 3, disputeId]);

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `Resolusi sengketa ${resolution_type} berhasil dieksekusi! Alokasi: Tukang Rp${workerPayout.toLocaleString('id-ID')}, Klien Rp${employerRefund.toLocaleString('id-ID')}.`,
            data: { dispute_id: disputeId, resolution_type, worker_payout: workerPayout, employer_refund: employerRefund }
        });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal menyelesaikan sengketa', error: err.message });
    }
});

// -------------------------------------------------------------
// 9. ADMIN KYC VERIFICATION MANAGEMENT (UU PDP COMPLIANCE)
// -------------------------------------------------------------
router.get('/admin/kyc-verifications', async (req, res) => {
    try {
        const query = `
            SELECT 
                k.id AS kyc_id,
                k.user_id,
                k.id_card_number_encrypted,
                k.id_card_photo_path,
                k.selfie_photo_path,
                k.verified_at,
                k.rejection_reason,
                u.full_name,
                u.phone_number,
                u.email,
                u.role,
                u.kyc_status
            FROM kyc_verifications k
            JOIN users u ON k.user_id = u.id
            ORDER BY k.created_at DESC
        `;
        const [rows] = await pool.query(query);

        const formatted = rows.map(r => {
            const decNik = decryptData(r.id_card_number_encrypted);
            return {
                kyc_id: r.kyc_id,
                user_id: r.user_id,
                full_name: r.full_name,
                phone_number: r.phone_number,
                email: r.email,
                role: r.role,
                kyc_status: r.kyc_status,
                nik_decrypted: decNik || '3204123456780001',
                // Presigned Temporary URLs (10 min expiry) sesuai UU PDP
                ktp_presigned_url: generatePresignedUrl(r.id_card_photo_path, 600),
                selfie_presigned_url: generatePresignedUrl(r.selfie_photo_path, 600),
                verified_at: r.verified_at,
                rejection_reason: r.rejection_reason
            };
        });

        res.json({ success: true, data: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Get KYC verifications failed', error: err.message });
    }
});

router.post('/admin/kyc/:id/approve', async (req, res) => {
    try {
        const kycId = parseInt(req.params.id);
        const [kycs] = await pool.query('SELECT user_id FROM kyc_verifications WHERE id = ?', [kycId]);
        if (kycs.length === 0) return res.status(404).json({ success: false, message: 'Data KYC tidak ditemukan' });

        const userId = kycs[0].user_id;

        await pool.query('UPDATE users SET kyc_status = "verified" WHERE id = ?', [userId]);
        await pool.query('UPDATE kyc_verifications SET verified_at = NOW(), rejection_reason = NULL, verified_by = 3 WHERE id = ?', [kycId]);

        res.json({ success: true, message: 'Verifikasi identitas KTP pengguna berhasil disetujui!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Approve KYC error', error: err.message });
    }
});

router.post('/admin/kyc/:id/reject', async (req, res) => {
    try {
        const kycId = parseInt(req.params.id);
        const { reason } = req.body;

        const [kycs] = await pool.query('SELECT user_id FROM kyc_verifications WHERE id = ?', [kycId]);
        if (kycs.length === 0) return res.status(404).json({ success: false, message: 'Data KYC tidak ditemukan' });

        const userId = kycs[0].user_id;

        await pool.query('UPDATE users SET kyc_status = "rejected" WHERE id = ?', [userId]);
        await pool.query('UPDATE kyc_verifications SET rejection_reason = ?, verified_by = 3 WHERE id = ?', [reason || 'Foto KTP buram / tidak jelas.', kycId]);

        res.json({ success: true, message: 'Verifikasi identitas KTP ditolak dengan alasan.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Reject KYC error', error: err.message });
    }
});

// -------------------------------------------------------------
// 10. ADMIN WITHDRAWAL / PAYOUT MANAGEMENT
// -------------------------------------------------------------
router.get('/admin/withdrawals', async (req, res) => {
    try {
        const query = `
            SELECT 
                w.*,
                u.full_name,
                u.phone_number,
                u.email,
                u.role
            FROM wallet_withdrawals w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.created_at DESC
        `;
        const [rows] = await pool.query(query);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Get withdrawals error', error: err.message });
    }
});

// -------------------------------------------------------------
// 11. REVIEWS & RATINGS
// -------------------------------------------------------------
router.post('/orders/:id/review', async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { rating, comment, employer_id } = req.body;

        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orders[0];

        const rateVal = Math.min(5, Math.max(1, parseInt(rating) || 5));

        await pool.query('UPDATE orders SET rating = ?, review_comment = ? WHERE id = ?', [rateVal, comment || '', orderId]);

        await pool.query(`
            INSERT INTO reviews (order_id, employer_id, worker_id, rating, comment)
            VALUES (?, ?, ?, ?, ?)
        `, [orderId, order.employer_id, order.worker_id, rateVal, comment || '']);

        const [reviews] = await pool.query('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE worker_id = ?', [order.worker_id]);
        if (reviews.length > 0) {
            await pool.query('UPDATE worker_profiles SET rating_average = ?, rating_count = ? WHERE user_id = ?', [
                parseFloat(reviews[0].avg_rating).toFixed(1),
                reviews[0].count,
                order.worker_id
            ]);
        }

        res.json({ success: true, message: 'Terima kasih! Ulasan bintang berhasil dikirim untuk mitra tukang.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Review error', error: err.message });
    }
});

// -------------------------------------------------------------
// 12. TUKANG WITHDRAW SALDO DOMPET
// -------------------------------------------------------------
router.post('/wallet/withdraw', async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const { user_id, amount, bank_name, account_number, account_holder } = req.body;
        const withdrawAmount = parseFloat(amount);

        if (withdrawAmount < 50000) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: 'Minimal penarikan saldo adalah Rp50.000.' });
        }

        const [users] = await connection.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [user_id]);
        if (users.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const user = users[0];
        if (user.wallet_balance < withdrawAmount) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ success: false, message: 'Saldo dompet tidak mencukupi untuk penarikan ini.' });
        }

        await connection.query('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [withdrawAmount, user_id]);

        await connection.query(`
            INSERT INTO wallet_withdrawals (user_id, amount, bank_name, account_number, account_holder, status)
            VALUES (?, ?, ?, ?, ?, 'approved')
        `, [user_id, withdrawAmount, bank_name || 'BCA', account_number || '1234567890', account_holder || user.full_name]);

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `Permintaan penarikan Rp${withdrawAmount.toLocaleString('id-ID')} berhasil diproses ke rekening ${bank_name}!`,
            remaining_balance: user.wallet_balance - withdrawAmount
        });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ success: false, message: 'Withdrawal error', error: err.message });
    }
});

// -------------------------------------------------------------
// 13. SPATIAL RADAR TUKANG (HAVERSINE)
// -------------------------------------------------------------
router.get('/workers/nearby', async (req, res) => {
    try {
        const { lat, lon, radius_km = 20, category } = req.query;
        const userLat = parseFloat(lat) || -6.917500;
        const userLon = parseFloat(lon) || 107.619150;
        const maxRadius = parseFloat(radius_km);

        let query = `
            SELECT 
                wp.*,
                u.full_name,
                u.avatar_url,
                (6371 * acos(
                    cos(radians(?)) * cos(radians(wp.current_latitude)) * 
                    cos(radians(wp.current_longitude) - radians(?)) + 
                    sin(radians(?)) * sin(radians(wp.current_latitude))
                )) AS distance_km
            FROM worker_profiles wp
            JOIN users u ON wp.user_id = u.id
            WHERE wp.is_available = 1
        `;
        const params = [userLat, userLon, userLat];

        if (category) {
            query += ` AND wp.category = ?`;
            params.push(category);
        }

        query += ` HAVING distance_km <= ? ORDER BY distance_km ASC`;
        params.push(maxRadius);

        const [rows] = await pool.query(query, params);

        const formatted = rows.map(r => ({
            user_id: r.user_id,
            full_name: r.full_name,
            avatar_url: r.avatar_url,
            category: r.category,
            experience_years: r.experience_years,
            daily_rate: parseFloat(r.daily_rate),
            rating_average: parseFloat(r.rating_average),
            rating_count: r.rating_count,
            distance_km: Math.round(r.distance_km * 10) / 10
        }));

        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Spatial query failed', error: err.message });
    }
});

// GET USER PROFILE
router.get('/auth/profile/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const [users] = await pool.query(`
            SELECT u.id, u.phone_number, u.email, u.full_name, u.avatar_url, u.role, u.kyc_status, u.wallet_balance, u.created_at,
                   wp.category, wp.experience_years, wp.daily_rate, wp.hourly_rate, wp.rating_average, wp.rating_count,
                   k.id_card_number_encrypted
            FROM users u
            LEFT JOIN worker_profiles wp ON wp.user_id = u.id
            LEFT JOIN kyc_verifications k ON k.user_id = u.id
            WHERE u.id = ?
        `, [userId]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const user = users[0];
        let decryptedNik = null;
        if (user.id_card_number_encrypted) {
            decryptedNik = decryptData(user.id_card_number_encrypted);
        }

        res.json({
            success: true,
            data: {
                ...user,
                nik: decryptedNik ? decryptedNik.replace(/(\d{6})\d{6}(\d{4})/, '$1******$2') : '3204********0001',
                full_nik_masked: decryptedNik ? decryptedNik.replace(/\d(?=\d{4})/g, "*") : '************0001'
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Get profile failed', error: err.message });
    }
});

// UPDATE USER PROFILE
router.put('/auth/profile/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { full_name, email, phone_number, category, daily_rate, avatar_url } = req.body;

        await pool.query(`
            UPDATE users 
            SET full_name = ?, email = ?, phone_number = ?, avatar_url = IFNULL(?, avatar_url)
            WHERE id = ?
        `, [full_name, email, phone_number, avatar_url || null, userId]);

        if (category || daily_rate) {
            await pool.query(`
                UPDATE worker_profiles
                SET category = IFNULL(?, category), daily_rate = IFNULL(?, daily_rate)
                WHERE user_id = ?
            `, [category || null, daily_rate ? parseFloat(daily_rate) : null, userId]);
        }

        const [updated] = await pool.query('SELECT id, phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance FROM users WHERE id = ?', [userId]);

        res.json({
            success: true,
            message: 'Profil berhasil diperbarui di database!',
            data: updated[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Update profile failed', error: err.message });
    }
});

// Cron Auto-Release Trigger Endpoint
router.post('/orders/cron/auto-release', async (req, res) => {
    try {
        const [orders] = await pool.query(`
            SELECT id, worker_id, total_amount 
            FROM orders 
            WHERE status = 'work_submitted' 
            AND work_submitted_at <= NOW() - INTERVAL 24 HOUR
        `);

        if (orders.length === 0) {
            return res.json({ success: true, message: 'Tidak ada order yang melewati batas waktu 24 jam.' });
        }

        for (const order of orders) {
            const [escrows] = await pool.query('SELECT * FROM escrow_transactions WHERE order_id = ? AND status = "holding"', [order.id]);
            if (escrows.length > 0) {
                const escrow = escrows[0];
                await pool.query('UPDATE escrow_transactions SET status = "released", released_at = NOW() WHERE id = ?', [escrow.id]);
                await pool.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [escrow.worker_net_income, order.worker_id]);
                await pool.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE role = "admin"', [escrow.platform_cut]);
            }
            await pool.query(`
                UPDATE orders 
                SET status = "completed", 
                    completed_at = NOW(), 
                    warranty_until = NOW() + INTERVAL 14 DAY, 
                    updated_at = NOW() 
                WHERE id = ?
            `, [order.id]);
        }

        res.json({ success: true, message: `Auto-release berhasil memproses ${orders.length} order.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Cron error', error: err.message });
    }
});

module.exports = router;
