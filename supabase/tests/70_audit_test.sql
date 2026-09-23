-- AUDIT_LOG: อัตโนมัติ, เก็บเฉพาะค่าที่เปลี่ยน, append-only
begin;

create temp table before_n as select count(*) n from public.audit_log;

select test.login('head@example.ac.th');
set local role authenticated;
update public.task set status = 'เสร็จสิ้น', name = 'งาน 1' where id = 'T001';
reset role;

select test.eq((select count(*) from public.audit_log)::bigint, (select n + 1 from before_n), 'one audit row');
select test.eq(
  (select row(user_id, action, table_name, record_id, old_value, new_value)::text
     from public.audit_log order by "timestamp" desc, audit_id desc limit 1),
  row('U002', 'UPDATE', 'task', 'T001', '{"status": "กำลังดำเนินการ"}'::jsonb, '{"status": "เสร็จสิ้น"}'::jsonb)::text,
  'only changed fields logged');

-- แก้ไข/ลบ audit ไม่ได้ แม้เป็นเจ้าของฐานข้อมูล
select test.throws($$update public.audit_log set note = 'x'$$, 'audit immutable', 'P0001');
select test.throws($$delete from public.audit_log$$, 'audit undeletable', 'P0001');

-- เปลี่ยน feature flag ถูกบันทึก
update public.feature_flag set state = 'ENABLED' where key = 'WRITE:BUDGET';
select test.eq((select count(*) from public.audit_log where table_name = 'feature_flag' and record_id = 'WRITE:BUDGET')::int, 1, 'flag change audited');

-- last_login อย่างเดียวไม่สร้าง audit
create temp table n2 as select count(*) n from public.audit_log;
select test.login('head@example.ac.th');
set local role authenticated;
select public.touch_login();
reset role;
select test.ok((select last_login from public.user_account where user_id = 'U002') is not null, 'last_login set');
select test.eq((select count(*) from public.audit_log), (select n from n2), 'last_login not audited');

rollback;
