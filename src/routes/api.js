const express = require('express');
const router = express.Router();
const pool = require('../config/mysql');
const { validateGeofence, calculateHaversineDistance } = require('../services/spatialService');
const { encryptData, decryptData, generatePresignedUrl } = require('../services/encryptionService');

// -------------------------------------------------------------
// 0. AUTH LOGIN ENDPOINT (VERIFIKASI EMAIL/PHONE & PASSWORD)
// -------------------------------------------------------------
router.post('/auth/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: 'Email/No. HP dan Password wajib diisi.' });
        }

        const [users] = await pool.query(`
            SELECT id, phone_number, email, full_name, avatar_url, role, kyc_status, wallet_balance, password 
            FROM users 
            WHERE email = ? OR phone_number = ?
        `, [identifier, identifier]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Akun dengan email/nomor HP tersebut tidak ditemukan.' });
        }

        const user = users[0];

        // Validasi password (default demo '123456' atau password di DB)
        if (user.password && user.password !== password) {
            return res.status(401).json({ success: false, message: 'Password salah. Silakan coba lagi.' });
        }

        // Hapus field password dari response
        delete user.password;

        res.json({
            success: true,
            message: 'Login berhasil!',
            data: user
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Auth server error', error: err.message });
    }
});

// -------------------------------------------------------------
// 1. GET ALL ORDERS (WITH RELATIONAL JOINS)
// -------------------------------------------------------------
router.get('/orders', async (req, res) => {
    try {
        const query = `
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
            ORDER BY o.created_at DESC
        `;
        const [rows] = await pool.query(query);

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
// 3. PAYMENT WEBHOOK HANDLER (SETTLE ESCROW TRANSACTION)
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
// 4. TUKANG MULAI KERJA (GEOFENCING VALIDATION < 50 METER)
// -------------------------------------------------------------
router.post('/orders/:id/start-work', async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { worker_latitude, worker_longitude } = req.body;

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

        await pool.query('UPDATE orders SET status = "in_progress", updated_at = NOW() WHERE id = ?', [orderId]);

        res.json({
            success: true,
            message: 'Validasi geofence GPS sukses. Pekerjaan lapangan resmi dimulai!',
            data: { order_id: orderId, status: 'in_progress', distance_meters: geoValidation.distanceMeters }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Start work error', error: err.message });
    }
});

// -------------------------------------------------------------
// 5. TUKANG SUBMIT SELESAI KERJA (MINIMAL 2 FOTO)
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

        await pool.query('UPDATE orders SET status = "work_submitted", work_submitted_at = NOW(), updated_at = NOW() WHERE id = ?', [orderId]);

        res.json({
            success: true,
            message: 'Laporan hasil kerja berhasil disimpan di MySQL. Menunggu konfirmasi klien atau auto-release 24 jam.',
            data: { order_id: orderId, status: 'work_submitted' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Submit work error', error: err.message });
    }
});

// -------------------------------------------------------------
// 6. KLIEN MANUAL RELEASE ESCROW
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

        await connection.query('UPDATE orders SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [orderId]);

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: 'Pekerjaan telah disetujui! Dana escrow berhasil ditransfer ke saldo dompet tukang di MySQL.',
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
// 7. CRON WORKER: 24-HOUR AUTO RELEASE
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
                await conn.query('UPDATE orders SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [o.id]);
                
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

// -------------------------------------------------------------
// 8. SPATIAL WORKER RADAR (HAVERSINE ALGORITHM FROM MYSQL)
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

module.exports = router;
