-- นำเข้าสมาชิก (admin_import_members)
begin;

create temp table res (step text primary key, j jsonb);
grant all on res to app_user;

-- ไม่ใช่ ADMIN → ไม่ได้
select test.login('president@example.ac.th');
set local role app_user;
select test.throws($$select public.admin_import_members('[{"id":"M100"}]'::jsonb)$$, 'president cannot import', '42501');
reset role;

select test.login('vp@example.ac.th'); -- บัญชี ADMIN (member M002)
set local role app_user;

-- ตรวจสอบ (dry run): ฝ่ายใหม่ยังไม่มี → error, ไม่บันทึก
insert into res values ('dry_no_dept', public.admin_import_members($$[
  {"id":"M100","student_id":"079","full_name":"นางสาวทดสอบ หนึ่ง","nickname":"หนึ่ง","department":"ฝ่ายที่ยังไม่มีในระบบ","position":"ประธานโครงการ","work_status":"ปฏิบัติหน้าที่"},
  {"id":"M101","student_id":"005","full_name":"นายทดสอบ สอง","nickname":"","department":"ฝ่ายวิชาการ","position":"หัวหน้าฝ่าย","work_status":"ปฏิบัติหน้าที่"}
]$$::jsonb, false, true));
select test.eq((select jsonb_array_length(j -> 'errors') from res where step = 'dry_no_dept'), 1, 'missing department is an error');
select test.eq((select jsonb_array_length(j -> 'warnings') from res where step = 'dry_no_dept'), 1, 'unmapped position is a warning');
select test.eq((select (j ->> 'saved')::boolean from res where step = 'dry_no_dept'), false, 'not saved');

-- ข้อผิดพลาดแม้แถวเดียว = ไม่บันทึกอะไรเลย แม้ไม่ใช่ dry run
insert into res values ('bad_save', public.admin_import_members($$[
  {"id":"M100","student_id":"079","full_name":"ก","department":"ฝ่ายวิชาการ","position":"สมาชิก","work_status":"ปฏิบัติหน้าที่"},
  {"id":"M101","student_id":"079","full_name":"ข","department":"ฝ่ายวิชาการ","position":"สมาชิก","work_status":"ลาพัก"},
  {"id":"X1","full_name":"ค","department":"ฝ่ายวิชาการ","position":"สมาชิก","work_status":"ปฏิบัติหน้าที่"}
]$$::jsonb, false, false));
select test.eq((select jsonb_array_length(j -> 'errors') from res where step = 'bad_save'), 4, 'dup student id x2, bad status, bad id');
select test.eq((select count(*) from public.member where id in ('M100', 'M101'))::int, 0, 'nothing saved on error');

-- รหัสนักศึกษาของคนอื่นในระบบ → error
insert into res values ('sid_taken', public.admin_import_members($$[
  {"id":"M100","student_id":"6500003","full_name":"ก","department":"ฝ่ายวิชาการ","position":"สมาชิก","work_status":"ปฏิบัติหน้าที่"}
]$$::jsonb, false, true));
select test.eq((select j #>> '{errors,0,message}' from res where step = 'sid_taken'), 'รหัสนักศึกษา 6500003 เป็นของสมาชิกคนอื่นในระบบแล้ว', 'student id taken');

-- ห้ามล็อกตัวเองออก (M002 = บัญชีที่กำลังนำเข้า)
insert into res values ('self_lock', public.admin_import_members($$[
  {"id":"M002","student_id":"6500002","full_name":"รองประธาน","department":"ฝ่ายบริหาร","position":"รองประธานโครงการ","work_status":"พ้นสภาพ/ลาออก"}
]$$::jsonb, false, true));
select test.ok((select j #>> '{errors,0,message}' from res where step = 'self_lock') like 'แถวนี้เป็นของบัญชีคุณเอง%', 'self lockout blocked');

-- บันทึกจริง: สร้างฝ่ายใหม่ + เพิ่ม + อัปเดต (M001 ผูกบัญชีอยู่ → คำเตือนชื่อเปลี่ยน)
insert into res values ('save', public.admin_import_members($$[
  {"id":"M001","student_id":"079","full_name":"นางสาวคนใหม่ ในชีท","nickname":"ปริม","department":"ฝ่ายอำนวยการ/ประธานโครงการ","position":"ประธานโครงการ","work_status":"ปฏิบัติหน้าที่"},
  {"id":"M100","student_id":"6500001","full_name":"นายย้าย รหัส","nickname":"","department":"กลุ่มพิธีการและงานลงทะเบียน","position":"สมาชิก","work_status":"ปฏิบัติหน้าที่"},
  {"id":"M003","student_id":"6500003","full_name":"หัวหน้าวิชาการ","nickname":null,"department":"ฝ่ายวิชาการ","position":"หัวหน้า","work_status":"ปฏิบัติหน้าที่"}
]$$::jsonb, true, false));
select test.eq((select (j ->> 'saved')::boolean from res where step = 'save'), true, 'saved');
-- "ฝ่ายอำนวยการ/ประธานโครงการ" เป็นหนึ่งใน 7 ฝ่ายที่ระบบสร้างไว้แล้ว (migration 007) จึงไม่ใช่ฝ่ายใหม่
select test.eq((select j -> 'new_departments' from res where step = 'save'),
  '["กลุ่มพิธีการและงานลงทะเบียน"]'::jsonb, 'new departments');
select test.eq((select row((j ->> 'inserted')::int, (j ->> 'updated')::int, (j ->> 'unchanged')::int)::text from res where step = 'save'),
  row(1, 1, 1)::text, 'counts');
select test.ok((select j::text from res where step = 'save') like '%ผูกกับบัญชี president@example.ac.th%', 'warns when linked account name changes');
reset role;

-- รหัสนักศึกษาย้ายจาก M001 (เดิม 6500001) ไป M100 ได้ในการนำเข้าครั้งเดียว
select test.eq((select student_id from public.member where id = 'M100'), '6500001', 'student id moved');
select test.eq((select student_id from public.member where id = 'M001'), '079', 'student id replaced');
select test.eq((select nickname from public.member where id = 'M001'), 'ปริม', 'nickname stored');
select test.eq((select count(*) from public.audit_log where action = 'MEMBER_IMPORT')::int, 1, 'import audited');
select test.ok((select count(*) from public.audit_log where table_name = 'member' and record_id = 'M100') >= 1, 'row changes audited');
select test.eq(private.next_id('M'), 'M101', 'member sequence synced');

rollback;
