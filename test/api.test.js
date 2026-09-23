// ============================================================
// api.test.js — ทดสอบ API กับฐานข้อมูลทดสอบจริง (รันผ่าน scripts/test-db.sh)
// จำลอง session ด้วยการใส่ req.session เอง (ข้ามขั้น Google login)
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

if (!process.env.DATABASE_URL) {
    test('api tests', { skip: 'ต้องรันผ่าน scripts/test-db.sh' }, () => {});
    return;
}

const { router: apiRouter } = require('../routes-api');
const { pool } = require('../db');

const as = (email) => (email ? { sub: 'sub:' + email, email, name: email } : null);

let server;
let baseUrl;
let currentUser = null;

test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { user: currentUser };
        next();
    });
    app.use('/api', apiRouter);
    await new Promise((resolve) => {
        server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
    server.close();
    await pool.end();
});

async function call(user, method, path, body, headers = { 'x-requested-with': 'fetch' }) {
    currentUser = as(user);
    const res = await fetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
}

test('GET /me: ไม่ได้ login / login แต่ยังไม่สมัคร / สมาชิก', async () => {
    assert.deepStrictEqual((await call(null, 'GET', '/me')).body, { logged_in: false });
    const stranger = await call('stranger@example.ac.th', 'GET', '/me');
    assert.strictEqual(stranger.body.registered, false);
    const head = await call('head@example.ac.th', 'GET', '/me');
    assert.strictEqual(head.body.profile.role, 'HEAD');
    assert.strictEqual(head.body.profile.department, 'ฝ่ายวิชาการ');
});

test('ต้อง login ก่อนใช้ API อื่น', async () => {
    assert.strictEqual((await call(null, 'GET', '/dashboard')).status, 401);
    assert.strictEqual((await call(null, 'GET', '/modules/TASK')).status, 401);
});

test('Dashboard: PRESIDENT ทั้งโครงการ, HEAD เฉพาะฝ่าย, MEMBER ถูกปิด', async () => {
    const p = await call('president@example.ac.th', 'GET', '/dashboard?today=2026-09-23');
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.body.scope, 'PROJECT');
    assert.strictEqual(p.body.tasks.total, 8);
    assert.strictEqual(p.body.tasks.overdue, 1);

    const h = await call('head@example.ac.th', 'GET', '/dashboard?today=2026-09-23');
    assert.strictEqual(h.body.scope, 'DEPARTMENT:ฝ่ายวิชาการ');
    assert.strictEqual(h.body.tasks.total, 5);

    const noDate = await call('head@example.ac.th', 'GET', '/dashboard');
    assert.strictEqual(noDate.status, 200, JSON.stringify(noDate.body));

    const m = await call('member@example.ac.th', 'GET', '/dashboard');
    assert.strictEqual(m.status, 403);
});

test('Modules: กรองตามฝ่าย, ซ่อนส่วนตรวจหลักฐาน, โมดูลที่ไม่รู้จัก', async () => {
    const budget = await call('head@example.ac.th', 'GET', '/modules/BUDGET');
    assert.deepStrictEqual(budget.body.map((r) => r.id), ['B001']);
    const ev = await call('head@example.ac.th', 'GET', '/modules/EVIDENCE');
    assert.deepStrictEqual(ev.body.map((r) => r.id), ['E001']);
    assert.strictEqual(ev.body[0].review_result, null);
    const evP = await call('president@example.ac.th', 'GET', '/modules/EVIDENCE');
    assert.strictEqual(evP.body.find((r) => r.id === 'E001').review_result, 'ผ่าน');
    assert.strictEqual((await call('head@example.ac.th', 'GET', '/modules/EVALUATION')).body.questions.length, 0);
    assert.strictEqual((await call('head@example.ac.th', 'GET', '/modules/USER_ACCOUNT')).status, 404);
});

test('เขียนงาน: ฝ่ายตนได้, ฝ่ายอื่นไม่ได้, ห้ามกำหนดรหัส, ต้องมี header กัน CSRF', async () => {
    const own = await call('head@example.ac.th', 'POST', '/tasks',
        { department: 'ฝ่ายวิชาการ', name: 'งานทดสอบ API', status: 'กำลังดำเนินการ', co_owner_ids: 'M005, M009', due_date: '2026-10-01' });
    assert.strictEqual(own.status, 201, JSON.stringify(own.body));
    assert.match(own.body.id, /^T\d{3,}$/);

    const patch = await call('head@example.ac.th', 'PATCH', `/tasks/${own.body.id}`, { status: 'เสร็จสิ้น' });
    assert.strictEqual(patch.status, 200);

    const other = await call('head@example.ac.th', 'POST', '/tasks', { department: 'ฝ่ายสถานที่', name: 'x' });
    assert.strictEqual(other.status, 403);
    const otherPatch = await call('head@example.ac.th', 'PATCH', '/tasks/T004', { status: 'เสร็จสิ้น' });
    assert.strictEqual(otherPatch.status, 404);

    const withId = await call('president@example.ac.th', 'POST', '/tasks', { id: 'T999', department: 'ฝ่ายวิชาการ' });
    assert.strictEqual(withId.status, 400);
    const badStatus = await call('president@example.ac.th', 'POST', '/tasks', { department: 'ฝ่ายวิชาการ', status: 'เสร็จ' });
    assert.strictEqual(badStatus.status, 400);

    const noHeader = await call('president@example.ac.th', 'POST', '/tasks', { department: 'ฝ่ายวิชาการ' }, {});
    assert.strictEqual(noHeader.status, 403);

    const member = await call('member@example.ac.th', 'POST', '/documents', { department: 'ฝ่ายวิชาการ', name: 'x' });
    assert.strictEqual(member.status, 403);
});

test('MEMBER: เห็นงานทั้งฝ่ายตน, เพิ่ม/แก้ไข/ลบได้เฉพาะงานของตัวเอง', async () => {
    const list = await call('member@example.ac.th', 'GET', '/modules/TASK');
    const listIds = list.body.map((r) => r.id);
    for (const id of ['T001', 'T002', 'T006', 'T007', 'T008']) assert.ok(listIds.includes(id), id);
    assert.ok(list.body.every((r) => r.department === 'ฝ่ายวิชาการ'), 'member sees own department only');

    const own = await call('member@example.ac.th', 'POST', '/tasks',
        { department: 'ฝ่ายวิชาการ', name: 'งานสมาชิก', owner_main_id: 'M005' });
    assert.strictEqual(own.status, 201, JSON.stringify(own.body));

    const notMine = await call('member@example.ac.th', 'POST', '/tasks',
        { department: 'ฝ่ายวิชาการ', name: 'x', owner_main_id: 'M003' });
    assert.strictEqual(notMine.status, 403);

    const patchOwn = await call('member@example.ac.th', 'PATCH', `/tasks/${own.body.id}`, { status: 'เสร็จสิ้น' });
    assert.strictEqual(patchOwn.status, 200);

    const patchOthers = await call('member@example.ac.th', 'PATCH', '/tasks/T001', { status: 'เสร็จสิ้น' });
    assert.strictEqual(patchOthers.status, 404);

    const deleteOthers = await call('member@example.ac.th', 'DELETE', '/tasks/T001');
    assert.strictEqual(deleteOthers.status, 404);

    const deleteOwn = await call('member@example.ac.th', 'DELETE', `/tasks/${own.body.id}`);
    assert.strictEqual(deleteOwn.status, 200);
    assert.strictEqual(deleteOwn.body.ok, true);
});

test('Invite + สมัครสมาชิก: email จาก session, บทบาทจากตำแหน่ง, ล้มเหลวได้ข้อความกลาง ๆ', async () => {
    assert.strictEqual((await call('head@example.ac.th', 'POST', '/invites', { member_id: 'M008' })).status, 403);

    const inv = await call('president@example.ac.th', 'POST', '/invites', { member_id: 'M008' });
    assert.strictEqual(inv.status, 201, JSON.stringify(inv.body));
    assert.match(inv.body.code, /^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);

    const list = await call('president@example.ac.th', 'GET', '/invites');
    assert.ok(list.body.some((i) => i.invite_id === inv.body.invite_id && !('code_hash' in i)));

    const bad = await call('api-new@example.ac.th', 'POST', '/register', { student_id: '6500008', invite_code: 'XXXX' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.ok, false);
    assert.doesNotMatch(bad.body.message, /invite|รหัสนักศึกษา/i);

    const ok = await call('api-new@example.ac.th', 'POST', '/register',
        { student_id: '6500008', invite_code: inv.body.code, email: 'evil@x.com', role: 'ADMIN' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.role, 'MEMBER');

    const me = await call('api-new@example.ac.th', 'GET', '/me');
    assert.strictEqual(me.body.profile.role, 'MEMBER');
    assert.strictEqual(me.body.profile.email, 'api-new@example.ac.th');

    const reuse = await call('api-other@example.ac.th', 'POST', '/register', { student_id: '6500008', invite_code: inv.body.code });
    assert.strictEqual(reuse.status, 400);
});

test('นำเข้าสมาชิก: แยกข้อความจาก Google Sheets (มี/ไม่มีหัวคอลัมน์, เซลล์ขึ้นบรรทัด)', () => {
    const { parseMemberPaste } = require('../import-members');
    const header = 'รหัส\nสมาชิก\tรหัส\nนักศึกษา\tคำนำหน้า\tชื่อ\tนามสกุล\tชื่อเล่น\tฝ่ายหลัก\tบทบาท/\nตำแหน่ง\tเบอร์\nโทรศัพท์\tLine\nID\tอีเมล\tสถานะการ\nทำงาน\tหมายเหตุ';
    // Google Sheets ใส่ "..." ครอบเซลล์ที่มีขึ้นบรรทัด
    const quotedHeader = header.split('\t').map((h) => (h.includes('\n') ? `"${h}"` : h)).join('\t');
    const row = 'M002\t029\tนางสาว\tทดสอบ\tสมมติ\tส้ม\tฝ่ายอำนวยการ/ประธานโครงการ\t"รองประธาน\nโครงการ"\t081\tline\ta@b.c\tปฏิบัติหน้าที่\t';
    const withHeader = parseMemberPaste(`${quotedHeader}\n${row}\n\t\t\t\t\n`);
    assert.strictEqual(withHeader.header_detected, true);
    assert.deepStrictEqual(withHeader.rows, [{
        id: 'M002', student_id: '029', full_name: 'นางสาวทดสอบ สมมติ', nickname: 'ส้ม',
        department: 'ฝ่ายอำนวยการ/ประธานโครงการ', position: 'รองประธานโครงการ', work_status: 'ปฏิบัติหน้าที่',
    }]);
    assert.ok(!JSON.stringify(withHeader.rows).includes('a@b.c'), 'email not imported');

    const noHeader = parseMemberPaste(row.replace('"รองประธาน\nโครงการ"', 'รองประธานโครงการ') + '\r\n');
    assert.strictEqual(noHeader.header_detected, false);
    assert.strictEqual(noHeader.rows[0].position, 'รองประธานโครงการ');
    assert.strictEqual(noHeader.rows[0].work_status, 'ปฏิบัติหน้าที่');
});

test('นำเข้าสมาชิก API: ADMIN เท่านั้น, ตรวจสอบก่อน, แล้วบันทึก', async () => {
    const text = 'M200\t901\tนาย\tทดสอบ\tนำเข้า\tเอ\tฝ่ายใหม่ทดสอบ\tสมาชิก\t\t\t\tปฏิบัติหน้าที่\t';
    assert.strictEqual((await call('president@example.ac.th', 'POST', '/admin/members/import', { text })).status, 403);

    const check = await call('vp@example.ac.th', 'POST', '/admin/members/import', { text });
    assert.strictEqual(check.status, 200, JSON.stringify(check.body));
    assert.strictEqual(check.body.saved, false);
    assert.strictEqual(check.body.errors.length, 1); // ฝ่ายยังไม่มี

    const save = await call('vp@example.ac.th', 'POST', '/admin/members/import', { text, create_departments: true, dry_run: false });
    assert.strictEqual(save.body.saved, true, JSON.stringify(save.body));
    assert.strictEqual(save.body.inserted, 1);

    const empty = await call('vp@example.ac.th', 'POST', '/admin/members/import', { text: '   ' });
    assert.strictEqual(empty.status, 400);
});
