-- =====================================================================
-- ตัวตน, สิทธิ์ (Row Level Security), การเขียนแบบ fail-closed และ Audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- ตัวตนของผู้เรียก
-- server (Express) ตรวจ Google ID token แล้วตั้งค่าในแต่ละ transaction:
--   set_config('app.sub', <google sub>, true), set_config('app.email', <verified email>, true)
--   set local role app_user
-- บทบาทคำนวณจากตำแหน่งใน MEMBER ทุกครั้ง (ยกเว้น ADMIN ที่ผู้ดูแลกำหนดใน user_account)
-- ---------------------------------------------------------------------
create function private.session_sub()
returns text
language sql stable
set search_path = ''
as $$
  select nullif(current_setting('app.sub', true), '')
$$;

create function private.session_email()
returns text
language sql stable
set search_path = ''
as $$
  select nullif(lower(btrim(current_setting('app.email', true))), '')
$$;

create function private.role_scope(p_role public.app_role)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'ADMIN' then 'PROJECT'
    when 'PRESIDENT' then 'PROJECT'
    when 'VICE_PRESIDENT' then 'PROJECT'   -- สิทธิ์เท่า PRESIDENT
    when 'HEAD' then 'DEPARTMENT'
    when 'SECRETARY' then 'DEPARTMENT'     -- สิทธิ์เท่า HEAD
    when 'MEMBER' then 'SELF'
  end
$$;

create function private.current_ctx()
returns table (user_id text, member_id text, role public.app_role, scope text, department text)
language sql stable security definer
set search_path = ''
as $$
  select ua.user_id,
         ua.member_id,
         r.role,
         private.role_scope(r.role),
         m.department
  from public.user_account ua
  join public.member m on m.id = ua.member_id
  left join public.position_role pr on pr.position = m.position
  cross join lateral (
    select case when ua.role = 'ADMIN' then 'ADMIN'::public.app_role else pr.role end as role
  ) r
  where ua.google_sub = private.session_sub()
    and ua.account_status = 'ACTIVE'
    and m.work_status = 'ปฏิบัติหน้าที่'
    and r.role is not null
$$;

create function private.my_user_id() returns text
language sql stable security definer set search_path = ''
as $$ select user_id from private.current_ctx() $$;

create function private.my_member_id() returns text
language sql stable security definer set search_path = ''
as $$ select member_id from private.current_ctx() $$;

create function private.my_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from private.current_ctx() $$;

create function private.my_scope() returns text
language sql stable security definer set search_path = ''
as $$ select scope from private.current_ctx() $$;

create function private.my_department() returns text
language sql stable security definer set search_path = ''
as $$ select department from private.current_ctx() $$;

-- flag ตรงสถานะที่ระบุหรือไม่ (ไม่พบ flag = false → fail-closed)
create function private.flag_is(p_key text, p_state public.flag_state)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select state = p_state from public.feature_flag where key = p_key), false)
$$;

-- อ่านข้อมูลตามฝ่ายได้หรือไม่: ระดับโครงการ = ทุกฝ่าย, ระดับฝ่าย = ฝ่ายตน
create function private.can_read_dept(p_module text, p_department text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.flag_is('READ:' || p_module, 'ENABLED_READ_ONLY')
     and (
       private.my_scope() = 'PROJECT'
       or (private.my_scope() = 'DEPARTMENT' and p_department = private.my_department())
     )
$$;

-- เขียนได้หรือไม่: flag ต้องเป็น ENABLED และเป็นฝ่ายที่มีสิทธิ์
create function private.can_write_dept(p_module text, p_department text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.flag_is('WRITE:' || p_module, 'ENABLED')
     and (
       private.my_scope() = 'PROJECT'
       or (private.my_scope() = 'DEPARTMENT' and p_department = private.my_department())
     )
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.feature_flag enable row level security;
alter table public.app_setting enable row level security;
alter table public.department enable row level security;
alter table public.position_role enable row level security;
alter table public.status_option enable row level security;
alter table public.member enable row level security;
alter table public.user_account enable row level security;
alter table public.task enable row level security;
alter table public.document enable row level security;
alter table public.letter enable row level security;
alter table public.registration enable row level security;
alter table public.budget enable row level security;
alter table public.risk_issue enable row level security;
alter table public.evidence enable row level security;
alter table public.evidence_review enable row level security;
alter table public.evaluation_question enable row level security;
alter table public.evaluation_response enable row level security;
alter table public.audit_log enable row level security;
alter table public.invite enable row level security;
alter table public.registration_attempt enable row level security;
-- app_setting, registration_attempt: ไม่มี policy = API เข้าไม่ได้เลย

-- ข้อมูลอ้างอิง: ผู้ใช้ที่มีบัญชีอ่านได้
create policy ref_read on public.feature_flag for select to app_user
  using ((select private.my_scope()) is not null);
create policy ref_read on public.department for select to app_user
  using ((select private.my_scope()) is not null);
create policy ref_read on public.position_role for select to app_user
  using ((select private.my_scope()) is not null);
create policy ref_read on public.status_option for select to app_user
  using ((select private.my_scope()) is not null);

-- MEMBER: โครงการ = ทั้งหมด, ฝ่าย = ฝ่ายตน, สมาชิก = ตัวเอง
create policy member_read on public.member for select to app_user
  using (
    (select private.my_scope()) = 'PROJECT'
    or ((select private.my_scope()) = 'DEPARTMENT' and department = (select private.my_department()))
    or id = (select private.my_member_id())
  );

-- USER_ACCOUNT: ตัวเอง หรือระดับโครงการ (ไม่มีสิทธิ์เขียนผ่าน API เด็ดขาด)
create policy user_account_read on public.user_account for select to app_user
  using (user_id = (select private.my_user_id()) or (select private.my_scope()) = 'PROJECT');

-- TASK: ฝ่าย + MEMBER เห็นงานที่ตนเป็นผู้รับผิดชอบหลัก/ร่วม
create policy task_read on public.task for select to app_user
  using (
    (select private.can_read_dept('TASK', department))
    or (
      (select private.flag_is('READ:TASK', 'ENABLED_READ_ONLY'))
      and (select private.my_scope()) = 'SELF'
      and (owner_main_id = (select private.my_member_id()) or (select private.my_member_id()) = any (co_owner_ids))
    )
  );
create policy task_insert on public.task for insert to app_user
  with check ((select private.can_write_dept('TASK', department)));
create policy task_update on public.task for update to app_user
  using ((select private.can_write_dept('TASK', department)))
  with check ((select private.can_write_dept('TASK', department)));

create policy document_read on public.document for select to app_user
  using ((select private.can_read_dept('DOCUMENT', department)));
create policy document_insert on public.document for insert to app_user
  with check ((select private.can_write_dept('DOCUMENT', department)));
create policy document_update on public.document for update to app_user
  using ((select private.can_write_dept('DOCUMENT', department)))
  with check ((select private.can_write_dept('DOCUMENT', department)));

create policy letter_read on public.letter for select to app_user
  using ((select private.can_read_dept('LETTER', department)));
create policy budget_read on public.budget for select to app_user
  using ((select private.can_read_dept('BUDGET', department)));
create policy risk_read on public.risk_issue for select to app_user
  using ((select private.can_read_dept('RISK', department)));
create policy evidence_read on public.evidence for select to app_user
  using ((select private.can_read_dept('EVIDENCE', department)));

-- REGISTRATION: ไม่มีมิติฝ่าย — ตรวจสิทธิ์ระดับบทบาท (โครงการ/ฝ่าย)
create policy registration_read on public.registration for select to app_user
  using (
    (select private.flag_is('READ:REGISTRATION', 'ENABLED_READ_ONLY'))
    and (select private.my_scope()) in ('PROJECT', 'DEPARTMENT')
  );

-- ส่วนตรวจหลักฐาน + EVALUATION: เฉพาะระดับโครงการ
create policy evidence_review_read on public.evidence_review for select to app_user
  using (
    (select private.flag_is('READ:EVIDENCE', 'ENABLED_READ_ONLY'))
    and (select private.my_scope()) = 'PROJECT'
  );
create policy evaluation_question_read on public.evaluation_question for select to app_user
  using (
    (select private.flag_is('READ:EVALUATION', 'ENABLED_READ_ONLY'))
    and (select private.my_scope()) = 'PROJECT'
  );
create policy evaluation_response_read on public.evaluation_response for select to app_user
  using (
    (select private.flag_is('READ:EVALUATION', 'ENABLED_READ_ONLY'))
    and (select private.my_scope()) = 'PROJECT'
  );

create policy audit_read on public.audit_log for select to app_user
  using ((select private.my_scope()) = 'PROJECT');

create policy invite_read on public.invite for select to app_user
  using ((select private.my_scope()) = 'PROJECT');

-- ---------------------------------------------------------------------
-- สิทธิ์ระดับตาราง/คอลัมน์ (ชั้นที่สองนอกจาก RLS)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
revoke all on all functions in schema private from public;
revoke all on all sequences in schema private from public;
revoke all on schema private from public;
alter default privileges in schema public revoke all on functions from public;

-- บน Supabase: ปิดทาง Data API (anon / authenticated) ทั้งหมด — เข้าถึงข้อมูลผ่าน server เท่านั้น
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on all functions in schema private from %I', r);
      execute format('revoke all on schema private from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
    end if;
  end loop;
end
$$;

grant usage on schema public to app_user;
grant usage on schema private to app_user;

grant select on
  public.feature_flag, public.department, public.position_role, public.status_option,
  public.member, public.user_account, public.task, public.document, public.letter,
  public.registration, public.budget, public.risk_issue, public.evidence,
  public.evidence_review, public.evaluation_question, public.evaluation_response,
  public.audit_log
to app_user;

-- invite: ไม่เปิดให้อ่าน code_hash
grant select (invite_id, member_id, status, created_by, created_date, expires_at, used_date, used_by_user_id)
  on public.invite to app_user;

-- เขียนได้เฉพาะ TASK / DOCUMENT และเฉพาะคอลัมน์ข้อมูล (ห้ามกำหนดรหัส/เวลาระบบเอง)
grant insert (department, name, owner_main_id, co_owner_ids, status, related_document_ids, evidence_ids, start_date, due_date, note),
      update (department, name, owner_main_id, co_owner_ids, status, related_document_ids, evidence_ids, start_date, due_date, note)
  on public.task to app_user;
grant insert (department, task_id, name, link, status, note),
      update (department, task_id, name, link, status, note)
  on public.document to app_user;

-- ฟังก์ชันที่ policy/ค่า default ต้องเรียก
grant execute on function
  private.next_id(text), private.ids_match(text[], text), private.format_id(text, bigint),
  private.role_scope(public.app_role), private.current_ctx(), private.session_sub(), private.session_email(),
  private.my_user_id(), private.my_member_id(), private.my_role(), private.my_scope(), private.my_department(),
  private.flag_is(text, public.flag_state), private.can_read_dept(text, text), private.can_write_dept(text, text)
to app_user;

-- ---------------------------------------------------------------------
-- updated_at อัตโนมัติ
-- ---------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger task_updated_at before update on public.task
  for each row execute function private.touch_updated_at();
create trigger document_updated_at before update on public.document
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- AUDIT_LOG: บันทึกอัตโนมัติทุกการเปลี่ยนแปลง (เก็บเฉพาะค่าที่เปลี่ยน)
-- ---------------------------------------------------------------------
create function private.write_audit(
  p_action text, p_table text, p_record_id text, p_old jsonb, p_new jsonb, p_note text default null,
  p_user_id text default null
)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  insert into public.audit_log (user_id, action, table_name, record_id, old_value, new_value, note)
  values (coalesce(p_user_id, private.my_user_id(), 'SYSTEM'), p_action, p_table, p_record_id, p_old, p_new, p_note)
  returning audit_id into v_id;
  return v_id;
end
$$;

-- อาร์กิวเมนต์ trigger: [0] = ชื่อคอลัมน์ primary key
create function private.audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_pk text := tg_argv[0];
  v_old_diff jsonb;
  v_new_diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value)
      into v_new_diff
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'last_login')
       and (v_old -> n.key) is distinct from n.value;
    if v_new_diff is null then
      return new; -- ไม่มีการเปลี่ยนแปลงที่มีความหมาย
    end if;
    select jsonb_object_agg(k, v_old -> k) into v_old_diff from jsonb_object_keys(v_new_diff) k;
    perform private.write_audit('UPDATE', tg_table_name, v_new ->> v_pk, v_old_diff, v_new_diff);
  elsif tg_op = 'INSERT' then
    perform private.write_audit('CREATE', tg_table_name, v_new ->> v_pk, null, v_new);
  else
    perform private.write_audit('DELETE', tg_table_name, v_old ->> v_pk, v_old, null);
  end if;
  return coalesce(new, old);
end
$$;

create trigger audit after insert or update or delete on public.task
  for each row execute function private.audit_row('id');
create trigger audit after insert or update or delete on public.document
  for each row execute function private.audit_row('id');
create trigger audit after insert or update or delete on public.member
  for each row execute function private.audit_row('id');
create trigger audit after update or delete on public.user_account
  for each row execute function private.audit_row('user_id');
create trigger audit after insert or update or delete on public.feature_flag
  for each row execute function private.audit_row('key');
create trigger audit after insert or update or delete on public.position_role
  for each row execute function private.audit_row('position');
create trigger audit after insert or update or delete on public.app_setting
  for each row execute function private.audit_row('key');

-- audit_log แก้ไข/ลบไม่ได้
create function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end
$$;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
