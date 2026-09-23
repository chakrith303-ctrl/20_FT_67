-- Dashboard KPI (วันที่อ้างอิง 2026-09-23)
begin;

create temp table snap as
  select (select count(*) from public.audit_log) as audits,
         (select max(updated_at) from public.task) as task_updated;
grant select on snap to authenticated;

select test.login('president@example.ac.th');
set local role authenticated;
create temp table k as select public.get_dashboard('2026-09-23') as j;

select test.eq((select j -> 'scope' from k), '"PROJECT"'::jsonb, 'scope');
select test.eq((select (j #>> '{tasks,total}')::int from k), 8, 'task total');
select test.eq((select (j #>> '{tasks,in_progress}')::int from k), 2, 'in progress');
select test.eq((select (j #>> '{tasks,done}')::int from k), 3, 'done');
select test.eq((select (j #>> '{tasks,cancelled}')::int from k), 1, 'cancelled');
-- เกินกำหนด: T001 (-2) เท่านั้น (T002 เสร็จ, T003 ยกเลิก ไม่นับ)
select test.eq((select (j #>> '{tasks,overdue}')::int from k), 1, 'overdue');
select test.eq((select j #>> '{tasks,overdue_list,0,id}' from k), 'T001', 'overdue list');
-- ใกล้ครบกำหนด 0–3 วัน: T004 (2), T006 (0) — T008 ไม่มีกำหนด ไม่นับ
select test.eq((select (j #>> '{tasks,due_soon}')::int from k), 2, 'due soon');
-- อัตราสำเร็จ = 3 / (8 − 1)
select test.eq((select (j #>> '{tasks,success_rate}')::numeric from k), 0.4286, 'success rate');

select test.eq((select (j #>> '{documents,pending_approval}')::int from k), 1, 'doc pending approval');
select test.eq((select (j #>> '{documents,pending_review}')::int from k), 1, 'doc pending review');
select test.eq((select jsonb_path_query_array(j, '$.documents.tracking[*].id') from k), '["D001","D002","D003","D004"]'::jsonb, 'doc tracking');
select test.eq((select (j #>> '{letters,awaiting_reply}')::int from k), 1, 'letters awaiting');
select test.eq((select j -> 'risks' from k), '{"total":3,"closed":2,"open":1}'::jsonb, 'risks');
-- หลักฐาน: จับคู่ task_id เท่านั้น → T005 (มี E001 ใน evidence_ids แต่ไม่มีหลักฐานที่ task_id = T005)
select test.eq((select jsonb_path_query_array(j, '$.evidence.done_without_evidence_list[*].id') from k), '["T005"]'::jsonb, 'done without evidence');
select test.eq((select j -> 'registrations' from k), '{"total":3,"checked_in":2}'::jsonb, 'registrations');
select test.eq((select j -> 'budget' from k), '{"initial_budget":3500.00,"actual_cost":3800.00,"remaining":-300.00}'::jsonb, 'budget');
select test.eq((select (j #>> '{team,active}')::int from k), 8, 'team active');
reset role;

-- HEAD ฝ่ายวิชาการ: เฉพาะฝ่ายตน
select test.login('head@example.ac.th');
set local role authenticated;
create temp table kh as select public.get_dashboard('2026-09-23') as j;
select test.eq((select j ->> 'scope' from kh), 'DEPARTMENT:ฝ่ายวิชาการ', 'head scope');
select test.eq((select (j #>> '{tasks,total}')::int from kh), 5, 'head task total');
select test.eq((select j -> 'budget' from kh), '{"initial_budget":1000.00,"actual_cost":800.00,"remaining":200.00}'::jsonb, 'head budget');
select test.eq((select (j #>> '{team,active}')::int from kh), 4, 'head team (M003 M005 M007 M009)');
select test.eq((select (j #>> '{risks,total}')::int from kh), 1, 'head risks');
-- T007 มีหลักฐานที่ฝ่ายสถานที่บันทึก → นับว่ามีหลักฐาน แม้ HEAD มองไม่เห็นแถวหลักฐานนั้น
select test.eq((select (j #>> '{evidence,done_without_evidence}')::int from kh), 0, 'head evidence across depts');
select test.eq((select count(*) from public.evidence where id = 'E002')::int, 0, 'head still cannot read E002');
reset role;

select test.login('secretary@example.ac.th');
set local role authenticated;
select test.eq(public.get_dashboard('2026-09-23') #>> '{evidence,done_without_evidence_list,0,id}', 'T005', 'secretary sees T005 missing');
reset role;

-- MEMBER: ปิด
select test.login('member@example.ac.th');
set local role authenticated;
select test.throws($$select public.get_dashboard()$$, 'member dashboard disabled', '42501');
reset role;
select test.login(null);
set local role authenticated;
select test.throws($$select public.get_dashboard()$$, 'anonymous dashboard', '42501');
reset role;

-- ไม่มีการเขียนใด ๆ จาก dashboard
select test.eq((select count(*) from public.audit_log), (select audits from snap), 'dashboard wrote nothing to audit');
select test.eq((select max(updated_at) from public.task), (select task_updated from snap), 'dashboard wrote nothing to task');
select test.eq((select provolatile from pg_proc where oid = 'public.get_dashboard(date)'::regprocedure), 's'::"char", 'dashboard is STABLE (cannot write)');

rollback;
