/**
 * Dashboard.js — KPI แบบ READ-ONLY
 *
 * ไฟล์นี้ห้ามเรียกฟังก์ชันเขียนใด ๆ (appendRecord_/updateRecord_/writeAudit_)
 * computeDashboard_ เป็น pure function: รับข้อมูลที่ผ่านการกรองสิทธิ์แล้ว คืน KPI
 */

function assertDashboardAllowed_(user) {
  if (FEATURE_FLAGS.DASHBOARD !== FLAG.ENABLED_READ_ONLY ||
      FEATURE_FLAGS.DASHBOARD_BY_ROLE[user.role] !== FLAG.ENABLED_READ_ONLY) {
    throw new AppError('FEATURE_DISABLED', 'ยังไม่เปิดสิทธิ์ดู Dashboard สำหรับบทบาทนี้');
  }
}

/** จำนวนวันที่เหลือของงาน: ใช้คอลัมน์ "เหลือเวลา" ก่อน, ถ้าว่างคำนวณจากวันครบกำหนด */
function taskRemainingDays_(task, today) {
  const rem = task.remainingDays;
  if (typeof rem === 'number' && isFinite(rem)) return rem;
  if (!isBlank_(rem) && isFinite(Number(rem))) return Number(rem);
  const due = toDateOnly_(task.dueDate);
  if (!due) return null;
  return daysBetween_(today, due);
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {Object} data ข้อมูลเชิงตรรกะ (field key ตาม ENTITIES.*.fields)
 *   tasks, documents, letters, risks, registrations, budgets, members: Object[]
 *   evidenceTaskIds: string[] — รหัสงานจาก EVIDENCE.รหัสงานที่เกี่ยวข้อง
 * @param {Date} today
 */
function computeDashboard_(data, today) {
  const t0 = toDateOnly_(today || new Date());

  // --- งาน ---
  const tasks = (data.tasks || []).filter(function (t) { return !isBlank_(t.id); });
  const isClosedTask = function (s) { return s === STATUS.TASK_DONE || s === STATUS.TASK_CANCELLED; };
  let inProgress = 0, done = 0, cancelled = 0, overdue = 0, dueSoon = 0;
  const overdueList = [], dueSoonList = [];
  tasks.forEach(function (t) {
    if (t.status === STATUS.TASK_IN_PROGRESS) inProgress++;
    if (t.status === STATUS.TASK_DONE) done++;
    if (t.status === STATUS.TASK_CANCELLED) cancelled++;
    if (isClosedTask(t.status)) return;
    const rem = taskRemainingDays_(t, t0);
    if (rem === null) return;
    const item = { id: String(t.id).trim(), name: t.name || '', dept: t.dept || '', status: t.status || '', remainingDays: rem };
    if (rem < 0) { overdue++; overdueList.push(item); }
    else if (rem <= DUE_SOON_DAYS) { dueSoon++; dueSoonList.push(item); }
  });
  const denom = tasks.length - cancelled;

  // --- เอกสาร ---
  const docs = (data.documents || []).filter(function (d) { return !isBlank_(d.id); });
  const trackingStatuses = [STATUS.DOC_DRAFT, STATUS.DOC_NEEDS_REVISION, STATUS.DOC_PENDING_REVIEW, STATUS.DOC_PENDING_APPROVAL];
  const docPendingApproval = docs.filter(function (d) { return d.status === STATUS.DOC_PENDING_APPROVAL; }).length;
  const docPendingReview = docs.filter(function (d) { return d.status === STATUS.DOC_PENDING_REVIEW; }).length;
  const docTracking = docs
    .filter(function (d) { return trackingStatuses.indexOf(d.status) !== -1; })
    .map(function (d) { return { id: String(d.id).trim(), name: d.name || '', dept: d.dept || '', status: d.status }; });

  // --- หนังสือ ---
  const letters = (data.letters || []).filter(function (l) { return !isBlank_(l.id); });
  const lettersAwaiting = letters.filter(function (l) { return l.status === STATUS.LETTER_AWAITING_REPLY; }).length;

  // --- ความเสี่ยง ---
  const risks = (data.risks || []).filter(function (r) { return !isBlank_(r.id); });
  const risksClosed = risks.filter(function (r) {
    return r.status === STATUS.RISK_RESOLVED || r.status === STATUS.RISK_CLOSED;
  }).length;

  // --- หลักฐาน: จับคู่ตรง taskId เท่านั้น (ไม่ back-write ลง TASK_MASTER) ---
  const evidenceSet = {};
  (data.evidenceTaskIds || []).forEach(function (id) {
    if (!isBlank_(id)) evidenceSet[String(id).trim()] = true;
  });
  const doneWithoutEvidence = tasks
    .filter(function (t) { return t.status === STATUS.TASK_DONE && !evidenceSet[String(t.id).trim()]; })
    .map(function (t) { return { id: String(t.id).trim(), name: t.name || '', dept: t.dept || '' }; });

  // --- การลงทะเบียน ---
  const regs = (data.registrations || []).filter(function (r) { return !isBlank_(r.id); });
  const checkedIn = regs.filter(function (r) { return r.status === STATUS.REG_CHECKED_IN; }).length;

  // --- งบประมาณ ---
  const budgets = (data.budgets || []).filter(function (b) { return !isBlank_(b.id); });
  const initialBudget = budgets.reduce(function (s, b) { return s + toNumber_(b.initialBudget); }, 0);
  const actualCost = budgets.reduce(function (s, b) { return s + toNumber_(b.actualCost); }, 0);

  // --- ทีม ---
  const activeMembers = (data.members || []).filter(function (m) {
    return !isBlank_(m.id) && m.workStatus === STATUS.MEMBER_ACTIVE;
  }).length;

  return {
    tasks: {
      total: tasks.length,
      inProgress: inProgress,
      done: done,
      cancelled: cancelled,
      overdue: overdue,
      dueSoon: dueSoon,
      successRate: denom > 0 ? round2_(done / denom) : null,
      overdueList: overdueList,
      dueSoonList: dueSoonList,
    },
    documents: {
      total: docs.length,
      pendingApproval: docPendingApproval,
      pendingReview: docPendingReview,
      pendingTotal: docPendingApproval + docPendingReview,
      tracking: docTracking,
    },
    letters: { total: letters.length, awaitingReply: lettersAwaiting },
    risks: { total: risks.length, closed: risksClosed, open: risks.length - risksClosed },
    evidence: { doneWithoutEvidence: doneWithoutEvidence.length, doneWithoutEvidenceList: doneWithoutEvidence },
    registrations: { total: regs.length, checkedIn: checkedIn },
    budget: { initialBudget: initialBudget, actualCost: actualCost, remaining: initialBudget - actualCost },
    team: { active: activeMembers },
  };
}

/** แปลงแถวชีทเป็นอ็อบเจกต์เชิงตรรกะตาม field key */
function toLogical_(table, rows) {
  const keys = Object.keys(ENTITIES[table.entityKey].fields);
  return rows.map(function (r) {
    const o = {};
    keys.forEach(function (k) { o[k] = fieldValue_(table, r, k); });
    return o;
  });
}

/** อ่านโมดูลแบบกรองสิทธิ์ (สำหรับ dashboard) คืน [] ถ้าโมดูลไม่เปิดอ่าน/ไม่มีสิทธิ์ */
function dashboardSource_(user, entityKey, readModuleKey) {
  try {
    assertCanRead_(user, readModuleKey || entityKey);
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
  const table = readTable_(entityKey);
  return toLogical_(table, scopeRows_(user, table));
}

/** สมาชิกสำหรับ KPI ทีม: ระดับโครงการเห็นทั้งหมด, ระดับฝ่ายเห็นเฉพาะฝ่ายตน */
function dashboardMembers_(user) {
  const table = readTable_('MEMBER');
  return toLogical_(table, scopeRows_(user, table));
}

/**
 * รวบรวมข้อมูลตามสิทธิ์และคำนวณ KPI — อ่านอย่างเดียว
 * ADMIN/PRESIDENT/VICE_PRESIDENT: ทั้งโครงการ, HEAD/SECRETARY: เฉพาะฝ่ายตน, MEMBER: ปิด
 */
function buildDashboard_(user, today) {
  assertDashboardAllowed_(user);

  const tasks = dashboardSource_(user, 'TASK');
  // หลักฐาน: ใช้เฉพาะ "รหัสงานที่เกี่ยวข้อง" เพื่อตรวจการมีอยู่ของหลักฐาน (ไม่เปิดเผยรายละเอียดหลักฐานฝ่ายอื่น)
  let evidenceTaskIds = null;
  if (FEATURE_FLAGS.READ.EVIDENCE === FLAG.ENABLED_READ_ONLY) {
    const ev = readTable_('EVIDENCE');
    evidenceTaskIds = ev.rows.map(function (r) { return fieldValue_(ev, r, 'taskId'); });
  }

  const data = {
    tasks: tasks || [],
    documents: dashboardSource_(user, 'DOCUMENT') || [],
    letters: dashboardSource_(user, 'LETTER') || [],
    risks: dashboardSource_(user, 'RISK') || [],
    registrations: dashboardSource_(user, 'REGISTRATION') || [],
    budgets: dashboardSource_(user, 'BUDGET') || [],
    members: dashboardMembers_(user),
    evidenceTaskIds: evidenceTaskIds || [],
  };
  const kpi = computeDashboard_(data, today || new Date());
  kpi.scope = user.scope === SCOPE.PROJECT ? 'PROJECT' : 'DEPARTMENT:' + user.department;
  kpi.generatedAt = new Date().toISOString();
  return kpi;
}
