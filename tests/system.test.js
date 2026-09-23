const test = require('node:test');
const assert = require('node:assert');
const { createEnv, sampleSheets } = require('./harness');

const TODAY = '2026-09-23T00:00:00';

function api(env, fn, ...args) {
  env.ctx.__args = args;
  // JSON round-trip = สิ่งที่ไคลเอนต์ได้รับจริง และตัดปัญหา prototype ข้าม vm realm
  return JSON.parse(JSON.stringify(env.get(fn + '.apply(null, __args)')));
}

function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function newDate(env, s) {
  env.ctx.__s = s;
  return env.get('new Date(__s)');
}

function sheet(env, name) {
  return env.ss.sheets[name].data;
}

/* ---------------- 1) รหัส ---------------- */

test('ID patterns: prefix + อย่างน้อย 3 หลัก, EV กับ EVQ ไม่ปนกัน', () => {
  const env = createEnv(sampleSheets());
  assert.strictEqual(env.get("isValidId_('TASK','T001')"), true);
  assert.strictEqual(env.get("isValidId_('TASK','T01')"), false);
  assert.strictEqual(env.get("isValidId_('TASK','T1234')"), true);
  assert.strictEqual(env.get("isValidId_('EVALUATION_RESPONSE','EVQ001')"), false);
  assert.strictEqual(env.get("isValidId_('EVALUATION_QUESTION','EVQ001')"), true);
  assert.strictEqual(env.get("isValidId_('RISK','RI001')"), true);
  assert.strictEqual(env.get("isValidId_('REGISTRATION','RI001')"), false);
  assert.strictEqual(env.get("nextId_('T',['T001','T009','X100',''])"), 'T010');
  assert.strictEqual(env.get("nextId_('EV',['EV002','EVQ050'])"), 'EV003');
  assert.strictEqual(env.get("isConfirmedMemberId_('M087')"), true);
  assert.strictEqual(env.get("isConfirmedMemberId_('M088')"), false);
  assert.strictEqual(env.get("isConfirmedMemberId_('M000')"), false);
});

/* ---------------- 2) Feature flags ---------------- */

test('WRITE: เฉพาะ TASK/DOCUMENT เปิด, โมดูลอื่นถูกปฏิเสธ (fail-closed)', () => {
  const env = createEnv(sampleSheets(), { email: 'president@example.ac.th' });
  for (const m of ['LETTER', 'REGISTRATION', 'BUDGET', 'RISK', 'EVIDENCE', 'EVALUATION_QUESTION', 'EVALUATION_RESPONSE', 'UNKNOWN']) {
    const res = api(env, 'apiCreateRecord', m, { x: 1 });
    assert.strictEqual(res.ok, false, m);
  }
  const before = env.totalWrites();
  assert.strictEqual(api(env, 'apiCreateRecord', 'BUDGET', { 'ฝ่ายที่ขอใช้': 'ฝ่ายวิชาการ' }).error.code, 'FEATURE_DISABLED');
  assert.strictEqual(env.totalWrites(), before);
});

test('WRITE TASK: สร้างรหัสอัตโนมัติ, บันทึก audit, กัน formula injection', () => {
  const env = createEnv(sampleSheets(), { email: 'president@example.ac.th' });
  const res = api(env, 'apiCreateRecord', 'TASK', {
    'ฝ่ายที่รับผิดชอบ': 'ฝ่ายวิชาการ', 'ชื่องาน/กิจกรรม': '=HYPERLINK("x")', 'สถานะงาน': 'กำลังดำเนินการ', 'รหัสเอกสารที่เกี่ยวข้อง': 'D001, D002',
  });
  assert.ok(res.ok, JSON.stringify(res));
  assert.strictEqual(res.data.id, 'T008');
  const last = sheet(env, 'TASK_MASTER').at(-1);
  assert.strictEqual(last[0], 'T008');
  assert.strictEqual(last[2], '\'=HYPERLINK("x")');
  const audit = sheet(env, 'AUDIT_LOG');
  assert.strictEqual(audit.length, 2);
  assert.deepStrictEqual([audit[1][0], audit[1][2], audit[1][3], audit[1][4], audit[1][5]], ['A001', 'U001', 'CREATE', 'TASK_MASTER', 'T008']);
  assert.ok(env.state.lockCalls >= 1);
});

test('WRITE: ห้ามตั้งรหัสเอง / คอลัมน์ไม่รู้จัก / รหัสอ้างอิงผิดรูปแบบ', () => {
  const env = createEnv(sampleSheets(), { email: 'president@example.ac.th' });
  assert.strictEqual(api(env, 'apiCreateRecord', 'TASK', { 'รหัสงาน': 'T999', 'ฝ่ายที่รับผิดชอบ': 'ก' }).error.code, 'VALIDATION');
  assert.strictEqual(api(env, 'apiCreateRecord', 'TASK', { 'role': 'ADMIN', 'ฝ่ายที่รับผิดชอบ': 'ก' }).error.code, 'VALIDATION');
  assert.strictEqual(api(env, 'apiCreateRecord', 'DOCUMENT', { 'ฝ่ายที่รับผิดชอบ': 'ก', 'รหัสงานที่เกี่ยวข้อง': 'X1' }).error.code, 'VALIDATION');
});

test('WRITE: HEAD เขียนได้เฉพาะฝ่ายตน, MEMBER เขียนไม่ได้, UPDATE audit เฉพาะค่าที่เปลี่ยน', () => {
  const env = createEnv(sampleSheets(), { email: 'head@example.ac.th' });
  assert.strictEqual(api(env, 'apiCreateRecord', 'TASK', { 'ฝ่ายที่รับผิดชอบ': 'ฝ่ายสถานที่' }).error.code, 'FORBIDDEN');
  assert.strictEqual(api(env, 'apiUpdateRecord', 'TASK', 'T004', { 'สถานะงาน': 'เสร็จสิ้น' }).error.code, 'FORBIDDEN');
  assert.strictEqual(api(env, 'apiUpdateRecord', 'TASK', 'T001', { 'ฝ่ายที่รับผิดชอบ': 'ฝ่ายสถานที่' }).error.code, 'FORBIDDEN');
  const ok = api(env, 'apiUpdateRecord', 'TASK', 'T001', { 'สถานะงาน': 'เสร็จสิ้น', 'ชื่องาน/กิจกรรม': 'งาน 1' });
  assert.ok(ok.ok && ok.data.changed);
  assert.strictEqual(sheet(env, 'TASK_MASTER')[1][5], 'เสร็จสิ้น');
  const a = sheet(env, 'AUDIT_LOG')[1];
  assert.strictEqual(a[3], 'UPDATE');
  assert.deepStrictEqual(JSON.parse(a[6]), { 'สถานะงาน': 'กำลังดำเนินการ' });
  assert.deepStrictEqual(JSON.parse(a[7]), { 'สถานะงาน': 'เสร็จสิ้น' });

  env.setEmail('member@example.ac.th');
  assert.strictEqual(api(env, 'apiUpdateRecord', 'TASK', 'T002', { 'สถานะงาน': 'ยกเลิก' }).error.code, 'FORBIDDEN');
});

/* ---------------- READ facade ---------------- */

test('READ: HEAD เห็นเฉพาะฝ่ายตน, EVIDENCE ตัดส่วนตรวจ, EVALUATION เฉพาะระดับโครงการ', () => {
  const env = createEnv(sampleSheets(), { email: 'head@example.ac.th' });
  const budget = api(env, 'apiReadModule', 'BUDGET');
  assert.deepStrictEqual(budget.data.map((r) => r['รหัสรายการ']), ['B001']);
  const ev = api(env, 'apiReadModule', 'EVIDENCE');
  assert.deepStrictEqual(ev.data.map((r) => r['รหัสหลักฐาน']), ['E001', 'E002']);
  assert.ok(!('ผลการตรวจ' in ev.data[0]));
  assert.strictEqual(api(env, 'apiReadModule', 'REGISTRATION').data.length, 3);
  assert.strictEqual(api(env, 'apiReadModule', 'EVALUATION').error.code, 'FORBIDDEN');

  env.setEmail('president@example.ac.th');
  assert.strictEqual(api(env, 'apiReadModule', 'EVIDENCE').data[0]['ผลการตรวจ'], 'ผ่าน');
  const evals = api(env, 'apiReadModule', 'EVALUATION').data;
  assert.strictEqual(evals.questions.length, 1);
  assert.strictEqual(evals.responses.length, 1);
});

test('READ: MEMBER เห็นเฉพาะงานที่ตนรับผิดชอบ และอ่านโมดูลอื่นไม่ได้', () => {
  const env = createEnv(sampleSheets(), { email: 'member@example.ac.th' });
  assert.deepStrictEqual(api(env, 'apiReadModule', 'TASK').data.map((r) => r['รหัสงาน']), ['T002']);
  assert.strictEqual(api(env, 'apiReadModule', 'BUDGET').error.code, 'FORBIDDEN');
  assert.strictEqual(api(env, 'apiReadModule', 'NOPE').error.code, 'VALIDATION');
});

/* ---------------- 3) Dashboard ---------------- */

test('DASHBOARD (PRESIDENT): KPI ตามนิยาม และไม่เขียนลงชีทเลย', () => {
  const env = createEnv(sampleSheets(), { email: 'president@example.ac.th' });
  const before = env.totalWrites();
  env.ctx.__today = newDate(env, TODAY);
  const k = plain(env.get('toClientSafe_(buildDashboard_(getCurrentUser_(), __today))'));
  assert.strictEqual(env.totalWrites(), before, 'dashboard must not write');

  assert.strictEqual(k.tasks.total, 7); // ไม่นับแถวรหัสว่าง
  assert.strictEqual(k.tasks.inProgress, 2);
  assert.strictEqual(k.tasks.done, 2); // "เสร็จสิ้น " (มีช่องว่าง) ไม่นับ — ตรงตัวอักษรเป๊ะ
  assert.strictEqual(k.tasks.cancelled, 1);
  assert.strictEqual(k.tasks.overdue, 1); // T001 เท่านั้น (T002 เสร็จ, T003 ยกเลิก)
  assert.strictEqual(k.tasks.dueSoon, 2); // T004 (2 วัน), T006 (0 วัน)
  assert.strictEqual(k.tasks.successRate, Math.round((2 / 6) * 100) / 100);

  assert.strictEqual(k.documents.pendingApproval, 1);
  assert.strictEqual(k.documents.pendingReview, 1);
  assert.deepStrictEqual(k.documents.tracking.map((d) => d.id), ['D001', 'D002', 'D003', 'D004']);
  assert.strictEqual(k.letters.awaitingReply, 1);
  assert.deepStrictEqual(k.risks, { total: 3, closed: 2, open: 1 });
  // T002 มีหลักฐานที่ "T002 " → trim แล้วตรง, T005 มี E001 → ไม่มีงานขาดหลักฐาน
  assert.strictEqual(k.evidence.doneWithoutEvidence, 0);
  assert.deepStrictEqual(k.registrations, { total: 3, checkedIn: 2 });
  assert.deepStrictEqual(k.budget, { initialBudget: 3500, actualCost: 3800, remaining: -300 });
  assert.strictEqual(k.team.active, 7); // M006 พ้นสภาพ
  assert.strictEqual(k.scope, 'PROJECT');
});

test('DASHBOARD: หลักฐานจับคู่ตรง taskId เท่านั้น ไม่ใช้คอลัมน์รหัสหลักฐานใน TASK_MASTER', () => {
  const s = sampleSheets();
  s.EVIDENCE = [s.EVIDENCE[0], ['E001', 'ฝ่ายวิชาการ', 'T0055', 'x', '']];
  const env = createEnv(s, { email: 'president@example.ac.th' });
  env.ctx.__today = newDate(env, TODAY);
  const k = plain(env.get('buildDashboard_(getCurrentUser_(), __today)'));
  // T005 มี "E001" ใน TASK_MASTER.รหัสหลักฐาน แต่ไม่มีหลักฐานที่ taskId = T005 → นับว่าขาด
  assert.deepStrictEqual(k.evidence.doneWithoutEvidenceList.map((t) => t.id).sort(), ['T002', 'T005']);
  const task5 = sheet(env, 'TASK_MASTER')[5];
  assert.strictEqual(task5[7], 'E001'); // ไม่มี back-write
});

test('DASHBOARD: เหลือเวลาว่าง → คำนวณจากวันครบกำหนด', () => {
  const env = createEnv(sampleSheets());
  env.ctx.__today = newDate(env, TODAY);
  const k = env.get(`computeDashboard_({ tasks: [
    { id: 'T001', status: 'กำลังดำเนินการ', remainingDays: '', dueDate: '2026-09-20' },
    { id: 'T002', status: 'กำลังดำเนินการ', remainingDays: '', dueDate: '2026-09-26' },
    { id: 'T003', status: 'กำลังดำเนินการ', remainingDays: '', dueDate: '2026-09-27' },
    { id: 'T004', status: 'กำลังดำเนินการ', remainingDays: '', dueDate: '' },
  ] }, __today)`);
  assert.strictEqual(k.tasks.overdue, 1);
  assert.strictEqual(k.tasks.dueSoon, 1);
  assert.strictEqual(k.tasks.successRate, 0);
  const empty = env.get('computeDashboard_({}, __today)');
  assert.strictEqual(empty.tasks.successRate, null);
});

test('DASHBOARD (HEAD/SECRETARY): เห็นเฉพาะฝ่ายตน; MEMBER ถูกปิด', () => {
  const env = createEnv(sampleSheets(), { email: 'head@example.ac.th' });
  const k = api(env, 'apiGetDashboard').data;
  assert.strictEqual(k.scope, 'DEPARTMENT:ฝ่ายวิชาการ');
  assert.strictEqual(k.tasks.total, 4); // T001 T002 T006 T007
  assert.deepStrictEqual(k.budget, { initialBudget: 1000, actualCost: 800, remaining: 200 });
  assert.strictEqual(k.team.active, 3); // M003 M005 M007
  assert.strictEqual(k.risks.total, 1);

  env.setEmail('secretary@example.ac.th');
  assert.strictEqual(api(env, 'apiGetDashboard').data.scope, 'DEPARTMENT:ฝ่ายสถานที่');

  env.setEmail('member@example.ac.th');
  assert.strictEqual(api(env, 'apiGetDashboard').error.code, 'FEATURE_DISABLED');
});

/* ---------------- Auth ---------------- */

test('AUTH: บทบาทมาจากตำแหน่งใน MEMBER ตรงตัว, ADMIN มาจาก USER_ACCOUNT', () => {
  const env = createEnv(sampleSheets());
  assert.strictEqual(env.get("roleFromPosition_('รองประธานโครงการ')"), 'VICE_PRESIDENT');
  assert.strictEqual(env.get("roleFromPosition_('หัวหน้าฝ่าย')"), null);
  assert.strictEqual(env.get("roleFromPosition_(' หัวหน้า')"), null);
  assert.strictEqual(env.get("ROLE_SCOPE.VICE_PRESIDENT"), env.get('ROLE_SCOPE.PRESIDENT'));
  assert.strictEqual(env.get("ROLE_SCOPE.SECRETARY"), env.get('ROLE_SCOPE.HEAD'));

  env.setEmail('ADMIN@example.ac.th');
  const me = api(env, 'apiGetMe').data;
  assert.strictEqual(me.role, 'ADMIN');
  assert.strictEqual(me.scope, 'PROJECT');

  env.setEmail('nobody@example.ac.th');
  assert.strictEqual(api(env, 'apiGetMe').error.code, 'NO_ACCOUNT');
  env.setEmail('');
  assert.strictEqual(api(env, 'apiGetMe').error.code, 'UNAUTHENTICATED');
});

/* ---------------- 4) Self-registration ---------------- */

function issueInvite(env, memberId) {
  env.setEmail('president@example.ac.th');
  const res = api(env, 'apiCreateInvite', memberId);
  assert.ok(res.ok, JSON.stringify(res));
  return res.data;
}

test('INVITE: เก็บเฉพาะ SHA-256 hash, active ได้ 1 อันต่อคน, สร้างได้เฉพาะระดับโครงการ', () => {
  const env = createEnv(sampleSheets());
  const inv1 = issueInvite(env, 'M008');
  const inv2 = issueInvite(env, 'M008');
  const rows = sheet(env, 'INVITE');
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[1][3], 'REVOKED');
  assert.strictEqual(rows[2][3], 'ACTIVE');
  const norm = inv2.code.replace(/-/g, '');
  const expected = require('crypto').createHash('sha256').update(norm).digest('hex');
  assert.strictEqual(rows[2][2], expected);
  assert.ok(!JSON.stringify(rows).includes(inv1.code) && !JSON.stringify(rows).includes(norm));
  assert.ok(sheet(env, 'AUDIT_LOG').some((a) => a[3] === 'INVITE_CREATE'));

  env.setEmail('head@example.ac.th');
  assert.strictEqual(api(env, 'apiCreateInvite', 'M008').error.code, 'FORBIDDEN');
  env.setEmail('president@example.ac.th');
  assert.strictEqual(api(env, 'apiCreateInvite', 'M003').ok, false); // มีบัญชีแล้ว
  assert.strictEqual(api(env, 'apiCreateInvite', 'M006').ok, false); // ไม่ปฏิบัติหน้าที่
  assert.strictEqual(api(env, 'apiCreateInvite', 'M007').ok, false); // ตำแหน่งไม่ตรง
});

test('REGISTER: สำเร็จ — email จาก session, role จากตำแหน่ง, invite → USED, audit', () => {
  const env = createEnv(sampleSheets());
  const inv = issueInvite(env, 'M008');
  env.setEmail('New.Member@Example.ac.th');
  const res = api(env, 'apiRegister', {
    studentId: '6500008', inviteCode: inv.code.toLowerCase(), email: 'attacker@evil.com', role: 'ADMIN',
  });
  assert.deepStrictEqual({ ok: res.ok, role: res.role, userId: res.userId }, { ok: true, role: 'MEMBER', userId: 'U006' });
  const acc = sheet(env, 'USER_ACCOUNT').at(-1);
  assert.deepStrictEqual(acc.slice(0, 5), ['U006', 'M008', 'new.member@example.ac.th', 'MEMBER', 'ACTIVE']);
  const invRow = sheet(env, 'INVITE')[1];
  assert.strictEqual(invRow[3], 'USED');
  assert.strictEqual(invRow[8], 'U006');
  const audit = sheet(env, 'AUDIT_LOG').filter((a) => a[3] === 'SELF_REGISTER');
  assert.strictEqual(audit.length, 1);
  assert.strictEqual(audit[0][5], 'U006');

  // ใช้ซ้ำ → ปฏิเสธทันที
  env.setEmail('someone.else@example.ac.th');
  const again = api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code });
  assert.strictEqual(again.ok, false);
});

test('REGISTER: ล้มเหลวทุกกรณีได้ข้อความเดียวกัน ไม่บอก field ที่ผิด และไม่เขียน USER_ACCOUNT', () => {
  const env = createEnv(sampleSheets());
  const inv = issueInvite(env, 'M008');
  const generic = env.get('REGISTRATION_CONFIG.GENERIC_ERROR');
  const cases = [
    ['a1@example.ac.th', { studentId: '6500008', inviteCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111' }], // code ผิด
    ['a2@example.ac.th', { studentId: '6599999', inviteCode: inv.code }], // รหัสนักศึกษาผิด
    ['a3@example.ac.th', { studentId: '6500005', inviteCode: inv.code }], // invite ไม่ใช่ของคนนี้
    ['member@example.ac.th', { studentId: '6500008', inviteCode: inv.code }], // อีเมลมีบัญชีแล้ว
    ['a4@example.ac.th', { studentId: '', inviteCode: '' }],
    ['a5@example.ac.th', null],
  ];
  const accountsBefore = sheet(env, 'USER_ACCOUNT').length;
  for (const [email, input] of cases) {
    env.setEmail(email);
    const res = api(env, 'apiRegister', input);
    assert.deepStrictEqual(res, { ok: false, message: generic }, email);
  }
  env.setEmail('');
  assert.deepStrictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code }), { ok: false, message: generic });
  assert.strictEqual(sheet(env, 'USER_ACCOUNT').length, accountsBefore);
  assert.strictEqual(sheet(env, 'INVITE')[1][3], 'ACTIVE');
});

test('REGISTER: invite หมดอายุ / ถูก revoke ใช้ไม่ได้, rate limit ต่ออีเมล', () => {
  const env = createEnv(sampleSheets());
  const old = issueInvite(env, 'M008');
  const inv = issueInvite(env, 'M008'); // old ถูก revoke
  env.setEmail('x@example.ac.th');
  assert.strictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: old.code }).ok, false);

  sheet(env, 'INVITE')[2][6] = newDate(env, '2020-01-01');
  env.setEmail('y@example.ac.th');
  assert.strictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code }).ok, false);
  sheet(env, 'INVITE')[2][6] = newDate(env, '2099-01-01');

  env.setEmail('z@example.ac.th');
  for (let i = 0; i < 5; i++) api(env, 'apiRegister', { studentId: '6500008', inviteCode: 'bad' });
  assert.strictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code }).ok, false, 'rate limited');

  env.setEmail('w@example.ac.th');
  assert.strictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code }).ok, true);
});

test('REGISTER: ตรวจซ้ำใต้ lock — สมาชิกที่ผูกบัญชีแล้วสมัครซ้ำไม่ได้แม้ invite ยัง ACTIVE', () => {
  const env = createEnv(sampleSheets());
  const inv = issueInvite(env, 'M008');
  // จำลองว่ามีคำขออื่นผูกบัญชีให้ M008 ไปก่อนแล้ว (race)
  sheet(env, 'USER_ACCOUNT').push(['U099', 'M008', 'first@example.ac.th', 'MEMBER', 'ACTIVE', '', '']);
  env.setEmail('second@example.ac.th');
  const locksBefore = env.state.lockCalls;
  assert.strictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code }).ok, false);
  assert.ok(env.state.lockCalls > locksBefore);
  assert.strictEqual(env.state.locked, false);
});

test('REGISTER: รหัสนักศึกษาซ้ำใน MEMBER → ปฏิเสธ (ระบุตัวตนไม่ได้แน่ชัด)', () => {
  const s = sampleSheets();
  s.MEMBER.push(['M009', 'ซ้ำ', '6500008', 'ฝ่ายสถานที่', 'สมาชิก', 'ปฏิบัติหน้าที่']);
  const env = createEnv(s);
  const inv = issueInvite(env, 'M008');
  env.setEmail('dup@example.ac.th');
  assert.strictEqual(api(env, 'apiRegister', { studentId: '6500008', inviteCode: inv.code }).ok, false);
});

test('SCHEMA: ชีทขาดคอลัมน์บังคับ → fail-closed', () => {
  const s = sampleSheets();
  s.BUDGET = [['รหัสรายการ', 'งบประมาณตั้งต้น'], ['B001', 100]];
  const env = createEnv(s, { email: 'president@example.ac.th' });
  assert.strictEqual(api(env, 'apiReadModule', 'BUDGET').error.code, 'SCHEMA');
});
