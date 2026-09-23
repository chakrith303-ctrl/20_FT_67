/**
 * Audit.js — บันทึก AUDIT_LOG (เรียกใต้ lock เดียวกับการเขียนข้อมูล)
 */

function stringifyAuditValue_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * @param {{userId:string, action:string, tableName:string, recordId:string,
 *          oldValue?:*, newValue?:*, note?:string}} entry
 * @return {string} audit_id
 */
function writeAudit_(entry) {
  const table = readTable_('AUDIT_LOG');
  const c = table.cols;
  const ids = table.rows.map(function (r) { return r[c.audit_id]; });
  const auditId = nextId_(ENTITIES.AUDIT_LOG.prefix, ids);
  const rec = {};
  rec[c.audit_id] = auditId;
  rec[c.timestamp] = new Date();
  rec[c.user_id] = entry.userId || '';
  rec[c.action] = entry.action;
  rec[c.table_name] = entry.tableName;
  rec[c.record_id] = entry.recordId || '';
  rec[c.old_value] = stringifyAuditValue_(entry.oldValue);
  rec[c.new_value] = stringifyAuditValue_(entry.newValue);
  rec[c.note] = entry.note || '';
  appendRecord_(table, rec);
  return auditId;
}
