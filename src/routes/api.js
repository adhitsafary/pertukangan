const express = require('express');
const router = express.Router();
const pool = require('../config/mysql');
const { validateGeofence, calculateHaversineDistance } = require('../services/spatialService');
const { encryptData, decryptData, generatePresignedUrl } = require('../services/encryptionService');
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
// 0. AUTH & OTP EMAIL SYSTEM (LOGIN / REGISTER VIA EMAIL OTP)
// -------------------------------------------------------------

// REQUEST OTP EMAIL
router.post('/auth/request-otp', async (req, res) => {
    try {
        const { email, type } = req.body; // type: 'login' | 'register'

        if (!email) {
            return res.status(400).json({ success: false, message: 'Alamat email wajib diisi.' });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Cek user jika tipe login
        if (type === 'login') {
            const [users] = await pool.query('SELECT id, full_name, email FROM users WHERE email = ?', [cleanEmail]);
            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Email belum terdaftar. Silakan lakukan pendaftaran akun baru terlebih dahulu.'
                });
            }
        }

        // Cek user jika tipe register
        if (type === 'register') {
            const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
            if (users.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Email sudah terdaftar. Silakan langsung masuk di halaman login.'
                });
            }
        }

        // Generate 6-Digit OTP Code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Nonaktifkan OTP lama yang belum terpakai untuk email ini
        await pool.query('UPDATE email_otps SET is_used = 1 WHERE email = ?', [cleanEmail]);

        // Simpan OTP baru ke MySQL (Berlaku 10 Menit)
        await pool.query(`
            INSERT INTO email_otps (email, otp_code, type, expires_at, is_used)
            VALUES (?, ?, ?, NOW() + INTERVAL 10 MINUTE, 0)
        `, [cleanEmail, otpCode, type || 'login']);

        // Dispatch Email Asli via SMTP / Sendmail (background)
        sendOtpEmail(cleanEmail, otpCode, type || 'login');

        res.json({
            success: true,
            message: `Kode OTP 6-digit telah dikirim ke ${cleanEmail}. (Mode Instan / Fallback: Kode OTP Anda adalah ${otpCode})`,
            otp_code: otpCode,
            expires_in_minutes: 10
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal mengirim OTP email', error: err.message });
    }
});

// VERIFY OTP & LOGIN
router.post('/auth/verify-login-otp', async (req, res) => {
    try {
        const { email, otp_code } = req.body;

        if (!email || !otp_code) {
            return res.status(400).json({ success: false, message: 'Email dan kode OTP wajib diisi.' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanOtp = otp_code.trim();

        // Validasi OTP di Database
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

        // Tandai OTP sebagai sudah digunakan
        await pool.query('UPDATE email_otps SET is_used = 1 WHERE id = ?', [otps[0].id]);

        // Ambil data User dari MySQL
        const [users] = await pool.query(`
            SELECT id, phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance 
            FROM users WHERE email = ?
        `, [cleanEmail]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
        }

        const user = users[0];

        res.json({
            success: true,
            message: 'Verifikasi OTP berhasil! Selamat datang kembali.',
            data: user
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Verifikasi OTP gagal', error: err.message });
    }
});

// VERIFY OTP & REGISTER NEW ACCOUNT
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

        // 1. Validasi OTP di MySQL
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
                message: 'Kode OTP tidak valid atau sudah kedaluwarsa. Silakan minta kode baru.'
            });
        }

        // Tandai OTP digunakan
        await connection.query('UPDATE email_otps SET is_used = 1 WHERE id = ?', [otps[0].id]);

        // 2. Cek duplikasi
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

        // 3. Insert User
        const [userResult] = await connection.query(`
            INSERT INTO users (phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance)
            VALUES (?, ?, ?, ?, ?, 'verified', 0.00)
        `, [phone_number, cleanEmail, full_name, avatar, role || 'employer']);

        const newUserId = userResult.insertId;

        // 4. Insert Encrypted NIK (UU PDP)
        if (nik) {
            const encryptedNik = encryptData(nik);
            await connection.query(`
                INSERT INTO kyc_verifications (user_id, id_card_number_encrypted, id_card_photo_path, selfie_photo_path, verified_at)
                VALUES (?, ?, '/uploads/kyc/default_ktp.jpg', '/uploads/kyc/default_selfie.jpg', NOW())
            `, [newUserId, encryptedNik]);
        }

        // 5. Insert Worker Profile if Worker
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
            message: 'Verifikasi OTP berhasil & Akun tersimpan permanen di database MySQL!',
            data: newUser
        });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ success: false, message: 'Registrasi via OTP gagal', error: err.message });
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

// -------------------------------------------------------------
// 1. GET ALL ORDERS
// -------------------------------------------------------------
router.get('/orders', async (req, res) => {
    try {
        const { employer_id, worker_id } = req.query;

        let query = `
            SELECT 
                o.*,
                u_emp.full_name AS employer_name,
                u_wrk.full_name AS worker_name,
                e.id AS escrow_id,
                e.payment_gateway_ref,
                e.platform_cut,
                e.worker_net_income,
                e.status AS escrow_status
            FROM orders o
            LEFT JOIN users u_emp ON o.employer_id = u_emp.id
            LEFT JOIN users u_wrk ON o.worker_id = u_wrk.id
            LEFT JOIN escrow_transactions e ON e.order_id = o.id
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
            worker_name: r.worker_name || 'Tukang Belum Dipilih',
            escrow: r.escrow_id ? {
                id: r.escrow_id,
                payment_gateway_ref: r.payment_gateway_ref,
                platform_cut: parseFloat(r.platform_cut),
                worker_net_income: parseFloat(r.worker_net_income),
                status: r.escrow_status
            } : null
        }));

        res.json({ success: true, data: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database query failed', error: err.message });
    }
});

// -------------------------------------------------------------
// 2. CREATE NEW ORDER (DRAFT -> WAITING_ESCROW)
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
// 3. PAYMENT WEBHOOK HANDLER
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
// 4. TUKANG MULAI KERJA (GEOFENCING + FOTO BEFORE)
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
// 5. TUKANG SUBMIT SELESAI KERJA (FOTO AFTER)
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
                message: 'Wajib menyertakan minimal 2 foto bukti hasil pekerjaan!'
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
            message: 'Laporan hasil kerja (Foto After) berhasil diunggah. Menunggu konfirmasi klien atau garansi auto-release 24 jam.',
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
// 7. RATING & ULASAN DARI WARGA
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
// 8. TUKANG PENARIKAN SALDO DOMPET (WITHDRAWAL)
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
// 9. CRON AUTO RELEASE & SPATIAL RADAR
// -------------------------------------------------------------
router.post('/orders/cron/auto-release', async (req, res) => {
    try {
        const [orders] = await pool.query(`
            SELECT o.*, e.id AS escrow_id, e.worker_net_income, e.platform_cut
            FROM orders o
            JOIN escrow_transactions e ON e.order_id = o.id
            WHERE o.status = 'work_submitted' 
              AND o.work_submitted_at <= NOW() - INTERVAL 24 HOUR
              AND e.status = 'holding'
        `);

        const releasedList = [];

        for (const o of orders) {
            const conn = await pool.getConnection();
            await conn.beginTransaction();
            try {
                await conn.query('UPDATE escrow_transactions SET status = "released", released_at = NOW() WHERE id = ?', [o.escrow_id]);
                await conn.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [o.worker_net_income, o.worker_id]);
                await conn.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE role = "admin"', [o.platform_cut]);
                await conn.query('UPDATE orders SET status = "completed", completed_at = NOW(), warranty_until = NOW() + INTERVAL 14 DAY, updated_at = NOW() WHERE id = ?', [o.id]);
                
                await conn.commit();
                conn.release();

                releasedList.push(o.order_code);
            } catch (err) {
                await conn.rollback();
                conn.release();
            }
        }

        res.json({
            success: true,
            message: `Background Cron Worker Selesai: ${releasedList.length} pesanan otomatis di-release ke dompet tukang.`,
            released_orders: releasedList
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Cron worker error', error: err.message });
    }
});

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

module.exports = router;
