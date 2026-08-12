# Production cutover runbook

Production has 236 ordered migrations through `20260811001500`.
Hosted Development has 272 ordered migrations through `20260812132725`.
This repository branch has 274 ordered migrations through `20260812162732` and
contains 38 Production-pending migrations. The local isolated replay passed all
123 pgTAP files and 5,208 assertions; hosted acceptance remains pending.

**This runbook is preparation. Executing it requires explicit release
authorization** ([deployment boundaries](deployment.md)). Production remains
untouched. No release may proceed until hosted Development exact-SHA browser and
provider gates are green.

## Two facts that shape everything

**1. The schema push and the application deploy are one release, not two.**

The 38 pending migrations and their exact application release SHA must be
treated as one change. Do not push the schema independently or infer application
compatibility from the migration ledger. Schedule one window, with the exact
application release ready before the push starts.

**2. Migrations are forward-only.** There is no down migration. Rollback means a point-in-time restore, or a corrective forward migration. Never delete a migration that may have run remotely.

## Historical defects already closed in the Production baseline

Both were confirmed against Production by read-only catalog inspection during
the 2026-08-10 audit. Their forward fixes are now included in the current
Production baseline through `20260811001500`. Keep them in rehearsal coverage
because the cutover still builds on that baseline. See the
[audit register](audit-register-20260810.md).

- **AUD-001** — `public.trusted_member` accepts a client-supplied `status`, so any signed-in user who has not yet applied can self-grant trusted status and unlock organization and project creation.
- **AUD-002** — the `notifications` INSERT policy ends in `OR (auth.uid() IS NULL)`, so anyone holding the public anon key can inject a notification for any user, with an attacker-chosen title, body, and action URL.

The fixing migrations, `20260810220100` and `20260810220200`, are historical
context rather than part of the current 38-migration pending set.

---

## Pre-window gates

All must be green before a window is scheduled. Each is a stop, not a preference.

| #    | Gate                                                                                                              | How it is satisfied                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | `development` → `main` merged, `ci.yml` fully green on the merge commit **including `db-replay-validation`**      | That job is where pgTAP and the browser suites run                                                                                                                                                                                    |
| P-2  | `deploy-schema.yml` runs pgTAP                                                                                    | **Done** — a `Run pgTAP database tests` step was added to `test-local-reset`, which `deploy-to-production` depends on. Before this, pgTAP ran only in `ci.yml` behind a paths filter and a `workflow_dispatch` deploy never re-ran it |
| P-3  | The `production` GitHub Environment has named required reviewers                                                  | The workflow declares `environment: production`, but protection rules live in repository settings, not in the repo                                                                                                                    |
| P-4  | **PITR enabled** on `fotdmeakexgrkronxlof`, window ≥ 24 h and established                                         | The Supabase organization is on the **Pro** plan, so PITR is available as an add-on — confirm it is actually switched on. Without it, a lossless rollback does not exist                                                              |
| P-5  | Every preflight in `scripts/production-cutover-preflight.sql` passes, or each deviation is adjudicated in writing | See [preflight](#preflight)                                                                                                                                                                                                           |
| P-6  | Rehearsal complete on production-shaped data                                                                      | See [rehearsal](#rehearsal)                                                                                                                                                                                                           |
| P-7  | Backup taken **and verify-restored**                                                                              | See [backup](#backup)                                                                                                                                                                                                                 |
| P-8  | A green Vercel deployment of the exact release SHA exists and was smoke-tested against the rehearsal database     | Not the same as a green `development` preview                                                                                                                                                                                         |
| P-9  | `RESEND_API_KEY` resolved (AUD-013)                                                                               | Flagged **Needs Attention** on both Production and Pre-Production. This release exercises announcement, waiver, and certificate email                                                                                                 |
| P-10 | No `supabase config push` anywhere in automation                                                                  | Verified absent from `.github/`, `scripts/`, and `package.json` as of 2026-08-10                                                                                                                                                      |

---

## Preflight

```bash
psql "$PRODUCTION_READONLY_URL" -f scripts/production-cutover-preflight.sql | tee preflight-$(date -u +%Y%m%dT%H%M%SZ).log
```

Read-only throughout. Capture the whole output into the change record. The blocks that most often bite:

- **P8** — waiver signatures whose `(signup_id, project_id)` pair has no matching signup. The most likely failure in the set; it breaks a composite FK validation.
- **P11** — **this migration deletes production rows.** `20260712021110` runs `DELETE FROM public.user_emails WHERE verified_at IS NULL`. The pass criterion is not zero; it is that the number is understood, reviewed, accepted, and present in the backup. Sign it off explicitly by name.
- **P14** — auth emails owned by a different user. Not a migration error but a _silent_ one: the `ON CONFLICT` no-ops and those users end up with no primary email row.
- **P22** — the CSF surface must not already exist. Any non-NULL means something created it out of band, and `CREATE TABLE` without `IF NOT EXISTS` will fail with `42P07`. Stop and reconcile.
- **TM-1** — trusted-member adjudication. A self-grant produces a _consistent_ pair (`trusted_member.status` and `profiles.trusted_member` both true), because the sync trigger wrote the profile from the row — so looking for inconsistency finds nothing. The signal is the approval notification that every legitimate approval emits. Investigate rows with no approval notification **and** missing application content.

**Do not remediate trusted-member rows inside a migration.** Notifications are user-deletable, so there is no ground truth and a mass revoke would strip legitimate members. Revoking also does not undo the consequences — organizations and projects already created remain. Adjudicate by hand and remediate _after_ cutover through the existing admin path, which uses the service role and notifies the user.

---

## Rehearsal

**The Supabase `development` branch is not a rehearsal.** Its 272-migration
ledger proves ordered application against the Development database, not the
repository branch's Production-shaped 236→274 transition. It does not exercise
data-dependent DDL, lock behaviour at Production table sizes, or Production
data.

**Preferred path — a data-cloned branch from Production.**

1. `get_cost` → `confirm_cost` for a branch, and keep the `confirm_cost_id`. This is a _second_ concurrent branch alongside the persistent `development` one; budget for it and delete it promptly.
2. `create_branch({ project_id: 'fotdmeakexgrkronxlof', name: 'cutover-rehearsal-<date>', confirm_cost_id })`.
3. **Verify it is a clone, not a replay** — `list_migrations` on the new ref.
   - **236 rows, head `20260811001500`** → a genuine current-baseline clone.
     Continue.
   - **274 rows, head `20260812162732`** → it was built by replaying the
     repository branch, which is the artifact you already have and proves nothing new.
     Abandon and use the fallback.

   Do not skip this. It is the single most important step here.

4. Compare row counts for `auth.users`, `profiles`, `organizations`, `projects`, `project_signups`, `waiver_signatures`, `user_emails`, and the `dv_sd_*` tables against Production. Zero rows means schema-only — use the fallback.
5. Run the whole preflight against the branch and confirm it matches Production. This validates the preflight queries before they are pointed at the real thing.
6. Push, and time it:
   ```bash
   supabase link --project-ref <branch-ref>
   supabase db push --linked --dry-run      # expect exactly 38 pending
   time supabase db push --linked --yes 2>&1 | tee rehearsal.log
   ```
7. Capture: total and per-file wall clock; `SELECT ... FROM pg_index WHERE NOT
indisvalid` (must be empty); `verify-supabase-migration-parity.mjs`;
   `get_advisors` (compare with Development's 95 INFO/0 WARN/0 ERROR security
   and 611 INFO/0 WARN/0 ERROR performance snapshot); and
   `supabase db diff --linked` — compare that last one against the destructive
   drift recorded in
   [the redesign audit](../architecture/supabase-redesign-audit.md). **That diff
   is the artifact that retires the open drift item.**
8. Point a preview deployment of the release SHA at the branch and run `test:e2e:csf`, `plugin:test:isolation`, `dev:test:cron`, and the manual smoke list.
9. `delete_branch` as soon as it is signed off.

**Fallback**, if step 3 or 4 shows it is not a data clone: restore the backup
dumps into a local Postgres 17, seed `supabase_migrations.schema_migrations`
with Production's 236 versions, then dry-run and apply. Costs nothing and reuses
the backup artifacts — one exercise, two purposes.

Record the fallback's fidelity gap: local `auth`, `storage`, and `realtime` schemas are container-managed and will not match Production's GoTrue and Storage versions. Restore Production's `auth.users` **data** onto the local `auth` schema; never its DDL.

---

## Backup

Managed backups are not enough on their own, and a backup you have not restored is a hypothesis.

```bash
BK=~/lets-assist-backups/$(date -u +%Y%m%dT%H%M%SZ)   # outside the repository
mkdir -p "$BK"
supabase link --project-ref fotdmeakexgrkronxlof

supabase db dump --linked --role-only                        --file "$BK/roles.sql"
supabase db dump --linked                                    --file "$BK/schema_public.sql"
supabase db dump --linked -s plugin_data,private             --file "$BK/schema_plugins.sql"
supabase db dump --linked --data-only                        --file "$BK/data_public.sql"
supabase db dump --linked --data-only -s plugin_data,private --file "$BK/data_plugins.sql"
supabase db dump --linked --data-only -s auth                --file "$BK/data_auth.sql"
supabase db dump --linked --data-only -s storage             --file "$BK/data_storage_metadata.sql"
supabase migration list --linked --output-format json > "$BK/migration_list_before.json"

shasum -a 256 "$BK"/*.sql > "$BK/SHA256SUMS"
```

The `auth` dump is **not optional** — `20260712021110` reads `auth.users` directly. Do not substitute `supabase:dump:schema` or `dump:seed`; they cover only `public`.

Copy the non-regenerable storage buckets separately — `waivers`, `waiver-uploads`, `waiver-signatures`, `project-documents`, `data-exports` — via `rclone` or `aws s3` against the S3-compatible endpoint. `avatars`, `organization-logos`, and `project-images` are user-replaceable; record counts only if time is short.

**These dumps contain every user's email address and every signed waiver reference.** Treat them as the most sensitive artifact this project produces: never inside the repository, encrypted at rest, one copy in a separate access-controlled location, and a deletion date you actually honour.

Then restore them into a throwaway Postgres 17 and compare row counts for the top ~20 tables. That restore doubles as the rehearsal fallback.

---

## The window

**Length:** rehearsal-measured duration × 3, floor 90 minutes. The cost is dominated by the `CREATE UNIQUE INDEX CONCURRENTLY` builds and the full `user_emails` rewrite.

1. **T-24 h and T-1 h** — announce through `public.system_banners`.
2. **T-0** — enable maintenance mode. **Writes must stop.** That is what makes a PITR restore lossless; without it, a restore loses whatever was written after the restore point.
3. Snapshot `cron.job`, then unschedule active jobs. Note that `20260621210000` re-schedules two jobs _during_ the push, so restoration must reconcile against the post-migration state rather than blindly replaying the snapshot.
4. Confirm quiescence: no non-idle client backends.
5. Repair the collation version mismatch (expected — preflight E1 will show it).
6. **Dry-run, and read it.** `deploy-schema.yml` currently runs the dry-run and the push in the same step with no human read between them; splitting that is recommended secondary hardening. Until it is split, run the dry-run manually first.
7. Push via `workflow_dispatch` with `production_confirmation` = `deploy-production:fotdmeakexgrkronxlof`.
8. Deploy the application release. Schema and application are one release.
9. **Post-push verification**, in order:
   - `verify-supabase-migration-parity.mjs` — ledger parity
   - `SELECT ... FROM pg_index WHERE NOT indisvalid` — must be empty
   - `get_advisors(type: 'security')` — expect only the known `INFO`/`rls_enabled_no_policy` shape
   - Preflight **P15** re-run — `auth_users_with_email` should equal `primary_rows`, modulo any P14 conflicts
   - Storage bucket counts against the **S1** baseline
   - Upgrade DV installs to `2.0.0` through the leased control plane **before** enabling DV traffic
10. Smoke tests while still in maintenance mode, then again after opening: sign in, view a project, sign up for a project, an organization page, a CSF workspace, one email path.
11. Restore cron jobs by reconciliation.
12. Maintenance mode off. Watch advisors and logs for an hour.

---

## Rollback

There is no down migration.

| Situation                                           | Response                                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The push fails partway                              | Do not re-run blindly. Read which migration failed, fix forward, and re-run the dry-run                                                                  |
| The schema is applied but the application is broken | Roll the application back to the previous deployment only if it is compatible — after these grant revocations it generally is not. Prefer fixing forward |
| The data is wrong                                   | PITR restore to just before the window. **Lossless only if writes were stopped**                                                                         |
| An index is left invalid                            | Drop it and rebuild it outside the window; a failed `CONCURRENTLY` build leaves an invalid index behind                                                  |

---

## Footguns

- **Never `supabase db pull`.** [The redesign audit](../architecture/supabase-redesign-audit.md) recorded destructive drift in the generated diff. Pulling would import it.
- **Never edit a historical migration.** Fix forward.
- **`db:validate` is not the gate.** It checks filenames, duplicate timestamps, and a replay. `db:test:redesign` is the gate.
- **Merging to `main` does not deploy the schema.** It never has. Production requires a manual `workflow_dispatch` with the exact confirmation string.

## Related

- [Audit register, 2026-08-10](audit-register-20260810.md)
- [Supabase deployment workflow](supabase-deployment.md)
- [Deployment boundaries](deployment.md)
- [Supabase redesign audit](../architecture/supabase-redesign-audit.md)
