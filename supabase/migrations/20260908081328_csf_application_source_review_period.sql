-- Prepare missing application review periods when an officer links a chapter source.
BEGIN;
CREATE FUNCTION plugin_data.csf_prepare_application_source_review_periods(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_expected_mapping_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_code text;
  v_created integer := 0;
  v_existing integer := 0;
  v_closed integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id, p_actor_user_id, 'application_responses');
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF review periods.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_source FROM plugin_data.csf_sheet_sources
    WHERE id=p_source_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_source.source_type <> 'application_responses'
    OR v_source.cohort_id IS NOT NULL OR v_source.provider <> 'google_sheets' THEN
    RAISE EXCEPTION 'Choose a linked chapter application Sheet.' USING ERRCODE='22023';
  END IF;
  IF p_expected_mapping_version IS NULL OR p_expected_mapping_version < 1
    OR v_source.settings->>'mappingVersion' IS DISTINCT FROM p_expected_mapping_version::text THEN
    RAISE EXCEPTION 'The Sheet mapping changed. Reload it before preparing review.' USING ERRCODE='40001';
  END IF;
  IF pg_catalog.jsonb_typeof(v_source.tab_mappings) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(v_source.tab_mappings) NOT BETWEEN 1 AND 64
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_source.tab_mappings) mapping
      WHERE nullif(pg_catalog.btrim(mapping->>'termCode'),'') IS NULL
        OR mapping->>'targetStrategy' IS DISTINCT FROM 'derive_from_grade') THEN
    RAISE EXCEPTION 'Each application tab needs its source semester and grade mapping.' USING ERRCODE='22023';
  END IF;
  FOR v_code IN SELECT DISTINCT mapping->>'termCode'
    FROM pg_catalog.jsonb_array_elements(v_source.tab_mappings) mapping ORDER BY 1
  LOOP
    SELECT * INTO v_term FROM plugin_data.csf_terms
      WHERE organization_id=p_organization_id AND code=v_code FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Set up the source semester before preparing application review.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_period FROM plugin_data.csf_review_periods
      WHERE organization_id=p_organization_id AND term_id=v_term.id
        AND kind='membership_applications' FOR UPDATE;
    IF FOUND THEN
      v_existing := v_existing + 1;
      IF v_period.status='closed' THEN v_closed := v_closed + 1; END IF;
      CONTINUE;
    END IF;
    PERFORM plugin_data.csf_set_review_period(
      p_organization_id, p_actor_user_id, v_term.id, 'membership_applications',
      'open', v_term.label || ' application review', NULL, NULL, NULL);
    v_created := v_created + 1;
    INSERT INTO plugin_data.csf_admin_audit_events
      (organization_id,actor_user_id,action,target_type,target_id,term_id,source_type,source_id,after_data)
    VALUES (p_organization_id,p_actor_user_id,'application_source.review_period_prepared',
      'csf_sheet_sources',v_source.id,v_term.id,'application_responses',v_source.id::text,
      pg_catalog.jsonb_build_object('mappingVersion',p_expected_mapping_version,'termCode',v_code));
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('status','prepared','createdPeriodCount',v_created,
    'existingPeriodCount',v_existing,'closedPeriodCount',v_closed);
END;
$function$;
REVOKE ALL ON FUNCTION plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)
  TO service_role;
COMMIT;
