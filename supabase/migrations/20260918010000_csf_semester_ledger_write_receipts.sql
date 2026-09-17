-- Officer-accepted mappings and durable attempts for the separate class ledger.
BEGIN;

CREATE TABLE plugin_data.csf_sheet_semester_ledger_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  source_file_id text NOT NULL CHECK (length(source_file_id) BETWEEN 8 AND 200),
  cohort_id uuid NOT NULL,
  term_id uuid NOT NULL,
  acceptance_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_sync_acceptances(id),
  layout jsonb NOT NULL CHECK (jsonb_typeof(layout)='object'),
  accepted_by uuid NOT NULL REFERENCES auth.users(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,destination_id)
    REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,cohort_id)
    REFERENCES plugin_data.csf_cohorts(organization_id,id),
  FOREIGN KEY (organization_id,term_id)
    REFERENCES plugin_data.csf_terms(organization_id,id),
  UNIQUE (destination_id),
  UNIQUE (organization_id,id)
);
ALTER TABLE plugin_data.csf_sheet_semester_ledger_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_semester_ledger_mappings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_semester_ledger_mappings TO service_role;

CREATE TABLE plugin_data.csf_sheet_semester_ledger_writes (
  request_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  mapping_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  source_link_id uuid NOT NULL REFERENCES plugin_data.csf_reviewed_workbook_profile_links(id),
  profile_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 200),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^[a-f0-9]{64}$'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan)='object'),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','applied','unknown_outcome','aborted')),
  readback_digest text CHECK (readback_digest IS NULL OR readback_digest ~ '^[a-f0-9]{64}$'),
  lease_expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '2 minutes'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id,mapping_id)
    REFERENCES plugin_data.csf_sheet_semester_ledger_mappings(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,destination_id)
    REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,profile_id)
    REFERENCES plugin_data.csf_profiles(organization_id,id),
  UNIQUE (destination_id,profile_id,source_version,preview_digest),
  CHECK ((status='claimed' AND finished_at IS NULL AND readback_digest IS NULL)
    OR (status='applied' AND finished_at IS NOT NULL AND readback_digest IS NOT NULL)
    OR (status IN ('unknown_outcome','aborted') AND finished_at IS NOT NULL))
);
ALTER TABLE plugin_data.csf_sheet_semester_ledger_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_semester_ledger_writes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_semester_ledger_writes TO service_role;

CREATE FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='csf_sheet_semester_ledger_mappings' THEN
    RAISE EXCEPTION 'Accepted semester mappings are immutable.' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','readback_digest','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','readback_digest','finished_at']) THEN
    RAISE EXCEPTION 'Semester write identity and evidence are immutable.' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'claimed' OR NEW.status NOT IN ('applied','unknown_outcome','aborted') THEN
    RAISE EXCEPTION 'A completed semester write cannot change.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER csf_sheet_semester_mapping_immutable BEFORE UPDATE ON plugin_data.csf_sheet_semester_ledger_mappings
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable();
CREATE TRIGGER csf_sheet_semester_write_immutable BEFORE UPDATE ON plugin_data.csf_sheet_semester_ledger_writes
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_semester_ledger_immutable();

CREATE FUNCTION plugin_data.csf_accept_sheet_semester_ledger_mapping(
  p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,
  p_source_file_id text,p_acceptance_id uuid,p_layout jsonb,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
  m plugin_data.csf_sheet_semester_ledger_mappings%ROWTYPE;
  a plugin_data.csf_sheet_sync_acceptances%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync')
    AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations
    WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
  IF NOT FOUND OR d.kind<>'class' OR d.is_test OR d.enabled OR d.cohort_id IS NULL
    OR d.spreadsheet_file_id=p_source_file_id OR d.privacy_verified_at IS NULL THEN
    RAISE EXCEPTION 'Choose a disabled, restricted, separate class destination.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_class_workbooks w
    WHERE w.organization_id=p_organization_id AND w.cohort_id=d.cohort_id
      AND w.drive_file_id=p_source_file_id AND w.state='linked') THEN
    RAISE EXCEPTION 'The original class workbook is not linked to this cohort.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO a FROM plugin_data.csf_sheet_sync_acceptances
    WHERE organization_id=p_organization_id AND destination_id=d.id AND id=p_acceptance_id
      AND reviewed_by IS NOT NULL;
  IF NOT FOUND OR a.configuration->>'file' IS DISTINCT FROM d.spreadsheet_file_id
    OR (a.configuration->>'sheet')::integer IS DISTINCT FROM d.sheet_id
    OR a.configuration->>'term' IS DISTINCT FROM d.term_id::text
    OR a.configuration->>'cohort' IS DISTINCT FROM d.cohort_id::text
    OR a.configuration->>'kind' IS DISTINCT FROM 'class' THEN
    RAISE EXCEPTION 'The copied-workbook acceptance does not match this destination.' USING ERRCODE='22023';
  END IF;
  IF p_layout IS NULL OR jsonb_typeof(p_layout) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_layout->'expectedHeaders') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_layout->'expectedHeaders')<3
    OR jsonb_typeof(p_layout->'activityColumns') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_layout->'meetingColumns') IS DISTINCT FROM 'array'
    OR nullif(btrim(p_layout->>'sheetTitle'),'') IS NULL
    OR (p_layout->>'headerRowIndex') IS NULL
    OR (p_layout->>'firstDataRowIndex') IS NULL
    OR (p_layout->>'lastDataRowIndex') IS NULL
    OR (p_layout->>'firstWritableColumn') IS NULL
    OR (p_layout->>'lastWritableColumn') IS NULL
    OR (p_layout->>'sourceKeyColumn') IS NULL
    OR (p_layout->>'firstNameColumn') IS NULL
    OR (p_layout->>'lastNameColumn') IS NULL
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 4 AND 500 THEN
    RAISE EXCEPTION 'Record the reviewed semester columns and reason.' USING ERRCODE='22023';
  END IF;
  IF (p_layout->>'firstWritableColumn')::integer <= GREATEST(
      (p_layout->>'firstNameColumn')::integer,
      (p_layout->>'lastNameColumn')::integer,
      (p_layout->>'sourceKeyColumn')::integer)
    OR (p_layout->>'lastWritableColumn')::integer < (p_layout->>'firstWritableColumn')::integer
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(
      (p_layout->'activityColumns') ||
      (SELECT coalesce(jsonb_agg(value->'columnIndex'),'[]'::jsonb)
       FROM jsonb_array_elements(p_layout->'meetingColumns') AS meeting(value))
    ) AS column_value(value)
      WHERE column_value.value::integer NOT BETWEEN
        (p_layout->>'firstWritableColumn')::integer AND (p_layout->>'lastWritableColumn')::integer) THEN
    RAISE EXCEPTION 'Ledger columns must stay outside the student identity cells.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO m FROM plugin_data.csf_sheet_semester_ledger_mappings
    WHERE destination_id=d.id FOR UPDATE;
  IF FOUND THEN
    IF m.source_file_id IS DISTINCT FROM p_source_file_id OR m.layout IS DISTINCT FROM p_layout
      OR m.acceptance_id IS DISTINCT FROM p_acceptance_id THEN
      RAISE EXCEPTION 'This destination already has a different accepted ledger mapping.' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(m);
  END IF;
  INSERT INTO plugin_data.csf_sheet_semester_ledger_mappings
    (organization_id,destination_id,source_file_id,cohort_id,term_id,acceptance_id,layout,accepted_by)
    VALUES(p_organization_id,d.id,p_source_file_id,d.cohort_id,d.term_id,p_acceptance_id,p_layout,p_actor_user_id)
    RETURNING * INTO m;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,after_data)
    VALUES(p_organization_id,p_actor_user_id,'sheet_sync.semester_mapping_accepted',
      'sheet_semester_ledger_mapping',m.id,jsonb_build_object('source_file_id',p_source_file_id,
        'destination_id',d.id,'term_id',d.term_id,'layout',p_layout,'reason',p_reason));
  RETURN to_jsonb(m);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_accept_sheet_semester_ledger_mapping(uuid,uuid,uuid,text,uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_accept_sheet_semester_ledger_mapping(uuid,uuid,uuid,text,uuid,jsonb,text)
  TO service_role;

CREATE FUNCTION plugin_data.csf_claim_sheet_semester_ledger_write(
  p_organization_id uuid,p_actor_user_id uuid,p_mapping_id uuid,p_source_link_id uuid,
  p_profile_id uuid,p_source_version text,p_preview_digest text,p_plan jsonb,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m plugin_data.csf_sheet_semester_ledger_mappings%ROWTYPE;
  d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
  w plugin_data.csf_sheet_semester_ledger_writes%ROWTYPE;
  snapshot jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync')
    AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO m FROM plugin_data.csf_sheet_semester_ledger_mappings
    WHERE organization_id=p_organization_id AND id=p_mapping_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accepted ledger mapping not found.' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations
    WHERE organization_id=p_organization_id AND id=m.destination_id FOR NO KEY UPDATE;
  IF NOT FOUND OR d.enabled OR d.kind<>'class' OR d.cohort_id IS DISTINCT FROM m.cohort_id
    OR d.term_id IS DISTINCT FROM m.term_id OR d.spreadsheet_file_id=m.source_file_id
    OR d.privacy_verified_at IS NULL THEN
    RAISE EXCEPTION 'The accepted destination mapping changed.' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links l
    WHERE l.id=p_source_link_id AND l.organization_id=p_organization_id
      AND l.cohort_id=m.cohort_id AND l.source_file_id=m.source_file_id
      AND l.profile_id=p_profile_id AND l.revoked_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships c
      WHERE c.organization_id=p_organization_id AND c.cohort_id=m.cohort_id
        AND c.profile_id=p_profile_id AND c.status='active') THEN
    RAISE EXCEPTION 'The reviewed roster link or cohort membership changed.' USING ERRCODE='55000';
  END IF;
  snapshot:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,d.id,'profile',p_profile_id);
  IF snapshot IS NULL OR md5(snapshot::text) IS DISTINCT FROM p_source_version THEN
    RAISE EXCEPTION 'The profile source version changed. Preview again.' USING ERRCODE='55000';
  END IF;
  IF p_request_id IS NULL OR coalesce(p_preview_digest !~ '^[a-f0-9]{64}$',true)
    OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_plan->'changes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'changes')<1
    OR (p_plan->>'rowIndex')::integer <= (m.layout->>'headerRowIndex')::integer THEN
    RAISE EXCEPTION 'A reviewed, nonempty cell plan is required.' USING ERRCODE='22023';
  END IF;
  IF (p_plan->>'rowIndex')::integer < (m.layout->>'firstDataRowIndex')::integer
    OR (p_plan->>'rowIndex')::integer > (m.layout->>'lastDataRowIndex')::integer
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan->'changes') AS cell(value)
      WHERE (cell.value->>'rowIndex')::integer IS DISTINCT FROM (p_plan->>'rowIndex')::integer
        OR (cell.value->>'columnIndex')::integer NOT BETWEEN
          (m.layout->>'firstWritableColumn')::integer AND (m.layout->>'lastWritableColumn')::integer
        OR NOT (
          m.layout->'activityColumns' @> jsonb_build_array((cell.value->>'columnIndex')::integer)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(m.layout->'meetingColumns') AS meeting(value)
            WHERE (meeting.value->>'columnIndex')::integer=(cell.value->>'columnIndex')::integer))
        OR coalesce(cell.value->>'expectedValue','')<>''
        OR nullif(btrim(cell.value->>'value'),'') IS NULL
        OR nullif(btrim(cell.value->>'evidenceId'),'') IS NULL) THEN
    RAISE EXCEPTION 'The cell plan exceeds its reviewed row or column mapping.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO w FROM plugin_data.csf_sheet_semester_ledger_writes
    WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF w.organization_id IS DISTINCT FROM p_organization_id OR w.mapping_id IS DISTINCT FROM m.id
      OR w.profile_id IS DISTINCT FROM p_profile_id OR w.preview_digest IS DISTINCT FROM p_preview_digest
      OR w.plan IS DISTINCT FROM p_plan OR w.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'This write request conflicts with its original plan.' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(w)||jsonb_build_object('claimed_now',false);
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes old
    WHERE old.destination_id=d.id AND old.profile_id=p_profile_id
      AND old.status IN ('claimed','unknown_outcome')) THEN
    RAISE EXCEPTION 'Reconcile the previous semester Sheet attempt first.' USING ERRCODE='55000';
  END IF;
  INSERT INTO plugin_data.csf_sheet_semester_ledger_writes
    (request_id,organization_id,mapping_id,destination_id,source_link_id,profile_id,
      actor_user_id,source_version,preview_digest,plan)
    VALUES(p_request_id,p_organization_id,m.id,d.id,p_source_link_id,p_profile_id,
      p_actor_user_id,p_source_version,p_preview_digest,p_plan)
    RETURNING * INTO w;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,after_data)
    VALUES(p_organization_id,p_actor_user_id,'sheet_sync.semester_write_claimed',
      'sheet_semester_ledger_write',w.request_id,
      jsonb_build_object('destination_id',d.id,'profile_id',p_profile_id,
        'source_version',p_source_version,'preview_digest',p_preview_digest));
  RETURN to_jsonb(w)||jsonb_build_object('claimed_now',true);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)
  TO service_role;

CREATE FUNCTION plugin_data.csf_sheet_semester_ledger_source_version(
  p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_profile_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb;
BEGIN
  IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync')
    AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE='42501';
  END IF;
  snapshot:=plugin_data.csf_sheet_sync_destination_snapshot(
    p_organization_id,p_destination_id,'profile',p_profile_id);
  IF snapshot IS NULL OR coalesce((snapshot->>'out_of_scope')::boolean,false) THEN
    RAISE EXCEPTION 'Profile is outside this class and semester.' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('snapshot',snapshot,'version',md5(snapshot::text));
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_semester_ledger_source_version(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_semester_ledger_source_version(uuid,uuid,uuid,uuid)
  TO service_role;

CREATE FUNCTION plugin_data.csf_finish_sheet_semester_ledger_write(
  p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_status text,p_readback_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w plugin_data.csf_sheet_semester_ledger_writes%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  SELECT * INTO w FROM plugin_data.csf_sheet_semester_ledger_writes
    WHERE organization_id=p_organization_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR w.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Semester write attempt not found.' USING ERRCODE='22023';
  END IF;
  IF w.status<>'claimed' THEN
    IF w.status IS DISTINCT FROM p_status OR w.readback_digest IS DISTINCT FROM p_readback_digest THEN
      RAISE EXCEPTION 'This completed write has a different outcome.' USING ERRCODE='23505';
    END IF;
    RETURN to_jsonb(w);
  END IF;
  IF p_status NOT IN ('applied','unknown_outcome','aborted')
    OR (p_status='applied' AND p_readback_digest !~ '^[a-f0-9]{64}$')
    OR (p_status<>'applied' AND p_readback_digest IS NOT NULL) THEN
    RAISE EXCEPTION 'Record a valid provider readback outcome.' USING ERRCODE='22023';
  END IF;
  IF p_status='applied' AND (w.lease_expires_at<=clock_timestamp()
    OR NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync')
      AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports'))) THEN
    RAISE EXCEPTION 'The write lease or officer access expired.' USING ERRCODE='55000';
  END IF;
  UPDATE plugin_data.csf_sheet_semester_ledger_writes SET status=p_status,
    readback_digest=p_readback_digest,finished_at=now()
    WHERE request_id=p_request_id RETURNING * INTO w;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,after_data)
    VALUES(p_organization_id,p_actor_user_id,'sheet_sync.semester_write_'||p_status,
      'sheet_semester_ledger_write',w.request_id,
      jsonb_build_object('destination_id',w.destination_id,'profile_id',w.profile_id,
        'readback_digest',p_readback_digest));
  RETURN to_jsonb(w);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_sheet_semester_ledger_write(uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_sheet_semester_ledger_write(uuid,uuid,uuid,text,text)
  TO service_role;

COMMIT;
