-- ADMIN ที่ไม่ผูกกับรหัสสมาชิก
begin;

select test.ok(private.bootstrap_admin('solo-admin@example.ac.th') ~ '^U[0-9]{3,}$', 'bootstrap admin without member');
select test.eq((select member_id from public.user_account where email = 'solo-admin@example.ac.th'), null, 'no member id');

-- บทบาทอื่นต้องมีรหัสสมาชิกเสมอ
select test.throws($$insert into public.user_account (email, role) values ('x@example.ac.th', 'MEMBER')$$,
  'non-admin requires member', '23514');

select test.login('solo-admin@example.ac.th');
set local role app_user;
select public.session_login();
select test.eq(private.my_role(), 'ADMIN'::public.app_role, 'standalone admin role');
select test.eq(private.my_scope(), 'PROJECT', 'standalone admin scope');
select test.eq(public.get_my_profile() ->> 'department', null, 'no department');
select test.eq(public.get_my_profile() ->> 'member_id', null, 'no member id in profile');
select test.eq(public.get_dashboard('2026-09-23') ->> 'scope', 'PROJECT', 'dashboard works');
select test.eq((public.get_dashboard('2026-09-23') #>> '{tasks,total}')::int, 8, 'sees whole project');
select test.eq((select count(*) from public.task)::int, 8, 'reads all tasks');
-- นำเข้าสมาชิกได้ และไม่มีคำเตือนเรื่องบัญชีตัวเอง
select test.eq((public.admin_import_members($$[
  {"id":"M120","student_id":"120","full_name":"ทดสอบ","department":"ฝ่ายวิชาการ","position":"สมาชิก","work_status":"ปฏิบัติหน้าที่"}
]$$::jsonb, false, true) ->> 'ok')::boolean, true, 'standalone admin can import');
reset role;

-- ระงับบัญชี → ใช้ไม่ได้
update public.user_account set account_status = 'SUSPENDED' where email = 'solo-admin@example.ac.th';
select test.login('solo-admin@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), null, 'suspended standalone admin');
reset role;

-- บัญชีสมาชิกทั่วไปยังทำงานเหมือนเดิม
select test.login('head@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), 'HEAD'::public.app_role, 'member accounts unchanged');
reset role;

rollback;

-- ค่าสถานะตรงกับ dropdown ในไฟล์ FT20_CONTROL_CENTER
begin;
select test.eq((select array_agg(value order by sort_order) from public.status_option where entity = 'TASK'),
  '{ยังไม่เริ่ม,กำลังดำเนินการ,รอดำเนินการ,เสร็จสิ้น,ล่าช้า,ยกเลิก}'::text[], 'task statuses');
select test.eq((select array_agg(value order by sort_order) from public.status_option where entity = 'MEMBER'),
  '{ปฏิบัติหน้าที่,พักการปฏิบัติหน้าที่,พ้นสภาพ/ลาออก}'::text[], 'member statuses');
select test.eq((select array_agg(value order by sort_order) from public.status_option where entity = 'LETTER'),
  '{รอส่ง,ส่งแล้ว-รอตอบรับ,ตอบรับแล้ว,ปฏิเสธ,ไม่ต้องตอบรับ}'::text[], 'letter statuses');
select test.eq((select array_agg(value order by sort_order) from public.status_option where entity = 'RISK'),
  '{ยังไม่แก้ไข,กำลังแก้ไข,รอติดตามผล,แก้ไขเสร็จสิ้น,ปิดประเด็น}'::text[], 'risk statuses');
select test.eq((select array_agg(value order by sort_order) from public.status_option where entity = 'REGISTRATION_CHECKIN'),
  '{ยังไม่เช็คอิน,เช็คอินแล้ว,ขาดการเข้าร่วม}'::text[], 'checkin statuses');
select test.eq((select count(*) from public.registration where checkin_status = 'เช็คอินแล้ว')::int, 2, 'checkin column used');
rollback;
