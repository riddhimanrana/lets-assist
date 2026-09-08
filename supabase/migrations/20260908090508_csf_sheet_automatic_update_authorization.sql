-- Record explicit source-scoped authority before background import updates.
BEGIN;
CREATE TABLE plugin_data.csf_sheet_automatic_update_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  source_id uuid NOT NULL,
  source_file_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('class_history','application_responses')),
  authorized_by uuid NOT NULL REFERENCES auth.users(id),
  google_owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  mapping_version integer NOT NULL CHECK (mapping_version>0),
  mapping_hash text NOT NULL CHECK (mapping_hash ~ '^[a-f0-9]{64}$'),
  reviewed_preview_job_id uuid NOT NULL,
  approved_header_signature text NOT NULL CHECK (approved_header_signature ~ '^[a-f0-9]{64}$'),
  read_scope text NOT NULL DEFAULT 'mapped_columns_all_rows' CHECK (read_scope='mapped_columns_all_rows'),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation>0),
  status text NOT NULL CHECK (status IN ('active','paused','blocked','needs_reconnect')),
  next_check_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_provider_version text,
  last_preview_job_id uuid,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_id),
  FOREIGN KEY (organization_id,source_id) REFERENCES plugin_data.csf_sheet_sources(organization_id,id),
  FOREIGN KEY (organization_id,last_preview_job_id) REFERENCES plugin_data.csf_sheet_import_jobs(organization_id,id),
  FOREIGN KEY (organization_id,reviewed_preview_job_id) REFERENCES plugin_data.csf_sheet_import_jobs(organization_id,id),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX csf_sheet_automatic_updates_due ON plugin_data.csf_sheet_automatic_update_authorizations(next_check_at,id)
  WHERE status='active';
ALTER TABLE plugin_data.csf_sheet_automatic_update_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_automatic_update_authorizations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_automatic_update_authorizations TO service_role;
CREATE UNIQUE INDEX csf_sheet_automatic_update_request_receipt
  ON plugin_data.csf_admin_audit_events(organization_id,(after_data->>'requestId'))
  WHERE action='sheets.automatic_update_authorization_changed';

CREATE TABLE plugin_data.csf_automatic_import_approvals (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  preview_job_id uuid NOT NULL,
  authorization_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_automatic_update_authorizations(id),
  authorization_generation bigint NOT NULL CHECK (authorization_generation>0),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^[a-f0-9]{64}$'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 25000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,preview_job_id),
  FOREIGN KEY (organization_id,preview_job_id) REFERENCES plugin_data.csf_sheet_import_jobs(organization_id,id)
);
CREATE TABLE plugin_data.csf_automatic_import_approval_rows (
  organization_id uuid NOT NULL,
  preview_job_id uuid NOT NULL,
  import_row_id uuid NOT NULL,
  source_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  term_id uuid NOT NULL,
  target_profile_id uuid,
  row_hash text NOT NULL CHECK (row_hash ~ '^[a-f0-9]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (organization_id,preview_job_id,import_row_id),
  FOREIGN KEY (organization_id,preview_job_id) REFERENCES plugin_data.csf_automatic_import_approvals(organization_id,preview_job_id),
  FOREIGN KEY (organization_id,import_row_id) REFERENCES plugin_data.csf_sheet_import_rows(organization_id,id)
);
ALTER TABLE plugin_data.csf_automatic_import_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_automatic_import_approval_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_automatic_import_approvals,plugin_data.csf_automatic_import_approval_rows
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION plugin_data.csf_automatic_import_scope_current(p_organization_id uuid,p_preview_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM plugin_data.csf_automatic_import_approvals approval
    JOIN plugin_data.csf_sheet_automatic_update_authorizations source_authority
      ON source_authority.organization_id=approval.organization_id AND source_authority.id=approval.authorization_id
    JOIN plugin_data.csf_sheet_import_jobs preview
      ON preview.organization_id=approval.organization_id AND preview.id=approval.preview_job_id
    WHERE approval.organization_id=p_organization_id AND approval.preview_job_id=p_preview_job_id
      AND source_authority.status='active' AND source_authority.generation=approval.authorization_generation
      AND source_authority.authorized_by=approval.actor_user_id AND source_authority.source_id=preview.source_id
      AND approval.source_content_hash=preview.source_content_hash AND approval.snapshot_hash=preview.snapshot_hash
      AND approval.row_count=(SELECT count(*) FROM plugin_data.csf_automatic_import_approval_rows selected
        WHERE selected.organization_id=p_organization_id AND selected.preview_job_id=p_preview_job_id)
      AND NOT EXISTS (
        SELECT 1 FROM plugin_data.csf_sheet_import_rows current_row
        LEFT JOIN plugin_data.csf_automatic_import_approval_rows selected
          ON selected.organization_id=current_row.organization_id AND selected.preview_job_id=current_row.job_id
          AND selected.import_row_id=current_row.id
        WHERE current_row.organization_id=p_organization_id AND current_row.job_id=p_preview_job_id
          AND current_row.import_status='pending'
          AND (selected.import_row_id IS NULL OR selected.source_id IS DISTINCT FROM current_row.source_id
            OR selected.cohort_id IS DISTINCT FROM current_row.cohort_id
            OR selected.term_id IS DISTINCT FROM current_row.term_id
            OR selected.target_profile_id IS DISTINCT FROM current_row.matched_profile_id
            OR selected.row_hash IS DISTINCT FROM current_row.row_hash
            OR selected.payload_hash IS DISTINCT FROM encode(sha256(convert_to((current_row.normalized_data->'commitPayload')::text,'UTF8')),'hex'))
      )
  );
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_automatic_import_scope_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_automatic_import_scope_current(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_sheet_automatic_update_mapping_hash(p_source_id uuid,p_organization_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT encode(extensions.digest(jsonb_build_object(
    'sourceType',s.source_type,'provider',s.provider,'file',s.spreadsheet_id,
    'cohort',s.cohort_id,'target',s.target_strategy,'tabs',s.tab_mappings,
    'columns',s.column_mappings,'duplicatePolicy',s.duplicate_policy,
    'mappingVersion',s.settings->>'mappingVersion','googleOwner',s.sync_owner_user_id)::text,'sha256'),'hex')
  FROM plugin_data.csf_sheet_sources s WHERE s.organization_id=p_organization_id AND s.id=p_source_id;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_automatic_update_mapping_hash(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_automatic_update_mapping_hash(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(
  p_organization_id uuid,p_source_id uuid,p_actor_user_id uuid,
  p_expected_mapping_version integer,p_mode text,p_request_id uuid,p_reviewed_preview_job_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_intent jsonb;
  v_authority jsonb;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('enable','pause') THEN
    RAISE EXCEPTION 'Choose enable or pause with a request identifier.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  v_authority := plugin_data.csf_assert_import_actor_for_source(p_organization_id,p_actor_user_id,p_source_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_source_auto:'||p_organization_id::text||':'||p_source_id::text,0));
  v_intent := jsonb_build_object('sourceId',p_source_id,'actorId',p_actor_user_id,
    'mappingVersion',p_expected_mapping_version,'mode',p_mode,'requestId',p_request_id,
    'reviewedPreviewJobId',p_reviewed_preview_job_id,'readScope','mapped_columns_all_rows');
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
    WHERE organization_id=p_organization_id AND action='sheets.automatic_update_authorization_changed'
      AND after_data->>'requestId'=p_request_id::text;
  IF FOUND THEN
    IF v_receipt.after_data->'intent' IS DISTINCT FROM v_intent THEN
      RAISE EXCEPTION 'This request belongs to another source authorization.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO STRICT v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
      WHERE organization_id=p_organization_id AND id=v_receipt.target_id;
    RETURN jsonb_build_object('authorizationId',v_auth.id,'status',v_auth.status,'generation',v_auth.generation,'replayed',true);
  END IF;

  SELECT * INTO v_source FROM plugin_data.csf_sheet_sources
    WHERE organization_id=p_organization_id AND id=p_source_id FOR UPDATE;
  IF NOT FOUND OR (p_mode='enable' AND (v_source.provider IS DISTINCT FROM 'google_sheets'
    OR v_source.source_type NOT IN ('class_history','application_responses')
    OR nullif(btrim(v_source.spreadsheet_id),'') IS NULL)) THEN
    RAISE EXCEPTION 'Choose a linked class or chapter application Sheet.' USING ERRCODE='22023';
  END IF;
  IF p_mode='pause' THEN
    UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET status='paused',generation=generation+1,lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE organization_id=p_organization_id AND source_id=p_source_id RETURNING * INTO v_auth;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Automatic updates have not been enabled for this Sheet.' USING ERRCODE='22023';
    END IF;
  ELSE
  IF v_source.sync_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Reconnect the Google owner before enabling updates.' USING ERRCODE='22023';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id,v_source.sync_owner_user_id,v_source.source_type);
  IF p_expected_mapping_version IS NULL OR p_expected_mapping_version<1
    OR v_source.settings->>'mappingVersion' IS DISTINCT FROM p_expected_mapping_version::text THEN
    RAISE EXCEPTION 'The Sheet mapping changed. Review it before enabling updates.' USING ERRCODE='40001';
  END IF;
  IF p_mode='enable' AND (v_source.sync_mode='disabled'
    OR jsonb_typeof(v_source.tab_mappings) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_source.tab_mappings) NOT BETWEEN 1 AND 64
    OR (v_source.source_type='application_responses' AND (v_source.cohort_id IS NOT NULL
      OR v_source.target_strategy IS DISTINCT FROM 'derive_from_grade'))) THEN
    RAISE EXCEPTION 'Review this source mapping before enabling updates.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_preview FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=p_reviewed_preview_job_id AND source_id=p_source_id
      AND mode='preview' AND status IN ('completed','needs_resolution')
      AND source_type=v_source.source_type AND source_file_id=v_source.spreadsheet_id
      AND mapping_version=p_expected_mapping_version
      AND jsonb_typeof(mapping_snapshot->'headerSignature')='string'
      AND mapping_snapshot->>'headerSignature' ~ '^[a-f0-9]{64}$';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review a current preview before enabling automatic updates.' USING ERRCODE='22023';
  END IF;
  INSERT INTO plugin_data.csf_sheet_automatic_update_authorizations
    (organization_id,source_id,source_file_id,source_type,authorized_by,google_owner_user_id,mapping_version,mapping_hash,
      reviewed_preview_job_id,approved_header_signature,status)
  VALUES (p_organization_id,p_source_id,v_source.spreadsheet_id,v_source.source_type,p_actor_user_id,
    v_source.sync_owner_user_id,p_expected_mapping_version,plugin_data.csf_sheet_automatic_update_mapping_hash(p_source_id,p_organization_id),
    v_preview.id,v_preview.mapping_snapshot->>'headerSignature',CASE WHEN p_mode='enable' THEN 'active' ELSE 'paused' END)
  ON CONFLICT (organization_id,source_id) DO UPDATE SET
    source_file_id=excluded.source_file_id,source_type=excluded.source_type,authorized_by=excluded.authorized_by,
    google_owner_user_id=excluded.google_owner_user_id,
    mapping_version=excluded.mapping_version,mapping_hash=excluded.mapping_hash,status=excluded.status,
    reviewed_preview_job_id=excluded.reviewed_preview_job_id,approved_header_signature=excluded.approved_header_signature,
    generation=csf_sheet_automatic_update_authorizations.generation+1,
    next_check_at=now(),lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
    last_provider_version=NULL,last_preview_job_id=NULL,updated_at=now()
  RETURNING * INTO v_auth;
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,source_type,source_id,after_data)
  VALUES (p_organization_id,p_actor_user_id,'sheets.automatic_update_authorization_changed',
    'csf_sheet_automatic_update_authorizations',v_auth.id,v_source.source_type,p_source_id::text,
    jsonb_build_object('requestId',p_request_id,'intent',v_intent,'status',v_auth.status,
      'generation',v_auth.generation,'authority',v_authority,'mappingHash',v_auth.mapping_hash));
  RETURN jsonb_build_object('authorizationId',v_auth.id,'status',v_auth.status,'generation',v_auth.generation,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(
  p_organization_id uuid,p_authorization_id uuid
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND id=p_authorization_id AND status='active';
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_sheet_sources s
    WHERE s.organization_id=p_organization_id AND s.id=v_auth.source_id
      AND s.provider='google_sheets' AND s.source_type=v_auth.source_type
      AND s.spreadsheet_id=v_auth.source_file_id AND s.sync_mode IS DISTINCT FROM 'disabled'
      AND s.sync_owner_user_id=v_auth.google_owner_user_id
      AND s.settings->>'mappingVersion'=v_auth.mapping_version::text
      AND plugin_data.csf_sheet_automatic_update_mapping_hash(s.id,s.organization_id)=v_auth.mapping_hash) THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(p_organization_id,v_auth.authorized_by,v_auth.source_type);
    PERFORM plugin_data.csf_assert_import_actor(p_organization_id,v_auth.google_owner_user_id,v_auth.source_type);
  EXCEPTION WHEN SQLSTATE '42501' THEN RETURN false;
  END;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_claim_sheet_automatic_update_check(p_source_type text DEFAULT 'application_responses')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_candidate record;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  IF p_source_type IS NULL OR p_source_type NOT IN ('application_responses','class_history') THEN
    RAISE EXCEPTION 'Choose a supported Sheet source type.' USING ERRCODE='22023';
  END IF;
  FOR v_candidate IN SELECT id,organization_id,source_id
    FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE status='active' AND source_type=p_source_type AND next_check_at<=now()
      AND (lease_expires_at IS NULL OR lease_expires_at<=now())
    ORDER BY next_check_at,id LIMIT 16
  LOOP
    IF NOT pg_try_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(v_candidate.organization_id)) THEN CONTINUE; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('csf_source_auto:'||v_candidate.organization_id::text||':'||v_candidate.source_id::text,0)) THEN CONTINUE; END IF;
    SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
      WHERE id=v_candidate.id AND status='active' AND source_type=p_source_type AND next_check_at<=now()
        AND (lease_expires_at IS NULL OR lease_expires_at<=now()) FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT plugin_data.csf_sheet_automatic_update_authorization_current(v_auth.organization_id,v_auth.id) THEN
      UPDATE plugin_data.csf_sheet_automatic_update_authorizations
      SET status='blocked',last_error_code='authorization_changed',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE id=v_auth.id;
      CONTINUE;
    END IF;
    UPDATE plugin_data.csf_sheet_automatic_update_authorizations
      SET lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',updated_at=now()
      WHERE id=v_auth.id RETURNING * INTO v_auth;
    RETURN jsonb_build_object('claimed',true,'authorizationId',v_auth.id,'organizationId',v_auth.organization_id,
      'sourceId',v_auth.source_id,'sourceFileId',v_auth.source_file_id,'sourceType',v_auth.source_type,
      'actorUserId',v_auth.authorized_by,'googleOwnerUserId',v_auth.google_owner_user_id,
      'generation',v_auth.generation,'mappingVersion',v_auth.mapping_version,'leaseToken',v_auth.lease_token,
      'lastProviderVersion',v_auth.last_provider_version,'lastPreviewJobId',v_auth.last_preview_job_id);
  END LOOP;
  RETURN jsonb_build_object('claimed',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_automatic_update_check(text) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_automatic_update_check(text) TO service_role;

CREATE FUNCTION plugin_data.csf_assert_sheet_automatic_update_lease(
  p_organization_id uuid,p_authorization_id uuid,p_generation bigint,p_lease_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND id=p_authorization_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid',false); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_source_auto:'||p_organization_id::text||':'||v_auth.source_id::text,0));
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND id=p_authorization_id AND generation=p_generation
      AND lease_token=p_lease_token AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND OR NOT plugin_data.csf_sheet_automatic_update_authorization_current(p_organization_id,p_authorization_id) THEN
    RETURN jsonb_build_object('valid',false);
  END IF;
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET lease_expires_at=now()+interval '5 minutes',updated_at=now() WHERE id=v_auth.id;
  RETURN jsonb_build_object('valid',true,'sourceId',v_auth.source_id,'sourceFileId',v_auth.source_file_id,
    'sourceType',v_auth.source_type,'actorUserId',v_auth.authorized_by,'googleOwnerUserId',v_auth.google_owner_user_id,
    'mappingVersion',v_auth.mapping_version,'approvedHeaderSignature',v_auth.approved_header_signature);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_sheet_automatic_update_lease(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_sheet_automatic_update_lease(uuid,uuid,bigint,uuid) TO service_role;

CREATE FUNCTION plugin_data.csf_finish_sheet_automatic_update_check(
  p_organization_id uuid,p_authorization_id uuid,p_generation bigint,p_lease_token uuid,
  p_outcome text,p_provider_version text,p_preview_job_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_lease jsonb;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('unchanged','prepared','needs_reconnect','blocked','retryable')
    OR (p_provider_version IS NOT NULL AND p_provider_version !~ '^[1-9][0-9]{0,18}$')
    OR (length(p_provider_version)=19 AND p_provider_version COLLATE "C">'9223372036854775807')
    OR (p_outcome IN ('unchanged','prepared') AND p_provider_version IS NULL)
    OR (p_outcome='prepared' AND p_preview_job_id IS NULL)
    OR (p_outcome<>'prepared' AND p_preview_job_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid automatic-update result.' USING ERRCODE='22023';
  END IF;
  v_lease := plugin_data.csf_assert_sheet_automatic_update_lease(p_organization_id,p_authorization_id,p_generation,p_lease_token);
  IF v_lease->>'valid' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('finished',false); END IF;
  IF p_preview_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_jobs j WHERE j.organization_id=p_organization_id AND j.id=p_preview_job_id
      AND j.source_id=(v_lease->>'sourceId')::uuid AND j.source_file_id=v_lease->>'sourceFileId'
      AND j.source_type=v_lease->>'sourceType' AND j.mode='preview' AND j.status IN ('completed','needs_resolution')
      AND j.mapping_version=(v_lease->>'mappingVersion')::integer
      AND j.source_file_metadata->>'version'=p_provider_version
      AND jsonb_typeof(j.source_file_metadata->'version')='string'
      AND j.mapping_snapshot->>'automaticUpdateAuthorizationId'=p_authorization_id::text
      AND j.mapping_snapshot->>'automaticUpdateGeneration'=p_generation::text
      AND jsonb_typeof(j.mapping_snapshot->'automaticUpdateGeneration')='number'
      AND j.mapping_snapshot->>'automaticUpdateReadScope'='mapped_columns_all_rows'
      AND j.mapping_snapshot->>'headerSignature'=v_lease->>'approvedHeaderSignature'
      AND j.mapping_snapshot->>'automaticUpdateProviderVersion'=p_provider_version
  ) THEN RAISE EXCEPTION 'The prepared preview does not belong to this source.' USING ERRCODE='22023'; END IF;
  IF p_outcome='unchanged' AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_automatic_update_authorizations a
    JOIN plugin_data.csf_sheet_import_jobs j ON j.organization_id=a.organization_id AND j.id=a.last_preview_job_id
    WHERE a.organization_id=p_organization_id AND a.id=p_authorization_id
      AND a.last_provider_version=p_provider_version AND j.source_id=a.source_id
      AND j.mode='preview' AND j.status IN ('completed','needs_resolution')
      AND j.mapping_version=a.mapping_version AND j.source_file_metadata->>'version'=p_provider_version
      AND j.mapping_snapshot->>'automaticUpdateAuthorizationId'=a.id::text
      AND j.mapping_snapshot->>'automaticUpdateGeneration'=a.generation::text
  ) THEN RAISE EXCEPTION 'Prepare this source revision before marking it unchanged.' USING ERRCODE='22023'; END IF;
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET status=CASE WHEN p_outcome IN ('needs_reconnect','blocked') THEN p_outcome ELSE 'active' END,
      last_provider_version=CASE WHEN p_outcome IN ('unchanged','prepared') THEN p_provider_version ELSE last_provider_version END,
      last_preview_job_id=coalesce(p_preview_job_id,last_preview_job_id),
      last_error_code=CASE WHEN p_outcome IN ('unchanged','prepared') THEN NULL ELSE p_outcome END,
      next_check_at=now()+interval '5 minutes',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE organization_id=p_organization_id AND id=p_authorization_id;
  RETURN jsonb_build_object('finished',true,'outcome',p_outcome);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_sheet_automatic_update_check(uuid,uuid,bigint,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_sheet_automatic_update_check(uuid,uuid,bigint,uuid,text,text,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_assert_automatic_sheet_preview_current(
  p_organization_id uuid,p_preview_job_id uuid,p_actor_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_mapping jsonb;
BEGIN
  SELECT * INTO v_preview FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=p_preview_job_id AND mode='preview';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This import preview is no longer available.' USING ERRCODE='23503';
  END IF;
  v_mapping := coalesce(v_preview.mapping_snapshot,'{}'::jsonb);
  IF NOT v_mapping ?| ARRAY['automaticUpdateAuthorizationId','automaticUpdateGeneration',
    'automaticUpdateProviderVersion','automaticUpdateReadScope'] THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_source_auto:'||p_organization_id::text||':'||v_preview.source_id::text,0));
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND source_id=v_preview.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automatic updates changed. Review this Sheet before importing.' USING ERRCODE='55000';
  END IF;
  IF plugin_data.csf_sheet_automatic_update_authorization_current(p_organization_id,v_auth.id) IS DISTINCT FROM true
    OR v_auth.authorized_by IS DISTINCT FROM p_actor_user_id
    OR v_preview.initiated_by IS DISTINCT FROM (CASE WHEN v_auth.source_type='class_history'
      THEN v_auth.google_owner_user_id ELSE v_auth.authorized_by END)
    OR (v_auth.source_type='class_history' AND NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_class_workbooks w
      JOIN plugin_data.csf_class_workbook_refresh_jobs j ON j.organization_id=w.organization_id AND j.workbook_id=w.id
      JOIN plugin_data.csf_sheet_sources s ON s.organization_id=w.organization_id AND s.cohort_id=w.cohort_id
      WHERE w.organization_id=p_organization_id AND s.id=v_preview.source_id
        AND w.id::text=v_mapping->>'workbookId' AND j.id::text=v_mapping->>'workbookRefreshJobId'
        AND w.drive_owner_user_id=v_auth.google_owner_user_id AND j.claimed_owner_user_id=v_auth.google_owner_user_id
        AND w.drive_file_id=v_auth.source_file_id AND j.drive_file_id=v_auth.source_file_id
        AND w.provider_version=v_auth.last_provider_version AND w.last_prepared_version=v_auth.last_provider_version
        AND j.provider_version=v_auth.last_provider_version AND w.state='linked' AND j.status='completed'
        AND v_mapping->>'workbookProviderVersion'=v_auth.last_provider_version
        AND v_mapping->>'workbookDriveFileId'=v_auth.source_file_id
        AND s.settings->>'workbookId'=w.id::text AND s.settings->>'workbookRefreshJobId'=j.id::text
        AND s.settings->>'workbookProviderVersion'=j.provider_version
        AND s.settings->>'workbookDriveFileId'=w.drive_file_id
    ))
    OR v_preview.status NOT IN ('completed','needs_resolution')
    OR v_preview.source_type IS DISTINCT FROM v_auth.source_type
    OR v_preview.source_file_id IS DISTINCT FROM v_auth.source_file_id
    OR v_preview.mapping_version IS DISTINCT FROM v_auth.mapping_version
    OR v_auth.last_preview_job_id IS DISTINCT FROM p_preview_job_id
    OR v_auth.last_provider_version IS NULL
    OR jsonb_typeof(v_mapping->'automaticUpdateAuthorizationId') IS DISTINCT FROM 'string'
    OR v_mapping->>'automaticUpdateAuthorizationId' IS DISTINCT FROM v_auth.id::text
    OR jsonb_typeof(v_mapping->'automaticUpdateGeneration') IS DISTINCT FROM 'number'
    OR v_mapping->>'automaticUpdateGeneration' IS DISTINCT FROM v_auth.generation::text
    OR jsonb_typeof(v_mapping->'automaticUpdateProviderVersion') IS DISTINCT FROM 'string'
    OR v_mapping->>'automaticUpdateProviderVersion' IS DISTINCT FROM v_auth.last_provider_version
    OR jsonb_typeof(v_preview.source_file_metadata->'version') IS DISTINCT FROM 'string'
    OR v_preview.source_file_metadata->>'version' IS DISTINCT FROM v_auth.last_provider_version
    OR v_mapping->>'automaticUpdateReadScope' IS DISTINCT FROM v_auth.read_scope
    OR v_mapping->>'headerSignature' IS DISTINCT FROM v_auth.approved_header_signature
  THEN
    RAISE EXCEPTION 'Automatic updates changed. Review this Sheet before importing.' USING ERRCODE='55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_automatic_sheet_preview_current(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_automatic_sheet_preview_current(uuid,uuid,uuid) TO postgres;
COMMENT ON FUNCTION plugin_data.csf_assert_automatic_sheet_preview_current(uuid,uuid,uuid) IS
  'Owner-only automatic-source consent check. Holds staff and source authorization locks through each claim or row write. Manual previews retain their existing approval checks.';
CREATE OR REPLACE FUNCTION plugin_data.csf_claim_import_commit_attempt(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_ids uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(
    p_organization_id, p_preview_job_id, p_actor_user_id
  );
  PERFORM plugin_data.csf_assert_automatic_import_scope(p_organization_id,p_preview_job_id);

  -- Enter the established import coordinate before the mapping helper locks the
  -- source. Finalize takes this same coordinate and locks the source last, so an
  -- expired-lease takeover cannot hold source-share while waiting on finalize.
  -- The preserved claim body enters the same transaction-scoped coordinate
  -- again after the identity locks; that repeat is reentrant.
  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, p_preview_job_id, true
  );
  PERFORM plugin_data.csf_assert_import_preview_workbook_generation_current(
    p_organization_id, p_preview_job_id
  );
  PERFORM plugin_data.csf_assert_import_preview_mapping_current(
    p_organization_id, p_preview_job_id
  );
  SELECT coalesce(
    pg_catalog.array_agg(
      DISTINCT import_row.matched_profile_id
      ORDER BY import_row.matched_profile_id
    ) FILTER (WHERE import_row.matched_profile_id IS NOT NULL),
    ARRAY[]::uuid[]
  )
  INTO v_profile_ids
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id
    AND import_row.import_status = 'pending';
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, v_profile_ids
  );
  RETURN plugin_data.csf_claim_import_commit_attempt_identity_base(
    p_organization_id, p_preview_job_id, p_actor_user_id, p_lease_seconds,
    p_evidence_token
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_attempt(uuid,uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_attempt(uuid,uuid,uuid,integer,uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_preview_job_id uuid;
  v_target_profile_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT
    coalesce(
      nullif(attempt.actor_snapshot->>'claimedBy', '')::uuid,
      attempt.actor_user_id
    ),
    commit_job.preview_job_id,
    import_row.commit_target_profile_id
  INTO v_actor_user_id, v_preview_job_id, v_target_profile_id
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  JOIN plugin_data.csf_sheet_import_jobs AS commit_job
    ON commit_job.organization_id = attempt.organization_id
   AND commit_job.id = attempt.commit_job_id
  JOIN plugin_data.csf_sheet_import_rows AS import_row
    ON import_row.organization_id = attempt.organization_id
   AND import_row.job_id = commit_job.preview_job_id
   AND import_row.id = p_import_row_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, v_actor_user_id, v_preview_job_id
  );
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(
    p_organization_id, v_preview_job_id, v_actor_user_id
  );
  PERFORM plugin_data.csf_assert_automatic_import_scope(p_organization_id,v_preview_job_id);
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[v_target_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_begin_import_row_for_attempt_identity_base(
    p_organization_id, p_attempt_id, p_import_row_id
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_preview_job_id uuid;
  v_target_profile_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT
    coalesce(
      nullif(attempt.actor_snapshot->>'claimedBy', '')::uuid,
      attempt.actor_user_id
    ),
    commit_job.preview_job_id,
    import_row.commit_target_profile_id
  INTO v_actor_user_id, v_preview_job_id, v_target_profile_id
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  JOIN plugin_data.csf_sheet_import_jobs AS commit_job
    ON commit_job.organization_id = attempt.organization_id
   AND commit_job.id = attempt.commit_job_id
  JOIN plugin_data.csf_sheet_import_rows AS import_row
    ON import_row.organization_id = attempt.organization_id
   AND import_row.job_id = commit_job.preview_job_id
   AND import_row.id = p_import_row_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, v_actor_user_id, v_preview_job_id
  );
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(
    p_organization_id, v_preview_job_id, v_actor_user_id
  );
  PERFORM plugin_data.csf_assert_automatic_import_scope(p_organization_id,v_preview_job_id);
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[v_target_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_commit_import_row_for_attempt_identity_base(
    p_organization_id, p_attempt_id, p_import_row_id
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_queue_automatic_import_preview(p_organization_id uuid,p_preview_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_count integer;
  v_blockers text[];
  v_receipt jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_preview FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=p_preview_job_id AND mode='preview';
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND source_id=v_preview.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enable automatic updates for this Sheet before queueing it.' USING ERRCODE='55000';
  END IF;
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(p_organization_id,p_preview_job_id,v_auth.authorized_by);
  IF v_preview.mapping_snapshot->>'automaticUpdateAuthorizationId' IS DISTINCT FROM v_auth.id::text THEN
    RAISE EXCEPTION 'Prepare this Sheet under its automatic-update authorization first.' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_import_approval_batch:'||p_organization_id::text||':'||p_preview_job_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_import_preview_queue:'||p_organization_id::text||':'||p_preview_job_id::text,0));
  PERFORM id FROM plugin_data.csf_import_commit_queue
    WHERE organization_id=p_organization_id AND preview_job_id=p_preview_job_id FOR UPDATE;
  PERFORM plugin_data.csf_lock_import_commit_coordinate(p_organization_id,p_preview_job_id,true);
  IF EXISTS (SELECT 1 FROM plugin_data.csf_automatic_import_approvals
    WHERE organization_id=p_organization_id AND preview_job_id=p_preview_job_id) THEN
    IF NOT plugin_data.csf_automatic_import_scope_current(p_organization_id,p_preview_job_id) THEN
      RAISE EXCEPTION 'The approved rows changed. Prepare this Sheet again.' USING ERRCODE='55000';
    END IF;
    RETURN plugin_data.csf_queue_import_preview_batch(p_organization_id,v_auth.authorized_by,ARRAY[p_preview_job_id],p_preview_job_id);
  END IF;
  SELECT count(*) INTO v_count FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND job_id=p_preview_job_id AND import_status='pending';
  IF v_count=0 THEN RETURN jsonb_build_object('queued',0,'readyRows',0,'needsAttention',true); END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_import_rows r
    WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id AND r.import_status='pending'
      AND (r.source_id IS DISTINCT FROM v_preview.source_id OR r.cohort_id IS NULL OR r.term_id IS NULL
        OR r.row_hash IS NULL OR r.row_hash !~ '^[a-f0-9]{64}$'
        OR jsonb_typeof(r.normalized_data->'commitPayload') IS DISTINCT FROM 'object'
        OR r.commit_outcome_state<>'not_started' OR r.commit_frozen_at IS NOT NULL
        OR (v_preview.source_type='application_responses' AND r.matched_profile_id IS NULL))) THEN
    RAISE EXCEPTION 'Ready rows need identity or source review before automatic import.' USING ERRCODE='55000';
  END IF;
  INSERT INTO plugin_data.csf_automatic_import_approvals
    (organization_id,preview_job_id,authorization_id,authorization_generation,actor_user_id,source_content_hash,snapshot_hash,row_count)
  VALUES (p_organization_id,p_preview_job_id,v_auth.id,v_auth.generation,v_auth.authorized_by,
    v_preview.source_content_hash,v_preview.snapshot_hash,v_count);
  INSERT INTO plugin_data.csf_automatic_import_approval_rows
    (organization_id,preview_job_id,import_row_id,source_id,cohort_id,term_id,target_profile_id,row_hash,payload_hash)
  SELECT p_organization_id,p_preview_job_id,r.id,r.source_id,r.cohort_id,r.term_id,r.matched_profile_id,r.row_hash,
    encode(sha256(convert_to((r.normalized_data->'commitPayload')::text,'UTF8')),'hex')
  FROM plugin_data.csf_sheet_import_rows r
  WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id AND r.import_status='pending';
  v_blockers := plugin_data.csf_import_preview_claim_blockers(p_organization_id,p_preview_job_id);
  IF cardinality(v_blockers)>0 THEN
    RAISE EXCEPTION 'This preview needs source or recovery review before automatic import.' USING ERRCODE='55000';
  END IF;
  v_receipt := plugin_data.csf_queue_import_preview_batch(p_organization_id,v_auth.authorized_by,ARRAY[p_preview_job_id],p_preview_job_id);
  IF v_receipt->>'queued' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'This preview could not be queued for automatic import.' USING ERRCODE='55000';
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id,actor_user_id,action,target_type,target_id,after_data)
  VALUES (p_organization_id,v_auth.authorized_by,'sheets.automatic_safe_rows_approved','sheet_import_job',p_preview_job_id,
    jsonb_build_object('authorizationId',v_auth.id,'generation',v_auth.generation,'readyRows',v_count,'batchId',v_receipt->>'batchId'));
  RETURN v_receipt||jsonb_build_object('readyRows',v_count);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_automatic_import_preview(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_automatic_import_preview(uuid,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_import_preview_evidence_blockers(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_preparing_new_profiles boolean
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_contract constant text := 'csf-normalized-import/v1';
  c_used_range constant text := 'used-range';
  c_a1_block constant text :=
    '^([A-Za-z]{1,3})([1-9][0-9]*):([A-Za-z]{1,3})([1-9][0-9]*)$';
  c_a1_quoted constant text := '^''((?:[^'']|'''')*)''!(.*)$';
  c_a1_unquoted constant text := '^([^''!]+)!(.*)$';
  c_a1_max_row constant bigint := 10000000;
  c_a1_max_row_digits constant integer := 8;
  c_mapping_version_max constant bigint := 2147483647;
  c_sheets_mime constant text := 'application/vnd.google-apps.spreadsheet';
  c_csv_mime constant text := 'text/csv';
  c_xlsx_mime constant text :=
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  c_version_shape constant text := '^[1-9][0-9]*$';
  c_version_max constant text := '9223372036854775807';
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  c_drive_instant constant text :=
    '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
    || 'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]'
    || '(?:\.(?:[0-9]{3}|[0-9]{6}|[0-9]{9}))?Z$';
  c_drive_nanos constant text := '\.[0-9]{6}([0-9]{3})Z$';
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_blockers text[] := ARRAY[]::text[];
  v_total integer;
  v_pending integer;
  v_unresolved integer;
  v_unknown integer;
  v_in_flight integer;
  v_missing_cohort integer;
  v_missing_term integer;
  v_frozen_file_id text;
  v_frozen_revision text;
  v_frozen_mime text;
  v_frozen_version text;
  v_frozen_modified_text text;
  v_frozen_modified_at timestamptz;
  v_frozen_provider text;
  v_frozen_generation_text text;
  v_frozen_generation bigint;
  v_frozen_ready_text text;
  v_frozen_ready_at timestamptz;
  v_live_generation_text text;
  v_live_ready_text text;
  v_live_ready_at timestamptz;
  v_mapping_ok boolean;
  v_mapping_version_text text;
  v_mapping_source_type text;
  v_mapping_file_id text;
  v_mapping_provider text;
  v_header_ok boolean;
  v_header_row_text text;
  v_job_file_id text;
  v_job_content_hash text;
  v_live_file_id text;
  v_live_mime text;
  v_live_revision text;
  v_receipt_revision text;
  v_expected_mime text;
  v_tabs jsonb;
  v_tab jsonb;
  v_tab_name text;
  v_range text;
  v_qualifier text;
  v_block text;
  v_parts text[];
  v_range_ok boolean;
  v_tab_names jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RETURN ARRAY['The preview job was not found.'];
  END IF;

  IF v_preview.mode <> 'preview' THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Only a preview job may be committed.');
  END IF;

  IF nullif(btrim(coalesce(v_preview.source_file_id, '')), '') IS NULL THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Choose an exact source file.');
  END IF;
  IF nullif(btrim(coalesce(v_preview.source_file_name, '')), '') IS NULL THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Record the source file name.');
  END IF;
  IF jsonb_typeof(coalesce(v_preview.source_file_metadata, 'null'::jsonb)) <> 'object' THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
  ELSE
    IF coalesce(jsonb_typeof(v_preview.source_file_metadata -> 'trashed'), 'absent')
      <> 'boolean'
    THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
    END IF;
    IF coalesce(v_preview.source_file_metadata->>'accessState', '') <> 'accessible'
      OR coalesce(
        CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'trashed') = 'boolean'
            THEN (v_preview.source_file_metadata ->> 'trashed')::boolean
          ELSE NULL
        END,
        false
      )
    THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
    END IF;
  END IF;

  IF v_preview.source_id IS NULL THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
  ELSE
    SELECT * INTO v_source
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = v_preview.source_id;
    IF NOT FOUND THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
    ELSE
      IF coalesce(v_source.drive_access_state, '') <> 'accessible'
        OR coalesce(v_source.drive_trashed, false)
      THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
      END IF;
      IF (CASE
        WHEN jsonb_typeof(v_source.settings -> 'sourceKind') = 'string'
          THEN nullif(v_source.settings->>'sourceKind', '')
        ELSE NULL
      END) IS DISTINCT FROM v_preview.source_type
      THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
      END IF;

      v_frozen_file_id := CASE
        WHEN jsonb_typeof(v_preview.source_file_metadata -> 'id') = 'string'
          THEN nullif(v_preview.source_file_metadata->>'id', '')
        ELSE NULL
      END;
      IF plugin_data.csf_has_edge_padding(v_frozen_file_id) THEN
        v_frozen_file_id := NULL;
      END IF;
      v_frozen_mime := CASE
        WHEN jsonb_typeof(v_preview.source_file_metadata -> 'mimeType') = 'string'
          THEN nullif(v_preview.source_file_metadata->>'mimeType', '')
        ELSE NULL
      END;
      IF plugin_data.csf_has_edge_padding(v_frozen_mime) THEN
        v_frozen_mime := NULL;
      END IF;
      v_frozen_provider := CASE
        WHEN jsonb_typeof(v_preview.source_file_metadata -> 'sourceProvider') = 'string'
          THEN nullif(v_preview.source_file_metadata->>'sourceProvider', '')
        ELSE NULL
      END;
      IF plugin_data.csf_has_edge_padding(v_frozen_provider) THEN
        v_frozen_provider := NULL;
      END IF;
      IF v_frozen_provider IS NULL
        OR v_frozen_provider IS DISTINCT FROM v_source.provider
      THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        v_frozen_provider := NULL;
      END IF;

      IF v_frozen_provider IS NULL THEN
        NULL;
      ELSIF v_frozen_provider = 'google_sheets' THEN
        v_frozen_version := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'version') = 'string'
            THEN nullif(v_preview.source_file_metadata ->> 'version', '')
          ELSE NULL
        END;
        v_frozen_modified_text := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'modifiedTime') = 'string'
            THEN nullif(v_preview.source_file_metadata->>'modifiedTime', '')
          ELSE NULL
        END;
        v_frozen_modified_at := NULL;
        IF v_frozen_modified_text IS NOT NULL
          AND v_frozen_modified_text ~ c_drive_instant
          AND coalesce(
            (regexp_match(v_frozen_modified_text, c_drive_nanos))[1], '000'
          ) = '000'
        THEN
          BEGIN
            v_frozen_modified_at := v_frozen_modified_text::timestamptz;
          EXCEPTION WHEN others THEN
            v_frozen_modified_at := NULL;
          END;
        END IF;

        v_live_file_id := nullif(
          coalesce(v_source.drive_file_id, v_source.spreadsheet_id, ''), ''
        );
        IF plugin_data.csf_has_edge_padding(v_live_file_id) THEN
          v_live_file_id := NULL;
        END IF;
        v_live_mime := nullif(coalesce(v_source.drive_mime_type, ''), '');
        IF plugin_data.csf_has_edge_padding(v_live_mime) THEN
          v_live_mime := NULL;
        END IF;
        v_live_revision := CASE
          WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
            THEN nullif(v_source.settings->>'evidenceRevision', '')
          ELSE NULL
        END;

        v_job_file_id := nullif(v_preview.source_file_id, '');
        IF plugin_data.csf_has_edge_padding(v_job_file_id) THEN
          v_job_file_id := NULL;
        END IF;
        IF v_frozen_file_id IS NULL OR v_live_file_id IS NULL OR v_job_file_id IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_file_id IS DISTINCT FROM v_live_file_id
          OR v_frozen_file_id IS DISTINCT FROM v_job_file_id
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source now points at a different file. Run a fresh preview.');
        END IF;

        IF v_frozen_mime IS NULL OR v_live_mime IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_mime IS DISTINCT FROM c_sheets_mime
          OR v_live_mime IS DISTINCT FROM c_sheets_mime
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source was replaced with a different kind of file. Run a fresh preview.');
        END IF;

        IF v_frozen_modified_at IS NULL
          OR v_preview.source_modified_at IS NULL
          OR v_preview.source_modified_at IS DISTINCT FROM v_frozen_modified_at
          OR v_source.drive_modified_at IS NULL
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_source.drive_modified_at IS DISTINCT FROM v_frozen_modified_at THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source changed after it was previewed. Run a fresh preview.');
        END IF;

        IF v_frozen_version IS NULL
          OR v_frozen_version !~ c_version_shape
          OR length(v_frozen_version) > length(c_version_max)
          OR (length(v_frozen_version) = length(c_version_max)
            AND v_frozen_version COLLATE "C" > c_version_max COLLATE "C")
          OR v_live_revision IS NULL
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_live_revision IS DISTINCT FROM v_frozen_version THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source changed after it was previewed. Run a fresh preview.');
        END IF;
      ELSIF v_frozen_provider IN ('uploaded_xlsx', 'uploaded_csv') THEN
        v_frozen_revision := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'headRevisionId') = 'string'
            THEN nullif(v_preview.source_file_metadata->>'headRevisionId', '')
          ELSE NULL
        END;
        v_expected_mime := CASE v_frozen_provider
          WHEN 'uploaded_csv' THEN c_csv_mime
          ELSE c_xlsx_mime
        END;
        v_live_file_id := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string'
            THEN nullif(v_source.settings->>'stagingObjectId', '')
          ELSE NULL
        END;
        IF plugin_data.csf_has_edge_padding(v_live_file_id) THEN
          v_live_file_id := NULL;
        END IF;
        v_live_revision := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingContentHash') = 'string'
            THEN nullif(v_source.settings->>'stagingContentHash', '')
          ELSE NULL
        END;
        v_receipt_revision := CASE
          WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
            THEN nullif(v_source.settings->>'evidenceRevision', '')
          ELSE NULL
        END;
        IF v_frozen_file_id IS NULL
          OR v_live_file_id IS NULL
          OR v_frozen_file_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_file_id IS DISTINCT FROM v_live_file_id THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        v_job_file_id := nullif(v_preview.source_file_id, '');
        IF plugin_data.csf_has_edge_padding(v_job_file_id) THEN
          v_job_file_id := NULL;
        END IF;
        IF v_job_file_id IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_file_id IS NOT NULL AND v_job_file_id IS DISTINCT FROM v_frozen_file_id THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        v_frozen_generation := NULL;
        v_frozen_generation_text := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'stagingGeneration') = 'number'
            THEN v_preview.source_file_metadata ->> 'stagingGeneration'
          ELSE NULL
        END;
        IF v_frozen_generation_text IS NOT NULL
          AND v_frozen_generation_text ~ '^[1-9][0-9]{0,9}$'
        THEN
          IF v_frozen_generation_text::bigint <= c_mapping_version_max THEN
            v_frozen_generation := v_frozen_generation_text::bigint;
          END IF;
        END IF;
        v_live_generation_text := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'string'
            THEN nullif(v_source.settings ->> 'stagingGeneration', '')
          WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'number'
            THEN v_source.settings ->> 'stagingGeneration'
          ELSE NULL
        END;
        IF v_live_generation_text IS NOT NULL
          AND v_live_generation_text !~ '^[1-9][0-9]{0,9}$'
        THEN
          v_live_generation_text := NULL;
        END IF;
        IF v_frozen_generation IS NULL OR v_live_generation_text IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_live_generation_text::bigint IS DISTINCT FROM v_frozen_generation THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        v_frozen_ready_at := NULL;
        v_frozen_ready_text := CASE
          WHEN jsonb_typeof(v_preview.source_file_metadata -> 'readyAt') = 'string'
            THEN nullif(v_preview.source_file_metadata ->> 'readyAt', '')
          ELSE NULL
        END;
        IF v_frozen_ready_text IS NOT NULL
          AND NOT plugin_data.csf_has_edge_padding(v_frozen_ready_text)
        THEN
          BEGIN
            v_frozen_ready_at := v_frozen_ready_text::timestamptz;
          EXCEPTION WHEN others THEN
            v_frozen_ready_at := NULL;
          END;
        END IF;
        v_live_ready_at := NULL;
        v_live_ready_text := CASE
          WHEN jsonb_typeof(v_source.settings -> 'stagingReadyAt') = 'string'
            THEN nullif(v_source.settings ->> 'stagingReadyAt', '')
          ELSE NULL
        END;
        IF v_live_ready_text IS NOT NULL
          AND NOT plugin_data.csf_has_edge_padding(v_live_ready_text)
        THEN
          BEGIN
            v_live_ready_at := v_live_ready_text::timestamptz;
          EXCEPTION WHEN others THEN
            v_live_ready_at := NULL;
          END;
        END IF;
        IF v_preview.source_file_metadata ? 'version'
          OR v_preview.source_file_metadata ? 'modifiedTime'
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        END IF;
        IF v_frozen_ready_at IS NULL
          OR v_live_ready_at IS NULL
          OR v_preview.source_modified_at IS NULL
          OR v_preview.source_modified_at IS DISTINCT FROM v_frozen_ready_at
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_live_ready_at IS DISTINCT FROM v_frozen_ready_at THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        v_job_content_hash := nullif(v_preview.source_content_hash, '');
        IF v_frozen_revision IS NULL
          OR v_live_revision IS NULL
          OR v_receipt_revision IS NULL
          OR v_job_content_hash IS NULL
          OR v_frozen_revision !~ c_sha256_shape
          OR v_live_revision !~ c_sha256_shape
          OR v_receipt_revision !~ c_sha256_shape
          OR v_job_content_hash !~ c_sha256_shape
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_revision IS DISTINCT FROM v_live_revision
          OR v_frozen_revision IS DISTINCT FROM v_receipt_revision
          OR v_frozen_revision IS DISTINCT FROM v_job_content_hash
          OR v_live_revision IS DISTINCT FROM v_receipt_revision
        THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'A newer workbook was uploaded for this source. Run a fresh preview.');
        END IF;
        IF v_frozen_mime IS NULL THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records its source evidence.');
        ELSIF v_frozen_mime IS DISTINCT FROM v_expected_mime THEN
          v_blockers := pg_catalog.array_append(v_blockers, 'This source was replaced with a different kind of file. Run a fresh preview.');
        END IF;
      ELSE
        v_blockers := pg_catalog.array_append(v_blockers, 'Reconnect the source file before importing.');
      END IF;
    END IF;
  END IF;
  IF v_preview.status NOT IN ('completed', 'needs_resolution') THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Wait for a completed preview before importing records.');
  END IF;
  IF v_preview.snapshot_contract_version IS DISTINCT FROM c_contract THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import uses the current normalized snapshot.');
  END IF;
  IF coalesce(v_preview.source_content_hash, '') !~ '^[0-9a-f]{64}$'
    OR coalesce(v_preview.snapshot_hash, '') !~ '^[0-9a-f]{64}$'
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records a complete normalized snapshot.');
  END IF;
  IF v_preview.snapshot_row_count IS NULL OR v_preview.snapshot_row_count < 1 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Run a fresh preview so this import records a complete normalized snapshot.');
  END IF;
  IF v_preview.mapping_version IS NULL OR v_preview.mapping_version < 1
    OR jsonb_typeof(coalesce(v_preview.mapping_snapshot, 'null'::jsonb)) <> 'object'
  THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Inspect and map the selected columns again.');
  ELSE
    v_mapping_ok := true;
    IF jsonb_typeof(v_preview.mapping_snapshot -> 'version') <> 'number' THEN
      v_mapping_ok := false;
    ELSE
      v_mapping_version_text := v_preview.mapping_snapshot ->> 'version';
      IF v_mapping_version_text IS NULL
        OR v_mapping_version_text !~ '^[1-9][0-9]{0,9}$'
      THEN
        v_mapping_ok := false;
      ELSIF v_mapping_version_text::bigint > c_mapping_version_max THEN
        v_mapping_ok := false;
      ELSIF v_mapping_version_text::bigint
        IS DISTINCT FROM v_preview.mapping_version::bigint
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF v_mapping_ok THEN
      v_mapping_source_type := CASE
        WHEN jsonb_typeof(v_preview.mapping_snapshot -> 'sourceType') = 'string'
          THEN nullif(v_preview.mapping_snapshot ->> 'sourceType', '')
        ELSE NULL
      END;
      IF v_mapping_source_type IS NULL
        OR plugin_data.csf_has_edge_padding(v_mapping_source_type)
        OR v_mapping_source_type IS DISTINCT FROM v_preview.source_type
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF v_mapping_ok THEN
      v_mapping_file_id := CASE
        WHEN jsonb_typeof(v_preview.mapping_snapshot -> 'sourceFileId') = 'string'
          THEN nullif(v_preview.mapping_snapshot ->> 'sourceFileId', '')
        ELSE NULL
      END;
      IF v_mapping_file_id IS NULL
        OR plugin_data.csf_has_edge_padding(v_mapping_file_id)
        OR v_mapping_file_id IS DISTINCT FROM nullif(v_preview.source_file_id, '')
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF v_mapping_ok THEN
      v_mapping_provider := CASE
        WHEN jsonb_typeof(v_preview.mapping_snapshot -> 'sourceProvider') = 'string'
          THEN nullif(v_preview.mapping_snapshot ->> 'sourceProvider', '')
        ELSE NULL
      END;
      IF v_mapping_provider IS NULL
        OR plugin_data.csf_has_edge_padding(v_mapping_provider)
        OR v_frozen_provider IS NULL
        OR v_mapping_provider IS DISTINCT FROM v_frozen_provider
      THEN
        v_mapping_ok := false;
      END IF;
    END IF;

    IF NOT v_mapping_ok THEN
      v_blockers := pg_catalog.array_append(v_blockers, 'Inspect and map the selected columns again.');
    END IF;
  END IF;

  v_tabs := v_preview.mapping_snapshot -> 'tabs';
  IF v_tabs IS NULL OR jsonb_typeof(v_tabs) <> 'array' THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Select at least one exact Sheet tab and range.');
  ELSIF jsonb_array_length(v_tabs) = 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Select at least one exact Sheet tab and range.');
  ELSE
    FOR v_tab IN SELECT jsonb_array_elements(v_tabs)
    LOOP
      IF jsonb_typeof(v_tab) <> 'object' THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Select at least one exact Sheet tab and range.');
        EXIT;
      END IF;
      v_tab_name := CASE
        WHEN jsonb_typeof(v_tab -> 'tabName') = 'string'
          THEN nullif(v_tab->>'tabName', '')
        ELSE NULL
      END;
      IF v_tab_name IS NULL OR plugin_data.csf_has_edge_padding(v_tab_name) THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Select an exact Sheet tab.');
        EXIT;
      END IF;
      IF v_tab_names ? v_tab_name THEN
        v_blockers := pg_catalog.array_append(v_blockers, format('The %s tab is mapped more than once.', v_tab_name));
        EXIT;
      END IF;
      v_tab_names := v_tab_names || jsonb_build_object(v_tab_name, true);

      v_range := CASE
        WHEN jsonb_typeof(v_tab -> 'range') = 'string'
          THEN nullif(v_tab->>'range', '')
        ELSE NULL
      END;
      v_range_ok := v_range IS NOT NULL AND NOT plugin_data.csf_has_edge_padding(v_range);
      IF v_range_ok AND v_range ~* c_used_range THEN
        v_range_ok := false;
      END IF;

      v_qualifier := NULL;
      v_block := NULL;
      IF v_range_ok THEN
        v_parts := regexp_match(v_range, c_a1_quoted);
        IF v_parts IS NOT NULL THEN
          v_qualifier := replace(v_parts[1], '''''', '''');
          v_block := v_parts[2];
          IF v_qualifier = '' THEN
            v_range_ok := false;
          END IF;
        ELSE
          v_parts := regexp_match(v_range, c_a1_unquoted);
          IF v_parts IS NOT NULL THEN
            v_qualifier := v_parts[1];
            v_block := v_parts[2];
          ELSIF strpos(v_range, '!') > 0 THEN
            v_range_ok := false;
          ELSE
            v_block := v_range;
          END IF;
        END IF;
      END IF;
      IF v_range_ok AND v_qualifier IS NOT NULL AND v_qualifier IS DISTINCT FROM v_tab_name THEN
        v_range_ok := false;
      END IF;

      IF v_range_ok THEN
        v_parts := regexp_match(v_block, c_a1_block);
        v_range_ok := v_parts IS NOT NULL;
      END IF;
      IF v_range_ok THEN
        IF length(v_parts[1]) > length(v_parts[3])
          OR (length(v_parts[1]) = length(v_parts[3])
            AND upper(v_parts[1]) COLLATE "C" > upper(v_parts[3]) COLLATE "C")
        THEN
          v_range_ok := false;
        ELSIF length(v_parts[2]) > c_a1_max_row_digits
          OR length(v_parts[4]) > c_a1_max_row_digits
        THEN
          v_range_ok := false;
        ELSE
          IF v_parts[2]::bigint > c_a1_max_row THEN
            v_range_ok := false;
          ELSIF v_parts[4]::bigint > c_a1_max_row THEN
            v_range_ok := false;
          ELSIF v_parts[2]::bigint > v_parts[4]::bigint THEN
            v_range_ok := false;
          END IF;
        END IF;
      END IF;
      IF NOT v_range_ok THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Select an exact Sheet range.');
        EXIT;
      END IF;

      v_header_ok := jsonb_typeof(v_tab -> 'headerRow') = 'number';
      IF v_header_ok THEN
        v_header_row_text := v_tab ->> 'headerRow';
        IF v_header_row_text IS NULL OR v_header_row_text !~ '^[1-9][0-9]{0,7}$' THEN
          v_header_ok := false;
        ELSIF v_header_row_text::bigint > c_a1_max_row THEN
          v_header_ok := false;
        END IF;
      END IF;
      IF NOT v_header_ok THEN
        v_blockers := pg_catalog.array_append(v_blockers, 'Choose the header row for every selected tab.');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE import_status = 'pending'),
    count(*) FILTER (WHERE import_status IN ('ambiguous', 'conflict', 'duplicate')),
    count(*) FILTER (WHERE commit_outcome_unresolved),
    count(*) FILTER (WHERE commit_outcome_state = 'in_flight'),
    count(*) FILTER (WHERE import_status = 'pending' AND cohort_id IS NULL),
    count(*) FILTER (
      WHERE import_status = 'pending'
        AND term_id IS NULL
        AND v_preview.source_type IN ('application_responses', 'class_history')
    )
  INTO v_total, v_pending, v_unresolved, v_unknown, v_in_flight,
       v_missing_cohort, v_missing_term
  FROM plugin_data.csf_sheet_import_rows
  WHERE organization_id = p_organization_id
    AND job_id = p_preview_job_id;

  IF v_missing_cohort > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Resolve the class for every ready row.');
  END IF;
  IF v_missing_term > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'Resolve the semester for every ready row.');
  END IF;
  IF v_in_flight > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('%s row(s) are still recorded in flight and need recovery review first.', v_in_flight));
  END IF;

  IF v_preview.snapshot_row_count IS NOT NULL AND v_total <> v_preview.snapshot_row_count THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('This preview stores %s of the %s reviewed rows.', v_total, v_preview.snapshot_row_count));
  END IF;
  IF v_pending = 0 AND NOT p_preparing_new_profiles THEN
    v_blockers := pg_catalog.array_append(v_blockers, 'No ready rows remain in this preview.');
  END IF;
  IF v_unresolved > 0 AND NOT p_preparing_new_profiles AND NOT plugin_data.csf_automatic_import_scope_current(p_organization_id,p_preview_job_id) THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('Reconcile %s conflicting row(s) before importing.', v_unresolved));
  END IF;
  IF v_unknown > 0 THEN
    v_blockers := pg_catalog.array_append(v_blockers, format('%s row(s) have an unresolved import outcome and must be reconciled first.', v_unknown));
  END IF;

  RETURN v_blockers;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_evidence_blockers(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_evidence_blockers(uuid,uuid,boolean) TO postgres;
CREATE OR REPLACE FUNCTION plugin_data.csf_import_preview_claim_blockers(p_organization_id uuid,p_preview_job_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT plugin_data.csf_import_preview_evidence_blockers(p_organization_id,p_preview_job_id,false);
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_claim_blockers(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_claim_blockers(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_import_approval_batches%ROWTYPE;
  v_preview_id uuid;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_readiness jsonb;
  v_queue_id uuid;
  v_state text;
  v_reason text;
  v_actor_authorized boolean;
  v_mapping_current boolean;
  v_queued integer := 0;
  v_blocked integer := 0;
  v_stale integer := 0;
  v_completed integer := 0;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A batch request ID is required.';
  END IF;
  IF coalesce(pg_catalog.cardinality(p_preview_job_ids), 0) < 1
    OR pg_catalog.cardinality(p_preview_job_ids) > 100
  THEN
    RAISE EXCEPTION 'Choose between one and 100 import previews.';
  END IF;
  IF pg_catalog.cardinality(p_preview_job_ids) <> (
    SELECT pg_catalog.count(DISTINCT preview_id)
    FROM pg_catalog.unnest(p_preview_job_ids) AS preview_id
  ) THEN
    RAISE EXCEPTION 'Each import preview may appear only once.';
  END IF;

  SELECT * INTO v_batch
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.request_id = p_request_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'batchId', v_batch.id,
      'requested', v_batch.requested_count,
      'queued', v_batch.queued_count,
      'blocked', v_batch.blocked_count,
      'stale', v_batch.stale_count,
      'completed', v_batch.completed_count,
      'replayed', true
    );
  END IF;

  INSERT INTO plugin_data.csf_import_approval_batches (
    organization_id, actor_user_id, request_id, requested_count
  ) VALUES (
    p_organization_id, p_actor_user_id, p_request_id,
    pg_catalog.cardinality(p_preview_job_ids)
  )
  RETURNING * INTO v_batch;

  FOREACH v_preview_id IN ARRAY p_preview_job_ids LOOP
    v_state := 'stale';
    v_reason := 'preview_unavailable';
    v_queue_id := NULL;
    v_actor_authorized := true;
    v_mapping_current := true;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf_import_preview_queue:'
          || p_organization_id::text
          || ':'
          || v_preview_id::text,
        0
      )
    );
    PERFORM queue.id
    FROM plugin_data.csf_import_commit_queue AS queue
    WHERE queue.organization_id = p_organization_id
      AND queue.preview_job_id = v_preview_id
    FOR UPDATE;

    SELECT * INTO v_preview
    FROM plugin_data.csf_sheet_import_jobs AS preview
    WHERE preview.organization_id = p_organization_id
      AND preview.id = v_preview_id
      AND preview.mode = 'preview'
    FOR UPDATE;

    IF FOUND AND v_preview.status IN ('completed', 'needs_resolution') THEN
      BEGIN
        PERFORM plugin_data.csf_assert_import_actor(
          p_organization_id,
          p_actor_user_id,
          v_preview.source_type
        );
      EXCEPTION
        WHEN SQLSTATE '42501' THEN
          v_actor_authorized := false;
          v_state := 'blocked';
          v_reason := 'actor_not_authorized';
          v_blocked := v_blocked + 1;
      END;

      IF v_actor_authorized THEN
        BEGIN
          PERFORM plugin_data.csf_assert_import_preview_workbook_generation_current(
            p_organization_id,
            v_preview_id
          );
          PERFORM plugin_data.csf_assert_import_preview_mapping_current(
            p_organization_id,
            v_preview_id
          );
        EXCEPTION
          WHEN SQLSTATE '55000' OR SQLSTATE '23503' OR SQLSTATE '23514' THEN
            v_mapping_current := false;
            v_state := 'stale';
            v_reason := 'source_mapping_changed';
            v_stale := v_stale + 1;
        END;

        IF v_mapping_current THEN
          v_readiness := plugin_data.csf_import_preview_readiness(
            p_organization_id,
            v_preview_id
          );
          IF v_readiness ->> 'commitState' = 'completed' THEN
            v_state := 'completed';
            v_reason := NULL;
            v_completed := v_completed + 1;
          ELSIF v_readiness ->> 'commitState' IN ('running', 'cancelled')
            OR (NOT plugin_data.csf_automatic_import_scope_current(p_organization_id,v_preview_id) AND (
              coalesce((v_readiness ->> 'ambiguous')::integer, 0) > 0
              OR coalesce((v_readiness ->> 'conflict')::integer, 0) > 0
              OR coalesce((v_readiness ->> 'duplicate')::integer, 0) > 0
              OR coalesce((v_readiness ->> 'error')::integer, 0) > 0))
            OR coalesce((v_readiness ->> 'pendingMissingCohort')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'pendingMissingTerm')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'pendingMissingMatch')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'inFlight')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'unknownOutcome')::integer, 0) > 0
            OR coalesce((v_readiness ->> 'historicalUnknown')::integer, 0) > 0
          THEN
            v_state := 'blocked';
            v_reason := 'preview_requires_review';
            v_blocked := v_blocked + 1;
          ELSE
            INSERT INTO plugin_data.csf_import_commit_queue (
              organization_id, preview_job_id, actor_user_id, status, updated_at
            ) VALUES (
              p_organization_id, v_preview_id, p_actor_user_id, 'queued',
              pg_catalog.now()
            )
            ON CONFLICT (organization_id, preview_job_id) DO UPDATE
            SET actor_user_id = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN EXCLUDED.actor_user_id
                  ELSE plugin_data.csf_import_commit_queue.actor_user_id
                END,
                status = CASE
                  WHEN plugin_data.csf_import_commit_queue.status = 'queued'
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND plugin_data.csf_import_commit_queue.lease_expires_at
                        > pg_catalog.now()
                    )
                    THEN plugin_data.csf_import_commit_queue.status
                  ELSE 'queued'
                END,
                error_code = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.error_code
                END,
                lease_token = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.lease_token
                END,
                lease_expires_at = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.lease_expires_at
                END,
                attempt_count = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN 0
                  ELSE plugin_data.csf_import_commit_queue.attempt_count
                END,
                result_counts = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN '{}'::jsonb
                  ELSE plugin_data.csf_import_commit_queue.result_counts
                END,
                started_at = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.started_at
                END,
                finished_at = CASE
                  WHEN plugin_data.csf_import_commit_queue.status
                    IN ('blocked', 'failed', 'completed')
                    OR (
                      plugin_data.csf_import_commit_queue.status = 'running'
                      AND (
                        plugin_data.csf_import_commit_queue.lease_expires_at IS NULL
                        OR plugin_data.csf_import_commit_queue.lease_expires_at
                          <= pg_catalog.now()
                      )
                    )
                    THEN NULL
                  ELSE plugin_data.csf_import_commit_queue.finished_at
                END,
                updated_at = pg_catalog.now()
            RETURNING id INTO v_queue_id;
            v_state := 'queued';
            v_reason := NULL;
            v_queued := v_queued + 1;
          END IF;
        END IF;
      END IF;
    ELSE
      v_stale := v_stale + 1;
    END IF;

    INSERT INTO plugin_data.csf_import_approval_batch_items (
      organization_id, batch_id, preview_job_id, queue_id, state, reason_code
    ) VALUES (
      p_organization_id, v_batch.id, v_preview_id, v_queue_id, v_state, v_reason
    );
  END LOOP;

  UPDATE plugin_data.csf_import_approval_batches
  SET queued_count = v_queued,
      blocked_count = v_blocked,
      stale_count = v_stale,
      completed_count = v_completed,
      status = CASE
        WHEN v_queued > 0 THEN 'queued'
        ELSE 'completed'
      END,
      updated_at = pg_catalog.now()
  WHERE id = v_batch.id;

  RETURN pg_catalog.jsonb_build_object(
    'batchId', v_batch.id,
    'requested', pg_catalog.cardinality(p_preview_job_ids),
    'queued', v_queued,
    'blocked', v_blocked,
    'stale', v_stale,
    'completed', v_completed,
    'replayed', false
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid) TO postgres;
CREATE FUNCTION plugin_data.csf_assert_automatic_import_scope(p_organization_id uuid,p_preview_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=p_preview_job_id
      AND mapping_snapshot ? 'automaticUpdateAuthorizationId')
    AND NOT plugin_data.csf_automatic_import_scope_current(p_organization_id,p_preview_job_id) THEN
    RAISE EXCEPTION 'The approved rows changed. Prepare this Sheet again.' USING ERRCODE='55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_automatic_import_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_automatic_import_scope(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_import_automatic_scope_state(p_organization_id uuid,p_preview_job_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM plugin_data.csf_assert_import_actor_for_job(p_organization_id,p_actor_user_id,p_preview_job_id);
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(p_organization_id,p_preview_job_id,p_actor_user_id);
  RETURN jsonb_build_object('previewJobId',p_preview_job_id,
    'approved',plugin_data.csf_automatic_import_scope_current(p_organization_id,p_preview_job_id));
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_import_automatic_scope_state(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_automatic_scope_state(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_automatic_application_new_profile_is_safe(p_organization_id uuid,p_row_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_first text; v_last text; v_emails text[];
BEGIN
  SELECT * INTO v_row FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_row_id;
  IF NOT FOUND OR v_row.import_status<>'ambiguous' OR v_row.matched_profile_id IS NOT NULL
    OR v_row.resolution_status IS DISTINCT FROM 'pending' OR v_row.commit_outcome_state<>'not_started'
    OR v_row.commit_frozen_at IS NOT NULL OR v_row.cohort_id IS NULL OR v_row.term_id IS NULL
    OR cardinality(coalesce(v_row.errors,ARRAY[]::text[]))>0
    OR v_row.normalized_data->>'sourceType' IS DISTINCT FROM 'application_responses'
    OR v_row.normalized_data->>'targetStatus' IS DISTINCT FROM 'resolved'
    OR v_row.normalized_data->>'rejected' IS DISTINCT FROM 'false'
    OR v_row.normalized_data#>>'{commitPayload,version}' IS DISTINCT FROM 'csf-commit-payload/v1'
    OR v_row.normalized_data#>>'{commitPayload,sourceType}' IS DISTINCT FROM 'application_responses'
    OR v_row.row_hash IS NULL OR v_row.row_hash !~ '^[a-f0-9]{64}$'
    OR v_row.normalized_data#>>'{commitPayload,identity,firstName}' IS DISTINCT FROM v_row.normalized_data#>>'{record,identity,firstName}'
    OR v_row.normalized_data#>>'{commitPayload,identity,lastName}' IS DISTINCT FROM v_row.normalized_data#>>'{record,identity,lastName}'
  THEN RETURN false; END IF;
  v_first:=plugin_data.csf_normalize_identity_part(v_row.normalized_data#>>'{record,identity,firstName}');
  v_last:=plugin_data.csf_normalize_identity_part(v_row.normalized_data#>>'{record,identity,lastName}');
  IF nullif(v_first,'') IS NULL OR nullif(v_last,'') IS NULL
    OR v_row.normalized_data#>>'{commitPayload,identity,normalizedFirstName}' IS DISTINCT FROM v_first
    OR v_row.normalized_data#>>'{commitPayload,identity,normalizedLastName}' IS DISTINCT FROM v_last
    OR length(v_row.normalized_data#>>'{record,identity,firstName}')>200
    OR length(v_row.normalized_data#>>'{record,identity,lastName}')>200
    OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_cohorts c WHERE c.organization_id=p_organization_id AND c.id=v_row.cohort_id)
    OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_terms t WHERE t.organization_id=p_organization_id AND t.id=v_row.term_id)
    OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_cohort_terms ct WHERE ct.organization_id=p_organization_id AND ct.cohort_id=v_row.cohort_id AND ct.term_id=v_row.term_id)
  THEN RETURN false; END IF;
  SELECT coalesce(array_agg(DISTINCT address),ARRAY[]::text[]) INTO v_emails
  FROM (SELECT plugin_data.csf_normalize_email_text(v_row.normalized_data#>>ARRAY['record','contact',field]) AS address
    FROM unnest(ARRAY['responseEmail','preferredContactEmail']) AS field) contacts WHERE address IS NOT NULL;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_profiles p WHERE p.organization_id=p_organization_id AND
    ((p.normalized_first_name=v_first AND p.normalized_last_name=v_last)
      OR p.normalized_school_email=ANY(v_emails) OR p.normalized_personal_email=ANY(v_emails))) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_term_applications a WHERE a.organization_id=p_organization_id
    AND plugin_data.csf_normalize_email_text(a.most_checked_email)=ANY(v_emails)) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_import_rows other WHERE other.organization_id=p_organization_id
    AND other.job_id=v_row.job_id AND other.id<>v_row.id AND other.row_hash IS DISTINCT FROM v_row.row_hash
    AND ((plugin_data.csf_normalize_identity_part(other.normalized_data#>>'{record,identity,firstName}')=v_first
      AND plugin_data.csf_normalize_identity_part(other.normalized_data#>>'{record,identity,lastName}')=v_last)
      OR plugin_data.csf_normalize_email_text(other.normalized_data#>>'{record,contact,responseEmail}')=ANY(v_emails)
      OR plugin_data.csf_normalize_email_text(other.normalized_data#>>'{record,contact,preferredContactEmail}')=ANY(v_emails))) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_automatic_application_new_profile_is_safe(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_automatic_application_new_profile_is_safe(uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_prepare_automatic_application_profiles(p_organization_id uuid,p_preview_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_result jsonb; v_profile_id uuid; v_request_id uuid;
  v_count integer:=0; v_remaining boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_preview FROM plugin_data.csf_sheet_import_jobs WHERE organization_id=p_organization_id AND id=p_preview_job_id;
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND source_id=v_preview.source_id;
  IF NOT FOUND OR v_preview.source_type IS DISTINCT FROM 'application_responses'
    OR v_preview.mapping_snapshot->>'automaticUpdateAuthorizationId' IS DISTINCT FROM v_auth.id::text THEN
    RAISE EXCEPTION 'Prepare this application Sheet under its automatic-update authorization first.' USING ERRCODE='55000';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor_for_job(p_organization_id,v_auth.authorized_by,p_preview_job_id);
  PERFORM plugin_data.csf_assert_automatic_sheet_preview_current(p_organization_id,p_preview_job_id,v_auth.authorized_by);
  IF cardinality(plugin_data.csf_import_preview_evidence_blockers(p_organization_id,p_preview_job_id,true))>0
    OR v_preview.source_content_hash IS NULL OR v_preview.source_content_hash !~ '^[a-f0-9]{64}$'
    OR v_preview.snapshot_hash IS NULL OR v_preview.snapshot_hash !~ '^[a-f0-9]{64}$'
    OR v_preview.snapshot_contract_version IS DISTINCT FROM 'csf-normalized-import/v1'
    OR v_preview.snapshot_row_count IS DISTINCT FROM (SELECT count(*) FROM plugin_data.csf_sheet_import_rows
      WHERE organization_id=p_organization_id AND job_id=p_preview_job_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_sheet_import_rows WHERE organization_id=p_organization_id AND job_id=p_preview_job_id
      AND (source_id IS DISTINCT FROM v_preview.source_id OR commit_outcome_state IN ('in_flight','unknown','historical_unknown'))) THEN
    RAISE EXCEPTION 'Application source evidence or write outcomes need review before creating profiles.' USING ERRCODE='55000';
  END IF;
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id,v_auth.authorized_by,'manage_profiles')
    OR EXISTS (SELECT 1 FROM plugin_data.csf_automatic_import_approvals WHERE organization_id=p_organization_id AND preview_job_id=p_preview_job_id) THEN
    RETURN jsonb_build_object('created',0,'remaining',false);
  END IF;
  -- Validate locked candidates inside the loop. Filtering with the safety function
  -- before sorting evaluated the entire preview before returning the first batch.
  FOR v_row IN SELECT * FROM plugin_data.csf_sheet_import_rows r
    WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id
      AND r.import_status='ambiguous' AND r.matched_profile_id IS NULL
      AND r.resolution_status='pending' AND r.commit_outcome_state='not_started'
      AND r.commit_frozen_at IS NULL
    ORDER BY r.id FOR UPDATE OF r
  LOOP
    IF NOT plugin_data.csf_automatic_application_new_profile_is_safe(p_organization_id,v_row.id) THEN CONTINUE; END IF;
    v_request_id:=md5('csf_auto_application_profile:'||p_organization_id::text||':'||v_row.id::text)::uuid;
    v_result:=plugin_data.csf_upsert_profile(p_organization_id,v_auth.authorized_by,v_request_id,
      jsonb_build_object('profileId',NULL,'firstName',v_row.normalized_data#>>'{record,identity,firstName}',
        'lastName',v_row.normalized_data#>>'{record,identity,lastName}','schoolEmail',NULL,'personalEmail',NULL,
        'cohortId',v_row.cohort_id,'termId',NULL,'termMembershipStatus',NULL));
    v_profile_id:=nullif(v_result->>'profileId','')::uuid;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'The new applicant profile could not be confirmed.' USING ERRCODE='55000'; END IF;
    PERFORM plugin_data.csf_reconcile_sheet_import_row(p_organization_id,v_row.id,v_profile_id,'match',
      'Created an unclaimed applicant under the officer-authorized Sheet mapping; no existing identity candidate was found.',
      v_auth.authorized_by,v_row.correlation_id,jsonb_build_object('matchMethod','source_authorized_new_profile',
        'authorizationId',v_auth.id,'generation',v_auth.generation,'profileCreateRequestId',v_request_id));
    INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data,correlation_id)
    VALUES(p_organization_id,v_auth.authorized_by,'sheets.automatic_application_profile_created','csf_sheet_import_rows',v_row.id,
      jsonb_build_object('authorizationId',v_auth.id,'generation',v_auth.generation,'profileId',v_profile_id),v_request_id);
    v_count:=v_count+1;
    EXIT WHEN v_count>=50;
  END LOOP;
  SELECT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_import_rows r WHERE r.organization_id=p_organization_id AND r.job_id=p_preview_job_id
    AND plugin_data.csf_automatic_application_new_profile_is_safe(p_organization_id,r.id)) INTO v_remaining;
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET next_check_at=CASE WHEN v_remaining THEN now() ELSE now()+interval '5 minutes' END
    WHERE organization_id=p_organization_id AND id=v_auth.id;
  RETURN jsonb_build_object('created',v_count,'remaining',v_remaining);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_prepare_automatic_application_profiles(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_prepare_automatic_application_profiles(uuid,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_claim_automatic_class_workbook_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_claim jsonb; v_check jsonb;
  v_authority plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
BEGIN
  FOR candidate_number IN 1..16 LOOP
    v_claim:=plugin_data.csf_claim_sheet_automatic_update_check('class_history');
    IF v_claim->>'claimed' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('claimed',false); END IF;
    SELECT * INTO STRICT v_authority FROM plugin_data.csf_sheet_automatic_update_authorizations
      WHERE id=(v_claim->>'authorizationId')::uuid AND organization_id=(v_claim->>'organizationId')::uuid;
    SELECT * INTO v_source FROM plugin_data.csf_sheet_sources
      WHERE id=v_authority.source_id AND organization_id=v_authority.organization_id;
    SELECT * INTO v_workbook FROM plugin_data.csf_class_workbooks
      WHERE organization_id=v_authority.organization_id AND cohort_id=v_source.cohort_id;
    IF NOT FOUND OR v_workbook.drive_file_id IS DISTINCT FROM v_authority.source_file_id
      OR v_workbook.drive_owner_user_id IS DISTINCT FROM v_authority.google_owner_user_id
      OR v_workbook.state='unlinked' THEN
      UPDATE plugin_data.csf_sheet_automatic_update_authorizations
        SET status='blocked',last_error_code='class_workbook_changed',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE id=v_authority.id;
      CONTINUE;
    END IF;
    IF v_workbook.state='linked' AND v_workbook.last_checked_at>now()-interval '5 minutes' THEN
      UPDATE plugin_data.csf_sheet_automatic_update_authorizations
        SET next_check_at=v_workbook.last_checked_at+interval '5 minutes',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE id=v_authority.id;
      CONTINUE;
    END IF;
    v_check:=plugin_data.csf_claim_class_workbook_check(v_authority.organization_id,v_source.cohort_id,v_authority.authorized_by,300);
    IF v_check->>'status' IS DISTINCT FROM 'leased' THEN
      UPDATE plugin_data.csf_sheet_automatic_update_authorizations
        SET status=CASE WHEN v_check->>'status'='unchanged' THEN 'active' ELSE 'blocked' END,
          last_error_code=CASE WHEN v_check->>'status'='unchanged' THEN NULL ELSE 'class_workbook_check_blocked' END,
          next_check_at=now()+interval '5 minutes',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
        WHERE id=v_authority.id;
      CONTINUE;
    END IF;
    IF v_check->>'workbookId' IS DISTINCT FROM v_workbook.id::text
      OR v_check->>'driveFileId' IS DISTINCT FROM v_authority.source_file_id
      OR v_check->>'ownerUserId' IS DISTINCT FROM v_authority.google_owner_user_id::text THEN
      RAISE EXCEPTION 'The workbook changed during its automatic check.' USING ERRCODE='55000';
    END IF;
    RETURN v_claim || jsonb_build_object('workbookId',v_workbook.id,
      'workbookLeaseToken',v_check->>'leaseToken','cohortId',v_source.cohort_id);
  END LOOP;
  RETURN jsonb_build_object('claimed',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_automatic_class_workbook_check() FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_automatic_class_workbook_check() TO service_role;

CREATE FUNCTION plugin_data.csf_finish_automatic_class_workbook_check(
  p_organization_id uuid,p_authorization_id uuid,p_generation bigint,p_lease_token uuid,
  p_workbook_id uuid,p_workbook_lease_token uuid,p_outcome text,p_provider_version text,p_provider_modified_at text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_lease jsonb; v_result jsonb;
  v_authority plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('available','needs_reconnect','blocked','retryable') THEN
    RAISE EXCEPTION 'Choose a supported workbook metadata result.' USING ERRCODE='22023';
  END IF;
  v_lease:=plugin_data.csf_assert_sheet_automatic_update_lease(p_organization_id,p_authorization_id,p_generation,p_lease_token);
  IF v_lease->>'valid' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('finished',false); END IF;
  SELECT * INTO STRICT v_authority FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND id=p_authorization_id;
  IF v_authority.source_type<>'class_history' OR NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_class_workbooks w JOIN plugin_data.csf_sheet_sources s
      ON s.organization_id=w.organization_id AND s.cohort_id=w.cohort_id
    WHERE w.organization_id=p_organization_id AND w.id=p_workbook_id AND s.id=v_authority.source_id
      AND w.drive_file_id=v_authority.source_file_id AND w.drive_owner_user_id=v_authority.google_owner_user_id
      AND w.check_lease_token=p_workbook_lease_token AND w.check_lease_expires_at>now()
      AND w.state<>'unlinked'
  ) THEN RAISE EXCEPTION 'The workbook metadata lease is no longer current.' USING ERRCODE='55000'; END IF;
  IF p_outcome='available' THEN
    v_result:=plugin_data.csf_complete_class_workbook_check(p_organization_id,p_workbook_id,
      v_authority.authorized_by,p_workbook_lease_token,p_provider_version,p_provider_modified_at);
    IF v_result->>'status' NOT IN ('queued','unchanged') OR v_result->>'status' IS NULL THEN
      RAISE EXCEPTION 'The workbook metadata result could not be confirmed.' USING ERRCODE='55000';
    END IF;
  ELSIF p_outcome IN ('needs_reconnect','blocked') THEN
    v_result:=plugin_data.csf_fail_class_workbook_check(p_organization_id,p_workbook_id,
      v_authority.authorized_by,p_workbook_lease_token,p_outcome,
      CASE WHEN p_outcome='needs_reconnect' THEN 'google_access_missing' ELSE 'workbook_metadata_unavailable' END);
  ELSE
    -- A transient provider failure leaves the workbook check lease to expire.
    -- It neither queues preparation nor changes the saved source revision.
    v_result:=jsonb_build_object('status','retryable');
  END IF;
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET status=CASE WHEN p_outcome IN ('needs_reconnect','blocked') THEN p_outcome ELSE 'active' END,
      last_error_code=CASE WHEN p_outcome='available' THEN NULL ELSE p_outcome END,
      next_check_at=now()+interval '5 minutes',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE organization_id=p_organization_id AND id=p_authorization_id;
  RETURN v_result || jsonb_build_object('finished',true);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_automatic_class_workbook_check(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_automatic_class_workbook_check(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text) TO service_role;
CREATE FUNCTION plugin_data.csf_queue_automatic_class_preview(p_organization_id uuid,p_preview_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_auth plugin_data.csf_sheet_automatic_update_authorizations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  SELECT * INTO v_preview FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=p_preview_job_id AND mode='preview' AND source_type='class_history';
  IF NOT FOUND THEN RAISE EXCEPTION 'This class preview is no longer available.' USING ERRCODE='23503'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf_source_auto:'||p_organization_id::text||':'||v_preview.source_id::text,0));
  SELECT * INTO v_auth FROM plugin_data.csf_sheet_automatic_update_authorizations
    WHERE organization_id=p_organization_id AND source_id=v_preview.source_id;
  IF NOT FOUND OR v_preview.mapping_snapshot->>'automaticUpdateAuthorizationId' IS DISTINCT FROM v_auth.id::text
    OR v_preview.mapping_snapshot->>'automaticUpdateGeneration' IS DISTINCT FROM v_auth.generation::text
    OR plugin_data.csf_sheet_automatic_update_authorization_current(p_organization_id,v_auth.id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Automatic updates changed. Review this Sheet before importing.' USING ERRCODE='55000';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor_for_job(p_organization_id,v_auth.authorized_by,p_preview_job_id);
  PERFORM plugin_data.csf_lock_import_commit_coordinate(p_organization_id,p_preview_job_id,true);
  PERFORM plugin_data.csf_assert_import_preview_workbook_generation_current(p_organization_id,p_preview_job_id);
  IF EXISTS (SELECT 1 FROM plugin_data.csf_sheet_import_jobs newer
    WHERE newer.organization_id=p_organization_id AND newer.id=v_auth.last_preview_job_id
      AND newer.source_id=v_preview.source_id AND newer.created_at>v_preview.created_at) THEN
    RAISE EXCEPTION 'A newer class preview is already prepared.' USING ERRCODE='55000';
  END IF;
  UPDATE plugin_data.csf_sheet_automatic_update_authorizations
    SET last_preview_job_id=p_preview_job_id,last_provider_version=v_preview.source_file_metadata->>'version',updated_at=now()
    WHERE organization_id=p_organization_id AND id=v_auth.id;
  -- Queueing repeats the consent, snapshot, identity, and immutable-row checks.
  -- A refusal rolls the checkpoint back with the attempted queue transaction.
  RETURN plugin_data.csf_queue_automatic_import_preview(p_organization_id,p_preview_job_id);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_automatic_class_preview(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_automatic_class_preview(uuid,uuid) TO service_role;
CREATE FUNCTION plugin_data.csf_dispatch_automatic_class_preview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_candidate record; v_current uuid; v_result jsonb;
BEGIN
  FOR v_candidate IN
    SELECT a.id AS authorization_id,a.organization_id,a.source_id,p.id AS preview_id
    FROM plugin_data.csf_sheet_automatic_update_authorizations a
    CROSS JOIN LATERAL (
      SELECT preview.id,preview.mapping_snapshot FROM plugin_data.csf_sheet_import_jobs preview
      WHERE preview.organization_id=a.organization_id AND preview.source_id=a.source_id
        AND preview.mode='preview' AND preview.source_type='class_history'
        AND preview.status IN ('completed','needs_resolution')
        AND preview.mapping_snapshot->>'automaticUpdateAuthorizationId'=a.id::text
        AND preview.mapping_snapshot->>'automaticUpdateGeneration'=a.generation::text
      ORDER BY preview.created_at DESC,preview.id DESC LIMIT 1
    ) p
    JOIN plugin_data.csf_class_workbook_refresh_jobs j ON j.organization_id=a.organization_id
      AND j.id::text=p.mapping_snapshot->>'workbookRefreshJobId' AND j.status='completed'
    JOIN plugin_data.csf_class_workbooks w ON w.organization_id=j.organization_id AND w.id=j.workbook_id
      AND w.state='linked' AND w.provider_version=j.provider_version AND w.last_prepared_version=j.provider_version
    WHERE a.status='active' AND a.source_type='class_history' AND a.last_preview_job_id IS DISTINCT FROM p.id
    ORDER BY a.next_check_at,a.id LIMIT 16
  LOOP
    IF NOT pg_try_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(v_candidate.organization_id)) THEN CONTINUE; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('csf_source_auto:'||v_candidate.organization_id::text||':'||v_candidate.source_id::text,0)) THEN CONTINUE; END IF;
    SELECT last_preview_job_id INTO v_current FROM plugin_data.csf_sheet_automatic_update_authorizations
      WHERE id=v_candidate.authorization_id AND organization_id=v_candidate.organization_id AND status='active' FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_current=v_candidate.preview_id THEN CONTINUE; END IF;
    BEGIN
      v_result:=plugin_data.csf_queue_automatic_class_preview(v_candidate.organization_id,v_candidate.preview_id);
      IF v_result->>'queued'='1' OR v_result->>'completed'='1' THEN
        RETURN jsonb_build_object('status','queued','claimed',1,'queued',1);
      ELSIF v_result->>'queued'='0' AND v_result->>'needsAttention'='true' THEN
        RETURN jsonb_build_object('status','needs_attention','claimed',1,'queued',0);
      END IF;
      RAISE EXCEPTION 'The automatic class queue result could not be confirmed.' USING ERRCODE='XX000';
    EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE '42501' OR SQLSTATE '23514' OR SQLSTATE '22023' THEN
      UPDATE plugin_data.csf_sheet_automatic_update_authorizations
        SET status='blocked',last_error_code='class_preview_needs_review',updated_at=now()
        WHERE id=v_candidate.authorization_id AND organization_id=v_candidate.organization_id;
      RETURN jsonb_build_object('status','blocked','claimed',1,'queued',0);
    END;
  END LOOP;
  RETURN jsonb_build_object('status','idle','claimed',0,'queued',0);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_dispatch_automatic_class_preview() FROM PUBLIC,anon,authenticated,service_role,postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_dispatch_automatic_class_preview() TO service_role;
COMMIT;
