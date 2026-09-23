/**
 * Util.js — ฟังก์ชันช่วยทั่วไป (รหัส, hash, วันที่, ความปลอดภัยของค่าที่เขียนลงชีท)
 */

/** ข้อผิดพลาดที่ปลอดภัยต่อการแสดงผลให้ผู้ใช้ */
class AppError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
  }
}

function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function escapeRegExp_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** regex ตรวจรหัสของ entity เช่น T001, RI012, EVQ003 */
function idPattern_(prefix) {
  return new RegExp('^' + escapeRegExp_(prefix) + '(\\d{' + ID_MIN_DIGITS + ',})$');
}

function isValidId_(entityKey, id) {
  return idPattern_(ENTITIES[entityKey].prefix).test(String(id || '').trim());
}

/** รหัสสมาชิกอยู่ในช่วงที่ยืนยันแล้ว (M001–M087) */
function isConfirmedMemberId_(id) {
  const m = /^M(\d{3,})$/.exec(String(id || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 10);
  return n >= MEMBER_ID_CONFIRMED_RANGE.min && n <= MEMBER_ID_CONFIRMED_RANGE.max;
}

/** รหัสถัดไปจากรายการรหัสที่มีอยู่ (เลขมากสุด + 1, เติม 0 อย่างน้อย 3 หลัก) */
function nextId_(prefix, existingIds) {
  const re = idPattern_(prefix);
  let max = 0;
  existingIds.forEach(function (id) {
    const m = re.exec(String(id || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  let num = String(max + 1);
  while (num.length < ID_MIN_DIGITS) num = '0' + num;
  return prefix + num;
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (b) {
      const v = (b + 256) % 256;
      return (v < 16 ? '0' : '') + v.toString(16);
    })
    .join('');
}

/** เปรียบเทียบสตริงแบบใช้เวลาคงที่ (กัน timing attack) */
function constantTimeEquals_(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** กัน formula injection เมื่อเขียนค่าจากผู้ใช้ลงชีท */
function sanitizeCellValue_(v) {
  if (typeof v !== 'string') return v;
  if (/^[=+@\t\r]/.test(v) || /^-(?![\d.])/.test(v)) return "'" + v;
  return v;
}

function toNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (isBlank_(v)) return 0;
  const n = parseFloat(String(v).replace(/[,\s฿]/g, ''));
  return isFinite(n) ? n : 0;
}

/** แปลงค่าเป็นวันที่ (เที่ยงคืน) หรือ null */
function toDateOnly_(v) {
  if (isBlank_(v)) return null;
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween_(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function normalizeEmail_(e) {
  return String(e || '').trim().toLowerCase();
}

/** แยกรายการในเซลล์ เช่น "M001, M002" */
function splitList_(v) {
  if (isBlank_(v)) return [];
  return String(v)
    .split(/[,;\n]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}
