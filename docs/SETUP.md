# คู่มือติดตั้ง (สำหรับผู้ดูแลโครงการ)

ใช้บริการฟรีทั้งหมด: **Supabase** (ฐานข้อมูล) + **Render** (รันเว็บ) + **Google Cloud** (login) + **GitHub Actions** (ปลุกเว็บ)
ใช้เวลาประมาณ 45 นาที ทำตามลำดับ A → G

> **ห้ามส่งค่าต่อไปนี้ให้ใคร (รวมถึงในแชท):** รหัสผ่านฐานข้อมูล / `DATABASE_URL`, Google Client Secret, `SESSION_SECRET`
> ใส่ค่าเหล่านี้ในหน้า Environment ของ Render เท่านั้น

---

## A — ฐานข้อมูล (Supabase)

1. https://supabase.com → **Start your project** → สมัคร (ใช้บัญชี GitHub ได้)
2. **New project**
   - Name: `project-ft67`
   - Database Password: กด **Generate** → **คัดลอกเก็บไว้** (ใช้ในข้อ 4)
   - Region: **Southeast Asia (Singapore)** · Plan: **Free**
3. รอประมาณ 2 นาที
4. กดปุ่ม **Connect** (ด้านบน) → เลือก **Session pooler** → คัดลอก URI
   หน้าตาประมาณ `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
   แทน `[YOUR-PASSWORD]` ด้วยรหัสผ่านจากข้อ 2 (ลบวงเล็บ `[ ]` ด้วย) → นี่คือค่า **`DATABASE_URL`**
   (ต้องใช้ *Session pooler* เพราะ Render ต่อแบบ Direct connection ไม่ได้)
   - รหัสผ่านควรมีแค่ตัวอักษรอังกฤษ + ตัวเลข — อักขระพิเศษ (`@ # / ? %`) ทำให้ URI เพี้ยน
   - ถ้า Render ขึ้น `password authentication failed` → Project Settings → Database → Reset database password
5. ปิดช่องทาง Data API ของ Supabase (ระบบนี้เข้าถึงข้อมูลผ่านเว็บของเราเท่านั้น):
   **Project Settings → Data API** → ปิด **Enable Data API** (ถ้ามีตัวเลือกนี้)
   — ไม่ปิดก็ไม่เป็นไร เพราะฐานข้อมูลถูกตั้งไม่ให้ Data API อ่าน/เขียนอะไรได้อยู่แล้ว

ไม่ต้องสร้างตารางเอง — เว็บจะสร้างให้อัตโนมัติตอนเริ่มทำงานครั้งแรก (ขั้น C)

## B — Google Login (Google Cloud Console)

1. https://console.cloud.google.com → เลือกโปรเจกต์ (ด้านบน) → **APIs & Services → OAuth consent screen**
   (หน้าจะชื่อ **Google Auth Platform**) → Get started
   - App name: `20FT67` · User support email: อีเมลของคุณ
   - Audience: **Internal** ถ้าใช้บัญชี Google Workspace ขององค์กร · **External** ถ้าใช้ Gmail ส่วนตัว
   - Contact information: อีเมลของคุณ → Create
2. ถ้าเป็น External: เมนู **Audience → Test users → Add users** → ใส่อีเมลของคุณเอง
   (ระหว่างยังไม่ publish จะ login ได้เฉพาะ test user)
3. เมนู **Clients → Create client**
   - Application type: **Web application** · Name: `20FT67 web`
   - Authorized redirect URIs: `https://project-ft67.onrender.com/auth/google/callback`
     (ถ้า Render ให้ชื่อเว็บต่างจากนี้ ค่อยกลับมาแก้หลังขั้น C)
   - Create → **คัดลอก Client ID และ Client secret ทันที** (secret อาจแสดงครั้งเดียว)
4. **ทำหลังขั้น C** (ต้องมีเว็บก่อน) — เปิดให้ทุกคนในองค์กร login ได้ (เฉพาะ External):
   - เมนู **Branding**:
     - App home page: `https://<ชื่อเว็บ>.onrender.com`
     - Application privacy policy link: `https://<ชื่อเว็บ>.onrender.com/privacy.html`
     - Authorized domains → Add domain: `<ชื่อเว็บ>.onrender.com`
     - Save
   - เมนู **Audience → Publish app → Confirm** → สถานะต้องเป็น **In production**

## C — รันเว็บ (Render)

1. https://render.com → สมัครด้วยบัญชี GitHub → อนุญาตให้เข้าถึง repo `20_FT_67`
2. **New → Blueprint** → เลือก repo `20_FT_67` → Render อ่านไฟล์ `render.yaml` ให้เอง
3. กรอกค่าที่ Render ถาม:

   | ค่า | ใส่อะไร |
   |---|---|
   | `DATABASE_URL` | URI จากขั้น A ข้อ 4 |
   | `GOOGLE_CLIENT_ID` | จากขั้น B ข้อ 3 |
   | `GOOGLE_CLIENT_SECRET` | จากขั้น B ข้อ 3 |
   | `GOOGLE_REDIRECT_URI` | `https://<ชื่อเว็บ>.onrender.com/auth/google/callback` |
   | `GOOGLE_HOSTED_DOMAIN` | โดเมน Google Workspace ขององค์กร เช่น `example.ac.th` · ถ้าใช้ Gmail ส่วนตัวใส่ `-` |

   `SESSION_SECRET` Render สุ่มให้เอง · `NODE_ENV` ตั้งไว้แล้ว
4. **Apply** → รอ build ประมาณ 3–5 นาที → ใน **Logs** ต้องเห็น
   ```
   migrate: 001_schema.sql
   migrate: 002_security.sql
   migrate: 003_functions.sql
   Server running on port ...
   ```
5. เปิด `https://<ชื่อเว็บ>.onrender.com/health` ต้องได้ `{"status":"ok",...}`
6. ถ้าชื่อเว็บไม่ใช่ `project-ft67` → กลับไปแก้ redirect URI ในขั้น B ข้อ 3 และ `GOOGLE_REDIRECT_URI` ใน Render ให้ตรงกัน

## D — ตั้งค่าเริ่มต้นในฐานข้อมูล (Supabase → SQL Editor → New query)

```sql
-- โดเมนอีเมลที่สมัครได้ (คั่นหลายโดเมนด้วย ,) — ว่าง = ไม่มีใครสมัครได้ · Gmail ส่วนตัวใช้ 'gmail.com'
update public.app_setting set value = 'gmail.com' where key = 'allowed_email_domains';
```

ฝ่ายและสมาชิกไม่ต้องพิมพ์เอง — นำเข้าจากชีท MEMBER ในขั้น E

## E — ผู้ดูแลระบบ + นำเข้าสมาชิก

1. สร้างบัญชี ADMIN (แยกจากทะเบียนสมาชิก ไม่ใช้รหัส M) — SQL Editor:
   ```sql
   select private.bootstrap_admin('you@gmail.com');
   ```
2. เปิดเว็บ → **เข้าสู่ระบบด้วย Google** ด้วยอีเมลนั้น → ระบบผูกบัญชีให้อัตโนมัติ → เห็นแท็บ Dashboard / Invite / นำเข้าสมาชิก
3. แท็บ **นำเข้าสมาชิก**: ชีท MEMBER คลิก A1 → Ctrl+Shift+End → Ctrl+C → วางในช่อง
   → ติ๊ก "เพิ่มฝ่ายที่ยังไม่มีในระบบ" → **ตรวจสอบ** → ไม่มีข้อผิดพลาดแล้วกด **นำเข้า**
4. สมาชิกคนอื่น: แท็บ **Invite** → ใส่รหัสสมาชิก → ส่ง code ให้เจ้าตัวทางช่องทางส่วนตัว
   → เจ้าตัวเข้าเว็บ login ด้วย Google → กรอกรหัสนักศึกษา (ตามชีท) + code

## F — ปลุกเว็บอัตโนมัติ (GitHub Actions)

Render ฟรีจะหลับเมื่อไม่มีคนใช้ประมาณ 15 นาที และ Supabase ฟรีจะพักโปรเจกต์ถ้าไม่มีการใช้งานประมาณ 7 วัน

1. GitHub → repo `20_FT_67` → **Settings → Secrets and variables → Actions → Variables → New repository variable**
2. Name: `APP_URL` · Value: `https://<ชื่อเว็บ>.onrender.com` → Add
3. แท็บ **Actions → keepalive → Run workflow** เพื่อทดสอบ (ต้องขึ้นเครื่องหมายถูกสีเขียว)

หมายเหตุ: GitHub จะหยุด workflow ตามเวลาอัตโนมัติถ้า repo ไม่มีการเคลื่อนไหว 60 วัน — ถ้าได้อีเมลแจ้ง ให้กด Enable อีกครั้ง

## G — ส่งข้อมูลให้ผู้พัฒนา (สำหรับขั้นย้ายข้อมูลจาก Sheets)

ส่งเฉพาะ **แถวหัวคอลัมน์** + ตัวอย่าง 2–3 แถว **ที่เปลี่ยนชื่อ/รหัสนักศึกษาเป็นค่าสมมติแล้ว** ของทุกชีท และตอบ:
1. "ผู้รับผิดชอบหลัก/ร่วม" ใน TASK_MASTER ใส่เป็นรหัสสมาชิก (M003) หรือชื่อคน
2. "เหลือเวลา" คำนวณจากคอลัมน์วันครบกำหนดใช่ไหม — คอลัมน์นั้นชื่ออะไร
3. MEMBER มีรหัสนักศึกษาครบทุกคนหรือยัง
4. ค่าสถานะที่ใช้จริงในแต่ละชีท

---

## เรื่องอื่น ๆ

**เปลี่ยน Feature Flag** (ต้องผ่านการอนุมัติ) — SQL Editor เท่านั้น ทุกการเปลี่ยนเข้า `audit_log` อัตโนมัติ:
```sql
update public.feature_flag set state = 'ENABLED', note = 'อนุมัติโดย ... วันที่ ...' where key = 'WRITE:LETTER';
```
การเปิดเขียนโมดูลอื่นนอกจาก TASK/DOCUMENT ต้องเพิ่มสิทธิ์ใน migration ใหม่ด้วย (เปลี่ยนแค่ flag ยังเขียนไม่ได้ — ตั้งใจให้ fail-closed)

**อัปเดตโค้ด:** push ขึ้น GitHub (หรืออัปโหลดไฟล์ผ่านหน้าเว็บ GitHub) → Render deploy ใหม่ให้อัตโนมัติ
และรัน migration ใหม่ที่เพิ่มเข้ามาเอง

**ย้ายไป Railway ในอนาคต:** สร้าง service จาก repo เดียวกัน ใส่ env ชุดเดิม เปลี่ยนแค่ `DATABASE_URL`
