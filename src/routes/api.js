const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { validateGeofence, calculateHaversineDistance } = require('../services/spatialService');
const { encryptData, decryptData, generatePresignedUrl } = require('../services/encryptionService');

// -------------------------------------------------------------
// 1. WEBHOOK PAYMENT HANDLER (Midtrans / Xendit Simulation)
// -------------------------------------------------------------
router.post('/payment/webhook', (req, res) => {
    const { order_id, transaction_status, gross_amount, transaction_id } = req.body;

    const order = db.orders.find(o => o.order_code === order_id || o.id === parseInt(order_id));
    if (!order) {
        return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    }

    if (transaction_status === 'settlement' || transaction_status === 'capture') {
        order.status = 'escrow_held';
        order.updated_at = new Date();

        // Hitung komisi platform 10%
        const platformCut = Math.round(order.base_price * 0.10);
        const workerNet = order.base_price - platformCut;

        // Catat mutasi escrow
        let escrow = db.escrow_transactions.find(e => e.order_id === order.id);
        if (!escrow) {
            escrow = {
                id: db.escrow_transactions.length + 1,
                order_id: order.id,
                payment_gateway_ref: transaction_id || `PG-${Date.now()}`,
                amount: order.total_amount,
                platform_cut: platformCut,
                worker_net_income: workerNet,
                status: 'holding',
                released_at: null,
                created_at: new Date()
            };
            db.escrow_transactions.push(escrow);
        } else {
            escrow.status = 'holding';
            escrow.payment_gateway_ref = transaction_id || escrow.payment_gateway_ref;
        }

        return res.json({
            success: true,
            message: `Payment settled. Order ${order.order_code} status updated to ESCROW_HELD.`,
            data: {
                order_status: order.status,
                escrow_status: escrow.status,
                worker_net_income: workerNet
            }
        });
    }

    res.json({ success: true, message: `Webhook processed with status: ${transaction_status}` });
});

// -------------------------------------------------------------
// 2. TUKANG MULAI KERJA (GEOFENCING VALIDATION < 50 METER)
// -------------------------------------------------------------
router.post('/orders/:id/start-work', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { worker_latitude, worker_longitude } = req.body;

    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
        return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    }

    if (order.status !== 'escrow_held') {
        return res.status(400).json({
            success: false,
            message: `Gagal mulai kerja. Status order harus ESCROW_HELD (Status saat ini: ${order.status})`
        });
    }

    // Validasi Geofencing < 50 meter
    const geoValidation = validateGeofence(
        parseFloat(worker_latitude),
        parseFloat(worker_longitude),
        order.latitude,
        order.longitude,
        50 // Max 50 meter
    );

    if (!geoValidation.isWithinRadius) {
        return res.status(422).json({
            success: false,
            message: `Check-in ditolak! Anda berada ${geoValidation.distanceMeters}m dari lokasi proyek (Maksimal radius 50m).`,
            distance_meters: geoValidation.distanceMeters
        });
    }

    order.status = 'in_progress';
    order.updated_at = new Date();

    res.json({
        success: true,
        message: 'Validasi geofence sukses. Pekerjaan resmi dimulai!',
        data: {
            order_id: order.id,
            status: order.status,
            distance_meters: geoValidation.distanceMeters
        }
    });
});

// -------------------------------------------------------------
// 3. TUKANG SUBMIT SELESAI KERJA (MINIMAL 2 BUKTI FOTO)
// -------------------------------------------------------------
router.post('/orders/:id/submit-work', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { evidence_photos, notes } = req.body;

    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
        return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    }

    if (order.status !== 'in_progress') {
        return res.status(400).json({
            success: false,
            message: `Gagal submit pekerjaan. Status harus IN_PROGRESS (Status saat ini: ${order.status})`
        });
    }

    if (!evidence_photos || !Array.isArray(evidence_photos) || evidence_photos.length < 2) {
        return res.status(422).json({
            success: false,
            message: 'Wajib mengunggah minimal 2 foto bukti hasil pekerjaan lapangan!'
        });
    }

    order.status = 'work_submitted';
    order.work_submitted_at = new Date();
    order.work_evidence_urls = evidence_photos;
    order.completion_notes = notes || '';
    order.updated_at = new Date();

    res.json({
        success: true,
        message: 'Laporan hasil kerja berhasil dikirim! Menunggu konfirmasi klien atau auto-release 24 jam.',
        data: {
            order_id: order.id,
            status: order.status,
            work_submitted_at: order.work_submitted_at,
            photos_count: evidence_photos.length
        }
    });
});

// -------------------------------------------------------------
// 4. KLIEN KONFIRMASI SELESAI (MANUAL RELEASE ESCROW)
// -------------------------------------------------------------
router.post('/orders/:id/release-escrow', (req, res) => {
    const orderId = parseInt(req.params.id);
    const order = db.orders.find(o => o.id === orderId);

    if (!order) {
        return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    }

    if (order.status !== 'work_submitted') {
        return res.status(400).json({
            success: false,
            message: `Order belum berstatus WORK_SUBMITTED (Status saat ini: ${order.status})`
        });
    }

    // Eksekusi pelepasan dana
    const escrow = db.escrow_transactions.find(e => e.order_id === order.id);
    if (escrow) {
        escrow.status = 'released';
        escrow.released_at = new Date();

        // Tambahkan saldo ke dompet tukang
        const worker = db.users.find(u => u.id === order.worker_id);
        if (worker) {
            worker.wallet_balance += escrow.worker_net_income;
        }

        // Tambahkan komisi ke admin platform
        const admin = db.users.find(u => u.role === 'admin');
        if (admin) {
            admin.wallet_balance += escrow.platform_cut;
        }
    }

    order.status = 'completed';
    order.completed_at = new Date();
    order.updated_at = new Date();

    res.json({
        success: true,
        message: 'Pekerjaan telah dikonfirmasi selesai! Dana escrow berhasil dicairkan ke saldo dompet tukang.',
        data: {
            order_id: order.id,
            status: order.status,
            escrow_released: escrow ? escrow.worker_net_income : 0
        }
    });
});

// -------------------------------------------------------------
// 5. TRIGGER BACKGROUND CRON JOB (AUTO-RELEASE 24 JAM)
// -------------------------------------------------------------
router.post('/orders/cron/auto-release', (req, res) => {
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const releasedOrders = [];

    db.orders.forEach(order => {
        if (order.status === 'work_submitted' && order.work_submitted_at) {
            const timePassed = now - new Date(order.work_submitted_at).getTime();
            
            // Cek apakah tidak ada sengketa (dispute) aktif
            const hasActiveDispute = db.dispute_tickets.some(d => d.order_id === order.id && d.status === 'open');

            if (timePassed >= twentyFourHoursMs && !hasActiveDispute) {
                // Auto Release
                order.status = 'completed';
                order.completed_at = new Date();
                order.updated_at = new Date();

                const escrow = db.escrow_transactions.find(e => e.order_id === order.id);
                if (escrow && escrow.status === 'holding') {
                    escrow.status = 'released';
                    escrow.released_at = new Date();

                    const worker = db.users.find(u => u.id === order.worker_id);
                    if (worker) {
                        worker.wallet_balance += escrow.worker_net_income;
                    }

                    const admin = db.users.find(u => u.role === 'admin');
                    if (admin) {
                        admin.wallet_balance += escrow.platform_cut;
                    }
                }

                releasedOrders.push({
                    order_code: order.order_code,
                    worker_id: order.worker_id,
                    amount_released: escrow ? escrow.worker_net_income : 0
                });
            }
        }
    });

    res.json({
        success: true,
        message: `Cron Worker Finished: ${releasedOrders.length} order(s) auto-released.`,
        processed_count: releasedOrders.length,
        released_orders: releasedOrders
    });
});

// -------------------------------------------------------------
// 6. SPATIAL QUERY: PENCARIAN TUKANG TERDEKAT (HAVERSINE)
// -------------------------------------------------------------
router.get('/workers/nearby', (req, res) => {
    const { lat, lon, radius_km = 15, category } = req.query;

    if (!lat || !lon) {
        return res.status(400).json({ success: false, message: 'Parameter lat dan lon wajib disertakan.' });
    }

    const userLat = parseFloat(lat);
    const userLon = parseFloat(lon);
    const maxRadiusMeters = parseFloat(radius_km) * 1000;

    const nearbyWorkers = [];

    db.worker_profiles.forEach(profile => {
        if (!profile.is_available) return;
        if (category && profile.category !== category) return;

        const distanceMeters = calculateHaversineDistance(
            userLat,
            userLon,
            profile.current_latitude,
            profile.current_longitude
        );

        if (distanceMeters <= maxRadiusMeters) {
            const user = db.users.find(u => u.id === profile.user_id);
            nearbyWorkers.push({
                user_id: profile.user_id,
                full_name: user ? user.full_name : 'Tukang',
                avatar_url: user ? user.avatar_url : '',
                category: profile.category,
                experience_years: profile.experience_years,
                daily_rate: profile.daily_rate,
                hourly_rate: profile.hourly_rate,
                rating_average: profile.rating_average,
                rating_count: profile.rating_count,
                distance_km: Math.round((distanceMeters / 1000) * 10) / 10,
                coordinates: {
                    latitude: profile.current_latitude,
                    longitude: profile.current_longitude
                }
            });
        }
    });

    // Urutkan berdasarkan jarak terdekat
    nearbyWorkers.sort((a, b) => a.distance_km - b.distance_km);

    res.json({
        success: true,
        count: nearbyWorkers.length,
        data: nearbyWorkers
    });
});

// -------------------------------------------------------------
// 7. GET LIST ORDERS & USERS (UNTUK DASHBOARD DEMO)
// -------------------------------------------------------------
router.get('/orders', (req, res) => {
    const enriched = db.orders.map(o => {
        const emp = db.users.find(u => u.id === o.employer_id);
        const wrk = db.users.find(u => u.id === o.worker_id);
        const esc = db.escrow_transactions.find(e => e.order_id === o.id);
        return {
            ...o,
            employer_name: emp ? emp.full_name : 'Klien',
            worker_name: wrk ? wrk.full_name : 'Tukang Belum Dipilih',
            escrow: esc || null
        };
    });
    res.json({ success: true, data: enriched });
});

router.get('/users', (req, res) => {
    res.json({ success: true, data: db.users });
});

// Buat order baru
router.post('/orders', (req, res) => {
    const { employer_id, title, description, job_type, address, latitude, longitude, base_price, worker_id } = req.body;
    
    const adminFee = 10000;
    const base = parseFloat(base_price) || 200000;
    const total = base + adminFee;

    const newOrder = {
        id: db.orders.length + 1,
        order_code: `MTK-${Date.now().toString().slice(-6)}`,
        employer_id: parseInt(employer_id) || 1,
        worker_id: worker_id ? parseInt(worker_id) : 2,
        title,
        description,
        job_type: job_type || 'daily',
        address,
        latitude: parseFloat(latitude) || -6.917500,
        longitude: parseFloat(longitude) || 107.619150,
        base_price: base,
        admin_fee: adminFee,
        total_amount: total,
        status: 'waiting_escrow',
        work_submitted_at: null,
        work_evidence_urls: [],
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date()
    };

    db.orders.unshift(newOrder);

    res.json({
        success: true,
        message: 'Order berhasil dibuat! Menunggu pembayaran rekening bersama (Escrow).',
        data: newOrder
    });
});

module.exports = router;
