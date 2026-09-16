// In-memory Database Store dengan Relational Mocking & Seeding Awal
const { encryptData } = require('../services/encryptionService');

const db = {
    users: [
        {
            id: 1,
            phone_number: '081234567890',
            email: 'budi.klien@gmail.com',
            full_name: 'Budi Santoso (Klien)',
            avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            role: 'employer',
            kyc_status: 'verified',
            wallet_balance: 5000000.00,
            is_active: true,
            created_at: new Date('2026-01-10T08:00:00Z')
        },
        {
            id: 2,
            phone_number: '085711223344',
            email: 'ahmad.tukang@gmail.com',
            full_name: 'Ahmad Supriyadi (Tukang Ahli Kayu & Batu)',
            avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
            role: 'worker',
            kyc_status: 'verified',
            wallet_balance: 750000.00,
            is_active: true,
            created_at: new Date('2026-01-15T09:30:00Z')
        },
        {
            id: 3,
            phone_number: '089988776655',
            email: 'admin@mitratukang.id',
            full_name: 'Super Administrator',
            avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
            role: 'admin',
            kyc_status: 'verified',
            wallet_balance: 1540000.00, // Saldo komisi platform
            is_active: true,
            created_at: new Date('2026-01-01T00:00:00Z')
        },
        {
            id: 4,
            phone_number: '081399882211',
            email: 'joko.pipa@gmail.com',
            full_name: 'Joko Widodo (Spesialis Pipa & Listrik)',
            avatar_url: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150',
            role: 'worker',
            kyc_status: 'verified',
            wallet_balance: 420000.00,
            is_active: true,
            created_at: new Date('2026-02-01T10:00:00Z')
        }
    ],

    kyc_verifications: [
        {
            id: 1,
            user_id: 2,
            id_card_number_encrypted: encryptData('3204123456780001'),
            id_card_photo_path: '/uploads/kyc/ktp_ahmad.jpg',
            selfie_photo_path: '/uploads/kyc/selfie_ahmad.jpg',
            verified_by: 3,
            rejection_reason: null,
            verified_at: new Date('2026-01-16T10:00:00Z'),
            created_at: new Date('2026-01-15T09:35:00Z')
        }
    ],

    worker_profiles: [
        {
            id: 1,
            user_id: 2,
            category: 'kayu',
            experience_years: 6,
            hourly_rate: 35000.00,
            daily_rate: 200000.00,
            current_latitude: -6.917464, // Kota Bandung
            current_longitude: 107.619123,
            is_available: true,
            rating_average: 4.9,
            rating_count: 24,
            created_at: new Date('2026-01-15T09:30:00Z')
        },
        {
            id: 2,
            user_id: 4,
            category: 'pipa',
            experience_years: 4,
            hourly_rate: 30000.00,
            daily_rate: 180000.00,
            current_latitude: -6.914744,
            current_longitude: 107.609810,
            is_available: true,
            rating_average: 4.8,
            rating_count: 18,
            created_at: new Date('2026-02-01T10:00:00Z')
        }
    ],

    orders: [
        {
            id: 1,
            order_code: 'MTK-202609-001',
            employer_id: 1,
            worker_id: 2,
            title: 'Perbaikan Atap Bocor & Plafon Kayu Ruang Tamu',
            description: 'Perbaikan plafon kayu yang keropos akibat bocor atap genteng, estimasi kerja 1 hari penuh.',
            job_type: 'daily',
            address: 'Jl. Riau No. 45, Citarum, Bandung',
            latitude: -6.917500,
            longitude: 107.619150,
            base_price: 250000.00,
            admin_fee: 10000.00,
            total_amount: 260000.00,
            status: 'in_progress', // sedang dikerjakan
            work_submitted_at: null,
            work_evidence_urls: [],
            completed_at: null,
            created_at: new Date(Date.now() - 3600000 * 3),
            updated_at: new Date(Date.now() - 3600000 * 2)
        },
        {
            id: 2,
            order_code: 'MTK-202609-002',
            employer_id: 1,
            worker_id: 2,
            title: 'Instalasi Keramik Kamar Mandi 3x2m',
            description: 'Pemasangan keramik lantai dan dinding baru.',
            job_type: 'project_based',
            address: 'Jl. Dago Asri No. 12, Bandung',
            latitude: -6.885000,
            longitude: 107.615000,
            base_price: 600000.00,
            admin_fee: 10000.00,
            total_amount: 610000.00,
            status: 'work_submitted', // selesai, menunggu auto-release / konfirmasi klien
            work_submitted_at: new Date(Date.now() - 3600000 * 25), // Lebih dari 24 jam lalu untuk demo auto-release
            work_evidence_urls: [
                'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400',
                'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?w=400'
            ],
            completed_at: null,
            created_at: new Date(Date.now() - 3600000 * 30),
            updated_at: new Date(Date.now() - 3600000 * 25)
        }
    ],

    escrow_transactions: [
        {
            id: 1,
            order_id: 1,
            payment_gateway_ref: 'PG-MIDTRANS-SETTLE-88912',
            amount: 260000.00,
            platform_cut: 25000.00, // 10% dari base + fee
            worker_net_income: 235000.00,
            status: 'holding',
            released_at: null,
            created_at: new Date(Date.now() - 3600000 * 3)
        },
        {
            id: 2,
            order_id: 2,
            payment_gateway_ref: 'PG-MIDTRANS-SETTLE-99012',
            amount: 610000.00,
            platform_cut: 60000.00,
            worker_net_income: 550000.00,
            status: 'holding',
            released_at: null,
            created_at: new Date(Date.now() - 3600000 * 30)
        }
    ],

    dispute_tickets: []
};

module.exports = db;
