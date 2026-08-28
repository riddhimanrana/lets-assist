-- Keep the database canonical-record schema in parity with the reviewed
-- class-history TypeScript allowlist. The linked-sheet parser uses the bounded
-- sourceStudentKey to preserve one student across semester tabs; rejecting it
-- prevented every class-history preview from being recorded.

CREATE OR REPLACE FUNCTION plugin_data.csf_normalized_record_schema(
  p_source_type text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_source_type
    WHEN 'application_responses' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "responseEmail": "string", "responseEmailState": "string",
        "preferredContactEmail": "string", "preferredContactEmailState": "string",
        "emailsAgree": "boolean"
      }},
      "cohort": {"kind": "object", "fields": {
        "gradeLevel": "number", "returningStatus": "string"
      }},
      "submission": {"kind": "object", "fields": {"submittedAt": "string"}},
      "claimedTotals": {"kind": "object", "fields": {
        "listIPoints": "number", "listIAndIIPoints": "number", "grandTotalPoints": "number"
      }},
      "courses": {"kind": "array", "fields": {
        "courseList": "string", "courseName": "string", "grade": "string", "isBonus": "boolean"
      }},
      "evidence": {"kind": "object", "fields": {
        "transcriptDriveFileId": "string", "transcriptAccessState": "string",
        "receiptDriveFileId": "string", "receiptAccessState": "string"
      }}
    }'::jsonb
    WHEN 'student_roster' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "schoolEmail": "string", "schoolEmailState": "string",
        "personalEmail": "string", "personalEmailState": "string"
      }},
      "cohort": {"kind": "object", "fields": {"gradeLevel": "number"}}
    }'::jsonb
    WHEN 'class_history' THEN '{
      "identity": {"kind": "object", "fields": {
        "firstName": "string", "lastName": "string",
        "normalizedFirstName": "string", "normalizedLastName": "string",
        "sourceStudentKey": "string"
      }},
      "contact": {"kind": "object", "fields": {
        "schoolEmail": "string", "schoolEmailState": "string",
        "personalEmail": "string", "personalEmailState": "string"
      }},
      "activities": {"kind": "array", "fields": {"label": "string", "points": "number"}},
      "meetings": {"kind": "array", "fields": {"key": "string", "label": "string", "state": "string"}},
      "requirements": {"kind": "object", "fields": {"allRequirementsMet": "boolean"}}
    }'::jsonb
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalized_record_schema(text)
  TO postgres;

COMMENT ON FUNCTION plugin_data.csf_normalized_record_schema(text) IS
  'Returns the closed canonical-record schema for reviewed central CSF import source types.';
