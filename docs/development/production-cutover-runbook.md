# Production cutover runbook

Production was verified read-only on 2026-09-01 in Supabase project
`fotdmeakexgrkronxlof` at 414 ordered migrations through
`20260829092823_publish_dvhs_csf_1_2_24`. The current repository
release candidate has exactly 443 ordered migrations through
`20260903043000_csf_source_key_contact_corroboration`, so the typed
read-only preflight pins an exact 29-migration tail. This count is a
repository contract, not proof of live Production state: re-run the read-only
preflight against the exact Production project immediately before the cutover.

The release tail includes the full CSF class, identity, application, workbook,
background import, communications, performance, and release-gating work through
the import mapping-version commit fence, queue-table privilege repair, and
atomic source-mapping version boundary. Hosted
Development database parity, exact served SHA, role-bound browser acceptance,
provider acceptance, and a fresh full 443-migration replay must all be recorded
before promotion. Until those gates are green, both the hosted and Production
release gates remain open.

**This runbook is preparation. Executing it requires explicit action-time
authorization** ([deployment boundaries](deployment.md)). Production remains
untouched. No release may proceed until hosted Development exact-SHA browser and
provider gates are green.

## Two facts that shape everything

**1. The schema push and the application deploy are one release, not two.**

The 22 pending migrations and their exact application release SHA must be
treated as one change. Do not push the schema independently or infer application
compatibility from the migration ledger. Schedule one window, with the exact
application release ready before the push starts.

**2. Migrations are forward-only.** There is no down migration. Recovery means
a corrective forward migration or the verified logical restore rehearsed for
this release. Never delete a migration that may have run remotely.

## Historical defects already closed in the Production baseline

Both were confirmed against Production by read-only catalog inspection during
the 2026-08-10 audit. Their forward fixes are now included in the current
Production baseline through `20260829092823`. Keep them in rehearsal coverage
because the cutover still builds on that baseline. See the
[audit register](audit-register-20260810.md).

- **AUD-001** — `public.trusted_member` accepts a client-supplied `status`, so any signed-in user who has not yet applied can self-grant trusted status and unlock organization and project creation.
- **AUD-002** — the `notifications` INSERT policy ends in `OR (auth.uid() IS NULL)`, so anyone holding the public anon key can inject a notification for any user, with an attacker-chosen title, body, and action URL.

The fixing migrations, `20260810220100` and `20260810220200`, are historical
context rather than part of the current 29-migration pending set.

---

## Pre-window gates

All must be green before a window is scheduled. Each is a stop, not a preference.

| #    | Gate                                                                                                                                                                 | How it is satisfied                                                                                                                                                                                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | The exact candidate has a green pull-request `quality` check, plus locally recorded full tests appropriate to the change, before `development` is merged into `main` | Pull requests run the short static and plugin-contract gate. Merging to `development` does not launch a duplicate full run. Use the manual `Code quality` workflow for a hosted full build/database rehearsal when needed; `deploy-schema.yml` independently runs the exact reset and pgTAP gate before a Production schema push.                                          |
| P-2  | `deploy-schema.yml` runs pgTAP                                                                                                                                       | **Done.** A `Run pgTAP database tests` step was added to `test-local-reset`, which `deploy-to-production` depends on. Before this, pgTAP ran only in `ci.yml` behind a paths filter and a `workflow_dispatch` deploy never re-ran it                                                                                                                                       |
| P-3  | The `production` GitHub Environment has named required reviewers                                                                                                     | The release and failed-release reconciler both declare `environment: production`. GitHub's environment review request is the recovery alert. A named reviewer must approve a queued failed-release recovery within five minutes. Protection rules and reviewer delivery live in repository settings, not in the repo                                                       |
| P-4  | Verified logical backup and restore rehearsal                                                                                                                        | PITR is intentionally not required for this release. Capture schema/data backups through the approved non-PITR path and prove they restore before cutover; rollback remains a corrective forward migration or verified restore.                                                                                                                                            |
| P-5  | Every blocking preflight in `scripts/production-cutover-preflight.sql` passes                                                                                        | See [preflight](#preflight). The script has no operator bypass for failed integrity checks                                                                                                                                                                                                                                                                                 |
| P-6  | Rehearsal complete on production-shaped data                                                                                                                         | See [rehearsal](#rehearsal)                                                                                                                                                                                                                                                                                                                                                |
| P-7  | Backup taken **and verify-restored**                                                                                                                                 | See [backup](#backup)                                                                                                                                                                                                                                                                                                                                                      |
| P-8  | The exact accepted tree has passed the Production-environment prebuild, and the staged immutable deployment will be health-checked before alias promotion            | A green `development` preview is required but does not replace the Production-environment build or staged health check                                                                                                                                                                                                                                                     |
| P-9  | Production Resend delivery lifecycle is proved end to end                                                                                                            | Configure the Production send-only key and webhook keyring separately. Enable the replacement endpoint, send controlled test-address messages, and prove queued, provider-accepted, signature-verified, and settled records before disabling the old endpoint. Keep the old webhook secret as a fallback for one release. Development evidence does not satisfy this gate. |
| P-10 | No `supabase config push` anywhere in automation                                                                                                                     | Verified absent from `.github/`, `scripts/`, and `package.json` as of 2026-08-10                                                                                                                                                                                                                                                                                           |

---

## Preflight

```bash
set -euo pipefail
psql -X "$PRODUCTION_READONLY_URL" \
  -f scripts/production-cutover-preflight.sql 2>&1 \
  | tee preflight-$(date -u +%Y%m%dT%H%M%SZ).log
```

Every check is `SELECT` or `SHOW` inside an explicit read-only transaction. The
script accepts only the exact 414-version Production baseline or exact
443-version target, exits non-zero on a partial or divergent ledger, and checks
relation existence before parsing shape-specific tables. `pipefail` preserves
that non-zero status through `tee`. Keep the raw log encrypted, access
controlled, outside the repository, and out of model prompts. Record only a
sanitized pass/fail summary and redacted blocker counts in the change record.

- **D1** blocks duplicate verified certificates before the pending unique index.
- **S0** inventories CSF relations before any CSF table is queried. A wholly
  absent or partial CSF shape fails with a named install/schema blocker because
  the pending CSF migrations reference those relations.
- **D2** blocks draft/open CSF communication work without its backend
  environment coordinate.
- **D3** blocks a second active reusable class link for one class and semester.
- **D4** blocks an existing organization whose normalized username collides
  with the static `create` or `join` route.
- **D7–D8** block post-reply tenant corruption and duplicate/unkeyed mutation
  receipts before `20260812152300` creates its validated FK and unique index.
- **D9** inventories external dependencies that would make
  `DROP EXTENSION ... RESTRICT` fail.
- **D10** mirrors the reviewed effective client-grant catalog before
  `20260812100900` revokes and rebuilds public relation ACLs.
- **D11** blocks a class-history source whose class belongs to a missing or
  different organization before the workbook-registry backfill.
- **D12** blocks duplicate non-null class-history profile-create request
  receipts before the request-identity constraint is installed.
- **T1–T10** run only on the 443 shape and prove target relations, expected
  validated constraints/indexes, the reporter-detachment behavior moderation
  evidence depends on, the server-only posture of the three content report
  functions, lifecycle transaction receipts and ACLs, the atomic AI quota
  receipt index, removal of `pg_graphql`, the fenced Google CAP RPC definitions
  and ACLs, public function/relation ACLs, storage posture, the central
  import identity-first/unknown-only settlement signatures and ACLs, and the
  service-only CSF post-mutation outcome resolver whose `manage_posts`
  reauthorization brackets the same-request advisory lock around a bounded
  receipt read, plus the indexed service-only feedback candidate boundary.

Do not run the script with a write-capable URL and do not remediate rows inside
the preflight. Resolve through the owning product/admin path or a separately
reviewed forward migration.

---

## Rehearsal

**The Supabase `development` branch is not a rehearsal.** Its current
hosted ledger proves ordered application against the Development database, but
it does not prove the repository branch's Production-shaped 414-to-443
transition. It does not
exercise data-dependent DDL, lock behaviour at Production table sizes, or
Production data.

**Preferred path — a data-cloned branch from Production.**

1. `get_cost` → `confirm_cost` for a branch, and keep the `confirm_cost_id`. This is a _second_ concurrent branch alongside the persistent `development` one; budget for it and delete it promptly.
2. `create_branch({ project_id: 'fotdmeakexgrkronxlof', name: 'cutover-rehearsal-<date>', confirm_cost_id })`.
3. **Verify it is a clone, not a replay** — `list_migrations` on the new ref.
   - **414 rows, head `20260829092823`** → a genuine current-baseline clone.
     Continue.
   - **443 rows, head `20260903043000`** → it was built by replaying the
     repository branch, which is the artifact you already have and proves nothing new.
     Abandon and use the fallback.

   Do not skip this. It is the single most important step here.

4. Compare row counts for `auth.users`, `profiles`, `organizations`, `projects`, `project_signups`, `waiver_signatures`, `user_emails`, and the `dv_sd_*` tables against Production. Zero rows means schema-only — use the fallback.
5. Run the whole preflight against the branch and confirm it matches Production. This validates the preflight queries before they are pointed at the real thing.
6. Push, and time it:
   ```bash
   set -euo pipefail
   supabase link --project-ref <branch-ref>
   supabase db push --linked --dry-run      # expect exactly 29 pending
   time supabase db push --linked --yes 2>&1 | tee rehearsal.log
   ```
7. Capture: total and per-file wall clock; `SELECT ... FROM pg_index WHERE NOT
indisvalid` (must be empty); `verify-supabase-migration-parity.mjs`;
   `get_advisors` (the recorded INFO/WARN/ERROR counts came from an older
   Development shape and are comparison evidence, not proof for the current
   hosted database or 443-migration repository target);
   and
   `supabase db diff --linked` — compare that last one against the destructive
   drift recorded in
   [the redesign audit](../architecture/supabase-redesign-audit.md). **That diff
   is the artifact that retires the open drift item.**
8. Point a preview deployment of the release SHA at the branch and run `test:e2e:csf`, `plugin:test:isolation`, `dev:test:cron`, and the manual smoke list.
9. `delete_branch` as soon as it is signed off.

**Fallback**, if step 3 or 4 shows it is not a data clone: restore the backup
dumps into a local Postgres 17, seed `supabase_migrations.schema_migrations`
with Production's 414 versions, then dry-run and apply. Costs nothing and reuses
the backup artifacts — one exercise, two purposes.

Record the fallback's fidelity gap: local `auth`, `storage`, and `realtime` schemas are container-managed and will not match Production's GoTrue and Storage versions. Restore Production's `auth.users` **data** onto the local `auth` schema; never its DDL.

---

## Backup

Managed backups are not enough on their own, and a backup you have not restored is a hypothesis.

```bash
set -euo pipefail
set +x
umask 077
: "${CSF_RELEASE_SHA:?set the exact checked-out main SHA}"
: "${CSF_APPROVED_ENCRYPTED_VOLUME:?set the exact approved encrypted volume mount path}"
: "${CSF_PRODUCTION_BACKUP_ROOT:?set an absolute backup root inside that volume}"
: "${CSF_BACKUP_AGE_RECIPIENT:?set the approved age recipient}"
: "${CSF_BACKUP_AGE_IDENTITY_FILE:?set the matching offline age identity path}"
: "${CSF_RESTORE_DATABASE_URL:?set a throwaway Postgres 17 restore target}"
: "${CSF_STORAGE_RCLONE_SOURCE:?set the protected Production storage source}"
: "${CSF_STORAGE_RCLONE_CRYPT_DEST:?set an approved rclone crypt destination}"

if [[ ! "${CSF_RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || \
  [[ "$(git rev-parse HEAD)" != "${CSF_RELEASE_SHA}" ]]; then
  echo "The recovery capture is not bound to the checked-out release SHA." >&2
  exit 1
fi
case "$CSF_APPROVED_ENCRYPTED_VOLUME" in
  /Volumes/*) ;;
  *) echo "The approved encrypted volume must be an explicit mounted volume." >&2; exit 1 ;;
esac
case "$CSF_PRODUCTION_BACKUP_ROOT" in
  /*) ;;
  *) echo "The backup root must be absolute." >&2; exit 1 ;;
esac

APPROVED_VOLUME="$(cd "$CSF_APPROVED_ENCRYPTED_VOLUME" && pwd -P)"
if [[ "$APPROVED_VOLUME" == "/Volumes" ]]; then
  echo "A specific encrypted volume must be approved." >&2
  exit 1
fi
diskutil info "$APPROVED_VOLUME" \
  | grep -Eq '^[[:space:]]*(FileVault|Encrypted):[[:space:]]+Yes$'
install -d -m 700 "$CSF_PRODUCTION_BACKUP_ROOT"
BACKUP_ROOT="$(cd "$CSF_PRODUCTION_BACKUP_ROOT" && pwd -P)"
case "$BACKUP_ROOT/" in
  "$APPROVED_VOLUME"/*) ;;
  *) echo "The backup root escaped the approved encrypted volume." >&2; exit 1 ;;
esac
if [[ "$(df -P "$APPROVED_VOLUME" | awk 'END {print $1}')" != \
  "$(df -P "$BACKUP_ROOT" | awk 'END {print $1}')" ]]; then
  echo "The backup root is not on the approved encrypted device." >&2
  exit 1
fi
REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
case "$BACKUP_ROOT/" in
  "$REPOSITORY_ROOT"/*) echo "Recovery artifacts cannot be stored in the repository." >&2; exit 1 ;;
esac
chmod 700 "$BACKUP_ROOT"

require_mode() {
  local path="$1"
  local expected="$2"
  if [[ "$(stat -f '%Lp' "$path")" != "$expected" ]]; then
    echo "A recovery artifact has unsafe filesystem permissions." >&2
    exit 1
  fi
}
require_mode "$BACKUP_ROOT" 700

CAPTURE_ID=$(date -u +%Y%m%dT%H%M%SZ)
BK="$BACKUP_ROOT/$CAPTURE_ID"
PLAIN="$BK/.plaintext"
if [[ -e "$BK" ]]; then
  echo "The recovery capture directory already exists." >&2
  exit 1
fi
install -d -m 700 "$BK" "$PLAIN"
require_mode "$BK" 700
require_mode "$PLAIN" 700
cleanup_plaintext() {
  find "$PLAIN" -type f -delete 2>/dev/null || true
  rmdir "$PLAIN" 2>/dev/null || true
}
trap cleanup_plaintext EXIT
export TMPDIR="$PLAIN"
supabase link --project-ref fotdmeakexgrkronxlof

supabase db dump --linked --role-only                        --file "$PLAIN/roles.sql"
supabase db dump --linked                                    --file "$PLAIN/schema_public.sql"
supabase db dump --linked -s plugin_data,private             --file "$PLAIN/schema_plugins.sql"
supabase db dump --linked --data-only                        --file "$PLAIN/data_public.sql"
supabase db dump --linked --data-only -s plugin_data,private --file "$PLAIN/data_plugins.sql"
supabase db dump --linked --data-only -s auth                --file "$PLAIN/data_auth.sql"
supabase db dump --linked --data-only -s storage             --file "$PLAIN/data_storage_metadata.sql"
supabase migration list --linked --output-format json > "$PLAIN/migration_list_before.json"

RCLONE_CRYPT_REMOTE="${CSF_STORAGE_RCLONE_CRYPT_DEST%%:*}"
if ! rclone config show "$RCLONE_CRYPT_REMOTE" > "$PLAIN/.rclone-destination" 2>/dev/null || \
  ! grep -Eq '^type = crypt$' "$PLAIN/.rclone-destination"; then
  echo "The storage destination is not an rclone crypt remote." >&2
  exit 1
fi
rm -f "$PLAIN/.rclone-destination"

STORAGE_BUCKETS=(
  waivers
  waiver-uploads
  waiver-signatures
  project-documents
  data-exports
)
for bucket in "${STORAGE_BUCKETS[@]}"; do
  rclone copy \
    "$CSF_STORAGE_RCLONE_SOURCE/$bucket" \
    "$CSF_STORAGE_RCLONE_CRYPT_DEST/$CAPTURE_ID/$bucket" \
    --immutable
done
rclone hashsum SHA-256 \
  "$CSF_STORAGE_RCLONE_CRYPT_DEST/$CAPTURE_ID" \
  --download | LC_ALL=C sort > "$PLAIN/storage_sha256.txt"

DATABASE_ARTIFACTS=(
  roles.sql
  schema_public.sql
  schema_plugins.sql
  data_public.sql
  data_plugins.sql
  data_auth.sql
  data_storage_metadata.sql
)
CAPTURE_ARTIFACTS=(
  "${DATABASE_ARTIFACTS[@]}"
  migration_list_before.json
  storage_sha256.txt
)
for name in "${CAPTURE_ARTIFACTS[@]}"; do
  source="$PLAIN/$name"
  if [[ ! -s "$source" ]]; then
    echo "A required recovery artifact is missing or empty." >&2
    exit 1
  fi
  age --encrypt --recipient "$CSF_BACKUP_AGE_RECIPIENT" \
    --output "$BK/$name.age" "$source"
  chmod 600 "$BK/$name.age"
  require_mode "$BK/$name.age" 600
  if ! age --decrypt --identity "$CSF_BACKUP_AGE_IDENTITY_FILE" \
    "$BK/$name.age" >/dev/null 2>&1; then
    echo "An encrypted recovery artifact is unreadable." >&2
    exit 1
  fi
  rm -f "$source"
done

# Restore the exact encrypted database artifacts through pipes. No decrypted
# dump is written outside the approved encrypted volume.
RESTORE_SQL_ARTIFACTS=(
  roles.sql.age
  schema_public.sql.age
  schema_plugins.sql.age
  data_auth.sql.age
  data_storage_metadata.sql.age
  data_public.sql.age
  data_plugins.sql.age
)
for artifact in "${RESTORE_SQL_ARTIFACTS[@]}"; do
  if ! age --decrypt --identity "$CSF_BACKUP_AGE_IDENTITY_FILE" \
    "$BK/$artifact" \
    | psql -X -q "$CSF_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 \
      >/dev/null 2>&1; then
    echo "The encrypted database capture did not restore cleanly." >&2
    exit 1
  fi
done
if ! age --decrypt --identity "$CSF_BACKUP_AGE_IDENTITY_FILE" \
  "$BK/migration_list_before.json.age" \
  | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
  echo "The encrypted migration inventory is unreadable." >&2
  exit 1
fi
if ! psql -X -Aqt "$CSF_RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "SELECT to_regclass('public.organizations') IS NOT NULL AND to_regclass('auth.users') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL AND to_regclass('plugin_data.csf_profiles') IS NOT NULL" \
  2>/dev/null | grep -qx t; then
  echo "The restored database is missing required release relations." >&2
  exit 1
fi
for bucket in "${STORAGE_BUCKETS[@]}"; do
  if ! rclone check \
    "$CSF_STORAGE_RCLONE_SOURCE/$bucket" \
    "$CSF_STORAGE_RCLONE_CRYPT_DEST/$CAPTURE_ID/$bucket" \
    --download --one-way >/dev/null 2>&1; then
    echo "The encrypted storage capture did not verify." >&2
    exit 1
  fi
done

VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg capture_id "$CAPTURE_ID" \
  --arg release_sha "$CSF_RELEASE_SHA" \
  --arg verified_at "$VERIFIED_AT" \
  --argjson database_artifact_count "${#DATABASE_ARTIFACTS[@]}" \
  --argjson storage_bucket_count "${#STORAGE_BUCKETS[@]}" \
  '{
    version: 1,
    captureId: $capture_id,
    releaseSha: $release_sha,
    verifiedAt: $verified_at,
    databaseArtifactCount: $database_artifact_count,
    storageBucketCount: $storage_bucket_count,
    artifactReadability: "verified",
    databaseRestore: "verified",
    storageCopy: "verified"
  }' > "$PLAIN/RESTORE.receipt.json"
age --encrypt --recipient "$CSF_BACKUP_AGE_RECIPIENT" \
  --output "$BK/RESTORE.receipt.json.age" "$PLAIN/RESTORE.receipt.json"
chmod 600 "$BK/RESTORE.receipt.json.age"
rm -f "$PLAIN/RESTORE.receipt.json"
if ! age --decrypt --identity "$CSF_BACKUP_AGE_IDENTITY_FILE" \
  "$BK/RESTORE.receipt.json.age" \
  | jq -e \
    --arg capture_id "$CAPTURE_ID" \
    --arg release_sha "$CSF_RELEASE_SHA" \
    '.version == 1
     and .captureId == $capture_id
     and .releaseSha == $release_sha
     and .artifactReadability == "verified"
     and .databaseRestore == "verified"
     and .storageCopy == "verified"' >/dev/null 2>&1; then
  echo "The encrypted restore receipt is invalid." >&2
  exit 1
fi

rmdir "$PLAIN"
trap - EXIT
ENCRYPTED_ARTIFACTS=()
for artifact in "${CAPTURE_ARTIFACTS[@]}"; do
  ENCRYPTED_ARTIFACTS+=("$artifact.age")
done
ENCRYPTED_ARTIFACTS+=(RESTORE.receipt.json.age)
if [[ "$(find "$BK" -maxdepth 1 -type f -name '*.age' | wc -l | tr -d '[:space:]')" != \
  "${#ENCRYPTED_ARTIFACTS[@]}" ]]; then
  echo "The encrypted capture contains an unexpected artifact set." >&2
  exit 1
fi
(
  cd "$BK"
  printf '%s\n' "${ENCRYPTED_ARTIFACTS[@]}" \
    | LC_ALL=C sort \
    | while IFS= read -r artifact; do
        test -s "$artifact"
        shasum -a 256 "$artifact"
      done
) > "$BK/CAPTURE.manifest"
chmod 600 "$BK/CAPTURE.manifest"
require_mode "$BK/CAPTURE.manifest" 600
for artifact in "${ENCRYPTED_ARTIFACTS[@]}"; do
  require_mode "$BK/$artifact" 600
done
(
  cd "$BK"
  shasum -a 256 CAPTURE.manifest > CAPTURE.manifest.sha256
  chmod 600 CAPTURE.manifest.sha256
  shasum -a 256 -c CAPTURE.manifest.sha256 >/dev/null
)
require_mode "$BK/CAPTURE.manifest.sha256" 600
CAPTURE_SHA256="$(awk 'NR == 1 {print $1}' "$BK/CAPTURE.manifest.sha256")"
[[ "$CAPTURE_SHA256" =~ ^[0-9a-f]{64}$ ]]
```

The `auth` dump is **not optional**. `20260712021110` reads `auth.users`
directly. Do not substitute `supabase:dump:schema` or `dump:seed`; they cover
only `public`.

The rclone destination must use its `crypt` backend. The encrypted
`storage_sha256.txt.age` inventory enumerates the five non-regenerable buckets,
and `rclone check` proves that the encrypted copy can be read. `avatars`,
`organization-logos`, and `project-images` are user-replaceable. Record counts
only if time is short.

**These dumps contain every user's email address and every signed waiver reference.** Treat them as the most sensitive artifact this project produces: never inside the repository, encrypted at rest, one copy in a separate access-controlled location, and a deletion date you actually honour.

The block fails before creating a receipt unless every encrypted artifact is
readable, every database dump restores into the throwaway Postgres 17 target,
the required restored relations exist, and every protected storage bucket
passes `rclone check`. It writes plaintext only beneath `PLAIN`, which resolves
inside the explicitly approved encrypted volume, and removes that directory
before creating the canonical manifest. The manifest lists every encrypted
database dump, the migration inventory, the storage inventory, and the
encrypted restore receipt in a fixed order. `CAPTURE.manifest.sha256` binds that
complete artifact set.

Read the first field of `CAPTURE.manifest.sha256` locally. Dispatch the release
with that lowercase digest and
`recovery-capture-verified:<exact main SHA>:<CAPTURE.manifest SHA-256>`. The
workflow accepts the receipt only when its SHA and digest match the release,
then stores both in the sanitized Production recovery manifest. Do not print,
upload, or attach the encrypted capture, its decrypted contents, or connection
values to the workflow log.

---

## The window

**Length:** rehearsal-measured duration × 3, floor 90 minutes. Use the timed
Production-shaped 414-to-443 rehearsal as the authority; the pending set's
validated constraints, index builds, ACL convergence, and cancellation-ledger
work determine this window. Do not reuse timing assumptions from migrations
already included in the 414 baseline.

1. **T-24 h and T-1 h** — announce through `public.system_banners`.
2. **T-0**: snapshot `cron.job`, then unschedule active jobs and stop every
   external writer, including the Vercel Cron Jobs listed in `vercel.json`.
   Restore schedules by reconciling the snapshot with the operator-approved
   current state instead of replaying it blindly.
3. Before the final capture, run
   `scripts/production/set-application-write-block.sh enable`, then run
   `scripts/production/verify-postgrest-write-block.sh`. Keep the block active
   through the release. Record `application-writes-blocked:<exact main SHA>`
   only after the fresh mutation is rejected with SQLSTATE `25006`.
4. Confirm quiescence before dispatch. The database guard blocks PostgREST
   application writes only. It does not block Supabase Auth, Storage, direct
   database sessions, or internal provider writers. Record
   `external-writers-stopped:<exact main SHA>` only after every external writer,
   including Vercel Cron Jobs, is stopped. The workflow rejects the release
   unless both receipts match the checked-out SHA, the PostgREST write block is
   still active, and no active or running `pg_cron` job remains.
5. After every application and external writer is stopped, take a final logical
   data capture with the commands in [backup](#backup), record its checksums,
   and prove each artifact is readable. This post-quiescence capture is the
   release recovery point. With quiescence held, its recovery point objective
   is zero application-data loss. Its recovery time objective is the duration
   measured by the restore rehearsal. Do not dispatch from an earlier backup.
6. Repair the collation version mismatch if preflight E2 reports it; the
   preflight will not pass while the mismatch remains.
7. **Dry-run, and read it.** Run the dry-run manually before dispatch. The
   workflow repeats it immediately before the push.
8. Merge the approved Production pull request with a merge commit. The `main`
   push does not trigger Vercel. Dispatch `deploy-schema.yml` with
   `production_confirmation` = `deploy-production:fotdmeakexgrkronxlof`, the
   exact accepted Development SHA, the application-write-block receipt, the
   external-writer receipt, the lowercase SHA-256 of the verified canonical
   `CAPTURE.manifest`, and the exact recovery-capture verification receipt. Do not
   use GitHub's re-run control for a
   failed or cancelled release. The workflow rejects later attempts before
   provider access because each recovery receipt belongs to one run attempt.
   Wait for the failed-release reconciliation, then start a fresh dispatch.
9. The workflow builds the exact Production application once. It stages a
   static maintenance artifact and the exact application without another
   build, proves the staged application's embedded SHA and Production
   environment, and retains a sanitized recovery manifest before arming the
   cutover. It then reasserts
   `authenticator.default_transaction_read_only=on`, terminates existing
   authenticator sessions, and proves a fresh PostgREST mutation returns
   SQLSTATE `25006`. It then promotes and verifies the maintenance alias before
   starting the migration push.
10. After schema parity, the workflow automatically reruns the full read-only
    preflight, then reuses that staged deployment and requires
    the environment, database, and deep-table checks from
    `/api/status?deep=1` to pass. It promotes the application and verifies the
    exact deployment at `lets-assist.com` while the write block remains active.
    Resetting the write block is the final release mutation. A post-block
    failure reasserts and proves the guard inline. The independent
    `workflow_run` reconciler then waits for the exact earlier Vercel operation
    to become terminal, restores the exact maintenance deployment, and proves
    the alias. Because the `production` environment requires reviewers, approve
    its GitHub environment review request within five minutes. The reconciler
    never reopens writes.
11. **Post-push verification**, in order:

- `verify-supabase-migration-parity.mjs` — ledger parity
- `SELECT ... FROM pg_index WHERE NOT indisvalid` — must be empty
- `get_advisors(type: 'security')` — expect only the known `INFO`/`rls_enabled_no_policy` shape
- Re-run `production-cutover-preflight.sql`; it must select the exact
  443-row target path and pass T1–T10
- Storage bucket counts against the **E7** baseline
- Upgrade DV installs to `2.0.0` through the leased control plane **before** enabling DV traffic

12. Smoke test the read paths while the write block remains active. All four
    CSF worker flags remain disabled through application promotion and write
    reopening. After the workflow verifies the final alias and opens writes,
    test sign-in, project signup, an organization page, and a CSF workspace.
13. Dispatch `enable-production-csf-worker.yml` four times from the exact
    Production `main` SHA. Select `workbook_refresh`, `import_commit`,
    `communications`, then `scheduled_post_publisher`, in that order. Each
    dispatch requires its own Production environment approval and confirmation
    `enable-csf-worker:<worker>:<exact main SHA>`. The workflow rejects a skipped
    or repeated stage, builds once outside Vercel, checks the staged worker
    posture, promotes it, and verifies both the Vercel alias record and the
    uncached public status response. A failed transition restores the prior
    deployment and disables the selected environment flag. After each success,
    verify one bounded run. Require import receipts before communications, prove
    one controlled email path before scheduled publishing, and do not combine
    these operations.
14. Restore other cron jobs by reconciliation.
15. Watch advisors and logs for an hour.

---

## Rollback

There is no down migration.

| Situation                                           | Response                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The push fails partway                              | Do not re-run blindly. Read which migration failed, fix forward, and re-run the dry-run                                                                                                                                                                                                              |
| The schema is applied but the application is broken | Roll the application back to the previous deployment only if it is compatible — after these grant revocations it generally is not. Prefer fixing forward                                                                                                                                             |
| The data is wrong                                   | Keep application and external writers stopped and restore the verified post-quiescence logical capture. Its recovery point is the final capture, and its recovery time is the rehearsed restore duration. Zero application-data loss applies only while quiescence was held from that capture onward |
| An index is left invalid                            | Drop it and rebuild it outside the window; a failed `CONCURRENTLY` build leaves an invalid index behind                                                                                                                                                                                              |

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
