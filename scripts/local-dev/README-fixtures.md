# Local Dev Fixtures — Let's Assist

> Set `CSF_LOCAL_TEST_PASSWORD` (or `DV_LOCAL_TEST_PASSWORD`) before seeding.
> Every generated local account uses that run-specific password; no password is
> stored in this repository.

---

## 🧑‍💻 Default platform administrator

| Field    | Value                       |
| -------- | --------------------------- |
| Email    | `platform.admin@local.test` |
| Password | Value of `CSF_LOCAL_TEST_PASSWORD` or `DV_LOCAL_TEST_PASSWORD` |
| Role     | **Admin** in all 4 default platform orgs |
| Status   | Verified + Trusted Member   |

---

## 🏛️ Default platform organizations

| Slug                      | Name                    | Type      | Join Code |
| ------------------------- | ----------------------- | --------- | --------- |
| `local-platform-org`      | Local Platform Org      | Nonprofit | `572780`  |
| `acts-of-hearts`          | Acts of Hearts          | Nonprofit | `111607`  |
| `local-school-volunteers` | Local School Volunteers | School    | `340992`  |
| `dvhs-csf`                | DVHS CSF                | School    | `621478`  |

---

## 👥 Optional DV Speech & Debate fixtures

All accounts use the run-specific password supplied through
`CSF_LOCAL_TEST_PASSWORD` or `DV_LOCAL_TEST_PASSWORD`.

Run `bun run dv:fixtures` after the default platform seed to add the following
three organizations: DV Speech & Debate (`508833`), Acts of Hearts (`111607`),
and WRMS Speech & Debate (`830672`). `dv.admin@local.test` is an administrator
in all three. The remaining named accounts are scoped as follows:

| Email                     | Name             | DVSD Role | AOH Role | WRMS Role |
| ------------------------- | ---------------- | --------- | -------- | --------- |
| `dv.admin@local.test`     | DV Admin Fixture | Admin     | Admin    | Admin     |
| `dv.staff@local.test`     | DV Staff         | Staff     | —        | —         |
| `dv.student.a@local.test` | Alex Student     | Member    | —        | —         |
| `dv.student.b@local.test` | Blair Student    | Member    | —        | —         |
| `dv.student.c@local.test` | Casey Student    | Member    | —        | —         |
| `dv.outsider@local.test`  | Outside User     | —         | —        | —         |

---

## 👤 Mock Members (15 accounts)

Members use the same run-specific environment password and are distributed
across the three organizations in groups of five.

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

Remote Preview has no built-in user mapping. If a developer explicitly enables
that read-only diagnostic path, provide a server-only
`REMOTE_PREVIEW_USER_ID_MAP` value for the current session. Never commit hosted
user IDs or expose the mapping through a `NEXT_PUBLIC_*` variable.

---

## 🚀 How to Re-Seed

```bash
export CSF_LOCAL_TEST_PASSWORD="$(openssl rand -base64 24)"
bun run supabase
# Optional DV Speech & Debate workspace:
bun run dv:fixtures
```

> `bun run supabase` starts local Supabase, resets the database, and seeds the
> default platform and DVHS CSF fixtures. `bun run dv:fixtures` adds the optional
> DV Speech & Debate workspace.

## Isolated DVHS CSF stack

Start a separate stack without touching the shared local Supabase project:

```bash
scripts/local-dev/start-dvhs-csf-isolated-stack.sh
```

Source the generated Supabase environment and seed fictional login accounts:

```bash
source /tmp/lets-assist-csf-browser-<run-id>/supabase-browser.env
bun run supabase:seed:local-dev
```

Then source the generated app environment before starting Let’s Assist on port 3001:

```bash
source /tmp/lets-assist-csf-browser-<run-id>/lets-assist-browser.sh
bun run dev -- --port 3001
```

Use the exact work directory printed by that command when stopping it:

```bash
scripts/local-dev/stop-dvhs-csf-isolated-stack.sh /tmp/lets-assist-csf-browser-<run-id>
```

Pass `--delete-workdir` only when its local logs and environment file are no longer needed.
