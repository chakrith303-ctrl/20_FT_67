-- =====================================================================
-- 7) ปรับรายชื่อฝ่ายให้เหลือ 7 ฝ่ายตามโครงสร้างใหม่
-- 8) สิทธิ์ TASK ใหม่:
--    * HEAD/เลขา อ่าน "งาน" (TASK) ข้ามฝ่ายได้ (อ่านอย่างเดียว) — โมดูลอื่นยังจำกัดเฉพาะฝ่ายตนเหมือนเดิม
--    * MEMBER ดูรายการงานทั้งฝ่ายตนได้ (ไม่ใช่แค่ที่ตนรับผิดชอบ) และ
--      เพิ่ม/แก้ไข/ลบ ได้เฉพาะงานที่ตนเป็นผู้รับผิดชอบหลักหรือร่วมเท่านั้น
-- =====================================================================

-- ---------------------------------------------------------------------
-- ฝ่าย: เหลือเฉพาะ 7 ฝ่ายนี้ (ลบฝ่ายอื่นได้เฉพาะที่ไม่มีข้อมูลผูกอยู่)
-- ---------------------------------------------------------------------
create function private.keep_only_departments(p_names text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.department d
    where not (d.name = any (p_names))
      and (
        exists (select 1 from public.member m where m.department = d.name)
        or exists (select 1 from public.task t where t.department = d.name)
        or exists (select 1 from public.document doc where doc.department = d.name)
        or exists (select 1 from public.letter l where l.department = d.name)
        or exists (select 1 from public.budget b where b.department = d.name)
        or exists (select 1 from public.risk_issue ri where ri.department = d.name)
        or exists (select 1 from public.evidence e where e.department = d.name)
      )
  ) then
    raise exception 'มีข้อมูลผูกกับฝ่ายที่จะลบอยู่ — ย้ายข้อมูลก่อนแก้รายชื่อฝ่าย' using errcode = '23503';
  end if;
  delete from public.department where not (name = any (p_names));
  insert into public.department (name) select unnest(p_names) on conflict do nothing;
end
$$;

select private.keep_only_departments(array[
  'ฝ่ายอำนวยการ/ประธานโครงการ',
  'ฝ่ายพิธีการและงานลงทะเบียน',
  'ฝ่ายนิทรรศการและสื่อ Infographic',
  'ฝ่ายสถานที่ และประชาสัมพันธ์สื่อดิจิทัล',
  'ฝ่ายธุรการและงานประเมิน',
  'ฝ่ายสวัสดิการและงานบริการ',
  'ฝ่ายวิชาการและการทดสอบ'
]);

-- ---------------------------------------------------------------------
-- MEMBER เขียนงานของตัวเองได้: เจ้าของหลักหรือผู้รับผิดชอบร่วม + ฝ่ายตน + flag เปิด
-- ---------------------------------------------------------------------
create function private.can_write_own_task(p_department text, p_owner_main_id text, p_co_owner_ids text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.flag_is('WRITE:TASK', 'ENABLED')
     and private.my_scope() = 'SELF'
     and p_department = private.my_department()
     and (p_owner_main_id = private.my_member_id() or private.my_member_id() = any (p_co_owner_ids))
$$;

grant execute on function private.can_write_own_task(text, text, text[]) to app_user;

-- ---------------------------------------------------------------------
-- TASK: อ่าน — ฝ่ายตน (PROJECT/DEPARTMENT ปกติ) + MEMBER เห็นทั้งฝ่ายตน + HEAD/เลขา เห็นข้ามฝ่ายได้ (อ่านอย่างเดียว)
-- ---------------------------------------------------------------------
drop policy task_read on public.task;
create policy task_read on public.task for select to app_user
  using (
    (select private.can_read_dept('TASK', department))
    or (
      (select private.flag_is('READ:TASK', 'ENABLED_READ_ONLY'))
      and (
        ((select private.my_scope()) = 'SELF' and department = (select private.my_department()))
        or (select private.my_scope()) = 'DEPARTMENT'
      )
    )
  );

drop policy task_insert on public.task;
create policy task_insert on public.task for insert to app_user
  with check (
    (select private.can_write_dept('TASK', department))
    or (select private.can_write_own_task(department, owner_main_id, co_owner_ids))
  );

drop policy task_update on public.task;
create policy task_update on public.task for update to app_user
  using (
    (select private.can_write_dept('TASK', department))
    or (select private.can_write_own_task(department, owner_main_id, co_owner_ids))
  )
  with check (
    (select private.can_write_dept('TASK', department))
    or (select private.can_write_own_task(department, owner_main_id, co_owner_ids))
  );

-- ลบ: ADMIN ลบได้ทุกงาน (เมื่อเปิด flag) · MEMBER ลบได้เฉพาะงานที่ตนรับผิดชอบหลัก/ร่วม
create policy task_delete on public.task for delete to app_user
  using (
    ((select private.my_role()) = 'ADMIN' and (select private.flag_is('WRITE:TASK', 'ENABLED')))
    or (select private.can_write_own_task(department, owner_main_id, co_owner_ids))
  );

grant delete on public.task to app_user;

-- ---------------------------------------------------------------------
-- โปรไฟล์: MEMBER เห็น TASK อยู่ใน writable_modules ด้วย (เดิมมีแค่ PROJECT/DEPARTMENT scope)
-- ---------------------------------------------------------------------
create or replace function public.get_my_profile()
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
      where f.key like 'WRITE:%' and f.state = 'ENABLED'
        and (c.scope in ('PROJECT', 'DEPARTMENT') or f.key = 'WRITE:TASK')
    ), '[]'::jsonb)
  ) end
  from (select 1) dummy
  left join private.current_ctx() c on true
$$;

-- ---------------------------------------------------------------------
-- Dashboard: ตัวเลขงานของ HEAD/เลขา ยังนับเฉพาะฝ่ายตนเหมือนเดิม
-- (การอ่านรายการงานข้ามฝ่ายเป็นสิทธิ์ใหม่เฉพาะหน้ารายการ ไม่ใช่ KPI สรุปฝ่าย)
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard(p_today date default null)
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
    where v_scope = 'PROJECT' or department = private.my_department()
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
      select jsonb_build_object('total', count(*), 'checked_in', count(*) filter (where checkin_status = 'เช็คอินแล้ว'))
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
