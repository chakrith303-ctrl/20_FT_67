-- Invite + Self-registration (Contract V1.1)
begin;

create temp table inv (who text primary key, code text, invite_id text);
grant all on inv to authenticated;
create temp table res (step text primary key, j jsonb);
grant all on res to authenticated;

-- ---- สร้าง invite ----
select test.login('head@example.ac.th');
set local role authenticated;
select test.throws($$select public.create_invite('M008')$$, 'head cannot create invite', '42501');
reset role;

select test.login('president@example.ac.th');
set local role authenticated;
select test.throws($$select public.create_invite('M003')$$, 'member already has account', '23505');
select test.throws($$select public.create_invite('M006')$$, 'inactive member', '22023');
select test.throws($$select public.create_invite('M007')$$, 'unmapped position', '22023');
select test.throws($$select public.create_invite('M999')$$, 'unknown member', 'P0002');
insert into inv select 'old', j ->> 'code', j ->> 'invite_id' from (select public.create_invite('M008') j) x;
insert into inv select 'm8', j ->> 'code', j ->> 'invite_id' from (select public.create_invite('M008') j) x;
insert into inv select 'm9', j ->> 'code', j ->> 'invite_id' from (select public.create_invite('M009') j) x;
reset role;

select test.ok((select code ~ '^([0-9A-F]{4}-){7}[0-9A-F]{4}$' from inv where who = 'm8'), 'code format');
select test.eq((select status from public.invite where invite_id = (select invite_id from inv where who = 'old')), 'REVOKED', 'old invite revoked');
select test.eq((select count(*) from public.invite where member_id = 'M008' and status = 'ACTIVE')::int, 1, 'one active per member');
select test.eq(
  (select code_hash from public.invite where invite_id = (select invite_id from inv where who = 'm8')),
  (select encode(sha256(convert_to(replace(code, '-', ''), 'UTF8')), 'hex') from inv where who = 'm8'),
  'stored as sha256 of code');
select test.ok(not exists (
  select 1 from public.invite i, inv where i::text like '%' || replace(inv.code, '-', '') || '%'
), 'plaintext code not stored');
select test.ok(not exists (
  select 1 from public.audit_log a, inv where a::text like '%' || replace(inv.code, '-', '') || '%'
), 'plaintext code not in audit');
select test.eq((select count(*) from public.audit_log where action = 'INVITE_CREATE')::int, 3, 'invite audit');
select test.throws($$insert into public.invite (member_id, code_hash, created_by, expires_at) values ('M008', repeat('a', 64), 'x', now())$$, 'db enforces one active invite', '23505');

-- ---- ล้มเหลว: ข้อความเดียวกันทุกกรณี ----
select test.login('new1@example.ac.th');
set local role authenticated;
insert into res values ('wrong code', public.register_self('6500008', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111'));
insert into res values ('wrong student', public.register_self('6599999', (select code from inv where who = 'm8')));
insert into res values ('other member invite', public.register_self('6500009', (select code from inv where who = 'm8')));
insert into res values ('revoked invite', public.register_self('6500008', (select code from inv where who = 'old')));
insert into res values ('empty', public.register_self('', ''));
insert into res values ('null', public.register_self(null, null));
reset role;
select test.login('member@example.ac.th');
set local role authenticated;
insert into res values ('already registered email', public.register_self('6500008', (select code from inv where who = 'm8')));
reset role;
select test.login('outsider@gmail.com');
set local role authenticated;
insert into res values ('outside domain', public.register_self('6500008', (select code from inv where who = 'm8')));
reset role;
select test.login('unverified@example.ac.th');
set local role authenticated;
insert into res values ('unverified email', public.register_self('6500008', (select code from inv where who = 'm8')));
reset role;
select test.login(null);
set local role authenticated;
insert into res values ('no session', public.register_self('6500008', (select code from inv where who = 'm8')));
reset role;

select test.eq((select count(distinct j) from res)::int, 1, 'all failures identical');
select test.eq((select j from res limit 1),
  '{"ok": false, "message": "ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูลอีกครั้งหรือติดต่อผู้ดูแลระบบ"}'::jsonb, 'generic message');
select test.eq((select count(*) from public.user_account)::int, 5, 'no account created on failure');
select test.eq((select status from public.invite where invite_id = (select invite_id from inv where who = 'm8')), 'ACTIVE', 'invite still active');
select test.ok((select count(*) from public.registration_attempt where not success) >= 8, 'failures recorded with reason');

-- ---- สำเร็จ: email จาก session, role จากตำแหน่ง ----
select test.login('new2@example.ac.th');
set local role authenticated;
insert into res values ('success', public.register_self(' 6500008 ', lower((select code from inv where who = 'm8'))));
reset role;
select test.eq((select j ->> 'ok' from res where step = 'success'), 'true', 'register ok');
select test.eq((select j ->> 'role' from res where step = 'success'), 'MEMBER', 'role from position');
select test.eq(
  (select row(member_id, email, role::text, account_status)::text from public.user_account where user_id = (select j ->> 'user_id' from res where step = 'success')),
  row('M008', 'new2@example.ac.th', 'MEMBER', 'ACTIVE')::text, 'account row');
select test.eq((select status from public.invite where invite_id = (select invite_id from inv where who = 'm8')), 'USED', 'invite used');
select test.eq((select count(*) from public.audit_log where action = 'SELF_REGISTER' and user_id = (select j ->> 'user_id' from res where step = 'success'))::int, 1, 'register audited');

-- ใช้ซ้ำ → ปฏิเสธ
select test.login('new3@example.ac.th');
set local role authenticated;
select test.eq(public.register_self('6500008', (select code from inv where who = 'm8')) ->> 'ok', 'false', 'invite single use');
reset role;

-- ผู้ใช้ใหม่ใช้งานได้ทันที
select test.login('new2@example.ac.th');
set local role authenticated;
select test.eq(private.my_role(), 'MEMBER'::public.app_role, 'new user has role');
reset role;

-- ---- หมดอายุ ----
update public.invite set expires_at = now() - interval '1 minute' where invite_id = (select invite_id from inv where who = 'm9');
select test.login('new3@example.ac.th');
set local role authenticated;
select test.eq(public.register_self('6500009', (select code from inv where who = 'm9')) ->> 'ok', 'false', 'expired invite');
reset role;
update public.invite set expires_at = now() + interval '1 day' where invite_id = (select invite_id from inv where who = 'm9');

-- ---- rate limit: new1 ล้มเหลวไปแล้ว 6 ครั้ง ----
select test.login('new1@example.ac.th');
set local role authenticated;
select test.eq(public.register_self('6500009', (select code from inv where who = 'm9')) ->> 'ok', 'false', 'rate limited even with correct data');
reset role;

-- ---- ปิด flag → สมัครไม่ได้ ----
update public.feature_flag set state = 'DISABLED_FAIL_CLOSED' where key = 'SELF_REGISTRATION';
select test.login('new4@example.ac.th');
set local role authenticated;
select test.eq(public.register_self('6500009', (select code from inv where who = 'm9')) ->> 'ok', 'false', 'flag off');
reset role;
update public.feature_flag set state = 'ENABLED_CONTROLLED' where key = 'SELF_REGISTRATION';

select test.login('new4@example.ac.th');
set local role authenticated;
select test.eq(public.register_self('6500009', (select code from inv where who = 'm9')) ->> 'ok', 'true', 'm9 registers');
reset role;

-- ---- รหัสนักศึกษาซ้ำ = ระบุตัวตนไม่ได้ ----
select test.throws($$insert into public.member (full_name, student_id, department, position, work_status) values ('ซ้ำ', '6500008', 'ฝ่ายสถานที่', 'สมาชิก', 'ปฏิบัติหน้าที่')$$, 'student id unique', '23505');

-- anon เรียก RPC ไม่ได้
set local role anon;
select test.throws($$select public.register_self('1', '2')$$, 'anon cannot call', '42501');
reset role;

rollback;
