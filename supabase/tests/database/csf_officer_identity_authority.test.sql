BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.no_plan();

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role', 'plugin_data.csf_merge_identity_attested()', 'EXECUTE'
  ),
  'the attestation flag cannot be read or reasoned about by a client role'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_profile_merge_preview_officer_attestation_base(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the pre-attestation preview layer stays owner-internal'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid,text[])',
    'EXECUTE'
  ),
  'the attested merge entrypoint is reachable from the reviewed server'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid,text[])',
    'EXECUTE'
  ),
  'the attested merge entrypoint is never reachable from a browser role'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'attest-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'attest-outsider@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'attest-student@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'attest-claimant@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('ea100000-0000-4000-8000-000000000001', 'Officer identity authority test', 'officer-identity-authority', 'school', '731204');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000004', 'member', 'active');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES ('ea300000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 2034, 'Class of 2034', 'active');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email, source_summary
) VALUES
  ('ea400000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001', 'Attest', 'Student', 'attest', 'student', NULL, NULL, '{"sources":["roster"]}'),
  ('ea400000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001', 'Attest', 'Student', 'attest', 'student', NULL, NULL, '{"sources":["application"]}'),
  ('ea400000-0000-4000-8000-000000000003', 'ea100000-0000-4000-8000-000000000001', 'Rival', 'Student', 'rival', 'student', 'rival-a@students.local.test', 'rival-a@students.local.test', '{}'),
  ('ea400000-0000-4000-8000-000000000004', 'ea100000-0000-4000-8000-000000000001', 'Rival', 'Student', 'rival', 'student', 'rival-b@students.local.test', 'rival-b@students.local.test', '{}'),
  ('ea400000-0000-4000-8000-000000000005', 'ea100000-0000-4000-8000-000000000001', 'Connect', 'Student', 'connect', 'student', NULL, NULL, '{}'),
  ('ea400000-0000-4000-8000-000000000006', 'ea100000-0000-4000-8000-000000000001', 'Moved', 'Student', 'moved', 'student', NULL, NULL, '{}'),
  ('ea400000-0000-4000-8000-000000000007', 'ea100000-0000-4000-8000-000000000001', 'Correct', 'Student', 'correct', 'student', NULL, NULL, '{}');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  organization_id, profile_id, cohort_id, status
)
SELECT
  'ea100000-0000-4000-8000-000000000001',
  profile.id,
  'ea300000-0000-4000-8000-000000000001',
  'active'
FROM plugin_data.csf_profiles AS profile
WHERE profile.organization_id = 'ea100000-0000-4000-8000-000000000001';

-- Missing corroboration is reported exactly as before, so nothing that reads
-- the preview today changes behaviour.
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002'
  ) ->> 'canMerge')::boolean,
  'two emailless records still cannot merge on their own'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ea100000-0000-4000-8000-000000000001',
      'ea400000-0000-4000-8000-000000000001',
      'ea400000-0000-4000-8000-000000000002'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'the missing-email finding is still reported as a conflict'
);
SELECT extensions.is(
  plugin_data.csf_profile_merge_preview(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002'
  ) -> 'attestableConflicts' -> 0 ->> 'type',
  'identity_email_missing',
  'the missing-email finding is offered to the officer'
);
SELECT extensions.ok(
  (plugin_data.csf_profile_merge_preview(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002'
  ) ->> 'canMergeWithOfficerAttestation')::boolean,
  'an officer can carry the merge when nothing contradicts the identity'
);
SELECT extensions.ok(
  NOT (plugin_data.csf_profile_merge_preview(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000003',
    'ea400000-0000-4000-8000-000000000004'
  ) ->> 'canMergeWithOfficerAttestation')::boolean,
  'different school email identities are not offered for attestation'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002',
    'Confirmed with the student in person.',
    'ea000000-0000-4000-8000-000000000001',
    'ea900000-0000-4000-8000-000000000001',
    ARRAY['identity_name_mismatch']
  ) $$,
  'P0001',
  'That merge finding is not one an officer may attest past.',
  'an officer cannot attest past a finding that contradicts the identity'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002',
    'Confirmed with the student in person.',
    'ea000000-0000-4000-8000-000000000002',
    'ea900000-0000-4000-8000-000000000001',
    ARRAY['identity_email_missing']
  ) $$,
  'P0001',
  'Not authorized to merge CSF profiles.',
  'an attestation is not authority; the actor still has to be an officer'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000003',
    'ea400000-0000-4000-8000-000000000004',
    'Confirmed with the student in person.',
    'ea000000-0000-4000-8000-000000000001',
    'ea900000-0000-4000-8000-000000000002',
    ARRAY['identity_email_missing']
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'attesting the missing email cannot clear a concrete school-email conflict'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_merge_profiles(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002',
    'Confirmed with the student in person.',
    'ea000000-0000-4000-8000-000000000001',
    'ea900000-0000-4000-8000-000000000003',
    ARRAY[]::text[]
  ) $$,
  'P0001',
  'These CSF student records have conflicts that must be resolved before merging.',
  'without an attestation the entrypoint behaves exactly like the merge it wraps'
);

SELECT extensions.is(
  plugin_data.csf_merge_profiles(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000002',
    'Confirmed with the student in person.',
    'ea000000-0000-4000-8000-000000000001',
    'ea900000-0000-4000-8000-000000000004',
    ARRAY['identity_email_missing']
  ) ->> 'targetProfileId',
  'ea400000-0000-4000-8000-000000000002',
  'an attested officer merge keeps the chosen canonical record'
);
SELECT extensions.is(
  (SELECT record_status FROM plugin_data.csf_profiles
   WHERE id = 'ea400000-0000-4000-8000-000000000001'),
  'merged',
  'the duplicate becomes hidden provenance'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND action = 'profile.merge_identity_attested'
     AND correlation_id = 'ea900000-0000-4000-8000-000000000004'),
  1,
  'the attestation itself is recorded'
);
SELECT extensions.is(
  (SELECT after_data -> 'attestedConflicts' ->> 0
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND action = 'profile.merge_identity_attested'
     AND correlation_id = 'ea900000-0000-4000-8000-000000000004'),
  'identity_email_missing',
  'the receipt names what the officer carried'
);
SELECT extensions.ok(
  jsonb_path_exists(
    plugin_data.csf_profile_merge_preview(
      'ea100000-0000-4000-8000-000000000001',
      'ea400000-0000-4000-8000-000000000003',
      'ea400000-0000-4000-8000-000000000004'
    ),
    '$.conflicts[*] ? (@.type == "identity_email_missing")'
  ),
  'the attestation does not outlive the merge that carried it'
);

-- An officer decision supersedes a pending claim on the same record.
INSERT INTO plugin_data.csf_profile_accounts (
  id, organization_id, profile_id, user_id, status
) VALUES (
  'ea500000-0000-4000-8000-000000000001',
  'ea100000-0000-4000-8000-000000000001',
  'ea400000-0000-4000-8000-000000000005',
  'ea000000-0000-4000-8000-000000000004',
  'pending'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_staff_connect_profile_account(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000005',
    'ea000000-0000-4000-8000-000000000001',
    'attest-student@local.test',
    'Confirmed identity with this student.',
    'ea900000-0000-4000-8000-000000000005'
  ) $$,
  'a pending claim no longer dead-ends the officer connection'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE id = 'ea500000-0000-4000-8000-000000000001'),
  'rejected',
  'the superseded claim is closed rather than deleted'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND action = 'profile.account_connection_superseded'
     AND correlation_id = 'ea900000-0000-4000-8000-000000000005'),
  1,
  'superseding a claim is recorded against the same decision'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND profile_id = 'ea400000-0000-4000-8000-000000000005'
     AND user_id = 'ea000000-0000-4000-8000-000000000003'),
  'verified',
  'the officer decision connects the account it named'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_staff_connect_profile_account(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000005',
    'ea000000-0000-4000-8000-000000000001',
    'attest-claimant@local.test',
    'Confirmed identity with this student.',
    'ea900000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'This CSF profile already has a connected account. Review it before replacing it.',
  'a verified connection still has to be unlinked first'
);

-- The other direction: the same account held against a different record.
INSERT INTO plugin_data.csf_profile_accounts (
  id, organization_id, profile_id, user_id, status
) VALUES (
  'ea500000-0000-4000-8000-000000000002',
  'ea100000-0000-4000-8000-000000000001',
  'ea400000-0000-4000-8000-000000000006',
  'ea000000-0000-4000-8000-000000000004',
  'pending'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_staff_connect_profile_account(
    'ea100000-0000-4000-8000-000000000001',
    'ea400000-0000-4000-8000-000000000007',
    'ea000000-0000-4000-8000-000000000001',
    'attest-claimant@local.test',
    'Confirmed identity with this student.',
    'ea900000-0000-4000-8000-000000000007'
  ) $$,
  'an officer may move a held account onto the record it belongs to'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_profile_accounts
   WHERE id = 'ea500000-0000-4000-8000-000000000002'),
  'rejected',
  'the claim on the wrong record is closed by the same decision'
);

SELECT * FROM extensions.finish();
ROLLBACK;
