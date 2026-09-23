/**
 * Auth.js — ตัวตนและสิทธิ์
 *
 * - อีเมลมาจาก Google session ฝั่งเซิร์ฟเวอร์เท่านั้น (ไม่รับจากไคลเอนต์)
 * - บทบาทคำนวณจากตำแหน่งใน MEMBER ทุกครั้ง (ยกเว้น ADMIN ที่กำหนดใน USER_ACCOUNT โดยผู้ดูแล)
 */

/** อีเมลจาก session เซิร์ฟเวอร์ — ไม่มีพารามิเตอร์ใดรับจากไคลเอนต์ */
function getSessionEmail_() {
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!email) throw new AppError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบด้วยบัญชี Google ขององค์กร');
  return email;
}

/** ตำแหน่ง → บทบาท (ตรงตัวเป๊ะ) หรือ null */
function roleFromPosition_(position) {
  if (typeof position !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(POSITION_TO_ROLE, position) ? POSITION_TO_ROLE[position] : null;
}

function findAccountByEmail_(accounts, email) {
  const c = accounts.cols;
  return accounts.rows.filter(function (r) { return normalizeEmail_(r[c.email]) === email; })[0] || null;
}

/**
 * บริบทผู้ใช้ปัจจุบัน หรือโยน AppError (fail-closed)
 * @return {{userId:string, memberId:string, email:string, role:string, scope:string,
 *           department:string, memberName:string}}
 */
function getCurrentUser_() {
  const email = getSessionEmail_();
  const accounts = readTable_('USER_ACCOUNT');
  const acc = findAccountByEmail_(accounts, email);
  if (!acc) throw new AppError('NO_ACCOUNT', 'ยังไม่มีบัญชีผู้ใช้ กรุณาสมัครสมาชิกด้วย invite code');
  const ac = accounts.cols;
  if (String(acc[ac.account_status]).trim() !== STATUS.ACCOUNT_ACTIVE) {
    throw new AppError('FORBIDDEN', 'บัญชีนี้ถูกระงับการใช้งาน');
  }

  const members = readTable_('MEMBER');
  const memberId = String(acc[ac.member_id]).trim();
  const member = findRowById_(members, memberId);
  if (!member) throw new AppError('FORBIDDEN', 'ไม่พบข้อมูลสมาชิกที่ผูกกับบัญชี');
  const mc = members.cols;
  if (member[mc.workStatus] !== STATUS.MEMBER_ACTIVE) {
    throw new AppError('FORBIDDEN', 'สมาชิกไม่อยู่ในสถานะปฏิบัติหน้าที่');
  }

  let role;
  if (String(acc[ac.role]).trim() === ROLE.ADMIN) {
    role = ROLE.ADMIN;
  } else {
    role = roleFromPosition_(member[mc.position]);
    if (!role) throw new AppError('FORBIDDEN', 'ตำแหน่งในทะเบียนสมาชิกไม่ตรงกับบทบาทที่รองรับ');
  }

  return {
    userId: String(acc[ac.user_id]).trim(),
    memberId: memberId,
    email: email,
    role: role,
    scope: ROLE_SCOPE[role],
    department: String(member[mc.dept] || '').trim(),
    memberName: mc.name ? String(member[mc.name] || '').trim() : '',
    _accountRow: acc._row,
    _accountTable: accounts,
  };
}

function isProjectScope_(user) {
  return user.scope === SCOPE.PROJECT;
}

function isDepartmentScope_(user) {
  return user.scope === SCOPE.DEPARTMENT;
}

function sameDepartment_(user, dept) {
  return !isBlank_(user.department) && String(dept || '').trim() === user.department;
}

function requireProjectScope_(user) {
  if (!isProjectScope_(user)) throw new AppError('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้');
}
