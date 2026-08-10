# Audit register, 2026-08-10

Scope: the `development` branch at `9b9abcd`, the hosted Supabase `development` branch (`ocbuygudvarsuxijxhau`), and read-only comparison against Production (`fotdmeakexgrkronxlof`).

Method: local gate execution, plus read-only catalog queries against both hosted databases. **No exploit was executed and no production row was written or read.** Every "Confirmed" below rests on catalog state (policies, grants, triggers, constraints) or on a local test run, not on an attempted attack.

Evidence: `.artifacts/audit-20260810/`.

Priority scale: **P0** exploitable now against real users · **P1** security-relevant, not directly exploitable · **P2** correctness/maintainability · **P3** cosmetic or dead code.

---

## Summary

| ID | Pri | Area | Finding | Status |
|---|---|---|---|---|
| [AUD-001](#aud-001) | P0 | Core RLS | `trusted_member` INSERT policy has no `status` guard — self-granted trusted status | Confirmed, live in Production |
| [AUD-002](#aud-002) | P0 | Core RLS | `notifications` INSERT policy ends in `OR (auth.uid() IS NULL)` — unauthenticated notification injection | Confirmed, live in Production |
| [AUD-003](#aud-003) | P1 | Grants | `public` default privileges still grant `anon`/`authenticated` on all future tables and functions | Confirmed |
| [AUD-004](#aud-004) | P1 | Plugin audit | `plugin_audit_logs_action_check` allows 22 values; the code emits 28 — six lifecycle events are silently unaudited | Confirmed |
| [AUD-005](#aud-005) | P2 | Plugin RLS | `organization_plugin_installs` is readable by ordinary members, including the whole `configuration` blob | Confirmed |
| [AUD-006](#aud-006) | P2 | Architecture | Two `server-only` modules drive notifications through the **browser** Supabase client — the root cause of AUD-002 | Confirmed |
| [AUD-007](#aud-007) | P2 | CI | CI had been red since 2026-08-08 on an unpushed submodule ref, masking a failing test | Fixed this session |
| [AUD-008](#aud-008) | P2 | Architecture | CSF's 78 sensitive tables have no second authorization layer — RLS is deny-all, all decisions live in TypeScript | Confirmed, by design |
| [AUD-009](#aud-009) | P2 | Gate coverage | `audit-supabase-architecture.sh` bucket allowlist omits `csf-private` and `plugin_form_uploads` | Confirmed |
| [AUD-010](#aud-010) | P3 | Moderation | `content_flags` admin UPDATE policy tests `auth.jwt() ->> 'role' = 'admin'`, which is never true | Confirmed, dead policy |
| [AUD-011](#aud-011) | P3 | Plugin control plane | Advertised control-plane surfaces that no code path reads | Confirmed |

**Clean results worth recording:** all 176 base tables in `public` and `plugin_data` have RLS enabled (131 + 45, zero exceptions). The private buckets `csf-private`, `data-exports`, and `waiver-signatures` have **zero** `storage.objects` policies — service-role only, which is the correct posture. Hosted `development` security advisors return 90 lints, all `INFO`/`rls_enabled_no_policy` on `plugin_data.csf_*`, which is the intended deny-all design; zero `ERROR` or `WARN`.

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

**Priority:** P1 · **Status:** Confirmed

Baseline `20260325181408` (~lines 3836-3847) still carries:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO anon;
-- and the same to authenticated, plus GRANT ALL ON FUNCTIONS to both
```

The `plugin_data` equivalent was revoked by `20260701054111`; `public` was not. Twenty-three `public` tables currently carry `anon` INSERT/UPDATE/DELETE grants purely from this default, including `certificates`, `profiles`, `projects`, `notifications`, `trusted_member`, and `content_reports`. Only RLS stands between a new table and the open internet.

The FUNCTIONS half is the more valuable fix: `GRANT ALL ON FUNCTIONS TO anon` means every new function — including every `SECURITY DEFINER` function — is anon-executable by default, which this repo has had to claw back three separate times (`20260701040027`, `20260701051022`, `20260802195500`).

**Blast radius of fixing it: zero at cutover.** `ALTER DEFAULT PRIVILEGES` affects only objects created after it runs, and every existing object carries explicit grants.

**Fix:** mirror `20260701054111` for `public`, as its own migration so it can be reverted independently; add a pgTAP assertion on `pg_default_acl`; extend `audit-supabase-architecture.sh`; and add the rule to `AGENTS.md` that every new `public` table and function must carry explicit `GRANT`s. Specification in the plan, Task 5.3.

---

## AUD-004 — Six lifecycle audit events are silently discarded {#aud-004}

**Priority:** P1 · **Status:** Confirmed

`plugin_audit_logs_action_check` permits exactly 22 values. `lib/plugins/*.ts` emits 28. The six that will always violate the constraint:

`lifecycle.config_update` · `lifecycle.version_update` · `lifecycle.data_delete` · `lifecycle.project_create` · `lifecycle.project_clone` · `lifecycle.signup`

`logPluginAudit` catches the resulting `23514`, logs to `console.error`, and returns `null`. So configuration changes, version updates, **plugin data deletion**, project create/clone, and signup lifecycle events produce no audit row at all. Data deletion going unaudited is the serious one.

**Fix:** forward migration replacing the CHECK with all 28 values (never edit `20260404010400`); pgTAP asserting every emitted value inserts; and make `logPluginAudit` surface constraint violations rather than swallowing them, so a future mismatch is loud. Plan Task 2.1.

---

## AUD-005 — Plugin install configuration is member-readable {#aud-005}

**Priority:** P2 · **Status:** Confirmed

`organization_plugin_installs` has one SELECT policy, `Plugin installs readable by org members`, whose `USING` admits roles `admin`, `staff`, **and `member`**. The row includes the whole `configuration` JSON blob.

Meanwhile the server action `getOrganizationPluginSettings` restricts the same data to admins via `isOrganizationAdminForSettings()`. The database is more permissive than the application, so any member can read the configuration directly through PostgREST — including any targeting allowlists or operational settings a plugin stores there.

**Fix:** column-level grants (the pattern already used for `organizations.join_code` in `20260712014700`) or a `security_invoker` view that omits `configuration` for non-admins. Plan Task 2.3.

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

**Standing lesson:** a submodule commit must be pushed *before* the root gitlink that references it, or CI cannot check out the tree and every gate result becomes vacuous.

---

## AUD-008 — CSF has no second authorization layer {#aud-008}

**Priority:** P2 · **Status:** Confirmed, by design — recorded, not "fixed"

All 131 `plugin_data` tables have RLS enabled. The 78 `csf_*` tables have RLS enabled and **zero policies**, combined with revoked schema `USAGE` and revoked table grants for `anon` and `authenticated`. Only `service_role` reaches them.

That is a correct and defensible deny-all posture, and it is what produces the 90 `INFO` advisor lints. But the honest characterization is: *CSF data is RLS-protected in the sense that RLS denies everyone; it is not RLS-authorized.* Every real authorization decision — which chapter, which term, which role, which permission — lives in TypeScript. A missed check in a server action is not caught by a second layer.

`plugin_data.csf_assert_import_actor` is the one SQL-level actor guard and is the model the rest could follow.

**Recommendation:** no change in this pass. Track as an architectural risk. If it is ever addressed, the highest-value targets are the consequential transitions — term close/reopen, application decisions, point crediting — where a SQL-side actor assertion would be cheap relative to the blast radius.

---

## AUD-009 — Bucket drift detection has two blind spots {#aud-009}

**Priority:** P2 · **Status:** Confirmed

`scripts/audit-supabase-architecture.sh` (~lines 302-368) enumerates nine expected buckets; `csf-private` is not among them, and the "server-only buckets exposed through client policies" pattern matches only `data-exports` and `waiver-signatures`. `plugin_form_uploads` has the same gap.

Current posture is correct — `csf-private` is `public = false` with zero object policies — but if it flipped to public, or gained a `storage.objects` policy, the gate would stay green.

**Fix:** add both buckets to the expected-bucket enumeration and the client-policy pattern set. Verify by adding a policy locally and confirming the gate fails. Plan Task 2.6.

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

| Surface | Reality |
|---|---|
| `public.plugin_versions` | The `draft → review → published/rejected` workflow, `commit_sha`, `published_by`, `review_notes` are all inert. Its RLS is `FOR SELECT USING (true)` for every role, contradicting its own "platform admins can manage" comment. |
| `organization_plugin_feature_flags` + `rollout_percentage` | **Feature gating is unimplemented.** |
| `organization_plugin_installs.auto_update` | Never read. |
| `organization_plugin_data_boundaries`, `organization_data_isolation_profiles` | Surfaced in the admin UI; never consulted by any enforcement path, despite the developer docs calling a missing boundary row "a schema/process bug". |
| `validatePluginUninstall` | Always returns `canUninstall: true`, and the transition path never calls it. |
| `createPluginRegistry(..., allowList)` | Always invoked with `null`. |
| `syncRegisteredPluginRuntimeContracts()` | Runs only when a super admin loads `/admin/plugins`, so `plugin_runtime_contracts` is stale by default, and it silently skips any registered plugin with no catalog row. |
| `renderOrganizationPluginPage` | Still carries a "no renderer is registered yet" placeholder branch. |

**Recommendation:** do not build these speculatively. Decide per surface whether to implement or remove, and until then make sure the plugin install documentation (plan Task 3.3) states plainly which of them do not work, so operators do not rely on them.

**Related failure-mode notes (P2, not separately numbered):** `loadAccessibleOrganizationPluginAccess` defaults to `failureMode: "empty"`, so every caller except `renderOrganizationPluginPage` turns a database outage into "you have no plugins"; and `resolveOrganizationPlugins`, `resolveOrganizationPluginExperiences`, and `resolve-platform-surfaces` fall back from the admin client to the user's client on throw, which under RLS silently drops every private plugin for a plain member — failing closed, but indistinguishably from "not entitled".

---

## Gate baseline, 2026-08-10

Local, on `development` at `9b9abcd`, macOS, Bun 1.3.14.

| Gate | Result |
|---|---|
| `plugin:submodules:check:strict` | Pass (after AUD-007 remediation) |
| `security:seeds` | Pass |
| `lint` | Pass |
| `typecheck` | Pass |
| `test` | Pass — 3,714 assertions, 0 failures (after AUD-007 remediation) |
| `build` | Pass |
| `db:test:redesign` | Not yet run in this pass |
| Hosted `development` advisors (security) | 90 lints, all `INFO`/`rls_enabled_no_policy`; 0 ERROR, 0 WARN |

Migration ledger: local 218 · hosted `development` 218 (identical) · **Production 49**, head `20260603035734` — 169 behind.

Dependabot reports 2 high-severity vulnerabilities on the default branch; not yet triaged in this pass.

---

## Next

AUD-002 and AUD-006 were not in the original plan — they were found during Track 2 and are the highest-value new work. AUD-002 should be fixed in the same cutover as AUD-001, and its code change (AUD-006) can land on `development` immediately, since it is a correctness improvement independent of the RLS change.
