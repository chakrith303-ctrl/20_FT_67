// ============================================================
// migrate.js — สร้าง/อัปเดตตารางจากไฟล์ใน db/migrations ตามลำดับชื่อไฟล์
// รันอัตโนมัติทุกครั้งที่ server เริ่ม (ไฟล์ที่รันแล้วจะไม่รันซ้ำ)
// รันเองได้: npm run migrate
// ============================================================

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'db', 'migrations');

async function migrate() {
    const client = await pool.connect();
    try {
        // กันกรณีเปิด server หลายตัวพร้อมกันแล้ว migrate ชนกัน
        await client.query('SELECT pg_advisory_lock(hashtext($1))', ['schema_migrations']);
        await client.query('CREATE SCHEMA IF NOT EXISTS private');
        await client.query(`CREATE TABLE IF NOT EXISTS private.schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);

        const { rows } = await client.query('SELECT name FROM private.schema_migrations');
        const applied = new Set(rows.map((r) => r.name));
        const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            console.log(`migrate: ${file}`);
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO private.schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`migration ${file} failed: ${err.message}`);
            }
        }
    } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['schema_migrations']).catch(() => {});
        client.release();
    }
}

module.exports = { migrate };

if (require.main === module) {
    migrate()
        .then(() => {
            console.log('migrate: done');
            return pool.end();
        })
        .catch((err) => {
            console.error(err.message);
            process.exit(1);
        });
}
