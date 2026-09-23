-- WRITE: เฉพาะ TASK / DOCUMENT, ตามฝ่าย, ห้ามกำหนดรหัสเอง
begin;

select test.login('president@example.ac.th');
set local role authenticated;

-- โมดูลที่ DISABLED_FAIL_CLOSED เขียนไม่ได้เลย
select test.throws($$insert into public.letter (department, subject) values ('ฝ่ายวิชาการ', 'x')$$, 'letter write blocked', '42501');
select test.throws($$insert into public.budget (department) values ('ฝ่ายวิชาการ')$$, 'budget write blocked', '42501');
select test.throws($$insert into public.risk_issue (department) values ('ฝ่ายวิชาการ')$$, 'risk write blocked', '42501');
select test.throws($$insert into public.evidence (department, task_id) values ('ฝ่ายวิชาการ', 'T001')$$, 'evidence write blocked', '42501');
select test.throws($$insert into public.registration (full_name) values ('x')$$, 'registration write blocked', '42501');
select test.throws($$insert into public.evaluation_question (question) values ('x')$$, 'evq write blocked', '42501');
select test.throws($$insert into public.evaluation_response (evaluation_id, registration_id) values ('x', 'R001')$$, 'ev write blocked', '42501');
select test.throws($$update public.budget set actual_cost = 0$$, 'budget update blocked', '42501');
select test.throws($$insert into public.user_account (member_id, email, role) values ('M008', 'x@example.ac.th', 'ADMIN')$$, 'user_account write blocked', '42501');
select test.throws($$update public.user_account set role = 'ADMIN'$$, 'role change blocked', '42501');
select test.throws($$update public.feature_flag set state = 'ENABLED'$$, 'flags not writable via API', '42501');
select test.throws($$delete from public.task where id = 'T001'$$, 'delete blocked', '42501');
select test.throws($$insert into public.audit_log (user_id, action, table_name) values ('x', 'x', 'x')$$, 'audit not writable', '42501');

-- ห้ามกำหนดรหัส / เวลาระบบเอง
select test.throws($$insert into public.task (id, department) values ('T999', 'ฝ่ายวิชาการ')$$, 'cannot set id', '42501');
select test.throws($$update public.task set id = 'T999' where id = 'T001'$$, 'cannot change id', '42501');

-- สร้างงานได้ รหัสออกให้อัตโนมัติ
do $$
declare v text;
begin
  insert into public.task (department, name, status, related_document_ids)
  values ('ฝ่ายสถานที่', 'งานใหม่', 'กำลังดำเนินการ', '{D001,D003}')
  returning id into v;
  perform test.ok(v ~ '^T[0-9]{3,}$' and substr(v, 2)::int > 8, 'auto task id ' || v);
end $$;
do $$
declare v text;
begin
  insert into public.document (department, task_id, name) values ('ฝ่ายวิชาการ', 'T001', 'เอกสารใหม่') returning id into v;
  perform test.ok(v ~ '^D[0-9]{3,}$', 'auto document id');
end $$;
reset role;

-- HEAD: เฉพาะฝ่ายตน
select test.login('head@example.ac.th');
set local role authenticated;
select test.throws($$insert into public.task (department, name) values ('ฝ่ายสถานที่', 'x')$$, 'head other dept insert', '42501');
select test.eq(test.affected($$update public.task set status = 'เสร็จสิ้น' where id = 'T004'$$), 0, 'head cannot update other dept');
select test.throws($$update public.task set department = 'ฝ่ายสถานที่' where id = 'T001'$$, 'head cannot move task out', '42501');
select test.eq(test.affected($$update public.task set status = 'เสร็จสิ้น' where id = 'T001'$$), 1, 'head updates own dept');
select test.eq(test.affected($$insert into public.task (department, name) values ('ฝ่ายวิชาการ', 'ok')$$), 1, 'head inserts own dept');
reset role;
select test.eq((select status from public.task where id = 'T004'), 'กำลังดำเนินการ', 'other dept untouched');

-- MEMBER: เขียนไม่ได้
select test.login('member@example.ac.th');
set local role authenticated;
select test.throws($$insert into public.task (department, name) values ('ฝ่ายวิชาการ', 'x')$$, 'member insert', '42501');
select test.eq(test.affected($$update public.task set status = 'ยกเลิก' where id = 'T002'$$), 0, 'member update');
reset role;

-- ปิด flag WRITE:TASK → เขียนไม่ได้ทันที
update public.feature_flag set state = 'DISABLED_FAIL_CLOSED' where key = 'WRITE:TASK';
select test.login('president@example.ac.th');
set local role authenticated;
select test.throws($$insert into public.task (department) values ('ฝ่ายวิชาการ')$$, 'write flag off', '42501');
select test.eq(test.affected($$update public.task set name = 'x' where id = 'T001'$$), 0, 'update with flag off');
reset role;

rollback;
