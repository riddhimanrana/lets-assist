BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(8);

SELECT extensions.has_function(
  'plugin_data',
  'csf_normalized_record_schema',
  ARRAY['text'],
  'the canonical CSF record schema helper exists'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_normalized_record_schema(text)',
    'EXECUTE'
  ),
  'anonymous clients cannot inspect the owner-internal record schema'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_normalized_record_schema(text)',
    'EXECUTE'
  ),
  'authenticated clients cannot inspect the owner-internal record schema'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_normalized_record_schema(text)',
    'EXECUTE'
  ),
  'the service role reaches the schema only through reviewed wrappers'
);

SELECT extensions.ok(
  has_function_privilege(
    'postgres',
    'plugin_data.csf_normalized_record_schema(text)',
    'EXECUTE'
  ),
  'the reviewed owner retains schema-helper execution'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assert_canonical_record(
      'class_history',
      '{"identity":{"firstName":"Sample","lastName":"Student","sourceStudentKey":"samplestudent"}}'::jsonb
    )
  $$,
  'class history accepts the bounded roster source key used across semester tabs'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assert_canonical_record(
      'application_responses',
      '{"identity":{"firstName":"Sample","lastName":"Student","sourceStudentKey":"samplestudent"}}'::jsonb
    )
  $$,
  '23514',
  'A CSF application_responses record may not carry "identity.sourceStudentKey".',
  'application responses cannot acquire the class-history roster key'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assert_canonical_record(
      'student_roster',
      '{"identity":{"firstName":"Sample","lastName":"Student","sourceStudentKey":"samplestudent"}}'::jsonb
    )
  $$,
  '23514',
  'A CSF student_roster record may not carry "identity.sourceStudentKey".',
  'student-roster imports keep their existing closed schema'
);

SELECT * FROM extensions.finish();

ROLLBACK;
