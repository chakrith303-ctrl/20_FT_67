// ============================================================
// db.js — PostgreSQL connection pool + ตัวช่วยรันคำสั่งในนามผู้ใช้
//
// ทุกคำขอจากผู้ใช้ต้องผ่าน withUser(): server ตั้งตัวตนที่ตรวจกับ Google แล้ว
// แล้วสลับเป็น role app_user → กฎสิทธิ์ (RLS) ในฐานข้อมูลทำงานทุกครั้ง
// ============================================================

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
});

/**
 * รัน fn(client) ใน transaction เดียว ในนามผู้ใช้ที่ login แล้ว
 * @param {{sub: string, email: string}} user  ค่าจาก session ฝั่ง server เท่านั้น
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 * @param {{readOnly?: boolean}} [options]  readOnly = ฐานข้อมูลปฏิเสธการเขียนทุกชนิด
 */
async function withUser(user, fn, options = {}) {
    const client = await pool.connect();
    try {
        await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
        await client.query(
            "SELECT set_config('app.sub', $1, true), set_config('app.email', $2, true)",
            [user.sub, user.email]
        );
        await client.query('SET LOCAL ROLE app_user');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, withUser };
