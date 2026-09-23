/**
 * Registration.js — Self-Registration Contract V1.1 และการสร้าง Invite
 *
 * - อีเมลจาก Google session ฝั่งเซิร์ฟเวอร์เท่านั้น
 * - จับคู่ตัวตนด้วย รหัสนักศึกษา + invite code
 * - invite เก็บเป็น SHA-256 hash, ใช้ได้ครั้งเดียว, active ได้สูงสุด 1 อันต่อคน
 * - บทบาทมาจากตำแหน่งใน MEMBER (ผู้ใช้เลือกเองไม่ได้)
 * - ตรวจซ้ำทั้งหมดใต้ document lock ก่อนบันทึก
 * - ล้มเหลว → ข้อความกลาง ๆ ไม่ระบุ field, สำเร็จ → audit log
 */

/** รูปแบบ invite code ที่แสดงให้ผู้ใช้ (128-bit hex แบ่งกลุ่มละ 4) */
function generateInviteCode_() {
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toUpperCase().slice(0, 32);
  return hex.match(/.{4}/g).join('-');
}

function normalizeInviteCode_(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function hashInviteCode_(code) {
  return sha256Hex_(normalizeInviteCode_(code));
}

function isInviteExpired_(invite, cols, now) {
  const exp = invite[cols.expires_at];
  if (isBlank_(exp)) return false;
  const d = exp instanceof Date ? exp : new Date(exp);
  return !isNaN(d.getTime()) && d.getTime() < now.getTime();
}

/* ------------------------------------------------------------------ */
/* Invite creation (ENABLED_CONTROLLED)                                 */
/* ------------------------------------------------------------------ */

/**
 * สร้าง invite ให้สมาชิก — เฉพาะระดับโครงการ (ADMIN/PRESIDENT/VICE_PRESIDENT)
 * invite ACTIVE เดิมของสมาชิกคนนั้นจะถูก REVOKED (คงไว้สูงสุด 1 อัน)
 * @return {{inviteId:string, memberId:string, code:string, expiresAt:string}} code แสดงครั้งเดียว
 */
function createInvite_(user, memberId) {
  if (FEATURE_FLAGS.INVITE_CREATION !== FLAG.ENABLED_CONTROLLED) {
    throw new AppError('FEATURE_DISABLED', 'ยังไม่เปิดการสร้าง invite');
  }
  requireProjectScope_(user);
  memberId = String(memberId || '').trim();
  if (!isValidId_('MEMBER', memberId)) throw new AppError('VALIDATION', 'รหัสสมาชิกไม่ถูกต้อง');

  return withDocumentLock_(function () {
    const members = readTable_('MEMBER');
    const member = findRowById_(members, memberId);
    if (!member) throw new AppError('NOT_FOUND', 'ไม่พบสมาชิก ' + memberId);
    if (member[members.cols.workStatus] !== STATUS.MEMBER_ACTIVE) {
      throw new AppError('VALIDATION', 'สมาชิกไม่อยู่ในสถานะปฏิบัติหน้าที่');
    }
    if (!roleFromPosition_(member[members.cols.position])) {
      throw new AppError('VALIDATION', 'ตำแหน่งของสมาชิกไม่ตรงกับบทบาทที่รองรับ');
    }
    if (!members.cols.studentId || isBlank_(member[members.cols.studentId])) {
      throw new AppError('VALIDATION', 'สมาชิกยังไม่มีรหัสนักศึกษา');
    }

    const accounts = readTable_('USER_ACCOUNT');
    const hasAccount = accounts.rows.some(function (r) {
      return String(r[accounts.cols.member_id]).trim() === memberId;
    });
    if (hasAccount) throw new AppError('VALIDATION', 'สมาชิกนี้มีบัญชีผู้ใช้แล้ว');

    const invites = readTable_('INVITE');
    const ic = invites.cols;
    const revoked = [];
    invites.rows.forEach(function (r) {
      if (String(r[ic.member_id]).trim() === memberId && r[ic.status] === STATUS.INVITE_ACTIVE) {
        const change = {};
        change[ic.status] = STATUS.INVITE_REVOKED;
        updateRecord_(invites, r._row, change);
        revoked.push(r[ic.invite_id]);
      }
    });

    const code = generateInviteCode_();
    const now = new Date();
    const expires = new Date(now.getTime() + REGISTRATION_CONFIG.INVITE_TTL_DAYS * 86400000);
    const inviteId = nextId_(ENTITIES.INVITE.prefix, invites.rows.map(function (r) { return r[ic.invite_id]; }));
    const rec = {};
    rec[ic.invite_id] = inviteId;
    rec[ic.member_id] = memberId;
    rec[ic.code_hash] = hashInviteCode_(code); // ไม่เก็บ plaintext
    rec[ic.status] = STATUS.INVITE_ACTIVE;
    rec[ic.created_by] = user.userId;
    rec[ic.created_date] = now;
    rec[ic.expires_at] = expires;
    rec[ic.used_date] = '';
    rec[ic.used_by_user_id] = '';
    appendRecord_(invites, rec);

    writeAudit_({
      userId: user.userId,
      action: 'INVITE_CREATE',
      tableName: 'INVITE',
      recordId: inviteId,
      oldValue: revoked.length ? { revoked: revoked } : '',
      newValue: { invite_id: inviteId, member_id: memberId, status: STATUS.INVITE_ACTIVE, expires_at: expires.toISOString() },
      note: 'สร้าง invite (เก็บเฉพาะ hash)',
    });

    return { inviteId: inviteId, memberId: memberId, code: code, expiresAt: expires.toISOString() };
  });
}

/* ------------------------------------------------------------------ */
/* Self-registration (ENABLED_CONTROLLED)                               */
/* ------------------------------------------------------------------ */

/** จำกัดจำนวนครั้งที่พยายามสมัครต่ออีเมล (กันการเดา invite) */
function checkRateLimit_(email) {
  const cache = CacheService.getScriptCache();
  const key = 'regattempt:' + sha256Hex_(email);
  const n = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(n), REGISTRATION_CONFIG.RATE_LIMIT_WINDOW_SEC);
  return n <= REGISTRATION_CONFIG.RATE_LIMIT_MAX_ATTEMPTS;
}

/** ปฏิเสธแบบไม่บอกเหตุผลให้ไคลเอนต์ — เหตุผลจริงบันทึกฝั่งเซิร์ฟเวอร์ */
function rejectRegistration_(reason) {
  console.warn('SELF_REGISTRATION_REJECTED: ' + reason);
  return { ok: false, message: REGISTRATION_CONFIG.GENERIC_ERROR };
}

/**
 * สมัครสมาชิกด้วยตนเอง
 * @param {{studentId:string, inviteCode:string}} input — ห้ามมี email/role (ถูกละเลยเสมอ)
 * @return {{ok:boolean, message:string, userId?:string, role?:string}}
 */
function selfRegister_(input) {
  if (FEATURE_FLAGS.SELF_REGISTRATION !== FLAG.ENABLED_CONTROLLED) {
    return rejectRegistration_('feature disabled');
  }
  let email;
  try {
    email = getSessionEmail_(); // จาก session เซิร์ฟเวอร์เท่านั้น
  } catch (e) {
    return rejectRegistration_('no session email');
  }
  if (!checkRateLimit_(email)) return rejectRegistration_('rate limited');

  const studentId = String((input && input.studentId) || '').trim();
  const codeNorm = normalizeInviteCode_(input && input.inviteCode);
  if (!studentId || codeNorm.length !== 32) return rejectRegistration_('malformed input');
  const codeHash = sha256Hex_(codeNorm);

  let result;
  try {
    result = withDocumentLock_(function () {
      // --- ตรวจซ้ำทุกอย่างใต้ lock ---
      const accounts = readTable_('USER_ACCOUNT');
      const ac = accounts.cols;
      if (findAccountByEmail_(accounts, email)) return { reason: 'email already registered' };

      const members = readTable_('MEMBER');
      const mc = members.cols;
      if (!mc.studentId) return { reason: 'MEMBER has no student id column' };
      const matched = members.rows.filter(function (r) {
        return String(r[mc.studentId]).trim() === studentId && !isBlank_(r[mc.id]);
      });
      if (matched.length !== 1) return { reason: 'student id not found or ambiguous' };
      const member = matched[0];
      const memberId = String(member[mc.id]).trim();
      if (member[mc.workStatus] !== STATUS.MEMBER_ACTIVE) return { reason: 'member not active' };

      const role = roleFromPosition_(member[mc.position]);
      if (!role) return { reason: 'position not mapped' };

      if (accounts.rows.some(function (r) { return String(r[ac.member_id]).trim() === memberId; })) {
        return { reason: 'member already linked' };
      }

      const invites = readTable_('INVITE');
      const ic = invites.cols;
      const now = new Date();
      const active = invites.rows.filter(function (r) {
        return String(r[ic.member_id]).trim() === memberId && r[ic.status] === STATUS.INVITE_ACTIVE;
      });
      if (active.length !== 1) return { reason: 'no single active invite' };
      const invite = active[0];
      if (!constantTimeEquals_(String(invite[ic.code_hash]).toLowerCase(), codeHash)) return { reason: 'invite mismatch' };
      if (isInviteExpired_(invite, ic, now)) return { reason: 'invite expired' };

      // --- บันทึกจริง ---
      const userId = nextId_(ENTITIES.USER_ACCOUNT.prefix, accounts.rows.map(function (r) { return r[ac.user_id]; }));
      const acc = {};
      acc[ac.user_id] = userId;
      acc[ac.member_id] = memberId;
      acc[ac.email] = email;
      acc[ac.role] = role;
      acc[ac.account_status] = STATUS.ACCOUNT_ACTIVE;
      acc[ac.last_login] = '';
      acc[ac.created_date] = now;
      appendRecord_(accounts, acc);

      const inviteChange = {};
      inviteChange[ic.status] = STATUS.INVITE_USED; // ใช้ครั้งเดียว
      inviteChange[ic.used_date] = now;
      inviteChange[ic.used_by_user_id] = userId;
      updateRecord_(invites, invite._row, inviteChange);

      writeAudit_({
        userId: userId,
        action: 'SELF_REGISTER',
        tableName: 'USER_ACCOUNT',
        recordId: userId,
        oldValue: '',
        newValue: { user_id: userId, member_id: memberId, email: email, role: role, account_status: STATUS.ACCOUNT_ACTIVE },
        note: 'invite ' + invite[ic.invite_id] + ' → USED',
      });
      return { ok: true, userId: userId, role: role };
    });
  } catch (e) {
    return rejectRegistration_('exception: ' + (e && e.message));
  }

  if (!result.ok) return rejectRegistration_(result.reason);
  return { ok: true, message: 'ลงทะเบียนสำเร็จ', userId: result.userId, role: result.role };
}
