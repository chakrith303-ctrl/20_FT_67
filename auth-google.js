// ============================================================
// auth-google.js — เข้าสู่ระบบด้วย Google (OAuth 2.0 / OpenID Connect)
//
// ขั้นตอน: ผู้ใช้กด "เข้าสู่ระบบ" → /auth/google/start → หน้ายินยอมของ Google
//         → /auth/google/callback → server ตรวจ ID token → เก็บตัวตนใน session cookie
//
// ความปลอดภัย:
// - state + nonce สุ่มใหม่ทุกครั้ง เก็บใน session cookie ที่เซ็นแล้ว และตรวจตอน callback
//   (กันการปลอม callback / ผูกบัญชีผิดคน)
// - อีเมลใช้ได้เฉพาะเมื่อ Google ยืนยันแล้ว (email_verified)
// - ตัวตนผู้ใช้มาจาก session ฝั่ง server เท่านั้น ไม่รับจาก query/body
// ============================================================

const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { withUser } = require('./db');

const router = express.Router();

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

function googleClient() {
    return new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

function randomToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- STEP 1: ไปหน้าเลือกบัญชี Google ----------
router.get('/auth/google/start', (req, res) => {
    const state = randomToken();
    const nonce = randomToken();
    req.session.oauth = { state, nonce, at: Date.now() };

    const params = {
        scope: ['openid', 'email', 'profile'],
        state,
        nonce,
        prompt: 'select_account',
    };
    const hostedDomain = (process.env.GOOGLE_HOSTED_DOMAIN || '').trim();
    if (hostedDomain && hostedDomain !== '-') params.hd = hostedDomain;

    res.redirect(googleClient().generateAuthUrl(params));
});

// ---------- STEP 2: Google ส่งกลับมาพร้อม code ----------
router.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;
    const saved = req.session.oauth;
    req.session.oauth = null; // ใช้ได้ครั้งเดียว

    if (!code || !state || !saved || !safeEqual(state, saved.state) || Date.now() - saved.at > LOGIN_TIMEOUT_MS) {
        return res.status(400).send('การเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง <a href="/">ลองใหม่</a>');
    }

    try {
        const client = googleClient();
        const { tokens } = await client.getToken(String(code));
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const p = ticket.getPayload();

        if (!p || !p.sub || !p.email || p.email_verified !== true || !safeEqual(p.nonce || '', saved.nonce)) {
            return res.status(403).send('บัญชี Google นี้ใช้เข้าสู่ระบบไม่ได้ <a href="/">กลับ</a>');
        }

        req.session.user = { sub: p.sub, email: p.email.toLowerCase(), name: p.name || '' };

        // ผูกบัญชีที่ผู้ดูแลสร้างไว้ล่วงหน้า + บันทึก last_login
        await withUser(req.session.user, (db) => db.query('SELECT public.session_login()'));

        res.redirect('/');
    } catch (err) {
        console.error('Google callback error:', err.message);
        res.status(500).send('เข้าสู่ระบบไม่สำเร็จ <a href="/">ลองใหม่</a>');
    }
});

// ---------- ออกจากระบบ ----------
router.post('/auth/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
});

module.exports = { router };
