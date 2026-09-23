/**
 * โหลดไฟล์ใน src/ เข้า vm context เดียวกัน พร้อม Apps Script services จำลอง
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class FakeRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr: nr || 1, nc: nc || 1 });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValue(v) { this.setValues([[v]]); }
  setValues(vals) {
    this.sheet.writes++;
    vals.forEach((line, r) => line.forEach((v, c) => {
      const rr = this.row - 1 + r;
      while (this.sheet.data.length <= rr) this.sheet.data.push([]);
      this.sheet.data[rr][this.col - 1 + c] = v;
    }));
  }
}

class FakeSheet {
  constructor(name, data) { this.name = name; this.data = data; this.writes = 0; }
  getName() { return this.name; }
  getDataRange() {
    const w = Math.max(0, ...this.data.map((r) => r.length));
    return new FakeRange(this, 1, 1, this.data.length, w);
  }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr, nc); }
  appendRow(vals) { this.writes++; this.data.push(vals.slice()); }
  setFrozenRows() {}
}

function createEnv(sheets, opts) {
  opts = opts || {};
  const ss = {
    sheets: {},
    getSheetByName(n) { return this.sheets[n] || null; },
    insertSheet(n) { this.sheets[n] = new FakeSheet(n, []); return this.sheets[n]; },
  };
  Object.keys(sheets).forEach((n) => { ss.sheets[n] = new FakeSheet(n, sheets[n]); });

  const state = { email: opts.email || '', lockCalls: 0, cache: {}, logs: [] };
  const lock = {
    tryLock() { state.lockCalls++; state.locked = true; return true; },
    releaseLock() { state.locked = false; },
  };

  const ctx = {
    console: {
      log: (...a) => state.logs.push(['log', a.join(' ')]),
      warn: (...a) => state.logs.push(['warn', a.join(' ')]),
      error: (...a) => state.logs.push(['error', a.join(' ')]),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.email }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.ac.th' }),
    },
    LockService: { getDocumentLock: () => lock, getScriptLock: () => lock },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in state.cache ? state.cache[k] : null),
        put: (k, v) => { state.cache[k] = v; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(text, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
    },
  };
  vm.createContext(ctx);
  const srcDir = path.join(__dirname, '..', 'src');
  fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f });
  });

  return {
    ss,
    state,
    ctx,
    get: (expr) => vm.runInContext(expr, ctx),
    setEmail: (e) => { state.email = e; },
    totalWrites: () => Object.values(ss.sheets).reduce((s, sh) => s + sh.writes, 0),
  };
}

/** ชุดข้อมูลตัวอย่าง */
function sampleSheets() {
  return {
    TASK_MASTER: [
      ['รหัสงาน', 'ฝ่ายที่รับผิดชอบ', 'ชื่องาน/กิจกรรม', 'ผู้รับผิดชอบหลัก', 'ผู้รับผิดชอบร่วม', 'สถานะงาน', 'รหัสเอกสารที่เกี่ยวข้อง', 'รหัสหลักฐาน', 'เหลือเวลา'],
      ['T001', 'ฝ่ายวิชาการ', 'งาน 1', 'M003', '', 'กำลังดำเนินการ', 'D001', '', -2],
      ['T002', 'ฝ่ายวิชาการ', 'งาน 2', 'M003', 'M005', 'เสร็จสิ้น', '', '', -10],
      ['T003', 'ฝ่ายสถานที่', 'งาน 3', 'M004', '', 'ยกเลิก', '', '', -1],
      ['T004', 'ฝ่ายสถานที่', 'งาน 4', 'M004', '', 'กำลังดำเนินการ', '', '', 2],
      ['T005', 'ฝ่ายสถานที่', 'งาน 5', 'M004', '', 'เสร็จสิ้น', '', 'E001', 5],
      ['T006', 'ฝ่ายวิชาการ', 'งาน 6', 'M003', '', 'ยังไม่เริ่ม', '', '', 0],
      ['', 'ฝ่ายวิชาการ', 'แถวว่าง', '', '', 'เสร็จสิ้น', '', '', 0],
      ['T007', 'ฝ่ายวิชาการ', 'งาน 7', 'M003', '', 'เสร็จสิ้น ', '', '', 4],
    ],
    DOCUMENT: [
      ['รหัสเอกสาร', 'ฝ่ายที่รับผิดชอบ', 'รหัสงานที่เกี่ยวข้อง', 'ชื่อเอกสาร', 'สถานะ'],
      ['D001', 'ฝ่ายวิชาการ', 'T001', 'เอกสาร 1', 'รออนุมัติ'],
      ['D002', 'ฝ่ายวิชาการ', 'T002', 'เอกสาร 2', 'รอตรวจ'],
      ['D003', 'ฝ่ายสถานที่', 'T004', 'เอกสาร 3', 'ร่าง'],
      ['D004', 'ฝ่ายสถานที่', 'T004', 'เอกสาร 4', 'ต้องแก้ไข'],
      ['D005', 'ฝ่ายสถานที่', 'T005', 'เอกสาร 5', 'อนุมัติแล้ว'],
    ],
    LETTER_TRACKER: [
      ['รหัสหนังสือ', 'ฝ่ายที่เสนอเรื่อง', 'รหัสงานที่เกี่ยวข้อง', 'สถานะ'],
      ['L001', 'ฝ่ายวิชาการ', 'T001', 'ส่งแล้ว-รอตอบรับ'],
      ['L002', 'ฝ่ายสถานที่', 'T004', 'ได้รับตอบรับแล้ว'],
    ],
    REGISTRATION: [
      ['รหัสผู้ลงทะเบียน', 'ชื่อ', 'สถานะ'],
      ['R001', 'ก', 'เช็คอินแล้ว'],
      ['R002', 'ข', 'ลงทะเบียนแล้ว'],
      ['R003', 'ค', 'เช็คอินแล้ว'],
    ],
    BUDGET: [
      ['รหัสรายการ', 'ฝ่ายที่ขอใช้', 'งบประมาณตั้งต้น', 'ค่าใช้จ่ายจริง'],
      ['B001', 'ฝ่ายวิชาการ', 1000, 800],
      ['B002', 'ฝ่ายสถานที่', '2,500', 3000],
    ],
    RISK_ISSUE: [
      ['รหัสประเด็น', 'ฝ่ายที่รับผิดชอบ', 'รหัสงานที่เกี่ยวข้อง', 'สถานะ'],
      ['RI001', 'ฝ่ายวิชาการ', 'T001', 'แก้ไขเสร็จสิ้น'],
      ['RI002', 'ฝ่ายสถานที่', 'T004', 'ปิดประเด็น'],
      ['RI003', 'ฝ่ายสถานที่', 'T004', 'กำลังแก้ไข'],
    ],
    EVIDENCE: [
      ['รหัสหลักฐาน', 'ฝ่ายที่รับผิดชอบ', 'รหัสงานที่เกี่ยวข้อง', 'ลิงก์', 'ผลการตรวจ'],
      ['E001', 'ฝ่ายวิชาการ', 'T005', 'http://x', 'ผ่าน'],
      ['E002', 'ฝ่ายวิชาการ', 'T002 ', 'http://y', ''],
    ],
    MEMBER: [
      ['รหัสสมาชิก', 'ชื่อ-นามสกุล', 'รหัสนักศึกษา', 'ฝ่ายหลัก', 'บทบาท/ตำแหน่ง', 'สถานะการทำงาน'],
      ['M001', 'ประธาน', '6500001', 'ฝ่ายบริหาร', 'ประธานโครงการ', 'ปฏิบัติหน้าที่'],
      ['M002', 'รองประธาน', '6500002', 'ฝ่ายบริหาร', 'รองประธานโครงการ', 'ปฏิบัติหน้าที่'],
      ['M003', 'หัวหน้าวิชาการ', '6500003', 'ฝ่ายวิชาการ', 'หัวหน้า', 'ปฏิบัติหน้าที่'],
      ['M004', 'เลขาสถานที่', '6500004', 'ฝ่ายสถานที่', 'เลขา', 'ปฏิบัติหน้าที่'],
      ['M005', 'สมาชิกวิชาการ', '6500005', 'ฝ่ายวิชาการ', 'สมาชิก', 'ปฏิบัติหน้าที่'],
      ['M006', 'ลาออก', '6500006', 'ฝ่ายวิชาการ', 'สมาชิก', 'พ้นสภาพ'],
      ['M007', 'ตำแหน่งแปลก', '6500007', 'ฝ่ายวิชาการ', 'หัวหน้าฝ่าย', 'ปฏิบัติหน้าที่'],
      ['M008', 'สมาชิกใหม่', '6500008', 'ฝ่ายสถานที่', 'สมาชิก', 'ปฏิบัติหน้าที่'],
    ],
    USER_ACCOUNT: [
      ['user_id', 'member_id', 'email', 'role', 'account_status', 'last_login', 'created_date'],
      ['U001', 'M001', 'president@example.ac.th', 'PRESIDENT', 'ACTIVE', '', ''],
      ['U002', 'M003', 'head@example.ac.th', 'HEAD', 'ACTIVE', '', ''],
      ['U003', 'M005', 'member@example.ac.th', 'MEMBER', 'ACTIVE', '', ''],
      ['U004', 'M004', 'secretary@example.ac.th', 'SECRETARY', 'ACTIVE', '', ''],
      ['U005', 'M002', 'admin@example.ac.th', 'ADMIN', 'ACTIVE', '', ''],
    ],
    EVALUATION_QUESTION: [['question_id', 'คำถาม'], ['EVQ001', 'พอใจไหม']],
    EVALUATION_RESPONSE: [['response_id', 'evaluation_id', 'registration_id', 'คะแนน'], ['EV001', 'EVQ001', 'R001', 5]],
    AUDIT_LOG: [['audit_id', 'timestamp', 'user_id', 'action', 'table_name', 'record_id', 'old_value', 'new_value', 'note']],
    INVITE: [['invite_id', 'member_id', 'code_hash', 'status', 'created_by', 'created_date', 'expires_at', 'used_date', 'used_by_user_id']],
  };
}

module.exports = { createEnv, sampleSheets };
