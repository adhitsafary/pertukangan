# MITRATUKANG PLATFORM 🏗️🔨
### On-Demand & Bidding Marketplace Jasa Konstruksi & Pertukangan (Harian & Borongan)

Sistem marketplace digital terintegrasi untuk menghubungkan Pemberi Kerja (Klien/Mandor), Tenaga Kerja Konstruksi (Tukang/Kuli), dan Administrator dengan sistem **Rekening Bersama (Escrow)**, **Geofencing GPS Tracking**, **Verifikasi Identitas (KYC)**, dan **Resolusi Sengketa (Dispute Resolution)**.

---

## 🚀 FITUR UTAMA & ARSITEKTUR SISTEM

1. **State Machine Order & Escrow yang Ketat:**
   - `DRAFT` ➔ `PENDING_ACCEPTANCE` / `OPEN_BIDDING` ➔ `WAITING_ESCROW` ➔ `ESCROW_HELD` ➔ `IN_PROGRESS` (Geofence Validation < 50m) ➔ `WORK_SUBMITTED` ➔ `AUTO_RELEASE_WINDOW` (24 Jam) ➔ `COMPLETED` / `IN_DISPUTE` ➔ `REFUNDED`.
2. **Kepatuhan UU Pelindungan Data Pribadi (UU PDP):**
   - Enkripsi AES-256 tingkat kolom untuk data sensitif KTP/NIK.
   - Presigned Temporary URLs untuk dokumen privasi.
3. **Pencarian Tukang Berbasis Spatial / Geolokasi:**
   - Implementasi Haversine Formula & Bounding Box Indexing untuk radius pencarian terdekat dengan performa tinggi.
4. **Automated Scheduled Worker (Cron Job):**
   - Auto-release escrow setelah 24 jam tanpa respon sengketa dari klien.
5. **Dashboard Interaktif 3 Role:**
   - **Klien:** Buat order baru, bayar escrow (QRIS/VA simulation), konfirmasi selesai, ajukan dispute.
   - **Tukang:** Terima order, check-in lokasi mulai kerja (GPS), submit bukti foto lapangan.
   - **Admin:** Verifikasi KYC, monitoring transaksi escrow platform, mediasi dan eksekusi split/refund tiket sengketa.

---

## 🛠️ STRUKTUR DIREKTORI PROYEK

```
pertukangan/
├── public/                  # Frontend UI Modern (HTML5, Tailwind CSS, Vanilla JS)
│   ├── css/
│   ├── js/
│   └── index.html           # Single Page Application Dashboard 3-in-1
├── src/
│   ├── config/
│   │   └── database.js      # Relational DB Schema & Connection
│   ├── controllers/
│   │   ├── orderController.js
│   │   ├── escrowController.js
│   │   └── kycController.js
│   ├── middlewares/
│   │   ├── auth.js
│   │   └── encryption.js    # AES-256 Data Protection
│   ├── services/
│   │   ├── cronService.js   # 24H Auto-Release Background Worker
│   │   └── spatialService.js# Haversine Radius Algorithm
│   └── routes/
│       └── api.js           # RESTful Endpoints
├── database/
│   └── schema.sql           # Skema Database Relasional MySQL
├── .env.example
├── server.js                # Entry Point Express.js Backend
└── README.md
```

---

## ⚡ CARA MENJALANKAN SISTEM

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Jalankan Server:**
   ```bash
   npm start
   # atau node server.js
   ```

3. **Akses Dashboard:**
   Buka browser di `http://localhost:3000` (atau port publik tunnel yang ditentukan).

---

## 📋 ENDPOINT KRITIS API RESTFUL

- `POST /api/payment/webhook` - Webhook Midtrans/Xendit Payment Gateway untuk settlement escrow.
- `POST /api/orders/:id/start-work` - Validasi koordinat GPS Tukang & mulai kerja.
- `POST /api/orders/:id/submit-work` - Submit minimal 2 foto bukti hasil pekerjaan.
- `POST /api/orders/:id/release-escrow` - Konfirmasi klien & pencairan saldo ke dompet tukang.
- `POST /api/orders/cron/auto-release` - Background worker trigger auto-release 24 jam.
- `GET /api/workers/nearby` - Spatial query pencarian tukang terdekat berbasis koordinat.

---
© 2026 MitraTukang Platform - All Rights Reserved.
