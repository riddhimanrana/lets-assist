-- Carry active reviewed workbook lineage through the existing audited merge.
BEGIN;

ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid)
  RENAME TO csf_profile_merge_reference_plan_workbook_links_base;
CREATE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,p_source_profile_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_plan jsonb;
BEGIN
  v_plan:=plugin_data.csf_profile_merge_reference_plan_workbook_links_base(p_organization_id,p_source_profile_id);
  v_plan:=jsonb_set(v_plan,'{sameTransactionRewrites}',coalesce(v_plan->'sameTransactionRewrites','[]'::jsonb)||jsonb_build_array(
    jsonb_build_object('reference','plugin_data.csf_reviewed_workbook_profile_links.profile_id',
      'scope','active reviewed workbook links; preserve original evidence in the merge audit',
      'sourceCount',(SELECT count(*) FROM plugin_data.csf_reviewed_workbook_profile_links
        WHERE organization_id=p_organization_id AND profile_id=p_source_profile_id AND revoked_at IS NULL))));
  RETURN jsonb_set(v_plan,'{immutableHistoryRetentions}',coalesce(v_plan->'immutableHistoryRetentions','[]'::jsonb)||jsonb_build_array(
    jsonb_build_object('reference','plugin_data.csf_reviewed_workbook_profile_links.profile_id',
      'scope','revoked workbook links retain their original profile and review evidence',
      'sourceCount',(SELECT count(*) FROM plugin_data.csf_reviewed_workbook_profile_links
        WHERE organization_id=p_organization_id AND profile_id=p_source_profile_id AND revoked_at IS NOT NULL))));
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan_workbook_links_base(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan_workbook_links_base(uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid,uuid) TO postgres;

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)
  RENAME TO csf_merge_profiles_workbook_links_base;
CREATE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,p_source_profile_id uuid,p_target_profile_id uuid,
  p_reason text,p_actor_user_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_before jsonb; v_count integer; v_changed integer; v_result jsonb;
  v_review_id uuid; v_correlation_id uuid;
BEGIN
  -- The existing request wrapper owns permission checks and retry receipts.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM 1 FROM plugin_data.csf_profiles
    WHERE organization_id=p_organization_id AND id IN (p_source_profile_id,p_target_profile_id)
    ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(link) ORDER BY link.id),'[]'::jsonb),count(*)::integer
    INTO v_before,v_count FROM (
      SELECT * FROM plugin_data.csf_reviewed_workbook_profile_links
      WHERE organization_id=p_organization_id AND profile_id=p_source_profile_id AND revoked_at IS NULL
      ORDER BY id FOR UPDATE
    ) link;

  v_result:=plugin_data.csf_merge_profiles_workbook_links_base(
    p_organization_id,p_source_profile_id,p_target_profile_id,p_reason,p_actor_user_id);
  IF v_count>0 THEN
    v_review_id:=nullif(v_result->>'reviewId','')::uuid;
    v_correlation_id:=nullif(v_result->>'correlationId','')::uuid;
    IF v_review_id IS NULL OR v_correlation_id IS NULL THEN
      RAISE EXCEPTION 'The profile merge did not return its workbook-link evidence identifiers.' USING ERRCODE='55000';
    END IF;
    UPDATE plugin_data.csf_reviewed_workbook_profile_links SET profile_id=p_target_profile_id
      WHERE organization_id=p_organization_id AND profile_id=p_source_profile_id AND revoked_at IS NULL;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>v_count THEN
      RAISE EXCEPTION 'The reviewed workbook links changed during the profile merge.' USING ERRCODE='40001';
    END IF;
    INSERT INTO plugin_data.csf_admin_audit_events(
      organization_id,actor_user_id,action,target_type,target_id,before_data,after_data,correlation_id
    ) VALUES (
      p_organization_id,p_actor_user_id,'profile_merge.workbook_links_reassigned','csf_profile_merge_reviews',v_review_id,
      jsonb_build_object('sourceProfileId',p_source_profile_id,'workbookLinks',v_before),
      jsonb_build_object('targetProfileId',p_target_profile_id,'rewrittenCount',v_changed),v_correlation_id);
  END IF;
  RETURN v_result||jsonb_build_object('rewrittenWorkbookLinks',v_count);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid) TO postgres;
COMMIT;
