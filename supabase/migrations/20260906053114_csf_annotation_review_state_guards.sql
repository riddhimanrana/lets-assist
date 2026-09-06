BEGIN;

-- Change only the reviewed guards and refuse an unexpected predecessor body.
DO $annotation_review_guards$
DECLARE
  v_definition text;
  v_body_hash text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid), pg_catalog.md5(p.prosrc)
  INTO v_definition, v_body_hash
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)'::regprocedure;
  IF v_body_hash IS DISTINCT FROM '8eb7262bd0f4a527ac382fa761f59182' THEN
    RAISE EXCEPTION 'Unexpected annotation interpretation predecessor.';
  END IF;
  v_definition := pg_catalog.replace(v_definition,
    'OR v_row.commit_attempt_id IS NOT NULL THEN',
    'OR v_row.commit_attempt_id IS NOT NULL
    OR v_row.commit_frozen_at IS NOT NULL
    OR v_row.commit_outcome_state <> ''not_started'' THEN');
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(p.oid), pg_catalog.md5(p.prosrc)
  INTO v_definition, v_body_hash
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
  IF v_body_hash IS DISTINCT FROM '984eecbf0c4068bd103d0548aa6adffa' THEN
    RAISE EXCEPTION 'Unexpected annotation review predecessor.';
  END IF;
  v_definition := pg_catalog.replace(v_definition,
    'IF NOT FOUND OR v_job.mode<>''preview'' OR v_job.source_type<>''class_history'' THEN
    RAISE EXCEPTION ''Choose a class history preview row.''',
    'IF NOT FOUND OR v_job.mode<>''preview'' OR v_job.source_type<>''class_history''
    OR v_job.status NOT IN (''completed'',''needs_resolution'') THEN
    RAISE EXCEPTION ''Choose a completed class history preview row.''');
  v_definition := pg_catalog.replace(v_definition,
    ')) OR v_row.commit_attempt_id IS NOT NULL
    OR EXISTS',
    ')) OR v_row.commit_attempt_id IS NOT NULL
    OR v_row.commit_frozen_at IS NOT NULL
    OR v_row.commit_outcome_state <> ''not_started''
    OR EXISTS');
  EXECUTE v_definition;
END;
$annotation_review_guards$;

REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(uuid,uuid,text,text,uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_import_annotation(uuid,uuid,uuid,uuid,text,text)
  TO postgres,service_role;

COMMIT;
