/**
 * Repository.js — ชั้นอ่าน/เขียนชีท (ใช้ภายในเซิร์ฟเวอร์เท่านั้น)
 *
 * แถวที่อ่านได้จะอยู่ในรูป { _row: <เลขแถวในชีท>, <หัวคอลัมน์>: <ค่า>, ... }
 */

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new AppError('CONFIG', 'ไม่พบ Spreadsheet (ตั้งค่า SPREADSHEET_ID ใน Script Properties)');
  return ss;
}

function getSheet_(entityKey) {
  const def = ENTITIES[entityKey];
  if (!def) throw new AppError('CONFIG', 'ไม่รู้จัก entity: ' + entityKey);
  const ss = getSpreadsheet_();
  for (let i = 0; i < def.sheets.length; i++) {
    const sh = ss.getSheetByName(def.sheets[i]);
    if (sh) return sh;
  }
  throw new AppError('CONFIG', 'ไม่พบชีท ' + def.sheets.join(' / '));
}

/** หา header จริงของ field (รองรับหลายชื่อ) หรือ null */
function resolveHeader_(headers, fieldSpec) {
  const candidates = Array.isArray(fieldSpec) ? fieldSpec : [fieldSpec];
  for (let i = 0; i < candidates.length; i++) {
    if (headers.indexOf(candidates[i]) !== -1) return candidates[i];
  }
  return null;
}

/**
 * อ่านตารางทั้งหมดของ entity (อ่านอย่างเดียว)
 * @return {{entityKey:string, headers:string[], cols:Object<string,string|null>, rows:Object[]}}
 */
function readTable_(entityKey) {
  const def = ENTITIES[entityKey];
  const sh = getSheet_(entityKey);
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(function (h) { return String(h).trim(); });

  const cols = {};
  Object.keys(def.fields).forEach(function (k) {
    cols[k] = resolveHeader_(headers, def.fields[k]);
  });
  const missing = (def.required || []).filter(function (k) { return !cols[k]; });
  if (missing.length) {
    // fail-closed: โครงสร้างชีทไม่ตรงสัญญา ห้ามทำงานต่อ
    throw new AppError('SCHEMA', 'ชีท ' + sh.getName() + ' ขาดคอลัมน์: ' +
      missing.map(function (k) { return [].concat(def.fields[k]).join('|'); }).join(', '));
  }

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const obj = { _row: r + 1 };
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = values[r][c];
    }
    rows.push(obj);
  }
  return { entityKey: entityKey, headers: headers, cols: cols, rows: rows };
}

/** ค่าของ field เชิงตรรกะในแถว */
function fieldValue_(table, row, fieldKey) {
  const h = table.cols[fieldKey];
  return h ? row[h] : undefined;
}

function findRowById_(table, id) {
  const h = table.cols[ENTITIES[table.entityKey].idField];
  const target = String(id).trim();
  for (let i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i][h]).trim() === target) return table.rows[i];
  }
  return null;
}

/** เพิ่มแถวใหม่ตามลำดับ header (ใช้ใต้ lock เท่านั้น) */
function appendRecord_(table, record) {
  const sh = getSheet_(table.entityKey);
  const rowValues = table.headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(record, h) ? sanitizeCellValue_(record[h]) : '';
  });
  sh.appendRow(rowValues);
}

/** อัปเดตค่าบางคอลัมน์ในแถว (ใช้ใต้ lock เท่านั้น) */
function updateRecord_(table, rowNumber, changes) {
  const sh = getSheet_(table.entityKey);
  Object.keys(changes).forEach(function (h) {
    const c = table.headers.indexOf(h);
    if (c === -1) throw new AppError('SCHEMA', 'ไม่พบคอลัมน์ ' + h);
    sh.getRange(rowNumber, c + 1).setValue(sanitizeCellValue_(changes[h]));
  });
}

/** รันฟังก์ชันใต้ document lock (fallback เป็น script lock ถ้าเป็น standalone script) */
function withDocumentLock_(fn) {
  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(REGISTRATION_CONFIG.LOCK_TIMEOUT_MS)) {
    throw new AppError('BUSY', 'ระบบกำลังประมวลผลรายการอื่น กรุณาลองใหม่อีกครั้ง');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
