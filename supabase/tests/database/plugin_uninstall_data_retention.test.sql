-- Plugin uninstall data-lifecycle truth: uninstall is control-plane-only.
--
-- transitionOrganizationPluginInstall's "uninstall" branch
-- (lib/plugins/control-plane-transition-core.ts) deletes exactly one row —
-- organization_plugin_installs, scoped by id + organization_id + plugin_key
-- + updated_at (control-plane-transition.ts's removeInstall callback,
-- optimistic-concurrency guard included) — and nothing else. It never
-- references plugin_data. This file proves that at the database boundary
-- the way the real service-role adapter exercises it: a bare top-level
-- DELETE with the same four-column predicate, not a data-modifying CTE
-- nested inside a pgTAP assertion (Postgres rejects that shape), so state
-- is checked with separate SELECT-based assertions bracketing each plain
-- DML statement. The `updated_at` half of the predicate is captured from a
-- real snapshot read (a temp table), the same way the TypeScript adapter
-- captures `current.updatedAt` before issuing its delete, rather than
-- omitted.
--
-- Covered here: an authenticated client cannot delete an install row
-- directly (only the leased, service-role control-plane adapter can);
-- install -> uninstall removes only the install row using the adapter's
-- exact predicate; the plugin's own plugin_data row survives byte-for-byte,
-- verified by full-row snapshot comparison rather than a count and a single
-- column; a wrong-organization delete attempt and a replay of the same
-- stale predicate after the row is already gone both affect zero rows
-- (cross-tenant safety and DML-level idempotency); a sibling organization's
-- install and data are untouched throughout; reinstalling re-creates the
-- install row and rejoins the same, never-deleted plugin_data row; and the
-- install.removed audit row carries only the facts the platform actually
-- controls (platformInstallRowRemoved, pluginDataDeletionNotRequested,
-- pluginDataRetained, configurationRemoved). Ordinary uninstall executes no
-- plugin hook, so retention by that operation is a mechanical invariant
-- (pluginControlPlaneAuditDetails, unit-tested in
-- control-plane-transition-core.test.ts).
--
-- The repeat-delete section (G) intentionally does NOT claim to model what
-- a repeat uninstall call from the app does today: a fresh retry with no
-- cached install snapshot short-circuits in TypeScript before any SQL runs
-- at all (proved in control-plane-transition-core.test.ts, not here, since
-- that short-circuit has no SQL representation), and a losing racer that
-- does reach this DELETE with a stale snapshot gets a zero-row result that
-- control-plane-transition.ts's removeInstall callback turns into a thrown
-- PluginControlPlaneConcurrencyError, not a silent success. What section G
-- verifies is narrower and still worth knowing: replaying the exact same
-- compound predicate after the row is already gone does not raise a SQL
-- error and does not touch any other row — a defense-in-depth property of
-- the statement itself, not a description of the retry's application-level
-- outcome.
--
-- Every value here is synthetic. The whole file runs inside one transaction
-- and ends in ROLLBACK, so it leaves no rows behind and does not depend on
-- the order it runs relative to any other suite. The "eb" UUID prefix is
-- confirmed unused by any other file under supabase/tests/database/ at the
-- time this was written, avoiding the fixture-collision failure an earlier
-- draft of this test hit from reusing another suite's prefix.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(24);

-- ---------------------------------------------------------------------------
-- A. Fixtures: two organizations, each installed with the same plugin and
-- each holding one plugin_data row that plugin created for them. Org one's
-- plugin_data row is snapshotted in full immediately after being written,
-- so retention can be proven later by comparing the whole row, not a count
-- and a label.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('eb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'uninstall-retention-admin-one@local.test', now(), '{}', '{}', now(), now()),
  ('eb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'uninstall-retention-admin-two@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('eb100000-0000-4000-8000-000000000001', 'Uninstall Retention Org One', 'uninstall-retention-org-one', 'school', '881101'),
  ('eb100000-0000-4000-8000-000000000002', 'Uninstall Retention Org Two', 'uninstall-retention-org-two', 'school', '881102');

INSERT INTO public.plugins (key, name, visibility, is_active)
VALUES ('uninstall-contract-test-plugin', 'Uninstall Contract Test Plugin', 'global', true);

SELECT extensions.lives_ok(
  $$INSERT INTO public.organization_plugin_installs
      (id, organization_id, plugin_key, enabled, configuration, installed_by)
    VALUES (
      'eb200000-0000-4000-8000-000000000001',
      'eb100000-0000-4000-8000-000000000001',
      'uninstall-contract-test-plugin',
      true, '{"mode": "org-one"}'::jsonb,
      'eb000000-0000-4000-8000-000000000001'
    )$$,
  'org one installs the plugin'
);

SELECT extensions.lives_ok(
  $$INSERT INTO plugin_data.org_seasons (id, organization_id, label, starts_at, ends_at)
    VALUES (
      'eb300000-0000-4000-8000-000000000001',
      'eb100000-0000-4000-8000-000000000001',
      'Org One Season', '2026-08-01', '2027-06-01'
    )$$,
  'the plugin writes a plugin_data row for org one while installed'
);

CREATE TEMP TABLE org_one_season_snapshot AS
SELECT id, organization_id, label, starts_at, ends_at, is_current, created_at, updated_at
  FROM plugin_data.org_seasons
 WHERE id = 'eb300000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$INSERT INTO public.organization_plugin_installs
      (id, organization_id, plugin_key, enabled, configuration, installed_by)
    VALUES (
      'eb200000-0000-4000-8000-000000000002',
      'eb100000-0000-4000-8000-000000000002',
      'uninstall-contract-test-plugin',
      true, '{"mode": "org-two"}'::jsonb,
      'eb000000-0000-4000-8000-000000000002'
    )$$,
  'org two (a different tenant) also installs the plugin'
);

SELECT extensions.lives_ok(
  $$INSERT INTO plugin_data.org_seasons (id, organization_id, label, starts_at, ends_at)
    VALUES (
      'eb300000-0000-4000-8000-000000000002',
      'eb100000-0000-4000-8000-000000000002',
      'Org Two Season', '2026-08-01', '2027-06-01'
    )$$,
  'the plugin writes its own plugin_data row for org two'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  1,
  'org one has exactly one install row before uninstalling'
);

-- ---------------------------------------------------------------------------
-- A2. Only the service-role control-plane adapter can delete an install
-- row. Direct client writes to organization_plugin_installs were revoked
-- from anon/authenticated in 20260712014700; prove that as a genuine
-- role/JWT ACL check, driven as the real `authenticated` role, rather than
-- inferring it from a predicate that merely happens to match nothing.
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'eb000000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claims" =
  '{"sub":"eb000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  (SELECT auth.uid()),
  'eb000000-0000-4000-8000-000000000001'::uuid,
  'the session really is an authenticated org admin, not a privileged test role'
);

SELECT extensions.throws_ok(
  $$DELETE FROM public.organization_plugin_installs
     WHERE id = 'eb200000-0000-4000-8000-000000000002'$$,
  '42501',
  NULL,
  'an authenticated client cannot delete an install row directly; only the leased service-role adapter can'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- B. Uninstall org one: exactly the predicate removeInstall() issues
-- (id + organization_id + plugin_key + updated_at), as a bare top-level
-- statement so its effect can be checked with plain SELECT assertions. The
-- updated_at value is read into a temp table first, the same way the
-- TypeScript adapter captures `current.updatedAt` before deleting with it.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE org_one_install_snapshot AS
SELECT updated_at
  FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000001';

DELETE FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000001'
   AND organization_id = 'eb100000-0000-4000-8000-000000000001'
   AND plugin_key = 'uninstall-contract-test-plugin'
   AND updated_at = (SELECT updated_at FROM org_one_install_snapshot);

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  0,
  'uninstalling org one removes exactly its install row'
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.plugin_audit_logs (organization_id, plugin_key, action, actor_id, actor_type, details)
    VALUES (
      'eb100000-0000-4000-8000-000000000001',
      'uninstall-contract-test-plugin',
      'install.removed',
      'eb000000-0000-4000-8000-000000000001',
      'user',
      '{"controlPlaneTransition": "uninstall", "platformInstallRowRemoved": true, "pluginDataDeletionNotRequested": true, "pluginDataRetained": true, "configurationRemoved": true}'::jsonb
    )$$,
  'plugin_audit_logs schema accepts a hand-crafted install.removed row with known field values (see control-plane-transition-core.test.ts for production audit shape)'
);

-- ---------------------------------------------------------------------------
-- C. Retention: org one's plugin_data row was never referenced by the
-- delete above and still exists, compared field-by-field against its
-- pre-uninstall snapshot rather than a count and a single label column.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.org_seasons
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  1,
  'org one plugin_data row is retained after uninstall, not deleted'
);

SELECT extensions.is(
  (SELECT to_jsonb(s) FROM plugin_data.org_seasons s
    WHERE s.id = 'eb300000-0000-4000-8000-000000000001'),
  (SELECT to_jsonb(sn) FROM org_one_season_snapshot sn),
  'the retained plugin_data row is field-for-field identical to its pre-uninstall snapshot'
);

-- ---------------------------------------------------------------------------
-- D. Audit schema assertions against the hand-crafted row inserted in B.
-- These verify the schema round-trip for the known field names only —
-- they do NOT prove what the production TypeScript unit writes. The
-- production audit shape (including the pluginDataRetained invariant) is
-- owned by the unit tests in control-plane-transition-core.test.ts.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT details ->> 'platformInstallRowRemoved' FROM public.plugin_audit_logs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND action = 'install.removed'),
  'true',
  'hand-crafted install.removed fixture carries platformInstallRowRemoved: true'
);

SELECT extensions.is(
  (SELECT details ->> 'pluginDataDeletionNotRequested' FROM public.plugin_audit_logs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND action = 'install.removed'),
  'true',
  'hand-crafted install.removed fixture carries pluginDataDeletionNotRequested: true'
);

SELECT extensions.is(
  (SELECT details ->> 'configurationRemoved' FROM public.plugin_audit_logs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND action = 'install.removed'),
  'true',
  'hand-crafted install.removed fixture carries configurationRemoved: true'
);

SELECT extensions.is(
  (SELECT details ->> 'controlPlaneTransition' FROM public.plugin_audit_logs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND action = 'install.removed'),
  'uninstall',
  'hand-crafted install.removed fixture carries controlPlaneTransition: uninstall'
);

SELECT extensions.ok(
  (
    SELECT details ->> 'pluginDataRetained'
    FROM public.plugin_audit_logs
      WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
        AND action = 'install.removed'
  ) = 'true',
  'hand-crafted fixture carries the production pluginDataRetained invariant'
);

-- ---------------------------------------------------------------------------
-- E. Other tenant untouched: org two's install and its own plugin_data row
-- never moved.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT enabled FROM public.organization_plugin_installs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000002'),
  true,
  'org two install is untouched by org one uninstalling'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.org_seasons
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000002'),
  1,
  'org two plugin_data row is untouched by org one uninstalling'
);

-- ---------------------------------------------------------------------------
-- F. Wrong-organization delete attempt: the exact compound predicate the
-- adapter issues, updated_at included, refuses to cross tenants even if a
-- caller passes the wrong organization_id alongside a real row id and its
-- real current updated_at from another org.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE org_two_install_snapshot AS
SELECT updated_at
  FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000002';

DELETE FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000002'
   AND organization_id = 'eb100000-0000-4000-8000-000000000001'
   AND plugin_key = 'uninstall-contract-test-plugin'
   AND updated_at = (SELECT updated_at FROM org_two_install_snapshot);

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE id = 'eb200000-0000-4000-8000-000000000002'),
  1,
  'a delete scoped to the wrong organization_id matches nothing, even with the right id and updated_at, and org two survives'
);

-- ---------------------------------------------------------------------------
-- G. Replaying the same stale predicate after the row is already gone: a
-- statement-level idempotency/safety check, not a model of what a repeat
-- uninstall call from the app does today. See the file header for why.
-- ---------------------------------------------------------------------------

DELETE FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000001'
   AND organization_id = 'eb100000-0000-4000-8000-000000000001'
   AND plugin_key = 'uninstall-contract-test-plugin'
   AND updated_at = (SELECT updated_at FROM org_one_install_snapshot);

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  0,
  'replaying the exact stale predicate after the row is gone matches zero rows without a SQL error, and deletes nothing else'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.org_seasons
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  1,
  'the replayed delete attempt still leaves org one plugin_data retained'
);

-- ---------------------------------------------------------------------------
-- H. Reinstall: a fresh install row can be created once the old one is
-- gone (the (organization_id, plugin_key) unique constraint would have
-- refused it otherwise), and it rejoins the plugin_data row that was never
-- deleted -- proving retained data is reachable again, without claiming
-- anything about how a specific plugin's onInstall hook behaves.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$INSERT INTO public.organization_plugin_installs
      (id, organization_id, plugin_key, enabled, configuration, installed_by)
    VALUES (
      'eb200000-0000-4000-8000-000000000003',
      'eb100000-0000-4000-8000-000000000001',
      'uninstall-contract-test-plugin',
      true, '{}'::jsonb,
      'eb000000-0000-4000-8000-000000000001'
    )$$,
  'org one can reinstall now that its old install row is gone'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  1,
  'org one has exactly one install row again after reinstalling'
);

SELECT extensions.is(
  (SELECT s.id FROM public.organization_plugin_installs i
     JOIN plugin_data.org_seasons s ON s.organization_id = i.organization_id
    WHERE i.id = 'eb200000-0000-4000-8000-000000000003'),
  'eb300000-0000-4000-8000-000000000001'::uuid,
  'reinstalling rejoins the same never-deleted plugin_data row, not a new one'
);

SELECT * FROM extensions.finish();

ROLLBACK;
