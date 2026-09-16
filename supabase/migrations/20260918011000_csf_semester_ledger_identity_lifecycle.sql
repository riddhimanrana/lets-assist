-- Classify semester Sheet write receipts in merge and graduated-class retention.
BEGIN;

INSERT INTO plugin_data.csf_retention_reference_policy
  (parent_table,child_table,child_column,policy,note)
VALUES ('csf_profiles','csf_sheet_semester_ledger_writes','profile_id',
  'delete_with_owner','settled Sheet cell attempts contain the student''s activity and attendance details');

ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid)
  RENAME TO csf_profile_merge_reference_plan_semester_ledger_base;
CREATE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,p_source_profile_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE plan jsonb;
BEGIN
  plan:=plugin_data.csf_profile_merge_reference_plan_semester_ledger_base(
    p_organization_id,p_source_profile_id);
  RETURN jsonb_set(plan,'{immutableHistoryRetentions}',
    coalesce(plan->'immutableHistoryRetentions','[]'::jsonb)||jsonb_build_array(
      jsonb_build_object('reference','plugin_data.csf_sheet_semester_ledger_writes.profile_id',
        'scope','frozen provider attempt evidence remains attached to its source profile tombstone',
        'sourceCount',(SELECT count(*) FROM plugin_data.csf_sheet_semester_ledger_writes w
          WHERE w.organization_id=p_organization_id AND w.profile_id=p_source_profile_id))));
END $$;
ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan_semester_ledger_base(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan_semester_ledger_base(uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid) TO postgres;

ALTER FUNCTION plugin_data.csf_retention_candidates(uuid,integer[])
  RENAME TO csf_retention_candidates_semester_ledger_base;
CREATE FUNCTION plugin_data.csf_retention_candidates(
  p_organization_id uuid,p_graduation_years integer[]
) RETURNS TABLE(profile_id uuid,cohort_id uuid,graduation_year integer,
  blockers text[],retained_reference_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT candidate.profile_id,candidate.cohort_id,candidate.graduation_year,
    CASE WHEN EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
      WHERE w.organization_id=p_organization_id AND w.profile_id=candidate.profile_id
        AND w.status IN ('claimed','unknown_outcome'))
      THEN array_append(candidate.blockers,'semester_sheet_write_needs_reconciliation')
      ELSE candidate.blockers END,
    candidate.retained_reference_count
  FROM plugin_data.csf_retention_candidates_semester_ledger_base(
    p_organization_id,p_graduation_years) AS candidate
$$;
ALTER FUNCTION plugin_data.csf_retention_candidates(uuid,integer[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_candidates_semester_ledger_base(uuid,integer[])
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_candidates_semester_ledger_base(uuid,integer[]) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_candidates(uuid,integer[])
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_candidates(uuid,integer[]) TO postgres;

ALTER FUNCTION plugin_data.csf_retention_delete_owned_records(uuid,uuid)
  RENAME TO csf_retention_delete_owned_records_semester_ledger_base;
CREATE FUNCTION plugin_data.csf_retention_delete_owned_records(
  p_organization_id uuid,p_profile_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE deleted_count integer; result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=p_organization_id AND w.profile_id=p_profile_id
      AND w.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the semester Sheet write before retiring this profile.' USING ERRCODE='55000';
  END IF;
  DELETE FROM plugin_data.csf_sheet_semester_ledger_writes w
    WHERE w.organization_id=p_organization_id AND w.profile_id=p_profile_id
      AND w.status IN ('applied','aborted');
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  result:=plugin_data.csf_retention_delete_owned_records_semester_ledger_base(
    p_organization_id,p_profile_id);
  IF deleted_count>0 THEN
    result:=result||jsonb_build_object('csf_sheet_semester_ledger_writes',deleted_count);
  END IF;
  RETURN result;
END $$;
ALTER FUNCTION plugin_data.csf_retention_delete_owned_records(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_delete_owned_records_semester_ledger_base(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_delete_owned_records_semester_ledger_base(uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_retention_delete_owned_records(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_delete_owned_records(uuid,uuid) TO postgres;

COMMIT;
