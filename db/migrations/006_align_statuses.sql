-- =====================================================================
-- ปรับค่าสถานะให้ตรงกับ dropdown ในไฟล์ FT20_CONTROL_CENTER (ตรงตัวอักษร)
-- และแยก "สถานะเช็คอิน" ออกจาก "สถานะการลงทะเบียน" ตามชีท REGISTRATION
-- เปลี่ยนชื่อค่าด้วย update → ข้อมูลที่อ้างถึงเปลี่ยนตาม (on update cascade)
-- =====================================================================

-- ---------- ตัวช่วย: เปลี่ยนชื่อค่าสถานะ (ถ้าค่าใหม่มีอยู่แล้ว ย้ายข้อมูลแล้วลบค่าเดิม) ----------
create function private.rename_status(p_entity text, p_old text, p_new text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.status_option where entity = p_entity and value = p_old) then
    return;
  end if;
  if exists (select 1 from public.status_option where entity = p_entity and value = p_new) then
    raise exception 'status % already exists for %', p_new, p_entity;
  end if;
  update public.status_option set value = p_new where entity = p_entity and value = p_old;
end
$$;

-- ลบค่าสถานะที่ไม่อยู่ในรายการ (เฉพาะที่ไม่มีข้อมูลอ้างถึง — ถ้ามีจะ error ให้แก้ข้อมูลก่อน)
create function private.keep_only_statuses(p_entity text, p_values text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  i int;
begin
  delete from public.status_option where entity = p_entity and not (value = any (p_values));
  for i in 1 .. array_length(p_values, 1) loop
    insert into public.status_option (entity, value, sort_order) values (p_entity, p_values[i], i)
    on conflict (entity, value) do update set sort_order = excluded.sort_order;
  end loop;
end
$$;

-- ---------- MEMBER ----------
select private.rename_status('MEMBER', 'พ้นสภาพ', 'พ้นสภาพ/ลาออก');
select private.keep_only_statuses('MEMBER', array['ปฏิบัติหน้าที่', 'พักการปฏิบัติหน้าที่', 'พ้นสภาพ/ลาออก']);

-- ---------- TASK ----------
select private.keep_only_statuses('TASK', array['ยังไม่เริ่ม', 'กำลังดำเนินการ', 'รอดำเนินการ', 'เสร็จสิ้น', 'ล่าช้า', 'ยกเลิก']);

-- ---------- DOCUMENT ----------
select private.keep_only_statuses('DOCUMENT', array['ร่าง', 'รอตรวจ', 'รออนุมัติ', 'อนุมัติแล้ว', 'ต้องแก้ไข', 'ยกเลิก']);

-- ---------- LETTER ----------
select private.rename_status('LETTER', 'ร่าง', 'รอส่ง');
select private.rename_status('LETTER', 'ได้รับตอบรับแล้ว', 'ตอบรับแล้ว');
alter table public.letter alter column status set default 'รอส่ง';
select private.keep_only_statuses('LETTER', array['รอส่ง', 'ส่งแล้ว-รอตอบรับ', 'ตอบรับแล้ว', 'ปฏิเสธ', 'ไม่ต้องตอบรับ']);

-- ---------- RISK ----------
select private.rename_status('RISK', 'เปิดประเด็น', 'ยังไม่แก้ไข');
alter table public.risk_issue alter column status set default 'ยังไม่แก้ไข';
select private.keep_only_statuses('RISK', array['ยังไม่แก้ไข', 'กำลังแก้ไข', 'รอติดตามผล', 'แก้ไขเสร็จสิ้น', 'ปิดประเด็น']);

-- ---------- REGISTRATION: สถานะการลงทะเบียน + สถานะเช็คอิน ----------
insert into public.status_option (entity, value, sort_order) values
  ('REGISTRATION_CHECKIN', 'ยังไม่เช็คอิน', 1),
  ('REGISTRATION_CHECKIN', 'เช็คอินแล้ว', 2),
  ('REGISTRATION_CHECKIN', 'ขาดการเข้าร่วม', 3);

alter table public.registration
  add column checkin_status text not null default 'ยังไม่เช็คอิน',
  add column checkin_entity text not null default 'REGISTRATION_CHECKIN' check (checkin_entity = 'REGISTRATION_CHECKIN'),
  add foreign key (checkin_entity, checkin_status) references public.status_option (entity, value) on update cascade;

-- ข้อมูลเดิมที่ใช้ "เช็คอินแล้ว" เป็นสถานะการลงทะเบียน → ย้ายไปช่องสถานะเช็คอิน
insert into public.status_option (entity, value, sort_order) values ('REGISTRATION', 'ลงทะเบียนสำเร็จ', 1)
on conflict (entity, value) do nothing;
update public.registration set checkin_status = 'เช็คอินแล้ว' where status = 'เช็คอินแล้ว';
update public.registration set status = 'ลงทะเบียนสำเร็จ' where status in ('เช็คอินแล้ว', 'ลงทะเบียนแล้ว');
select private.rename_status('REGISTRATION', 'ยกเลิก', 'ยกเลิกสิทธิ์');
alter table public.registration alter column status set default 'ลงทะเบียนสำเร็จ';
select private.keep_only_statuses('REGISTRATION', array['ลงทะเบียนสำเร็จ', 'ยืนยันสิทธิ์', 'ยกเลิกสิทธิ์']);

-- ---------- Dashboard: เช็คอินแล้ว = สถานะเช็คอิน "เช็คอินแล้ว" ----------
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
