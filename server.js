require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const { seedDatabase } = require('./src/config/seed');
const { CronJob } = require('cron');
const pool = require('./src/config/mysql');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Specific Role Dashboard & Public Routes
app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/warga', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'warga.html'));
});

app.get('/tukang', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tukang.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API Routes
app.use('/api', apiRoutes);

// Default Route (/) -> Menampilkan Dashboard Terpadu Interaktif (index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Setup 24H Auto-Release Background Cron Job (Runs every 10 minutes)
const autoReleaseJob = new CronJob('*/10 * * * *', async () => {
    try {
        const [orders] = await pool.query(`
            SELECT o.*, e.id AS escrow_id, e.worker_net_income, e.platform_cut
            FROM orders o
            JOIN escrow_transactions e ON e.order_id = o.id
            WHERE o.status = 'work_submitted' 
              AND o.work_submitted_at <= NOW() - INTERVAL 24 HOUR
              AND e.status = 'holding'
        `);

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
                console.log(`[CRON] Order ${o.order_code} auto-released successfully.`);
            } catch (err) {
                await conn.rollback();
                conn.release();
            }
        }
    } catch (err) {
        console.error('[CRON ERROR]', err);
    }
});

// Start Server & Initialize Database
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`=======================================================`);
    console.log(`🏗️  MitraTukang Enterprise - Production Server Active`);
    console.log(`📊 Dashboard Terpadu: http://0.0.0.0:${PORT}/`);
    console.log(`🌐 Landing Page:     http://0.0.0.0:${PORT}/landing`);
    console.log(`📝 Register:         http://0.0.0.0:${PORT}/register`);
    console.log(`🚀 Portal Login:     http://0.0.0.0:${PORT}/login`);
    console.log(`🏠 Portal Warga:     http://0.0.0.0:${PORT}/warga`);
    console.log(`🔨 Portal Tukang:    http://0.0.0.0:${PORT}/tukang`);
    console.log(`🏛️  Portal Admin:     http://0.0.0.0:${PORT}/admin`);
    console.log(`=======================================================`);
    
    await seedDatabase();
    autoReleaseJob.start();
});
