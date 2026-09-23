// ============================================================
// routes-api.js — API ที่หน้าเว็บเรียกใช้ (base path: /api)
//
// ทุก endpoint (ยกเว้น /api/me) ต้อง login แล้ว และรันคำสั่งผ่าน withUser()
// → สิทธิ์ทั้งหมด (ฝ่าย/บทบาท/feature flag) ถูกบังคับที่ฐานข้อมูล
// ============================================================

const express = require('express');
const { withUser } = require('./db');
const { parseMemberPaste } = require('./import-members');

const router = express.Router();

// ---------- กัน CSRF: คำขอที่ไม่ใช่ GET ต้องมี header นี้ (ฟอร์มจากเว็บอื่นใส่ไม่ได้) ----------
function requireFetchHeader(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.get('x-requested-with') !== 'fetch') {
        return res.status(403).json({ error: 'csrf', message: 'คำขอไม่ถูกต้อง' });
    }
    next();
}

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'unauthenticated', message: 'กรุณาเข้าสู่ระบบ' });
    }
    next();
}

// แปลง error จากฐานข้อมูลเป็นข้อความที่ปลอดภัยต่อการแสดงผล
function sendError(res, err) {
    const thai = /[฀-๿]/.test(err.message || '');
    const byCode = {
        '42501': [403, 'ไม่มีสิทธิ์ดำเนินการนี้'],
        '23503': [400, 'ข้อมูลอ้างอิงไม่ถูกต้อง (ตรวจฝ่าย / สถานะ / รหัสที่อ้างถึง)'],
        '23514': [400, 'รูปแบบข้อมูลไม่ถูกต้อง'],
        '23505': [409, 'ข้อมูลซ้ำกับที่มีอยู่แล้ว'],
        '23502': [400, 'กรอกข้อมูลไม่ครบ'],
        '22023': [400, 'ข้อมูลไม่ถูกต้อง'],
        '22P02': [400, 'รูปแบบข้อมูลไม่ถูกต้อง'],
        '22007': [400, 'รูปแบบวันที่ไม่ถูกต้อง'],
        '22008': [400, 'รูปแบบวันที่ไม่ถูกต้อง'],
        'P0002': [404, 'ไม่พบข้อมูล'],
        '25006': [403, 'ไม่อนุญาตให้เขียนข้อมูล'],
    };
    const hit = byCode[err.code];
    if (hit) {
        return res.status(hit[0]).json({ error: err.code, message: thai ? err.message : hit[1] });
    }
    if (err.status) return res.status(err.status).json({ error: 'bad_request', message: err.message });
    console.error('API error:', err);
    res.status(500).json({ error: 'internal_error', message: 'เกิดข้อผิดพลาดภายในระบบ' });
}

// ครอบ handler แบบ async ให้ error ไปที่ sendError
const handle = (fn) => (req, res) => fn(req, res).catch((err) => sendError(res, err));

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

router.use(requireFetchHeader);

// ---------- GET /api/me — สถานะ login + โปรไฟล์/สิทธิ์ ----------
router.get('/me', handle(async (req, res) => {
    const user = req.session && req.session.user;
    if (!user) return res.json({ logged_in: false });

    const profile = await withUser(user, async (db) => {
        const { rows } = await db.query('SELECT public.get_my_profile() AS p');
        return rows[0].p;
    }, { readOnly: true });

    res.json({ logged_in: true, email: user.email, name: user.name, registered: !!profile, profile });
}));

// ---------- POST /api/register — สมัครสมาชิกด้วย รหัสนักศึกษา + invite code ----------
// อีเมล/บทบาทมาจาก session และทะเบียนสมาชิกเท่านั้น (ค่าอื่นใน body ถูกละเลย)
router.post('/register', requireLogin, handle(async (req, res) => {
    const studentId = typeof req.body.student_id === 'string' ? req.body.student_id : '';
    const inviteCode = typeof req.body.invite_code === 'string' ? req.body.invite_code : '';

    const result = await withUser(req.session.user, async (db) => {
        const { rows } = await db.query('SELECT public.register_self($1, $2) AS r', [studentId, inviteCode]);
        return rows[0].r;
    });
    res.status(result.ok ? 201 : 400).json(result);
}));

router.use(requireLogin);

// ---------- GET /api/meta — ฝ่าย, สถานะที่ใช้ได้ ----------
router.get('/meta', handle(async (req, res) => {
    const meta = await withUser(req.session.user, async (db) => {
        const departments = await db.query('SELECT name FROM public.department ORDER BY name');
        const statuses = await db.query('SELECT entity, value FROM public.status_option ORDER BY entity, sort_order');
        const byEntity = {};
        for (const r of statuses.rows) (byEntity[r.entity] = byEntity[r.entity] || []).push(r.value);
        return { departments: departments.rows.map((r) => r.name), statuses: byEntity };
    }, { readOnly: true });
    res.json(meta);
}));

// ---------- GET /api/dashboard — KPI (อ่านอย่างเดียว: transaction READ ONLY) ----------
router.get('/dashboard', handle(async (req, res) => {
    const today = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : null;
    const kpi = await withUser(req.session.user, async (db) => {
        const { rows } = await db.query('SELECT public.get_dashboard($1::date) AS k', [today]);
        return rows[0].k;
    }, { readOnly: true });
    res.json(kpi);
}));

// ---------- GET /api/modules/:module — ข้อมูลแต่ละโมดูล (ฐานข้อมูลกรองตามสิทธิ์ให้) ----------
const MODULE_QUERIES = {
    TASK: `SELECT id, department, name, owner_main_id, co_owner_ids, status, related_document_ids,
                  evidence_ids, start_date, due_date, note, updated_at
           FROM public.task ORDER BY id`,
    DOCUMENT: `SELECT id, department, task_id, name, link, status, note, updated_at
               FROM public.document ORDER BY id`,
    LETTER: `SELECT id, department, task_id, subject, recipient, status, note FROM public.letter ORDER BY id`,
    REGISTRATION: `SELECT id, full_name, contact, status, registered_at, checked_in_at
                   FROM public.registration ORDER BY id`,
    BUDGET: `SELECT id, department, item, initial_budget, actual_cost, note FROM public.budget ORDER BY id`,
    RISK: `SELECT id, department, task_id, title, status, note FROM public.risk_issue ORDER BY id`,
    // ส่วนตรวจ (evidence_review) — ฐานข้อมูลคืนค่าว่างให้ผู้ที่ไม่มีสิทธิ์
    EVIDENCE: `SELECT e.id, e.department, e.task_id, e.title, e.link,
                      r.result AS review_result, r.reviewer, r.reviewed_at, r.note AS review_note
               FROM public.evidence e
               LEFT JOIN public.evidence_review r ON r.evidence_id = e.id
               ORDER BY e.id`,
};

router.get('/modules/:module', handle(async (req, res) => {
    const moduleKey = req.params.module;
    const data = await withUser(req.session.user, async (db) => {
        if (moduleKey === 'EVALUATION') {
            const q = await db.query('SELECT question_id, question, sort_order FROM public.evaluation_question ORDER BY sort_order, question_id');
            const r = await db.query('SELECT response_id, evaluation_id, registration_id, answers, submitted_at FROM public.evaluation_response ORDER BY response_id');
            return { questions: q.rows, responses: r.rows };
        }
        if (!Object.prototype.hasOwnProperty.call(MODULE_QUERIES, moduleKey)) return null;
        const { rows } = await db.query(MODULE_QUERIES[moduleKey]);
        return rows;
    }, { readOnly: true });

    if (data === null) return res.status(404).json({ error: 'not_found', message: 'ไม่รู้จักโมดูลนี้' });
    res.json(data);
}));

// ---------- เขียนข้อมูล: TASK / DOCUMENT (ฐานข้อมูลตรวจ flag + ฝ่ายอีกชั้น) ----------
const WRITE_MODULES = {
    tasks: {
        table: 'public.task',
        fields: {
            department: 'text', name: 'text', owner_main_id: 'nullable', co_owner_ids: 'list',
            status: 'text', related_document_ids: 'list', evidence_ids: 'list',
            start_date: 'nullable', due_date: 'nullable', note: 'nullable',
        },
    },
    documents: {
        table: 'public.document',
        fields: { department: 'text', task_id: 'nullable', name: 'text', link: 'nullable', status: 'text', note: 'nullable' },
    },
};

// รับเฉพาะคอลัมน์ที่อนุญาต — มีคอลัมน์อื่น (เช่น id) = ปฏิเสธ
function pickFields(spec, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('ข้อมูลไม่ถูกต้อง');
    const out = {};
    for (const [key, value] of Object.entries(body)) {
        const type = spec.fields[key];
        if (!type) throw badRequest(`ไม่อนุญาตให้กำหนดค่า: ${key}`);
        if (type === 'list') {
            const list = Array.isArray(value) ? value : String(value || '').split(',');
            out[key] = list.map((s) => String(s).trim()).filter(Boolean);
        } else if (value === null || value === undefined || (type === 'nullable' && String(value).trim() === '')) {
            out[key] = null;
        } else if (typeof value === 'string' || typeof value === 'number') {
            out[key] = String(value).trim();
        } else {
            throw badRequest(`ค่าของ ${key} ไม่ถูกต้อง`);
        }
    }
    if (!Object.keys(out).length) throw badRequest('ไม่มีข้อมูลที่จะบันทึก');
    return out;
}

router.post('/:kind(tasks|documents)', handle(async (req, res) => {
    const spec = WRITE_MODULES[req.params.kind];
    const data = pickFields(spec, req.body);
    const cols = Object.keys(data);
    const sql = `INSERT INTO ${spec.table} (${cols.map((c) => `"${c}"`).join(', ')})
                 VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`;
    const row = await withUser(req.session.user, async (db) => (await db.query(sql, Object.values(data))).rows[0]);
    res.status(201).json(row);
}));

router.patch('/:kind(tasks|documents)/:id', handle(async (req, res) => {
    const spec = WRITE_MODULES[req.params.kind];
    const data = pickFields(spec, req.body);
    const cols = Object.keys(data);
    const sql = `UPDATE ${spec.table} SET ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ')}
                 WHERE id = $${cols.length + 1} RETURNING id`;
    const rows = await withUser(req.session.user, async (db) => (await db.query(sql, [...Object.values(data), req.params.id])).rows);
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: 'ไม่พบรายการ หรือไม่มีสิทธิ์แก้ไข' });
    res.json(rows[0]);
}));

// ---------- Invite (ระดับโครงการเท่านั้น — ฐานข้อมูลตรวจสิทธิ์) ----------
router.get('/invites', handle(async (req, res) => {
    const rows = await withUser(req.session.user, async (db) => (await db.query(
        `SELECT invite_id, member_id, status, created_by, created_date, expires_at, used_date, used_by_user_id
         FROM public.invite ORDER BY created_date DESC LIMIT 200`)).rows, { readOnly: true });
    res.json(rows);
}));

router.post('/invites', handle(async (req, res) => {
    const memberId = typeof req.body.member_id === 'string' ? req.body.member_id.trim() : '';
    if (!memberId) throw badRequest('กรุณาระบุรหัสสมาชิก');
    const invite = await withUser(req.session.user, async (db) =>
        (await db.query('SELECT public.create_invite($1) AS i', [memberId])).rows[0].i);
    res.status(201).json(invite); // code แสดงครั้งเดียว ฐานข้อมูลเก็บเฉพาะ hash
}));

router.post('/invites/:id/revoke', handle(async (req, res) => {
    await withUser(req.session.user, (db) => db.query('SELECT public.revoke_invite($1)', [req.params.id]));
    res.json({ ok: true });
}));

// ---------- นำเข้าสมาชิกจากชีท MEMBER (ADMIN เท่านั้น — ฐานข้อมูลตรวจสิทธิ์) ----------
// body: { text: ข้อความที่วางจาก Google Sheets, create_departments: boolean, dry_run: boolean }
router.post('/admin/members/import', handle(async (req, res) => {
    const parsed = parseMemberPaste(req.body.text);
    if (!parsed.rows.length) throw badRequest('ไม่พบแถวที่มีรหัสสมาชิก');
    const dryRun = req.body.dry_run !== false;
    const result = await withUser(req.session.user, async (db) => (await db.query(
        'SELECT public.admin_import_members($1::jsonb, $2, $3) AS r',
        [JSON.stringify(parsed.rows), req.body.create_departments === true, dryRun]
    )).rows[0].r);
    res.json({ ...result, header_detected: parsed.header_detected, preview: parsed.rows.slice(0, 200) });
}));

module.exports = { router, requireFetchHeader };
