/**
 * Config.js — แหล่งความจริงเดียวของโครงสร้างข้อมูล, Feature Flags และค่าคงที่
 *
 * หลักการ: ทุกอย่างที่ไม่ได้ระบุว่าเปิด = ปิด (fail-closed)
 */

/** ค่าสถานะของ Feature Flag */
const FLAG = Object.freeze({
  ENABLED: 'ENABLED',
  ENABLED_READ_ONLY: 'ENABLED_READ_ONLY',
  ENABLED_CONTROLLED: 'ENABLED_CONTROLLED',
  DISABLED_FAIL_CLOSED: 'DISABLED_FAIL_CLOSED',
});

/**
 * 2) Feature Flags — สถานะการเปิดใช้งานจริง
 * การเปลี่ยนค่าในนี้ต้องผ่านการอนุมัติเท่านั้น
 */
const FEATURE_FLAGS = Object.freeze({
  WRITE: Object.freeze({
    TASK: FLAG.ENABLED,
    DOCUMENT: FLAG.ENABLED,
    LETTER: FLAG.DISABLED_FAIL_CLOSED,
    REGISTRATION: FLAG.DISABLED_FAIL_CLOSED,
    BUDGET: FLAG.DISABLED_FAIL_CLOSED,
    RISK: FLAG.DISABLED_FAIL_CLOSED,
    EVIDENCE: FLAG.DISABLED_FAIL_CLOSED,
    EVALUATION_QUESTION: FLAG.DISABLED_FAIL_CLOSED,
    EVALUATION_RESPONSE: FLAG.DISABLED_FAIL_CLOSED,
  }),
  READ: Object.freeze({
    TASK: FLAG.ENABLED_READ_ONLY,
    DOCUMENT: FLAG.ENABLED_READ_ONLY,
    LETTER: FLAG.ENABLED_READ_ONLY,
    REGISTRATION: FLAG.ENABLED_READ_ONLY, // มีตรวจสิทธิ์
    BUDGET: FLAG.ENABLED_READ_ONLY, // จำกัดตามฝ่าย
    RISK: FLAG.ENABLED_READ_ONLY, // จำกัดตามฝ่าย
    EVIDENCE: FLAG.ENABLED_READ_ONLY, // จำกัดตามฝ่าย + แยกส่วนตรวจ
    EVALUATION: FLAG.ENABLED_READ_ONLY, // dual-source ภายใน
  }),
  DASHBOARD: FLAG.ENABLED_READ_ONLY, // ห้ามเขียนกลับลง Sheet เด็ดขาด
  DASHBOARD_BY_ROLE: Object.freeze({
    ADMIN: FLAG.ENABLED_READ_ONLY,
    PRESIDENT: FLAG.ENABLED_READ_ONLY,
    VICE_PRESIDENT: FLAG.ENABLED_READ_ONLY,
    HEAD: FLAG.ENABLED_READ_ONLY,
    SECRETARY: FLAG.ENABLED_READ_ONLY,
    MEMBER: FLAG.DISABLED_FAIL_CLOSED,
  }),
  SELF_REGISTRATION: FLAG.ENABLED_CONTROLLED,
  INVITE_CREATION: FLAG.ENABLED_CONTROLLED,
});

/**
 * 1) โครงสร้างข้อมูล Entity ↔ Sheet ↔ รหัส
 * - sheets: ชื่อชีทที่ยอมรับ (ใช้ชีทแรกที่พบ)
 * - fields: ชื่อหัวคอลัมน์ (string หรือ array ของชื่อที่ยอมรับ)
 * - idField/deptField: คีย์ใน fields
 * - required: field ที่ต้องมีในชีท มิฉะนั้นปฏิเสธการทำงาน (fail-closed)
 */
const ENTITIES = Object.freeze({
  TASK: {
    sheets: ['TASK_MASTER'],
    prefix: 'T',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสงาน',
      dept: 'ฝ่ายที่รับผิดชอบ',
      name: 'ชื่องาน/กิจกรรม',
      ownerMain: 'ผู้รับผิดชอบหลัก',
      ownerCo: 'ผู้รับผิดชอบร่วม',
      status: 'สถานะงาน',
      documentIds: 'รหัสเอกสารที่เกี่ยวข้อง',
      evidenceIds: 'รหัสหลักฐาน',
      remainingDays: 'เหลือเวลา',
      dueDate: ['กำหนดเสร็จ', 'วันครบกำหนด', 'กำหนดส่ง', 'วันที่สิ้นสุด'],
    },
    required: ['id', 'dept', 'status'],
  },
  DOCUMENT: {
    sheets: ['DOCUMENT'],
    prefix: 'D',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสเอกสาร',
      dept: 'ฝ่ายที่รับผิดชอบ',
      taskId: 'รหัสงานที่เกี่ยวข้อง',
      name: ['ชื่อเอกสาร', 'ชื่อเรื่อง'],
      status: ['สถานะเอกสาร', 'สถานะ'],
    },
    required: ['id', 'dept'],
  },
  LETTER: {
    sheets: ['LETTER_TRACKER'],
    prefix: 'L',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสหนังสือ',
      dept: 'ฝ่ายที่เสนอเรื่อง',
      taskId: 'รหัสงานที่เกี่ยวข้อง',
      status: ['สถานะหนังสือ', 'สถานะ'],
    },
    required: ['id', 'dept'],
  },
  REGISTRATION: {
    sheets: ['REGISTRATION'],
    prefix: 'R',
    idField: 'id',
    deptField: null,
    fields: {
      id: 'รหัสผู้ลงทะเบียน',
      status: ['สถานะการลงทะเบียน', 'สถานะ'],
    },
    required: ['id'],
  },
  BUDGET: {
    sheets: ['BUDGET'],
    prefix: 'B',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสรายการ',
      dept: 'ฝ่ายที่ขอใช้',
      initialBudget: 'งบประมาณตั้งต้น',
      actualCost: 'ค่าใช้จ่ายจริง',
    },
    required: ['id', 'dept'],
  },
  RISK: {
    sheets: ['RISK_ISSUE'],
    prefix: 'RI',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสประเด็น',
      dept: 'ฝ่ายที่รับผิดชอบ',
      taskId: 'รหัสงานที่เกี่ยวข้อง',
      status: ['สถานะประเด็น', 'สถานะ'],
    },
    required: ['id', 'dept'],
  },
  EVIDENCE: {
    sheets: ['EVIDENCE', 'หลักฐาน', 'EVIDENCE/หลักฐาน'],
    prefix: 'E',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสหลักฐาน',
      dept: 'ฝ่ายที่รับผิดชอบ',
      taskId: 'รหัสงานที่เกี่ยวข้อง',
    },
    // "แยกส่วนตรวจ": คอลัมน์ส่วนตรวจที่เห็นได้เฉพาะระดับโครงการ
    reviewHeaders: ['ผลการตรวจ', 'ผู้ตรวจ', 'วันที่ตรวจ', 'หมายเหตุการตรวจ', 'ความเห็นผู้ตรวจ'],
    required: ['id', 'dept', 'taskId'],
  },
  MEMBER: {
    sheets: ['MEMBER'],
    prefix: 'M',
    idField: 'id',
    deptField: 'dept',
    fields: {
      id: 'รหัสสมาชิก',
      dept: 'ฝ่ายหลัก',
      position: 'บทบาท/ตำแหน่ง',
      workStatus: 'สถานะการทำงาน',
      studentId: 'รหัสนักศึกษา',
      name: ['ชื่อ-นามสกุล', 'ชื่อ - นามสกุล', 'ชื่อ'],
    },
    required: ['id', 'dept', 'position', 'workStatus'],
  },
  USER_ACCOUNT: {
    sheets: ['USER_ACCOUNT'],
    prefix: 'U',
    idField: 'user_id',
    deptField: null,
    fields: {
      user_id: 'user_id',
      member_id: 'member_id',
      email: 'email',
      role: 'role',
      account_status: 'account_status',
      last_login: 'last_login',
      created_date: 'created_date',
    },
    required: ['user_id', 'member_id', 'email', 'role', 'account_status', 'last_login', 'created_date'],
  },
  EVALUATION_QUESTION: {
    sheets: ['EVALUATION_QUESTION'],
    prefix: 'EVQ',
    idField: 'question_id',
    deptField: null,
    fields: { question_id: 'question_id' },
    required: ['question_id'],
  },
  EVALUATION_RESPONSE: {
    sheets: ['EVALUATION_RESPONSE'],
    prefix: 'EV',
    idField: 'response_id',
    deptField: null,
    fields: {
      response_id: 'response_id',
      evaluation_id: 'evaluation_id',
      registration_id: 'registration_id',
    },
    required: ['response_id', 'evaluation_id', 'registration_id'],
  },
  AUDIT_LOG: {
    sheets: ['AUDIT_LOG'],
    prefix: 'A',
    idField: 'audit_id',
    deptField: null,
    fields: {
      audit_id: 'audit_id',
      timestamp: 'timestamp',
      user_id: 'user_id',
      action: 'action',
      table_name: 'table_name',
      record_id: 'record_id',
      old_value: 'old_value',
      new_value: 'new_value',
      note: 'note',
    },
    required: ['audit_id', 'timestamp', 'user_id', 'action', 'table_name', 'record_id', 'old_value', 'new_value', 'note'],
  },
  /** ชีทเก็บ invite (hash เท่านั้น) — ระบบสร้างเพิ่มสำหรับ Self-Registration */
  INVITE: {
    sheets: ['INVITE'],
    prefix: 'INV',
    idField: 'invite_id',
    deptField: null,
    fields: {
      invite_id: 'invite_id',
      member_id: 'member_id',
      code_hash: 'code_hash',
      status: 'status',
      created_by: 'created_by',
      created_date: 'created_date',
      expires_at: 'expires_at',
      used_date: 'used_date',
      used_by_user_id: 'used_by_user_id',
    },
    required: ['invite_id', 'member_id', 'code_hash', 'status', 'created_by', 'created_date', 'expires_at', 'used_date', 'used_by_user_id'],
  },
});

/** จำนวนหลักขั้นต่ำของเลขรหัส (T001, D001, ...) */
const ID_MIN_DIGITS = 3;

/** ช่วงรหัสสมาชิกที่ยืนยันแล้ว */
const MEMBER_ID_CONFIRMED_RANGE = Object.freeze({ min: 1, max: 87 });

/** สถานะที่ใช้ใน KPI — ต้องตรงตัวอักษรเป๊ะ */
const STATUS = Object.freeze({
  TASK_IN_PROGRESS: 'กำลังดำเนินการ',
  TASK_DONE: 'เสร็จสิ้น',
  TASK_CANCELLED: 'ยกเลิก',
  DOC_PENDING_APPROVAL: 'รออนุมัติ',
  DOC_PENDING_REVIEW: 'รอตรวจ',
  DOC_DRAFT: 'ร่าง',
  DOC_NEEDS_REVISION: 'ต้องแก้ไข',
  LETTER_AWAITING_REPLY: 'ส่งแล้ว-รอตอบรับ',
  RISK_RESOLVED: 'แก้ไขเสร็จสิ้น',
  RISK_CLOSED: 'ปิดประเด็น',
  REG_CHECKED_IN: 'เช็คอินแล้ว',
  MEMBER_ACTIVE: 'ปฏิบัติหน้าที่',
  ACCOUNT_ACTIVE: 'ACTIVE',
  INVITE_ACTIVE: 'ACTIVE',
  INVITE_USED: 'USED',
  INVITE_REVOKED: 'REVOKED',
});

const DUE_SOON_DAYS = 3;

/** บทบาท */
const ROLE = Object.freeze({
  ADMIN: 'ADMIN',
  PRESIDENT: 'PRESIDENT',
  VICE_PRESIDENT: 'VICE_PRESIDENT',
  HEAD: 'HEAD',
  SECRETARY: 'SECRETARY',
  MEMBER: 'MEMBER',
});

/** ตำแหน่งใน MEMBER → บทบาท (ตรงตัวเป๊ะ) — ADMIN กำหนดจากตำแหน่งไม่ได้ */
const POSITION_TO_ROLE = Object.freeze({
  'ประธานโครงการ': ROLE.PRESIDENT,
  'รองประธานโครงการ': ROLE.VICE_PRESIDENT,
  'หัวหน้า': ROLE.HEAD,
  'เลขา': ROLE.SECRETARY,
  'สมาชิก': ROLE.MEMBER,
});

/** ขอบเขตสิทธิ์: PROJECT = ทั้งโครงการ, DEPARTMENT = เฉพาะฝ่าย, SELF = เฉพาะตัว */
const SCOPE = Object.freeze({ PROJECT: 'PROJECT', DEPARTMENT: 'DEPARTMENT', SELF: 'SELF' });

const ROLE_SCOPE = Object.freeze({
  ADMIN: SCOPE.PROJECT,
  PRESIDENT: SCOPE.PROJECT,
  VICE_PRESIDENT: SCOPE.PROJECT, // สิทธิ์เท่า PRESIDENT
  HEAD: SCOPE.DEPARTMENT,
  SECRETARY: SCOPE.DEPARTMENT, // สิทธิ์เท่า HEAD
  MEMBER: SCOPE.SELF,
});

/** Self-registration */
const REGISTRATION_CONFIG = Object.freeze({
  LOCK_TIMEOUT_MS: 10000,
  INVITE_TTL_DAYS: 7,
  RATE_LIMIT_MAX_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW_SEC: 900,
  GENERIC_ERROR: 'ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูลอีกครั้งหรือติดต่อผู้ดูแลระบบ',
});
