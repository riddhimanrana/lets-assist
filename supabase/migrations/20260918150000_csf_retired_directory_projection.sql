-- Keep retained retirement evidence out of operational officer directories.
BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_before text;
  v_after text;
BEGIN
  v_definition := pg_get_functiondef(
    'plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)'::regprocedure
  );
  v_before := $anchor$FROM plugin_data.csf_profile_cohort_memberships membership
      WHERE membership.organization_id = p_organization_id$anchor$;
  v_after := $anchor$FROM plugin_data.csf_profile_cohort_memberships membership
      JOIN plugin_data.csf_cohorts AS membership_cohort
        ON membership_cohort.organization_id = membership.organization_id
       AND membership_cohort.id = membership.cohort_id
      WHERE membership.organization_id = p_organization_id$anchor$;
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF member directory membership projection changed.';
  END IF;
  v_definition := replace(v_definition, v_before, v_after);

  v_before := $anchor$ORDER BY (membership.status = 'active') DESC, membership.created_at DESC$anchor$;
  v_after := $anchor$ORDER BY (membership_cohort.status NOT IN ('archived', 'retired')) DESC,
        (membership.status = 'active') DESC, membership.created_at DESC$anchor$;
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF member directory class ordering changed.';
  END IF;
  v_definition := replace(v_definition, v_before, v_after);

  v_before := $anchor$AND (p_cohort_id IS NOT NULL OR cohort.status IS DISTINCT FROM 'archived')$anchor$;
  v_after := $anchor$AND (p_cohort_id IS NOT NULL OR cohort.status IS DISTINCT FROM 'archived')
      AND cohort.status IS DISTINCT FROM 'retired'$anchor$;
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF member directory visibility guard changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);

  v_definition := pg_get_functiondef(
    'plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)'::regprocedure
  );
  v_before := $anchor$AND cohort.id = p_cohort_id
  ),
  base AS ($anchor$;
  v_after := $anchor$AND cohort.id = p_cohort_id
      AND cohort.status <> 'retired'
  ),
  base AS ($anchor$;
  IF length(v_definition) - length(replace(v_definition, v_before, '')) <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF class directory selector changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END;
$migration$;

ALTER FUNCTION plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)
  OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_profiles_page(uuid,text,text,uuid,text,text,text,text,uuid,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_class_directory_page(uuid,uuid,uuid,text,text,text,text,text,text,uuid,integer)
  TO service_role;

COMMIT;
