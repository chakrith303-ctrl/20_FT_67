# ระบบบริหารโครงการ (Supabase + Next.js)

ระบบบริหารโครงการที่ใช้ **Supabase (PostgreSQL)** เป็นฐานข้อมูล กฎทั้งหมด (สิทธิ์ตามบทบาท/ฝ่าย, Feature Flags,
การสมัครด้วย invite, audit log) บังคับที่ตัวฐานข้อมูลด้วย Row Level Security แม้หน้าเว็บมีบั๊กก็ข้ามกฎไม่ได้

ใช้แพ็กเกจฟรีทั้งหมด: Supabase Free + Vercel Hobby + GitHub Actions

> ขั้นตอนติดตั้งสำหรับผู้ดูแล: [`docs/SETUP.md`](docs/SETUP.md)

## สถานะงาน

| ขั้น | งาน | สถานะ |
|---|---|---|
| 1 | Schema + RLS + ฟังก์ชัน (`supabase/migrations/`) + ชุดทดสอบ | ✅ เสร็จ |
| 2 | สคริปต์ย้ายข้อมูลจาก Google Sheets | ⏳ รอหัวคอลัมน์จริง (SETUP ขั้น E) |
| 3 | หน้าเว็บ Next.js (login, สมัคร, Dashboard, ดู/บันทึกข้อมูล, invite) | ⏳ |
| 4 | GitHub Actions: กันโปรเจกต์ถูกพัก + backup อัตโนมัติ | ⏳ |

## โครงสร้าง

```
supabase/migrations/
  20260923000001_schema.sql     ตาราง, รหัส (T001...), ค่าสถานะ, feature flags
  20260923000002_security.sql   ตัวตน/บทบาท, RLS, สิทธิ์คอลัมน์, audit trigger
  20260923000003_functions.sql  RPC: get_my_profile, get_dashboard, create_invite, register_self
supabase/tests/                 ชุดทดสอบ SQL (รันบน PostgreSQL ในเครื่อง)
scripts/test-db.sh              รัน migration + ทดสอบทั้งหมด
```

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
| USER_ACCOUNT | `user_account` | U | |
| EVALUATION_QUESTION | `evaluation_question` | EVQ | |
| EVALUATION_RESPONSE | `evaluation_response` | EV | |
| AUDIT_LOG | `audit_log` | A | append-only |
| (ใหม่) INVITE | `invite` | INV | เก็บเฉพาะ SHA-256 |

- รหัสออกอัตโนมัติจาก sequence (ไม่มีวันซ้ำ) ผู้ใช้กำหนดหรือแก้รหัสเองไม่ได้
- ค่าสถานะต้องอยู่ใน `status_option` (สะกดผิดหรือมีช่องว่างเกินจะบันทึกไม่ได้)
- ฝ่ายต้องอยู่ใน `department`, รหัสอ้างอิงข้ามตารางเป็น foreign key จริง

## 2) Feature Flags

ตาราง `feature_flag` แก้ได้เฉพาะใน SQL Editor (API แก้ไม่ได้) และทุกการเปลี่ยนเข้า audit log
flag ที่ไม่มีหรือค่าไม่ตรง = ปิด

- WRITE: `TASK`, `DOCUMENT` = ENABLED · อื่น ๆ = DISABLED_FAIL_CLOSED (ถูกปิดทั้งที่ flag และที่สิทธิ์ตาราง)
- READ: ทุกโมดูล ENABLED_READ_ONLY
- DASHBOARD: ENABLED_READ_ONLY, `DASHBOARD:MEMBER` = DISABLED_FAIL_CLOSED
- SELF_REGISTRATION, INVITE_CREATION: ENABLED_CONTROLLED

## สิทธิ์

| บทบาท | อ่าน | เขียน TASK/DOCUMENT | Dashboard | สร้าง invite |
|---|---|---|---|---|
| ADMIN / PRESIDENT / VICE_PRESIDENT | ทั้งโครงการ | ทุกฝ่าย | ทั้งโครงการ | ได้ |
| HEAD / SECRETARY | ฝ่ายตน (ไม่เห็นส่วนตรวจหลักฐาน, EVALUATION) | ฝ่ายตน | ฝ่ายตน | ไม่ได้ |
| MEMBER | งานที่ตนรับผิดชอบหลัก/ร่วม | ไม่ได้ | ปิด | ไม่ได้ |

- บทบาทคำนวณจากตำแหน่งใน `member` **ทุกครั้ง** (ตรงตัวเป๊ะ) → เปลี่ยนตำแหน่งแล้วสิทธิ์เปลี่ยนทันที
- ADMIN กำหนดได้เฉพาะใน `user_account` โดยผู้ดูแลฐานข้อมูล
- บัญชีต้อง ACTIVE และสมาชิกต้อง "ปฏิบัติหน้าที่" จึงมีสิทธิ์ใด ๆ
- ลบข้อมูลผ่าน API ไม่ได้

## 3) Dashboard

`get_dashboard(p_today)` คำนวณ KPI ตามนิยามเดิมทุกข้อ

- เป็นฟังก์ชัน **STABLE** ซึ่ง PostgreSQL ไม่ยอมให้เขียนข้อมูล → เขียนกลับไม่ได้โดยโครงสร้าง
- อ่านผ่าน RLS ของผู้เรียก → HEAD ได้ตัวเลขเฉพาะฝ่ายตนโดยอัตโนมัติ
- "เหลือเวลา" = `due_date − วันนี้` (เวลาไทย)
- หลักฐาน: จับคู่ `evidence.task_id` ตรงตัวเท่านั้น ไม่ใช้ `task.evidence_ids` และไม่เขียนกลับ

## 4) Self-Registration (Contract V1.1)

`register_self(student_id, invite_code)`

- อีเมลมาจาก `auth.users` ของ session (ต้องยืนยันแล้วและอยู่ในโดเมนที่อนุญาต)
- ทุกคำขอเข้าคิวผ่าน advisory lock แล้วตรวจซ้ำทั้งหมดก่อนบันทึก และมี unique constraint กันซ้ำอีกชั้น
- invite: SHA-256, ใช้ครั้งเดียว, หมดอายุ 7 วัน, ACTIVE ได้ 1 อันต่อคน (unique index)
- ล้มเหลว → ข้อความเดียวกันทุกกรณี (เหตุผลจริงอยู่ใน `registration_attempt` ซึ่ง API อ่านไม่ได้), จำกัด 5 ครั้ง/15 นาที
- สำเร็จ → `audit_log` action `SELF_REGISTER`

## ทดสอบ

```bash
./scripts/test-db.sh
```

ต้องมี PostgreSQL 15+ ในเครื่อง (ใช้ stub ของ `auth` schema แทน Supabase) — GitHub Actions รันให้ทุก push
