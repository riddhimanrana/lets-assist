-- Retain explicit officer decisions for the same workbook key across semesters.
BEGIN;

CREATE TABLE plugin_data.csf_reviewed_workbook_profile_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  cohort_id uuid NOT NULL,
  source_file_id text NOT NULL CHECK (length(btrim(source_file_id)) BETWEEN 1 AND 500),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 500),
  profile_id uuid NOT NULL,
  reviewed_row_id uuid NOT NULL,
  authorized_by uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 4 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revocation_reason text,
  UNIQUE (organization_id, request_id),
  FOREIGN KEY (organization_id, cohort_id)
    REFERENCES plugin_data.csf_cohorts(organization_id, id),
  FOREIGN KEY (organization_id, profile_id)
    REFERENCES plugin_data.csf_profiles(organization_id, id),
  FOREIGN KEY (organization_id, reviewed_row_id)
    REFERENCES plugin_data.csf_sheet_import_rows(organization_id, id),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL
      AND length(btrim(revocation_reason)) BETWEEN 4 AND 500))
);
CREATE UNIQUE INDEX csf_reviewed_workbook_profile_links_active_key
  ON plugin_data.csf_reviewed_workbook_profile_links
    (organization_id, cohort_id, source_file_id, source_key)
  WHERE revoked_at IS NULL;
ALTER TABLE plugin_data.csf_reviewed_workbook_profile_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_reviewed_workbook_profile_links
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON plugin_data.csf_reviewed_workbook_profile_links TO service_role;
CREATE UNIQUE INDEX csf_workbook_profile_link_request_receipt
  ON plugin_data.csf_admin_audit_events (organization_id, (after_data->>'requestId'))
  WHERE action='sheets.workbook_profile_link_confirmed';

CREATE FUNCTION plugin_data.csf_confirm_workbook_profile_link(
  p_organization_id uuid, p_row_id uuid, p_profile_id uuid,
  p_actor_user_id uuid, p_request_id uuid, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_link plugin_data.csf_reviewed_workbook_profile_links%ROWTYPE;
  v_source_key text;
  v_candidate uuid;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_profile_id IS NULL
    OR coalesce(length(btrim(p_reason)), 0) NOT BETWEEN 4 AND 500 THEN
    RAISE EXCEPTION 'Choose a profile, request, and review reason.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_row(p_organization_id, p_actor_user_id, p_row_id);
  PERFORM plugin_data.csf_lock_active_import_profiles(p_organization_id, ARRAY[p_profile_id]);

  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND action='sheets.workbook_profile_link_confirmed'
      AND after_data->>'requestId'=p_request_id::text;
  IF FOUND THEN
    IF v_receipt.after_data->>'reviewedRowId' IS DISTINCT FROM p_row_id::text
      OR v_receipt.after_data->>'profileId' IS DISTINCT FROM p_profile_id::text
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data->>'reasonHash' IS DISTINCT FROM md5(btrim(p_reason)) THEN
      RAISE EXCEPTION 'This request belongs to a different profile decision.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO STRICT v_link FROM plugin_data.csf_reviewed_workbook_profile_links
      WHERE organization_id=p_organization_id AND id=v_receipt.target_id;
    RETURN jsonb_build_object('linkId',v_link.id,'status',
      CASE WHEN v_link.revoked_at IS NULL THEN 'linked' ELSE 'revoked' END,'replayed',true);
  END IF;

  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_row_id;
  SELECT * INTO v_job FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=v_row.job_id FOR UPDATE;
  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_row_id AND job_id=v_job.id FOR UPDATE;
  v_source_key := plugin_data.csf_class_history_source_key_value(v_row.normalized_data);
  IF NOT FOUND OR v_job.mode<>'preview' OR v_job.source_type<>'class_history'
    OR v_job.status NOT IN ('completed','needs_resolution')
    OR v_row.cohort_id IS NULL OR v_source_key IS NULL
    OR nullif(v_job.source_file_id,'') IS NULL
    OR v_row.commit_frozen_at IS NOT NULL OR v_row.commit_attempt_id IS NOT NULL
    OR v_row.commit_outcome_state IN ('in_flight','unknown','historical_unknown')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_import_commit_queue q
      WHERE q.organization_id=p_organization_id AND q.preview_job_id=v_job.id
        AND q.status IN ('queued','running')) THEN
    RAISE EXCEPTION 'This row needs a fresh, unqueued class review.' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_class_workbooks w
    WHERE w.organization_id=p_organization_id AND w.cohort_id=v_row.cohort_id
      AND w.drive_file_id=v_job.source_file_id AND w.state='linked')
    OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
      WHERE m.organization_id=p_organization_id AND m.cohort_id=v_row.cohort_id
        AND m.profile_id=p_profile_id AND m.status='active') THEN
    RAISE EXCEPTION 'The workbook or class membership changed.' USING ERRCODE='40001';
  END IF;

  v_candidate := plugin_data.csf_class_history_source_key_target_name_only_v1(p_organization_id,p_row_id);
  IF v_candidate IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'Review the conflicting workbook identity before saving this link.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_link FROM plugin_data.csf_reviewed_workbook_profile_links
    WHERE organization_id=p_organization_id AND cohort_id=v_row.cohort_id
      AND source_file_id=v_job.source_file_id AND source_key=v_source_key AND revoked_at IS NULL;
  IF FOUND AND v_link.profile_id<>p_profile_id THEN
    RAISE EXCEPTION 'This workbook key has another reviewed profile link.' USING ERRCODE='23514';
  END IF;

  PERFORM plugin_data.csf_reconcile_sheet_import_row(
    p_organization_id,p_row_id,p_profile_id,'match',btrim(p_reason),p_actor_user_id,NULL::uuid);
  IF v_link.id IS NULL THEN
    INSERT INTO plugin_data.csf_reviewed_workbook_profile_links
      (organization_id,cohort_id,source_file_id,source_key,profile_id,reviewed_row_id,
       authorized_by,request_id,reason)
    VALUES (p_organization_id,v_row.cohort_id,v_job.source_file_id,v_source_key,
      p_profile_id,p_row_id,p_actor_user_id,p_request_id,btrim(p_reason)) RETURNING * INTO v_link;
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,source_type,source_id,after_data)
  VALUES (p_organization_id,p_actor_user_id,'sheets.workbook_profile_link_confirmed',
    'csf_reviewed_workbook_profile_links',v_link.id,'sheet_import',v_job.source_id::text,
    jsonb_build_object('profileId',p_profile_id,'reviewedRowId',p_row_id,'requestId',p_request_id,
      'reasonHash',md5(btrim(p_reason))));
  RETURN jsonb_build_object('linkId',v_link.id,'status','linked','replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_confirm_workbook_profile_link(uuid,uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_workbook_profile_link(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION plugin_data.csf_revoke_workbook_profile_link(
  p_organization_id uuid,p_link_id uuid,p_actor_user_id uuid,p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link plugin_data.csf_reviewed_workbook_profile_links%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id,p_actor_user_id,'class_history');
  IF coalesce(length(btrim(p_reason)),0) NOT BETWEEN 4 AND 500 THEN
    RAISE EXCEPTION 'Enter a reason for removing this workbook link.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_link FROM plugin_data.csf_reviewed_workbook_profile_links
    WHERE organization_id=p_organization_id AND id=p_link_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workbook profile link not found.' USING ERRCODE='22023'; END IF;
  IF v_link.revoked_at IS NULL THEN
    UPDATE plugin_data.csf_reviewed_workbook_profile_links
      SET revoked_at=now(),revoked_by=p_actor_user_id,revocation_reason=btrim(p_reason)
      WHERE id=v_link.id;
    INSERT INTO plugin_data.csf_admin_audit_events
      (organization_id,actor_user_id,action,target_type,target_id,after_data)
    VALUES (p_organization_id,p_actor_user_id,'sheets.workbook_profile_link_revoked',
      'csf_reviewed_workbook_profile_links',v_link.id,jsonb_build_object('reason',btrim(p_reason)));
  END IF;
  RETURN jsonb_build_object('linkId',v_link.id,'status','revoked');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_revoke_workbook_profile_link(uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_workbook_profile_link(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_target(
  p_organization_id uuid,p_import_row_id uuid
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_file text;
  v_candidate uuid;
  v_school text;
  v_personal text;
BEGIN
  SELECT r.* INTO v_row
  FROM plugin_data.csf_sheet_import_rows r JOIN plugin_data.csf_sheet_import_jobs j
    ON j.organization_id=r.organization_id AND j.id=r.job_id
  WHERE r.organization_id=p_organization_id AND r.id=p_import_row_id
    AND j.mode='preview' AND j.source_type='class_history';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT source_file_id INTO v_file FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=v_row.job_id;
  v_candidate := plugin_data.csf_class_history_source_key_target_name_only_v1(p_organization_id,p_import_row_id);
  v_school := nullif(btrim(coalesce(v_row.normalized_data#>>'{record,contact,schoolEmail}',
    v_row.normalized_data#>>'{contact,schoolEmail}','')),'');
  v_personal := nullif(btrim(coalesce(v_row.normalized_data#>>'{record,contact,personalEmail}',
    v_row.normalized_data#>>'{contact,personalEmail}','')),'');
  IF v_school IS NOT NULL OR v_personal IS NOT NULL THEN RETURN v_candidate; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links link
    WHERE link.organization_id=p_organization_id AND link.cohort_id=v_row.cohort_id
      AND link.source_file_id=v_file AND link.source_key=plugin_data.csf_class_history_source_key_value(v_row.normalized_data)
      AND link.profile_id=v_candidate AND link.revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM plugin_data.csf_class_workbooks w
        WHERE w.organization_id=link.organization_id AND w.cohort_id=link.cohort_id
          AND w.drive_file_id=link.source_file_id AND w.state='linked')
      AND EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships m
        WHERE m.organization_id=link.organization_id AND m.cohort_id=link.cohort_id
          AND m.profile_id=link.profile_id AND m.status='active')) THEN
    RETURN v_candidate;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid,uuid) TO postgres;

COMMIT;
