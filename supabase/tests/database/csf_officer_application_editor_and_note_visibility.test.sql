-- The officer application-field editor and the officer/member split on profile
-- notes: execution grants, the allowlist, the refusals, replay, and the member
-- projection.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(33);

-- ---------------------------------------------------------------------------
-- A. Execution grants
--
-- The service signature is reachable by the server role and nobody else; the
-- implementation behind it is reachable by neither a client nor the server
-- role, so the V128 lock order cannot be bypassed.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_edit_term_application_fields(uuid,uuid,jsonb,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot edit an application record'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_edit_term_application_fields(uuid,uuid,jsonb,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot edit an application record'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_edit_term_application_fields(uuid,uuid,jsonb,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can edit an application record'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_edit_term_application_fields_locked_impl(uuid,uuid,jsonb,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role cannot reach the implementation past its authorization wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_member_visible_profile_notes(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot read profile notes directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_add_profile_note(uuid,uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'the server role can write a note with an explicit audience'
);

-- ---------------------------------------------------------------------------
-- B. The allowlist itself
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT ('profile_id' = ANY (plugin_data.csf_application_editable_fields()))
    AND NOT ('decision_status' = ANY (plugin_data.csf_application_editable_fields()))
    AND NOT ('review_notes' = ANY (plugin_data.csf_application_editable_fields()))
    AND NOT ('application_data' = ANY (plugin_data.csf_application_editable_fields())),
  'ownership, decision, private review, and raw source columns are not editable'
);
SELECT extensions.ok(
  'edit_application_records' = ANY (plugin_data.csf_role_permission_catalog()),
  'the new capability is in the shared permission catalog'
);

-- ---------------------------------------------------------------------------
-- C. Fixtures
--
-- The officer is an organization admin, which short-circuits
-- csf_actor_has_permission. The bystander is an active member with no staff
-- position, so the permission gate has a real negative case.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-app-editor-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ce000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-app-editor-bystander@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'CSF Application Editor',
  'csf-application-editor',
  'school',
  '730009'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES
  ('ce200000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
   'F26', 'Fall 2026', '2026-2027', 'fall', true, 'open'),
  ('ce200000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001',
   -- Archived rather than closed: the closure CHECK requires a real closure
   -- pointer for 'closed', and this fixture is about the editor's refusal, not
   -- about manufacturing a closure snapshot.
   'S26', 'Spring 2026', '2025-2026', 'spring', false, 'archived');

INSERT INTO plugin_data.csf_cohorts (id, organization_id, label, graduation_year)
VALUES ('ce400000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
        'Class of 2028', 2028);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('ce300000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
   'Ari', 'Editor', 'ari', 'editor');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  current_grade_level, returning_status, list_i_points, grand_total_points
) VALUES
  ('ce500000-0000-4000-8000-000000000001', 'ce100000-0000-4000-8000-000000000001',
   'ce300000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000001',
   'ce200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   10, 'new', 2.00, 5.00),
  ('ce500000-0000-4000-8000-000000000002', 'ce100000-0000-4000-8000-000000000001',
   'ce300000-0000-4000-8000-000000000001', 'ce400000-0000-4000-8000-000000000001',
   'ce200000-0000-4000-8000-000000000002', 'google_form_sheet', 'submitted',
   9, 'new', 1.00, 3.00);

-- ---------------------------------------------------------------------------
-- D. Authorization and validation
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"shirt_size": "L"}'::jsonb,
      'Student reported the wrong size.',
      'ce000000-0000-4000-8000-000000000002',
      'ce600000-0000-4000-8000-000000000001'
    )
  $$,
  NULL,
  'Not authorized to correct CSF application records.',
  'a member without the capability cannot correct an application'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"profile_id": "ce300000-0000-4000-8000-00000000dead"}'::jsonb,
      'Trying to move this record to someone else.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'That application field cannot be edited here.',
  'a record cannot be reassigned to a different member through the editor'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"decision_status": "approved", "review_notes": "looks fine"}'::jsonb,
      'Trying to approve this through the editor.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000003'
    )
  $$,
  '22023',
  'That application field cannot be edited here.',
  'a decision cannot be published through the editor'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"shirt_size": "L"}'::jsonb,
      'typo',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000004'
    )
  $$,
  NULL,
  'Explain the correction in at least 8 characters.',
  'a correction needs a real reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'Nothing selected on purpose.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000005'
    )
  $$,
  NULL,
  'Choose at least one field to correct.',
  'an empty correction is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"current_grade_level": "13"}'::jsonb,
      'Reported grade was out of range.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000006'
    )
  $$,
  NULL,
  'Grade level must be 9, 10, 11, or 12.',
  'a per-column rule refuses an impossible value'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000002',
      '{"shirt_size": "L"}'::jsonb,
      'Correcting an archived semester.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000007'
    )
  $$,
  '55000',
  'This semester is finished. Reopen it before correcting an application.',
  'a finished semester keeps its record'
);

-- ---------------------------------------------------------------------------
-- E. The happy path, the audit, and replay
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (plugin_data.csf_edit_term_application_fields(
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    '{"list_i_points": "4.50", "shirt_size": "L"}'::jsonb,
    'Transcript shows 4.5 List I points; the form row was mistyped.',
    'ce000000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000010'
  )) ->> 'eligibilityInputsChanged',
  'true',
  'a points correction reports that the eligibility inputs moved'
);

SELECT extensions.is(
  (SELECT list_i_points FROM plugin_data.csf_term_applications
   WHERE id = 'ce500000-0000-4000-8000-000000000001'),
  4.50::numeric(5,2),
  'the corrected value is stored'
);

SELECT extensions.is(
  (SELECT grand_total_points FROM plugin_data.csf_term_applications
   WHERE id = 'ce500000-0000-4000-8000-000000000001'),
  5.00::numeric(5,2),
  'a field the officer did not touch is left alone'
);

-- The editor asserts no eligibility verdict of its own; the existing derivation
-- reports the staleness because the calculation now disagrees with the store.
SELECT extensions.is(
  (SELECT eligibility_status::text FROM plugin_data.csf_term_applications
   WHERE id = 'ce500000-0000-4000-8000-000000000001'),
  'pending',
  'the editor does not rewrite the eligibility verdict'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
     AND action = 'application.fields_edited'
     AND correlation_id = 'ce600000-0000-4000-8000-000000000010'),
  1,
  'the correction wrote exactly one immutable audit receipt'
);

SELECT extensions.is(
  (SELECT after_data ->> 'reason' FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ce600000-0000-4000-8000-000000000010'),
  'Transcript shows 4.5 List I points; the form row was mistyped.',
  'the officer''s own words are the recorded reason'
);

SELECT extensions.is(
  (SELECT before_data -> 'values' ->> 'list_i_points'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ce600000-0000-4000-8000-000000000010'),
  '2.00',
  'the pre-edit value is preserved in the receipt'
);

SELECT extensions.is(
  (plugin_data.csf_edit_term_application_fields(
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    '{"list_i_points": "4.50", "shirt_size": "L"}'::jsonb,
    'Transcript shows 4.5 List I points; the form row was mistyped.',
    'ce000000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000010'
  )) ->> 'idempotent',
  'true',
  'an exact replay returns the committed receipt instead of editing again'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"shirt_size": "M"}'::jsonb,
      'A different correction reusing a spent identifier.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000010'
    )
  $$,
  NULL,
  'That application edit request identifier is already bound to a different change.',
  'a spent request identifier cannot carry a different change'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ce100000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      '{"shirt_size": "L"}'::jsonb,
      'Re-saving a value that already matches.',
      'ce000000-0000-4000-8000-000000000001',
      'ce600000-0000-4000-8000-000000000011'
    )
  $$,
  '55000',
  'Those values already match the record. Nothing was changed.',
  'a no-op correction is refused rather than audited as a change'
);

-- ---------------------------------------------------------------------------
-- F. Note audiences
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_add_profile_note(
      'ce100000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      'ce300000-0000-4000-8000-000000000001',
      NULL, NULL, 'An audience that does not exist.', 'public'
    )
  $$,
  '22023',
  'Choose whether this note is officer-only or visible to the member.',
  'an unrecognized audience is refused rather than coerced'
);

SELECT extensions.is(
  (plugin_data.csf_add_profile_note(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    NULL, 'appealed',
    'Applicant argued the transcript was misread; it was not. Hold the decision.',
    'officer'
  )) ->> 'visibility',
  'officer',
  'an officer note records its audience'
);

SELECT extensions.is(
  (plugin_data.csf_add_profile_note(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001', 'correction',
    'Your October hours were re-counted and the two missing entries were added.',
    'member'
  )) ->> 'visibility',
  'member',
  'a member-visible comment records its audience'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    50
  )),
  1,
  'the member projection returns only the member-visible comment'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
     AND action = 'profile.note_published'),
  1,
  'publishing a comment to a member records its own receipt'
);

SELECT extensions.is(
  (SELECT (plugin_data.csf_restrict_profile_note_to_officers(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_profile_notes
     WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
       AND visibility = 'member' LIMIT 1),
    'Posted to the wrong member; withdrawing it.'
  )) ->> 'visibility'),
  'officer',
  'a member-visible comment can be withdrawn to officers only'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    50
  )),
  0,
  'the withdrawn comment no longer reaches the member'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'),
  2,
  'withdrawal is not a delete: both notes remain in the officer history'
);

SELECT extensions.finish();

ROLLBACK;
