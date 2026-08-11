-- V122: durable, fair CSF communication scheduling.
--
-- All identities and addresses are synthetic. The transaction rolls back, so
-- neither scheduler cursors nor communication fixtures survive this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(30);

-- ---------------------------------------------------------------------------
-- A. Private cursor and RPC boundary
-- ---------------------------------------------------------------------------

SELECT extensions.has_table(
  'plugin_data', 'csf_scheduler_state',
  'the scheduler has a durable cursor rather than an application-memory prefix'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_scheduler_state'
      AND column_name = 'organization_id'
  )
  AND (
    SELECT class.relrowsecurity
    FROM pg_class AS class
    WHERE class.oid = 'plugin_data.csf_scheduler_state'::regclass
  ),
  'the private scheduler state is tenant-shaped and has row-level security enabled'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename = 'csf_scheduler_state'
  ),
  'the scheduler cursor has no browser-facing policy'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
      AS privilege(name)
    WHERE has_table_privilege(
      'service_role',
      'plugin_data.csf_scheduler_state',
      privilege.name
    )
  ),
  'service_role cannot read or rewrite scheduler cursors directly'
);

SELECT extensions.has_function(
  'plugin_data', 'csf_claim_communication_scheduler_scope', ARRAY['integer'],
  'a service scheduler scope RPC exists'
);

SELECT extensions.has_function(
  'plugin_data', 'csf_maintain_communication_campaigns', ARRAY['integer'],
  'a bounded campaign maintenance RPC exists'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_claim_communication_scheduler_scope(integer)',
      'plugin_data.csf_maintain_communication_campaigns(integer)'
    ]) AS scheduler(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(
      client.role_name::name, scheduler.signature, 'EXECUTE'
    )
  ),
  'no browser role can execute either scheduler RPC'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_communication_scheduler_scope(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'plugin_data.csf_maintain_communication_campaigns(integer)',
    'EXECUTE'
  ),
  'service_role can execute both narrow scheduler RPCs'
);

SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""'])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_claim_communication_scheduler_scope(integer)'::regprocedure,
      'plugin_data.csf_maintain_communication_campaigns(integer)'::regprocedure
    )
  ),
  'both scheduler RPCs are SECURITY DEFINER with a pinned empty search_path'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 4
    FROM pg_class
    WHERE relkind = 'i'
      AND relname IN (
        'csf_comm_attempts_scheduler_queue_idx',
        'csf_comm_campaigns_scheduler_idx',
        'csf_scheduler_scope_fairness_idx',
        'csf_scheduler_maintenance_fairness_idx'
      )
  ),
  'queue discovery, tenant fairness, and cyclic campaign maintenance have dedicated indexes'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_claim_communication_scheduler_scope(0) $$,
  '22023',
  'A CSF scheduler scope takes exactly 1 organization.',
  'scheduler organization scope is bounded at the database boundary'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_claim_communication_scheduler_scope(2) $$,
  '22023',
  'A CSF scheduler scope takes exactly 1 organization.',
  'scheduler scope cannot durably pre-claim an unprocessed tenant suffix'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_maintain_communication_campaigns(201) $$,
  '22023',
  'A CSF campaign maintenance pass takes between 1 and 200 campaigns.',
  'campaign maintenance is bounded at the database boundary'
);

-- ---------------------------------------------------------------------------
-- B. A cancelled campaign with an expired processing-only lease is discoverable
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ca000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'scheduler-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'Scheduler CSF Test', 'scheduler-csf-test', 'school', '992201'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'F32', 'Fall 2032', '2032-2033', 'fall', true
);

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id, audience_kind,
  created_by, created_by_identity, content_finalized_at,
  content_finalized_by, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key, metadata
) VALUES (
  'ca400000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'transactional', 'draft', 'DVHS CSF',
  'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
  'Synthetic scheduler lease test', 'Synthetic scheduler body.', repeat('a', 64),
  'ca200000-0000-4000-8000-000000000001', 'applicants',
  'ca000000-0000-4000-8000-000000000001',
  'scheduler-officer@local.test', now(),
  'ca000000-0000-4000-8000-000000000001',
  'scheduler-officer@local.test', 1, 'scheduler-cancelled-lease',
  '{"csf_environment":"local"}'::jsonb
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_snapshot_communication_recipients(
      'ca100000-0000-4000-8000-000000000001',
      'ca400000-0000-4000-8000-000000000001',
      '[{"email":"scheduler-recipient@local.test","provenance":"staff_entry"}]'::jsonb
    )
  $$,
  'the cancelled-lease fixture freezes one synthetic recipient'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_finalize_communication_recipient_snapshot(
      'ca100000-0000-4000-8000-000000000001',
      'ca400000-0000-4000-8000-000000000001', 1
    )->>'attemptsEnqueued'
  ),
  '1',
  'the fixture enqueues one attempt'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_claim_communication_dispatch_batch(
      'ca100000-0000-4000-8000-000000000001',
      'ca400000-0000-4000-8000-000000000001',
      'scheduler-worker-before-cancel', 1, 120
    )->>'claimedCount'
  ),
  '1',
  'the attempt holds a live processing lease before cancellation'
);

SELECT extensions.is(
  (
    SELECT plugin_data.csf_cancel_communication_campaign(
      'ca100000-0000-4000-8000-000000000001',
      'ca400000-0000-4000-8000-000000000001',
      'Synthetic cancellation while the worker still holds its lease.',
      'ca000000-0000-4000-8000-000000000001',
      'scheduler-cancelled-lease'
    )->>'attemptsStillLeased'
  ),
  '1',
  'cancellation leaves the still-live lease with its worker instead of stealing it'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET
      leased_at = now() - interval '2 minutes',
      lease_expires_at = now() - interval '1 minute',
      updated_at = now()
    WHERE campaign_id = 'ca400000-0000-4000-8000-000000000001'
      AND state = 'processing'
  $$,
  'the synthetic worker dies and its cancelled-campaign lease expires'
);

CREATE TEMP TABLE t_cancelled_scope AS
SELECT plugin_data.csf_claim_communication_scheduler_scope(1) AS result;

SELECT extensions.ok(
  (
    SELECT result->'organizationIds'
      @> '["ca100000-0000-4000-8000-000000000001"]'::jsonb
    FROM t_cancelled_scope
  ),
  'the scheduler rediscovers an expired processing-only lease after cancellation'
);

CREATE TEMP TABLE t_cancelled_reap AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  'ca100000-0000-4000-8000-000000000001',
  NULL,
  'scheduler-worker-after-expiry',
  1,
  120
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'unknownOutcomeExpiredLeases')
      || '|' || (result->>'claimedCount')
    FROM t_cancelled_reap
  ),
  '1|0',
  'the expired cancelled lease becomes unknown for review and is never reclaimed for resend'
);

SELECT extensions.is(
  (
    SELECT state || '|' || review_state || '|' || (settled_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_dispatch_attempts
    WHERE campaign_id = 'ca400000-0000-4000-8000-000000000001'
  ),
  'unknown_outcome|pending|true',
  'the cancelled lease is durably settled as an unretryable unknown outcome'
);

SELECT extensions.is(
  (
    SELECT status || '|' || (review_blocked_at IS NOT NULL)::text
    FROM plugin_data.csf_communication_campaigns
    WHERE id = 'ca400000-0000-4000-8000-000000000001'
  ),
  'cancelled|true',
  'the cancelled campaign visibly carries the ambiguity for officer review'
);

-- ---------------------------------------------------------------------------
-- C. Tenant selection advances one processed coordinate at a time
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ca100000-0000-4000-8000-000000000002',
    'Scheduler CSF Fairness Two', 'scheduler-csf-fairness-two', 'school', '992202'
  ),
  (
    'ca100000-0000-4000-8000-000000000003',
    'Scheduler CSF Fairness Three', 'scheduler-csf-fairness-three', 'school', '992203'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'ca100000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000001', 'admin', 'active'
  ),
  (
    'ca100000-0000-4000-8000-000000000003',
    'ca000000-0000-4000-8000-000000000001', 'admin', 'active'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
)
VALUES
  (
    'ca200000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000002',
    'F32', 'Fall 2032', '2032-2033', 'fall', true
  ),
  (
    'ca200000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000003',
    'F32', 'Fall 2032', '2032-2033', 'fall', true
  );

INSERT INTO plugin_data.csf_communication_campaigns (
  id, organization_id, campaign_kind, status, sender_name, sender_email,
  reply_to_email, subject, body_text, body_text_hash, term_id, audience_kind,
  created_by, created_by_identity, content_finalized_at,
  content_finalized_by, content_finalized_by_identity,
  audience_snapshot_version, provider_idempotency_key, metadata
)
VALUES
  (
    'ca400000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000002',
    'transactional', 'draft', 'DVHS CSF',
    'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
    'Synthetic fairness two', 'Synthetic scheduler body.', repeat('b', 64),
    'ca200000-0000-4000-8000-000000000002', 'applicants',
    'ca000000-0000-4000-8000-000000000001',
    'scheduler-officer@local.test', now(),
    'ca000000-0000-4000-8000-000000000001',
    'scheduler-officer@local.test', 1, 'scheduler-tenant-two',
    '{"csf_environment":"local"}'::jsonb
  ),
  (
    'ca400000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000003',
    'transactional', 'draft', 'DVHS CSF',
    'csf@notifications.lets-assist.com', 'dvhighcsf@gmail.com',
    'Synthetic fairness three', 'Synthetic scheduler body.', repeat('c', 64),
    'ca200000-0000-4000-8000-000000000003', 'applicants',
    'ca000000-0000-4000-8000-000000000001',
    'scheduler-officer@local.test', now(),
    'ca000000-0000-4000-8000-000000000001',
    'scheduler-officer@local.test', 1, 'scheduler-tenant-three',
    '{"csf_environment":"local"}'::jsonb
  );

DO $$
DECLARE
  v_suffix integer;
  v_organization_id uuid;
  v_campaign_id uuid;
BEGIN
  FOR v_suffix IN 2..3 LOOP
    v_organization_id := (
      'ca100000-0000-4000-8000-' || pg_catalog.lpad(v_suffix::text, 12, '0')
    )::uuid;
    v_campaign_id := (
      'ca400000-0000-4000-8000-' || pg_catalog.lpad(v_suffix::text, 12, '0')
    )::uuid;

    PERFORM plugin_data.csf_snapshot_communication_recipients(
      v_organization_id,
      v_campaign_id,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'email', 'scheduler-fairness-' || v_suffix::text || '@local.test',
          'provenance', 'staff_entry'
        )
      )
    );
    PERFORM plugin_data.csf_finalize_communication_recipient_snapshot(
      v_organization_id,
      v_campaign_id,
      1
    );
  END LOOP;
END;
$$;

CREATE TEMP TABLE t_tenant_scope_rotation (
  sequence_number integer PRIMARY KEY,
  result jsonb NOT NULL
);

INSERT INTO t_tenant_scope_rotation
VALUES (1, plugin_data.csf_claim_communication_scheduler_scope(1));

INSERT INTO t_tenant_scope_rotation
VALUES (2, plugin_data.csf_claim_communication_scheduler_scope(1));

SELECT extensions.is(
  (
    SELECT pg_catalog.count(DISTINCT result->'organizationIds'->>0)::text
    FROM t_tenant_scope_rotation
  ),
  '1',
  'repeated discovery without worker progress does not rotate away from the oldest eligible organization'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::text
    FROM plugin_data.csf_scheduler_state
    WHERE organization_id IN (
      'ca100000-0000-4000-8000-000000000002',
      'ca100000-0000-4000-8000-000000000003'
    )
      AND last_scope_claimed_at IS NOT NULL
  ),
  '0',
  'scope discovery alone never persists a fairness timestamp'
);

CREATE TEMP TABLE t_tenant_worker_claim AS
SELECT plugin_data.csf_claim_communication_dispatch_batch(
  (
    SELECT (result->'organizationIds'->>0)::uuid
    FROM t_tenant_scope_rotation
    WHERE sequence_number = 1
  ),
  NULL,
  'scheduler-tenant-fairness-worker',
  1,
  120
) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'claimedCount') || '|' || (
      SELECT pg_catalog.count(*)::text
      FROM plugin_data.csf_scheduler_state
      WHERE organization_id = (
        SELECT (scope.result->'organizationIds'->>0)::uuid
        FROM t_tenant_scope_rotation AS scope
        WHERE scope.sequence_number = 1
      )
        AND last_scope_claimed_at IS NOT NULL
    )
    FROM t_tenant_worker_claim
  ),
  '1|1',
  'a real queued-to-processing claim is the commit point that advances tenant fairness'
);

INSERT INTO t_tenant_scope_rotation
VALUES (3, plugin_data.csf_claim_communication_scheduler_scope(1));

SELECT extensions.ok(
  (
    SELECT later.result->'organizationIds'->>0
      <> earlier.result->'organizationIds'->>0
    FROM t_tenant_scope_rotation AS earlier
    CROSS JOIN t_tenant_scope_rotation AS later
    WHERE earlier.sequence_number = 1
      AND later.sequence_number = 3
  ),
  'after real worker progress the next scope rotates to the other eligible organization'
);

-- Keep the following campaign-prefix scenario single-tenant. These synthetic
-- organizations have already proved tenant rotation; cancellation removes their
-- queued campaigns from maintenance eligibility without bypassing lifecycle
-- constraints or organization-membership triggers.
DO $$
DECLARE
  v_suffix integer;
BEGIN
  FOR v_suffix IN 2..3 LOOP
    PERFORM plugin_data.csf_cancel_communication_campaign(
      (
        'ca100000-0000-4000-8000-' || pg_catalog.lpad(v_suffix::text, 12, '0')
      )::uuid,
      (
        'ca400000-0000-4000-8000-' || pg_catalog.lpad(v_suffix::text, 12, '0')
      )::uuid,
      'Synthetic tenant fairness fixture complete.',
      'ca000000-0000-4000-8000-000000000001',
      'scheduler-tenant-fairness-cleanup-' || v_suffix::text
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- D. A bounded prefix cannot starve later campaigns
-- ---------------------------------------------------------------------------

INSERT INTO plugin_data.csf_communication_campaigns (
  organization_id, campaign_kind, status, sender_email, subject,
  provider_idempotency_key, metadata
)
SELECT
  'ca100000-0000-4000-8000-000000000001',
  'transactional',
  'sending',
  'legacy@local.test',
  'Scheduler fairness campaign ' || fixture.number::text,
  'scheduler-fairness-' || fixture.number::text,
  pg_catalog.jsonb_build_object(
    'csf_environment', 'local',
    'scheduler_fairness_fixture', fixture.number
  )
FROM pg_catalog.generate_series(1, 55) AS fixture(number);

WITH blocked_prefix AS (
  SELECT
    campaign.id,
    campaign.organization_id,
    campaign.audience_snapshot_version,
    pg_catalog.row_number() OVER (ORDER BY campaign.id) AS position
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.metadata ? 'scheduler_fairness_fixture'
)
INSERT INTO plugin_data.csf_communication_recipient_snapshots (
  organization_id,
  campaign_id,
  snapshot_version,
  recipient_email,
  subscription_decision
)
SELECT
  blocked_prefix.organization_id,
  blocked_prefix.id,
  blocked_prefix.audience_snapshot_version,
  'blocked-' || blocked_prefix.id::text || '@local.test',
  'included'
FROM blocked_prefix
WHERE blocked_prefix.position <= 50;

INSERT INTO plugin_data.csf_communication_deliveries (
  organization_id,
  campaign_id,
  recipient_snapshot_id,
  provider_idempotency_key
)
SELECT
  snapshot.organization_id,
  snapshot.campaign_id,
  snapshot.id,
  'scheduler-blocked-' || snapshot.campaign_id::text
FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
JOIN plugin_data.csf_communication_campaigns AS campaign
  ON campaign.id = snapshot.campaign_id
  AND campaign.organization_id = snapshot.organization_id
WHERE campaign.metadata ? 'scheduler_fairness_fixture';

CREATE TEMP TABLE t_maintenance_first AS
SELECT plugin_data.csf_maintain_communication_campaigns(50) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'checked') || '|' || (result->>'terminalized')
      || '|' || (result->>'nonterminal') || '|' || (result->>'faults')
    FROM t_maintenance_first
  ),
  '50|0|50|0',
  'the first maintenance pass truthfully leaves its whole live prefix nonterminal'
);

SELECT extensions.is(
  (
    SELECT count(*) FILTER (WHERE status = 'failed')::text
      || '|' || count(*) FILTER (WHERE status = 'sending')::text
    FROM plugin_data.csf_communication_campaigns
    WHERE metadata ? 'scheduler_fairness_fixture'
  ),
  '0|55',
  'all fifty blocked campaigns and the five later campaigns remain open after the first pass'
);

CREATE TEMP TABLE t_maintenance_second AS
SELECT plugin_data.csf_maintain_communication_campaigns(50) AS result;

SELECT extensions.is(
  (
    SELECT (result->>'checked') || '|' || (result->>'terminalized')
      || '|' || (result->>'nonterminal') || '|' || (result->>'faults')
    FROM t_maintenance_second
  ),
  '50|5|45|0',
  'the next cursor pass reaches all five later campaigns despite the nonterminal prefix'
);

SELECT extensions.is(
  (
    SELECT count(*) FILTER (WHERE status = 'failed')::text
      || '|' || count(*) FILTER (WHERE status = 'sending')::text
    FROM plugin_data.csf_communication_campaigns
    WHERE metadata ? 'scheduler_fairness_fixture'
  ),
  '5|50',
  'the only campaigns still open are the deliberately blocked prefix, not starved later work'
);

SELECT * FROM extensions.finish();
ROLLBACK;
