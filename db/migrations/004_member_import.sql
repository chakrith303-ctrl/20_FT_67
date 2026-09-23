-- =====================================================================
-- นำเข้าสมาชิกจาก Google Sheets (ชีท MEMBER) — เฉพาะ ADMIN
--   * ตรวจทุกแถวก่อน ถ้ามีข้อผิดพลาดแม้แถวเดียว = ไม่บันทึกอะไรเลย
--   * dry run (ตรวจสอบอย่างเดียว) เป็นค่าเริ่มต้น
--   * รหัสสมาชิกเดิม = อัปเดต, ใหม่ = เพิ่ม (ไม่ลบใคร)
--   * ทุกแถวที่เปลี่ยนเข้า audit_log ผ่าน trigger + สรุปการนำเข้า 1 รายการ
-- =====================================================================

alter table public.member add column nickname text;

create function public.admin_import_members(
  p_rows jsonb,
  p_create_departments boolean default false,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r record;
  v_old public.member;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_new_depts text[] := '{}';
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_account text;
  v_summary jsonb;
begin
  if private.my_role() is distinct from 'ADMIN' then
    raise exception 'เฉพาะ ADMIN เท่านั้น' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'ไม่มีข้อมูลสมาชิก' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'ข้อมูลมากเกินไป (สูงสุด 2000 แถว)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('registration'));

  for r in
    select t.n,
           btrim(coalesce(t.e ->> 'id', '')) as id,
           nullif(btrim(coalesce(t.e ->> 'student_id', '')), '') as student_id,
           btrim(coalesce(t.e ->> 'full_name', '')) as full_name,
           nullif(btrim(coalesce(t.e ->> 'nickname', '')), '') as nickname,
           btrim(coalesce(t.e ->> 'department', '')) as department,
           btrim(coalesce(t.e ->> 'position', '')) as position,
           btrim(coalesce(t.e ->> 'work_status', '')) as work_status
    from jsonb_array_elements(p_rows) with ordinality as t(e, n)
  loop
    -- ---- ข้อผิดพลาด (ห้ามนำเข้า) ----
    if r.id !~ '^M[0-9]{3,}$' then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'รหัสสมาชิกต้องเป็นรูปแบบ M001');
      continue;
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) x where btrim(x ->> 'id') = r.id) > 1 then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'รหัสสมาชิกซ้ำในข้อมูลที่วาง');
    end if;
    if r.student_id is not null then
      if (select count(*) from jsonb_array_elements(p_rows) x
           where btrim(coalesce(x ->> 'student_id', '')) = r.student_id) > 1 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'รหัสนักศึกษา ' || r.student_id || ' ซ้ำในข้อมูลที่วาง');
      elsif exists (select 1 from public.member m where m.student_id = r.student_id and m.id <> r.id
                      and not exists (select 1 from jsonb_array_elements(p_rows) x
                                       where btrim(x ->> 'id') = m.id
                                         and btrim(coalesce(x ->> 'student_id', '')) is distinct from r.student_id)) then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'รหัสนักศึกษา ' || r.student_id || ' เป็นของสมาชิกคนอื่นในระบบแล้ว');
      end if;
    end if;
    if r.full_name = '' then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'ไม่มีชื่อ');
    end if;
    if r.department = '' then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'ไม่มีฝ่ายหลัก');
    elsif not exists (select 1 from public.department where name = r.department) then
      if p_create_departments then
        if not r.department = any (v_new_depts) then
          v_new_depts := v_new_depts || r.department;
        end if;
      else
        v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'ยังไม่มีฝ่าย "' || r.department || '" ในระบบ');
      end if;
    end if;
    if r.position = '' then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id, 'message', 'ไม่มีบทบาท/ตำแหน่ง');
    end if;
    if not exists (select 1 from public.status_option where entity = 'MEMBER' and value = r.work_status) then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id,
        'message', 'สถานะการทำงาน "' || r.work_status || '" ไม่อยู่ในรายการที่ระบบรองรับ');
    end if;

    select * into v_old from public.member where id = r.id;

    -- กันผู้นำเข้าล็อกตัวเองออกจากระบบ
    if r.id = private.my_member_id() and r.work_status <> 'ปฏิบัติหน้าที่' then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'id', r.id,
        'message', 'แถวนี้เป็นของบัญชีคุณเอง — เปลี่ยนสถานะเป็นอื่นนอกจาก "ปฏิบัติหน้าที่" จะทำให้คุณเข้าระบบไม่ได้');
    end if;

    -- ---- คำเตือน (นำเข้าได้) ----
    if r.position <> '' and not exists (select 1 from public.position_role where position = r.position) then
      v_warnings := v_warnings || jsonb_build_object('row', r.n, 'id', r.id,
        'message', 'ตำแหน่ง "' || r.position || '" ไม่ตรงกับบทบาทที่รองรับ — สมาชิกคนนี้จะเข้าระบบไม่ได้');
    end if;
    if r.student_id is null then
      v_warnings := v_warnings || jsonb_build_object('row', r.n, 'id', r.id,
        'message', 'ไม่มีรหัสนักศึกษา — ยังสร้าง invite / สมัครสมาชิกไม่ได้');
    end if;
    if v_old.id is not null and v_old.full_name is distinct from r.full_name then
      select email into v_account from public.user_account where member_id = r.id;
      if v_account is not null then
        v_warnings := v_warnings || jsonb_build_object('row', r.n, 'id', r.id,
          'message', r.id || ' ผูกกับบัญชี ' || v_account || ' อยู่ — ชื่อจะเปลี่ยนจาก "' || v_old.full_name ||
                     '" เป็น "' || r.full_name || '" (ถ้าเป็นคนละคน ต้องย้ายบัญชีไปยังรหัสที่ถูกต้อง)');
      end if;
    end if;

    if v_old.id is null then
      v_inserted := v_inserted + 1;
    elsif (v_old.full_name, v_old.student_id, v_old.nickname, v_old.department, v_old.position, v_old.work_status)
          is distinct from (r.full_name, r.student_id, r.nickname, r.department, r.position, r.work_status) then
      v_updated := v_updated + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  v_summary := jsonb_build_object(
    'rows', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'new_departments', to_jsonb(v_new_depts),
    'errors', v_errors,
    'warnings', v_warnings);

  if jsonb_array_length(v_errors) > 0 or p_dry_run then
    return v_summary || jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'dry_run', true, 'saved', false);
  end if;

  -- ---- บันทึกจริง ----
  insert into public.department (name) select unnest(v_new_depts) on conflict do nothing;

  -- เคลียร์รหัสนักศึกษาที่กำลังย้ายเจ้าของก่อน (กัน unique ชนกันระหว่างสลับค่า)
  update public.member m
     set student_id = null
   where m.student_id is not null
     and exists (select 1 from jsonb_array_elements(p_rows) x
                  where btrim(x ->> 'id') = m.id
                    and nullif(btrim(coalesce(x ->> 'student_id', '')), '') is distinct from m.student_id);

  insert into public.member (id, full_name, student_id, nickname, department, position, work_status)
  select btrim(e ->> 'id'),
         btrim(coalesce(e ->> 'full_name', '')),
         nullif(btrim(coalesce(e ->> 'student_id', '')), ''),
         nullif(btrim(coalesce(e ->> 'nickname', '')), ''),
         btrim(coalesce(e ->> 'department', '')),
         btrim(coalesce(e ->> 'position', '')),
         btrim(coalesce(e ->> 'work_status', ''))
  from jsonb_array_elements(p_rows) e
  on conflict (id) do update set
    full_name = excluded.full_name,
    student_id = excluded.student_id,
    nickname = excluded.nickname,
    department = excluded.department,
    position = excluded.position,
    work_status = excluded.work_status
  where (public.member.full_name, public.member.student_id, public.member.nickname,
         public.member.department, public.member.position, public.member.work_status)
        is distinct from
        (excluded.full_name, excluded.student_id, excluded.nickname,
         excluded.department, excluded.position, excluded.work_status);

  perform private.sync_id_sequences();

  perform private.write_audit('MEMBER_IMPORT', 'member', null, null,
    jsonb_build_object('rows', jsonb_array_length(p_rows), 'inserted', v_inserted, 'updated', v_updated,
                       'new_departments', to_jsonb(v_new_depts)),
    'นำเข้าสมาชิกจาก Google Sheets');

  return v_summary || jsonb_build_object('ok', true, 'dry_run', false, 'saved', true);
end
$$;

revoke all on function public.admin_import_members(jsonb, boolean, boolean) from public;
grant execute on function public.admin_import_members(jsonb, boolean, boolean) to app_user;
