BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(30);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_relationship_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass identity evidence through the relationship-only preview'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles_identity_base(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the service role cannot bypass the identity-safe merge wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the service role cannot call the response-loss-unsafe legacy merge signature'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the service role can call only the request-aware profile merge signature'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot call the request-aware merge RPC directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ee000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'merge-safety-officer@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'ee000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'merge-safety-member@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'ee000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'merge-safety-other-org@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ee100000-0000-4000-8000-000000000001',
    'CSF Merge Identity Safety', 'csf-merge-identity-safety', 'school', '981101'
  ),
  (
    'ee100000-0000-4000-8000-000000000002',
    'CSF Merge Identity Other', 'csf-merge-identity-other', 'school', '981102'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'ee100000-0000-4000-8000-000000000001',
    'ee000000-0000-4000-8000-000000000001',
    'admin', 'active'
  ),
  (
    'ee100000-0000-4000-8000-000000000001',
    'ee000000-0000-4000-8000-000000000002',
    'member', 'active'
  ),
  (
    'ee100000-0000-4000-8000-000000000002',
    'ee000000-0000-4000-8000-000000000003',
    'admin', 'active'
  );

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('ee200000-0000-4000-8000-000000000001', 'ee100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('ee200000-0000-4000-8000-000000000002', 'ee100000-0000-4000-8000-000000000001', 2032, 'Class of 2032');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email, personal_email,
  normalized_first_name, normalized_last_name,
  normalized_school_email, normalized_personal_email, source_summary
) VALUES
  ('ee300000-0000-4000-8000-000000000001', 'ee100000-0000-4000-8000-000000000001', 'Sofia', 'Nguyen', 'sofia@students.local.test', NULL, 'sofia', 'nguyen', 'sofia@students.local.test', NULL, '{}'),
  ('ee300000-0000-4000-8000-000000000002', 'ee100000-0000-4000-8000-000000000001', 'Maya', 'Patel', 'maya@students.local.test', NULL, 'maya', 'patel', 'maya@students.local.test', NULL, '{}'),
  ('ee300000-0000-4000-8000-000000000003', 'ee100000-0000-4000-8000-000000000001', 'Jordan', 'Lee', NULL, NULL, 'jordan', 'lee', NULL, NULL, '{}'),
  ('ee300000-0000-4000-8000-000000000004', 'ee100000-0000-4000-8000-000000000001', 'Jordan', 'Lee', NULL, NULL, 'jordan', 'lee', NULL, NULL, '{}'),
  ('ee300000-0000-4000-8000-000000000005', 'ee100000-0000-4000-8000-000000000001', 'Avery', 'Kim', 'avery.one@students.local.test', 'avery.shared@local.test', 'avery', 'kim', 'avery.one@students.local.test', 'avery.shared@local.test', '{}'),
  ('ee300000-0000-4000-8000-000000000006', 'ee100000-0000-4000-8000-000000000001', 'Avery', 'Kim', 'avery.two@students.local.test', 'avery.shared@local.test', 'avery', 'kim', 'avery.two@students.local.test', 'avery.shared@local.test', '{}'),
  ('ee300000-0000-4000-8000-000000000007', 'ee100000-0000-4000-8000-000000000001', 'Quinn', 'Park', 'quinn@students.local.test', NULL, 'quinn', 'park', 'quinn@students.local.test', NULL, '{"sources":["legacy"]}'),
  ('ee300000-0000-4000-8000-000000000008', 'ee100000-0000-4000-8000-000000000001', 'Quinn', 'Park', 'quinn@students.local.test', NULL, 'quinn', 'park', 'quinn@students.local.test', NULL, '{"sources":["current"]}'),
  ('ee300000-0000-4000-8000-000000000009', 'ee100000-0000-4000-8000-000000000001', 'Casey', 'Chen', 'casey@students.local.test', NULL, 'casey', 'chen', 'casey@students.local.test', NULL, '{}'),
  ('ee300000-0000-4000-8000-000000000010', 'ee100000-0000-4000-8000-000000000001', 'Casey', 'Chen', 'casey@students.local.test', NULL, 'casey', 'chen', 'casey@students.local.test', NULL, '{}');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
) VALUES
  ('ee100000-0000-4000-8000-000000000001', 'ee300000-0000-4000-8000-000000000009', 'ee200000-0000-4000-8000-000000000001', 'active'),
  ('ee100000-0000-4000-8000-000000000001', 'ee300000-0000-4000-8000-000000000010', 'ee200000-0000-4000-8000-000000000002', 'active'),
  ('ee100000-0000-4000-8000-000000000001', 'ee300000-0000-4000-8000-000000000007', 'ee200000-0000-4000-8000-000000000001', 'active');

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Attempted from another organization.',
    'ee000000-0000-4000-8000-000000000003',
    'ee400000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'Not authorized to merge CSF profiles.',
  'an org-B officer cannot merge two org-A student records'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000002',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Attempted through the wrong organization scope.',
    'ee000000-0000-4000-8000-000000000003',
    'ee400000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'Source CSF student record not found.',
  'an org-B officer cannot merge org-A student records through an org-B scope'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
      AND id IN (
        'ee300000-0000-4000-8000-000000000007',
        'ee300000-0000-4000-8000-000000000008'
      )
      AND record_status = 'active'
      AND merged_into_profile_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_merge_reviews
    WHERE correlation_id IN (
      'ee400000-0000-4000-8000-000000000004',
      'ee400000-0000-4000-8000-000000000005'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id IN (
      'ee400000-0000-4000-8000-000000000004',
      'ee400000-0000-4000-8000-000000000005'
    )
  ),
  'cross-organization merge attempts leave both profiles active with zero reviews or receipts'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Attempted without the profile-management role.',
    'ee000000-0000-4000-8000-000000000002',
    'ee400000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Not authorized to merge CSF profiles.',
  'a trusted service call still revalidates the recorded merge actor before private evidence'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000002'
  )->>'canMerge')::boolean,
  'unrelated students are never marked ready merely because relationship rows do not overlap'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ee100000-0000-4000-8000-000000000001',
      'ee300000-0000-4000-8000-000000000001',
      'ee300000-0000-4000-8000-000000000002'
    ),
    '$.conflicts[*] ? (@.type == "identity_name_mismatch")'
  ),
  'the preview names the conflicting student identity'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000002',
    'The officer believes these are duplicates.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'the locked merge rejects the same unrelated pair shown as blocked in preview'
);
SELECT extensions.is(
  (SELECT record_status FROM plugin_data.csf_profiles WHERE id = 'ee300000-0000-4000-8000-000000000001'),
  'active',
  'a rejected unsafe merge leaves the source profile active'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ee100000-0000-4000-8000-000000000001',
      'ee300000-0000-4000-8000-000000000003',
      'ee300000-0000-4000-8000-000000000004'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'matching names without an exact email remain insufficient corroboration'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ee100000-0000-4000-8000-000000000001',
      'ee300000-0000-4000-8000-000000000005',
      'ee300000-0000-4000-8000-000000000006'
    ),
    '$.conflicts[*] ? (@.type == "school_email_mismatch")'
  ),
  'a shared personal email cannot override conflicting school identities'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ee100000-0000-4000-8000-000000000001',
      'ee300000-0000-4000-8000-000000000009',
      'ee300000-0000-4000-8000-000000000010'
    ),
    '$.conflicts[*] ? (@.type == "active_cohort_mismatch")'
  ),
  'different active graduating classes are a hard identity conflict'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008'
  )->>'canMerge')::boolean,
  'consistent names and one exact school email can corroborate a conflict-free duplicate'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Exact school identity confirmed from both sources.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000003'
  )->>'targetProfileId',
  'ee300000-0000-4000-8000-000000000008',
  'the locked merge accepts the corroborated duplicate'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_merge_reviews
    WHERE source_profile_id = 'ee300000-0000-4000-8000-000000000007'
      AND target_profile_id = 'ee300000-0000-4000-8000-000000000008'
      AND evidence->'preview'->'identityEvidence' @> '{"nameConsistent":true,"exactEmailOverlap":true}'::jsonb
  ),
  'the approved review preserves the exact identity evidence enforced by the merge'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Exact school identity confirmed from both sources.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000003'
  )->>'correlationId',
  (
    SELECT correlation_id::text
    FROM plugin_data.csf_profile_merge_reviews
    WHERE source_profile_id = 'ee300000-0000-4000-8000-000000000007'
      AND target_profile_id = 'ee300000-0000-4000-8000-000000000008'
      AND status = 'approved'
  ),
  'an exact merge retry returns the original committed correlation coordinate'
);
SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Exact school identity confirmed from both sources.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000003'
  )->>'movedRecords',
  '1',
  'an exact merge retry returns the original nonzero move result instead of running a zero-record second merge'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
      AND correlation_id = 'ee400000-0000-4000-8000-000000000003'
      AND action = 'profile.merge_request_committed'
  ),
  1,
  'the merge writes one immutable response-loss receipt'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_merge_reviews
    WHERE source_profile_id = 'ee300000-0000-4000-8000-000000000007'
      AND target_profile_id = 'ee300000-0000-4000-8000-000000000008'
      AND status = 'approved'
  ),
  1,
  'an exact retry creates no second merge review'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE action = 'profile.merge'
      AND target_id = 'ee300000-0000-4000-8000-000000000008'
      AND after_data ->> 'sourceProfileId' = 'ee300000-0000-4000-8000-000000000007'
  ),
  1,
  'an exact retry creates no second domain merge audit'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
      AND profile_id = 'ee300000-0000-4000-8000-000000000008'
      AND cohort_id = 'ee200000-0000-4000-8000-000000000001'
  ),
  1,
  'the source cohort record is moved to the exact canonical target once'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
      AND profile_id = 'ee300000-0000-4000-8000-000000000007'
  ),
  0,
  'an exact retry leaves zero movable cohort records on the merged source'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000006',
    'Exact school identity confirmed from both sources.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'That profile-merge request identifier is already bound to a different change.',
  'one merge request UUID cannot be rebound to a different canonical target'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
  AND user_id = 'ee000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Exact school identity confirmed from both sources.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Not authorized to merge CSF profiles.',
  'revoked profile authority is checked before an existing merge receipt can be replayed'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
  AND user_id = 'ee000000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_profiles
SET merge_reason = merge_reason || ' Later source correction.',
    updated_at = now()
WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
  AND id = 'ee300000-0000-4000-8000-000000000007';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ee100000-0000-4000-8000-000000000001',
    'ee300000-0000-4000-8000-000000000007',
    'ee300000-0000-4000-8000-000000000008',
    'Exact school identity confirmed from both sources.',
    'ee000000-0000-4000-8000-000000000001',
    'ee400000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'The committed profile merge receipt is stale. Reload the member records for their current state.',
  'a later source mutation refuses an obsolete merge success receipt'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users still cannot call the identity preview directly'
);

SELECT * FROM extensions.finish();

ROLLBACK;
