# Local Development Accounts

Use these only in local development.

## Bootstrap command

Run from the repository root:

```bash
bun run supabase
```

That command starts local Supabase, resets the database through the current migrations, seeds the deterministic fixture accounts, and checks the local stack health.

## Core sign-in accounts

All passwords: `robo6737`

1. Admin account
   - Email: `riddhiman.rana@gmail.com`
   - Name: `Riddhiman Rana`
   - Role: Admin in all seeded orgs

2. DV admin
   - Email: `dv.admin@local.test`
   - Name: `DV Admin`
   - Role: Admin in DV Speech & Debate only

3. DV staff
   - Email: `dv.staff@local.test`
   - Name: `DV Staff`
   - Role: Staff in DV Speech & Debate only

4. DV student
   - Email: `dv.student.a@local.test`
   - Name: `Alex Student`
   - Role: Member in DV Speech & Debate only

5. DV student
   - Email: `dv.student.b@local.test`
   - Name: `Blair Student`
   - Role: Member in DV Speech & Debate only

6. DV student
   - Email: `dv.student.c@local.test`
   - Name: `Casey Student`
   - Role: Member in DV Speech & Debate only

7. Outside user
   - Email: `dv.outsider@local.test`
   - Name: `Outside User`
   - Role: Not a member of the seeded orgs

## Mock members

All passwords: `robo6737`

- `member.1@local.test` through `member.5@local.test` are seeded into DV Speech & Debate
- `member.6@local.test` through `member.10@local.test` are seeded into Acts of Hearts
- `member.11@local.test` through `member.15@local.test` are seeded into WRMS Speech & Debate

## Remote preview mapping

When Remote Preview is enabled, the local admin account maps to the remote user ID below:

- `riddhiman.rana@gmail.com` -> `b6ee0559-a406-4992-b621-9c5af015adce`

## Notes

- The fixture seed is idempotent and safe to re-run.
- If login appears stale, sign out and sign back in after re-running `bun run supabase`.
