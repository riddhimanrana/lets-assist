-- The narrow policy-review verdict must stay narrow.
--
-- csf_upsert_partner_club_policy replaces the whole club record and forces
-- standing back to 'active'. These assertions pin the one property that makes
-- a one-click Approve safe: the verdict touches the review columns and leaves
-- standing, the spreadsheet link and the club's identity exactly as they were.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)') IS NOT NULL,
  'the narrow policy-review function exists'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(
      client.role_name::name,
      'plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)',
      'EXECUTE'
    )
  ),
  'no client role can invoke the policy-review verdict'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'service_role can invoke the policy-review verdict'
);
SELECT extensions.ok(
  (
    SELECT proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)'::regprocedure
  ),
  'the verdict is SECURITY DEFINER with an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)'::regprocedure
  ) LIKE '%csf_actor_has_permission%manage_partner_clubs%',
  'the database rechecks manage_partner_clubs itself'
);
-- The whole point of a separate function: it must be incapable of moving
-- standing or the club's own spreadsheet link.
SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)'::regprocedure
  ) NOT LIKE '%workflow_status =%'
  AND pg_get_functiondef(
    'plugin_data.csf_set_partner_club_policy_review(uuid,uuid,uuid,uuid,text,text)'::regprocedure
  ) NOT LIKE '%spreadsheet_url =%',
  'the verdict never assigns workflow_status or spreadsheet_url'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'policy-admin@local.test', now(), '{}', '{}', now(), now()),
  ('fd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'policy-outsider@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('fd100000-0000-4000-8000-000000000001', 'Policy Review Chapter', 'policy-review-chapter', 'school', '994501');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'F40', 'Fall 2040', '2040-2041', 'fall', 'open', true);

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status, created_by)
VALUES ('fd300000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'Review Club', 'active', 'fd000000-0000-4000-8000-000000000001');

-- Standing suspended, notes and a spreadsheet link already recorded: exactly
-- the state a full-replace upsert would destroy.
INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, allocation_satisfied, policy_notes, spreadsheet_url
) VALUES (
  'fd400000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001',
  'fd300000-0000-4000-8000-000000000001', 'fd200000-0000-4000-8000-000000000001',
  'returning', 'inactive', NULL, 'Earlier reviewer note.',
  'https://docs.google.com/spreadsheets/d/keepme'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_policy_review(
    'fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002',
    'fd900000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001',
    'yes', NULL
  )$$,
  'P0001', 'Not authorized to manage CSF partner clubs.',
  'an account without partner-club permission cannot record a verdict'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_policy_review(
    'fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001',
    'fd900000-0000-4000-8000-000000000002', 'fd400000-0000-4000-8000-000000000001',
    'maybe', NULL
  )$$,
  'P0001', 'Choose a valid point-policy review status.',
  'an unknown verdict is refused'
);

-- A one-click approve: verdict only, no notes supplied.
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_set_partner_club_policy_review(
    'fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001',
    'fd900000-0000-4000-8000-000000000003', 'fd400000-0000-4000-8000-000000000001',
    'yes', NULL
  )$$,
  'an officer can record an approval'
);
SELECT extensions.is(
  (
    SELECT allocation_satisfied
    FROM plugin_data.csf_partner_club_terms
    WHERE id = 'fd400000-0000-4000-8000-000000000001'
  ),
  true,
  'the approval is recorded'
);
SELECT extensions.is(
  (
    SELECT policy_notes || '|' || spreadsheet_url || '|' || workflow_status
    FROM plugin_data.csf_partner_club_terms
    WHERE id = 'fd400000-0000-4000-8000-000000000001'
  ),
  'Earlier reviewer note.|https://docs.google.com/spreadsheets/d/keepme|inactive',
  'notes, the spreadsheet link and suspended standing all survive the verdict'
);
SELECT extensions.is(
  (
    SELECT reviewed_by
    FROM plugin_data.csf_partner_club_terms
    WHERE id = 'fd400000-0000-4000-8000-000000000001'
  ),
  'fd000000-0000-4000-8000-000000000001'::uuid,
  'the reviewer is stamped'
);

-- Replay: the same request id must not write a second time.
SELECT extensions.is(
  (
    SELECT plugin_data.csf_set_partner_club_policy_review(
      'fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001',
      'fd900000-0000-4000-8000-000000000003', 'fd400000-0000-4000-8000-000000000001',
      'yes', NULL
    ) ->> 'idempotent'
  ),
  'true',
  'replaying the same request id is a no-op'
);
SELECT extensions.is(
  (
    SELECT count(*)::int
    FROM plugin_data.csf_partner_club_term_events
    WHERE partner_club_term_id = 'fd400000-0000-4000-8000-000000000001'
      AND event_type = 'decision_recorded'
  ),
  1,
  'the replay recorded no second event'
);

SELECT * FROM extensions.finish();
ROLLBACK;
