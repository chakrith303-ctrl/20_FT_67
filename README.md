# ระบบบริหารโครงการ

Express + PostgreSQL · Login ด้วย Google · Deploy ฟรีบน Render + Supabase

กฎทั้งหมด (สิทธิ์ตามบทบาท/ฝ่าย, Feature Flags, การสมัครด้วย invite, audit log) บังคับที่ **ตัวฐานข้อมูล** —
server สลับเป็น role `app_user` และตั้งตัวตนผู้ใช้ทุก transaction แม้โค้ดเว็บมีบั๊กก็ข้ามกฎไม่ได้

> ติดตั้ง: [`docs/SETUP.md`](docs/SETUP.md)

## สถานะงาน

| ขั้น | งาน | สถานะ |
|---|---|---|
| 1 | ฐานข้อมูล: ตาราง + สิทธิ์ (RLS) + ฟังก์ชัน | ✅ |
| 3 | เว็บ Express: login Google, สมัคร, Dashboard, ดู/บันทึกข้อมูล, invite | ✅ |
| 4 | ปลุกเว็บอัตโนมัติ (GitHub Actions) | ✅ · backup อัตโนมัติ ⏳ |
| 2 | สคริปต์ย้ายข้อมูลจาก Google Sheets | ⏳ รอหัวคอลัมน์จริง (SETUP ขั้น G) |

## ไฟล์

```
index.js          entry point: security headers, session, migrate, เปิด server
db.js             connection pool + withUser() รันคำสั่งในนามผู้ใช้
migrate.js        รัน db/migrations/*.sql ที่ยังไม่เคยรัน (อัตโนมัติตอนเริ่ม server)
auth-google.js    /auth/google/start, /auth/google/callback, /auth/logout
routes-api.js     /api/* (me, register, meta, dashboard, modules, tasks, documents, invites)
public/           หน้าเว็บ (HTML/CSS/JS ล้วน)
db/migrations/    โครงสร้างฐานข้อมูล + สิทธิ์ + ฟังก์ชัน
db/tests/         ชุดทดสอบ SQL
test/             ชุดทดสอบ API
render.yaml       ตั้งค่า Render
```

## API

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/me` | สถานะ login + บทบาท/สิทธิ์ |
| POST | `/api/register` | สมัคร `{student_id, invite_code}` |
| GET | `/api/meta` | รายชื่อฝ่าย + สถานะที่ใช้ได้ |
| GET | `/api/dashboard` | KPI (transaction READ ONLY) |
| GET | `/api/modules/:module` | TASK, DOCUMENT, LETTER, REGISTRATION, BUDGET, RISK, EVIDENCE, EVALUATION |
| POST / PATCH | `/api/tasks`, `/api/tasks/:id` | สร้าง/แก้งาน |
| DELETE | `/api/tasks/:id` | ลบงาน (ADMIN ลบได้ทุกงาน, MEMBER ลบได้เฉพาะงานตัวเอง) |
| POST / PATCH | `/api/documents`, `/api/documents/:id` | สร้าง/แก้เอกสาร |
| GET / POST | `/api/invites`, `/api/invites/:id/revoke` | จัดการ invite (ระดับโครงการ) |
| GET | `/health` | ตรวจว่าเว็บ + ฐานข้อมูลทำงาน |

คำขอที่ไม่ใช่ GET ต้องมี header `x-requested-with: fetch` (กัน CSRF)

## 1) Entity ↔ ตาราง ↔ รหัส

| Entity | ตาราง | รหัส | หมายเหตุ |
|---|---|---|---|
| TASK | `task` | T | ผู้รับผิดชอบหลัก `owner_main_id`, ร่วม `co_owner_ids[]` |
| DOCUMENT | `document` | D | |
| LETTER | `letter` | L | `department` = ฝ่ายที่เสนอเรื่อง |
| REGISTRATION | `registration` | R | |
| BUDGET | `budget` | B | `department` = ฝ่ายที่ขอใช้ |
| RISK/ISSUE | `risk_issue` | RI | |
| EVIDENCE | `evidence` + `evidence_review` | E | ส่วนตรวจแยกตาราง เห็นเฉพาะระดับโครงการ |
| MEMBER | `member` | M | |
| USER_ACCOUNT | `user_account` | U | ผูกกับบัญชี Google ด้วย `google_sub` |
| EVALUATION_QUESTION | `evaluation_question` | EVQ | |
| EVALUATION_RESPONSE | `evaluation_response` | EV | |
| AUDIT_LOG | `audit_log` | A | append-only |
| (ใหม่) INVITE | `invite` | INV | เก็บเฉพาะ SHA-256 |

รหัสออกอัตโนมัติ (ไม่ซ้ำ), ค่าสถานะต้องอยู่ใน `status_option`, ฝ่ายต้องอยู่ใน `department`, รหัสอ้างอิงเป็น foreign key จริง

## 2) Feature Flags

ตาราง `feature_flag` — แก้ได้เฉพาะใน SQL Editor, ทุกการเปลี่ยนเข้า audit log, flag ที่ไม่มี/ค่าไม่ตรง = ปิด

- WRITE: `TASK`, `DOCUMENT` = ENABLED · อื่น ๆ = DISABLED_FAIL_CLOSED
- READ: ทุกโมดูล ENABLED_READ_ONLY
- DASHBOARD: ENABLED_READ_ONLY · `DASHBOARD:MEMBER` = DISABLED_FAIL_CLOSED
- SELF_REGISTRATION, INVITE_CREATION: ENABLED_CONTROLLED

## สิทธิ์

| บทบาท | อ่าน | เขียน TASK | ลบ TASK | เขียน DOCUMENT | Dashboard | Invite |
|---|---|---|---|---|---|---|
| ADMIN | ทั้งโครงการ ทุกฝ่าย | ทุกฝ่าย | ทุกฝ่าย | ทุกฝ่าย | ทั้งโครงการ | ✓ |
| PRESIDENT / VICE_PRESIDENT | ทั้งโครงการ ทุกฝ่าย (ดู/อนุมัติ/export) | ทุกฝ่าย | | ทุกฝ่าย | ทั้งโครงการ | ✓ |
| HEAD / SECRETARY | งาน (TASK) ข้ามฝ่ายได้ (อ่านอย่างเดียว) · โมดูลอื่นเฉพาะฝ่ายตน (ไม่เห็นส่วนตรวจหลักฐาน, EVALUATION) | ฝ่ายตน | | ฝ่ายตน | ฝ่ายตน | |
| MEMBER | รายการงาน (TASK) ทั้งฝ่ายตน | เฉพาะงานที่ตนรับผิดชอบหลัก/ร่วม | เฉพาะงานที่ตนรับผิดชอบหลัก/ร่วม | | ปิด | |

บทบาทคำนวณจากตำแหน่งใน `member` ทุกครั้ง · ADMIN กำหนดได้เฉพาะใน SQL · บัญชีต้อง ACTIVE และสมาชิกต้อง "ปฏิบัติหน้าที่"
ลบข้อมูลผ่านเว็บได้เฉพาะ TASK (ADMIN ลบได้ทุกงาน, MEMBER ลบได้เฉพาะงานตัวเอง) — ตารางอื่นลบผ่านเว็บไม่ได้

## ฝ่าย

1. ฝ่ายอำนวยการ/ประธานโครงการ
2. ฝ่ายพิธีการและงานลงทะเบียน
3. ฝ่ายนิทรรศการและสื่อ Infographic
4. ฝ่ายสถานที่ และประชาสัมพันธ์สื่อดิจิทัล
5. ฝ่ายธุรการและงานประเมิน
6. ฝ่ายสวัสดิการและงานบริการ
7. ฝ่ายวิชาการและการทดสอบ

กำหนดไว้ที่ฐานข้อมูล (`db/migrations/007_department_and_member_task_rights.sql`) — นำเข้าสมาชิกด้วยฝ่ายอื่นนอกเหนือจากนี้ไม่ได้ เว้นแต่ผู้ดูแลติ๊ก "เพิ่มฝ่ายที่ยังไม่มีในระบบ" ตอนนำเข้า

## 3) Dashboard

`get_dashboard()` เป็นฟังก์ชัน STABLE (PostgreSQL ไม่ยอมให้เขียนข้อมูล) และ API เรียกใน transaction READ ONLY อีกชั้น
KPI ตามนิยามเดิมทุกข้อ · "เหลือเวลา" = `due_date − วันนี้` (เวลาไทย) · หลักฐานจับคู่ `evidence.task_id` ตรงตัวเท่านั้น

## 4) Self-Registration (Contract V1.1)

- อีเมลมาจาก Google ID token ที่ server ตรวจแล้ว (`email_verified`) — body ที่ส่ง email/role มาถูกละเลย
- login ใช้ `state` + `nonce` สุ่มใหม่ทุกครั้ง ตรวจตอน callback
- invite: SHA-256, ใช้ครั้งเดียว, หมดอายุ 7 วัน, ACTIVE ได้ 1 อันต่อคน
- ตรวจซ้ำทั้งหมดใต้ advisory lock + unique constraint · ล้มเหลว = ข้อความเดียวกันทุกกรณี · จำกัด 5 ครั้ง/15 นาที · สำเร็จ = audit `SELF_REGISTER`

## ทดสอบ

```bash
npm install
npm test        # ต้องมี PostgreSQL 15+ ในเครื่อง — GitHub Actions รันให้ทุก push
```

## รันในเครื่อง

คัดลอก `.env.example` เป็น `.env` ใส่ค่า (Google redirect เป็น `http://localhost:3000/auth/google/callback`
และเพิ่ม URI นี้ใน Google Console) แล้ว `NODE_ENV=development npm start`
