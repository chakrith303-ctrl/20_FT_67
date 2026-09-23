-- ตัวตน, บทบาทจากตำแหน่ง, รหัส
begin;

select test.eq(private.format_id('T', 1), 'T001', 'format 3 digits');
select test.eq(private.format_id('T', 1234), 'T1234', 'format > 3 digits keeps all digits');
select test.eq(private.next_id('T'), 'T009', 'next task id after sync');
select test.eq(private.next_id('EV'), 'EV002', 'EV sequence independent of EVQ');
select test.eq(private.next_id('EVQ'), 'EVQ002', 'EVQ sequence');
select test.throws($$insert into public.task (id, department) values ('T01', 'ฝ่ายวิชาการ')$$, 'short id rejected', '23514');
select test.throws($$insert into public.task (department, co_owner_ids) values ('ฝ่ายวิชาการ', '{X1}')$$, 'bad member ref rejected', '23514');
select test.throws($$insert into public.task (department, status) values ('ฝ่ายวิชาการ', 'เสร็จสิ้น ')$$, 'status must match exactly', '23503');
select test.throws($$insert into public.position_role values ('ผู้ดูแล', 'ADMIN')$$, 'ADMIN cannot come from position', '23514');

-- ไม่ login
select test.login(null);
set local role app_user;
select test.eq(private.my_role(), null, 'anonymous has no role');
select test.eq(public.get_my_profile(), null, 'anonymous profile null');
select test.eq((select count(*) from public.task)::int, 0, 'anonymous sees no task');
reset role;

-- บทบาทจากตำแหน่ง
select test.login('head@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), 'HEAD'::public.app_role, 'head role');
select test.eq(private.my_scope(), 'DEPARTMENT', 'head scope');
select test.eq(public.get_my_profile() ->> 'department', 'ฝ่ายวิชาการ', 'head department');
select test.eq(public.get_my_profile() -> 'writable_modules', '["DOCUMENT", "TASK"]'::jsonb, 'head writable');
select test.ok(not (public.get_my_profile() -> 'readable_modules') ? 'EVALUATION', 'head cannot read evaluation');
reset role;

select test.login('secretary@example.ac.th');
set local role app_user;
select test.eq(private.my_scope(), 'DEPARTMENT', 'secretary = head scope');
reset role;

select test.login('vp@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), 'ADMIN'::public.app_role, 'ADMIN from user_account');
select test.eq(private.my_scope(), 'PROJECT', 'admin scope');
reset role;

select test.login('member@example.ac.th');
set local role app_user;
select test.eq(public.get_my_profile() -> 'writable_modules', '[]'::jsonb, 'member cannot write');
select test.eq(public.get_my_profile() -> 'readable_modules', '["TASK"]'::jsonb, 'member reads task only');
select test.eq((public.get_my_profile() ->> 'can_view_dashboard')::boolean, false, 'member dashboard disabled');
reset role;

-- เปลี่ยนตำแหน่งแล้วสิทธิ์เปลี่ยนทันที
update public.member set position = 'หัวหน้า' where id = 'M005';
select test.login('member@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), 'HEAD'::public.app_role, 'role follows MEMBER position');
reset role;

-- ตำแหน่งไม่ตรง / พ้นสภาพ / ระงับบัญชี → ไม่มีสิทธิ์
update public.member set position = 'หัวหน้าฝ่าย' where id = 'M005';
select test.login('member@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), null, 'unmapped position has no role');
reset role;
update public.member set position = 'สมาชิก', work_status = 'พ้นสภาพ' where id = 'M005';
select test.login('member@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), null, 'inactive member has no role');
reset role;
update public.user_account set account_status = 'SUSPENDED' where user_id = 'U002';
select test.login('head@example.ac.th');
set local role app_user;
select test.eq(private.my_role(), null, 'suspended account has no role');
select test.eq((select count(*) from public.task)::int, 0, 'suspended sees nothing');
reset role;

rollback;
