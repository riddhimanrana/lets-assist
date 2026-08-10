BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(19);

SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_resolve_communication_webhook_quarantine(uuid,uuid,text,uuid,uuid)'
  ) IS NOT NULL,
  'the quarantine triage RPC exists with the stable service signature'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_resolve_communication_webhook_quarantine(uuid,uuid,text,uuid,uuid)'::regprocedure
  ),
  'quarantine triage is a pinned security-definer boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'public',
    'plugin_data.csf_resolve_communication_webhook_quarantine(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_resolve_communication_webhook_quarantine(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_resolve_communication_webhook_quarantine(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser and PUBLIC roles cannot resolve quarantine evidence'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_resolve_communication_webhook_quarantine(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the trusted server role can invoke quarantine triage'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'quarantine-admin@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'quarantine-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ec100000-0000-4000-8000-000000000001', 'CSF Quarantine One', 'csf-quarantine-one', 'school', '981401'),
  ('ec100000-0000-4000-8000-000000000002', 'CSF Quarantine Two', 'csf-quarantine-two', 'school', '981402');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ec100000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_communication_webhook_quarantine (
  id, organization_id, provider_event_id, raw_body_hash, reason_code,
  reason_detail, claimed_organization_id
) VALUES
  ('ec200000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000001', 'evt_triage_1', repeat('a', 64), 'immutable_replay_conflict', 'Synthetic immutable evidence conflict.', 'ec100000-0000-4000-8000-000000000002'),
  ('ec200000-0000-4000-8000-000000000002', NULL, 'evt_triage_2', repeat('b', 64), 'unroutable_tenant', 'Synthetic claimed tenant only.', 'ec100000-0000-4000-8000-000000000001'),
  ('ec200000-0000-4000-8000-000000000003', NULL, 'evt_triage_3', repeat('c', 64), 'unroutable_tenant', 'Synthetic globally unrouted item.', NULL);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000099',
    'Attempted unauthorized evidence probe.',
    'ec000000-0000-4000-8000-000000000002',
    'ec900000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'Not authorized to resolve CSF communication quarantine items.',
  'authorization runs before target lookup'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000002',
    'ec200000-0000-4000-8000-000000000001',
    'Claimed tags cannot override the actual routed organization.',
    'ec000000-0000-4000-8000-000000000003',
    'ec900000-0000-4000-8000-000000000002'
  )$$,
  'P0001',
  'Communication quarantine item was not found.',
  'an untrusted claimed tenant cannot resolve another actual tenant''s item'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    'ec200000-0000-4000-8000-000000000001',
    'short',
    'ec000000-0000-4000-8000-000000000001',
    'ec900000-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'Explain the quarantine resolution in at least ten characters.',
  'a meaningful operator note is required'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    'ec200000-0000-4000-8000-000000000003',
    'No tenant coordinate exists for this evidence.',
    'ec000000-0000-4000-8000-000000000001',
    'ec900000-0000-4000-8000-000000000004'
  )$$,
  'P0001',
  'Communication quarantine item was not found.',
  'globally unrouted evidence is not assigned to an arbitrary tenant'
);

SELECT extensions.is(
  plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    'ec200000-0000-4000-8000-000000000001',
    'Reviewed the immutable replay conflict and documented provider follow-up.',
    'ec000000-0000-4000-8000-000000000001',
    'ec900000-0000-4000-8000-000000000005'
  )->>'idempotentReplay',
  'false',
  'an authorized first triage writes a new resolution'
);
SELECT extensions.ok(
  (SELECT resolved_at IS NOT NULL
     AND resolved_by = 'ec000000-0000-4000-8000-000000000001'
     AND resolved_by_identity = 'user:ec000000-0000-4000-8000-000000000001'
   FROM plugin_data.csf_communication_webhook_quarantine
   WHERE id = 'ec200000-0000-4000-8000-000000000001'),
  'the triage row records the bounded actor identity once'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE action = 'communication.webhook_quarantine.resolved'
     AND target_id = 'ec200000-0000-4000-8000-000000000001'),
  1,
  'quarantine triage writes one correlated immutable audit receipt'
);
SELECT extensions.is(
  plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    'ec200000-0000-4000-8000-000000000001',
    'Reviewed the immutable replay conflict and documented provider follow-up.',
    'ec000000-0000-4000-8000-000000000001',
    'ec900000-0000-4000-8000-000000000099'
  )->>'idempotentReplay',
  'true',
  'an exact lost-response retry returns the original receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE action = 'communication.webhook_quarantine.resolved'
     AND target_id = 'ec200000-0000-4000-8000-000000000001'),
  1,
  'an idempotent retry does not duplicate audit history'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    'ec200000-0000-4000-8000-000000000001',
    'Changed the operator conclusion after it was already recorded.',
    'ec000000-0000-4000-8000-000000000001',
    'ec900000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'This communication quarantine item has already been resolved.',
  'a triage decision cannot be silently rewritten'
);
SELECT extensions.is(
  (SELECT raw_body_hash
   FROM plugin_data.csf_communication_webhook_quarantine
   WHERE id = 'ec200000-0000-4000-8000-000000000001'),
  repeat('a', 64),
  'triage never rewrites immutable provider evidence'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_resolve_communication_webhook_quarantine(
    'ec100000-0000-4000-8000-000000000001',
    'ec200000-0000-4000-8000-000000000002',
    'Reviewed the claimed-tenant-only envelope and documented follow-up.',
    'ec000000-0000-4000-8000-000000000001',
    'ec900000-0000-4000-8000-000000000007'
  )$$,
  'a tenant may triage an unrouted item only when no actual tenant exists'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_communication_webhook_quarantine
   WHERE resolved_at IS NOT NULL),
  2,
  'both actual-tenant and claimed-only synthetic items are resolved'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_communication_webhook_quarantine
   WHERE resolved_at IS NULL),
  1,
  'globally unrouted evidence remains for platform-level triage'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_communication_webhook_quarantine', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'plugin_data.csf_communication_webhook_quarantine', 'UPDATE'),
  'browser roles still cannot read or mutate quarantine evidence directly'
);

SELECT * FROM extensions.finish();

ROLLBACK;
