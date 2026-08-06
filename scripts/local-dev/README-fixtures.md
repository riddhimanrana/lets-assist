# Local Dev Fixtures — Let's Assist

> Set `CSF_LOCAL_TEST_PASSWORD` (or `DV_LOCAL_TEST_PASSWORD`) before seeding.
> Every generated local account uses that run-specific password; no password is
> stored in this repository.

---

## 🧑‍💻 Default platform administrator

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Email    | `platform.admin@local.test`                                    |
| Password | Value of `CSF_LOCAL_TEST_PASSWORD` or `DV_LOCAL_TEST_PASSWORD` |
| Role     | **Admin** in all 4 default platform orgs                       |
| Status   | Verified + Trusted Member                                      |

---

## 🏛️ Default platform organizations

| Slug                      | Name                    | Type      | Join Code |
| ------------------------- | ----------------------- | --------- | --------- |
| `local-platform-org`      | Local Platform Org      | Nonprofit | `572780`  |
| `acts-of-hearts`          | Acts of Hearts          | Nonprofit | `111607`  |
| `local-school-volunteers` | Local School Volunteers | School    | `340992`  |
| `dvhs-csf`                | DVHS CSF                | School    | `621478`  |

> `dvhs-csf` and every CSF account below it are **isolated-mode only**. They are
> created by `bun run csf:seed:platform:isolated` on a generated isolated stack;
> the shared local seed creates none of them.

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

| Email                 | Name     | Role   |
| --------------------- | -------- | ------ |
| `member.1@local.test` | Member 1 | Admin  |
| `member.2@local.test` | Member 2 | Staff  |
| `member.3@local.test` | Member 3 | Member |
| `member.4@local.test` | Member 4 | Member |
| `member.5@local.test` | Member 5 | Member |

### Acts of Hearts (members 6–10)

| Email                  | Name      | Role   |
| ---------------------- | --------- | ------ |
| `member.6@local.test`  | Member 6  | Admin  |
| `member.7@local.test`  | Member 7  | Staff  |
| `member.8@local.test`  | Member 8  | Member |
| `member.9@local.test`  | Member 9  | Member |
| `member.10@local.test` | Member 10 | Member |

### WRMS Speech & Debate (members 11–15)

| Email                  | Name      | Role   |
| ---------------------- | --------- | ------ |
| `member.11@local.test` | Member 11 | Admin  |
| `member.12@local.test` | Member 12 | Staff  |
| `member.13@local.test` | Member 13 | Member |
| `member.14@local.test` | Member 14 | Member |
| `member.15@local.test` | Member 15 | Member |

---

## 📁 Seeded Projects

| Org                  | Title                  | Location                   | Status   | Visibility        |
| -------------------- | ---------------------- | -------------------------- | -------- | ----------------- |
| DV Speech & Debate   | Local Invitational     | DVHS                       | Upcoming | Organization Only |
| Acts of Hearts       | Heart Charity Drive    | San Ramon Community Center | Upcoming | Organization Only |
| WRMS Speech & Debate | WRMS Novice Tournament | WRMS                       | Upcoming | Organization Only |

---

## 🗓️ DVSD Plugin Fixtures

| Item           | Detail                                                   |
| -------------- | -------------------------------------------------------- |
| Current Season | 2026-2027 (Aug 2026 – Jun 2027)                          |
| Prior Season   | 2025-2026 (expired)                                      |
| Tournament     | Local Invitational (registration open)                   |
| Students       | Alex (approved), Blair (submitted), Casey (needs action) |
| Guardians      | Shared Guardian, Casey Guardian                          |

---

## 🎓 Isolated DVHS CSF testing accounts

These accounts exist only after `bun run csf:seed:platform:isolated`. Every
account uses the run-scoped `CSF_LOCAL_TEST_PASSWORD`; the repository stores no
fixture password. The titles mirror the DVHS CSF office structure, while every
identity and email address is fictional.

| Email                             | Host role | CSF responsibility                          |
| --------------------------------- | --------- | ------------------------------------------- |
| `csf.admin@local.test`            | Admin     | Full organization and plugin administration |
| `csf.adviser@local.test`          | Staff     | Adviser and academic override review        |
| `csf.co-president-one@local.test` | Staff     | Co-President seat 1                         |
| `csf.co-president-two@local.test` | Staff     | Co-President seat 2                         |
| `csf.vp-membership@local.test`    | Staff     | Vice President — Membership                 |
| `csf.vp-publicity@local.test`     | Staff     | Vice President — Publicity                  |
| `csf.vp-clubs@local.test`         | Staff     | Vice President — Clubs                      |
| `csf.treasurer@local.test`        | Staff     | Treasurer                                   |
| `csf.secretary@local.test`        | Staff     | Secretary                                   |
| `csf.web-master@local.test`       | Staff     | Web Master                                  |
| `csf.officer@local.test`          | Staff     | Activity Coordinator seat 1                 |
| `csf.activity-two@local.test`     | Staff     | Activity Coordinator seat 2                 |
| `csf.activity-three@local.test`   | Staff     | Activity Coordinator seat 3                 |
| `csf.activity-four@local.test`    | Staff     | Activity Coordinator seat 4                 |
| `csf.activity-five@local.test`    | Staff     | Activity Coordinator seat 5                 |
| `csf.data-management@local.test`  | Staff     | Data Management                             |
| `student.2028@local.test`         | Member    | Linked Class of 2028 member                 |
| `csf.applicant@local.test`        | Member    | Applicant and account-link workflow         |

The dataset includes Classes of 2027, 2028, and 2029; Fall 2025 and Spring 2026
terms; accepted, needs-review, and needs-action applications; active and
accepted memberships; meetings and attendance; opportunities; point
submissions and awarded credit; partner clubs; announcements; and import
preview/commit states.

---

## 🔗 Remote Preview Mode

Remote Preview has no built-in user mapping. If a developer explicitly enables
that read-only diagnostic path, provide a server-only
`REMOTE_PREVIEW_USER_ID_MAP` value for the current session. Never commit hosted
user IDs or expose the mapping through a `NEXT_PUBLIC_*` variable.

---

## 🚀 How to Re-Seed — shared local, non-CSF only

```bash
export CSF_LOCAL_TEST_PASSWORD="$(openssl rand -base64 24)"
bun run supabase
# Optional DV Speech & Debate workspace:
bun run dv:fixtures
```

> `bun run supabase` starts the shared local Supabase stack, resets its database,
> and seeds the default non-CSF platform fixtures. It seeds **no** DVHS CSF data:
> `PLATFORM_SEED_MODE=shared-local-v1` creates, replaces, and deletes no DVHS CSF
> organization, plugin, profile, membership, import, or synthetic fixture record.
> `bun run dv:fixtures` adds the optional DV Speech & Debate workspace.
>
> The DVHS CSF rows in the tables above are seeded only by
> `bun run csf:seed:platform:isolated` on a generated isolated stack — see the
> next section.

## Isolated DVHS CSF stack — the only supported CSF recovery path

For ordinary development, start Let’s Assist and its fictional CSF dataset with
one command:

```bash
bun run dev
# Equivalent explicit aliases:
bun run dev:csf
bun run csf:dev:isolated
```

The command prints the generated password and useful fake accounts. Re-running
it preserves local edits; `CSF_LOCAL_RESEED=1 bun run dev` deliberately
restores the fixtures.

For lower-level recovery, start a separate stack without touching the shared
local Supabase project:

```bash
scripts/local-dev/start-dvhs-csf-isolated-stack.sh
```

That single launcher owns one project ID, one port bundle (base `55320`), and one
new database volume. The new volume is what makes the Supabase CLI apply the
current timestamped migrations and then the configured `db.seed.sql_paths`; a
later start of an existing volume replays neither.

Load the generated app environment **before** seeding, through the exact-byte
validated loader. Do not `source` or `eval` the generated file on this path:

```bash
export CSF_ISOLATED_WORK_DIR=/tmp/lets-assist-csf-browser-<run-id>
node scripts/local-dev/dv-local-env.mjs --print-app-env   # 17 allowlisted KEY=VALUE lines
# export each line after checking its key against the allowlist — see README.md
bun run csf:seed:platform:isolated
bun run dv:fixtures   # optional DV workspace
```

`supabase-browser.env` in the same directory is only the raw `supabase status`
snapshot and is not sufficient for app or seed validation.

`bun run csf:seed:platform:isolated` and `bun run dv:fixtures` create the
fictional JavaScript-managed platform and DV records shown above — they do not
replay migrations or SQL seeds. The isolated seed script carries
`PLATFORM_SEED_MODE=csf-isolated-v1`, refuses to run without a validated
`CSF_ISOLATED_WORK_DIR`, and is the only mode that seeds the deterministic
synthetic DVHS CSF fixtures. `bun run supabase:seed:local-dev` is shared local,
non-CSF only: it refuses an isolated work directory and seeds no DVHS CSF data,
so it is not a fallback here.

Then start the low-level Let’s Assist runner on owned port 3000 in that same
manually exported environment:

```bash
node scripts/local-dev/run-dvhs-csf-isolated-app.mjs
```

That runner validates the same 17 isolated values, builds its child environment
from a positive allowlist rather than by spreading `process.env`, shadows every
key the repository's `.env*` files declare unless it is validated local-safe,
forces every worker flag false, selects Mailpit explicitly for local mail,
permits only loopback Supabase, database, SMTP, and local-app traffic, and holds
one atomic claim on port `3000` for the child's lifetime. `bun run dev` is not a
fallback on this path.

Tear down with a dry run first, using the exact work directory the launcher
printed:

```bash
scripts/local-dev/stop-dvhs-csf-isolated-stack.sh --dry-run /tmp/lets-assist-csf-browser-<run-id>
scripts/local-dev/stop-dvhs-csf-isolated-stack.sh /tmp/lets-assist-csf-browser-<run-id>
```

Pass `--delete-workdir` only when the local logs and environment file are no
longer needed. It is unreachable unless the post-stop Docker **residual proof**
succeeded; if Docker is missing, enumeration fails, or anything unexpected
remains, the stop exits nonzero and retains every piece of recovery evidence.

`bun run db:test:redesign` drives the same launcher itself. When it generates the
stack it loads `lets-assist-browser.sh` through its own validated exact-byte
loader (`node scripts/local-dev/dv-local-env.mjs --print-app-env`) rather than a
second `source` of that pathname, then seeds these fixtures on that one stack.
