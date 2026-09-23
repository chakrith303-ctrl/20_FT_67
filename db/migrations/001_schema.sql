-- =====================================================================
-- 1) โครงสร้างข้อมูล: Entity ↔ ตาราง ↔ รหัส
-- =====================================================================

create schema if not exists private;

-- บทบาทฐานข้อมูลที่ทุกคำขอจากเว็บใช้ (server ตั้ง `set local role app_user` ทุก transaction)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end
$$;
grant app_user to current_user;

create type public.app_role as enum ('ADMIN', 'PRESIDENT', 'VICE_PRESIDENT', 'HEAD', 'SECRETARY', 'MEMBER');
create type public.flag_state as enum ('ENABLED', 'ENABLED_READ_ONLY', 'ENABLED_CONTROLLED', 'DISABLED_FAIL_CLOSED');

-- ---------------------------------------------------------------------
-- รหัส: prefix + ตัวเลขอย่างน้อย 3 หลัก (T001, RI012, EVQ003, ...)
-- ---------------------------------------------------------------------
create function private.format_id(p_prefix text, p_num bigint)
returns text
language sql immutable
set search_path = ''
as $$
  select p_prefix || case when length(p_num::text) < 3 then lpad(p_num::text, 3, '0') else p_num::text end
$$;

create sequence private.task_id_seq;
create sequence private.document_id_seq;
create sequence private.letter_id_seq;
create sequence private.registration_id_seq;
create sequence private.budget_id_seq;
create sequence private.risk_id_seq;
create sequence private.evidence_id_seq;
create sequence private.member_id_seq;
create sequence private.user_id_seq;
create sequence private.evq_id_seq;
create sequence private.ev_id_seq;
create sequence private.audit_id_seq;
create sequence private.invite_id_seq;

-- ออกรหัสถัดไป (security definer: ผู้ใช้ไม่ต้องมีสิทธิ์บน sequence โดยตรง)
create function private.next_id(p_prefix text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_seq text := case p_prefix
    when 'T' then 'private.task_id_seq'
    when 'D' then 'private.document_id_seq'
    when 'L' then 'private.letter_id_seq'
    when 'R' then 'private.registration_id_seq'
    when 'B' then 'private.budget_id_seq'
    when 'RI' then 'private.risk_id_seq'
    when 'E' then 'private.evidence_id_seq'
    when 'M' then 'private.member_id_seq'
    when 'U' then 'private.user_id_seq'
    when 'EVQ' then 'private.evq_id_seq'
    when 'EV' then 'private.ev_id_seq'
    when 'A' then 'private.audit_id_seq'
    when 'INV' then 'private.invite_id_seq'
  end;
begin
  if v_seq is null then
    raise exception 'unknown id prefix %', p_prefix;
  end if;
  return private.format_id(p_prefix, nextval(v_seq::regclass));
end
$$;

-- ทุกสมาชิกของ array ตรงรูปแบบรหัส
create function private.ids_match(p_ids text[], p_pattern text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(bool_and(x ~ p_pattern), true) from unnest(p_ids) as x
$$;

-- ---------------------------------------------------------------------
-- ตารางอ้างอิง
-- ---------------------------------------------------------------------

-- 2) Feature flags — แก้ได้เฉพาะผู้ดูแลฐานข้อมูล (ไม่มีสิทธิ์เขียนผ่าน API)
create table public.feature_flag (
  key text primary key,
  state public.flag_state not null,
  note text,
  updated_at timestamptz not null default now()
);

insert into public.feature_flag (key, state, note) values
  ('WRITE:TASK', 'ENABLED', null),
  ('WRITE:DOCUMENT', 'ENABLED', null),
  ('WRITE:LETTER', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('WRITE:REGISTRATION', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('WRITE:BUDGET', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('WRITE:RISK', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('WRITE:EVIDENCE', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('WRITE:EVALUATION_QUESTION', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('WRITE:EVALUATION_RESPONSE', 'DISABLED_FAIL_CLOSED', 'รอการอนุมัติ'),
  ('READ:TASK', 'ENABLED_READ_ONLY', null),
  ('READ:DOCUMENT', 'ENABLED_READ_ONLY', null),
  ('READ:LETTER', 'ENABLED_READ_ONLY', null),
  ('READ:REGISTRATION', 'ENABLED_READ_ONLY', 'มีตรวจสิทธิ์'),
  ('READ:BUDGET', 'ENABLED_READ_ONLY', 'จำกัดตามฝ่าย'),
  ('READ:RISK', 'ENABLED_READ_ONLY', 'จำกัดตามฝ่าย'),
  ('READ:EVIDENCE', 'ENABLED_READ_ONLY', 'จำกัดตามฝ่าย + แยกส่วนตรวจ'),
  ('READ:EVALUATION', 'ENABLED_READ_ONLY', 'dual-source ภายใน'),
  ('DASHBOARD', 'ENABLED_READ_ONLY', 'ห้ามเขียนกลับ'),
  ('DASHBOARD:ADMIN', 'ENABLED_READ_ONLY', null),
  ('DASHBOARD:PRESIDENT', 'ENABLED_READ_ONLY', null),
  ('DASHBOARD:VICE_PRESIDENT', 'ENABLED_READ_ONLY', null),
  ('DASHBOARD:HEAD', 'ENABLED_READ_ONLY', null),
  ('DASHBOARD:SECRETARY', 'ENABLED_READ_ONLY', null),
  ('DASHBOARD:MEMBER', 'DISABLED_FAIL_CLOSED', null),
  ('SELF_REGISTRATION', 'ENABLED_CONTROLLED', 'Contract V1.1'),
  ('INVITE_CREATION', 'ENABLED_CONTROLLED', null);

-- ค่าตั้งค่าระบบ (ไม่เปิดให้ API อ่าน)
create table public.app_setting (
  key text primary key,
  value text not null
);
insert into public.app_setting (key, value) values
  ('allowed_email_domains', ''),        -- เช่น 'example.ac.th' (คั่นหลายโดเมนด้วย ,) ว่าง = สมัครไม่ได้ (fail-closed)
  ('invite_ttl_days', '7'),
  ('register_max_attempts', '5'),
  ('register_window_minutes', '15'),
  ('timezone', 'Asia/Bangkok');

create table public.department (
  name text primary key check (btrim(name) = name and name <> '')
);

-- ตำแหน่งใน MEMBER → บทบาท (ตรงตัวเป๊ะ) — ADMIN มาจากตำแหน่งไม่ได้
create table public.position_role (
  position text primary key,
  role public.app_role not null check (role <> 'ADMIN')
);
insert into public.position_role (position, role) values
  ('ประธานโครงการ', 'PRESIDENT'),
  ('รองประธานโครงการ', 'VICE_PRESIDENT'),
  ('หัวหน้า', 'HEAD'),
  ('เลขา', 'SECRETARY'),
  ('สมาชิก', 'MEMBER');

-- ค่าสถานะที่อนุญาตต่อ entity — บันทึกค่าที่ไม่อยู่ในรายการไม่ได้ (กันสะกดผิด/ช่องว่างเกิน)
create table public.status_option (
  entity text not null,
  value text not null check (btrim(value) = value and value <> ''),
  sort_order int not null default 0,
  primary key (entity, value)
);
insert into public.status_option (entity, value, sort_order) values
  ('TASK', 'ยังไม่เริ่ม', 1),
  ('TASK', 'กำลังดำเนินการ', 2),
  ('TASK', 'เสร็จสิ้น', 3),
  ('TASK', 'ยกเลิก', 4),
  ('DOCUMENT', 'ร่าง', 1),
  ('DOCUMENT', 'ต้องแก้ไข', 2),
  ('DOCUMENT', 'รอตรวจ', 3),
  ('DOCUMENT', 'รออนุมัติ', 4),
  ('DOCUMENT', 'อนุมัติแล้ว', 5),
  ('LETTER', 'ร่าง', 1),
  ('LETTER', 'ส่งแล้ว-รอตอบรับ', 2),
  ('LETTER', 'ได้รับตอบรับแล้ว', 3),
  ('LETTER', 'ยกเลิก', 4),
  ('RISK', 'เปิดประเด็น', 1),
  ('RISK', 'กำลังแก้ไข', 2),
  ('RISK', 'แก้ไขเสร็จสิ้น', 3),
  ('RISK', 'ปิดประเด็น', 4),
  ('REGISTRATION', 'ลงทะเบียนแล้ว', 1),
  ('REGISTRATION', 'เช็คอินแล้ว', 2),
  ('REGISTRATION', 'ยกเลิก', 3),
  ('MEMBER', 'ปฏิบัติหน้าที่', 1),
  ('MEMBER', 'พักการปฏิบัติหน้าที่', 2),
  ('MEMBER', 'พ้นสภาพ', 3);

-- ---------------------------------------------------------------------
-- MEMBER / USER_ACCOUNT
-- ---------------------------------------------------------------------
create table public.member (
  id text primary key default private.next_id('M') check (id ~ '^M[0-9]{3,}$'),
  full_name text not null default '',
  student_id text unique check (student_id is null or (btrim(student_id) = student_id and student_id <> '')),
  department text not null references public.department (name) on update cascade,
  position text not null,
  work_status text not null,
  status_entity text not null default 'MEMBER' check (status_entity = 'MEMBER'),
  foreign key (status_entity, work_status) references public.status_option (entity, value) on update cascade
);

create table public.user_account (
  user_id text primary key default private.next_id('U') check (user_id ~ '^U[0-9]{3,}$'),
  member_id text not null unique references public.member (id) on update cascade,
  google_sub text unique, -- รหัสบัญชี Google (sub) ที่ยืนยันแล้วโดย server
  email text not null unique check (email = lower(btrim(email))),
  role public.app_role not null,
  account_status text not null default 'ACTIVE' check (account_status in ('ACTIVE', 'SUSPENDED')),
  last_login timestamptz,
  created_date timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- โมดูลงาน
-- ---------------------------------------------------------------------
create table public.task (
  id text primary key default private.next_id('T') check (id ~ '^T[0-9]{3,}$'),
  department text not null references public.department (name) on update cascade,
  name text not null default '',
  owner_main_id text references public.member (id) on update cascade,
  co_owner_ids text[] not null default '{}' check (private.ids_match(co_owner_ids, '^M[0-9]{3,}$')),
  status text not null default 'ยังไม่เริ่ม',
  related_document_ids text[] not null default '{}' check (private.ids_match(related_document_ids, '^D[0-9]{3,}$')),
  evidence_ids text[] not null default '{}' check (private.ids_match(evidence_ids, '^E[0-9]{3,}$')),
  start_date date,
  due_date date,
  note text,
  status_entity text not null default 'TASK' check (status_entity = 'TASK'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (status_entity, status) references public.status_option (entity, value) on update cascade
);

create table public.document (
  id text primary key default private.next_id('D') check (id ~ '^D[0-9]{3,}$'),
  department text not null references public.department (name) on update cascade,
  task_id text references public.task (id) on update cascade,
  name text not null default '',
  link text,
  status text not null default 'ร่าง',
  note text,
  status_entity text not null default 'DOCUMENT' check (status_entity = 'DOCUMENT'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (status_entity, status) references public.status_option (entity, value) on update cascade
);

create table public.letter (
  id text primary key default private.next_id('L') check (id ~ '^L[0-9]{3,}$'),
  department text not null references public.department (name) on update cascade, -- ฝ่ายที่เสนอเรื่อง
  task_id text references public.task (id) on update cascade,
  subject text not null default '',
  recipient text,
  status text not null default 'ร่าง',
  note text,
  status_entity text not null default 'LETTER' check (status_entity = 'LETTER'),
  foreign key (status_entity, status) references public.status_option (entity, value) on update cascade
);

create table public.registration (
  id text primary key default private.next_id('R') check (id ~ '^R[0-9]{3,}$'),
  full_name text not null default '',
  contact text,
  status text not null default 'ลงทะเบียนแล้ว',
  registered_at timestamptz,
  checked_in_at timestamptz,
  status_entity text not null default 'REGISTRATION' check (status_entity = 'REGISTRATION'),
  foreign key (status_entity, status) references public.status_option (entity, value) on update cascade
);

create table public.budget (
  id text primary key default private.next_id('B') check (id ~ '^B[0-9]{3,}$'),
  department text not null references public.department (name) on update cascade, -- ฝ่ายที่ขอใช้
  item text not null default '',
  initial_budget numeric(14, 2) not null default 0,
  actual_cost numeric(14, 2) not null default 0,
  note text
);

create table public.risk_issue (
  id text primary key default private.next_id('RI') check (id ~ '^RI[0-9]{3,}$'),
  department text not null references public.department (name) on update cascade,
  task_id text references public.task (id) on update cascade,
  title text not null default '',
  status text not null default 'เปิดประเด็น',
  note text,
  status_entity text not null default 'RISK' check (status_entity = 'RISK'),
  foreign key (status_entity, status) references public.status_option (entity, value) on update cascade
);

create table public.evidence (
  id text primary key default private.next_id('E') check (id ~ '^E[0-9]{3,}$'),
  department text not null references public.department (name) on update cascade,
  task_id text not null references public.task (id) on update cascade,
  title text not null default '',
  link text
);
create index evidence_task_id_idx on public.evidence (task_id);

-- "แยกส่วนตรวจ": ผลการตรวจหลักฐานอยู่อีกตาราง เห็นได้เฉพาะระดับโครงการ
create table public.evidence_review (
  evidence_id text primary key references public.evidence (id) on update cascade on delete cascade,
  result text,
  reviewer text,
  reviewed_at timestamptz,
  note text
);

create table public.evaluation_question (
  question_id text primary key default private.next_id('EVQ') check (question_id ~ '^EVQ[0-9]{3,}$'),
  question text not null default '',
  sort_order int not null default 0
);

create table public.evaluation_response (
  response_id text primary key default private.next_id('EV') check (response_id ~ '^EV[0-9]{3,}$'),
  evaluation_id text not null,
  registration_id text not null references public.registration (id) on update cascade,
  answers jsonb not null default '{}',
  submitted_at timestamptz
);

-- ---------------------------------------------------------------------
-- AUDIT_LOG (append-only)
-- ---------------------------------------------------------------------
create table public.audit_log (
  audit_id text primary key default private.next_id('A') check (audit_id ~ '^A[0-9]{3,}$'),
  "timestamp" timestamptz not null default now(),
  user_id text not null,
  action text not null,
  table_name text not null,
  record_id text,
  old_value jsonb,
  new_value jsonb,
  note text
);
create index audit_log_timestamp_idx on public.audit_log ("timestamp" desc);

-- ---------------------------------------------------------------------
-- Self-registration
-- ---------------------------------------------------------------------
create table public.invite (
  invite_id text primary key default private.next_id('INV') check (invite_id ~ '^INV[0-9]{3,}$'),
  member_id text not null references public.member (id) on update cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'), -- SHA-256 เท่านั้น ไม่เก็บ plaintext
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'USED', 'REVOKED')),
  created_by text not null,
  created_date timestamptz not null default now(),
  expires_at timestamptz not null,
  used_date timestamptz,
  used_by_user_id text references public.user_account (user_id) on update cascade
);
-- 1 คนมี invite ACTIVE ได้สูงสุด 1 อัน
create unique index invite_one_active_per_member on public.invite (member_id) where status = 'ACTIVE';

create table public.registration_attempt (
  id bigint generated always as identity primary key,
  google_sub text,
  attempted_at timestamptz not null default now(),
  success boolean not null,
  reason text -- เหตุผลจริง (ดูได้เฉพาะผู้ดูแลฐานข้อมูล ไม่ส่งกลับให้ผู้ใช้)
);
create index registration_attempt_user_idx on public.registration_attempt (google_sub, attempted_at desc);
