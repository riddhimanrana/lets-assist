# Local development accounts

These fictional accounts work only against a local Supabase stack. The
repository does not store their password.

## Shared local setup

Create one run-scoped password before resetting and seeding the shared local
stack:

```bash
export CSF_LOCAL_TEST_PASSWORD="$(openssl rand -base64 24)"
export DV_LOCAL_TEST_PASSWORD="$CSF_LOCAL_TEST_PASSWORD"
bun run supabase
bun run dev:next
```

All accounts created by that fixture run use the exported password. Keep the
terminal open or save the value in a local password manager until you finish
testing.

The shared platform seed includes:

| Account                        | Role                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| `platform.admin@local.test`    | Platform super admin and administrator in the seeded organizations |
| `platform.staff@local.test`    | Staff in the seeded platform organizations                         |
| `platform.member@local.test`   | Member in a seeded platform organization                           |
| `platform.outsider@local.test` | Authenticated account with no organization membership              |

The shared seed does not create DVHS CSF records. Use the isolated CSF setup for
that plugin.

## Optional Speech and Debate accounts

After the shared seed, run `bun run dv:fixtures` with the same exported
password. This adds `dv.admin@local.test`, `dv.staff@local.test`, three student
accounts, an outsider, and the numbered member fixtures documented in
[the fixture catalog](../../scripts/local-dev/README-fixtures.md).

## Isolated CSF accounts

Run `bun run dev`. The isolated launcher creates or reuses an owner-only
password file, prints the current password, and starts the fictional CSF stack.
Use `csf.admin@local.test` for organization and plugin administration. The full
officer and member account list is in the
[fixture catalog](../../scripts/local-dev/README-fixtures.md).

## If sign-in fails

- Confirm the browser points at the same local stack that was seeded.
- Reuse the password from the current fixture run. A database reset invalidates
  the previous run's accounts.
- Sign out before retrying if the browser holds an older local session.
