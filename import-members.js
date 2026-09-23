// ============================================================
// import-members.js — แปลงข้อความที่คัดลอกจากชีท MEMBER (Ctrl+C) เป็นข้อมูลสมาชิก
//
// Google Sheets คัดลอกเป็นข้อความคั่นด้วย Tab (เซลล์ที่มีขึ้นบรรทัดใหม่จะอยู่ใน "...")
// รองรับทั้งแบบมีแถวหัวคอลัมน์ และแบบไม่มี (ใช้ลำดับคอลัมน์ A–M ของชีท MEMBER)
// เก็บเฉพาะข้อมูลที่ระบบต้องใช้ — ไม่นำเข้าเบอร์โทร / Line ID / อีเมล
// ============================================================

// หัวคอลัมน์ในชีท → ชื่อ field (เทียบแบบตัดช่องว่าง/ขึ้นบรรทัดออก)
const HEADER_MAP = {
    'รหัสสมาชิก': 'id',
    'รหัสนักศึกษา': 'student_id',
    'คำนำหน้า': 'title',
    'ชื่อ': 'first_name',
    'นามสกุล': 'last_name',
    'ชื่อเล่น': 'nickname',
    'ฝ่ายหลัก': 'department',
    'บทบาท/ตำแหน่ง': 'position',
    'สถานะการทำงาน': 'work_status',
};

// ลำดับคอลัมน์ของชีท MEMBER (A–M) เมื่อไม่ได้คัดลอกแถวหัวคอลัมน์มาด้วย
const DEFAULT_COLUMNS = [
    'id', 'student_id', 'title', 'first_name', 'last_name', 'nickname',
    'department', 'position', 'phone', 'line_id', 'email', 'work_status', 'note',
];

const MAX_TEXT_LENGTH = 500000;

/** แยกข้อความ TSV เป็นแถว/เซลล์ (รองรับเซลล์ใน "..." ที่มี Tab / ขึ้นบรรทัด / "" ข้างใน) */
function parseTsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let i = 0;
    let quoted = false;
    let atCellStart = true;

    while (i < text.length) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
                quoted = false; i += 1; continue;
            }
            cell += ch; i += 1; continue;
        }
        if (ch === '"' && atCellStart) { quoted = true; atCellStart = false; i += 1; continue; }
        if (ch === '\t') { row.push(cell); cell = ''; atCellStart = true; i += 1; continue; }
        if (ch === '\r' || ch === '\n') {
            row.push(cell); rows.push(row);
            row = []; cell = ''; atCellStart = true;
            i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
            continue;
        }
        cell += ch; atCellStart = false; i += 1;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

/** ตัดขึ้นบรรทัด (การตัดคำในเซลล์) และช่องว่างซ้ำ */
function clean(value) {
    return String(value || '').replace(/[\r\n]+/g, '').replace(/[  ]+/g, ' ').trim();
}

const headerKey = (value) => String(value || '').replace(/\s+/g, '');

/**
 * @param {string} text ข้อความที่วางจาก Google Sheets
 * @returns {{header_detected: boolean, rows: Array<{id, student_id, full_name, nickname, department, position, work_status}>}}
 */
function parseMemberPaste(text) {
    if (typeof text !== 'string' || !text.trim()) {
        const err = new Error('กรุณาวางข้อมูลจากชีท MEMBER');
        err.status = 400;
        throw err;
    }
    if (text.length > MAX_TEXT_LENGTH) {
        const err = new Error('ข้อมูลยาวเกินไป');
        err.status = 400;
        throw err;
    }

    const table = parseTsv(text).filter((r) => r.some((c) => clean(c) !== ''));
    let columns = DEFAULT_COLUMNS;
    let headerDetected = false;

    const first = (table[0] || []).map(headerKey);
    if (first.includes(headerKey('รหัสสมาชิก'))) {
        columns = first.map((h) => {
            const hit = Object.keys(HEADER_MAP).find((k) => headerKey(k) === h);
            return hit ? HEADER_MAP[hit] : null;
        });
        headerDetected = true;
        table.shift();
    }

    const rows = [];
    for (const cells of table) {
        const rec = {};
        columns.forEach((field, idx) => {
            if (field) rec[field] = clean(cells[idx]);
        });
        if (!rec.id) continue; // แถวที่ไม่มีรหัสสมาชิก (เช่นแถวว่างท้ายตาราง) ข้าม
        const name = [((rec.title || '') + (rec.first_name || '')).trim(), rec.last_name || '']
            .filter(Boolean).join(' ');
        rows.push({
            id: rec.id.toUpperCase(),
            student_id: rec.student_id || '',
            full_name: name,
            nickname: rec.nickname || '',
            department: rec.department || '',
            position: rec.position || '',
            work_status: rec.work_status || '',
        });
    }
    return { header_detected: headerDetected, rows };
}

module.exports = { parseTsv, parseMemberPaste };
