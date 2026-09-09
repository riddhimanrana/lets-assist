-- Preserve reported course text as review evidence without changing credit claims.
DO $migration$
DECLARE
  schema_definition text := pg_get_functiondef('plugin_data.csf_normalized_record_schema(text)'::regprocedure);
  payload_definition text := pg_get_functiondef('plugin_data.csf_derive_row_commit_payload(text,jsonb)'::regprocedure);
  schema_marker text := '"courseList": "string", "courseName": "string", "grade": "string", "isBonus": "boolean"';
  grade_marker text := '        v_grade := pg_catalog.to_jsonb(plugin_data.csf_payload_string(v_entry -> ''grade''));';
  course_marker text := E'          ''isBonus'', false\n        ));';
BEGIN
  IF md5(schema_definition) <> 'd48ad3304c7bdeee58d44e29203fdb30'
    OR md5(payload_definition) <> '602b0761f500a47c3815e26def8ee818'
    OR position(schema_marker IN schema_definition) = 0
    OR position(grade_marker IN payload_definition) = 0
    OR position(course_marker IN payload_definition) = 0 THEN
    RAISE EXCEPTION 'The reviewed application course import functions changed.';
  END IF;
  EXECUTE replace(schema_definition, schema_marker,
    schema_marker || ', "reportedText": "string"');
  payload_definition := replace(payload_definition, grade_marker, $validation$
        IF v_entry ? 'reportedText' AND (
          jsonb_typeof(v_entry -> 'reportedText') IS DISTINCT FROM 'string'
          OR length(v_entry ->> 'reportedText') > 4096
        ) THEN
          RAISE EXCEPTION 'Reported course text must be a string of at most 4096 characters.' USING ERRCODE = '23514';
        END IF;
$validation$ || grade_marker);
  payload_definition := replace(payload_definition, course_marker, $course$
          'isBonus', false
        ) || CASE WHEN v_entry ? 'reportedText' THEN
          pg_catalog.jsonb_build_object('rawLine', plugin_data.csf_payload_string(v_entry -> 'reportedText'))
        ELSE '{}'::jsonb END);$course$);
  EXECUTE payload_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalized_record_schema(text) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_derive_row_commit_payload(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_derive_row_commit_payload(text,jsonb) TO postgres;
