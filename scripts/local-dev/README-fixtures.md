# Local Dev Fixtures — Let's Assist

> **All accounts use password: `robo6737`** (unless otherwise noted)

---

## 🧑‍💻 Developer Admin Account

| Field    | Value                       |
| -------- | --------------------------- |
| Email    | `riddhiman.rana@gmail.com`  |
| Password | `robo6737`                  |
| Role     | **Admin** in all 3 orgs     |
| Status   | Verified + Trusted Member   |

---

## 🏛️ Organizations

| Slug                  | Name                    | Type      | Join Code  |
| --------------------- | ----------------------- | --------- | ---------- |
| `dv-speech-debate`    | DV Speech & Debate      | School    | `DVLOC1`   |
| `acts-of-hearts`      | Acts of Hearts          | Nonprofit | `AOHLC1`   |
| `wrms-speech-debate`  | WRMS Speech & Debate    | School    | `WRMS01`   |

---

## 👥 Named Test Accounts

All passwords: `robo6737`

| Email                      | Name          | DVSD Role | AOH Role | WRMS Role |
| -------------------------- | ------------- | --------- | -------- | --------- |
| `riddhiman.rana@gmail.com` | Riddhiman Rana | Admin    | Admin    | Admin     |
| `dv.admin@local.test`      | DV Admin      | Admin     | —        | —         |
| `dv.staff@local.test`      | DV Staff      | Staff     | —        | —         |
| `dv.student.a@local.test`  | Alex Student  | Member    | —        | —         |
| `dv.student.b@local.test`  | Blair Student | Member    | —        | —         |
| `dv.student.c@local.test`  | Casey Student | Member    | —        | —         |
| `dv.outsider@local.test`   | Outside User  | —         | —        | —         |

---

## 👤 Mock Members (15 accounts)

All passwords: `robo6737`. Members are distributed across the 3 orgs in groups of 5.

### DV Speech & Debate (members 1–5)

| Email                   | Name     | Role   |
| ----------------------- | -------- | ------ |
| `member.1@local.test`   | Member 1 | Admin  |
| `member.2@local.test`   | Member 2 | Staff  |
| `member.3@local.test`   | Member 3 | Member |
| `member.4@local.test`   | Member 4 | Member |
| `member.5@local.test`   | Member 5 | Member |

### Acts of Hearts (members 6–10)

| Email                   | Name      | Role   |
| ----------------------- | --------- | ------ |
| `member.6@local.test`   | Member 6  | Admin  |
| `member.7@local.test`   | Member 7  | Staff  |
| `member.8@local.test`   | Member 8  | Member |
| `member.9@local.test`   | Member 9  | Member |
| `member.10@local.test`  | Member 10 | Member |

### WRMS Speech & Debate (members 11–15)

| Email                   | Name      | Role   |
| ----------------------- | --------- | ------ |
| `member.11@local.test`  | Member 11 | Admin  |
| `member.12@local.test`  | Member 12 | Staff  |
| `member.13@local.test`  | Member 13 | Member |
| `member.14@local.test`  | Member 14 | Member |
| `member.15@local.test`  | Member 15 | Member |

---

## 📁 Seeded Projects

| Org                   | Title                  | Location                    | Status   | Visibility          |
| --------------------- | ---------------------- | --------------------------- | -------- | ------------------- |
| DV Speech & Debate    | Local Invitational     | DVHS                        | Upcoming | Organization Only   |
| Acts of Hearts        | Heart Charity Drive    | San Ramon Community Center  | Upcoming | Organization Only   |
| WRMS Speech & Debate  | WRMS Novice Tournament | WRMS                        | Upcoming | Organization Only   |

---

## 🗓️ DVSD Plugin Fixtures

| Item           | Detail                                        |
| -------------- | --------------------------------------------- |
| Current Season | 2026-2027 (Aug 2026 – Jun 2027)               |
| Prior Season   | 2025-2026 (expired)                           |
| Tournament     | Local Invitational (registration open)        |
| Students       | Alex (approved), Blair (submitted), Casey (needs action) |
| Guardians      | Shared Guardian, Casey Guardian               |

---

## 🔗 Remote Preview Mode

When **Remote Preview** is enabled (`/organization` page toggle), the system maps:

| Local Email                 | Remote User ID                           |
| --------------------------- | ---------------------------------------- |
| `riddhiman.rana@gmail.com`  | `b6ee0559-a406-4992-b621-9c5af015adce`  |
| `ridhdiman.rana@gmail.com`  | `b6ee0559-a406-4992-b621-9c5af015adce`  |

> This ensures org memberships and admin roles are correctly resolved from the remote database.

---

## 🚀 How to Re-Seed

```bash
bun run supabase
```

> `bun run supabase` starts local Supabase, resets the database, and seeds these fixtures.
