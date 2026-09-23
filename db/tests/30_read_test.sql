-- READ facade ผ่าน RLS
begin;

-- PRESIDENT: ทั้งโครงการ
select test.login('president@example.ac.th');
set local role app_user;
select test.eq((select count(*) from public.task)::int, 8, 'president tasks');
select test.eq((select count(*) from public.budget)::int, 2, 'president budget');
select test.eq((select count(*) from public.evidence_review)::int, 1, 'president sees review part');
select test.eq((select count(*) from public.evaluation_question)::int, 1, 'president eval q');
select test.eq((select count(*) from public.evaluation_response)::int, 1, 'president eval r');
select test.eq((select count(*) from public.user_account)::int, 5, 'president sees accounts');
select test.eq((select count(*) from public.invite)::int, 0, 'president can list invites');
select test.throws($$select code_hash from public.invite$$, 'code_hash never readable', '42501');
select test.throws($$select * from public.app_setting$$, 'app_setting not readable', '42501');
select test.throws($$select * from public.registration_attempt$$, 'attempts not readable', '42501');
reset role;

-- HEAD ฝ่ายวิชาการ
select test.login('head@example.ac.th');
set local role app_user;
select test.eq((select array_agg(id order by id) from public.task), '{T001,T002,T006,T007,T008}'::text[], 'head tasks');
select test.eq((select array_agg(id order by id) from public.document), '{D001,D002}'::text[], 'head documents');
select test.eq((select array_agg(id order by id) from public.letter), '{L001}'::text[], 'head letters');
select test.eq((select array_agg(id order by id) from public.budget), '{B001}'::text[], 'head budget');
select test.eq((select array_agg(id order by id) from public.risk_issue), '{RI001}'::text[], 'head risk');
select test.eq((select array_agg(id order by id) from public.evidence), '{E001}'::text[], 'head evidence (own dept)');
select test.eq((select count(*) from public.evidence_review)::int, 0, 'head cannot see review part');
select test.eq((select count(*) from public.registration)::int, 3, 'head reads registration');
select test.eq((select count(*) from public.evaluation_question)::int, 0, 'head no evaluation');
select test.eq((select array_agg(id order by id) from public.member), '{M003,M005,M006,M007,M009}'::text[], 'head members');
select test.eq((select array_agg(user_id) from public.user_account), '{U002}'::text[], 'head sees own account only');
select test.eq((select count(*) from public.audit_log)::int, 0, 'head no audit');
reset role;

-- MEMBER: เฉพาะงานที่ตนรับผิดชอบหลัก/ร่วม
select test.login('member@example.ac.th');
set local role app_user;
select test.eq((select array_agg(id order by id) from public.task), '{T002,T006}'::text[], 'member own tasks');
select test.eq((select count(*) from public.document)::int, 0, 'member no documents');
select test.eq((select count(*) from public.budget)::int, 0, 'member no budget');
select test.eq((select count(*) from public.registration)::int, 0, 'member no registration');
select test.eq((select array_agg(id) from public.member), '{M005}'::text[], 'member sees self');
reset role;

-- ปิด flag อ่าน → เห็น 0 แถว (fail-closed)
update public.feature_flag set state = 'DISABLED_FAIL_CLOSED' where key = 'READ:BUDGET';
select test.login('president@example.ac.th');
set local role app_user;
select test.eq((select count(*) from public.budget)::int, 0, 'read flag off hides rows');
reset role;
delete from public.feature_flag where key = 'READ:LETTER';
select test.login('president@example.ac.th');
set local role app_user;
select test.eq((select count(*) from public.letter)::int, 0, 'missing flag = disabled');
reset role;

rollback;
