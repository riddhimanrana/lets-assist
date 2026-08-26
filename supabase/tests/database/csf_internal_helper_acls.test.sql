BEGIN;

SELECT plan(4);

CREATE TEMP TABLE csf_reviewed_internal_helpers(signature text PRIMARY KEY);

INSERT INTO csf_reviewed_internal_helpers(signature) VALUES
  ('plugin_data.csf_normalized_record_schema(text)'),
  ('plugin_data.csf_derive_row_commit_payload(text,jsonb)'),
  ('plugin_data.csf_sheet_source_settings_schema()'),
  ('plugin_data.csf_sheet_source_attachment_keys()'),
  ('plugin_data.csf_assert_sheet_source_settings(jsonb)'),
  ('plugin_data.csf_set_import_created_profile_resolution()');

SELECT is(
  (SELECT count(*) FROM csf_reviewed_internal_helpers),
  6::bigint,
  'the reviewed CSF internal helper ACL catalog is complete'
);

SELECT ok(
  (SELECT bool_and(to_regprocedure(signature) IS NOT NULL)
   FROM csf_reviewed_internal_helpers),
  'every reviewed CSF internal helper exists'
);

SELECT ok(
  (SELECT bool_and(has_function_privilege('postgres', signature, 'EXECUTE'))
   FROM csf_reviewed_internal_helpers),
  'postgres has an explicit execution grant on every reviewed internal helper'
);

SELECT ok(
  (SELECT bool_and(
     NOT has_function_privilege('anon', signature, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', signature, 'EXECUTE')
     AND NOT has_function_privilege('service_role', signature, 'EXECUTE')
   ) FROM csf_reviewed_internal_helpers),
  'browser and service roles cannot execute the closed internal helpers'
);

SELECT * FROM finish();

ROLLBACK;
