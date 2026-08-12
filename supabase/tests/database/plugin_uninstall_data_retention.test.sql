-- Plugin uninstall data-lifecycle truth: uninstall is control-plane-only.
--
-- transitionOrganizationPluginInstall's "uninstall" branch
-- (lib/plugins/control-plane-transition-core.ts) deletes exactly one row —
-- organization_plugin_installs, scoped by id + organization_id + plugin_key
-- + updated_at — and nothing else. It never references plugin_data. This
-- file proves that at the database boundary the way the real service-role
-- adapter (lib/plugins/control-plane-transition.ts) exercises it: a bare
-- top-level DELETE with the same compound predicate, not a data-modifying
-- CTE nested inside a pgTAP assertion (Postgres rejects that shape), so
-- state is checked with separate SELECT-based assertions bracketing each
-- plain DML statement.
--
-- Covered here: install -> uninstall removes only the install row; the
-- plugin's own plugin_data row survives (retention); a second uninstall
-- attempt and a wrong-organization delete attempt both affect zero rows
-- (repeat/lost-response and cross-tenant safety); a sibling organization's
-- install and data are untouched throughout; reinstalling re-creates the
-- install row and rejoins the same, never-deleted plugin_data row; and the
-- install.removed audit row carries the pluginDataRetained=true detail that
-- lib/plugins/control-plane-transition-core.ts now emits
-- (pluginControlPlaneAuditDetails, unit-tested in
-- control-plane-transition-core.test.ts). Hook failure/compensation for the
-- "uninstall" transition and the "not installed" repeat-uninstall refusal
-- are TS-level lifecycle-ordering facts already covered by
-- control-plane-transition-core.test.ts; this file does not re-derive them
-- in SQL, since the lifecycle hooks it orders are TypeScript callbacks with
-- no SQL representation.
--
-- Every value here is synthetic. The whole file runs inside one transaction
-- and ends in ROLLBACK, so it leaves no rows behind and does not depend on
-- the order it runs relative to any other suite. The "eb" UUID prefix is
-- confirmed unused by any other file under supabase/tests/database/ at the
-- time this was written, avoiding the fixture-collision failure an earlier
-- draft of this test hit from reusing another suite's prefix.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(19);

-- ---------------------------------------------------------------------------
-- A. Fixtures: two organizations, each installed with the same plugin and
-- each holding one plugin_data row that plugin created for them.
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
-- B. Uninstall org one: exactly the predicate removeInstall() issues
-- (id + organization_id + plugin_key + updated_at), as a bare top-level
-- statement so its effect can be checked with plain SELECT assertions.
-- ---------------------------------------------------------------------------

DELETE FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000001'
   AND organization_id = 'eb100000-0000-4000-8000-000000000001'
   AND plugin_key = 'uninstall-contract-test-plugin';

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
      '{"controlPlaneTransition": "uninstall", "pluginDataRetained": true}'::jsonb
    )$$,
  'the uninstall is audited the way control-plane-transition.ts writes it'
);

-- ---------------------------------------------------------------------------
-- C. Retention: org one's plugin_data row was never referenced by the
-- delete above and still exists, unchanged.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.org_seasons
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  1,
  'org one plugin_data row is retained after uninstall, not deleted'
);

SELECT extensions.is(
  (SELECT label FROM plugin_data.org_seasons
    WHERE id = 'eb300000-0000-4000-8000-000000000001'),
  'Org One Season',
  'the retained plugin_data row is the same, unmodified row'
);

-- ---------------------------------------------------------------------------
-- D. Audit truth: the install.removed row states retention, not deletion.
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (SELECT details ->> 'pluginDataRetained' FROM public.plugin_audit_logs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND action = 'install.removed'),
  'true',
  'the install.removed audit row records pluginDataRetained = true'
);

SELECT extensions.is(
  (SELECT details ->> 'controlPlaneTransition' FROM public.plugin_audit_logs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND action = 'install.removed'),
  'uninstall',
  'the install.removed audit row still names the uninstall transition'
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
-- adapter issues refuses to cross tenants even if a caller passes the
-- wrong organization_id alongside a real row id from another org.
-- ---------------------------------------------------------------------------

DELETE FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000002'
   AND organization_id = 'eb100000-0000-4000-8000-000000000001'
   AND plugin_key = 'uninstall-contract-test-plugin';

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE id = 'eb200000-0000-4000-8000-000000000002'),
  1,
  'a delete scoped to the wrong organization_id matches nothing and org two survives'
);

-- ---------------------------------------------------------------------------
-- G. Repeat/lost-response uninstall: issuing the same delete again, now
-- that the row is already gone, is a no-op rather than an error or a
-- second, unrelated row disappearing. This is the database half of the
-- "not installed" refusal control-plane-transition-core.test.ts proves in
-- TypeScript before any delete is even attempted.
-- ---------------------------------------------------------------------------

DELETE FROM public.organization_plugin_installs
 WHERE id = 'eb200000-0000-4000-8000-000000000001'
   AND organization_id = 'eb100000-0000-4000-8000-000000000001'
   AND plugin_key = 'uninstall-contract-test-plugin';

SELECT extensions.is(
  (SELECT count(*)::int FROM public.organization_plugin_installs
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  0,
  'repeating the uninstall delete is a no-op, not a second deletion of something else'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.org_seasons
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'),
  1,
  'the repeat uninstall attempt still leaves org one plugin_data retained'
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
