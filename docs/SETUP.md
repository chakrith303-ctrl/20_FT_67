# คู่มือติดตั้ง (สำหรับผู้ดูแลโครงการ)

ทุกขั้นตอนใช้บริการแบบฟรีทั้งหมด ใช้เวลาประมาณ 30–45 นาที

> **ห้ามส่งค่าต่อไปนี้ให้ใคร (รวมถึงในแชท):** รหัสผ่านฐานข้อมูล, `service_role` key, Google Client Secret
> ค่าที่เปิดเผยได้: Project URL และ `anon` (publishable) key

---

## ขั้นที่ A — สร้างโปรเจกต์ Supabase

1. ไปที่ https://supabase.com → **Start your project** → สมัครด้วยบัญชี GitHub หรืออีเมล
2. **New project**
   - Name: เช่น `project-ft67`
   - Database Password: กด **Generate** แล้ว **เก็บไว้ในที่ปลอดภัย**
   - Region: **Southeast Asia (Singapore)**
   - Plan: **Free**
3. รอประมาณ 2 นาทีให้โปรเจกต์พร้อม

## ขั้นที่ B — สร้างตารางและระบบสิทธิ์

1. เมนูซ้าย **SQL Editor** → **New query**
2. เปิดไฟล์ในโฟลเดอร์ `supabase/migrations/` **ทีละไฟล์ตามลำดับ** คัดลอกทั้งไฟล์มาวาง แล้วกด **Run**
   1. `20260923000001_schema.sql`
   2. `20260923000002_security.sql`
   3. `20260923000003_functions.sql`

   แต่ละไฟล์ต้องขึ้น `Success. No rows returned` ถ้าขึ้น error ให้หยุดแล้วส่งข้อความ error มา
3. ตั้งโดเมนอีเมลขององค์กร (ผู้ที่ไม่ได้ใช้โดเมนนี้จะสมัครไม่ได้) — New query แล้วรัน:
   ```sql
   update public.app_setting set value = 'โดเมนของคุณ เช่น kmutt.ac.th' where key = 'allowed_email_domains';
   ```
4. ตรวจรายการสถานะที่ระบบยอมรับ (ต้องตรงกับที่ใช้ในชีทจริงทุกตัวอักษร):
   ```sql
   select entity, value from public.status_option order by entity, sort_order;
   ```
   ถ้าชีทจริงมีสถานะอื่น (เช่น "รอดำเนินการ") ให้แจ้งมา หรือเพิ่มเอง:
   ```sql
   insert into public.status_option (entity, value, sort_order) values ('TASK', 'รอดำเนินการ', 5);
   ```

## ขั้นที่ C — ปิดการสมัครด้วยอีเมล/รหัสผ่าน

ระบบนี้ให้ login ด้วย Google เท่านั้น

1. **Authentication → Sign In / Providers**
2. **Email**: ปิด (Disable)
3. **Authentication → Settings** (หรือ Sign In / Providers → User Signups): ตรวจว่า **Allow new users to sign up** ยังเปิดอยู่
   (ต้องเปิด เพื่อให้คนที่ login ด้วย Google ครั้งแรกมีตัวตน — แต่เขาจะยัง **ไม่มีสิทธิ์ใด ๆ** จนกว่าจะสมัครด้วย invite)

## ขั้นที่ D — Google Login (Google Cloud Console)

1. ไปที่ https://console.cloud.google.com → ด้านบนเลือก **Select a project → New Project** → ตั้งชื่อ → Create
2. เมนู **APIs & Services → OAuth consent screen** (หรือ **Google Auth Platform → Branding**)
   - App name: ชื่อโครงการ, User support email: อีเมลของคุณ
   - Audience / User type:
     - ถ้าอีเมลองค์กรเป็น Google Workspace ให้เลือก **Internal** (คนนอกองค์กร login ไม่ได้เลย)
     - ถ้าเลือก Internal ไม่ได้ ให้เลือก **External** แล้วกด **Publish app** (ระบบจะกันคนนอกโดเมนด้วยค่า `allowed_email_domains` อยู่แล้ว)
   - Scopes: ใช้ค่าเริ่มต้น (`email`, `profile`, `openid`) ไม่ต้องเพิ่ม
3. เมนู **Clients** (หรือ **Credentials → Create credentials → OAuth client ID**)
   - Application type: **Web application**
   - Authorized redirect URIs: ใส่
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (ค่า `<project-ref>` ดูได้จาก Supabase → **Project Settings → General → Project ID**)
   - Create → คัดลอก **Client ID** และ **Client Secret**
4. กลับไป Supabase → **Authentication → Sign In / Providers → Google** → เปิดใช้ → วาง Client ID / Client Secret → Save

## ขั้นที่ E — ส่งข้อมูลให้ผู้พัฒนา (สำหรับขั้นย้ายข้อมูล)

ส่งมาเฉพาะ **แถวหัวคอลัมน์** และตัวอย่าง 2–3 แถว **ที่ลบข้อมูลส่วนตัวแล้ว** (เปลี่ยนชื่อ/รหัสนักศึกษาเป็นค่าสมมติ) ของชีท:
TASK_MASTER, DOCUMENT, LETTER_TRACKER, REGISTRATION, BUDGET, RISK_ISSUE, EVIDENCE, MEMBER, EVALUATION_QUESTION, EVALUATION_RESPONSE

และตอบคำถาม:
1. คอลัมน์ "ผู้รับผิดชอบหลัก/ร่วม" ใน TASK_MASTER ใส่เป็น **รหัสสมาชิก** (M003) หรือ **ชื่อคน**
2. "เหลือเวลา" เป็นสูตรที่คำนวณจากคอลัมน์วันครบกำหนดหรือไม่ — คอลัมน์นั้นชื่ออะไร
3. MEMBER มีรหัสนักศึกษาของทุกคนหรือยัง
4. รายชื่อฝ่ายทั้งหมด

## ขั้นที่ F — ผู้ดูแลระบบคนแรก (ทำหลังหน้าเว็บพร้อม)

1. เข้าเว็บแล้ว login ด้วย Google 1 ครั้ง (จะขึ้นว่ายังไม่มีบัญชี — ถูกต้องแล้ว)
2. Supabase → SQL Editor รัน (เปลี่ยนเป็นอีเมลและรหัสสมาชิกของคุณ):
   ```sql
   select private.bootstrap_admin('you@โดเมน', 'M001');
   ```
3. รีเฟรชหน้าเว็บ → จะเข้าได้ในฐานะ ADMIN แล้วสร้าง invite ให้สมาชิกคนอื่นต่อได้

---

## การเปลี่ยน Feature Flag (ต้องผ่านการอนุมัติ)

แก้ได้เฉพาะใน SQL Editor เท่านั้น (API แก้ไม่ได้) และทุกการเปลี่ยนถูกบันทึกใน `audit_log` อัตโนมัติ:
```sql
update public.feature_flag set state = 'ENABLED', note = 'อนุมัติโดย ... วันที่ ...' where key = 'WRITE:LETTER';
```
หมายเหตุ: ปัจจุบันเปิดเขียนได้เฉพาะ TASK/DOCUMENT ในระดับสิทธิ์ของฐานข้อมูลด้วย — การเปิดโมดูลอื่นต้องเพิ่ม policy
และสิทธิ์คอลัมน์ผ่าน migration ใหม่ด้วย (แค่เปลี่ยน flag ยังเขียนไม่ได้ ซึ่งเป็นการ fail-closed โดยตั้งใจ)
