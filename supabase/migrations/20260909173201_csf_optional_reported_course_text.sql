-- Treat an optional canonical null as absent when deriving course review text.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('plugin_data.csf_derive_row_commit_payload(text,jsonb)'::regprocedure);
BEGIN
  IF md5(definition) <> 'd01d37d7a11be7615b75d95b706089ca' THEN
    RAISE EXCEPTION 'The reviewed reported-course payload helper changed.';
  END IF;
  definition := replace(definition,
    'IF v_entry ? ''reportedText'' AND (',
    'IF v_entry ? ''reportedText'' AND v_entry -> ''reportedText'' <> ''null''::jsonb AND (');
  definition := replace(definition,
    'CASE WHEN v_entry ? ''reportedText'' THEN',
    'CASE WHEN jsonb_typeof(v_entry -> ''reportedText'') = ''string'' THEN');
  EXECUTE definition;
END;
$migration$;
REVOKE ALL ON FUNCTION plugin_data.csf_derive_row_commit_payload(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_derive_row_commit_payload(text,jsonb) TO postgres;
