BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(45);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous clients cannot preview private CSF profile merges'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot preview private CSF profile merges directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)', 'EXECUTE'),
  'the server role can preview CSF profile merges'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_unlink_profile_account(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'anonymous clients cannot unlink CSF accounts'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_unlink_profile_account(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot unlink CSF accounts directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_unlink_profile_account(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'the server role can unlink an incorrect account'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'anonymous clients cannot merge CSF profiles'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot merge CSF profiles directly'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'the server role can merge conflict-free CSF profiles'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('cd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'correction-officer@local.test', now(), '{}', '{}', now(), now()),
  ('cd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'incorrect-account@local.test', now(), '{}', '{}', now(), now()),
  ('cd000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'merge-account@local.test', now(), '{}', '{}', now(), now()),
  ('cd000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'conflict-source@local.test', now(), '{}', '{}', now(), now()),
  ('cd000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'conflict-target@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('cd100000-0000-4000-8000-000000000001', 'CSF Member Corrections A', 'csf-member-corrections-a', 'school', '988001'),
  ('cd100000-0000-4000-8000-000000000002', 'CSF Member Corrections B', 'csf-member-corrections-b', 'school', '988002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES
  ('cd200000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall'),
  ('cd200000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000001', 'S31', 'Spring 2031', '2030-2031', 'spring'),
  ('cd200000-0000-4000-8000-000000000003', 'cd100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES
  ('cd300000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 2032, 'Class of 2032'),
  ('cd300000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000002', 2032, 'Class of 2032');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email, source_summary
) VALUES
  ('cd400000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'Unlink', 'Student', 'unlink@student.test', 'unlink', 'student', 'unlink@student.test', '{"sources":["roster"]}'),
  ('cd400000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000001', 'Merge', 'Source', 'merge@student.test', 'merge', 'source', 'merge@student.test', '{"sources":["legacy workbook"]}'),
  ('cd400000-0000-4000-8000-000000000003', 'cd100000-0000-4000-8000-000000000001', 'Merge', 'Canonical', 'canonical@student.test', 'merge', 'canonical', 'canonical@student.test', '{"sources":["current application"]}'),
  ('cd400000-0000-4000-8000-000000000004', 'cd100000-0000-4000-8000-000000000001', 'Conflict', 'Source', 'conflict-source@student.test', 'conflict', 'source', 'conflict-source@student.test', '{}'),
  ('cd400000-0000-4000-8000-000000000005', 'cd100000-0000-4000-8000-000000000001', 'Conflict', 'Target', 'conflict-target@student.test', 'conflict', 'target', 'conflict-target@student.test', '{}'),
  ('cd400000-0000-4000-8000-000000000006', 'cd100000-0000-4000-8000-000000000001', 'Account', 'Conflict A', NULL, 'account', 'conflict a', NULL, '{}'),
  ('cd400000-0000-4000-8000-000000000007', 'cd100000-0000-4000-8000-000000000001', 'Account', 'Conflict B', NULL, 'account', 'conflict b', NULL, '{}'),
  ('cd400000-0000-4000-8000-000000000008', 'cd100000-0000-4000-8000-000000000002', 'Other', 'Tenant', NULL, 'other', 'tenant', NULL, '{}');

INSERT INTO plugin_data.csf_profile_accounts (
  id, organization_id, profile_id, user_id, status, is_primary, linked_by
) VALUES
  ('cd500000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'verified', true, 'cd000000-0000-4000-8000-000000000001'),
  ('cd500000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000003', 'pending', false, 'cd000000-0000-4000-8000-000000000001'),
  ('cd500000-0000-4000-8000-000000000003', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000006', 'cd000000-0000-4000-8000-000000000004', 'verified', true, 'cd000000-0000-4000-8000-000000000001'),
  ('cd500000-0000-4000-8000-000000000004', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000007', 'cd000000-0000-4000-8000-000000000005', 'verified', true, 'cd000000-0000-4000-8000-000000000001');

SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_profile_accounts (
       organization_id, profile_id, user_id, status
     ) VALUES (
       'cd100000-0000-4000-8000-000000000002',
       'cd400000-0000-4000-8000-000000000001',
       'cd000000-0000-4000-8000-000000000005',
       'pending'
     ) $$,
  '23503',
  'insert or update on table "csf_profile_accounts" violates foreign key constraint "csf_profile_accounts_profile_organization_fkey"',
  'account connections reject cross-organization profile relationships'
);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status, current_grade_level, submitted_at
) VALUES
  ('cd600000-0000-4000-8000-000000000001', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000002', 'cd300000-0000-4000-8000-000000000001', 'cd200000-0000-4000-8000-000000000001', 'legacy_import', 'submitted', 11, now()),
  ('cd600000-0000-4000-8000-000000000002', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000003', 'cd300000-0000-4000-8000-000000000001', 'cd200000-0000-4000-8000-000000000002', 'manual', 'submitted', 11, now()),
  ('cd600000-0000-4000-8000-000000000003', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000004', 'cd300000-0000-4000-8000-000000000001', 'cd200000-0000-4000-8000-000000000001', 'manual', 'submitted', 11, now()),
  ('cd600000-0000-4000-8000-000000000004', 'cd100000-0000-4000-8000-000000000001', 'cd400000-0000-4000-8000-000000000005', 'cd300000-0000-4000-8000-000000000001', 'cd200000-0000-4000-8000-000000000001', 'manual', 'submitted', 11, now());

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id, status
) VALUES (
  'cd700000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd400000-0000-4000-8000-000000000002',
  'cd200000-0000-4000-8000-000000000001',
  'cd300000-0000-4000-8000-000000000001',
  'cd600000-0000-4000-8000-000000000001',
  'active'
);

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  id, organization_id, profile_id, cohort_id, status
) VALUES (
  'cd800000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd400000-0000-4000-8000-000000000002',
  'cd300000-0000-4000-8000-000000000001',
  'active'
);

INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, source, points, point_type, status
) VALUES (
  'cd900000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd400000-0000-4000-8000-000000000002',
  'cd200000-0000-4000-8000-000000000001',
  'sheet', 2, 'non_drive', 'verified'
);

INSERT INTO plugin_data.csf_meeting_attendance (
  id, organization_id, profile_id, term_id, meeting_key, meeting_label, status, source
) VALUES (
  'cda00000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd400000-0000-4000-8000-000000000002',
  'cd200000-0000-4000-8000-000000000001',
  'fall-general', 'Fall general meeting', 'attended', 'manual'
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, status
) VALUES (
  'cdb00000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cd200000-0000-4000-8000-000000000001',
  'Food bank', 'Sort donated food.', 'published'
);

INSERT INTO plugin_data.csf_opportunity_signups (
  id, organization_id, opportunity_id, profile_id, term_id, source, signup_status
) VALUES (
  'cdc00000-0000-4000-8000-000000000001',
  'cd100000-0000-4000-8000-000000000001',
  'cdb00000-0000-4000-8000-000000000001',
  'cd400000-0000-4000-8000-000000000002',
  'cd200000-0000-4000-8000-000000000001',
  'manual', 'signed_up'
);

SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003'
  )->>'canMerge')::boolean,
  'preview allows records whose semester history does not overlap'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003'
  )->'source'->>'id',
  'cd400000-0000-4000-8000-000000000002',
  'preview identifies the source record explicitly'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003'
  )->'target'->>'id',
  'cd400000-0000-4000-8000-000000000003',
  'preview identifies the canonical target explicitly'
);
SELECT extensions.is(
  (plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003'
  )->'source'->'counts'->>'credits')::integer,
  1,
  'preview counts the history that will move from the source record'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000008'
  ) $$,
  'P0001', 'Source CSF student record not found.',
  'profile preview does not cross organization boundaries'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_unlink_profile_account(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000001',
    'wrong',
    'cd000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'Explain why this Let''s Assist account connection is incorrect.',
  'unlinking requires a meaningful officer reason'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_unlink_profile_account(
    'cd100000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000001',
    'Connected to the wrong student account.',
    'cd000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'Active CSF student record not found.',
  'unlinking cannot target a record in another organization'
);
SELECT extensions.is(
  plugin_data.csf_unlink_profile_account(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000001',
    'cd500000-0000-4000-8000-000000000001',
    'Connected to the wrong student account.',
    'cd000000-0000-4000-8000-000000000001'
  )->>'status',
  'revoked',
  'unlinking returns the final revoked connection status'
);
SELECT extensions.ok(
  (SELECT status = 'revoked' AND NOT is_primary AND revoked_at IS NOT NULL
   FROM plugin_data.csf_profile_accounts WHERE id = 'cd500000-0000-4000-8000-000000000001'),
  'unlinking revokes the account and removes primary status'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
      AND action = 'profile.account_unlinked'
      AND target_id = 'cd500000-0000-4000-8000-000000000001'
      AND correlation_id IS NOT NULL
      AND reason_code = 'incorrect_account_unlinked'
  ),
  'unlinking writes a correlated immutable audit event'
);
SELECT extensions.is(
  (SELECT record_status FROM plugin_data.csf_profiles WHERE id = 'cd400000-0000-4000-8000-000000000001'),
  'active',
  'unlinking leaves the permanent student record active'
);

SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000004',
    'cd400000-0000-4000-8000-000000000005'
  )->>'canMerge')::boolean,
  'preview blocks records with overlapping semester applications'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000004',
    'cd400000-0000-4000-8000-000000000005'
  )->'conflicts'->0->>'type',
  'term_application',
  'preview identifies an overlapping application conflict'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000004',
    'cd400000-0000-4000-8000-000000000005',
    'These were confirmed as duplicate records.',
    'cd000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'These CSF student records have conflicts that must be resolved before merging.',
  'the atomic merge enforces the same conflicts shown in preview'
);
SELECT extensions.is(
  (SELECT record_status FROM plugin_data.csf_profiles WHERE id = 'cd400000-0000-4000-8000-000000000004'),
  'active',
  'a conflict leaves the source record unchanged'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profile_merge_reviews
   WHERE source_profile_id = 'cd400000-0000-4000-8000-000000000004'),
  0,
  'a rejected conflict does not leave a partial merge review'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000006',
    'cd400000-0000-4000-8000-000000000007'
  )->>'canMerge')::boolean,
  'preview blocks profiles connected to different verified accounts'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000006',
    'cd400000-0000-4000-8000-000000000007'
  )->'conflicts'->0->>'type',
  'verified_account',
  'preview names the verified account conflict'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003',
    'short',
    'cd000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'Explain why these two CSF student records are duplicates.',
  'merging requires a meaningful officer reason'
);

SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003',
    'Same student confirmed from both source documents.',
    'cd000000-0000-4000-8000-000000000001'
  )->>'targetProfileId',
  'cd400000-0000-4000-8000-000000000003',
  'merge returns the selected canonical record'
);
SELECT extensions.ok(
  (SELECT record_status = 'merged'
      AND merged_into_profile_id = 'cd400000-0000-4000-8000-000000000003'
      AND merged_at IS NOT NULL
      AND merged_by = 'cd000000-0000-4000-8000-000000000001'
      AND merge_reason = 'Same student confirmed from both source documents.'
   FROM plugin_data.csf_profiles WHERE id = 'cd400000-0000-4000-8000-000000000002'),
  'source remains as a complete merged provenance row'
);
SELECT extensions.is(
  (SELECT record_status FROM plugin_data.csf_profiles WHERE id = 'cd400000-0000-4000-8000-000000000003'),
  'active',
  'canonical target remains active'
);
SELECT extensions.ok(
  (SELECT source_summary->'mergedProfiles' @> '[{"profileId":"cd400000-0000-4000-8000-000000000002"}]'::jsonb
   FROM plugin_data.csf_profiles WHERE id = 'cd400000-0000-4000-8000-000000000003'),
  'canonical record keeps a reference to the merged source provenance'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM (
      SELECT profile_id FROM plugin_data.csf_term_applications WHERE id = 'cd600000-0000-4000-8000-000000000001'
      UNION ALL SELECT profile_id FROM plugin_data.csf_term_memberships WHERE id = 'cd700000-0000-4000-8000-000000000001'
      UNION ALL SELECT profile_id FROM plugin_data.csf_profile_cohort_memberships WHERE id = 'cd800000-0000-4000-8000-000000000001'
      UNION ALL SELECT profile_id FROM plugin_data.csf_credit_records WHERE id = 'cd900000-0000-4000-8000-000000000001'
      UNION ALL SELECT profile_id FROM plugin_data.csf_meeting_attendance WHERE id = 'cda00000-0000-4000-8000-000000000001'
      UNION ALL SELECT profile_id FROM plugin_data.csf_opportunity_signups WHERE id = 'cdc00000-0000-4000-8000-000000000001'
      UNION ALL SELECT profile_id FROM plugin_data.csf_profile_accounts WHERE id = 'cd500000-0000-4000-8000-000000000002'
    ) AS moved
    WHERE moved.profile_id = 'cd400000-0000-4000-8000-000000000003'
  ),
  7,
  'all representative operational history moves to the canonical record'
);
SELECT extensions.is(
  (
    SELECT
      (SELECT count(*) FROM plugin_data.csf_term_applications WHERE profile_id = 'cd400000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_term_memberships WHERE profile_id = 'cd400000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_credit_records WHERE profile_id = 'cd400000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_meeting_attendance WHERE profile_id = 'cd400000-0000-4000-8000-000000000002')
      + (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE profile_id = 'cd400000-0000-4000-8000-000000000002')
  )::integer,
  0,
  'no operational history remains attached to the merged source'
);
SELECT extensions.is(
  (SELECT profile_id FROM plugin_data.csf_profile_accounts WHERE id = 'cd500000-0000-4000-8000-000000000002'),
  'cd400000-0000-4000-8000-000000000003'::uuid,
  'a non-conflicting account connection moves to the canonical record'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles
   WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
     AND id = 'cd400000-0000-4000-8000-000000000002'
     AND record_status = 'active'),
  0,
  'active-directory queries hide merged source records'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_merge_reviews
    WHERE organization_id = 'cd100000-0000-4000-8000-000000000001'
      AND source_profile_id = 'cd400000-0000-4000-8000-000000000002'
      AND target_profile_id = 'cd400000-0000-4000-8000-000000000003'
      AND status = 'approved'
      AND correlation_id IS NOT NULL
      AND source_snapshot->>'id' = 'cd400000-0000-4000-8000-000000000002'
      AND target_snapshot->>'id' = 'cd400000-0000-4000-8000-000000000003'
  ),
  'merge stores the approved source/target preview and correlation ID'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_merge_reviews AS review
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.organization_id = review.organization_id
      AND audit.correlation_id = review.correlation_id
      AND audit.action = 'profile.merge'
    WHERE review.source_profile_id = 'cd400000-0000-4000-8000-000000000002'
      AND audit.target_id = 'cd400000-0000-4000-8000-000000000003'
  ),
  'approved merge review and immutable audit share one correlation ID'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE action = 'profile.merge'
      AND target_id = 'cd400000-0000-4000-8000-000000000003'
      AND after_data->>'sourceProvenancePreserved' = 'true'
  ),
  'merge audit explicitly records that source provenance was preserved'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003',
    'Attempt to merge the same source twice.',
    'cd000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'The source CSF student record has already been merged.',
  'a merged source cannot be merged a second time'
);
SELECT extensions.throws_ok(
  $$ UPDATE plugin_data.csf_admin_audit_events
     SET reason_code = 'tampered'
     WHERE action = 'profile.merge'
       AND target_id = 'cd400000-0000-4000-8000-000000000003' $$,
  'P0001', 'CSF audit events are immutable.',
  'member-correction audit history cannot be changed'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'cd100000-0000-4000-8000-000000000002',
    'cd400000-0000-4000-8000-000000000003',
    'cd400000-0000-4000-8000-000000000008',
    'Cross-tenant merge must never be allowed.',
    'cd000000-0000-4000-8000-000000000001'
  ) $$,
  'P0001', 'Source CSF student record not found.',
  'atomic merge cannot cross organization boundaries'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles
    WHERE id = 'cd400000-0000-4000-8000-000000000002'
      AND record_status = 'merged'
      AND source_summary->'sources' @> '["legacy workbook"]'::jsonb
  ),
  'the original merged source row and its source evidence remain queryable'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_profile_merge_preview(
    'cd100000-0000-4000-8000-000000000001',
    'cd400000-0000-4000-8000-000000000003',
    'cd400000-0000-4000-8000-000000000002'
  ) $$,
  'P0001', 'The target CSF student record is not active.',
  'a merged provenance row cannot become a future canonical target'
);

SELECT * FROM extensions.finish();

ROLLBACK;
