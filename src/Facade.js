/**
 * Facade.js — ประตูเดียวสำหรับอ่าน/เขียนข้อมูลโมดูล
 *
 * READ  : ตรวจ flag → ตรวจสิทธิ์ → กรองตามฝ่าย/บทบาท → ตัดคอลัมน์ที่ไม่มีสิทธิ์เห็น
 * WRITE : ตรวจ flag (ต้องเป็น ENABLED เท่านั้น) → ตรวจสิทธิ์ → ตรวจข้อมูล → เขียนใต้ lock → audit
 */

function assertReadEnabled_(moduleKey) {
  if (FEATURE_FLAGS.READ[moduleKey] !== FLAG.ENABLED_READ_ONLY) {
    throw new AppError('FEATURE_DISABLED', 'โมดูล ' + moduleKey + ' ยังไม่เปิดให้อ่าน');
  }
}

function assertWriteEnabled_(entityKey) {
  // fail-closed: ค่าใดที่ไม่ใช่ ENABLED (รวมถึงไม่มีค่า) = ปิด
  if (FEATURE_FLAGS.WRITE[entityKey] !== FLAG.ENABLED) {
    throw new AppError('FEATURE_DISABLED', 'โมดูล ' + entityKey + ' ยังไม่เปิดให้เขียนข้อมูล (รอการอนุมัติ)');
  }
}

/** MEMBER เห็นเฉพาะงานที่ตนเป็นผู้รับผิดชอบหลัก/ร่วม (จับคู่รหัสสมาชิกหรือชื่อตรงตัว) */
function isAssignedToUser_(table, row, user) {
  const tokens = splitList_(fieldValue_(table, row, 'ownerMain'))
    .concat(splitList_(fieldValue_(table, row, 'ownerCo')));
  return tokens.some(function (t) {
    return t === user.memberId || (!isBlank_(user.memberName) && t === user.memberName);
  });
}

/** กรองแถวตามสิทธิ์ของผู้ใช้ — คืน [] ถ้าไม่มีสิทธิ์เห็นแถวใดเลย, โยน error ถ้าไม่มีสิทธิ์เข้าโมดูล */
function scopeRows_(user, table) {
  const def = ENTITIES[table.entityKey];
  const idHeader = table.cols[def.idField];
  const rows = table.rows.filter(function (r) { return !isBlank_(r[idHeader]); });

  if (isProjectScope_(user)) return rows;

  if (isDepartmentScope_(user)) {
    if (!def.deptField) return rows; // ไม่มีมิติฝ่าย (เช่น REGISTRATION) — ผ่านการตรวจสิทธิ์ระดับบทบาทแล้ว
    return rows.filter(function (r) { return sameDepartment_(user, fieldValue_(table, r, def.deptField)); });
  }

  if (user.scope === SCOPE.SELF && table.entityKey === 'TASK') {
    return rows.filter(function (r) { return isAssignedToUser_(table, r, user); });
  }
  throw new AppError('FORBIDDEN', 'ไม่มีสิทธิ์ดูข้อมูลส่วนนี้');
}

/** โมดูล → ขอบเขตสิทธิ์ที่อนุญาตให้อ่าน (ใช้ literal เพื่อไม่พึ่งลำดับการโหลดไฟล์) */
const READ_ACCESS = Object.freeze({
  TASK: ['PROJECT', 'DEPARTMENT', 'SELF'],
  DOCUMENT: ['PROJECT', 'DEPARTMENT'],
  LETTER: ['PROJECT', 'DEPARTMENT'],
  REGISTRATION: ['PROJECT', 'DEPARTMENT'],
  BUDGET: ['PROJECT', 'DEPARTMENT'],
  RISK: ['PROJECT', 'DEPARTMENT'],
  EVIDENCE: ['PROJECT', 'DEPARTMENT'],
  EVALUATION: ['PROJECT'],
});

function assertCanRead_(user, moduleKey) {
  assertReadEnabled_(moduleKey);
  const allowed = READ_ACCESS[moduleKey] || [];
  if (allowed.indexOf(user.scope) === -1) throw new AppError('FORBIDDEN', 'ไม่มีสิทธิ์ดูข้อมูลส่วนนี้');
}

function stripInternal_(row, dropHeaders) {
  const out = {};
  Object.keys(row).forEach(function (k) {
    if (k === '_row') return;
    if (dropHeaders && dropHeaders.indexOf(k) !== -1) return;
    out[k] = row[k];
  });
  return out;
}

/**
 * อ่านข้อมูลโมดูล (READ-ONLY facade)
 * @return {Object[]} แถวที่ผู้ใช้มีสิทธิ์เห็น
 */
function readModule_(user, moduleKey) {
  assertCanRead_(user, moduleKey);

  if (moduleKey === 'EVALUATION') return readEvaluation_(user);

  const table = readTable_(moduleKey);
  const rows = scopeRows_(user, table);

  let drop = null;
  if (moduleKey === 'EVIDENCE' && !isProjectScope_(user)) {
    // แยกส่วนตรวจ: ระดับฝ่ายไม่เห็นคอลัมน์ผลการตรวจ
    drop = ENTITIES.EVIDENCE.reviewHeaders;
  }
  return rows.map(function (r) { return stripInternal_(r, drop); });
}

/** EVALUATION: dual-source (คำถาม + คำตอบ) รวมภายในเซิร์ฟเวอร์ */
function readEvaluation_(user) {
  const q = readTable_('EVALUATION_QUESTION');
  const r = readTable_('EVALUATION_RESPONSE');
  return {
    questions: scopeRows_(user, q).map(function (x) { return stripInternal_(x); }),
    responses: scopeRows_(user, r).map(function (x) { return stripInternal_(x); }),
  };
}

/* ------------------------------------------------------------------ */
/* WRITE                                                                */
/* ------------------------------------------------------------------ */

/** field อ้างอิงที่ต้องเป็นรหัสรูปแบบถูกต้อง (ถ้าไม่ว่าง) */
const REFERENCE_RULES = Object.freeze({
  TASK: { documentIds: 'DOCUMENT', evidenceIds: 'EVIDENCE' },
  DOCUMENT: { taskId: 'TASK' },
});

function assertCanWriteDept_(user, dept) {
  if (isProjectScope_(user)) return;
  if (isDepartmentScope_(user) && sameDepartment_(user, dept)) return;
  throw new AppError('FORBIDDEN', 'ไม่มีสิทธิ์บันทึกข้อมูลของฝ่ายนี้');
}

/** ตรวจ/ทำความสะอาด payload: เฉพาะหัวคอลัมน์ที่มีจริง, ห้ามแก้รหัส */
function cleanPayload_(table, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('VALIDATION', 'ข้อมูลไม่ถูกต้อง');
  }
  const def = ENTITIES[table.entityKey];
  const idHeader = table.cols[def.idField];
  const out = {};
  Object.keys(data).forEach(function (k) {
    if (k === idHeader || k === '_row') throw new AppError('VALIDATION', 'ไม่อนุญาตให้กำหนด/แก้ไขรหัสเอง');
    if (table.headers.indexOf(k) === -1) throw new AppError('VALIDATION', 'ไม่รู้จักคอลัมน์: ' + k);
    const v = data[k];
    if (v !== null && typeof v === 'object') throw new AppError('VALIDATION', 'ค่าของ ' + k + ' ไม่ถูกต้อง');
    out[k] = v === null || v === undefined ? '' : v;
  });

  const refs = REFERENCE_RULES[table.entityKey] || {};
  Object.keys(refs).forEach(function (fieldKey) {
    const h = table.cols[fieldKey];
    if (!h || !Object.prototype.hasOwnProperty.call(out, h)) return;
    splitList_(out[h]).forEach(function (ref) {
      if (!isValidId_(refs[fieldKey], ref)) {
        throw new AppError('VALIDATION', 'รหัสอ้างอิงไม่ถูกต้องใน ' + h + ': ' + ref);
      }
    });
  });
  return out;
}

/** สร้างระเบียนใหม่ (เฉพาะโมดูลที่ WRITE = ENABLED) */
function createRecordFacade_(user, entityKey, data) {
  assertWriteEnabled_(entityKey);
  return withDocumentLock_(function () {
    const table = readTable_(entityKey);
    const def = ENTITIES[entityKey];
    const payload = cleanPayload_(table, data);
    const deptHeader = table.cols[def.deptField];
    if (isBlank_(payload[deptHeader])) throw new AppError('VALIDATION', 'กรุณาระบุ ' + deptHeader);
    assertCanWriteDept_(user, payload[deptHeader]);

    const idHeader = table.cols[def.idField];
    const newId = nextId_(def.prefix, table.rows.map(function (r) { return r[idHeader]; }));
    payload[idHeader] = newId;
    appendRecord_(table, payload);

    writeAudit_({
      userId: user.userId,
      action: 'CREATE',
      tableName: def.sheets[0],
      recordId: newId,
      oldValue: '',
      newValue: payload,
    });
    return { id: newId };
  });
}

/** แก้ไขระเบียน (เฉพาะโมดูลที่ WRITE = ENABLED) */
function updateRecordFacade_(user, entityKey, id, changes) {
  assertWriteEnabled_(entityKey);
  if (!isValidId_(entityKey, id)) throw new AppError('VALIDATION', 'รหัสไม่ถูกต้อง');
  return withDocumentLock_(function () {
    const table = readTable_(entityKey);
    const def = ENTITIES[entityKey];
    const payload = cleanPayload_(table, changes);
    const row = findRowById_(table, id);
    if (!row) throw new AppError('NOT_FOUND', 'ไม่พบรายการ ' + id);

    const deptHeader = table.cols[def.deptField];
    assertCanWriteDept_(user, row[deptHeader]);
    if (Object.prototype.hasOwnProperty.call(payload, deptHeader)) {
      if (isBlank_(payload[deptHeader])) throw new AppError('VALIDATION', 'กรุณาระบุ ' + deptHeader);
      assertCanWriteDept_(user, payload[deptHeader]);
    }

    const oldValue = {};
    const newValue = {};
    Object.keys(payload).forEach(function (h) {
      if (String(row[h]) !== String(payload[h])) {
        oldValue[h] = row[h];
        newValue[h] = payload[h];
      }
    });
    if (!Object.keys(newValue).length) return { id: id, changed: false };

    updateRecord_(table, row._row, newValue);
    writeAudit_({
      userId: user.userId,
      action: 'UPDATE',
      tableName: def.sheets[0],
      recordId: id,
      oldValue: oldValue,
      newValue: newValue,
    });
    return { id: id, changed: true };
  });
}
