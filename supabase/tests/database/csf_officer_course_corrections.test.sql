-- Authorized officer correction of application course lines: execution grants,
-- the bounded value rules, the refusals, stale evidence, replay, the immutable
-- imported original, the source-overwrite conflict, and the restore that ends
-- it.
--
-- Every identity here is synthetic and every value is invented for this file.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(48);

-- ---------------------------------------------------------------------------
-- A. Execution grants
--
-- The service signatures are reachable by the server role and nobody else, and
-- the implementations behind them are reachable by neither a client nor the
-- server role, so the V128 lock order cannot be bypassed. The ledger is
-- readable by the server role and written only through those functions.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_edit_application_courses(uuid,uuid,jsonb,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot correct application course lines'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_edit_application_courses(uuid,uuid,jsonb,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot correct application course lines'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_edit_application_courses(uuid,uuid,jsonb,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can correct application course lines'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_edit_application_courses_locked_impl(uuid,uuid,jsonb,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role cannot reach the course editor past its authorization wrapper'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_restore_application_courses(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can restore the imported course lines'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_restore_application_courses_locked_impl(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role cannot reach the restore past its authorization wrapper'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'authenticated', 'plugin_data.csf_application_course_corrections', 'SELECT'
  ),
  'clients cannot read the correction ledger'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role', 'plugin_data.csf_application_course_corrections', 'INSERT'
  ),
  'even the server role writes the ledger only through the reviewed functions'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
--
-- The officer is an organization admin, which short-circuits
-- csf_actor_has_permission. The bystander is an active member with no staff
-- position, so the permission gate has a real negative case.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('eb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-course-editor-officer@local.test', now(), '{}', '{}', now(), now()),
  ('eb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-course-editor-bystander@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'CSF Course Correction',
  'csf-course-correction',
  'school',
  '731017'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('eb100000-0000-4000-8000-000000000001',
   'eb000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('eb100000-0000-4000-8000-000000000001',
   'eb000000-0000-4000-8000-000000000002', 'member', 'active');

-- Both semesters start open. `csf_terms_lifecycle_write_guard` rejects a direct
-- insert of 'closed', so the finished semester below is produced by the
-- canonical close operation rather than written by hand.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES
  ('eb200000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000001',
   'F27', 'Fall 2027', '2027-2028', 'fall', true, 'open'),
  ('eb200000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000001',
   'S27', 'Spring 2027', '2026-2027', 'spring', false, 'open');

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, required_meetings
) VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'eb200000-0000-4000-8000-000000000002',
  1, false, 5, 1
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, label, graduation_year)
VALUES (
  'eb400000-0000-4000-8000-000000000001',
  'eb100000-0000-4000-8000-000000000001', 'Class of 2029', 2029
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('eb300000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000001',
   'Wren', 'Coursefix', 'wren', 'coursefix'),
  ('eb300000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000001',
   'Sol', 'Priorterm', 'sol', 'priorterm');

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, status_reason
) VALUES (
  'eb100000-0000-4000-8000-000000000001',
  'eb300000-0000-4000-8000-000000000002',
  'eb200000-0000-4000-8000-000000000002',
  'eb400000-0000-4000-8000-000000000001',
  'accepted', 'Accepted for Spring 2027.'
);

-- The open application carries the immutable imported snapshot the commit
-- stored. Nothing below writes it; the restore reads it back.
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  current_grade_level, returning_status, list_i_points, list_i_ii_points,
  grand_total_points, application_data
) VALUES
  ('eb500000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000001',
   'eb300000-0000-4000-8000-000000000001', 'eb400000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   11, 'new', 5.00, 8.00, 11.00,
   jsonb_build_object(
     'rowHash', 'eb-row-hash-1',
     'normalizedImport', jsonb_build_object(
       'courses', jsonb_build_array(
         jsonb_build_object(
           'courseList', 'I', 'courseName', 'Synthetic Seminar',
           'grade', 'A', 'points', '3', 'isBonus', false,
           'rawLine', 'Synthetic Seminar, A, 3'
         ),
         jsonb_build_object(
           'courseList', 'II', 'courseName', 'Applied Fiction',
           'grade', 'B', 'points', '1', 'isBonus', false,
           'rawLine', 'Applied Fiction, B, 1'
         )
       )
     )
   )),
  ('eb500000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000001',
   'eb300000-0000-4000-8000-000000000002', 'eb400000-0000-4000-8000-000000000001',
   'eb200000-0000-4000-8000-000000000002', 'google_form_sheet', 'rejected',
   12, 'returning', 1.00, 2.00, 3.00, '{}'::jsonb);

UPDATE plugin_data.csf_term_applications
SET decision_status = 'rejected'::plugin_data.csf_application_decision_status
WHERE id = 'eb500000-0000-4000-8000-000000000002';

-- The two course rows the import produced, matching the snapshot above.
INSERT INTO plugin_data.csf_application_course_entries (
  id, organization_id, application_id, course_list, course_name,
  grade, points, is_bonus, raw_line
) VALUES
  ('eb700000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000001',
   'eb500000-0000-4000-8000-000000000001', 'I', 'Synthetic Seminar',
   'A', 3.00, false, 'Synthetic Seminar, A, 3'),
  ('eb700000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000001',
   'eb500000-0000-4000-8000-000000000001', 'II', 'Applied Fiction',
   'B', 1.00, false, 'Applied Fiction, B, 1');

SELECT extensions.is(
  (SELECT origin FROM plugin_data.csf_application_course_entries
   WHERE id = 'eb700000-0000-4000-8000-000000000001'),
  'import',
  'an existing course row keeps the imported origin through the column default'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'eb100000-0000-4000-8000-000000000001',
      'eb200000-0000-4000-8000-000000000002',
      1,
      plugin_data.csf_term_closure_readiness(
        'eb100000-0000-4000-8000-000000000001',
        'eb200000-0000-4000-8000-000000000002'
      ) ->> 'evidenceHash',
      'eb000000-0000-4000-8000-000000000001'
    )
  $$,
  'the previous semester closes through the canonical close operation'
);

-- ---------------------------------------------------------------------------
-- C. Authorization and bounded validation
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"grade":"B"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'The transcript shows a different grade.',
      'eb000000-0000-4000-8000-000000000002',
      'eb600000-0000-4000-8000-000000000001'
    )
  $$,
  NULL,
  'Not authorized to correct CSF application records.',
  'a member without the capability cannot correct a course line'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_restore_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      'Putting the imported lines back.',
      'eb000000-0000-4000-8000-000000000002',
      'eb600000-0000-4000-8000-000000000002'
    )
  $$,
  NULL,
  'Not authorized to correct CSF application records.',
  'a member without the capability cannot restore course lines either'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"grade":"B"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'typo',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000003'
    )
  $$,
  NULL,
  'Explain the course correction in at least 8 characters.',
  'a course correction needs a real reason'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Nothing selected on purpose.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000004'
    )
  $$,
  NULL,
  'Choose at least one course line to correct.',
  'an empty correction is refused rather than recorded'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"points":"3","applicationId":"eb500000-0000-4000-8000-000000000002"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Trying to move this line to another application.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000005'
    )
  $$,
  '22023',
  'That course field cannot be edited here.',
  'a course line cannot be moved to another application through the editor'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"grade":"excellent"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Recording a grade that is not a grade.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000006'
    )
  $$,
  NULL,
  'That is not one of the recorded course grades.',
  'a malformed grade is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"points":"-4"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Recording points that are not a number.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000007'
    )
  $$,
  NULL,
  'Reported course points must be a number between 0 and 999.99.',
  'a malformed points value is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"add","values":{"courseList":"IV","courseName":"Invented List"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Adding a course to a list that does not exist.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000008'
    )
  $$,
  NULL,
  'A course must be on list I, II, or III.',
  'a course list outside I, II, and III is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"grade":"B"}}]'::jsonb,
      'a-revision-from-a-page-that-has-moved-on',
      'The transcript shows a different grade.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000009'
    )
  $$,
  '55000',
  'These course lines changed since you opened them. Reload the application and redo the correction.',
  'a correction built on stale course evidence is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"remove","courseEntryId":"eb700000-0000-4000-8000-0000000000ff"}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Removing a line that belongs to nobody.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-00000000000a'
    )
  $$,
  'P0002',
  'That course line is not on this application.',
  'a course line from outside this application cannot be corrected'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"grade":"B"}},
        {"op":"remove","courseEntryId":"eb700000-0000-4000-8000-000000000001"}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Correcting the same line twice in one request.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-00000000000b'
    )
  $$,
  NULL,
  'The same course line was corrected twice in one request.',
  'one request cannot touch the same course line twice'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"grade":"A"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Resubmitting the value that is already there.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-00000000000c'
    )
  $$,
  '55000',
  'That course line already holds those values. Nothing was changed.',
  'a correction that changes nothing is refused rather than audited'
);

-- The finished semester and the published decision, refused before any write.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000002',
      '[{"op":"add","values":{"courseList":"I","courseName":"Late Addition"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000002'
      ),
      'Trying to change a finished semester.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-00000000000d'
    )
  $$,
  '55000',
  'This semester is finished. Reopen it before correcting an application.',
  'a finished semester keeps its course record'
);

-- ---------------------------------------------------------------------------
-- D. The correction itself
--
-- The revision is captured before the correction rather than recomputed inside
-- each statement, because the request fingerprint covers it. A replay that
-- recomputes the revision after the rows have moved is a different intent, and
-- the editor is right to refuse it; proving idempotency needs the caller to
-- present the same evidence it presented the first time.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE csf_course_edit_revisions (
  label text PRIMARY KEY,
  revision text NOT NULL
);

INSERT INTO csf_course_edit_revisions (label, revision)
SELECT 'before_first_correction', plugin_data.csf_application_course_revision(
  'eb100000-0000-4000-8000-000000000001',
  'eb500000-0000-4000-8000-000000000001'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"courseName":"Synthetic Seminar Honors","grade":"B"}},
        {"op":"remove","courseEntryId":"eb700000-0000-4000-8000-000000000002"},
        {"op":"add","values":{"courseList":"III","courseName":"Civic Lab","grade":"P","points":"1","isBonus":true}}]'::jsonb,
      (SELECT revision FROM csf_course_edit_revisions
        WHERE label = 'before_first_correction'),
      'The transcript names the honors section and drops the elective.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000010'
    )
  $$,
  'an authorized officer corrects, removes, and adds course lines in one request'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_application_course_entries
   WHERE application_id = 'eb500000-0000-4000-8000-000000000001'),
  2,
  'the canonical course record holds exactly the corrected lines'
);

SELECT extensions.is(
  (SELECT course_name || '/' || grade
   FROM plugin_data.csf_application_course_entries
   WHERE id = 'eb700000-0000-4000-8000-000000000001'),
  'Synthetic Seminar Honors/B',
  'the corrected line holds the values the officer typed'
);

SELECT extensions.is(
  (SELECT imported_values
   FROM plugin_data.csf_application_course_entries
   WHERE id = 'eb700000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'courseList', 'I', 'courseName', 'Synthetic Seminar',
    'grade', 'A', 'points', 3.00, 'isBonus', false
  ),
  'the imported original is frozen on the row the officer corrected'
);

SELECT extensions.is(
  (SELECT raw_line
   FROM plugin_data.csf_application_course_entries
   WHERE id = 'eb700000-0000-4000-8000-000000000001'),
  'Synthetic Seminar, A, 3',
  'the applicant''s original source line is left exactly as imported'
);

SELECT extensions.is(
  (SELECT origin
   FROM plugin_data.csf_application_course_entries
   WHERE application_id = 'eb500000-0000-4000-8000-000000000001'
     AND course_name = 'Civic Lab'),
  'officer',
  'a line an officer added is recorded as an officer line, not an imported one'
);

SELECT extensions.is(
  (SELECT application_data -> 'normalizedImport' -> 'courses'
   FROM plugin_data.csf_term_applications
   WHERE id = 'eb500000-0000-4000-8000-000000000001'),
  jsonb_build_array(
    jsonb_build_object(
      'courseList', 'I', 'courseName', 'Synthetic Seminar',
      'grade', 'A', 'points', '3', 'isBonus', false,
      'rawLine', 'Synthetic Seminar, A, 3'
    ),
    jsonb_build_object(
      'courseList', 'II', 'courseName', 'Applied Fiction',
      'grade', 'B', 'points', '1', 'isBonus', false,
      'rawLine', 'Applied Fiction, B, 1'
    )
  ),
  'the immutable imported snapshot on the application is untouched'
);

SELECT extensions.is(
  (SELECT eligibility_status::text
   FROM plugin_data.csf_term_applications
   WHERE id = 'eb500000-0000-4000-8000-000000000001'),
  'pending',
  'the editor asserts no eligibility verdict of its own'
);

SELECT extensions.ok(
  (SELECT courses_corrected_at IS NOT NULL
     AND courses_corrected_by = 'eb000000-0000-4000-8000-000000000001'
   FROM plugin_data.csf_term_applications
   WHERE id = 'eb500000-0000-4000-8000-000000000001'),
  'the application records that an officer corrected its course lines'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_application_course_corrections
   WHERE correlation_id = 'eb600000-0000-4000-8000-000000000010'),
  3,
  'the ledger holds one receipt per corrected line'
);

SELECT extensions.is(
  (SELECT imported_values
   FROM plugin_data.csf_application_course_corrections
   WHERE correlation_id = 'eb600000-0000-4000-8000-000000000010'
     AND operation = 'removed'),
  jsonb_build_object(
    'courseList', 'II', 'courseName', 'Applied Fiction',
    'grade', 'B', 'points', 1.00, 'isBonus', false
  ),
  'a removed line keeps its imported original in the ledger'
);

SELECT extensions.ok(
  (SELECT audit.after_data ->> 'reason'
       = 'The transcript names the honors section and drops the elective.'
     AND (audit.after_data ->> 'eligibilityInputsChanged')::boolean
     AND (audit.after_data ->> 'addedCount')::integer = 1
     AND (audit.after_data ->> 'updatedCount')::integer = 1
     AND (audit.after_data ->> 'removedCount')::integer = 1
   FROM plugin_data.csf_admin_audit_events AS audit
   WHERE audit.correlation_id = 'eb600000-0000-4000-8000-000000000010'
     AND audit.action = 'application.courses_edited'),
  'the audit receipt carries the officer''s reason and the exact counts'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_application_course_corrections
    SET reason = 'A different story about the same change.'
    WHERE correlation_id = 'eb600000-0000-4000-8000-000000000010'
  $$,
  '55000',
  'CSF application course correction receipts are immutable.',
  'a correction receipt cannot be rewritten to agree with a later story'
);

-- ---------------------------------------------------------------------------
-- E. Replay and collision
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  (SELECT (plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"courseName":"Synthetic Seminar Honors","grade":"B"}},
        {"op":"remove","courseEntryId":"eb700000-0000-4000-8000-000000000002"},
        {"op":"add","values":{"courseList":"III","courseName":"Civic Lab","grade":"P","points":"1","isBonus":true}}]'::jsonb,
      (SELECT revision FROM csf_course_edit_revisions
        WHERE label = 'before_first_correction'),
      'The transcript names the honors section and drops the elective.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000010'
    ) ->> 'idempotent')::boolean),
  'an exact replay returns the first receipt instead of correcting twice'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_application_course_corrections
   WHERE correlation_id = 'eb600000-0000-4000-8000-000000000010'),
  3,
  'the replay wrote no second set of receipts'
);

-- The evidence is part of the intent. Same actor, same target, same operations,
-- same reason, same request id: only the revision differs, and that is enough
-- to make it a different change rather than a retry of the committed one.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"update","courseEntryId":"eb700000-0000-4000-8000-000000000001","values":{"courseName":"Synthetic Seminar Honors","grade":"B"}},
        {"op":"remove","courseEntryId":"eb700000-0000-4000-8000-000000000002"},
        {"op":"add","values":{"courseList":"III","courseName":"Civic Lab","grade":"P","points":"1","isBonus":true}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'The transcript names the honors section and drops the elective.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000010'
    )
  $$,
  NULL,
  'That course correction request identifier is already bound to a different change.',
  'the same request replayed against different course evidence is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_edit_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      '[{"op":"add","values":{"courseList":"I","courseName":"Something Else"}}]'::jsonb,
      plugin_data.csf_application_course_revision(
        'eb100000-0000-4000-8000-000000000001',
        'eb500000-0000-4000-8000-000000000001'
      ),
      'Reusing a request id for a different change.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000010'
    )
  $$,
  NULL,
  'That course correction request identifier is already bound to a different change.',
  'a reused request identifier cannot carry a different correction'
);

-- ---------------------------------------------------------------------------
-- F. Source sync cannot overwrite a correction
--
-- The import commit replaces courses by deleting every row for the application
-- and re-inserting from the snapshot. That delete is what this asserts against.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_application_course_entries
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND application_id = 'eb500000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'An officer corrected this application''s courses, so the source cannot overwrite them.',
  'a source re-import cannot silently replace a corrected course record'
);

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_application_course_entries
   WHERE application_id = 'eb500000-0000-4000-8000-000000000001'),
  2,
  'the refused overwrite left the corrected record intact'
);

-- ---------------------------------------------------------------------------
-- G. Restoring the imported lines ends the conflict
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_restore_application_courses(
      'eb100000-0000-4000-8000-000000000001',
      'eb500000-0000-4000-8000-000000000001',
      'The registrar confirmed the imported lines were right.',
      'eb000000-0000-4000-8000-000000000001',
      'eb600000-0000-4000-8000-000000000020'
    )
  $$,
  'an authorized officer restores the imported course lines'
);

SELECT extensions.is(
  (SELECT jsonb_agg(
     jsonb_build_object(
       'courseList', course.course_list,
       'courseName', course.course_name,
       'grade', course.grade,
       'points', course.points,
       'isBonus', course.is_bonus,
       'origin', course.origin
     ) ORDER BY course.course_list
   )
   FROM plugin_data.csf_application_course_entries AS course
   WHERE course.application_id = 'eb500000-0000-4000-8000-000000000001'),
  jsonb_build_array(
    jsonb_build_object(
      'courseList', 'I', 'courseName', 'Synthetic Seminar',
      'grade', 'A', 'points', 3.00, 'isBonus', false, 'origin', 'import'
    ),
    jsonb_build_object(
      'courseList', 'II', 'courseName', 'Applied Fiction',
      'grade', 'B', 'points', 1.00, 'isBonus', false, 'origin', 'import'
    )
  ),
  'the restored lines are exactly the immutable imported snapshot'
);

SELECT extensions.ok(
  (SELECT courses_corrected_at IS NULL AND courses_corrected_by IS NULL
   FROM plugin_data.csf_term_applications
   WHERE id = 'eb500000-0000-4000-8000-000000000001'),
  'the restore clears the officer-correction marker'
);

SELECT extensions.ok(
  (SELECT count(*) >= 5
   FROM plugin_data.csf_application_course_corrections
   WHERE correlation_id = 'eb600000-0000-4000-8000-000000000020'),
  'the restore records what it discarded as well as what it put back'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'eb600000-0000-4000-8000-000000000020'
      AND action = 'application.courses_restored'
  ),
  'the restore leaves its own audit receipt'
);

SELECT extensions.lives_ok(
  $$
    DELETE FROM plugin_data.csf_application_course_entries
    WHERE organization_id = 'eb100000-0000-4000-8000-000000000001'
      AND application_id = 'eb500000-0000-4000-8000-000000000001'
  $$,
  'a source re-import proceeds once the corrections have been restored'
);

SELECT extensions.finish();

ROLLBACK;
