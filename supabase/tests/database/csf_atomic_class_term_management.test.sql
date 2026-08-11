BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(56);

SELECT extensions.ok(
  NOT has_function_privilege('anon', operation.signature, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', operation.signature, 'EXECUTE')
    AND has_function_privilege('service_role', operation.signature, 'EXECUTE'),
  operation.label || ' is executable only by the server role'
)
FROM (
  VALUES
    ('plugin_data.csf_create_cohort_with_terms(uuid,uuid,jsonb,uuid)', 'class setup'),
    ('plugin_data.csf_create_term_for_cohort(uuid,uuid,jsonb,uuid)', 'semester setup'),
    ('plugin_data.csf_update_cohort(uuid,uuid,jsonb,uuid)', 'class edit'),
    ('plugin_data.csf_set_cohort_status(uuid,uuid,jsonb,uuid)', 'class status change'),
    ('plugin_data.csf_update_cohort_term(uuid,uuid,jsonb,uuid)', 'class-semester edit')
) AS operation(signature, label);

SELECT extensions.ok(
  (
    SELECT proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_proc AS proc
    WHERE proc.oid = operation.signature::regprocedure
  ),
  operation.label || ' is security-definer with an empty search path'
)
FROM (
  VALUES
    ('plugin_data.csf_create_cohort_with_terms(uuid,uuid,jsonb,uuid)', 'class setup'),
    ('plugin_data.csf_create_term_for_cohort(uuid,uuid,jsonb,uuid)', 'semester setup'),
    ('plugin_data.csf_update_cohort(uuid,uuid,jsonb,uuid)', 'class edit'),
    ('plugin_data.csf_set_cohort_status(uuid,uuid,jsonb,uuid)', 'class status change'),
    ('plugin_data.csf_update_cohort_term(uuid,uuid,jsonb,uuid)', 'class-semester edit')
) AS operation(signature, label);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'b7000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'class-term-admin@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'b7000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'class-term-outsider@local.test',
    now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'b7100000-0000-4000-8000-000000000001',
    'CSF Atomic Class Term A', 'csf-atomic-class-term-a', 'school', '998201'
  ),
  (
    'b7100000-0000-4000-8000-000000000002',
    'CSF Atomic Class Term B', 'csf-atomic-class-term-b', 'school', '998202'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'b7200000-0000-4000-8000-000000000002',
  'b7100000-0000-4000-8000-000000000002',
  2048,
  'Other organization class',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  starts_at, ends_at, is_current
) VALUES (
  'b7300000-0000-4000-8000-000000000002',
  'b7100000-0000-4000-8000-000000000002',
  'S44',
  'Other organization semester',
  '2043-2044',
  'spring',
  '2044-01-01',
  '2044-06-30',
  true
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_cohort_with_terms(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000001',
      '{"graduationYear":2048,"label":"Class of 2048","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Not authorized to manage CSF classes and semesters.',
  'an actor without current tenant permission cannot set up a class'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_cohort_with_terms(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000002',
      '{"graduationYear":2048,"label":"Class of 2048","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized officer can explicitly create one graduating class'
);
SELECT extensions.ok(
  (
    SELECT graduation_year = 2048 AND label = 'Class of 2048' AND status = 'active'
    FROM plugin_data.csf_cohorts
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND graduation_year = 2048
  ),
  'class setup persists the submitted class identity'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_cohort_terms AS link
    JOIN plugin_data.csf_cohorts AS cohort ON cohort.id = link.cohort_id
    WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND cohort.graduation_year = 2048
  ),
  8,
  'class setup creates all eight class-semester links'
);
SELECT extensions.is(
  (
    SELECT string_agg(term.code || ':' || link.grade_level::text, ',' ORDER BY term.starts_at)
    FROM plugin_data.csf_cohort_terms AS link
    JOIN plugin_data.csf_cohorts AS cohort ON cohort.id = link.cohort_id
    JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
    WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND cohort.graduation_year = 2048
  ),
  'F44:9,S45:9,F45:10,S46:10,F46:11,S47:11,F47:12,S48:12',
  'the eight generated links preserve the canonical semester and grade sequence'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND correlation_id = 'b7f00000-0000-4000-8000-000000000002'
      AND action = 'cohort.create_with_terms'
  ),
  1,
  'the class and all eight links share one immutable audit receipt'
);
SELECT extensions.is(
  (
    SELECT plugin_data.csf_create_cohort_with_terms(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000002',
      '{"graduationYear":2048,"label":"Class of 2048","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )->>'idempotent'
  ),
  'true',
  'an exact class setup replay is idempotent'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND correlation_id = 'b7f00000-0000-4000-8000-000000000002'
  ),
  1,
  'an exact class setup replay does not duplicate audit history'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_cohort_with_terms(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000002',
      '{"graduationYear":2048,"label":"Changed class","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That class setup request identifier is already bound to a different change.',
  'a conflicting class setup replay fails closed'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_cohort_with_terms(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000003',
      '{"graduationYear":2048,"label":"Class of 2048","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That graduating class already exists; open it instead of creating it again.',
  'a distinct request cannot silently overwrite an existing class'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_cohorts
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND graduation_year = 2048
  ),
  1,
  'duplicate class setup leaves exactly one class row'
);

INSERT INTO plugin_data.csf_terms (
  organization_id, code, label, school_year, semester, starts_at, ends_at
) VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'F50',
  'Conflicting Fall 2050',
  '2049-2050',
  'fall',
  '2050-07-01',
  '2050-12-31'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_cohort_with_terms(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000004',
      '{"graduationYear":2054,"label":"Class of 2054","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Existing semester F50 has conflicting academic identity.',
  'a conflicting shared semester rejects the whole class setup'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_cohorts
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND graduation_year = 2054
  ),
  0,
  'failed shared-semester validation rolls the new class back'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_term_for_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000005',
      '{"cohortYear":2055,"termCode":"F51","label":"Fall 2051","semester":"fall","schoolYear":"2051-2052","startsAt":"2051-07-01","endsAt":"2051-12-31","applicationOpensAt":null,"applicationClosesAt":null,"sheetTabName":"F51","isCurrent":false}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Graduating class was not found in this organization; create the class first.',
  'semester setup never creates a missing class as a side effect'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_terms
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND code = 'F51'
  ),
  0,
  'missing-class semester setup leaves no orphan semester'
);

UPDATE plugin_data.csf_terms
SET is_current = true
WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
  AND code = 'F44';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_create_term_for_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000006',
      '{"cohortYear":2048,"termCode":"S44","label":"Spring 2044","semester":"spring","schoolYear":"2043-2044","startsAt":"2044-01-01","endsAt":"2044-06-30","applicationOpensAt":null,"applicationClosesAt":null,"sheetTabName":"S44 exceptional","isCurrent":true}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'an exceptional semester, class link, current selection, and audit save together'
);
SELECT extensions.ok(
  (
    SELECT label = 'Spring 2044'
      AND school_year = '2043-2044'
      AND semester = 'spring'
      AND starts_at = '2044-01-01'::date
      AND ends_at = '2044-06-30'::date
    FROM plugin_data.csf_terms
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND code = 'S44'
  ),
  'exceptional semester setup persists the explicit semester details'
);
SELECT extensions.ok(
  (
    SELECT link.sheet_tab_name = 'S44 exceptional' AND link.grade_level IS NULL
    FROM plugin_data.csf_cohort_terms AS link
    JOIN plugin_data.csf_cohorts AS cohort ON cohort.id = link.cohort_id
    JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
    WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND cohort.graduation_year = 2048
      AND term.code = 'S44'
  ),
  'exceptional semester setup creates the exact class link without inventing a grade'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 1
      AND bool_and(code = 'S44')
    FROM plugin_data.csf_terms
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND is_current = true
  ),
  'make-current is part of the same semester setup transaction'
);
SELECT extensions.ok(
  NOT (
    SELECT is_current
    FROM plugin_data.csf_terms
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND code = 'F44'
  ),
  'the previous current semester is cleared atomically'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND correlation_id = 'b7f00000-0000-4000-8000-000000000006'
      AND action = 'term.create_for_cohort'
  ),
  1,
  'semester setup writes one receipt for the semester, link, and current selection'
);
SELECT extensions.is(
  (
    SELECT plugin_data.csf_create_term_for_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000006',
      '{"cohortYear":2048,"termCode":"S44","label":"Spring 2044","semester":"spring","schoolYear":"2043-2044","startsAt":"2044-01-01","endsAt":"2044-06-30","applicationOpensAt":null,"applicationClosesAt":null,"sheetTabName":"S44 exceptional","isCurrent":true}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )->>'idempotent'
  ),
  'true',
  'an exact semester setup replay is idempotent'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND correlation_id = 'b7f00000-0000-4000-8000-000000000006'
  ),
  1,
  'an exact semester setup replay does not duplicate audit history'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_term_for_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000006',
      '{"cohortYear":2048,"termCode":"S44","label":"Changed Spring 2044","semester":"spring","schoolYear":"2043-2044","startsAt":"2044-01-01","endsAt":"2044-06-30","applicationOpensAt":null,"applicationClosesAt":null,"sheetTabName":"S44 exceptional","isCurrent":true}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That semester setup request identifier is already bound to a different change.',
  'a conflicting semester setup replay fails closed'
);

INSERT INTO plugin_data.csf_terms (
  organization_id, code, label, school_year, semester, starts_at, ends_at
) VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'F43',
  'Custom historical label',
  '2043-2044',
  'fall',
  '2043-07-01',
  '2043-12-31'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_create_term_for_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000007',
      '{"cohortYear":2048,"termCode":"F43","label":"Fall 2043","semester":"fall","schoolYear":"2043-2044","startsAt":"2043-07-01","endsAt":"2043-12-31","applicationOpensAt":null,"applicationClosesAt":null,"sheetTabName":"F43","isCurrent":false}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That semester already exists with different details; use Edit semester instead.',
  'semester setup never overwrites an existing shared semester'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_cohort_terms AS link
    JOIN plugin_data.csf_cohorts AS cohort ON cohort.id = link.cohort_id
    JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
    WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND cohort.graduation_year = 2048
      AND term.code = 'F43'
  ),
  0,
  'failed existing-semester validation creates no class link'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000008',
      '{"cohortId":"b7200000-0000-4000-8000-000000000002","label":"Cross tenant edit","status":"active"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Class was not found in this organization.',
  'class edit rejects a cross-tenant class identifier'
);
SELECT extensions.is(
  (
    SELECT label
    FROM plugin_data.csf_cohorts
    WHERE id = 'b7200000-0000-4000-8000-000000000002'
  ),
  'Other organization class',
  'a rejected cross-tenant class edit changes nothing'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000009',
      jsonb_build_object(
        'cohortId', (
          SELECT id FROM plugin_data.csf_cohorts
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
            AND graduation_year = 2048
        ),
        'label', 'Senior Class of 2048',
        'status', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized class edit saves with its audit receipt'
);
SELECT extensions.ok(
  (
    SELECT label = 'Senior Class of 2048' AND status = 'inactive'
    FROM plugin_data.csf_cohorts
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND graduation_year = 2048
  ),
  'class edit persists both submitted fields'
);
SELECT extensions.is(
  (
    SELECT plugin_data.csf_update_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000009',
      jsonb_build_object(
        'cohortId', (
          SELECT id FROM plugin_data.csf_cohorts
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
            AND graduation_year = 2048
        ),
        'label', 'Senior Class of 2048',
        'status', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )->>'idempotent'
  ),
  'true',
  'an exact class edit replay is idempotent'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_cohort(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000009',
      jsonb_build_object(
        'cohortId', (
          SELECT id FROM plugin_data.csf_cohorts
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
            AND graduation_year = 2048
        ),
        'label', 'Conflicting edit',
        'status', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That class edit request identifier is already bound to a different change.',
  'a conflicting class edit replay fails closed'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_cohort_status(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000010',
      '{"cohortId":"b7200000-0000-4000-8000-000000000002","status":"archived"}'::jsonb,
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Class was not found in this organization.',
  'class status changes reject cross-tenant identifiers'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_cohort_status(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000011',
      jsonb_build_object(
        'cohortId', (
          SELECT id FROM plugin_data.csf_cohorts
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
            AND graduation_year = 2048
        ),
        'status', 'archived'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'class archival and its audit receipt commit together'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_cohorts
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND graduation_year = 2048
  ),
  'archived',
  'the exact class becomes archived'
);
SELECT extensions.is(
  (
    SELECT plugin_data.csf_set_cohort_status(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000011',
      jsonb_build_object(
        'cohortId', (
          SELECT id FROM plugin_data.csf_cohorts
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
            AND graduation_year = 2048
        ),
        'status', 'archived'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )->>'idempotent'
  ),
  'true',
  'an exact class status replay is idempotent'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_cohort_status(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000011',
      jsonb_build_object(
        'cohortId', (
          SELECT id FROM plugin_data.csf_cohorts
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
            AND graduation_year = 2048
        ),
        'status', 'active'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That class status request identifier is already bound to a different change.',
  'a conflicting class status replay fails closed'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_cohort_term(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000012',
      jsonb_build_object(
        'termId', (
          SELECT id FROM plugin_data.csf_terms
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001' AND code = 'S44'
        ),
        'cohortTermId', (
          SELECT link.id
          FROM plugin_data.csf_cohort_terms AS link
          JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
          WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001' AND term.code = 'F44'
        ),
        'label', 'Should roll back',
        'startsAt', '2044-01-02',
        'endsAt', '2044-06-29',
        'sheetTabName', 'wrong-link',
        'linkStatus', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Class-semester link was not found in this organization.',
  'semester edit rejects a class link belonging to another semester'
);
SELECT extensions.is(
  (
    SELECT label
    FROM plugin_data.csf_terms
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND code = 'S44'
  ),
  'Spring 2044',
  'a rejected class-link mismatch leaves the semester unchanged'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_update_cohort_term(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000013',
      jsonb_build_object(
        'termId', (
          SELECT id FROM plugin_data.csf_terms
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001' AND code = 'S44'
        ),
        'cohortTermId', (
          SELECT link.id
          FROM plugin_data.csf_cohort_terms AS link
          JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
          WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001' AND term.code = 'S44'
        ),
        'label', 'Spring 2044 adjusted',
        'startsAt', '2044-01-05',
        'endsAt', '2044-06-25',
        'applicationOpensAt', '2044-01-10',
        'applicationClosesAt', '2044-02-10',
        'sheetTabName', 'S44 adjusted',
        'linkStatus', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'the semester and exact class link edit in one transaction'
);
SELECT extensions.ok(
  (
    SELECT term.label = 'Spring 2044 adjusted'
      AND term.starts_at = '2044-01-05'::date
      AND term.ends_at = '2044-06-25'::date
      AND term.application_opens_at = '2044-01-10'::timestamptz
      AND term.application_closes_at = '2044-02-10'::timestamptz
      AND link.sheet_tab_name = 'S44 adjusted'
      AND link.status = 'inactive'
    FROM plugin_data.csf_terms AS term
    JOIN plugin_data.csf_cohort_terms AS link ON link.term_id = term.id
    WHERE term.organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND term.code = 'S44'
  ),
  'semester edit persists both authoritative projections'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND correlation_id = 'b7f00000-0000-4000-8000-000000000013'
      AND action = 'term.edit'
      AND after_data->>'cohortTermId' IS NOT NULL
  ),
  1,
  'the semester and class-link edit share one audit receipt'
);
SELECT extensions.is(
  (
    SELECT plugin_data.csf_update_cohort_term(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000013',
      jsonb_build_object(
        'termId', (
          SELECT id FROM plugin_data.csf_terms
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001' AND code = 'S44'
        ),
        'cohortTermId', (
          SELECT link.id
          FROM plugin_data.csf_cohort_terms AS link
          JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
          WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001' AND term.code = 'S44'
        ),
        'label', 'Spring 2044 adjusted',
        'startsAt', '2044-01-05',
        'endsAt', '2044-06-25',
        'applicationOpensAt', '2044-01-10',
        'applicationClosesAt', '2044-02-10',
        'sheetTabName', 'S44 adjusted',
        'linkStatus', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )->>'idempotent'
  ),
  'true',
  'an exact class-semester edit replay is idempotent'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_update_cohort_term(
      'b7100000-0000-4000-8000-000000000001',
      'b7f00000-0000-4000-8000-000000000013',
      jsonb_build_object(
        'termId', (
          SELECT id FROM plugin_data.csf_terms
          WHERE organization_id = 'b7100000-0000-4000-8000-000000000001' AND code = 'S44'
        ),
        'cohortTermId', (
          SELECT link.id
          FROM plugin_data.csf_cohort_terms AS link
          JOIN plugin_data.csf_terms AS term ON term.id = link.term_id
          WHERE link.organization_id = 'b7100000-0000-4000-8000-000000000001' AND term.code = 'S44'
        ),
        'label', 'Conflicting adjusted term',
        'startsAt', '2044-01-05',
        'endsAt', '2044-06-25',
        'sheetTabName', 'S44 adjusted',
        'linkStatus', 'inactive'
      ),
      'b7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'That semester edit request identifier is already bound to a different change.',
  'a conflicting class-semester edit replay fails closed'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET after_data = '{}'::jsonb
    WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
      AND correlation_id = 'b7f00000-0000-4000-8000-000000000013'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'class and semester management receipts cannot be rewritten'
);
SELECT extensions.ok(
  (
    SELECT cohort.label = 'Other organization class'
      AND cohort.status = 'active'
      AND term.label = 'Other organization semester'
      AND term.is_current = true
    FROM plugin_data.csf_cohorts AS cohort
    CROSS JOIN plugin_data.csf_terms AS term
    WHERE cohort.id = 'b7200000-0000-4000-8000-000000000002'
      AND term.id = 'b7300000-0000-4000-8000-000000000002'
  ),
  'all class and semester operations preserve another organization'
);

SELECT * FROM extensions.finish();

ROLLBACK;
