-- =====================================================================
-- บัญชี ADMIN แยกจากทะเบียนสมาชิก
--   * ADMIN ไม่ต้องมีรหัสสมาชิก (member_id ว่างได้เฉพาะ ADMIN)
--   * รหัส M001… เป็นของสมาชิกตามทะเบียนทั้งหมด
-- =====================================================================

alter table public.user_account alter column member_id drop not null;
alter table public.user_account
  add constraint user_account_member_or_admin check (member_id is not null or role = 'ADMIN');

-- ตัวตนผู้เรียก: ADMIN ที่ไม่มีรหัสสมาชิกใช้งานได้ (ไม่มีฝ่าย, สิทธิ์ระดับโครงการ)
create or replace function private.current_ctx()
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
  left join public.member m on m.id = ua.member_id
  left join public.position_role pr on pr.position = m.position
  cross join lateral (
    select case when ua.role = 'ADMIN' then 'ADMIN'::public.app_role else pr.role end as role
  ) r
  where ua.google_sub = private.session_sub()
    and ua.account_status = 'ACTIVE'
    and (
      (ua.member_id is null and ua.role = 'ADMIN')
      or m.work_status = 'ปฏิบัติหน้าที่'
    )
    and r.role is not null
$$;

-- สร้างบัญชี ADMIN ด้วยอีเมลอย่างเดียว — รันใน SQL Editor เท่านั้น
-- บัญชีจะผูกกับ Google อัตโนมัติเมื่อเจ้าของอีเมล login ครั้งแรก
create function private.bootstrap_admin(p_email text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user_id text;
begin
  insert into public.user_account (member_id, google_sub, email, role, account_status)
  values (null, null, lower(btrim(p_email)), 'ADMIN', 'ACTIVE')
  returning user_id into v_user_id;
  perform private.write_audit('BOOTSTRAP_ADMIN', 'user_account', v_user_id, null,
    jsonb_build_object('user_id', v_user_id, 'email', lower(btrim(p_email)), 'role', 'ADMIN'),
    'ADMIN แยกจากทะเบียนสมาชิก', 'SYSTEM');
  return v_user_id;
end
$$;
revoke all on function private.bootstrap_admin(text) from public, app_user;
