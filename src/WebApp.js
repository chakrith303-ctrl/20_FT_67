/**
 * WebApp.js — จุดเข้าใช้งาน Web App และ API ที่ไคลเอนต์เรียกผ่าน google.script.run
 *
 * สำคัญ: ฟังก์ชันที่ไม่ลงท้ายด้วย "_" ถูกเรียกจาก browser ได้ทั้งหมด
 * จึงมีเฉพาะ API ด้านล่างนี้ และทุกตัวตรวจตัวตนจาก session ฝั่งเซิร์ฟเวอร์เอง
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบบริหารโครงการ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}

/** แปลงค่าให้ส่งผ่าน google.script.run ได้ (Date → ISO string) */
function toClientSafe_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if (Array.isArray(v)) return v.map(toClientSafe_);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(function (k) {
      if (k.charAt(0) !== '_') o[k] = toClientSafe_(v[k]);
    });
    return o;
  }
  return v;
}

function runApi_(fn) {
  try {
    return { ok: true, data: toClientSafe_(fn()) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message } };
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดภายในระบบ' } };
  }
}

function touchLastLogin_(user) {
  try {
    const t = user._accountTable;
    updateRecord_(t, user._accountRow, (function () { const o = {}; o[t.cols.last_login] = new Date(); return o; })());
  } catch (e) {
    console.warn('last_login update failed: ' + (e && e.message));
  }
}

/** ข้อมูลผู้ใช้ปัจจุบัน + สิทธิ์ที่ใช้ได้ */
function apiGetMe() {
  return runApi_(function () {
    const user = getCurrentUser_();
    touchLastLogin_(user);
    const writable = Object.keys(FEATURE_FLAGS.WRITE).filter(function (k) {
      return FEATURE_FLAGS.WRITE[k] === FLAG.ENABLED && user.scope !== SCOPE.SELF;
    });
    const readable = Object.keys(READ_ACCESS).filter(function (k) {
      return FEATURE_FLAGS.READ[k] === FLAG.ENABLED_READ_ONLY && READ_ACCESS[k].indexOf(user.scope) !== -1;
    });
    return {
      userId: user.userId,
      memberId: user.memberId,
      email: user.email,
      role: user.role,
      scope: user.scope,
      department: user.department,
      canViewDashboard: FEATURE_FLAGS.DASHBOARD === FLAG.ENABLED_READ_ONLY &&
        FEATURE_FLAGS.DASHBOARD_BY_ROLE[user.role] === FLAG.ENABLED_READ_ONLY,
      canCreateInvite: FEATURE_FLAGS.INVITE_CREATION === FLAG.ENABLED_CONTROLLED && user.scope === SCOPE.PROJECT,
      readableModules: readable,
      writableModules: writable,
    };
  });
}

/** Self-registration: รับเฉพาะ studentId + inviteCode (email/role จากไคลเอนต์ถูกละเลย) */
function apiRegister(input) {
  const safeInput = {
    studentId: input && input.studentId,
    inviteCode: input && input.inviteCode,
  };
  try {
    return selfRegister_(safeInput);
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, message: REGISTRATION_CONFIG.GENERIC_ERROR };
  }
}

function apiGetDashboard() {
  return runApi_(function () {
    return buildDashboard_(getCurrentUser_(), new Date());
  });
}

function apiReadModule(moduleKey) {
  return runApi_(function () {
    if (!Object.prototype.hasOwnProperty.call(READ_ACCESS, moduleKey)) {
      throw new AppError('VALIDATION', 'ไม่รู้จักโมดูล');
    }
    return readModule_(getCurrentUser_(), moduleKey);
  });
}

function apiCreateRecord(entityKey, data) {
  return runApi_(function () {
    if (!Object.prototype.hasOwnProperty.call(FEATURE_FLAGS.WRITE, entityKey)) {
      throw new AppError('VALIDATION', 'ไม่รู้จักโมดูล');
    }
    return createRecordFacade_(getCurrentUser_(), entityKey, data);
  });
}

function apiUpdateRecord(entityKey, id, changes) {
  return runApi_(function () {
    if (!Object.prototype.hasOwnProperty.call(FEATURE_FLAGS.WRITE, entityKey)) {
      throw new AppError('VALIDATION', 'ไม่รู้จักโมดูล');
    }
    return updateRecordFacade_(getCurrentUser_(), entityKey, id, changes);
  });
}

function apiCreateInvite(memberId) {
  return runApi_(function () {
    return createInvite_(getCurrentUser_(), memberId);
  });
}

/**
 * รันจาก Apps Script editor โดยเจ้าของสคริปต์เท่านั้น:
 * สร้างชีทระบบที่ยังไม่มี (USER_ACCOUNT, AUDIT_LOG, INVITE) พร้อมหัวคอลัมน์
 * ไม่แก้ไขชีทที่มีอยู่แล้ว
 */
function setupSystemSheets() {
  const owner = normalizeEmail_(Session.getEffectiveUser().getEmail());
  const active = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!owner || owner !== active) throw new Error('เฉพาะเจ้าของสคริปต์เท่านั้น');

  const ss = getSpreadsheet_();
  const created = [];
  ['USER_ACCOUNT', 'AUDIT_LOG', 'INVITE'].forEach(function (key) {
    const def = ENTITIES[key];
    if (ss.getSheetByName(def.sheets[0])) return;
    const sh = ss.insertSheet(def.sheets[0]);
    const headers = def.required.map(function (k) { return [].concat(def.fields[k])[0]; });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    created.push(def.sheets[0]);
  });
  console.log('created: ' + (created.join(', ') || '(none)'));
  return created;
}
