-- AUDIT_LOG: อัตโนมัติ, เก็บเฉพาะค่าที่เปลี่ยน, append-only
begin;

create temp table before_n as select count(*) n from public.audit_log;

select test.login('head@example.ac.th');
set local role app_user;
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
set local role app_user;
select public.session_login();
reset role;
select test.ok((select last_login from public.user_account where user_id = 'U002') is not null, 'last_login set');
select test.eq((select count(*) from public.audit_log), (select n from n2), 'last_login not audited');

-- ผู้ดูแลคนแรก: สร้างด้วยอีเมล แล้วผูกกับ Google เมื่อ login ครั้งแรก
select test.ok(private.bootstrap_admin('boss@example.ac.th', 'M008') ~ '^U[0-9]{3,}$', 'bootstrap admin');
select test.login('boss@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), null, 'not linked before session_login');
select public.session_login();
select test.eq(private.my_role(), 'ADMIN'::public.app_role, 'linked after first login');
reset role;
select test.eq((select google_sub from public.user_account where email = 'boss@example.ac.th'), 'sub:boss@example.ac.th', 'google_sub linked');
-- อีกบัญชี Google ที่อีเมลตรงกันจะไม่ถูกผูกซ้ำ (ผูกแล้วครั้งเดียว)
select set_config('app.sub', 'sub:someone-else', true);
select public.session_login();
select test.eq((select google_sub from public.user_account where email = 'boss@example.ac.th'), 'sub:boss@example.ac.th', 'link only once');
-- bootstrap_admin เรียกจากเว็บไม่ได้
select test.ok(not has_function_privilege('app_user', 'private.bootstrap_admin(text, text)', 'execute'), 'bootstrap not callable by app');

rollback;
