-- =====================================================================
-- RPC ที่หน้าเว็บเรียก (ผ่าน supabase.rpc(...))
-- =====================================================================

-- ---------------------------------------------------------------------
-- โปรไฟล์ผู้ใช้ปัจจุบัน + สิทธิ์ที่ใช้ได้
-- ---------------------------------------------------------------------
create function public.get_my_profile()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when c.user_id is null then null else jsonb_build_object(
    'user_id', c.user_id,
    'member_id', c.member_id,
    'role', c.role,
    'scope', c.scope,
    'department', c.department,
    'email', (select email from public.user_account where user_id = c.user_id),
    'can_view_dashboard',
      private.flag_is('DASHBOARD', 'ENABLED_READ_ONLY')
      and private.flag_is('DASHBOARD:' || c.role::text, 'ENABLED_READ_ONLY'),
    'can_create_invite',
      private.flag_is('INVITE_CREATION', 'ENABLED_CONTROLLED') and c.scope = 'PROJECT',
    'readable_modules', coalesce((
      select jsonb_agg(substr(f.key, 6) order by f.key)
      from public.feature_flag f
      where f.key like 'READ:%' and f.state = 'ENABLED_READ_ONLY'
        and (c.scope in ('PROJECT', 'DEPARTMENT') or f.key = 'READ:TASK')
        and (f.key <> 'READ:EVALUATION' or c.scope = 'PROJECT')
    ), '[]'::jsonb),
    'writable_modules', coalesce((
      select jsonb_agg(substr(f.key, 7) order by f.key)
      from public.feature_flag f
      where f.key like 'WRITE:%' and f.state = 'ENABLED' and c.scope in ('PROJECT', 'DEPARTMENT')
    ), '[]'::jsonb)
  ) end
  from (select 1) dummy
  left join private.current_ctx() c on true
$$;

-- เรียกทุกครั้งหลัง login สำเร็จ:
--   * ผูกบัญชีที่ผู้ดูแลสร้างไว้ล่วงหน้าด้วยอีเมล (google_sub ยังว่าง) กับบัญชี Google นี้
--   * บันทึกเวลาเข้าสู่ระบบล่าสุด
create function public.session_login()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if private.session_sub() is null or private.session_email() is null then
    return;
  end if;
  update public.user_account
     set google_sub = private.session_sub()
   where google_sub is null
     and email = private.session_email()
     and not exists (select 1 from public.user_account where google_sub = private.session_sub());
  update public.user_account
     set last_login = now()
   where google_sub = private.session_sub();
end
$$;

-- ---------------------------------------------------------------------
-- 3) Dashboard KPI — READ-ONLY
--   * STABLE: Postgres ไม่อนุญาตให้ฟังก์ชัน STABLE เขียนข้อมูล → เขียนกลับไม่ได้โดยโครงสร้าง
--   * SECURITY INVOKER: อ่านผ่าน RLS ของผู้เรียก → HEAD เห็นเฉพาะฝ่ายตนโดยอัตโนมัติ
-- ---------------------------------------------------------------------

-- งานนี้มีหลักฐานหรือไม่ (จับคู่ตรง task_id เท่านั้น) — คืนค่า true/false เท่านั้น
-- ไม่เปิดเผยรายละเอียดหลักฐานฝ่ายอื่น และตอบเฉพาะงานที่ผู้เรียกมีสิทธิ์เห็น
create function private.task_has_evidence(p_task_id text, p_task_department text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when private.my_scope() = 'PROJECT'
      or (private.my_scope() = 'DEPARTMENT' and p_task_department = private.my_department())
    then exists (select 1 from public.evidence e where e.task_id = p_task_id)
  end
$$;
grant execute on function private.task_has_evidence(text, text) to app_user;

-- วันที่ปัจจุบันตามเขตเวลาของโครงการ (app_setting อ่านตรงจากเว็บไม่ได้ จึงผ่านฟังก์ชันนี้)
create function private.project_today()
returns date
language sql stable security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select value from public.app_setting where key = 'timezone'), 'Asia/Bangkok'))::date
$$;
grant execute on function private.project_today() to app_user;

create function public.get_dashboard(p_today date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_role public.app_role := private.my_role();
  v_scope text := private.my_scope();
  v_today date := coalesce(p_today, private.project_today());
  v_result jsonb;
begin
  if v_role is null
     or not private.flag_is('DASHBOARD', 'ENABLED_READ_ONLY')
     or not private.flag_is('DASHBOARD:' || v_role::text, 'ENABLED_READ_ONLY') then
    raise exception 'ยังไม่เปิดสิทธิ์ดู Dashboard สำหรับบทบาทนี้' using errcode = '42501';
  end if;

  with
  t as (
    select id, name, department, status,
           case when due_date is not null then due_date - v_today end as remaining_days
    from public.task
  ),
  t_open as (
    select * from t where status not in ('เสร็จสิ้น', 'ยกเลิก') and remaining_days is not null
  ),
  task_kpi as (
    select count(*) as total,
           count(*) filter (where status = 'กำลังดำเนินการ') as in_progress,
           count(*) filter (where status = 'เสร็จสิ้น') as done,
           count(*) filter (where status = 'ยกเลิก') as cancelled
    from t
  ),
  d as (select id, name, department, status from public.document),
  budget_kpi as (
    select coalesce(sum(initial_budget), 0) as initial_budget,
           coalesce(sum(actual_cost), 0) as actual_cost
    from public.budget
  )
  select jsonb_build_object(
    'scope', case when v_scope = 'PROJECT' then 'PROJECT' else 'DEPARTMENT:' || private.my_department() end,
    'today', v_today,
    'tasks', (
      select jsonb_build_object(
        'total', k.total,
        'in_progress', k.in_progress,
        'done', k.done,
        'cancelled', k.cancelled,
        'overdue', (select count(*) from t_open where remaining_days < 0),
        'due_soon', (select count(*) from t_open where remaining_days between 0 and 3),
        'success_rate', round(k.done::numeric / nullif(k.total - k.cancelled, 0), 4),
        'overdue_list', coalesce((
          select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department,
                                              'status', status, 'remaining_days', remaining_days)
                           order by remaining_days, id)
          from t_open where remaining_days < 0), '[]'::jsonb),
        'due_soon_list', coalesce((
          select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department,
                                              'status', status, 'remaining_days', remaining_days)
                           order by remaining_days, id)
          from t_open where remaining_days between 0 and 3), '[]'::jsonb)
      )
      from task_kpi k
    ),
    'documents', jsonb_build_object(
      'total', (select count(*) from d),
      'pending_approval', (select count(*) from d where status = 'รออนุมัติ'),
      'pending_review', (select count(*) from d where status = 'รอตรวจ'),
      'tracking', coalesce((
        select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department, 'status', status) order by id)
        from d where status in ('ร่าง', 'ต้องแก้ไข', 'รอตรวจ', 'รออนุมัติ')), '[]'::jsonb)
    ),
    'letters', jsonb_build_object(
      'total', (select count(*) from public.letter),
      'awaiting_reply', (select count(*) from public.letter where status = 'ส่งแล้ว-รอตอบรับ')
    ),
    'risks', (
      select jsonb_build_object(
        'total', count(*),
        'closed', count(*) filter (where status in ('แก้ไขเสร็จสิ้น', 'ปิดประเด็น')),
        'open', count(*) filter (where status not in ('แก้ไขเสร็จสิ้น', 'ปิดประเด็น')))
      from public.risk_issue
    ),
    'evidence', (
      select jsonb_build_object(
        'done_without_evidence', count(*),
        'done_without_evidence_list', coalesce(
          jsonb_agg(jsonb_build_object('id', id, 'name', name, 'department', department) order by id), '[]'::jsonb))
      from t
      where status = 'เสร็จสิ้น'
        and private.flag_is('READ:EVIDENCE', 'ENABLED_READ_ONLY')
        and private.task_has_evidence(id, department) is false
    ),
    'registrations', (
      select jsonb_build_object('total', count(*), 'checked_in', count(*) filter (where status = 'เช็คอินแล้ว'))
      from public.registration
    ),
    'budget', (
      select jsonb_build_object('initial_budget', initial_budget, 'actual_cost', actual_cost,
                                'remaining', initial_budget - actual_cost)
      from budget_kpi
    ),
    'team', jsonb_build_object(
      'active', (select count(*) from public.member where work_status = 'ปฏิบัติหน้าที่')
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------
-- 4) Invite (ENABLED_CONTROLLED)
-- ---------------------------------------------------------------------
create function private.sha256_hex(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;

create function private.normalize_invite_code(p_code text)
returns text
language sql immutable
set search_path = ''
as $$
  select regexp_replace(upper(coalesce(p_code, '')), '[^0-9A-Z]', '', 'g')
$$;

create function public.create_invite(p_member_id text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me text := private.my_user_id();
  v_member public.member;
  v_code text;
  v_ttl int := coalesce((select value::int from public.app_setting where key = 'invite_ttl_days'), 7);
  v_expires timestamptz := now() + make_interval(days => v_ttl);
  v_revoked text[];
  v_invite_id text;
begin
  if not private.flag_is('INVITE_CREATION', 'ENABLED_CONTROLLED') then
    raise exception 'ยังไม่เปิดการสร้าง invite' using errcode = '42501';
  end if;
  if private.my_scope() is distinct from 'PROJECT' then
    raise exception 'ไม่มีสิทธิ์สร้าง invite' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('registration'));

  select * into v_member from public.member where id = p_member_id;
  if not found then
    raise exception 'ไม่พบสมาชิก %', p_member_id using errcode = 'P0002';
  end if;
  if v_member.work_status <> 'ปฏิบัติหน้าที่' then
    raise exception 'สมาชิกไม่อยู่ในสถานะปฏิบัติหน้าที่' using errcode = '22023';
  end if;
  if not exists (select 1 from public.position_role where position = v_member.position) then
    raise exception 'ตำแหน่งของสมาชิกไม่ตรงกับบทบาทที่รองรับ' using errcode = '22023';
  end if;
  if v_member.student_id is null then
    raise exception 'สมาชิกยังไม่มีรหัสนักศึกษา' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_account where member_id = p_member_id) then
    raise exception 'สมาชิกนี้มีบัญชีผู้ใช้แล้ว' using errcode = '23505';
  end if;

  -- คง invite ACTIVE ไว้ได้ 1 อัน: ยกเลิกอันเดิม
  with r as (
    update public.invite set status = 'REVOKED'
     where member_id = p_member_id and status = 'ACTIVE'
    returning invite_id
  )
  select array_agg(invite_id) into v_revoked from r;

  -- 128 bit จาก gen_random_uuid() สองตัว (ส่วนสุ่ม 122 bit ต่อตัว)
  v_code := upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 32));

  insert into public.invite (member_id, code_hash, status, created_by, expires_at)
  values (p_member_id, private.sha256_hex(v_code), 'ACTIVE', v_me, v_expires)
  returning invite_id into v_invite_id;

  perform private.write_audit(
    'INVITE_CREATE', 'invite', v_invite_id,
    case when v_revoked is not null then jsonb_build_object('revoked', v_revoked) end,
    jsonb_build_object('invite_id', v_invite_id, 'member_id', p_member_id, 'status', 'ACTIVE', 'expires_at', v_expires),
    'สร้าง invite (เก็บเฉพาะ hash)');

  -- code แสดงครั้งเดียว ไม่ถูกเก็บที่ใด
  return jsonb_build_object(
    'invite_id', v_invite_id,
    'member_id', p_member_id,
    'code', regexp_replace(v_code, '(.{4})(?!$)', '\1-', 'g'),
    'expires_at', v_expires);
end
$$;

create function public.revoke_invite(p_invite_id text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if private.my_scope() is distinct from 'PROJECT' then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  update public.invite set status = 'REVOKED' where invite_id = p_invite_id and status = 'ACTIVE';
  if found then
    perform private.write_audit('INVITE_REVOKE', 'invite', p_invite_id,
      jsonb_build_object('status', 'ACTIVE'), jsonb_build_object('status', 'REVOKED'));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4) Self-registration — Contract V1.1 (ENABLED_CONTROLLED)
--   * อีเมลจาก session ที่ server ตรวจกับ Google แล้ว (ไคลเอนต์กำหนดไม่ได้)
--   * จับคู่ด้วย รหัสนักศึกษา + invite code
--   * บทบาทจากตำแหน่งใน MEMBER
--   * ตรวจซ้ำทั้งหมดใต้ lock ก่อนบันทึก
--   * ล้มเหลว → ข้อความกลาง ๆ, สำเร็จ → audit log
-- ---------------------------------------------------------------------
create function public.register_self(p_student_id text, p_invite_code text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c_generic constant text := 'ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูลอีกครั้งหรือติดต่อผู้ดูแลระบบ';
  v_sub text := private.session_sub();
  v_email text := private.session_email();
  v_domains text[];
  v_max int := coalesce((select value::int from public.app_setting where key = 'register_max_attempts'), 5);
  v_window int := coalesce((select value::int from public.app_setting where key = 'register_window_minutes'), 15);
  v_student text := btrim(coalesce(p_student_id, ''));
  v_code text := private.normalize_invite_code(p_invite_code);
  v_member public.member;
  v_matches int;
  v_role public.app_role;
  v_invite public.invite;
  v_user_id text;
  v_reason text;
begin
  if v_sub is null then
    return jsonb_build_object('ok', false, 'message', c_generic);
  end if;

  -- ทุกคำขอ serialize ที่นี่ (เทียบเท่า document lock)
  perform pg_advisory_xact_lock(hashtext('registration'));

  <<checks>>
  begin
    if not private.flag_is('SELF_REGISTRATION', 'ENABLED_CONTROLLED') then
      v_reason := 'feature disabled'; exit checks;
    end if;

    if (select count(*) from public.registration_attempt
         where google_sub = v_sub and not success
           and attempted_at > now() - make_interval(mins => v_window)) >= v_max then
      v_reason := 'rate limited'; exit checks;
    end if;

    if v_email is null then
      v_reason := 'no session email'; exit checks;
    end if;

    select array_agg(lower(btrim(d))) into v_domains
      from unnest(string_to_array((select value from public.app_setting where key = 'allowed_email_domains'), ',')) d
     where btrim(d) <> '';
    if v_domains is null or not (split_part(v_email, '@', 2) = any (v_domains)) then
      v_reason := 'email domain not allowed'; exit checks;
    end if;

    if v_student = '' or length(v_code) <> 32 then
      v_reason := 'malformed input'; exit checks;
    end if;

    if exists (select 1 from public.user_account where email = v_email or google_sub = v_sub) then
      v_reason := 'account already exists'; exit checks;
    end if;

    select count(*) into v_matches from public.member where student_id = v_student;
    if v_matches <> 1 then
      v_reason := 'student id not found'; exit checks;
    end if;
    select * into v_member from public.member where student_id = v_student;

    if v_member.work_status <> 'ปฏิบัติหน้าที่' then
      v_reason := 'member not active'; exit checks;
    end if;

    select role into v_role from public.position_role where position = v_member.position;
    if v_role is null then
      v_reason := 'position not mapped'; exit checks;
    end if;

    if exists (select 1 from public.user_account where member_id = v_member.id) then
      v_reason := 'member already linked'; exit checks;
    end if;

    select * into v_invite from public.invite
     where member_id = v_member.id and status = 'ACTIVE'
     for update;
    if not found then
      v_reason := 'no active invite'; exit checks;
    end if;
    if v_invite.code_hash <> private.sha256_hex(v_code) then
      v_reason := 'invite mismatch'; exit checks;
    end if;
    if v_invite.expires_at < now() then
      v_reason := 'invite expired'; exit checks;
    end if;
  end checks;

  if v_reason is not null then
    insert into public.registration_attempt (google_sub, success, reason) values (v_sub, false, v_reason);
    raise log 'register_self rejected: % (sub=%)', v_reason, v_sub;
    return jsonb_build_object('ok', false, 'message', c_generic);
  end if;

  -- ---- บันทึกจริง ----
  insert into public.user_account (member_id, google_sub, email, role, account_status)
  values (v_member.id, v_sub, v_email, v_role, 'ACTIVE')
  returning user_id into v_user_id;

  update public.invite
     set status = 'USED', used_date = now(), used_by_user_id = v_user_id
   where invite_id = v_invite.invite_id;

  insert into public.registration_attempt (google_sub, success, reason) values (v_sub, true, null);

  perform private.write_audit(
    'SELF_REGISTER', 'user_account', v_user_id, null,
    jsonb_build_object('user_id', v_user_id, 'member_id', v_member.id, 'email', v_email,
                       'role', v_role, 'account_status', 'ACTIVE'),
    'invite ' || v_invite.invite_id || ' → USED',
    v_user_id);

  return jsonb_build_object('ok', true, 'message', 'ลงทะเบียนสำเร็จ', 'user_id', v_user_id, 'role', v_role);
end
$$;

-- ---------------------------------------------------------------------
-- ผู้ดูแลระบบคนแรก — รันใน SQL Editor เท่านั้น (ไม่เปิดให้เว็บเรียก)
-- บัญชีจะผูกกับ Google อัตโนมัติเมื่อเจ้าของอีเมลนี้ login ครั้งแรก
-- ---------------------------------------------------------------------
create function private.bootstrap_admin(p_email text, p_member_id text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user_id text;
begin
  insert into public.user_account (member_id, google_sub, email, role, account_status)
  values (p_member_id, null, lower(btrim(p_email)), 'ADMIN', 'ACTIVE')
  returning user_id into v_user_id;
  perform private.write_audit('BOOTSTRAP_ADMIN', 'user_account', v_user_id, null,
    jsonb_build_object('user_id', v_user_id, 'member_id', p_member_id, 'email', lower(btrim(p_email)), 'role', 'ADMIN'),
    null, 'SYSTEM');
  return v_user_id;
end
$$;
revoke all on function private.bootstrap_admin(text, text) from public, app_user;

-- ---------------------------------------------------------------------
-- หลัง import ข้อมูลที่มีรหัสเดิม: เลื่อน sequence ให้เลยรหัสมากสุด
-- ---------------------------------------------------------------------
create function private.sync_id_sequences()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r record;
  v_max bigint;
begin
  for r in
    select * from (values
      ('private.task_id_seq', 'public.task', 'id', 'T'),
      ('private.document_id_seq', 'public.document', 'id', 'D'),
      ('private.letter_id_seq', 'public.letter', 'id', 'L'),
      ('private.registration_id_seq', 'public.registration', 'id', 'R'),
      ('private.budget_id_seq', 'public.budget', 'id', 'B'),
      ('private.risk_id_seq', 'public.risk_issue', 'id', 'RI'),
      ('private.evidence_id_seq', 'public.evidence', 'id', 'E'),
      ('private.member_id_seq', 'public.member', 'id', 'M'),
      ('private.user_id_seq', 'public.user_account', 'user_id', 'U'),
      ('private.evq_id_seq', 'public.evaluation_question', 'question_id', 'EVQ'),
      ('private.ev_id_seq', 'public.evaluation_response', 'response_id', 'EV'),
      ('private.audit_id_seq', 'public.audit_log', 'audit_id', 'A'),
      ('private.invite_id_seq', 'public.invite', 'invite_id', 'INV')
    ) as t(seq, tbl, col, prefix)
  loop
    execute format('select max(substr(%I, %s)::bigint) from %s', r.col, length(r.prefix) + 1, r.tbl) into v_max;
    if v_max is not null then
      perform setval(r.seq::regclass, v_max);
    end if;
  end loop;
end
$$;
revoke all on function private.sync_id_sequences() from public, app_user;

-- ---------------------------------------------------------------------
-- สิทธิ์เรียก RPC
-- ---------------------------------------------------------------------
revoke all on function public.get_my_profile(), public.session_login(), public.get_dashboard(date),
  public.create_invite(text), public.revoke_invite(text), public.register_self(text, text)
from public;
grant execute on function public.get_my_profile(), public.session_login(), public.get_dashboard(date),
  public.create_invite(text), public.revoke_invite(text), public.register_self(text, text)
to app_user;
