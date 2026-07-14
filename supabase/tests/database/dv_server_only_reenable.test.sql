BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(40);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('de100000-0000-4000-8000-000000000001', 'DV Delete Target', 'dv-delete-target', 'school', '981001'),
  ('de100000-0000-4000-8000-000000000002', 'DV Delete Control', 'dv-delete-control', 'school', '981002');

INSERT INTO plugin_data.dv_sd_student_profiles (
  organization_id,
  student_name
)
VALUES
  ('de100000-0000-4000-8000-000000000001', 'Delete Me'),
  ('de100000-0000-4000-8000-000000000002', 'Keep Me');

INSERT INTO plugin_data.dv_sd_audit_events (
  organization_id,
  action,
  entity_type
)
VALUES
  ('de100000-0000-4000-8000-000000000001', 'fixture.delete', 'test'),
  ('de100000-0000-4000-8000-000000000002', 'fixture.keep', 'test');

INSERT INTO plugin_data.org_seasons (
  organization_id,
  label,
  starts_at,
  ends_at
)
VALUES (
  'de100000-0000-4000-8000-000000000001',
  '2026-2027',
  '2026-08-01',
  '2027-06-30'
);

INSERT INTO plugin_data.org_form_definitions (
  organization_id,
  plugin_key,
  title,
  form_schema
)
VALUES
  ('de100000-0000-4000-8000-000000000001', 'dv-speech-debate', 'DV Form', '{}'::jsonb),
  ('de100000-0000-4000-8000-000000000001', 'another-plugin', 'Keep Form', '{}'::jsonb);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    'de000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'dv-staff@local.test',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'de000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'dv-outsider@local.test',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.organization_members (
  id,
  organization_id,
  user_id,
  role
)
VALUES (
  'de110000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000001',
  'staff'
);

INSERT INTO plugin_data.org_seasons (
  id,
  organization_id,
  label,
  starts_at,
  ends_at,
  is_current
)
VALUES (
  'de200000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'DV RPC Test Season',
  '2026-08-01',
  '2027-06-30',
  true
);

INSERT INTO plugin_data.dv_sd_tournaments (
  id,
  organization_id,
  name,
  season_id,
  starts_at,
  ends_at
)
VALUES (
  'de300000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'DV RPC Test Tournament',
  'de200000-0000-4000-8000-000000000001',
  '2026-10-10 08:00:00+00',
  '2026-10-10 18:00:00+00'
);

INSERT INTO plugin_data.dv_sd_guardians (
  id,
  organization_id,
  normalized_email,
  email,
  full_name
)
VALUES
  (
    'de400000-0000-4000-8000-000000000001',
    'de100000-0000-4000-8000-000000000001',
    'valid-guardian@local.test',
    'valid-guardian@local.test',
    'Valid Guardian'
  ),
  (
    'de400000-0000-4000-8000-000000000002',
    'de100000-0000-4000-8000-000000000001',
    'ambiguous-guardian@local.test',
    'ambiguous-guardian@local.test',
    'Ambiguous Guardian'
  ),
  (
    'de400000-0000-4000-8000-000000000003',
    'de100000-0000-4000-8000-000000000001',
    'unmapped-guardian@local.test',
    'unmapped-guardian@local.test',
    'Unmapped Guardian'
  ),
  (
    'de400000-0000-4000-8000-000000000004',
    'de100000-0000-4000-8000-000000000001',
    'allocation-guardian@local.test',
    'allocation-guardian@local.test',
    'Allocation Guardian'
  );

INSERT INTO plugin_data.dv_sd_households (
  id,
  organization_id,
  display_name
)
VALUES
  ('de500000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'Valid Household'),
  ('de500000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001', 'Ambiguous Household One'),
  ('de500000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001', 'Ambiguous Household Two'),
  ('de500000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001', 'Allocation Household');

INSERT INTO plugin_data.dv_sd_household_guardians (
  household_id,
  guardian_id
)
VALUES
  ('de500000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001'),
  ('de500000-0000-4000-8000-000000000002', 'de400000-0000-4000-8000-000000000002'),
  ('de500000-0000-4000-8000-000000000003', 'de400000-0000-4000-8000-000000000002'),
  ('de500000-0000-4000-8000-000000000004', 'de400000-0000-4000-8000-000000000004');

INSERT INTO plugin_data.dv_sd_family_service_accounts (
  id,
  organization_id,
  season_id,
  household_id,
  required_credits
)
VALUES
  ('de600000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001', 10),
  ('de600000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000002', 10),
  ('de600000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000003', 10),
  ('de600000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000004', 10);

INSERT INTO plugin_data.dv_sd_judges (
  id,
  organization_id,
  guardian_id,
  clearance_status,
  training_status,
  event_qualifications,
  max_rounds_per_day
)
VALUES
  ('de700000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001', 'verified', 'verified', ARRAY['LD'], 10),
  ('de700000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000002', 'verified', 'verified', ARRAY['LD'], 10),
  ('de700000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000003', 'verified', 'verified', ARRAY['LD'], 10),
  ('de700000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000004', 'verified', 'verified', ARRAY['LD'], 2);

INSERT INTO plugin_data.dv_sd_judge_availability (
  organization_id,
  tournament_id,
  judge_id,
  status
)
VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000001',
  'de700000-0000-4000-8000-000000000004',
  'available'
);

INSERT INTO plugin_data.dv_sd_allocation_drafts (
  id,
  organization_id,
  tournament_id,
  source,
  status,
  constraints_version,
  proposal,
  created_by
)
VALUES
  ('de800000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'rules', 'approved', 'test', '{}'::jsonb, 'de000000-0000-4000-8000-000000000001'),
  ('de800000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'rules', 'approved', 'test', '{}'::jsonb, 'de000000-0000-4000-8000-000000000001'),
  ('de800000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'rules', 'approved', 'test', '{}'::jsonb, 'de000000-0000-4000-8000-000000000001'),
  ('de800000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'rules', 'approved', 'test', '{}'::jsonb, 'de000000-0000-4000-8000-000000000001'),
  (
    'de800000-0000-4000-8000-000000000005',
    'de100000-0000-4000-8000-000000000001',
    'de300000-0000-4000-8000-000000000001',
    'rules',
    'draft',
    'test',
    jsonb_build_object(
      'request', jsonb_build_object(
        'organizationId', 'de100000-0000-4000-8000-000000000001',
        'tournamentId', 'de300000-0000-4000-8000-000000000001'
      ),
      'assignments', jsonb_build_array(
        jsonb_build_object('judgeId', 'de700000-0000-4000-8000-000000000004', 'eventCode', 'LD', 'roundCode', 'R2'),
        jsonb_build_object('judgeId', 'de700000-0000-4000-8000-000000000004', 'eventCode', 'LD', 'roundCode', 'R3')
      )
    ),
    'de000000-0000-4000-8000-000000000001'
  );

INSERT INTO plugin_data.dv_sd_judge_assignments_v2 (
  id,
  organization_id,
  tournament_id,
  judge_id,
  allocation_draft_id,
  event_code,
  round_code,
  status,
  created_by
)
VALUES
  ('de900000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'de700000-0000-4000-8000-000000000001', 'de800000-0000-4000-8000-000000000001', 'LD', 'COMPLETE-1', 'assigned', 'de000000-0000-4000-8000-000000000001'),
  ('de900000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'de700000-0000-4000-8000-000000000001', 'de800000-0000-4000-8000-000000000001', 'LD', 'COMPLETE-2', 'assigned', 'de000000-0000-4000-8000-000000000001'),
  ('de900000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'de700000-0000-4000-8000-000000000002', 'de800000-0000-4000-8000-000000000002', 'LD', 'AMBIGUOUS-1', 'assigned', 'de000000-0000-4000-8000-000000000001'),
  ('de900000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'de700000-0000-4000-8000-000000000003', 'de800000-0000-4000-8000-000000000003', 'LD', 'UNMAPPED-1', 'assigned', 'de000000-0000-4000-8000-000000000001'),
  ('de900000-0000-4000-8000-000000000005', 'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000001', 'de700000-0000-4000-8000-000000000004', 'de800000-0000-4000-8000-000000000004', 'LD', 'R1', 'assigned', 'de000000-0000-4000-8000-000000000001');

-- Force a post-update ledger conflict so the completion RPC's transaction can
-- prove that the assignment state rolls back with the failed ledger insert.
INSERT INTO plugin_data.dv_sd_family_service_ledger (
  account_id,
  entry_type,
  credits,
  source_type,
  source_id,
  note,
  created_by
)
VALUES (
  'de600000-0000-4000-8000-000000000001',
  'earned',
  1,
  'judge_assignment',
  'de900000-0000-4000-8000-000000000002',
  'Pre-existing source conflict',
  'de000000-0000-4000-8000-000000000001'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.delete_dv_organization_data(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute DV tenant erasure'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.delete_dv_organization_data(uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot execute DV tenant erasure'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'plugin_data.delete_dv_organization_data(uuid)',
    'EXECUTE'
  ),
  'the trusted plugin backend can execute DV tenant erasure'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.consume_dv_guardian_availability(text,text,text[],text)',
    'EXECUTE'
  ),
  'anonymous callers cannot invoke the guardian consumption RPC directly'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.consume_dv_guardian_availability(text,text,text[],text)',
    'EXECUTE'
  ),
  'authenticated callers cannot invoke the guardian consumption RPC directly'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'plugin_data.consume_dv_guardian_availability(text,text,text[],text)',
    'EXECUTE'
  ),
  'the capability route backend can invoke guardian consumption atomically'
);

SELECT ok(
  NOT has_function_privilege('anon', 'plugin_data.complete_dv_judge_assignment(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE'),
  'anonymous callers cannot complete DV judge assignments'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'plugin_data.complete_dv_judge_assignment(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE'),
  'authenticated callers cannot complete DV judge assignments directly'
);

SELECT ok(
  has_function_privilege('service_role', 'plugin_data.complete_dv_judge_assignment(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE'),
  'the authorized DV backend can complete judge assignments atomically'
);

SELECT ok(
  NOT has_function_privilege('anon', 'plugin_data.approve_dv_allocation(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot approve DV allocations'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'plugin_data.approve_dv_allocation(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated callers cannot approve DV allocations directly'
);

SELECT ok(
  has_function_privilege('service_role', 'plugin_data.approve_dv_allocation(uuid,uuid,uuid)', 'EXECUTE'),
  'the authorized DV backend can approve allocations atomically'
);

SELECT has_index(
  'plugin_data',
  'dv_sd_family_service_ledger',
  'dv_family_service_ledger_source_once_idx',
  'judge completion credits are unique per immutable source'
);

SELECT throws_ok(
  $$
    SELECT plugin_data.complete_dv_judge_assignment(
      'de100000-0000-4000-8000-000000000001',
      'de900000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      2,
      'de000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'organization staff access is required',
  'a non-staff actor cannot complete a judge assignment'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_judge_assignments_v2 WHERE id = 'de900000-0000-4000-8000-000000000001'),
  'assigned',
  'authorization denial leaves the assignment unchanged'
);

SELECT lives_ok(
  $$
    SELECT plugin_data.complete_dv_judge_assignment(
      'de100000-0000-4000-8000-000000000001',
      'de900000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      2,
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized completion atomically updates the assignment and ledger'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_judge_assignments_v2 WHERE id = 'de900000-0000-4000-8000-000000000001'),
  'completed',
  'successful completion marks the assignment completed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM plugin_data.dv_sd_family_service_ledger
    WHERE account_id = 'de600000-0000-4000-8000-000000000001'
      AND source_type = 'judge_assignment'
      AND source_id = 'de900000-0000-4000-8000-000000000001'
      AND entry_type = 'earned'
  ),
  1,
  'successful completion writes exactly one service-credit entry'
);

SELECT lives_ok(
  $$
    SELECT plugin_data.complete_dv_judge_assignment(
      'de100000-0000-4000-8000-000000000001',
      'de900000-0000-4000-8000-000000000001',
      'de200000-0000-4000-8000-000000000001',
      2,
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  'retrying a completed assignment is idempotent'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM plugin_data.dv_sd_family_service_ledger
    WHERE account_id = 'de600000-0000-4000-8000-000000000001'
      AND source_type = 'judge_assignment'
      AND source_id = 'de900000-0000-4000-8000-000000000001'
      AND entry_type = 'earned'
  ),
  1,
  'an idempotent completion retry does not duplicate service credit'
);

SELECT throws_ok(
  $$
    SELECT plugin_data.complete_dv_judge_assignment(
      'de100000-0000-4000-8000-000000000001',
      'de900000-0000-4000-8000-000000000002',
      'de200000-0000-4000-8000-000000000001',
      2,
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "dv_family_service_ledger_source_once_idx"',
  'a duplicate immutable source rejects judge completion'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_judge_assignments_v2 WHERE id = 'de900000-0000-4000-8000-000000000002'),
  'assigned',
  'a failed ledger write rolls the assignment update back'
);

SELECT throws_ok(
  $$
    SELECT plugin_data.complete_dv_judge_assignment(
      'de100000-0000-4000-8000-000000000001',
      'de900000-0000-4000-8000-000000000003',
      'de200000-0000-4000-8000-000000000001',
      2,
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  'judge assignment maps to multiple family service accounts',
  'an ambiguous judge-to-household mapping fails closed'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_judge_assignments_v2 WHERE id = 'de900000-0000-4000-8000-000000000003'),
  'assigned',
  'ambiguous service-credit mapping leaves the assignment unchanged'
);

SELECT throws_ok(
  $$
    SELECT plugin_data.complete_dv_judge_assignment(
      'de100000-0000-4000-8000-000000000001',
      'de900000-0000-4000-8000-000000000004',
      'de200000-0000-4000-8000-000000000001',
      2,
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  'assignment service account or season binding is invalid',
  'an unmapped judge-to-household relationship fails closed'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_judge_assignments_v2 WHERE id = 'de900000-0000-4000-8000-000000000004'),
  'assigned',
  'missing service-credit mapping leaves the assignment unchanged'
);

SELECT throws_ok(
  $$
    SELECT plugin_data.approve_dv_allocation(
      'de100000-0000-4000-8000-000000000001',
      'de800000-0000-4000-8000-000000000005',
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'allocation exceeds a judge round limit',
  'existing non-cancelled assignments count against the judge round limit'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_allocation_drafts WHERE id = 'de800000-0000-4000-8000-000000000005'),
  'draft',
  'a round-limit denial leaves the allocation draft unapproved'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM plugin_data.dv_sd_judge_assignments_v2
    WHERE allocation_draft_id = 'de800000-0000-4000-8000-000000000005'
  ),
  0,
  'a round-limit denial rolls back every proposed assignment'
);

UPDATE plugin_data.dv_sd_judge_assignments_v2
SET status = 'cancelled'
WHERE id = 'de900000-0000-4000-8000-000000000005';

SELECT lives_ok(
  $$
    SELECT plugin_data.approve_dv_allocation(
      'de100000-0000-4000-8000-000000000001',
      'de800000-0000-4000-8000-000000000005',
      'de000000-0000-4000-8000-000000000001'
    )
  $$,
  'cancelled assignments are excluded while a proposal at the round limit succeeds'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM plugin_data.dv_sd_judge_assignments_v2
    WHERE allocation_draft_id = 'de800000-0000-4000-8000-000000000005'
  ),
  2,
  'successful allocation writes every proposed assignment'
);

SELECT is(
  (SELECT status FROM plugin_data.dv_sd_allocation_drafts WHERE id = 'de800000-0000-4000-8000-000000000005'),
  'approved',
  'successful allocation marks the draft approved'
);

SELECT is(
  plugin_data.approve_dv_allocation(
    'de100000-0000-4000-8000-000000000001',
    'de800000-0000-4000-8000-000000000005',
    'de000000-0000-4000-8000-000000000001'
  ),
  2,
  'retrying an approved allocation returns its durable assignment count'
);

SELECT lives_ok(
  $$SELECT plugin_data.delete_dv_organization_data('de100000-0000-4000-8000-000000000001')$$,
  'DV tenant erasure completes atomically across mutable and immutable relations'
);

SELECT is(
  (SELECT count(*)::integer FROM plugin_data.dv_sd_student_profiles WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  0,
  'DV profile rows are deleted for the target organization'
);

SELECT is(
  (SELECT count(*)::integer FROM plugin_data.dv_sd_audit_events WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  0,
  'immutable DV audit rows are deleted only through tenant erasure'
);

SELECT is(
  (SELECT count(*)::integer FROM plugin_data.dv_sd_student_profiles WHERE organization_id = 'de100000-0000-4000-8000-000000000002'),
  1,
  'DV rows for another organization are preserved'
);

SELECT is(
  (SELECT count(*)::integer FROM plugin_data.dv_sd_audit_events WHERE organization_id = 'de100000-0000-4000-8000-000000000002'),
  1,
  'DV audit rows for another organization are preserved'
);

SELECT is(
  (SELECT count(*)::integer FROM plugin_data.org_form_definitions WHERE organization_id = 'de100000-0000-4000-8000-000000000001' AND plugin_key = 'dv-speech-debate'),
  0,
  'shared form rows explicitly owned by DV are deleted'
);

SELECT is(
  (SELECT count(*)::integer FROM plugin_data.org_form_definitions WHERE organization_id = 'de100000-0000-4000-8000-000000000001' AND plugin_key = 'another-plugin'),
  1,
  'shared rows owned by another plugin are preserved'
);

SELECT * FROM finish();

ROLLBACK;
