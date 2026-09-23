// ============================================================
// app.js — หน้าเว็บ (ไม่มี framework)
// สิทธิ์จริงอยู่ที่ server/ฐานข้อมูล — การซ่อนปุ่มที่นี่เป็นแค่ความสะดวก
// ============================================================

const $ = (id) => document.getElementById(id);

const LABELS = {
  id: 'รหัส', department: 'ฝ่าย', name: 'ชื่อ', owner_main_id: 'ผู้รับผิดชอบหลัก', co_owner_ids: 'ผู้รับผิดชอบร่วม',
  status: 'สถานะ', related_document_ids: 'เอกสารที่เกี่ยวข้อง', evidence_ids: 'รหัสหลักฐาน', start_date: 'วันเริ่ม',
  due_date: 'กำหนดเสร็จ', note: 'หมายเหตุ', updated_at: 'แก้ไขล่าสุด', task_id: 'รหัสงานที่เกี่ยวข้อง', link: 'ลิงก์',
  subject: 'เรื่อง', recipient: 'ผู้รับ', full_name: 'ชื่อ-นามสกุล', contact: 'ติดต่อ', registered_at: 'ลงทะเบียนเมื่อ',
  checkin_status: 'สถานะเช็คอิน', checked_in_at: 'เช็คอินเมื่อ', item: 'รายการ', initial_budget: 'งบประมาณตั้งต้น', actual_cost: 'ค่าใช้จ่ายจริง',
  title: 'หัวข้อ', review_result: 'ผลการตรวจ', reviewer: 'ผู้ตรวจ', reviewed_at: 'วันที่ตรวจ', review_note: 'หมายเหตุการตรวจ',
  remaining_days: 'เหลือ (วัน)', invite_id: 'รหัส invite', member_id: 'รหัสสมาชิก', created_by: 'สร้างโดย',
  created_date: 'สร้างเมื่อ', expires_at: 'หมดอายุ', used_date: 'ใช้เมื่อ', used_by_user_id: 'ผู้ใช้',
  student_id: 'รหัสนักศึกษา', nickname: 'ชื่อเล่น', position: 'ตำแหน่ง', work_status: 'สถานะการทำงาน',
  question_id: 'รหัสคำถาม', question: 'คำถาม', sort_order: 'ลำดับ', response_id: 'รหัสคำตอบ',
  evaluation_id: 'รหัสแบบประเมิน', registration_id: 'รหัสผู้ลงทะเบียน', answers: 'คำตอบ', submitted_at: 'ส่งเมื่อ',
};
const MODULE_NAMES = {
  TASK: 'งาน', DOCUMENT: 'เอกสาร', LETTER: 'หนังสือ', REGISTRATION: 'การลงทะเบียน', BUDGET: 'งบประมาณ',
  RISK: 'ความเสี่ยง/ประเด็น', EVIDENCE: 'หลักฐาน', EVALUATION: 'แบบประเมิน',
};

let meta = { departments: [], statuses: {} };

// ---------- helpers ----------
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
function msg(id, text, ok) { $(id).className = 'msg ' + (ok ? 'ok' : 'err'); $(id).textContent = text || ''; }
function fmtNum(n) { return n === null || n === undefined ? '–' : Number(n).toLocaleString('th-TH'); }
function fmtCell(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString('th-TH');
  return v;
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'เกิดข้อผิดพลาด'), { status: res.status, data });
  return data;
}

function table(rows, cols) {
  if (!rows || !rows.length) return '<p class="muted">ไม่มีรายการ</p>';
  cols = cols || Object.keys(rows[0]);
  return '<table><thead><tr>' + cols.map((c) => `<th>${esc(LABELS[c] || c)}</th>`).join('') +
    '</tr></thead><tbody>' + rows.map((r) =>
      '<tr>' + cols.map((c) => `<td>${esc(fmtCell(r[c]))}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
}

// ---------- tabs ----------
function openTab(name) {
  document.querySelectorAll('section.tab').forEach((s) => s.classList.toggle('hidden', s.id !== name));
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'dashboard') loadDashboard();
  if (name === 'invite') loadInvites();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

// ---------- Dashboard ----------
async function loadDashboard() {
  try {
    const k = await api('/dashboard');
    $('dashScope').textContent = k.scope === 'PROJECT' ? '(ทั้งโครงการ)' : '(' + k.scope.replace('DEPARTMENT:', '') + ')';
    const items = [
      ['งานทั้งหมด', fmtNum(k.tasks.total)], ['กำลังดำเนินการ', fmtNum(k.tasks.in_progress)],
      ['เสร็จสิ้น', fmtNum(k.tasks.done)], ['ยกเลิก', fmtNum(k.tasks.cancelled)],
      ['เกินกำหนด', fmtNum(k.tasks.overdue)], ['ใกล้ครบกำหนด', fmtNum(k.tasks.due_soon)],
      ['อัตราสำเร็จ', k.tasks.success_rate === null ? '–' : Math.round(k.tasks.success_rate * 100) + '%'],
      ['เอกสารรออนุมัติ', fmtNum(k.documents.pending_approval)], ['เอกสารรอตรวจ', fmtNum(k.documents.pending_review)],
      ['หนังสือรอตอบรับ', fmtNum(k.letters.awaiting_reply)],
      ['ความเสี่ยงเปิดอยู่', fmtNum(k.risks.open)], ['ความเสี่ยงปิดแล้ว', fmtNum(k.risks.closed)],
      ['งานไม่มีหลักฐาน', fmtNum(k.evidence.done_without_evidence)],
      ['ลงทะเบียน', fmtNum(k.registrations.total)], ['เช็คอินแล้ว', fmtNum(k.registrations.checked_in)],
      ['งบตั้งต้น', fmtNum(k.budget.initial_budget)], ['ค่าใช้จ่ายจริง', fmtNum(k.budget.actual_cost)],
      ['สมาชิกปฏิบัติหน้าที่', fmtNum(k.team.active)],
    ];
    $('kpis').innerHTML = items.map(([l, v]) =>
      `<div class="kpi card"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
    const taskCols = ['id', 'name', 'department', 'status', 'remaining_days'];
    $('overdue').innerHTML = table(k.tasks.overdue_list, taskCols);
    $('dueSoon').innerHTML = table(k.tasks.due_soon_list, taskCols);
    $('docTracking').innerHTML = table(k.documents.tracking, ['id', 'name', 'department', 'status']);
    $('noEvidence').innerHTML = table(k.evidence.done_without_evidence_list, ['id', 'name', 'department']);
  } catch (e) {
    $('kpis').textContent = e.message;
  }
}

// ---------- ข้อมูลโมดูล ----------
$('btnLoadModule').addEventListener('click', async () => {
  const m = $('moduleSel').value;
  $('moduleTable').innerHTML = '';
  msg('moduleMsg', 'กำลังโหลด…', true);
  try {
    const data = await api('/modules/' + encodeURIComponent(m));
    msg('moduleMsg', '', true);
    $('moduleTable').innerHTML = m === 'EVALUATION'
      ? '<h3>คำถาม</h3>' + table(data.questions) + '<h3>คำตอบ</h3>' + table(data.responses)
      : table(data);
  } catch (e) {
    msg('moduleMsg', e.message, false);
  }
});

// ---------- ฟอร์มบันทึกงาน/เอกสาร ----------
const WRITE_FORMS = {
  tasks: [
    ['department', 'select:departments'], ['name', 'text'], ['status', 'select:TASK'],
    ['owner_main_id', 'text', 'M001'], ['co_owner_ids', 'text', 'M002, M003'],
    ['related_document_ids', 'text', 'D001, D002'], ['evidence_ids', 'text', 'E001'],
    ['start_date', 'date'], ['due_date', 'date'], ['note', 'text'],
  ],
  documents: [
    ['department', 'select:departments'], ['name', 'text'], ['status', 'select:DOCUMENT'],
    ['task_id', 'text', 'T001'], ['link', 'text', 'https://…'], ['note', 'text'],
  ],
};

function currentKind() { return document.querySelector('input[name=kind]:checked').value; }

function renderWriteFields() {
  $('writeFields').innerHTML = WRITE_FORMS[currentKind()].map(([key, type, ph]) => {
    const id = 'w_' + key;
    let input;
    if (type.startsWith('select:')) {
      const src = type.slice(7);
      const opts = src === 'departments' ? meta.departments : (meta.statuses[src] || []);
      input = `<select id="${id}" data-key="${key}"><option value="">— ไม่เปลี่ยน / ไม่ระบุ —</option>` +
        opts.map((o) => `<option>${esc(o)}</option>`).join('') + '</select>';
    } else {
      input = `<input id="${id}" data-key="${key}" type="${type}" placeholder="${esc(ph || '')}">`;
    }
    return `<label for="${id}">${esc(LABELS[key] || key)}</label>${input}`;
  }).join('');
}
document.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', renderWriteFields));

$('formWrite').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const body = {};
  document.querySelectorAll('#writeFields [data-key]').forEach((el) => {
    if (el.value.trim() !== '') body[el.dataset.key] = el.value.trim();
  });
  const id = $('wId').value.trim();
  try {
    const r = id
      ? await api(`/${currentKind()}/${encodeURIComponent(id)}`, { method: 'PATCH', body })
      : await api(`/${currentKind()}`, { method: 'POST', body });
    msg('writeMsg', 'บันทึกแล้ว: ' + r.id, true);
    $('formWrite').reset();
  } catch (e) {
    msg('writeMsg', e.message, false);
  }
});

// ---------- Invite ----------
async function loadInvites() {
  try {
    $('inviteList').innerHTML = table(await api('/invites'));
  } catch (e) {
    $('inviteList').textContent = e.message;
  }
}
$('formInvite').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const r = await api('/invites', { method: 'POST', body: { member_id: $('inviteMember').value.trim() } });
    $('inviteMsg').className = 'msg ok';
    $('inviteMsg').innerHTML = `Invite ${esc(r.invite_id)} สำหรับ ${esc(r.member_id)}: <code>${esc(r.code)}</code><br>` +
      `<small>ส่งให้สมาชิกทางช่องทางส่วนตัว · แสดงครั้งเดียวเท่านั้น · หมดอายุ ${esc(fmtCell(r.expires_at))}</small>`;
    loadInvites();
  } catch (e) {
    msg('inviteMsg', e.message, false);
  }
});

// ---------- นำเข้าสมาชิก (ADMIN) ----------
let importChecked = '';

function renderImport(r, saved) {
  const issues = (list, cls) => list.length
    ? `<table><thead><tr><th>แถว</th><th>รหัส</th><th>รายละเอียด</th></tr></thead><tbody>` +
      list.map((x) => `<tr class="${cls}"><td>${esc(x.row)}</td><td>${esc(x.id)}</td><td>${esc(x.message)}</td></tr>`).join('') +
      '</tbody></table>'
    : '<p class="muted">ไม่มี</p>';
  const head = saved
    ? `<p class="ok"><b>นำเข้าแล้ว</b></p>`
    : `<p><b>ผลการตรวจสอบ</b> (ยังไม่ได้บันทึก)${r.header_detected ? ' · พบแถวหัวคอลัมน์' : ''}</p>`;
  $('importResult').innerHTML = head +
    `<div class="grid">
      <div class="kpi card"><div class="v">${esc(r.rows)}</div><div class="l">แถวทั้งหมด</div></div>
      <div class="kpi card"><div class="v">${esc(r.inserted)}</div><div class="l">${saved ? 'เพิ่มแล้ว' : 'จะเพิ่มใหม่'}</div></div>
      <div class="kpi card"><div class="v">${esc(r.updated)}</div><div class="l">${saved ? 'อัปเดตแล้ว' : 'จะอัปเดต'}</div></div>
      <div class="kpi card"><div class="v">${esc(r.unchanged)}</div><div class="l">ไม่เปลี่ยน</div></div>
      <div class="kpi card"><div class="v">${esc(r.errors.length)}</div><div class="l">ข้อผิดพลาด</div></div>
      <div class="kpi card"><div class="v">${esc(r.warnings.length)}</div><div class="l">คำเตือน</div></div>
    </div>` +
    (r.new_departments.length ? `<p>ฝ่ายที่จะเพิ่มใหม่: ${r.new_departments.map(esc).join(', ')}</p>` : '') +
    `<h3 class="err">ข้อผิดพลาด (ต้องแก้ในชีทก่อนนำเข้า)</h3>${issues(r.errors, 'err')}` +
    `<h3>คำเตือน (นำเข้าได้)</h3>${issues(r.warnings, '')}` +
    `<h3>ตัวอย่างข้อมูลที่อ่านได้</h3><div class="scroll">${table(r.preview,
      ['id', 'student_id', 'full_name', 'nickname', 'department', 'position', 'work_status'])}</div>`;
}

async function runImport(dryRun) {
  const text = $('importText').value;
  const body = { text, create_departments: $('importCreateDepts').checked, dry_run: dryRun };
  msg('importMsg', dryRun ? 'กำลังตรวจสอบ…' : 'กำลังนำเข้า…', true);
  $('btnImportSave').disabled = true;
  try {
    const r = await api('/admin/members/import', { method: 'POST', body });
    msg('importMsg', '', true);
    renderImport(r, !dryRun && r.saved);
    importChecked = dryRun && r.ok ? text + '|' + body.create_departments : '';
    $('btnImportSave').disabled = !importChecked;
    if (!dryRun && r.saved) meta = await api('/meta').catch(() => meta);
  } catch (e) {
    msg('importMsg', e.message, false);
  }
}
$('btnImportCheck').addEventListener('click', () => runImport(true));
$('btnImportSave').addEventListener('click', () => {
  if (importChecked !== $('importText').value + '|' + $('importCreateDepts').checked) {
    return msg('importMsg', 'ข้อมูลเปลี่ยนหลังตรวจสอบ — กด ตรวจสอบ อีกครั้ง', false);
  }
  if (confirm('ยืนยันนำเข้าสมาชิก?')) runImport(false);
});
['importText', 'importCreateDepts'].forEach((id) => $(id).addEventListener('input', () => { $('btnImportSave').disabled = true; }));
$('importCreateDepts').addEventListener('change', () => { $('btnImportSave').disabled = true; });

// ---------- สมัครสมาชิก ----------
$('formRegister').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const r = await api('/register', {
      method: 'POST',
      body: { student_id: $('studentId').value, invite_code: $('inviteCode').value },
    });
    msg('regMsg', r.message, true);
    setTimeout(() => location.reload(), 1000);
  } catch (e) {
    msg('regMsg', (e.data && e.data.message) || e.message, false);
  }
});

// ---------- ออกจากระบบ ----------
$('btnLogout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST', headers: { 'x-requested-with': 'fetch' } });
  location.reload();
});

// ---------- เริ่มต้น ----------
async function boot() {
  let me;
  try {
    me = await api('/me');
  } catch (e) {
    $('who').textContent = e.message;
    return;
  }
  if (!me.logged_in) {
    $('who').textContent = '';
    show('btnLogin');
    show('welcome');
    return;
  }
  show('btnLogout');
  if (!me.registered) {
    $('who').textContent = me.email;
    $('regEmail').textContent = me.email;
    show('register');
    return;
  }

  const p = me.profile;
  $('who').textContent = `${me.email} · ${p.role}${p.department ? ' · ' + p.department : ''}`;
  meta = await api('/meta').catch(() => meta);
  show('tabs');

  const tabBtn = (t) => document.querySelector(`#tabs button[data-tab="${t}"]`);
  if (p.can_view_dashboard) tabBtn('dashboard').classList.remove('hidden');
  if (p.writable_modules.length) tabBtn('writer').classList.remove('hidden');
  if (p.can_create_invite) tabBtn('invite').classList.remove('hidden');
  if (p.role === 'ADMIN') tabBtn('importer').classList.remove('hidden');
  $('moduleSel').innerHTML = p.readable_modules
    .map((m) => `<option value="${esc(m)}">${esc(MODULE_NAMES[m] || m)}</option>`).join('');
  renderWriteFields();
  openTab(p.can_view_dashboard ? 'dashboard' : 'modules');
}

boot();
