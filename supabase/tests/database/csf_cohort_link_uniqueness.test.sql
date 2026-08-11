-- One active reusable class invitation per class and semester.
--
-- Two layers are proved here: `csf_mutate_onboarding_link` refuses the
-- duplicate under the per-organization advisory lock with copy an officer can
-- act on, and `csf_onboarding_links_active_cohort_uidx` makes the same rule
-- true for any write path that never reaches the RPC. Student-specific direct
-- invitations and request-receipt replay are unaffected.
--
-- This file runs in autocommit so the concurrency section can observe
-- committed state from a second real connection, following the precedent in
-- `csf_term_close_serialization.test.sql`.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(24);

-- 1-5: the contract lives in the function and in a real unique index.
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%SECURITY DEFINER%SET search_path TO ''''%',
  'the replaced class-invitation mutation pins an empty search path'
);
SELECT extensions.ok(
  -- The duplicate check must sit after the advisory lock; a read that happened
  -- before the lock would let two concurrent creates both observe "no link".
  position(
    'pg_advisory_xact_lock'
    IN pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
  ) < position(
    'AND existing_link.is_active'
    IN pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
  )
  AND pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
    LIKE '%This class already has an active invitation link%',
  'the duplicate-link check runs inside the organization advisory lock'
);
SELECT extensions.ok(
  -- The request-receipt lookup still precedes every duplicate evaluation, so
  -- an exact replay of a committed create cannot collide with its own link.
  position(
    'correlation_id = p_request_id'
    IN pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
  ) < position(
    'AND existing_link.is_active'
    IN pg_get_functiondef('plugin_data.csf_mutate_onboarding_link(uuid,uuid,uuid,jsonb)'::regprocedure)
  ),
  'the idempotent request receipt is resolved before the duplicate check'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS idx
    JOIN pg_catalog.pg_class AS cls ON cls.oid = idx.indexrelid
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'plugin_data'
      AND cls.relname = 'csf_onboarding_links_active_cohort_uidx'
      AND idx.indisunique
  ),
  'the one-active-class-link rule is backed by a real UNIQUE index'
);
SELECT extensions.ok(
  (
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'plugin_data'
      AND indexname = 'csf_onboarding_links_active_cohort_uidx'
  ) LIKE '%(organization_id, cohort_id, term_id)%WHERE%cohort%'
    AND (
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'plugin_data'
        AND indexname = 'csf_onboarding_links_active_cohort_uidx'
    ) LIKE '%is_active%',
  'the index is partial on active cohort-scoped links keyed by organization, class, and semester'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cohort-link-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('ea100000-0000-4000-8000-000000000001', 'CSF Cohort Link Uniqueness', 'csf-cohort-link-uniqueness', 'school', '996401');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES
  ('ea200000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 2044, 'Class of 2044', 'active'),
  ('ea200000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001', 2045, 'Class of 2045', 'active'),
  ('ea200000-0000-4000-8000-000000000003', 'ea100000-0000-4000-8000-000000000001', 2046, 'Class of 2046', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES (
  'ea300000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001',
  'F44', 'Fall 2044', '2044-2045', 'fall', true, 'open'
);

INSERT INTO plugin_data.csf_cohort_terms (
  id, organization_id, cohort_id, term_id, grade_level, status
) VALUES
  ('ea310000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000001', 'ea300000-0000-4000-8000-000000000001', 12, 'active'),
  ('ea310000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000002', 'ea300000-0000-4000-8000-000000000001', 11, 'active'),
  ('ea310000-0000-4000-8000-000000000003', 'ea100000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000003', 'ea300000-0000-4000-8000-000000000001', 10, 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  personal_email, normalized_personal_email
) VALUES (
  'ea400000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001',
  'Direct', 'Recipient', 'direct', 'recipient',
  'direct-recipient@local.test', 'direct-recipient@local.test'
);

-- 6-7: the first reusable class link is created normally.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900001-0000-4000-8000-000000000001',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'ea200000-0000-4000-8000-000000000001',
      'termId', 'ea300000-0000-4000-8000-000000000001',
      'title', 'Class of 2044 reusable link'
    )
  )$$,
  'the first reusable class link for a class and semester is created'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND invitation_scope = 'cohort'
      AND is_active
  ),
  1,
  'exactly one active class link exists after the first create'
);

-- 8-10: a second create with a different request id is refused with no writes.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900002-0000-4000-8000-000000000002',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'ea200000-0000-4000-8000-000000000001',
      'termId', 'ea300000-0000-4000-8000-000000000001',
      'title', 'Duplicate Class of 2044 link'
    )
  )$$,
  '23505',
  'This class already has an active invitation link for the selected semester. Deactivate that link before creating or activating another one.',
  'a second active class link for the same class and semester is refused'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND invitation_scope = 'cohort'
  ),
  1,
  'the refused duplicate writes no link row at all'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND correlation_id = 'ea900002-0000-4000-8000-000000000002'
  ),
  0,
  'the refused duplicate writes no audit receipt'
);

-- 11: an exact replay of the committed create still returns its receipt.
SELECT extensions.is(
  (plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900001-0000-4000-8000-000000000001',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'ea200000-0000-4000-8000-000000000001',
      'termId', 'ea300000-0000-4000-8000-000000000001',
      'title', 'Class of 2044 reusable link'
    )
  ) ->> 'idempotent')::boolean,
  true,
  'receipt replay still returns the original result instead of colliding with its own link'
);

-- 12: a different class in the same semester keeps its own link.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900003-0000-4000-8000-000000000003',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'ea200000-0000-4000-8000-000000000002',
      'termId', 'ea300000-0000-4000-8000-000000000001',
      'title', 'Class of 2045 reusable link'
    )
  )$$,
  'a different class in the same semester still gets its own active link'
);

-- 13-15: deactivate, then recreate the same class/semester link.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900004-0000-4000-8000-000000000004',
    jsonb_build_object(
      'operation', 'set_active',
      'linkId', (
        SELECT id FROM plugin_data.csf_onboarding_links
        WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
          AND cohort_id = 'ea200000-0000-4000-8000-000000000001'
          AND term_id = 'ea300000-0000-4000-8000-000000000001'
          AND invitation_scope = 'cohort'
          AND is_active
      ),
      'isActive', false
    )
  )$$,
  'the existing class link can be deactivated'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900005-0000-4000-8000-000000000005',
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'ea200000-0000-4000-8000-000000000001',
      'termId', 'ea300000-0000-4000-8000-000000000001',
      'title', 'Class of 2044 replacement link'
    )
  )$$,
  'deactivating first lets an officer create the replacement class link'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND cohort_id = 'ea200000-0000-4000-8000-000000000001'
      AND invitation_scope = 'cohort'
      AND is_active
  ),
  1,
  'the replaced class keeps exactly one active link and retains the retired one'
);

-- 16-17: reactivating the retired link while the replacement is active is refused.
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea900006-0000-4000-8000-000000000006',
    jsonb_build_object(
      'operation', 'set_active',
      'linkId', (
        SELECT id FROM plugin_data.csf_onboarding_links
        WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
          AND cohort_id = 'ea200000-0000-4000-8000-000000000001'
          AND invitation_scope = 'cohort'
          AND NOT is_active
      ),
      'isActive', true
    )
  )$$,
  '23505',
  'This class already has an active invitation link for the selected semester. Deactivate that link before creating or activating another one.',
  'reactivating a retired class link is refused while a replacement is active'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND cohort_id = 'ea200000-0000-4000-8000-000000000001'
      AND invitation_scope = 'cohort'
      AND is_active
  ),
  1,
  'the refused reactivation leaves exactly one active link'
);

-- 18: the index refuses a write path that never reaches the RPC.
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_onboarding_links (
      organization_id, term_id, cohort_id, code, title, link_type,
      invitation_scope, delivery_status, is_active, created_by
    ) VALUES (
      'ea100000-0000-4000-8000-000000000001',
      'ea300000-0000-4000-8000-000000000001',
      'ea200000-0000-4000-8000-000000000001',
      'raw-insert-bypassing-the-mutation-rpc-01',
      'Raw insert', 'combined', 'cohort', 'link_ready', true,
      'ea000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "csf_onboarding_links_active_cohort_uidx"',
  'a direct insert cannot create a second active class link either'
);

-- 19-20: student-specific direct invitations keep their own semantics.
INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title, link_type,
  invitation_scope, recipient_profile_id, recipient_email, delivery_status,
  expires_at, is_active, created_by
) VALUES
  ('ea500000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'ea300000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000001', 'direct-uniqueness-token-that-is-long-enough-01', 'Direct one', 'profile_connect', 'direct', 'ea400000-0000-4000-8000-000000000001', 'direct-recipient@local.test', 'link_ready', now() + interval '14 days', true, 'ea000000-0000-4000-8000-000000000001'),
  ('ea500000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001', 'ea300000-0000-4000-8000-000000000001', 'ea200000-0000-4000-8000-000000000001', 'direct-uniqueness-token-that-is-long-enough-02', 'Direct two', 'profile_connect', 'direct', 'ea400000-0000-4000-8000-000000000001', 'direct-recipient@local.test', 'link_ready', now() + interval '14 days', true, 'ea000000-0000-4000-8000-000000000001');

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND invitation_scope = 'direct'
      AND is_active
  ),
  2,
  'two active student-specific links for the same class and semester remain allowed'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND invitation_scope = 'cohort'
      AND is_active
  ),
  2,
  'the two classes still hold exactly one active reusable link each'
);

-- 21-24: two real sessions cannot both create the first link for one class.
SELECT extensions.dblink_connect(
  'cohort_link_writer',
  -- Use the container interface rather than loopback. Supabase's local pg_hba
  -- trusts loopback, and dblink refuses a non-superuser connection when the
  -- supplied password was not actually used.
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;

SELECT plugin_data.csf_mutate_onboarding_link(
  'ea100000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'ea900007-0000-4000-8000-000000000007',
  jsonb_build_object(
    'operation', 'create',
    'cohortId', 'ea200000-0000-4000-8000-000000000003',
    'termId', 'ea300000-0000-4000-8000-000000000001',
    'title', 'Class of 2046 first writer'
  )
);

SELECT extensions.dblink_send_query(
  'cohort_link_writer',
  $query$
  SELECT plugin_data.csf_mutate_onboarding_link(
    'ea100000-0000-4000-8000-000000000001'::uuid,
    'ea000000-0000-4000-8000-000000000001'::uuid,
    'ea900008-0000-4000-8000-000000000008'::uuid,
    jsonb_build_object(
      'operation', 'create',
      'cohortId', 'ea200000-0000-4000-8000-000000000003',
      'termId', 'ea300000-0000-4000-8000-000000000001',
      'title', 'Class of 2046 second writer'
    )
  )::text
  $query$
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('cohort_link_writer'),
  1,
  'a concurrent class-link create waits on the organization lock'
);

COMMIT;

SELECT * FROM extensions.dblink_get_result('cohort_link_writer', false) AS result(payload text);

SELECT extensions.ok(
  position(
    'This class already has an active invitation link for the selected semester.'
    IN extensions.dblink_error_message('cohort_link_writer')
  ) > 0,
  'the waiting session is refused once it observes the committed class link'
);

SELECT extensions.dblink_disconnect('cohort_link_writer');

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_onboarding_links
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND cohort_id = 'ea200000-0000-4000-8000-000000000003'
      AND invitation_scope = 'cohort'
      AND is_active
  ),
  1,
  'two concurrent creates leave exactly one active link for that class and semester'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND correlation_id = 'ea900008-0000-4000-8000-000000000008'
  ),
  0,
  'the losing concurrent create writes no audit receipt'
);

-- The concurrency window commits on purpose so the second connection can
-- observe it. Keep this namespaced synthetic chapter for the remainder of the
-- disposable replay rather than defeating the immutable-audit trigger with
-- cleanup-only mutation.

SELECT * FROM extensions.finish();
