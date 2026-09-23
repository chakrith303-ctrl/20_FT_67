# ระบบบริหารโครงการ (Google Sheets + Apps Script)

Web App บน Google Apps Script ที่ใช้ Google Sheets เป็นฐานข้อมูล ครอบคลุม:
โครงสร้างข้อมูล/รหัส, Feature Flags แบบ fail-closed, Read/Write facade ที่ตรวจสิทธิ์ตามบทบาทและฝ่าย,
Dashboard KPI แบบอ่านอย่างเดียว และระบบสมัครสมาชิกด้วย invite (Contract V1.1)

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `src/Config.js` | **แหล่งความจริงเดียว**: Entity ↔ Sheet ↔ รหัส, Feature Flags, สถานะที่ใช้ใน KPI, ตำแหน่ง → บทบาท |
| `src/Util.js` | รหัส (T001…), SHA-256, constant-time compare, กัน formula injection |
| `src/Repository.js` | อ่าน/เขียนชีท, ตรวจคอลัมน์บังคับ (ขาด = ปฏิเสธ), document lock |
| `src/Auth.js` | อีเมลจาก session เซิร์ฟเวอร์, บทบาทจากตำแหน่งใน MEMBER |
| `src/Facade.js` | READ facade (กรองตามฝ่าย/บทบาท) และ WRITE facade (TASK/DOCUMENT เท่านั้น) |
| `src/Dashboard.js` | KPI (pure function) — ไม่มีการเขียนกลับลงชีท |
| `src/Registration.js` | สร้าง invite + สมัครสมาชิกด้วยตนเอง |
| `src/Audit.js` | บันทึก AUDIT_LOG |
| `src/WebApp.js` | `doGet` + API ที่ browser เรียกได้ |
| `src/Index.html` | หน้าเว็บ (สมัคร / Dashboard / ดูข้อมูล / บันทึก / สร้าง invite) |
| `tests/` | ทดสอบด้วย Node โดยจำลอง Apps Script services (`npm test`) |

## 1) Entity ↔ Sheet ↔ รหัส

| Entity | ชีท | Prefix | หมายเหตุ |
|---|---|---|---|
| TASK | TASK_MASTER | T | |
| DOCUMENT | DOCUMENT | D | |
| LETTER | LETTER_TRACKER | L | |
| REGISTRATION | REGISTRATION | R | |
| BUDGET | BUDGET | B | |
| RISK/ISSUE | RISK_ISSUE | RI | |
| EVIDENCE | EVIDENCE / หลักฐาน | E | รับได้ทั้งสองชื่อชีท |
| MEMBER | MEMBER | M | ช่วงที่ยืนยัน M001–M087 (`isConfirmedMemberId_`) |
| USER_ACCOUNT | USER_ACCOUNT | U | |
| EVALUATION_QUESTION | EVALUATION_QUESTION | EVQ | |
| EVALUATION_RESPONSE | EVALUATION_RESPONSE | EV | regex แยก EV กับ EVQ ชัดเจน |
| AUDIT_LOG | AUDIT_LOG | A | |
| INVITE *(เพิ่มใหม่)* | INVITE | INV | เก็บ invite แบบ hash |

รหัสทุกตัว = prefix + ตัวเลขอย่างน้อย 3 หลัก, ระบบออกรหัสให้เอง (เลขมากสุด + 1) ผู้ใช้กำหนด/แก้รหัสเองไม่ได้

ชื่อหัวคอลัมน์ที่ไม่ได้ระบุในสเปก (เช่น คอลัมน์สถานะของ DOCUMENT/LETTER/RISK/REGISTRATION,
`เหลือเวลา`, `รหัสนักศึกษา`, `ชื่อ-นามสกุล`) ตั้งไว้ใน `ENTITIES.*.fields` — ถ้าชีทจริงใช้ชื่ออื่นให้แก้ที่นั่นที่เดียว
ถ้าชีทขาดคอลัมน์บังคับ ระบบจะปฏิเสธการทำงาน (error `SCHEMA`)

## 2) Feature Flags

อยู่ใน `FEATURE_FLAGS` (`src/Config.js`) — ค่าที่ไม่ใช่ `ENABLED` ถือว่าปิดทั้งหมด

- **WRITE**: TASK, DOCUMENT = `ENABLED`; อื่น ๆ = `DISABLED_FAIL_CLOSED`
- **READ**: ทุกโมดูล `ENABLED_READ_ONLY`
- **DASHBOARD**: `ENABLED_READ_ONLY`; MEMBER = `DISABLED_FAIL_CLOSED`
- **SELF_REGISTRATION / INVITE_CREATION**: `ENABLED_CONTROLLED`

## สิทธิ์

| บทบาท | ขอบเขต | อ่าน | เขียน TASK/DOCUMENT | Dashboard | สร้าง invite |
|---|---|---|---|---|---|
| ADMIN, PRESIDENT, VICE_PRESIDENT | ทั้งโครงการ | ทุกโมดูล | ทุกฝ่าย | ทั้งโครงการ | ได้ |
| HEAD, SECRETARY | ฝ่ายตน (`ฝ่ายหลัก`) | ยกเว้น EVALUATION; EVIDENCE ไม่เห็นส่วนตรวจ | เฉพาะฝ่ายตน | เฉพาะฝ่ายตน | ไม่ได้ |
| MEMBER | ตนเอง | TASK ที่ตนเป็นผู้รับผิดชอบหลัก/ร่วม | ไม่ได้ | ปิด | ไม่ได้ |

- บทบาทคำนวณจาก `บทบาท/ตำแหน่ง` ใน MEMBER **ทุกครั้งที่เรียก** (ตรงตัวเป๊ะ) — เปลี่ยนตำแหน่งแล้วสิทธิ์เปลี่ยนทันที
- ADMIN กำหนดจากตำแหน่งไม่ได้ ต้องให้เจ้าของชีทใส่ `role = ADMIN` ใน USER_ACCOUNT เอง
- บัญชีต้อง `account_status = ACTIVE` และสมาชิกต้อง `ปฏิบัติหน้าที่` จึงเข้าใช้งานได้
- ทุกการเขียนทำใต้ document lock, บันทึก AUDIT_LOG (เก็บเฉพาะค่าที่เปลี่ยน), และกัน formula injection

## 3) Dashboard KPI

คำนวณใน `computeDashboard_` ตามนิยามในสเปก สถานะเทียบแบบตรงตัวอักษรเป๊ะ (ไม่ trim)

- **งาน**: นับเฉพาะแถวที่รหัสงานไม่ว่าง; เกินกำหนด = เหลือเวลา < 0; ใกล้ครบกำหนด = 0–3 วัน
  (ทั้งสองไม่นับงานเสร็จ/ยกเลิก); อัตราสำเร็จ = เสร็จ ÷ (ทั้งหมด − ยกเลิก) หรือ `null` ถ้าตัวหารเป็น 0.
  "เหลือเวลา" ใช้คอลัมน์ `เหลือเวลา` ก่อน ถ้าว่างคำนวณจากคอลัมน์วันครบกำหนด
- **เอกสาร**: รออนุมัติ / รอตรวจ; ตารางติดตาม = ร่าง, ต้องแก้ไข, รอตรวจ, รออนุมัติ
- **หนังสือ**: `ส่งแล้ว-รอตอบรับ` · **ความเสี่ยง**: ปิดแล้ว = `แก้ไขเสร็จสิ้น` หรือ `ปิดประเด็น`
- **หลักฐาน**: งาน `เสร็จสิ้น` ที่ไม่มีแถวใน EVIDENCE ซึ่ง `รหัสงานที่เกี่ยวข้อง` ตรงกับรหัสงาน
  (ไม่ใช้คอลัมน์ `รหัสหลักฐาน` ใน TASK_MASTER และไม่เขียนกลับ). สำหรับ HEAD ระบบตรวจการมีอยู่ของหลักฐานจากทุกฝ่าย
  แต่แสดงเฉพาะงานของฝ่ายตน และไม่เปิดเผยรายละเอียดหลักฐานฝ่ายอื่น
- **ลงทะเบียน**: `เช็คอินแล้ว` · **งบ**: ผลรวม `งบประมาณตั้งต้น` / `ค่าใช้จ่ายจริง` · **ทีม**: `ปฏิบัติหน้าที่`

มี test ยืนยันว่าการเปิด Dashboard ไม่ทำให้เกิดการเขียนลงชีทเลย

## 4) Self-Registration (Contract V1.1)

1. ผู้บริหาร (ระดับโครงการ) สร้าง invite ให้สมาชิก → ได้ code 128-bit (แสดงครั้งเดียว)
   ระบบเก็บเฉพาะ SHA-256 hash, หมดอายุใน 7 วัน, invite ACTIVE เดิมของคนนั้นถูก `REVOKED` (active ได้ 1 อัน)
2. สมาชิกเปิด Web App ด้วยบัญชี Google องค์กร → กรอก **รหัสนักศึกษา + invite code** เท่านั้น
3. เซิร์ฟเวอร์ดึงอีเมลจาก session, แล้ว **ใต้ document lock** ตรวจซ้ำ: อีเมลยังไม่มีบัญชี, รหัสนักศึกษาตรงสมาชิกเพียงคนเดียว,
   สมาชิกปฏิบัติหน้าที่, ตำแหน่งแปลงเป็นบทบาทได้, สมาชิกยังไม่ผูกบัญชี, invite ACTIVE ตรง hash และยังไม่หมดอายุ
4. สำเร็จ → สร้าง USER_ACCOUNT (บทบาทจากตำแหน่ง), invite → `USED`, บันทึก AUDIT_LOG `SELF_REGISTER`
5. ล้มเหลว → ข้อความเดียวกันทุกกรณี (ไม่บอก field ที่ผิด) เหตุผลจริงอยู่ใน log ของ Apps Script เท่านั้น
   และจำกัด 5 ครั้ง / 15 นาที ต่ออีเมล

ค่า `email`/`role` ที่ browser ส่งมาจะถูกทิ้งเสมอ และ browser ไม่มีทางเขียน USER_ACCOUNT โดยตรง
(ชีทไม่ต้องแชร์ให้ผู้ใช้ Web App รันในนามผู้ deploy)

## การติดตั้ง

1. สร้าง Apps Script ผูกกับ Spreadsheet ของโครงการ (Extensions → Apps Script) แล้วคัดลอกไฟล์ใน `src/`
   หรือใช้ [clasp](https://github.com/google/clasp): คัดลอก `.clasp.json.example` เป็น `.clasp.json`, ใส่ `scriptId`, แล้ว `clasp push`
   (ถ้าเป็น standalone script ให้ตั้ง Script Property `SPREADSHEET_ID`)
2. รัน `setupSystemSheets` จาก editor (เฉพาะเจ้าของ) เพื่อสร้างชีท USER_ACCOUNT / AUDIT_LOG / INVITE ถ้ายังไม่มี
3. ใส่แถว ADMIN คนแรกใน USER_ACCOUNT ด้วยมือ (`U001`, รหัสสมาชิก, อีเมล, `ADMIN`, `ACTIVE`)
4. เพิ่มคอลัมน์ `รหัสนักศึกษา` ใน MEMBER (ใช้จับคู่ตอนสมัคร)
5. Deploy → Web app: *Execute as: Me*, *Who has access: Anyone within <โดเมน>*
6. ห้ามแชร์สิทธิ์แก้ไข Spreadsheet ให้ผู้ใช้ทั่วไป (การเขียนทั้งหมดต้องผ่าน Web App)

## ทดสอบ

```bash
npm test
```
