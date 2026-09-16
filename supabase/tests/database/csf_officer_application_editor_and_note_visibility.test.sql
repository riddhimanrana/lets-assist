-- The officer application-field editor and the officer/member split on profile
-- notes: execution grants, the allowlist, the refusals, replay, and the member
-- projection.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(40);

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
  ('ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-app-editor-officer@local.test', now(), '{}', '{}', now(), now()),
  ('ea000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-app-editor-bystander@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ea100000-0000-4000-8000-000000000001',
  'CSF Application Editor',
  'csf-application-editor',
  'school',
  '730009'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ea100000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000002', 'member', 'active');

-- Both semesters start open. `csf_terms_lifecycle_write_guard` rejects a
-- direct insert of 'closed' or 'archived', so the finished semester below is
-- produced by the canonical close operation rather than written by hand.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES
  ('ea200000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001',
   'F26', 'Fall 2026', '2026-2027', 'fall', true, 'open'),
  ('ea200000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001',
   'S26', 'Spring 2026', '2025-2026', 'spring', false, 'open');

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, required_meetings
) VALUES (
  'ea100000-0000-4000-8000-000000000001',
  'ea200000-0000-4000-8000-000000000002',
  1, false, 5, 1
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, label, graduation_year)
VALUES ('ea400000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001',
        'Class of 2028', 2028);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('ea300000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001',
   'Ari', 'Editor', 'ari', 'editor');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  current_grade_level, returning_status, list_i_points, grand_total_points
) VALUES
  ('ea500000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
   'ea200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   10, 'new', 2.00, 5.00),
  -- The finished semester's application is already decided. Closure readiness
  -- counts a `pending` decision as a blocker, so a semester cannot reach
  -- 'closed' while one of its applications is undecided. That makes the
  -- closed-semester refusal reachable only on an application that also has a
  -- published decision, which is exactly why the editor checks the semester
  -- first: the officer is told the semester is finished, not that the decision
  -- is published.
  ('ea500000-0000-4000-8000-000000000002', 'ea100000-0000-4000-8000-000000000001',
   'ea300000-0000-4000-8000-000000000001', 'ea400000-0000-4000-8000-000000000001',
   'ea200000-0000-4000-8000-000000000002', 'google_form_sheet', 'rejected',
   9, 'new', 1.00, 3.00);

UPDATE plugin_data.csf_term_applications
SET decision_status = 'rejected'::plugin_data.csf_application_decision_status
WHERE id = 'ea500000-0000-4000-8000-000000000002';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'ea100000-0000-4000-8000-000000000001',
      'ea200000-0000-4000-8000-000000000002',
      1,
      plugin_data.csf_term_closure_readiness(
        'ea100000-0000-4000-8000-000000000001',
        'ea200000-0000-4000-8000-000000000002'
      ) ->> 'evidenceHash',
      'ea000000-0000-4000-8000-000000000001'
    )
  $$,
  'the previous semester closes through the canonical close operation'
);

SELECT extensions.is(
  (SELECT lifecycle_status FROM plugin_data.csf_terms
   WHERE id = 'ea200000-0000-4000-8000-000000000002'),
  'closed',
  'the closed-semester fixture carries a real closure pointer'
);

-- ---------------------------------------------------------------------------
-- D. Authorization and validation
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"shirt_size": "L"}'::jsonb,
      'Student reported the wrong size.',
      'ea000000-0000-4000-8000-000000000002',
      'ea600000-0000-4000-8000-000000000001'
    )
  $$,
  NULL,
  'Not authorized to correct CSF application records.',
  'a member without the capability cannot correct an application'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"profile_id": "ea300000-0000-4000-8000-00000000dead"}'::jsonb,
      'Trying to move this record to someone else.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000002'
    )
  $$,
  '22023',
  'That application field cannot be edited here.',
  'a record cannot be reassigned to a different member through the editor'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"decision_status": "approved", "review_notes": "looks fine"}'::jsonb,
      'Trying to approve this through the editor.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000003'
    )
  $$,
  '22023',
  'That application field cannot be edited here.',
  'a decision cannot be published through the editor'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"shirt_size": "L"}'::jsonb,
      'typo',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000004'
    )
  $$,
  NULL,
  'Explain the correction in at least 8 characters.',
  'a correction needs a real reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      'Nothing selected on purpose.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000005'
    )
  $$,
  NULL,
  'Choose at least one field to correct.',
  'an empty correction is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"current_grade_level": "13"}'::jsonb,
      'Reported grade was out of range.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000006'
    )
  $$,
  NULL,
  'Grade level must be 9, 10, 11, or 12.',
  'a per-column rule refuses an impossible value'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000002',
      '{"shirt_size": "L"}'::jsonb,
      'Correcting a finished semester.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000007'
    )
  $$,
  '55000',
  'This semester is finished. Reopen it before correcting an application.',
  'a finished semester keeps its record, and is reported before the decision'
);

-- ---------------------------------------------------------------------------
-- E. The happy path, the audit, and replay
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (plugin_data.csf_edit_term_application_fields(
    'ea100000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001',
    '{"list_i_points": "4.50", "shirt_size": "L"}'::jsonb,
    'Transcript shows 4.5 List I points; the form row was mistyped.',
    'ea000000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000010'
  )) ->> 'eligibilityInputsChanged',
  'true',
  'a points correction reports that the eligibility inputs moved'
);

SELECT extensions.is(
  (SELECT list_i_points FROM plugin_data.csf_term_applications
   WHERE id = 'ea500000-0000-4000-8000-000000000001'),
  4.50::numeric(5,2),
  'the corrected value is stored'
);

SELECT extensions.is(
  (SELECT grand_total_points FROM plugin_data.csf_term_applications
   WHERE id = 'ea500000-0000-4000-8000-000000000001'),
  5.00::numeric(5,2),
  'a field the officer did not touch is left alone'
);

-- The editor asserts no eligibility verdict of its own; the existing derivation
-- reports the staleness because the calculation now disagrees with the store.
SELECT extensions.is(
  (SELECT eligibility_status::text FROM plugin_data.csf_term_applications
   WHERE id = 'ea500000-0000-4000-8000-000000000001'),
  'pending',
  'the editor does not rewrite the eligibility verdict'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND action = 'application.fields_edited'
     AND correlation_id = 'ea600000-0000-4000-8000-000000000010'),
  1,
  'the correction wrote exactly one immutable audit receipt'
);

SELECT extensions.is(
  (SELECT after_data ->> 'reason' FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ea600000-0000-4000-8000-000000000010'),
  'Transcript shows 4.5 List I points; the form row was mistyped.',
  'the officer''s own words are the recorded reason'
);

SELECT extensions.is(
  (SELECT before_data -> 'values' ->> 'list_i_points'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ea600000-0000-4000-8000-000000000010'),
  '2.00',
  'the pre-edit value is preserved in the receipt'
);

SELECT extensions.is(
  (plugin_data.csf_edit_term_application_fields(
    'ea100000-0000-4000-8000-000000000001',
    'ea500000-0000-4000-8000-000000000001',
    '{"list_i_points": "4.50", "shirt_size": "L"}'::jsonb,
    'Transcript shows 4.5 List I points; the form row was mistyped.',
    'ea000000-0000-4000-8000-000000000001',
    'ea600000-0000-4000-8000-000000000010'
  )) ->> 'idempotent',
  'true',
  'an exact replay returns the committed receipt instead of editing again'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"shirt_size": "M"}'::jsonb,
      'A different correction reusing a spent identifier.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000010'
    )
  $$,
  NULL,
  'That application edit request identifier is already bound to a different change.',
  'a spent request identifier cannot carry a different change'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_term_application_fields(
      'ea100000-0000-4000-8000-000000000001',
      'ea500000-0000-4000-8000-000000000001',
      '{"shirt_size": "L"}'::jsonb,
      'Re-saving a value that already matches.',
      'ea000000-0000-4000-8000-000000000001',
      'ea600000-0000-4000-8000-000000000011'
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
      'ea100000-0000-4000-8000-000000000001',
      'ea000000-0000-4000-8000-000000000001',
      'ea300000-0000-4000-8000-000000000001',
      NULL, NULL, 'An audience that does not exist.', 'public'
    )
  $$,
  '22023',
  'Choose whether this note is officer-only or visible to the member.',
  'an unrecognized audience is refused rather than coerced'
);

SELECT extensions.is(
  (plugin_data.csf_add_profile_note(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    NULL, 'appealed',
    'Applicant argued the transcript was misread; it was not. Hold the decision.',
    'officer'
  )) ->> 'visibility',
  'officer',
  'an officer note records its audience'
);

SELECT extensions.is(
  (plugin_data.csf_add_profile_note(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    -- The finished semester, so this section tests the audience split alone.
    -- Section G covers what the release gate does to a current-semester
    -- comment.
    'ea200000-0000-4000-8000-000000000002', 'correction',
    'Your October hours were re-counted and the two missing entries were added.',
    'member'
  )) ->> 'visibility',
  'member',
  'a member-visible comment records its audience'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ea100000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    50
  )),
  1,
  'the member projection returns only the member-visible comment'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
     AND action = 'profile.note_published'),
  1,
  'publishing a comment to a member records its own receipt'
);

SELECT extensions.is(
  (SELECT (plugin_data.csf_restrict_profile_note_to_officers(
    'ea100000-0000-4000-8000-000000000001',
    'ea000000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_profile_notes
     WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'
       AND visibility = 'member' LIMIT 1),
    'Posted to the wrong member; withdrawing it.'
  )) ->> 'visibility'),
  'officer',
  'a member-visible comment can be withdrawn to officers only'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ea100000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    50
  )),
  0,
  'the withdrawn comment no longer reaches the member'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_profile_notes
   WHERE organization_id = 'ea100000-0000-4000-8000-000000000001'),
  2,
  'withdrawal is not a delete: both notes remain in the officer history'
);

-- ---------------------------------------------------------------------------
-- G. The release gate on member-visible comments
--
-- The current semester is not the student's until the chapter publishes an
-- outcome. A comment attached to that semester must not reach them before the
-- release, and the gate has to live here rather than in the caller: the
-- member snapshot is not the only thing that could ever read this function.
-- ---------------------------------------------------------------------------

-- Fall 2026 is current and this member has no published outcome in it yet.
SELECT plugin_data.csf_add_profile_note(
  'ea100000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'ea300000-0000-4000-8000-000000000001',
  'ea200000-0000-4000-8000-000000000001', 'info',
  'Fall 2026 comment written before any outcome was published.',
  'member'
);

-- Spring 2026 is finished, so its comment is the student's own history.
SELECT plugin_data.csf_add_profile_note(
  'ea100000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'ea300000-0000-4000-8000-000000000001',
  'ea200000-0000-4000-8000-000000000002', 'info',
  'Spring 2026 comment about a semester that already finished.',
  'member'
);

-- Not tied to any semester, so the release gate has nothing to hold it against.
SELECT plugin_data.csf_add_profile_note(
  'ea100000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'ea300000-0000-4000-8000-000000000001',
  NULL, 'info',
  'General comment with no semester attached.',
  'member'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ea100000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    50
  ) AS note WHERE note.term_id = 'ea200000-0000-4000-8000-000000000001'),
  0,
  'a current-semester comment is withheld while the outcome is unreleased'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ea100000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    50
  ) AS note WHERE note.term_id = 'ea200000-0000-4000-8000-000000000002'),
  1,
  'a finished semester''s comment is the student''s own history and stays visible'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ea100000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    50
  ) AS note WHERE note.term_id IS NULL),
  1,
  'a comment with no semester is not gated by the release'
);

-- Publish the current-semester outcome. Nothing about the note changes; only
-- the membership does.
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, status_reason
) VALUES (
  'ea100000-0000-4000-8000-000000000001',
  'ea300000-0000-4000-8000-000000000001',
  'ea200000-0000-4000-8000-000000000001',
  'ea400000-0000-4000-8000-000000000001',
  'accepted', 'Accepted for Fall 2026.'
);

SELECT extensions.is(
  (SELECT count(*)::int FROM plugin_data.csf_member_visible_profile_notes(
    'ea100000-0000-4000-8000-000000000001',
    'ea300000-0000-4000-8000-000000000001',
    50
  ) AS note WHERE note.term_id = 'ea200000-0000-4000-8000-000000000001'),
  1,
  'the same comment reaches the member once the outcome is published'
);

-- ---------------------------------------------------------------------------
-- H. The capability backfill follows authority, not role names
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_roles AS role
    JOIN plugin_data.csf_role_permissions AS granted
      ON granted.role_id = role.id
     AND granted.permission_key = 'edit_application_records'
     AND granted.enabled = true
    WHERE role.organization_id = 'ea100000-0000-4000-8000-000000000001'
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_role_permissions AS qualifying
        WHERE qualifying.role_id = role.id
          AND qualifying.enabled = true
          AND qualifying.permission_key IN (
            'decide_applications', 'review_application_checks'
          )
      )
  ),
  'no role holds the new capability without an existing decision or check authority'
);

SELECT extensions.finish();

ROLLBACK;
