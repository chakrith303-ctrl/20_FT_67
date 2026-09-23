// ============================================================
// index.js — Entry point ของระบบ
// รวม: หน้าเว็บ (public/), /auth/google/* (login), /api/* (ข้อมูล)
// Deploy บน Render: Build = `npm ci`, Start = `npm start`
// เริ่มทำงาน: ตรวจค่า env → migrate ฐานข้อมูล → เปิด server
// ============================================================

require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const { pool } = require('./db');
const { migrate } = require('./migrate');
const { router: googleAuthRouter } = require('./auth-google');
const { router: apiRouter, requireFetchHeader } = require('./routes-api');

const isProduction = process.env.NODE_ENV === 'production';

// ---------- ตรวจค่าตั้งค่าที่จำเป็น (ขาด = ไม่เปิด server) ----------
function checkEnv() {
    const required = ['DATABASE_URL', 'SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`ยังไม่ได้ตั้งค่า: ${missing.join(', ')}`);
    if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
}

const app = express();
app.set('trust proxy', 1); // Render อยู่หลัง proxy → ให้ cookie secure ทำงาน
app.disable('x-powered-by');

// ---------- Security headers ----------
app.use((req, res, next) => {
    res.set({
        'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
    });
    next();
});

app.use(express.json({ limit: '1mb' }));

// ---------- Session: cookie ที่เซ็นด้วย SESSION_SECRET (แก้ไขฝั่ง browser ไม่ได้) ----------
app.use(cookieSession({
    name: 'sid',
    keys: [process.env.SESSION_SECRET || 'dev-only-secret-change-me-please-32ch'],
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000, // 8 ชั่วโมง
}));

// ---------- Health check — Render/GitHub Actions เรียก URL นี้ (แตะฐานข้อมูลด้วย กัน Supabase พัก) ----------
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', time: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'db_unavailable' });
    }
});

// ---------- Routes ----------
app.use('/auth/logout', requireFetchHeader);
app.use('/', googleAuthRouter);
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
    checkEnv();
    await migrate();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

if (require.main === module) {
    start().catch((err) => {
        console.error('เริ่มระบบไม่สำเร็จ:', err.message);
        process.exit(1);
    });
}

module.exports = { app };
