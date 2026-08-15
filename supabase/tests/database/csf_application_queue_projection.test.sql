BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(14);

SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_list_applications_page(uuid,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,integer,boolean)'
  ) IS NULL,
  'the pre-queue application projection overload no longer exists'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_list_applications_page(uuid,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,integer,boolean,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot read the application queue projection directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_list_applications_page(uuid,text,text,text,text,text,text,text,uuid,uuid,text,text,text,uuid,integer,boolean,text,uuid)',
    'EXECUTE'
  ),
  'the server role can read the application queue projection'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ab000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'queue-officer@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'ab000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'queue-other-officer@local.test',
    now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ab100000-0000-4000-8000-000000000001', 'CSF Queue A', 'csf-queue-a', 'school', '983001'),
  ('ab100000-0000-4000-8000-000000000002', 'CSF Queue B', 'csf-queue-b', 'school', '983002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('ab200000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('ab200000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('ab300000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 2031, 'Class of 2031'),
  ('ab300000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000002', 2031, 'Class of 2031');

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES
  ('ab400000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'Mine', 'Ready', 'mine', 'ready', 'mine@students.local.test', 'mine@students.local.test'),
  ('ab400000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000001', 'Under', 'Review', 'under', 'review', 'under@students.local.test', 'under@students.local.test'),
  ('ab400000-0000-4000-8000-000000000003', 'ab100000-0000-4000-8000-000000000001', 'Waiting', 'Student', 'waiting', 'student', 'waiting@students.local.test', 'waiting@students.local.test'),
  ('ab400000-0000-4000-8000-000000000004', 'ab100000-0000-4000-8000-000000000001', 'Done', 'Approved', 'done', 'approved', 'done@students.local.test', 'done@students.local.test'),
  ('ab400000-0000-4000-8000-000000000005', 'ab100000-0000-4000-8000-000000000001', 'Other', 'Assignee', 'other', 'assignee', 'other@students.local.test', 'other@students.local.test'),
  ('ab400000-0000-4000-8000-000000000006', 'ab100000-0000-4000-8000-000000000002', 'Foreign', 'Tenant', 'foreign', 'tenant', 'foreign@students.local.test', 'foreign@students.local.test');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id,
  source, status, submission_status, decision_status, assigned_to, submitted_at
) VALUES
  -- Mine + needs_review: pending, ready, assigned to the queue officer.
  ('ab500000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'ab400000-0000-4000-8000-000000000001', 'ab300000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'manual', 'submitted', 'ready', 'pending', 'ab000000-0000-4000-8000-000000000001', '2030-08-01T17:00:00Z'),
  -- Unassigned + needs_review: pending, under review, no assignee.
  ('ab500000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000001', 'ab400000-0000-4000-8000-000000000002', 'ab300000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'manual', 'submitted', 'under_review', 'pending', NULL, '2030-08-02T17:00:00Z'),
  -- Unassigned + waiting: pending, missing information, no assignee.
  ('ab500000-0000-4000-8000-000000000003', 'ab100000-0000-4000-8000-000000000001', 'ab400000-0000-4000-8000-000000000003', 'ab300000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'manual', 'needs_action', 'missing_information', 'pending', NULL, '2030-08-03T17:00:00Z'),
  -- Completed: an approved decision leaves every pending queue.
  ('ab500000-0000-4000-8000-000000000004', 'ab100000-0000-4000-8000-000000000001', 'ab400000-0000-4000-8000-000000000004', 'ab300000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'manual', 'accepted', 'decided', 'approved', 'ab000000-0000-4000-8000-000000000001', '2030-08-04T17:00:00Z'),
  -- Waiting, assigned to a different officer: never in the first officer's Mine.
  ('ab500000-0000-4000-8000-000000000005', 'ab100000-0000-4000-8000-000000000001', 'ab400000-0000-4000-8000-000000000005', 'ab300000-0000-4000-8000-000000000001', 'ab200000-0000-4000-8000-000000000001', 'manual', 'submitted', 'imported', 'pending', 'ab000000-0000-4000-8000-000000000002', '2030-08-05T17:00:00Z'),
  -- Foreign tenant row: identical shape, different organization.
  ('ab500000-0000-4000-8000-000000000006', 'ab100000-0000-4000-8000-000000000002', 'ab400000-0000-4000-8000-000000000006', 'ab300000-0000-4000-8000-000000000002', 'ab200000-0000-4000-8000-000000000002', 'manual', 'submitted', 'ready', 'pending', NULL, '2030-08-06T17:00:00Z');

SELECT extensions.is(
  (
    SELECT array_agg((item->>'id') ORDER BY item->>'id')
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'mine', 'ab000000-0000-4000-8000-000000000001'
    )
  ),
  ARRAY['ab500000-0000-4000-8000-000000000001'],
  'mine returns only pending applications assigned to the acting officer'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'mine', NULL
    )
  ),
  0,
  'mine without an acting officer matches nothing instead of widening'
);
SELECT extensions.is(
  (
    SELECT array_agg((item->>'id') ORDER BY item->>'id')
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'unassigned', NULL
    )
  ),
  ARRAY[
    'ab500000-0000-4000-8000-000000000002',
    'ab500000-0000-4000-8000-000000000003'
  ],
  'unassigned returns only pending applications with no assignee'
);
SELECT extensions.is(
  (
    SELECT array_agg((item->>'id') ORDER BY item->>'id')
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'needs_review', NULL
    )
  ),
  ARRAY[
    'ab500000-0000-4000-8000-000000000001',
    'ab500000-0000-4000-8000-000000000002'
  ],
  'needs_review returns pending applications that are ready or under review'
);
SELECT extensions.is(
  (
    SELECT array_agg((item->>'id') ORDER BY item->>'id')
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'waiting', NULL
    )
  ),
  ARRAY[
    'ab500000-0000-4000-8000-000000000003',
    'ab500000-0000-4000-8000-000000000005'
  ],
  'waiting returns pending applications still blocked on information'
);
SELECT extensions.is(
  (
    SELECT array_agg((item->>'id') ORDER BY item->>'id')
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'completed', NULL
    )
  ),
  ARRAY['ab500000-0000-4000-8000-000000000004'],
  'completed returns only decided applications'
);
SELECT extensions.is(
  (
    SELECT array_agg((item->>'id') ORDER BY item->>'id')
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'completed', NULL
    )
  ),
  ARRAY['ab500000-0000-4000-8000-000000000004'],
  'completed keeps decided applications visible even under the review view'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      'not_a_queue', NULL
    )
  ),
  0,
  'an unknown queue value fails closed instead of listing everything'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      NULL, NULL
    )
  ),
  4,
  'a null queue preserves the existing pending review view'
);
SELECT extensions.is(
  (
    SELECT max(total_count)::integer
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'review', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 1, false,
      'needs_review', NULL
    )
  ),
  2,
  'queue totals stay accurate on a partial keyset page'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_list_applications_page(
      'ab100000-0000-4000-8000-000000000001',
      'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'oldest', NULL, NULL, NULL, 50, false,
      NULL, NULL
    )
    WHERE (item->>'id') = 'ab500000-0000-4000-8000-000000000006'
  ),
  'queue projections never leak another organization''s applications'
);

SELECT extensions.finish();

ROLLBACK;
