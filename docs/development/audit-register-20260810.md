# Audit register, 2026-08-10

Scope: the `development` branch at `9b9abcd`, the hosted Supabase `development` branch (`ocbuygudvarsuxijxhau`), and read-only comparison against Production (`fotdmeakexgrkronxlof`).

Method: local gate execution, plus read-only catalog queries against both hosted databases. **No exploit was executed and no production row was written or read.** Every "Confirmed" below rests on catalog state (policies, grants, triggers, constraints) or on a local test run, not on an attempted attack.

Evidence: `.artifacts/audit-20260810/`.

The staged repository-wide program also generates a fresh source inventory with `bun run audit:inventory` under `.artifacts/audit/surface-inventory/`. The inventory records exact root/private commits, root dirty state, and a SHA-256 digest over every inventory input while keeping source discovery separate from runtime catalog and hosted Development evidence.

Priority scale: **P0** exploitable now against real users · **P1** security-relevant, not directly exploitable · **P2** correctness/maintainability · **P3** cosmetic or dead code.

---

## Summary

| ID                  | Pri | Area                   | Finding                                                                                                                | Status                                                       |
| ------------------- | --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [AUD-001](#aud-001) | P0  | Core RLS               | `trusted_member` INSERT policy has no `status` guard — self-granted trusted status                                     | **Fixed on `development`**; live in Production until cutover |
| [AUD-002](#aud-002) | P0  | Core RLS               | `notifications` INSERT policy ends in `OR (auth.uid() IS NULL)` — unauthenticated notification injection               | **Fixed on `development`**; live in Production until cutover |
| [AUD-003](#aud-003) | P1  | Grants                 | `public` defaults and existing relation/column ACL residue can expose client capabilities outside the reviewed catalog | Source fix amended; exact CI replay pending                  |
| [AUD-004](#aud-004) | P1  | Plugin audit           | `plugin_audit_logs_action_check` allows 22 values; the code emits 28 — six lifecycle events are silently unaudited     | **Fixed on `development`**                                   |
| [AUD-005](#aud-005) | P3  | Plugin RLS             | `organization_plugin_installs` is readable by ordinary members, including the whole `configuration` blob               | Reclassified — designed behaviour, document the contract     |
| [AUD-006](#aud-006) | P2  | Architecture           | Three `server-only` modules drive notifications through the **browser** Supabase client — the root cause of AUD-002    | **Fixed on `development`**                                   |
| [AUD-012](#aud-012) | P2  | Notifications          | The browser service suppresses any notification whose `(user_id, type)` pair already exists, with no other filter      | **Fixed locally**; hosted Development pending                |
| [AUD-015](#aud-015) | P1  | Hours publication      | Certificate publication trusts client identity and commits database/provider work non-atomically                       | **Fixed locally**; full and hosted Development gates pending |
| [AUD-016](#aud-016) | P1  | Stored HTML            | The DV form-editor preview inserted persisted rich-text help content without sanitization                              | **Fixed on `development`**; exact CI green                   |
| [AUD-017](#aud-017) | P1  | Next.js route contract | The paper-signup AI route exported an unsupported value, so clean isolated production builds failed type checking      | **Fixed on `development`**; exact CI green                   |
| [AUD-018](#aud-018) | P1  | Guardian form          | Hydration could replace a guardian's reviewed availability and notes with SSR defaults before submission               | **Fixed on `development`**; exact CI green                   |
| [AUD-030](#aud-030) | P0  | Server Actions         | File-level `"use server"` exposed internal waiver persistence and project-access helpers as direct POST surfaces       | **Fixed locally**; hosted Development pending                |
| [AUD-007](#aud-007) | P2  | CI                     | CI had been red since 2026-08-08 on an unpushed submodule ref, masking a failing test                                  | Fixed this session                                           |
| [AUD-008](#aud-008) | P2  | Architecture           | CSF's 78 sensitive tables have no second authorization layer — RLS is deny-all, all decisions live in TypeScript       | Confirmed, by design                                         |
| [AUD-009](#aud-009) | P1  | Gate coverage          | storage policy heuristics could miss broad client policies that reach every bucket, including server-only buckets      | Source re-amended after failed replay; rerun pending         |
| [AUD-010](#aud-010) | P3  | Moderation             | `content_flags` admin UPDATE policy tests `auth.jwt() ->> 'role' = 'admin'`, which is never true                       | Confirmed, dead policy                                       |
| [AUD-011](#aud-011) | P3  | Plugin control plane   | Advertised control-plane surfaces that no code path reads                                                              | Confirmed                                                    |
| [AUD-020](#aud-020) | P2  | Plugin data deletion   | Permanent deletion lacked a complete contract, authorization boundary, and truthful durable replay state               | **Fixed locally**; hosted Development pending                |
| [AUD-021](#aud-021) | P2  | Plugin uninstall       | Ordinary uninstall could run arbitrary plugin code and therefore could not guarantee data retention                    | **Fixed locally**; hosted Development pending                |
| [AUD-031](#aud-031) | P1  | Organization RLS       | Inactive membership rows still granted helper-backed tenant authority and could support self-reactivation              | **Fixed locally**; hosted Development pending                |
| [AUD-032](#aud-032) | P1  | Project status         | Browser writes could bypass cancellation atomicity or revive cancelled projects, and failures were console-only        | **Fixed locally**; hosted Development pending                |
| [AUD-033](#aud-033) | P1  | Recurrence             | Series ending and child generation lacked one serialized parent boundary and exposed a public definer                  | **Fixed locally**; hosted Development pending                |
| [AUD-034](#aud-034) | P1  | Cancellation worker    | Healthy pagination spent the abandoned-lease retry budget and could amplify retries                                    | **Fixed locally**; hosted Development pending                |

**Clean results worth recording:** all 176 base tables in `public` and `plugin_data` have RLS enabled (131 + 45, zero exceptions). The private buckets `csf-private`, `data-exports`, and `waiver-signatures` have **zero** `storage.objects` policies — service-role only, which is the correct posture. Hosted `development` security advisors return 90 lints, all `INFO`/`rls_enabled_no_policy` on `plugin_data.csf_*`, which is the intended deny-all design; zero `ERROR` or `WARN`.

**Static surface inventory, local only:** the initial generator run after rebasing over `development` `15ba480` and private gitlink `8efdc9a` found 46 route handlers, 351 exported Server Actions, 166 RPC call sites, 464 SQL function definitions (321 marked `SECURITY DEFINER`), 359 RLS policy definitions, 10 storage buckets, 12 cron routes, 2 webhook routes, 3 OAuth callback boundaries, 38 upload boundaries, 20 file-processing boundaries, and 8 service-role references. These are source-definition counts, not distinct effective database objects or proof of reachability. Generated JSON/Markdown remains ignored under `.artifacts/` and records the exact commit of each run.

---

## AUD-001 — `trusted_member` self-grant {#aud-001}

**Priority:** P0 · **Status:** Confirmed on Production and `development` · **Exposure:** live

`public.trusted_member` policy `trusted_member_insert_authenticated`:

```
WITH CHECK ((SELECT is_super_admin()) OR ((SELECT auth.uid()) = user_id))
```

No guard on `status`. The sibling UPDATE policy correctly carries `AND (status IS NULL)` — the INSERT policy simply missed it.

Chain:

1. `authenticated` holds `SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE` on the table (baseline ~line 3780), never revoked.
2. `trusted_member_set_user_id_trg` (BEFORE INSERT) forces `new.user_id` but never touches `new.status`.
3. `trg_tm_sync_profiles` (AFTER INSERT OR UPDATE OF status) calls `sync_profiles_trusted_from_tm()`, which sets `app.allow_trusted_sync` and writes `profiles.trusted_member = NEW.status`, deliberately bypassing `prevent_trusted_member_edit()`.

**Impact:** any signed-in user who has not yet applied can insert their own row with `status = true` and self-approve, unlocking organization creation and project creation. One-shot per user (bounded by `trusted_member_user_id_unique`), available to every new signup.

**Coverage gap:** no pgTAP file references `trusted_member`.

**Fix:** two independent guards — restore the `status IS NULL` predicate on the INSERT policy, and extend `trusted_member_set_user_id()` to raise (never coerce) on a non-null `status` from a non-super-admin. Coercing would let RLS pass and hide the attempt, because `WITH CHECK` is evaluated on the post-BEFORE-trigger row. Optionally replace the table-wide grant with column grants. Full specification in the implementation plan, Task 5.2.

**Scheduling decision:** bundled into the production cutover rather than hotfixed, by explicit decision. `supabase db push` has no per-migration selector, so shipping it alone through the existing pipeline is not possible; the only alternative is an out-of-band `CREATE POLICY`. The migration is written to be idempotent so an out-of-band application would later re-apply as a no-op. **The hole remains open until the cutover completes.**

---

## AUD-002 — Unauthenticated notification injection {#aud-002}

**Priority:** P0 · **Status:** Confirmed on Production and `development` · **Exposure:** live

`public.notifications` has exactly one INSERT policy, `Insert own or by project owner`, permissive, with roles `anon, authenticated, authenticator, dashboard_user`:

```
WITH CHECK (
      ((SELECT auth.uid()) = user_id)
   OR (EXISTS (SELECT 1 FROM project_signups ps JOIN projects p ON p.id = ps.project_id
               WHERE ps.user_id = notifications.user_id
                 AND p.creator_id = (SELECT auth.uid())))
   OR ((SELECT auth.uid()) IS NULL)          -- unconditionally true for anon
)
```

`anon` holds `INSERT` on the table (verified on Production). No restrictive policy exists.

**Impact:** anyone holding the public anon key — which ships in the browser bundle — can insert arbitrary rows into `notifications` for **any** `user_id`, with attacker-controlled `title`, `body`, `severity`, and `action_url`. That is in-product phishing: a message delivered through the platform's own trusted notification UI, with a clickable attacker-chosen destination.

Reads are correctly scoped (`SELECT` uses `auth.uid() = user_id`), so this is write-only injection — an attacker cannot read other users' notifications.

**Why the clause exists:** see AUD-006. It is load-bearing for two `server-only` modules that reach the database through the browser client, where `auth.uid()` is NULL.

**Fix (ordered — the code change must land first):**

1. Route `app/projects/[id]/server/cancellation.ts` and `app/admin/moderation/server/notifications.ts` through the admin client, e.g. the existing `createServerNotification` in `app/admin/server/shared.ts:99`.
2. Drop the `OR ((SELECT auth.uid()) IS NULL)` disjunct in a forward migration.
3. Add `supabase/tests/database/notifications_rls.test.sql` asserting that `anon` cannot insert, that an authenticated user cannot insert for another user, that a project creator still can insert for a signed-up attendee, and that reads stay self-scoped.

Reversing this order breaks project cancellation and moderation notifications.

---

## AUD-003 — `public` default privileges still grant clients everything {#aud-003}

**Priority:** P1 · **Status:** Source fix amended; exact CI database replay pending

Baseline `20260325181408` (~lines 3836-3847) still carries:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO anon;
-- and the same to authenticated, plus GRANT ALL ON FUNCTIONS to both
```

The `plugin_data` equivalent was revoked by `20260701054111`; `public` was not. Twenty-three `public` tables currently carry `anon` INSERT/UPDATE/DELETE grants purely from this default, including `certificates`, `profiles`, `projects`, `notifications`, `trusted_member`, and `content_reports`. Only RLS stands between a new table and the open internet.

The FUNCTIONS half is the more valuable fix: `GRANT ALL ON FUNCTIONS TO anon` means every new function — including every `SECURITY DEFINER` function — is anon-executable by default, which this repo has had to claw back three separate times (`20260701040027`, `20260701051022`, `20260802195500`).

**Blast radius of fixing it: zero at cutover.** `ALTER DEFAULT PRIVILEGES` affects only objects created after it runs, and every existing object carries explicit grants.

**Status after implementation — the table, sequence, and function halves are merged on `development`; shared Development catalog verification is still pending.**

`20260810220400_revoke_public_default_privileges.sql` revokes the TABLES and SEQUENCES defaults for grantors `postgres` and `service_role`. `public_default_privileges.test.sql` proves the property that matters: a freshly created `public` table is unreadable and unwritable by both `anon` and `authenticated`.

The function half is closed without a broad DDL event trigger. `20260811074518_public_rpc_acl_allowlist.sql` explicitly revokes `PUBLIC`, `anon`, and `authenticated` execution from 18 trigger or maintenance functions, then normalizes the reviewed callable catalog to seven signatures and eight signature/role pairs. Only `get_public_attendees(uuid)` is callable by both `anon` and `authenticated`; the six RLS helpers are `authenticated` only.

`public_function_acl_allowlist.test.sql` compares effective client privileges, including inherited `PUBLIC` grants, to that exact catalog and separately proves that the maintenance functions are not client-executable. `audit-supabase-architecture.sh` performs the same catalog comparison as a hard gate, and `AGENTS.md` now requires every new or replaced SQL function to carry explicit reviewed `REVOKE`/`GRANT` statements and update the allowlist when client-callable.

The remaining half is **existing-object ACL residue** on already-created `public` tables and views: historical defaults left full `anon`/`authenticated` DML (plus `TRUNCATE`/`REFERENCES`/`TRIGGER` residue) on objects that RLS never intended to expose. That is distinct from the merged default-privilege closure, which only affects objects created afterward. The amended `20260812100900_public_client_relation_acl_catalog.sql` treats relation ACLs and independent `pg_attribute.attacl` entries as separate layers. Independently of the storage policy catalog, it preflights every reviewed relation capability with effective privilege checks, revokes direct relation and column ACLs for `PUBLIC`, `anon`, and `authenticated`, restores only identifier-quoted catalog grants, and verifies exact direct ACL shape and effective privileges including PUBLIC and role inheritance. `client_relation_grant_catalog.test.sql` and the architecture audit exercise the same direct/effective distinction, including redundant column grants hidden beside whole-table grants. The amended migration has not yet been replayed, so AUD-003 remains open pending the exact CI database replay and pgTAP gate.

Earlier local evidence on 2026-08-11 covered the pre-review implementation only. It is retained as historical evidence but does not validate the amended column-ACL reconciliation. No hosted or Production conclusion follows from it.

One deliberate exclusion remains: `supabase_admin`'s default ACLs also name `anon` and `authenticated`. Hosted migrations execute as `postgres`, which cannot alter another role's defaults on Supabase. The effective callable-catalog gate covers the resulting runtime posture instead.

GitHub evidence on 2026-08-11: PR #117 merged as `15ba480` after quality/build, GitGuardian, Supabase Preview, and the full isolated database/DV/CSF browser replay passed. Vercel Development deployment `dpl_GS7WcMq2tN62ZiuetZLmutCpUJAa` is READY for that exact commit and aliased to `dev.lets-assist.com` without an alias error. The PR Preview build remained deliberately fail-closed until an exact non-Production Supabase ref was available.

**Still to do:** first pass the exact CI database replay and amended pgTAP contract, then verify the shared hosted Development migration ledger and effective callable catalog and rerun Development advisors. The Supabase connector currently exposes only the excluded Production project, so no fallback query was attempted. Production remains a separate excluded cutover.

---

## AUD-004 — Six lifecycle audit events are silently discarded {#aud-004}

**Priority:** P1 · **Status:** Confirmed

`plugin_audit_logs_action_check` permits exactly 22 values. `lib/plugins/*.ts` emits 28. The six that will always violate the constraint:

`lifecycle.config_update` · `lifecycle.version_update` · `lifecycle.data_delete` · `lifecycle.project_create` · `lifecycle.project_clone` · `lifecycle.signup`

`logPluginAudit` catches the resulting `23514`, logs to `console.error`, and returns `null`. So configuration changes, version updates, **plugin data deletion**, project create/clone, and signup lifecycle events produce no audit row at all. Data deletion going unaudited is the serious one.

**Fix:** forward migration replacing the CHECK with all 28 values (never edit `20260404010400`); pgTAP asserting every emitted value inserts; and make `logPluginAudit` surface constraint violations rather than swallowing them, so a future mismatch is loud. Plan Task 2.1.

---

## AUD-005 — Plugin install configuration is member-readable {#aud-005}

**Priority:** P3 (revised down from P2) · **Status:** Confirmed, but reclassified as a contract, not a defect

`organization_plugin_installs` has one SELECT policy, `Plugin installs readable by org members`, whose `USING` admits roles `admin`, `staff`, **and `member`**. The row includes the whole `configuration` JSON blob, while the server action `getOrganizationPluginSettings` restricts the same data to admins.

**Revised after attempting the fix.** The obvious remedy — revoking the `configuration` column from `authenticated` — would break working features. Two private plugins read that column with the **member's own** session client:

- `lib/plugins/private/plugins/dv-speech-debate/membership-flow.ts:393` — `.select("configuration")`
- `lib/plugins/private/plugins/dvhs-csf/services/communications-access.ts:102` — `.select("configuration")`

Member-readable configuration is therefore **designed behaviour** that plugins depend on, not an oversight. The correct reading of this finding is not "the database is more permissive than the app" but "the settings action is stricter than the data model, and plugins rely on the looser model."

The residual risk is narrower and real: **any plugin that stores a secret, a token, or an authorization-relevant allowlist in `configuration` is exposing it to every member of that organization.**

**Resolution:** no migration. Document the constraint as part of the plugin contract — `organization_plugin_installs.configuration` is member-readable; it is for settings, never for secrets or authorization data. This belongs in the plugin install guide and in `docs/development/private-plugins.md`. Revisit only if a plugin needs privileged configuration, at which point the right shape is a separate server-only table rather than a column revoke.

---

## AUD-006 — `server-only` modules use the browser Supabase client {#aud-006}

**Priority:** P2 · **Status:** Confirmed · **Root cause of AUD-002**

`services/notifications.ts` builds its client with `createClient()` from `@/lib/supabase/client` — the browser client. It is imported by two modules that declare `import "server-only"`:

- `app/projects/[id]/server/cancellation.ts` (also `"use server"`)
- `app/admin/moderation/server/notifications.ts`

In a server context that client carries no cookie session, so `auth.uid()` is NULL — and the `OR (auth.uid() IS NULL)` disjunct in AUD-002 is precisely what makes their inserts succeed. The permissive RLS clause exists to compensate for the wrong client.

Also noted: the user-ID mismatch check immediately above the insert in `services/notifications.ts` is commented out, leaving RLS as the only check.

**Fix:** give the server callers an admin-client path (reuse `createServerNotification`), then remove the RLS escape hatch. A module-boundary test in the style of the existing `*/module-boundaries.test.ts` files should assert that no `server-only` module imports `@/lib/supabase/client`.

---

## AUD-007 — CI was red for two days, masking a failing test {#aud-007}

**Priority:** P2 · **Status:** Fixed this session

Run `31282082002` (2026-08-08) and every run after it failed after ~58s with:

```
fatal: remote error: upload-pack: not our ref dc4f1ff969565ece4fab925aae435c212fc33d4b
```

`dc4f1ff` is one of seven `csf-class-feed-and-cohort-hub` commits in the private submodule that existed only on this machine. The root repository's gitlink referenced them, so both the `quality` and `db-replay-validation` jobs died at submodule checkout — before running a single gate.

Because CI never reached the test step, it never reported that `lib/auth/local-dev-origin.test.ts` had been failing since 2026-08-06, when `dbf172a` moved the isolated stack to a per-run allocated `APP_PORT` while the test still pinned the literal `http://localhost:3000`.

**Resolution:** the submodule work was published (`lets-assist-plugins` PR #13) and the gitlink moved onto a merged commit; the test now asserts the port contract — that `APP_PORT` defaults to 3000 and every emitted origin derives from it — instead of a literal.

**Standing lesson:** a submodule commit must be pushed _before_ the root gitlink that references it, or CI cannot check out the tree and every gate result becomes vacuous.

---

## AUD-008 — CSF has no second authorization layer {#aud-008}

**Priority:** P2 · **Status:** Confirmed, by design — recorded, not "fixed"

All 131 `plugin_data` tables have RLS enabled. The 78 `csf_*` tables have RLS enabled and **zero policies**, combined with revoked schema `USAGE` and revoked table grants for `anon` and `authenticated`. Only `service_role` reaches them.

That is a correct and defensible deny-all posture, and it is what produces the 90 `INFO` advisor lints. But the honest characterization is: _CSF data is RLS-protected in the sense that RLS denies everyone; it is not RLS-authorized._ Every real authorization decision — which chapter, which term, which role, which permission — lives in TypeScript. A missed check in a server action is not caught by a second layer.

`plugin_data.csf_assert_import_actor` is the one SQL-level actor guard and is the model the rest could follow.

**Recommendation:** no change in this pass. Track as an architectural risk. If it is ever addressed, the highest-value targets are the consequential transitions — term close/reopen, application decisions, point crediting — where a SQL-side actor assertion would be cheap relative to the blast radius.

---

## AUD-009 — Storage policy drift detection was fail-open {#aud-009}

**Priority:** P1 · **Status:** Source fix re-amended after failed replay; exact CI database replay pending

`scripts/audit-supabase-architecture.sh` (~lines 302-368) enumerated nine expected buckets and already included `plugin_form_uploads`, but it omitted `csf-private` and `paper-signup-scans`. The property-drift query used a catalog-to-live `LEFT JOIN`, so buckets present in `storage.buckets` but absent from the allowlist were invisible. The server-only client-policy pattern matched only `data-exports` and `waiver-signatures`, so a new client policy on `csf-private` would also have stayed green.

The first catalog fix still classified policies by searching deparsed SQL for bucket literals. That remained fail-open: an additional authenticated `USING (true)` policy, a policy with no bucket predicate, or a policy granted to `PUBLIC` could make server-only objects client-reachable without matching the heuristic's expected text.

**Resolution:** `20260812100800_client_acl_and_storage_posture_catalogs.sql` adds `app_private.storage_bucket_posture_catalog()` as the reviewed source for all eleven buckets, their public/MIME/size properties, and posture classes: six `public`, two `private-client` (`paper-signup-scans`, `plugin_form_uploads`), and three `server-only` (`csf-private`, `data-exports`, `waiver-signatures`). The amended migration now converges every client-reachable `storage.objects` policy before recreating the complete 21-policy browser surface, then snapshots its canonical `pg_policy` identity, command, role array, permissive/restrictive shape, `USING`, and `WITH CHECK` expressions. The architecture gate rejects every missing, changed, or unnamed client-reachable policy, including `PUBLIC` and inherited role reachability; therefore a broad `USING (true)` policy or any policy reaching a server-only bucket cannot be admitted by naming or bucket-text heuristics. The catalog still preserves the reviewed public-bucket write policies and the seven exact private-client policies.

The first exact clean replay of that stronger contract aborted with 30 violations. Fifteen policies that recheck organization membership, project authority, waiver references, or paper-scan authority were captured by `pg_get_expr()` under the migration session search path but compared inside a function with `search_path = ''`; each identical policy was therefore reported once as missing and once as unexpected. The six UID/path-only policies did not reference search-path-sensitive objects. The re-amendment routes capture and comparison through one fixed-search-path live-policy reader, retains exact expressions, and adds a pure historical-ledger inventory covering every role, command, bucket, predicate side, permissive shape, and intended owner. This is source evidence only until replayed.

Earlier local evidence on 2026-08-11 covered the weaker pre-review policy heuristic only. The amended 25-assertion pgTAP contract proves `storage.objects` RLS is enabled and adds fixed-context deparse checks plus adversarial probes for broad authenticated access, missing bucket predicates, `PUBLIC`, inherited-role reachability, command/role/expression/shape drift, valid private-client policies, and zero server-only exposure. The re-amended migration and pgTAP have not been replayed after the recorded 30-violation failure. AUD-009 remains open until the mandatory exact isolated/CI database replay and pgTAP gate pass.

---

## AUD-010 — `content_flags` admin policy can never be true {#aud-010}

**Priority:** P3 · **Status:** Confirmed, dead policy

```
Allow admin to update flags — UPDATE, PUBLIC
USING/WITH CHECK: ((SELECT auth.jwt()) ->> 'role') = 'admin'
```

In Supabase the top-level `role` JWT claim is the Postgres role — `anon`, `authenticated`, or `service_role`. It is never `admin`, and it is signed, so a client cannot forge it. The policy is therefore unreachable: no client can ever update a content flag through it. Moderation works only because the server paths use the admin client.

Not exploitable, but misleading — it reads as though client-side admin moderation is supported. Note that `audit-supabase-architecture.sh` already rejects policies referencing `user_metadata`; this uses the top-level `role` claim, which that check does not cover.

**Fix:** drop the policy, or rewrite it against `public.is_super_admin()`, which is the repo's actual super-admin predicate. Extend the architecture audit to reject `auth.jwt() ->> 'role'` as an authorization source.

---

## AUD-011 — Advertised control-plane surfaces that nothing reads {#aud-011}

**Priority:** P3 · **Status:** Confirmed

Present in schema and, in several cases, in the admin UI — but consulted by no code path:

| Surface                                                                       | Reality                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.plugin_versions`                                                      | The `draft → review → published/rejected` workflow, `commit_sha`, `published_by`, `review_notes` are all inert. Its RLS is `FOR SELECT USING (true)` for every role, contradicting its own "platform admins can manage" comment. |
| `organization_plugin_feature_flags` + `rollout_percentage`                    | **Feature gating is unimplemented.**                                                                                                                                                                                             |
| `organization_plugin_installs.auto_update`                                    | Never read.                                                                                                                                                                                                                      |
| `organization_plugin_data_boundaries`, `organization_data_isolation_profiles` | Surfaced in the admin UI; never consulted by any enforcement path, despite the developer docs calling a missing boundary row "a schema/process bug".                                                                             |
| `validatePluginUninstall`                                                     | Always returns `canUninstall: true`, and the transition path never calls it.                                                                                                                                                     |
| `createPluginRegistry(..., allowList)`                                        | Always invoked with `null`.                                                                                                                                                                                                      |
| `syncRegisteredPluginRuntimeContracts()`                                      | Runs only when a super admin loads `/admin/plugins`, so `plugin_runtime_contracts` is stale by default, and it silently skips any registered plugin with no catalog row.                                                         |
| `renderOrganizationPluginPage`                                                | Still carries a "no renderer is registered yet" placeholder branch.                                                                                                                                                              |

**Recommendation:** do not build these speculatively. Decide per surface whether to implement or remove, and until then make sure the plugin install documentation (plan Task 3.3) states plainly which of them do not work, so operators do not rely on them.

**Related failure-mode notes (P2, not separately numbered):** `loadAccessibleOrganizationPluginAccess` defaults to `failureMode: "empty"`, so every caller except `renderOrganizationPluginPage` turns a database outage into "you have no plugins"; and `resolveOrganizationPlugins`, `resolveOrganizationPluginExperiences`, and `resolve-platform-surfaces` fall back from the admin client to the user's client on throw, which under RLS silently drops every private plugin for a plain member — failing closed, but indistinguishably from "not entitled".

---

## AUD-012 — Repeat notifications are silently suppressed {#aud-012}

**Priority:** P2 · **Status:** Fixed locally; hosted Development pending

`services/notifications.ts` checks for an existing notification before inserting:

```ts
.from("notifications").select("id")
  .eq("user_id", userId).eq("type", notification.type).limit(1)
```

There is no filter on `read`, `displayed`, or `created_at`, and `type` only ever takes three broad values (`general`, `project_updates`, `email_notifications`). So a user who has _ever_ received a `project_updates` notification never receives another one. A volunteer whose signup is rejected twice is told once, forever.

The check was almost certainly written for `checkUsernameSetting`'s one-time "set a custom username" nudge, where suppressing repeats is correct, and then applied to every caller.

`services/notifications-server.ts` deliberately omits it, so cancellation and moderation notifications now deliver per event. The browser path — used by `SignupsClient.tsx` — is unchanged and still suppresses.

**Resolution:** notification creation now accepts an optional caller-owned
`dedupeKey`. Missing keys bypass deduplication entirely, so independent events
of the same broad type remain repeatable. A non-null key is unique per recipient
through the partial `notifications_user_dedupe_key_unique` index. Browser and
server delivery classify only a conflict from that named index as a successful
replay; unrelated `23505` errors still surface. The custom-username nudge uses
the stable `account:set-custom-username` key, and its lookup/display update is
scoped to that key rather than every `general` notification.

**Local evidence, 2026-08-10:** the forward migration replayed successfully from
the local ledger; `notification_dedupe_keys.test.sql` passed 8 focused pgTAP
assertions; the full isolated database gate passed 83 files / 3,752 assertions,
clean local advisors, architecture/plugin audits, and the 373-assertion cron
no-egress probe; the browser and server notification suites passed 17 tests;
`format:check`, `lint`, `typecheck`, `security:audit`, and the strict
private-gitlink check passed. The generated isolated stack was removed with no
Docker residue. No hosted database was mutated in this verification. Hosted
Development remains pending, and Production was not read, written, queried,
deployed, or tested.

**Related, not yet investigated:** `app/projects/[id]/hours/actions.ts` inserts volunteer notifications with the publisher's session client. The surviving policy branch requires `p.creator_id = auth.uid()`, so a **staff manager** publishing hours for a project they did not create would fail that insert. This predates today's change — the removed `auth.uid() IS NULL` disjunct never applied there, since a session is always present — but it should be confirmed against a `can_be_managed_by_staff` project.

---

## AUD-015 — Volunteer-hours publication is non-atomic and trusts client identity {#aud-015}

**Priority:** P1 · **Confidence:** confirmed · **Status:** Fixed locally; hosted
Development gates pending

**Blast radius:** every manual project-session hours publication. The prior
Server Action accepted browser-supplied `userId`, name, email, duration, and
session data; inserted all certificates; separately updated `projects.published`;
looked up a new certificate by volunteer name for in-app notification; then sent
email sequentially without a receipt or provider idempotency key. A failed
publish-state update left committed certificates behind, an action retry could
create duplicates, two same-named volunteers could be paired to one certificate,
and provider ambiguity had no durable reconciliation state.

**Evidence provenance:** local source trace plus an empty migration replay and
synthetic database fixtures only. No hosted database, provider, browser session,
credential, real recipient, or Production surface was used. The synthetic
fixtures include staff-managed authorization, two distinct users with the same
display name, forged cross-project signup/session input, an excessive duration,
rounded-zero and exact-over-24-hour input, fractional-minute notification text,
exact replay, idempotent provider settlement, immutable provider-payload replay
across simulated deployment drift, canonical session aliases, and real
multi-connection project/signup/membership lock races.

**Resolution:** `publishVolunteerHours(projectId, sessionId, sessionData)` keeps
its three-argument public signature and compatibility result fields, but reduces
the browser payload to signup ID plus check-in/out timestamps and derives a
deterministic request key. The reviewed authenticated RPC locks the project,
locks and rechecks creator/admin/active-staff authority and
`can_be_managed_by_staff`,
normalizes legacy session IDs, validates 1–500 exact project/session signups and
rounded-positive ranges no longer than exactly 24 hours, locks every referenced signup before
eligibility checks, derives identity from profile/anonymous-signup rows, and
atomically writes signup times, verified certificates under the canonical
session key, publish state, deduplicated in-app notifications, a receipt, and
one email outbox row per certificate. Notification hours/minutes are decomposed
from the same rounded total used by the publication review.

The forward migration aborts if duplicate verified certificates already exist;
it deletes or rewrites no evidence. A partial unique index prevents future
duplicates. Email work is claimed once with a UUID token and settled to
`accepted`, `retryable_failure`, `definitive_failure`, `unknown_outcome`, or
`skipped`. Only a proven pre-send refusal remains retryable. The published
session's resend action first drains only queued/retryable durable work. An
interrupted processing claim becomes explicitly reclaimable after 15 minutes
using the same deterministic provider key, but only inside Resend's documented
24-hour idempotency window; older ambiguous work terminalizes as
`unknown_outcome` instead of risking a duplicate. The immutable
`first_attempt_at` anchors that 24-hour boundary while `last_attempt_at` renews
only the 15-minute processing lease, so repeated reclaims cannot slide the
provider-safety window. Before any claim, a
service-only RPC stores a first-writer-wins, integrity-hashed snapshot of the
exact recipient, sender, subject, rendered HTML, and tags. Recovery replays that
snapshot instead of today's project, template, site URL, or environment, so the
same provider key never carries a changed payload. Settlement retries are
bounded and claim-token idempotent, so a lost successful database response
cannot overwrite the provider outcome. Provider calls use the
certificate-derived key and synthetic workflow/receipt tags.

The Server Action also normalizes accepted client timestamps to ISO millisecond
precision before hashing or calling the RPC. This keeps JavaScript validation
and PostgreSQL rounded-minute validation aligned when a database-originated ISO
value contains microseconds.

The verified-signup uniqueness arbiter is also used by a service-only
supplemental issuance RPC for paper signups committed after publication. Its
single `INSERT ... ON CONFLICT` statement skips only a concurrently issued
signup and still returns unaffected certificates for notification and email;
the prior check-then-batch-insert race is gone. A settlement classified as a
confirmed pre-send refusal clears the provider-risk anchor, so a delayed retry
starts a fresh 24-hour window without weakening ambiguous-outcome handling.

**Local verification, 2026-08-11:** empty ledger replay passed; the focused
publication pgTAP file passed 48 assertions; action boundaries, all five email
outcome mappings, publication-outcome precedence, bounded settlement retries,
payload parsing, snapshot-before-claim ordering, and supplemental issuance boundaries passed 16 tests; five exact-duration and timestamp-normalization tests passed;
TypeScript passed; and the loopback-only multi-session probe
proved accepted/replayed serialization plus concurrent signup rejection and
membership revocation winning before publication.
The full generated isolated gate then passed 85 pgTAP files / 3,783 assertions,
synthetic DV and CSF database workflows, zero-issue local advisors, architecture
and plugin-isolation checks, strict private-gitlink validation, static checks,
and the 373-assertion cron authentication/no-egress probe; teardown proved that
no owned container, volume, network, or temporary work directory remained.
GitHub, Vercel Development, Supabase Development, Mailpit/Resend test-event, and
browser acceptance gates remain open for the amended exact commit. After the
review hardening, the complete 2,908-test / 173-file root/plugin unit
orchestrator, the CI-shaped local Next.js build, the 21 focused tests,
formatting, lint, TypeScript, migration replay, 53 pgTAP assertions, and the
expanded publication, wall-clock lock-wait boundary, and deterministically
synchronized supplemental-issuance concurrency probes all passed.
Production remains excluded.

---

## AUD-016 — DV form-editor preview rendered stored HTML unsafely {#aud-016}

**Priority:** P1 · **Confidence:** Confirmed · **Blast radius:** authenticated
DV form editors who open a stored field preview

`DvFormFieldBlock.tsx` inserted the persisted `field.helpText` value with a
direct `dangerouslySetInnerHTML` call. The adjacent form editor permits rich
text updates to that field, so executable markup persisted by one authorized
editor could run when another editor opened the preview. The public form
renderers escaped help text as text; this finding was limited to the private DV
editor surface, not every form respondent.

**Resolution:** private PR #20 replaced the raw sink with the shared
`RichTextContent` boundary, whose client sanitizer allowlists formatting tags,
anchor attributes, and `http`, `https`, `mailto`, and `tel` schemes. The private
regression forbids a direct HTML sink in the field block. Root behavior coverage
proves that scripts, event handlers, inline styles, images, and `javascript:`
links are removed while reviewed formatting and HTTPS links remain.

**Evidence, 2026-08-11:** private commit `a465266` passed its focused 4-assertion
contract, Prettier, root integration lint and typecheck, GitGuardian, and an
exact-commit Codex review with no major issue. It merged to private
`development` as `711c848`. Root PR #122 kept that exact gitlink and added two
sanitizer behavior tests; it merged to `development` as `5ad8cc7`. Exact run
`31480704997` passed quality/build, empty replay, pgTAP, fictional seeding, DV
RLS, CSF workflow/scale, cron no-egress, DV/CSF browser suites, trace validation,
and owned teardown. Production, `main`, credentials, providers, live data, and
Production browser surfaces were not accessed.

---

## AUD-017 — Paper scan route broke clean production builds {#aud-017}

**Priority:** P1 · **Confidence:** Confirmed · **Blast radius:** Development
build and browser-acceptance pipelines containing the paper-signup feature

`app/api/ai/scan-signup-sheet/route.ts` exported `PAPER_SCAN_MODELS` alongside
the supported HTTP method and route configuration fields. Next.js rejects extra
route-module value exports. The default build output had stale generated types
and passed, while two exact GitHub DV runs failed when their clean isolated
output regenerated the route contract.

**Resolution:** keep the model fallback tuple in `lib/ai/models.ts` and make the
route's local alias private. A focused source contract now asserts that the
route exports only `POST`, `dynamic`, and `maxDuration`.

**Evidence, 2026-08-11:** GitHub runs `31475757024` and `31477491456` passed
empty replay, pgTAP, synthetic seeding, DV RLS, CSF workflow and scale, and cron
checks before failing at the same nested Next type-check boundary. A sterile,
provider-disabled local build using the isolated alternate output reproduced
the exact `PAPER_SCAN_MODELS` diagnostic. The same clean build passes after the
fix, together with the focused regression, formatting, lint, and root
typecheck. PR #123 merged to `development` as `f6a0931`; exact-commit manual run
`31479507620` then passed quality/build, empty replay, pgTAP, synthetic seed, DV
RLS, CSF workflow/scale, the cron no-egress probe, DV and CSF browser suites,
trace validation, and owned teardown. Production, `main`, provider credentials,
live data, and Production browser surfaces were not accessed.

---

## AUD-018 — Guardian availability could reset during hydration {#aud-018}

**Priority:** P1 · **Confidence:** Confirmed · **Blast radius:** guardians using
single-use DV judge-availability links during a slow or cold page hydration

The guardian form rendered interactive uncontrolled inputs before its client
boundary was ready. In exact Development CI, Playwright selected `limited`,
confirmed that radio was checked, and filled a scheduling note. Hydration then
reconciled the form to its server-rendered defaults immediately before the
Server Action submission. The action received `available` and a blank note,
consumed the single-use token, persisted the wrong availability, and displayed
**Availability recorded**.

**Evidence provenance:** GitHub run `31482117709` used the isolated fictional DV
stack and retained sanitized Playwright evidence. Its trace recorded the checked
control and filled textarea, followed by a multipart Server Action request whose
status was `available` and whose notes were empty. The database assertion then
read that exact wrong status. No hosted database, provider, credential, live
identity, or Production surface was used.

**Resolution:** the form is now a small Client Component with controlled status
and notes. Every mutable control and the submit button remain disabled until the
component has hydrated, the form exposes an explicit readiness marker for
acceptance, and the submit button prevents repeat work while the Server Action is
pending. The public page and action URL remain unchanged. The DV browser journey
now waits for the same readiness contract and proves both values immediately
before submission; a focused source contract prevents the uncontrolled/default
form from returning.

**Verification, 2026-08-11:** merged root PR #124 as `e830fdf`. Exact GitHub
run `31483374291` passed formatting, lint, TypeScript, all root/private tests,
the production build, database replay and pgTAP, DV/CSF database workflows,
cron no-egress, the strengthened DV journey, the CSF browser lifecycle, trace
validation, health verification, and owned teardown. Production remained
excluded.

---

## AUD-030 — Internal project helpers exposed as Server Actions {#aud-030}

**Priority:** P0 · **Confidence:** Confirmed (high) · **Status:** Fixed locally;
hosted Development pending

**Evidence and blast radius:** the baseline source inventory found
`uploadWaiverAsset`, `getCurrentSignups`, `persistWaiverSignature`, and
`cloneAnonymousWaiverSignatureToSignup` exported from file-level `"use server"`
`waiver-assets.ts`. Next therefore registered them as directly POST-reachable
Server Actions even though no UI imported them. The persistence paths use the
service role and accepted caller-selected project, signup, anonymous identity,
storage bucket/path, payload, and size limit inputs, so the exposure reached
every project's waiver evidence rather than one user's session. No exploit was
executed. The same baseline inventory and new AST boundary test identified an
additional accidental action, `canUserManageProject`, whose client and project
record parameters were intended only for trusted server orchestration. A clean
nonfunctional Preview-mode build of baseline commit `2e61074` independently
confirmed all five internal helpers in Next's compiled
`server-reference-manifest.json`; this is runtime registration evidence, not an
inference from the static inventory.

**Resolution and verification:** the four waiver helpers and their unchanged
implementation now live in server-only `waiver-persistence.ts`, which contains
no `"use server"` directive; `signup.ts` is their action-orchestration consumer.
`waiver-assets.ts` retains its file-level directive and exact two public PDF
action signatures/results. The internal access helper now lives in server-only
`access-helpers.ts`; the reviewed public access actions retain their file-level
and inline boundaries. The module test now parses every file-level server module
and rejects every exported async function outside `PUBLIC_ACTIONS`. Locally,
`bun test "app/projects/[id]/server/module-boundaries.test.ts"` passed 5 tests /
74 expectations and
`bun test "lib/waiver/persistence-boundaries.test.ts"` passed 8 tests. Hosted
Development was not deployed or tested. The fixed nonfunctional Preview-mode
build passed and its compiled manifest retained only `uploadProjectWaiverPdf`
and `removeProjectWaiverPdf` from this seven-name comparison. Production,
providers, credentials, and live data were not accessed.

---

## Gate baseline, 2026-08-10

Local, on `development` at `9b9abcd`, macOS, Bun 1.3.14.

| Gate                                     | Result                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| `plugin:submodules:check:strict`         | Pass (after AUD-007 remediation)                                |
| `security:seeds`                         | Pass                                                            |
| `lint`                                   | Pass                                                            |
| `typecheck`                              | Pass                                                            |
| `test`                                   | Pass — 3,714 assertions, 0 failures (after AUD-007 remediation) |
| `build`                                  | Pass                                                            |
| `db:test:redesign`                       | Not yet run in this pass                                        |
| Hosted `development` advisors (security) | 90 lints, all `INFO`/`rls_enabled_no_policy`; 0 ERROR, 0 WARN   |

After the AUD-001..004 fixes, on a full local replay of all 222 migrations:

| Gate                                           | Result                                                 |
| ---------------------------------------------- | ------------------------------------------------------ |
| `supabase db reset` (full replay)              | Pass                                                   |
| `supabase test db` (whole suite)               | **Pass — 70 files, 3,262 tests** (was 66 files, 3,219) |
| `db:audit:architecture`                        | Pass                                                   |
| `db:audit:plugin-isolation`                    | Pass                                                   |
| `plugin:audit:data-access`                     | Pass                                                   |
| `supabase db advisors --local --fail-on error` | No issues found                                        |

**Local environment note:** three orphaned isolated CSF stacks (32 containers, ~19 hours old) were left running by earlier sessions and prevented the shared local stack from starting. They were torn down with `scripts/local-dev/stop-dvhs-csf-isolated-stack.sh`, which validated resource ownership before and residual absence after. Nine stale work directories under `/tmp` and `$TMPDIR` were removed with them. Worth checking for periodically — a failed run leaves its stack behind.

Migration ledger: local 218 · hosted `development` 218 (identical) · **Production 49**, head `20260603035734` — 169 behind.

Dependabot reports 2 high-severity vulnerabilities on the default branch; not yet triaged in this pass.

---

## Hosted Development verification, 2026-08-10

Verified in the Vercel dashboard as `admin@lets-assist.com` on team `lets-assist-team` (Hobby plan), project `lets-assist`.

| Check                            | Result                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dev.lets-assist.com` domain     | **Valid Configuration**, assigned to the `development` branch                                                                                                                                    |
| `lets-assist.com` domain         | **Valid Configuration**, Production                                                                                                                                                              |
| Branch-scoped Preview variables  | Present and scoped to `development`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF` (all marked Sensitive, added 2026-08-04) |
| Latest `development` deployments | `f3fcf79`, `83ce42f`, `9b9abcd`, `e4f0179` — all **Ready**                                                                                                                                       |
| `dev.lets-assist.com` serves     | Yes. Vercel deployment protection is on; an authenticated Vercel session passes through                                                                                                          |
| Supabase branch migrations       | 218, head `20260807223600` — identical to the repository ledger                                                                                                                                  |
| Supabase branch advisors         | 90 lints, all `INFO`/`rls_enabled_no_policy`; 0 ERROR, 0 WARN                                                                                                                                    |
| **Production untouched**         | **49 migrations, head `20260603035734`** — unchanged throughout this session                                                                                                                     |

**Which Supabase project the deployment targets is proven by construction rather than by reading a value.** Every Vercel build runs `bun run build`, whose second step is `node scripts/verify-deployment-environment.mjs`. That script refuses any non-production `VERCEL_ENV` whose `NEXT_PUBLIC_SUPABASE_URL` is not HTTPS, is a production host (`api.lets-assist.com`, `fotdmeakexgrkronxlof.supabase.co`), or does not exactly match `EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF`. A **Ready** Preview deployment therefore cannot have been built against production. The three Supabase variables being branch-scoped to `development` is the other half of the same proof.

Browser network inspection could not confirm the target independently: the pages fetch server-side, so the browser never contacts Supabase directly. That is the expected shape for this architecture, not a gap.

### The stale-deployment finding

`a5c4ea7` (_Land the class-stream redesign_) shows **Error at 11 s, 2 days ago** — the same unpushed-submodule failure that took CI down (AUD-007). The Vercel build died at submodule fetch too.

So `dev.lets-assist.com` had been serving a **stale build from 2026-08-06** for two days, and every deployment attempt in between failed the same way. Anyone testing hosted Development during that window was testing old code. Several earlier Errors on 2026-08-02 and 2026-08-03 (`93ca1f2`, `388cb2a`, `c20d31f`, `287cb57`) suggest this has recurred.

The Phase 0 gitlink repair fixed it: the four subsequent commits all deployed **Ready**.

### AUD-013 — `RESEND_API_KEY` is flagged "Needs Attention"

**Priority:** P2 · **Status:** Observed, not investigated

The Vercel environment-variable list shows `RESEND_API_KEY` with a **Needs Attention** badge on both entries — `All Pre-Production Environments` and `Production`. Email delivery is load-bearing for CSF announcement campaigns, waiver notices, and certificate publication. Worth resolving before the cutover, since the release will exercise those paths.

Not investigated further here: reading or rotating a provider credential is outside an audit's remit and needs the account owner.

---

## The parked Codex branch

`codex/csf-lifecycle-overhaul` has been idle since 2026-08-09 18:57. Audited separately, as decided, and **not merged**.

### It existed only on this machine

Neither the root branch nor its submodule branch was on any remote, and both carried uncommitted work. A stray checkout would have destroyed it. All of it is now pushed:

| Ref                                | Repository | Contents                                                     |
| ---------------------------------- | ---------- | ------------------------------------------------------------ |
| `codex/csf-lifecycle-overhaul`     | root       | 2 commits ahead of `development`, +18,611 lines              |
| `codex/csf-lifecycle-overhaul`     | plugins    | Codex's private-plugin work, including `42388fc`             |
| `wip/codex-root-snapshot-20260810` | root       | The worktree's uncommitted work — 28 files, 2,521 insertions |
| `wip/codex-spill-20260810`         | plugins    | An intermediate Codex state found in the main checkout       |

The root snapshot was taken with `commit-tree` against a throwaway index, so the worktree, its HEAD, and its index were left untouched and Codex can resume exactly where it stopped. It contains work that existed nowhere else, notably `supabase/migrations/20260810021019_csf_posting_role_permission_rollout.sql` and new suites for design-token contrast, brand-token separation, footer target size, focusable scrollable regions, signup request origin, and a signup email PKCE round trip.

### AUD-014 — Codex's migrations all predate this session's {#aud-014}

**Priority:** P2 · **Status:** Confirmed · **Affects merge order, not correctness**

| Set          | Range                               | Count                                           |
| ------------ | ----------------------------------- | ----------------------------------------------- |
| Codex        | `20260809211732` → `20260810015500` | 11 committed, plus `20260810021019` uncommitted |
| This session | `20260810220100` → `20260810220500` | 5                                               |

No filename or timestamp collisions. But **every Codex timestamp is earlier than every one of this session's**, so merging Codex _after_ these have been applied somewhere would append migrations that sort before the recorded head — the ledger would no longer be ordered.

There is no problem yet: the hosted `development` branch is still at `20260807223600`, so **neither set has been applied anywhere remote**. That is what makes this cheap to fix, and it will not stay true.

**Recommendation: merge `codex/csf-lifecycle-overhaul` into `development` before pushing anything to the hosted branch or Production.** A replay then orders both sets correctly by timestamp and a single `db push` applies them in order.

If Codex lands later instead, renumber its migrations to follow the current head. That is legitimate here precisely because they have never been applied to any database — renumbering an _applied_ migration would not be.

The two sets are also disjoint in what they touch: Codex's are all `csf_*`, while this session's touch `trusted_member`, `notifications`, `plugin_audit_logs`, `public` default privileges, and `organizations`. So the risk is ledger hygiene rather than a broken dependency.

### Not yet done for the Codex branch

- A full `db:test:redesign` replay in its own worktree, which needs its own isolated stack.
- Reconciling its `app/organization/[id]/page.tsx` changes with the setup checklist added to the same file this session — a likely merge conflict.
- Reviewing its 11 migrations and ~6,000 lines of new pgTAP on their merits.

---

<a id="aud-021"></a>

## AUD-020 / AUD-021 — Plugin data lifecycle boundary {#aud-020}

**Priority:** P2 · **Status:** Fixed locally; hosted Development pending

Ordinary uninstall is now mechanically non-destructive: the transition core
removes only the exact organization/plugin install row and never invokes
`onUninstall`, `onDataDelete`, or any plugin code. Its audit evidence may
therefore state `pluginDataRetained: true`. `onUninstall` remains only as
compensation for a successful install hook followed by failed persistence.

Permanent deletion is a separate MFA-aware organization-admin action. It
revalidates current membership, registry, catalog, entitlement/forced/private
state, absence of an install row, and an organization/plugin-bound confirmation
under the control-plane transition lease. A complete manifest declaration must
exactly cover every tenant database/storage target and declare idempotent retry
semantics; missing or partial contracts fail closed.

Migration `20260812115556_plugin_data_deletion_requests.sql` adds a private,
RLS-enabled, service-only redacted receipt. Globally unique request keys are
bound to actor/organization/plugin/fingerprint, per-scope processing is unique,
and attempt claim tokens make completion compare-and-set. Processing after a
crash is treated as ambiguous and never auto-replayed; only an explicitly
reported `retryable_failed` receipt may run again. Hook outcome is finalized
before independent audit attachment, so audit failure cannot turn successful
destruction into a false failed/replayable operation.

No private manifest declares the complete new contract in this root change.
That is deliberately fail-safe: permanent deletion remains unavailable for
private plugins until a separate private-repository review enumerates targets
and external systems, lands there, and only then updates the root gitlink.
Local evidence is green: 78 focused Bun tests, 59 focused pgTAP assertions, and
a full local migration reset/replay pass. Hosted Development remains pending.
Production was not read, written, queried, deployed, or tested.

---

<a id="aud-029"></a>

## AUD-029 — CSF post replies were not an atomic tenant boundary {#aud-029}

**Priority:** P1 · **Status:** Audited source verified; exact integrated-branch and hosted Development verification pending

`addCsfPostReplyAction` and `deleteCsfPostReplyAction` previously performed
authorization, parent/reply reads, row mutation, and audit insertion as separate
application statements. A process failure could commit the reply without its
history, a lost response could duplicate an add, and a queued request could
continue after current staff authority changed. The reply table also had
independent organization and announcement foreign keys, so the database did not
itself prove that both identifiers named the same tenant.

Migration `20260812152300_atomic_csf_post_replies.sql` adds and validates the
composite tenant-parent foreign key and moves add/delete plus the immutable
audit receipt into one service-only transaction. The transaction authorizes
before caller-controlled record inspection, takes the shared organization
staff-access lock, pins the active host-membership row, rechecks
`manage_posts`, locks the published parent or target reply, enforces current
author-or-admin deletion, and binds the normalized intent to one request UUID.
Exact retries return the original reply; conflicting reuse and stale committed
state fail closed. Direct service-role INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, and TRIGGER privileges are removed while server-rendered SELECT is
retained. Both parent foreign keys now use `ON DELETE RESTRICT`, so deleting an
announcement cannot cascade around the reply boundary. The existing
service-role-only plugin teardown RPC removes tenant replies explicitly under
the same staff-access lock before delegating to its owner-only prior
implementation; its public signature and exact fourteen-key result contract
remain unchanged. Audit state stores hashes and bounded lengths, not reply
text.

The private action keeps its existing parameters and accepts one optional final
request UUID. The UI retains that UUID across an unknown add/delete outcome and
reuses it on an unchanged manual retry; changing the body discards the stale
key. Private PR #44 merged first into the private repository's `development`
branch at `d4188dd7`; the current root gitlink `ca817bf` contains that reply
code plus the later preview-summary correction. Audited source evidence passes
48 focused private tests (220 expectations), all 121 database files and 5,126
pgTAP assertions, including observed two-connection advisory-lock waits for
same-request replay and a staff-only `manage_posts` revocation. The exact
integrated branch still requires fresh replay. Hosted Development migration,
advisor, and browser acceptance also remain required before this finding
closes.

Production was not accessed or changed for this finding.

---

<a id="aud-031"></a>

## AUD-031 — Inactive membership retained shared tenant authority {#aud-031}

**Severity:** P1 · **Confidence:** confirmed · **Status:** fixed locally; hosted
Development verification pending

The four shared `private` organization helpers selected membership rows without
requiring `status = 'active'`. Because organization-member updates and multiple
public/plugin RLS policies call those definer helpers, an inactive admin or
staff actor could still satisfy tenant authorization, including the update
policy governing their own membership row.

**Local evidence:** the hostile fixture covers an inactive administrator's
self-reactivation, inactive staff denial, a separately active cross-tenant
administrator, and active same-tenant admin/staff controls. The lifecycle source
contract passes, as do the fresh isolated replay and the complete 126-file,
5,222-assertion pgTAP suite.

**Local resolution candidate:** `20260812215733_reconcile_project_lifecycle_boundaries.sql`
replaces all four helpers with fixed-path definitions that require the exact
organization, current user, reviewed role, and explicit active status. It
reapplies explicit function ACLs without changing the stronger
`app_private.is_project_organizer` or `app_private.can_manage_project`
definitions owned by current Development.

**Hosted resolution:** not applied or verified on hosted Development. Production
was not accessed.

---

<a id="aud-032"></a>

## AUD-032 — Cancelled projects could bypass or reverse lifecycle authority {#aud-032}

**Severity:** P1 · **Confidence:** confirmed · **Status:** fixed locally; hosted
Development verification pending

The general authenticated project update surface could enter `cancelled`
without the transaction that freezes its audience/outbox, or move a cancelled
row back to another status. `ProjectDetails.tsx` also persisted calculated
status directly through the browser client and reported authorization failures
only in the console.

**Local evidence:** focused lifecycle TypeScript coverage, the full unit suite,
fresh replay, and hostile pgTAP pass. The database fixture exercises direct
cancellation, direct revival, preserved state/outbox truth, and the reviewed
transactional cancellation path.

**Local resolution candidate:** the project trigger reserves cancellation and
revival for privileged reviewed transactions. The details page keeps its route
and caller signature but invokes the existing authorization-aware Server Action
and exposes a refresh action when current authorization or state rejects the
write.

**Hosted resolution:** not applied or verified on hosted Development. Production
was not accessed.

---

<a id="aud-033"></a>

## AUD-033 — Recurrence ending lacked one serialized private transaction {#aud-033}

**Severity:** P1 · **Confidence:** confirmed · **Status:** fixed locally; hosted
Development verification pending

A recurrence worker could decide to create a child without locking the parent
against series ending. The first repair also exposed the complete privileged
series transaction as a client-executable public SECURITY DEFINER function,
contrary to the current public-function boundary.

**Local evidence:** the source contract asserts the parent lock, private call to
the canonical cancellation transaction, fixed empty paths, public invoker
wrapper, and absence of a public definer. The pgTAP transaction and two-session
serialization proofs, architecture audit, and fresh replay pass. The no-commit
local #152 merge simulation replayed 275 ordered migrations, retained both
reviewed public ACL rows, and ordered the `161500` rejection transaction before
the `215733` union guard. It also recorded one integration item that belongs to
whichever pull request merges second: three assertions in the #152
`signup_rejection_atomicity` fixture still expect the pre-`215733` behavior in
which an active administrator approves or unrejects through a direct browser
update. The union guard now routes those transitions through the capacity-safe
RPC, so that fixture must be updated at merge time. Neither branch was merged
and `development` was not moved.

**Local resolution candidate:** a parent trigger serializes child materialization
with one private SECURITY DEFINER end-series transaction. The public signature
is preserved as a self-authorizing SECURITY INVOKER wrapper, callable only by
`authenticated`; `PUBLIC`, `anon`, and `service_role` are explicitly revoked.

**Hosted resolution:** not applied or verified on hosted Development. Production
was not accessed.

---

<a id="aud-034"></a>

## AUD-034 — Healthy pagination consumed the cancellation failure budget {#aud-034}

**Severity:** P1 · **Confidence:** confirmed · **Status:** fixed locally; hosted
Development verification pending

The job claim increment represented both an ordinary bounded page and an
abandoned lease. Large healthy jobs could therefore reach five attempts and
fail merely because the worker honored its per-run delivery budget, while
retries multiplied across later runs.

**Local evidence:** the stateful worker suite passes 20 tests / 90 assertions,
including more than five healthy one-delivery runs, five abandoned leases,
per-job round-robin quanta under one global maximum, terminal pre-send
exhaustion, and no accepted-email resend. Focused pgTAP covering healthy
finalizer refunds and true abandoned-lease exhaustion passes, as do the fresh
replay and complete local database suite.

**Local resolution candidate:** an owned, unexpired finalizer refunds the
provisional claim with `GREATEST(attempts - 1, 0)`. Only a lease that reaches the
reaper retains an attempt. The worker preserves one clamped
`maxDeliveries` counter across all claimed jobs and one unique per-delivery
provider idempotency key.

**Hosted resolution:** not applied or verified on hosted Development. No
provider request was made, and Production was not accessed.

---

## Next

AUD-002 and AUD-006 were not in the original plan — they were found during Track 2 and are the highest-value new work. AUD-002 should be fixed in the same cutover as AUD-001, and its code change (AUD-006) can land on `development` immediately, since it is a correctness improvement independent of the RLS change.
