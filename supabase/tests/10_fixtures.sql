-- ข้อมูลตัวอย่าง + ฟังก์ชันช่วยทดสอบ (ใช้เฉพาะการทดสอบในเครื่อง)

create schema test;

create function test.login(p_email text) returns void
language plpgsql as $$
declare
  v uuid;
begin
  if p_email is null then
    perform set_config('request.jwt.claims', '', true);
    return;
  end if;
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'test: no auth user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
end $$;

create function test.eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_msg, p_expected, p_actual;
  end if;
end $$;

create function test.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL %', p_msg; end if;
end $$;

-- คำสั่งต้อง error (และตรง sqlstate ถ้าระบุ)
create function test.throws(p_sql text, p_msg text, p_sqlstate text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_sqlstate is not null and sqlstate <> p_sqlstate then
      raise exception 'FAIL %: expected sqlstate %, got % (%)', p_msg, p_sqlstate, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL %: expected an error', p_msg;
end $$;

-- จำนวนแถวที่คำสั่ง DML กระทบ
create function test.affected(p_sql text) returns int
language plpgsql as $$
declare
  n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant usage on schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;

-- ---------------------------------------------------------------------
update public.app_setting set value = 'example.ac.th' where key = 'allowed_email_domains';

insert into public.department (name) values ('ฝ่ายบริหาร'), ('ฝ่ายวิชาการ'), ('ฝ่ายสถานที่');

insert into public.member (id, full_name, student_id, department, position, work_status) values
  ('M001', 'ประธาน', '6500001', 'ฝ่ายบริหาร', 'ประธานโครงการ', 'ปฏิบัติหน้าที่'),
  ('M002', 'รองประธาน', '6500002', 'ฝ่ายบริหาร', 'รองประธานโครงการ', 'ปฏิบัติหน้าที่'),
  ('M003', 'หัวหน้าวิชาการ', '6500003', 'ฝ่ายวิชาการ', 'หัวหน้า', 'ปฏิบัติหน้าที่'),
  ('M004', 'เลขาสถานที่', '6500004', 'ฝ่ายสถานที่', 'เลขา', 'ปฏิบัติหน้าที่'),
  ('M005', 'สมาชิกวิชาการ', '6500005', 'ฝ่ายวิชาการ', 'สมาชิก', 'ปฏิบัติหน้าที่'),
  ('M006', 'พ้นสภาพ', '6500006', 'ฝ่ายวิชาการ', 'สมาชิก', 'พ้นสภาพ'),
  ('M007', 'ตำแหน่งแปลก', '6500007', 'ฝ่ายวิชาการ', 'หัวหน้าฝ่าย', 'ปฏิบัติหน้าที่'),
  ('M008', 'สมาชิกใหม่', '6500008', 'ฝ่ายสถานที่', 'สมาชิก', 'ปฏิบัติหน้าที่'),
  ('M009', 'สมาชิกใหม่ 2', '6500009', 'ฝ่ายวิชาการ', 'สมาชิก', 'ปฏิบัติหน้าที่');

insert into auth.users (email, email_confirmed_at)
select e, now() from unnest(array[
  'president@example.ac.th', 'vp@example.ac.th', 'head@example.ac.th', 'secretary@example.ac.th',
  'member@example.ac.th', 'new1@example.ac.th', 'new2@example.ac.th', 'new3@example.ac.th',
  'new4@example.ac.th', 'outsider@gmail.com'
]) e;
insert into auth.users (email, email_confirmed_at) values ('unverified@example.ac.th', null);

insert into public.user_account (user_id, member_id, auth_user_id, email, role) values
  ('U001', 'M001', (select id from auth.users where email = 'president@example.ac.th'), 'president@example.ac.th', 'PRESIDENT'),
  ('U002', 'M003', (select id from auth.users where email = 'head@example.ac.th'), 'head@example.ac.th', 'HEAD'),
  ('U003', 'M005', (select id from auth.users where email = 'member@example.ac.th'), 'member@example.ac.th', 'MEMBER'),
  ('U004', 'M004', (select id from auth.users where email = 'secretary@example.ac.th'), 'secretary@example.ac.th', 'SECRETARY'),
  ('U005', 'M002', (select id from auth.users where email = 'vp@example.ac.th'), 'vp@example.ac.th', 'ADMIN');

insert into public.task (id, department, name, owner_main_id, co_owner_ids, status, evidence_ids, due_date) values
  ('T001', 'ฝ่ายวิชาการ', 'งาน 1', 'M003', '{}', 'กำลังดำเนินการ', '{}', date '2026-09-21'),
  ('T002', 'ฝ่ายวิชาการ', 'งาน 2', 'M003', '{M005}', 'เสร็จสิ้น', '{}', date '2026-09-13'),
  ('T003', 'ฝ่ายสถานที่', 'งาน 3', 'M004', '{}', 'ยกเลิก', '{}', date '2026-09-22'),
  ('T004', 'ฝ่ายสถานที่', 'งาน 4', 'M004', '{}', 'กำลังดำเนินการ', '{}', date '2026-09-25'),
  ('T005', 'ฝ่ายสถานที่', 'งาน 5', 'M004', '{}', 'เสร็จสิ้น', '{E001}', date '2026-09-28'),
  ('T006', 'ฝ่ายวิชาการ', 'งาน 6', 'M005', '{}', 'ยังไม่เริ่ม', '{}', date '2026-09-23'),
  ('T007', 'ฝ่ายวิชาการ', 'งาน 7', 'M003', '{}', 'เสร็จสิ้น', '{}', date '2026-09-27'),
  ('T008', 'ฝ่ายวิชาการ', 'งาน 8', 'M003', '{}', 'ยังไม่เริ่ม', '{}', null);

insert into public.document (id, department, task_id, name, status) values
  ('D001', 'ฝ่ายวิชาการ', 'T001', 'เอกสาร 1', 'รออนุมัติ'),
  ('D002', 'ฝ่ายวิชาการ', 'T002', 'เอกสาร 2', 'รอตรวจ'),
  ('D003', 'ฝ่ายสถานที่', 'T004', 'เอกสาร 3', 'ร่าง'),
  ('D004', 'ฝ่ายสถานที่', 'T004', 'เอกสาร 4', 'ต้องแก้ไข'),
  ('D005', 'ฝ่ายสถานที่', 'T005', 'เอกสาร 5', 'อนุมัติแล้ว');

insert into public.letter (id, department, task_id, subject, status) values
  ('L001', 'ฝ่ายวิชาการ', 'T001', 'หนังสือ 1', 'ส่งแล้ว-รอตอบรับ'),
  ('L002', 'ฝ่ายสถานที่', 'T004', 'หนังสือ 2', 'ได้รับตอบรับแล้ว');

insert into public.registration (id, full_name, status) values
  ('R001', 'ก', 'เช็คอินแล้ว'), ('R002', 'ข', 'ลงทะเบียนแล้ว'), ('R003', 'ค', 'เช็คอินแล้ว');

insert into public.budget (id, department, item, initial_budget, actual_cost) values
  ('B001', 'ฝ่ายวิชาการ', 'ค่าเอกสาร', 1000, 800),
  ('B002', 'ฝ่ายสถานที่', 'ค่าสถานที่', 2500, 3000);

insert into public.risk_issue (id, department, task_id, title, status) values
  ('RI001', 'ฝ่ายวิชาการ', 'T001', 'ประเด็น 1', 'แก้ไขเสร็จสิ้น'),
  ('RI002', 'ฝ่ายสถานที่', 'T004', 'ประเด็น 2', 'ปิดประเด็น'),
  ('RI003', 'ฝ่ายสถานที่', 'T004', 'ประเด็น 3', 'กำลังแก้ไข');

-- E002 เป็นหลักฐานของงานฝ่ายวิชาการ (T007) แต่บันทึกโดยฝ่ายสถานที่
insert into public.evidence (id, department, task_id, title, link) values
  ('E001', 'ฝ่ายวิชาการ', 'T002', 'หลักฐาน 1', 'https://example.com/1'),
  ('E002', 'ฝ่ายสถานที่', 'T007', 'หลักฐาน 2', 'https://example.com/2');
insert into public.evidence_review (evidence_id, result, reviewer) values ('E001', 'ผ่าน', 'M001');

insert into public.evaluation_question (question_id, question) values ('EVQ001', 'พอใจไหม');
insert into public.evaluation_response (response_id, evaluation_id, registration_id, answers)
values ('EV001', 'EVAL01', 'R001', '{"EVQ001": 5}');

select private.sync_id_sequences();
