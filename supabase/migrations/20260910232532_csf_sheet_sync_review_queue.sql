-- Queue versioned Sheet exports and staff-reviewed inbound changes behind private destination leases.
BEGIN;

CREATE TABLE plugin_data.csf_sheet_sync_test_workspaces (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  registered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_data.csf_sheet_sync_test_files (
 copied_file_id text PRIMARY KEY CHECK(length(copied_file_id) BETWEEN 8 AND 200),
 organization_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_sync_test_workspaces(organization_id) ON DELETE CASCADE,
 source_file_id text NOT NULL CHECK(length(source_file_id) BETWEEN 8 AND 200),
 registered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,registered_at timestamptz NOT NULL DEFAULT now(),
 CHECK(copied_file_id<>source_file_id), UNIQUE(organization_id,copied_file_id)
);
ALTER TABLE plugin_data.csf_sheet_sync_test_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_test_files FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_sync_test_files TO service_role;

CREATE TABLE plugin_data.csf_sheet_sync_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  spreadsheet_file_id text NOT NULL CHECK (length(spreadsheet_file_id) BETWEEN 8 AND 200),
  sheet_id integer NOT NULL CHECK (sheet_id >= 0),
  kind text NOT NULL CHECK (kind IN ('applications','class','point_submissions')),
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id), term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id),
  CONSTRAINT csf_sheet_sync_class_requires_cohort CHECK(kind<>'class' OR cohort_id IS NOT NULL),
  is_test boolean NOT NULL, enabled boolean NOT NULL DEFAULT false,
  configured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  privacy_verified_at timestamptz, comment_capability text NOT NULL DEFAULT 'pending' CHECK (comment_capability IN ('pending','available','blocked')),
  owned_start_column integer NOT NULL DEFAULT 0 CHECK(owned_start_column>=0),
  managed_headers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(managed_headers)='array'),
  poll_lease_token uuid, poll_lease_expires_at timestamptz,
  seed_cursor uuid, seed_completed boolean NOT NULL DEFAULT false,
  next_poll_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(cohort_id,organization_id) REFERENCES plugin_data.csf_cohorts(id,organization_id), FOREIGN KEY(term_id,organization_id) REFERENCES plugin_data.csf_terms(id,organization_id),
  UNIQUE (organization_id,id), UNIQUE(spreadsheet_file_id,sheet_id), CHECK (NOT enabled OR (privacy_verified_at IS NOT NULL AND comment_capability='available'))
);
CREATE TABLE plugin_data.csf_sheet_sync_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  destination_id uuid NOT NULL, record_kind text NOT NULL CHECK(record_kind IN ('application','point_submission','profile')),
  record_id uuid NOT NULL, profile_id uuid, scope_revision bigint NOT NULL DEFAULT 0 CHECK(scope_revision>=0), logical_key text NOT NULL, sheet_id integer NOT NULL CHECK(sheet_id>=0),
  last_export_version text, remote_version text, last_seen_request jsonb NOT NULL DEFAULT '{}'::jsonb, last_seen_request_source_version text, thread_bindings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(thread_bindings)='object'),
  UNIQUE(destination_id,record_kind,record_id), UNIQUE(destination_id,logical_key), UNIQUE(organization_id,destination_id,id),
  FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX csf_sheet_sync_bindings_org_profile ON plugin_data.csf_sheet_sync_bindings(organization_id,profile_id);
CREATE INDEX csf_sheet_sync_bindings_org_record ON plugin_data.csf_sheet_sync_bindings(organization_id,record_kind,record_id);
ALTER TABLE plugin_data.csf_sheet_writeback_ledger
  ALTER COLUMN application_id DROP NOT NULL, ALTER COLUMN row_number DROP NOT NULL, ALTER COLUMN decision DROP NOT NULL,
  DROP CONSTRAINT csf_sheet_writeback_ledger_status_check,
  ADD COLUMN destination_id uuid REFERENCES plugin_data.csf_sheet_sync_destinations(id) ON DELETE CASCADE,
  ADD COLUMN record_kind text CHECK(record_kind IN ('application','point_submission','profile')),
  ADD COLUMN record_id uuid, ADD COLUMN source_version text, ADD COLUMN payload jsonb,
  ADD COLUMN lease_token uuid, ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT csf_sheet_writeback_ledger_status_check CHECK(status IN ('queued','sent','failed','pending_export','exporting','exported','retry_export','unknown_outcome','superseded')),
  ADD CONSTRAINT csf_sheet_writeback_shape CHECK(
    (destination_id IS NULL AND application_id IS NOT NULL AND row_number IS NOT NULL AND decision IS NOT NULL AND record_kind IS NULL AND status IN ('queued','sent','failed'))
    OR (destination_id IS NOT NULL AND application_id IS NULL AND record_kind IS NOT NULL AND record_id IS NOT NULL AND source_version IS NOT NULL AND payload IS NOT NULL AND status IN ('pending_export','exporting','exported','retry_export','unknown_outcome','superseded'))),
  ADD CONSTRAINT csf_sheet_writeback_destination_org_fk FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE;
ALTER TABLE plugin_data.csf_sheet_writeback_ledger ADD CONSTRAINT csf_sheet_export_payload_version CHECK(destination_id IS NULL OR source_version=md5(payload::text));
CREATE FUNCTION plugin_data.csf_guard_sheet_sync_export_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (OLD.destination_id IS NOT NULL OR NEW.destination_id IS NOT NULL) AND
  (to_jsonb(NEW)-ARRAY['status','attempts','last_error','sent_at','updated_at','lease_token','lease_expires_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','attempts','last_error','sent_at','updated_at','lease_token','lease_expires_at']) THEN
  RAISE EXCEPTION 'Queued export identity and snapshot are immutable.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_sheet_sync_export_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER csf_sheet_export_snapshot_immutable BEFORE UPDATE ON plugin_data.csf_sheet_writeback_ledger FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_export_snapshot();
REVOKE ALL ON plugin_data.csf_sheet_writeback_ledger FROM service_role;
GRANT SELECT ON plugin_data.csf_sheet_writeback_ledger TO service_role;
CREATE UNIQUE INDEX csf_sheet_export_version_unique ON plugin_data.csf_sheet_writeback_ledger(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL;
CREATE INDEX csf_sheet_export_pending ON plugin_data.csf_sheet_writeback_ledger(destination_id,created_at) WHERE status IN ('pending_export','retry_export','exporting','unknown_outcome');
CREATE TABLE plugin_data.csf_sheet_sync_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, destination_id uuid NOT NULL,
  record_kind text NOT NULL CHECK(record_kind IN ('application','point_submission')),
  record_id uuid NOT NULL, source_version text NOT NULL, remote_version text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','discarded','stale')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, review_reason text, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(destination_id,record_kind,record_id,remote_version,source_version),
  FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['csf_sheet_sync_test_workspaces','csf_sheet_sync_destinations','csf_sheet_sync_bindings','csf_sheet_sync_changes'] LOOP
    EXECUTE format('ALTER TABLE plugin_data.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON plugin_data.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT ON plugin_data.%I TO service_role',t);
  END LOOP;
END $$;

CREATE FUNCTION plugin_data.csf_sheet_file_has_other_workspace(p_organization_id uuid,p_file_id text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sources r WHERE r.organization_id<>p_organization_id AND (r.spreadsheet_id=p_file_id OR r.drive_file_id=p_file_id)) OR EXISTS(SELECT 1 FROM plugin_data.csf_class_workbooks r WHERE r.organization_id<>p_organization_id AND r.drive_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_import_jobs r WHERE r.organization_id<>p_organization_id AND r.source_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_term_applications r WHERE r.organization_id<>p_organization_id AND r.source_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger r WHERE r.organization_id<>p_organization_id AND r.spreadsheet_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations r WHERE r.organization_id<>p_organization_id AND r.spreadsheet_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_class_workbook_refresh_jobs r WHERE r.organization_id<>p_organization_id AND r.drive_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_automatic_update_authorizations r WHERE r.organization_id<>p_organization_id AND r.source_file_id=p_file_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links r WHERE r.organization_id<>p_organization_id AND r.source_file_id=p_file_id);
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_file_has_other_workspace(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION plugin_data.csf_register_sheet_sync_test_workspace(p_organization_id uuid,p_actor_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_settings') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=p_organization_id) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sources WHERE organization_id=p_organization_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_class_workbooks WHERE organization_id=p_organization_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_import_jobs WHERE organization_id=p_organization_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Register an empty test workspace before copying records.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_test_workspaces VALUES(p_organization_id,p_actor_user_id,now());
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_workspace_registered','sheet_sync_test_workspace',p_organization_id,jsonb_build_object('organization_id',p_organization_id,'registered_by',p_actor_user_id));
END $$;

CREATE FUNCTION plugin_data.csf_register_sheet_sync_test_file(p_organization_id uuid,p_actor_user_id uuid,p_copied_file_id text,p_source_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f plugin_data.csf_sheet_sync_test_files%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Register an isolated test workspace first.'; END IF;
 IF p_copied_file_id IS NULL OR p_source_file_id IS NULL OR p_copied_file_id=p_source_file_id THEN RAISE EXCEPTION 'Register the new copied file, not its source.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||p_copied_file_id,0));
 SELECT * INTO f FROM plugin_data.csf_sheet_sync_test_files WHERE copied_file_id=p_copied_file_id;
 IF FOUND THEN
  IF f.organization_id<>p_organization_id OR f.source_file_id<>p_source_file_id THEN RAISE EXCEPTION 'The copied file is already registered to another source or workspace.'; END IF;
  RETURN to_jsonb(f);
 END IF;
 IF plugin_data.csf_sheet_file_has_other_workspace(p_organization_id,p_copied_file_id) THEN RAISE EXCEPTION 'This file is already used by a live workspace.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_test_files(copied_file_id,organization_id,source_file_id,registered_by) VALUES(p_copied_file_id,p_organization_id,p_source_file_id,p_actor_user_id) RETURNING * INTO f;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_copy_registered','sheet_sync_test_file',to_jsonb(f));
 RETURN to_jsonb(f);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_register_sheet_sync_test_file(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_sheet_sync_test_file(uuid,uuid,text,text) TO service_role;
CREATE TABLE plugin_data.csf_sheet_sync_test_copy_requests (
 request_id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_sync_test_workspaces(organization_id) ON DELETE CASCADE,
 source_organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,source_file_id text NOT NULL CHECK(length(source_file_id) BETWEEN 8 AND 200),
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,provider_subject text CHECK(provider_subject IS NULL OR length(btrim(provider_subject)) BETWEEN 1 AND 255),state text NOT NULL CHECK(state IN ('claimed','completed','unknown','not_created')),
 copied_file_id text REFERENCES plugin_data.csf_sheet_sync_test_files(copied_file_id) ON DELETE CASCADE,observed_copied_file_id text CHECK(length(observed_copied_file_id) BETWEEN 8 AND 200),last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(organization_id<>source_organization_id),CHECK((state='completed')=(copied_file_id IS NOT NULL))
);
CREATE UNIQUE INDEX csf_sheet_copy_active_source ON plugin_data.csf_sheet_sync_test_copy_requests(organization_id,source_organization_id,source_file_id) WHERE state<>'not_created';
ALTER TABLE plugin_data.csf_sheet_sync_test_copy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_test_copy_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_sync_test_copy_requests TO service_role;
CREATE FUNCTION plugin_data.csf_claim_sheet_sync_test_copy(p_organization_id uuid,p_actor_user_id uuid,p_source_organization_id uuid,p_source_file_id text,p_request_id uuid,p_provider_subject text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r plugin_data.csf_sheet_sync_test_copy_requests%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(k) FROM (SELECT DISTINCT plugin_data.csf_staff_access_lock_key(x) k FROM unnest(ARRAY[p_organization_id,p_source_organization_id]) x ORDER BY k) locks;
 IF p_request_id IS NULL OR p_organization_id=p_source_organization_id OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Choose an isolated test workspace and a stable copy request.'; END IF;
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports') AND plugin_data.csf_actor_has_permission(p_source_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_source_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-test-copy:'||p_organization_id::text||':'||p_source_organization_id::text||':'||p_source_file_id,0));
 IF p_provider_subject IS NULL OR length(btrim(p_provider_subject)) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'Verify the original Google account before copying.'; END IF;
 SELECT * INTO r FROM plugin_data.csf_sheet_sync_test_copy_requests WHERE request_id=p_request_id;
 IF FOUND AND (r.organization_id<>p_organization_id OR r.source_organization_id<>p_source_organization_id OR r.source_file_id<>p_source_file_id OR r.actor_user_id IS DISTINCT FROM p_actor_user_id) THEN RAISE EXCEPTION 'Copy request conflicts with its previous use.'; END IF;
 IF FOUND AND (r.actor_user_id IS DISTINCT FROM p_actor_user_id OR r.provider_subject IS NULL OR r.provider_subject IS DISTINCT FROM p_provider_subject) THEN RAISE EXCEPTION 'Google account does not match the original copy request. Keep this attempt on hold.'; END IF;
 IF FOUND AND r.state='not_created' THEN RETURN to_jsonb(r); END IF;
 SELECT * INTO r FROM plugin_data.csf_sheet_sync_test_copy_requests WHERE organization_id=p_organization_id AND source_organization_id=p_source_organization_id AND source_file_id=p_source_file_id AND state<>'not_created' FOR UPDATE;
 IF FOUND AND (r.actor_user_id IS DISTINCT FROM p_actor_user_id OR r.provider_subject IS NULL OR r.provider_subject IS DISTINCT FROM p_provider_subject) THEN RAISE EXCEPTION 'Google account does not match the original copy request. Keep this attempt on hold.'; END IF;
 IF FOUND THEN RETURN jsonb_build_object('state',CASE WHEN r.state='completed' THEN 'completed' ELSE 'unknown' END,'request_id',r.request_id,'copied_file_id',r.copied_file_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sources s WHERE s.organization_id=p_source_organization_id AND (s.spreadsheet_id=p_source_file_id OR s.drive_file_id=p_source_file_id)) AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations d WHERE d.organization_id=p_source_organization_id AND NOT d.is_test AND d.spreadsheet_file_id=p_source_file_id) THEN RAISE EXCEPTION 'Choose a registered source or configured live workbook in the source organization.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_test_copy_requests(request_id,organization_id,source_organization_id,source_file_id,actor_user_id,provider_subject,state) VALUES(p_request_id,p_organization_id,p_source_organization_id,p_source_file_id,p_actor_user_id,p_provider_subject,'claimed') RETURNING * INTO r;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_copy_claimed','sheet_sync_test_copy',r.request_id,to_jsonb(r));
 RETURN jsonb_build_object('state','claimed','request_id',r.request_id,'copied_file_id',NULL);
END $$;
CREATE FUNCTION plugin_data.csf_finish_sheet_sync_test_copy(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_copied_file_id text,p_outcome text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r plugin_data.csf_sheet_sync_test_copy_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM plugin_data.csf_sheet_sync_test_copy_requests WHERE request_id=p_request_id AND organization_id=p_organization_id AND actor_user_id=p_actor_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Copy request not found.'; END IF;
 PERFORM pg_advisory_xact_lock(k) FROM (SELECT DISTINCT plugin_data.csf_staff_access_lock_key(x) k FROM unnest(ARRAY[p_organization_id,r.source_organization_id]) x ORDER BY k) locks;
 IF p_outcome NOT IN ('completed','unknown') THEN RAISE EXCEPTION 'Invalid copy outcome.'; END IF;
 SELECT * INTO r FROM plugin_data.csf_sheet_sync_test_copy_requests WHERE request_id=p_request_id AND organization_id=p_organization_id AND actor_user_id=p_actor_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Copy request not found.'; END IF;
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports') AND plugin_data.csf_actor_has_permission(r.source_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(r.source_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF r.state='not_created' THEN RAISE EXCEPTION 'This copy attempt was closed after staff review.'; END IF;
 IF r.state='completed' THEN
  IF p_outcome<>'completed' OR r.copied_file_id IS DISTINCT FROM p_copied_file_id THEN RAISE EXCEPTION 'Completed copy has a different outcome.'; END IF;
  RETURN to_jsonb(r);
 END IF;
 IF r.observed_copied_file_id IS NOT NULL AND p_copied_file_id IS NOT NULL AND r.observed_copied_file_id IS DISTINCT FROM p_copied_file_id THEN RAISE EXCEPTION 'Copy receipt conflicts with the previously observed file.'; END IF;
 IF p_outcome='completed' THEN PERFORM plugin_data.csf_register_sheet_sync_test_file(p_organization_id,p_actor_user_id,p_copied_file_id,r.source_file_id);
 END IF;
 UPDATE plugin_data.csf_sheet_sync_test_copy_requests SET state=p_outcome,copied_file_id=CASE WHEN p_outcome='completed' THEN p_copied_file_id END,observed_copied_file_id=coalesce(p_copied_file_id,observed_copied_file_id),last_error=left(p_error,1000),updated_at=now() WHERE request_id=r.request_id RETURNING * INTO r;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_copy_finished','sheet_sync_test_copy',r.request_id,to_jsonb(r));
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_sync_test_copy(uuid,uuid,uuid,text,uuid,text),plugin_data.csf_finish_sheet_sync_test_copy(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_sync_test_copy(uuid,uuid,uuid,text,uuid,text),plugin_data.csf_finish_sheet_sync_test_copy(uuid,uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION plugin_data.csf_reconcile_sheet_sync_test_copy_no_write(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_reason text,p_evidence jsonb,p_provider_subject text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r plugin_data.csf_sheet_sync_test_copy_requests%ROWTYPE; before_row jsonb;
BEGIN
 SELECT * INTO r FROM plugin_data.csf_sheet_sync_test_copy_requests WHERE organization_id=p_organization_id AND request_id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Copy request not found.'; END IF;
 PERFORM pg_advisory_xact_lock(k) FROM (SELECT DISTINCT plugin_data.csf_staff_access_lock_key(x) k FROM unnest(ARRAY[p_organization_id,r.source_organization_id]) x ORDER BY k) locks;
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_settings') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports') AND plugin_data.csf_actor_has_permission(r.source_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(r.source_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-test-copy:'||p_organization_id::text||':'||r.source_organization_id::text||':'||r.source_file_id,0));
 SELECT * INTO r FROM plugin_data.csf_sheet_sync_test_copy_requests WHERE organization_id=p_organization_id AND request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Copy request not found.'; END IF;
 IF r.actor_user_id IS DISTINCT FROM p_actor_user_id OR p_provider_subject IS NULL OR r.provider_subject IS NULL OR r.provider_subject IS DISTINCT FROM p_provider_subject THEN RAISE EXCEPTION 'Google account does not match the original copy request. Keep this attempt on hold.'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR p_evidence->'provider_request_ended' IS DISTINCT FROM 'true'::jsonb OR p_evidence->'no_file_created' IS DISTINCT FROM 'true'::jsonb OR p_evidence->>'request_id' IS DISTINCT FROM p_request_id::text OR p_evidence->'matching_file_count' IS DISTINCT FROM '0'::jsonb THEN RAISE EXCEPTION 'Record the completed provider inspection and why no file was created.'; END IF;
 IF r.state='not_created' THEN RETURN to_jsonb(r); END IF;
 IF (r.state<>'unknown' AND NOT (r.state='claimed' AND r.created_at<=clock_timestamp()-interval '10 minutes')) OR r.copied_file_id IS NOT NULL OR r.observed_copied_file_id IS NOT NULL THEN RAISE EXCEPTION 'Only an unresolved attempt without a known file can be closed.'; END IF;
 before_row:=to_jsonb(r);
 UPDATE plugin_data.csf_sheet_sync_test_copy_requests SET state='not_created',updated_at=now() WHERE request_id=r.request_id RETURNING * INTO r;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,before_data,after_data,reason_code) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_copy_not_created','sheet_sync_test_copy',r.request_id,before_row,to_jsonb(r)||jsonb_build_object('inspection',p_evidence),p_reason);
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_sync_test_copy_no_write(uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_sync_test_copy_no_write(uuid,uuid,uuid,text,jsonb,text) TO service_role;

CREATE FUNCTION plugin_data.csf_guard_sheet_sync_test_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb:=to_jsonb(NEW); file_id text; field text; org uuid:=(r->>'organization_id')::uuid; is_test boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=org) INTO is_test;
 FOREACH field IN ARRAY TG_ARGV LOOP
  file_id:=nullif(r->>field,'');
  IF file_id IS NULL THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||file_id,0));
  IF is_test AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_files WHERE organization_id=org AND copied_file_id=file_id) THEN RAISE EXCEPTION 'Test workspaces can use only registered copied files.'; END IF;
  IF NOT is_test AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_files WHERE copied_file_id=file_id) THEN RAISE EXCEPTION 'Test copies cannot be used by live workspaces.'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id<>org AND spreadsheet_file_id=file_id) THEN RAISE EXCEPTION 'This spreadsheet belongs to another workspace.'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_sheet_sync_test_file() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER csf_sheet_test_sources BEFORE INSERT OR UPDATE OF drive_file_id,spreadsheet_id,organization_id ON plugin_data.csf_sheet_sources FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('drive_file_id','spreadsheet_id');
CREATE TRIGGER csf_sheet_test_workbooks BEFORE INSERT OR UPDATE OF drive_file_id,organization_id ON plugin_data.csf_class_workbooks FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('drive_file_id');
CREATE TRIGGER csf_sheet_test_imports BEFORE INSERT OR UPDATE OF source_file_id,organization_id ON plugin_data.csf_sheet_import_jobs FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('source_file_id');
CREATE TRIGGER csf_sheet_test_applications BEFORE INSERT OR UPDATE OF source_file_id,organization_id ON plugin_data.csf_term_applications FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('source_file_id');
CREATE TRIGGER csf_sheet_test_writeback BEFORE INSERT OR UPDATE OF spreadsheet_file_id,organization_id ON plugin_data.csf_sheet_writeback_ledger FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('spreadsheet_file_id');
CREATE TRIGGER csf_sheet_test_refresh_jobs BEFORE INSERT OR UPDATE OF drive_file_id,organization_id ON plugin_data.csf_class_workbook_refresh_jobs FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('drive_file_id');
CREATE TRIGGER csf_sheet_test_automatic_updates BEFORE INSERT OR UPDATE OF source_file_id,organization_id ON plugin_data.csf_sheet_automatic_update_authorizations FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('source_file_id');
CREATE TRIGGER csf_sheet_test_reviewed_links BEFORE INSERT OR UPDATE OF source_file_id,organization_id ON plugin_data.csf_reviewed_workbook_profile_links FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('source_file_id');
CREATE TRIGGER csf_sheet_test_destinations BEFORE INSERT OR UPDATE OF spreadsheet_file_id,organization_id ON plugin_data.csf_sheet_sync_destinations FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_sheet_sync_test_file('spreadsheet_file_id');

CREATE FUNCTION plugin_data.csf_configure_sheet_sync_destination(p_organization_id uuid,p_actor_user_id uuid,p_spreadsheet_file_id text,p_sheet_id integer,p_kind text,p_cohort_id uuid,p_term_id uuid,p_is_test boolean,p_owned_start_column integer DEFAULT 0,p_managed_headers jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF p_kind='class' AND p_cohort_id IS NULL THEN RAISE EXCEPTION 'Choose a class for this workbook.'; END IF;
 IF p_kind='class' AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_cohort_terms WHERE organization_id=p_organization_id AND cohort_id=p_cohort_id AND term_id=p_term_id) THEN RAISE EXCEPTION 'This semester is not configured for this class.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_terms WHERE id=p_term_id AND organization_id=p_organization_id) OR (p_cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_cohorts WHERE id=p_cohort_id AND organization_id=p_organization_id)) THEN RAISE EXCEPTION 'Semester or class does not belong to this organization.'; END IF;
 IF p_is_test IS DISTINCT FROM EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Test destinations require an isolated test workspace.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||p_spreadsheet_file_id,0));
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE spreadsheet_file_id=p_spreadsheet_file_id AND organization_id<>p_organization_id) THEN RAISE EXCEPTION 'This spreadsheet belongs to another workspace.'; END IF;
 IF NOT p_is_test AND plugin_data.csf_sheet_file_has_other_workspace(p_organization_id,p_spreadsheet_file_id) THEN RAISE EXCEPTION 'This spreadsheet belongs to another workspace.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE spreadsheet_file_id=p_spreadsheet_file_id AND sheet_id=p_sheet_id;
 IF FOUND THEN
   IF d.organization_id<>p_organization_id OR d.sheet_id<>p_sheet_id OR d.kind<>p_kind OR d.cohort_id IS DISTINCT FROM p_cohort_id OR d.term_id<>p_term_id OR d.is_test<>p_is_test OR d.owned_start_column<>p_owned_start_column OR d.managed_headers<>p_managed_headers THEN RAISE EXCEPTION 'This spreadsheet is already bound to a different destination.'; END IF;
   RETURN to_jsonb(d);
 END IF;
 INSERT INTO plugin_data.csf_sheet_sync_destinations(organization_id,spreadsheet_file_id,sheet_id,kind,cohort_id,term_id,is_test,configured_by,owned_start_column,managed_headers)
 VALUES(p_organization_id,p_spreadsheet_file_id,p_sheet_id,p_kind,p_cohort_id,p_term_id,p_is_test,p_actor_user_id,p_owned_start_column,p_managed_headers) RETURNING * INTO d;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.destination_configured','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;

CREATE FUNCTION plugin_data.csf_set_sheet_sync_destination_state(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_enabled boolean,p_privacy_verified boolean,p_comment_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF p_enabled AND NOT d.is_test AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_acceptances a WHERE a.organization_id=p_organization_id AND a.destination_id=d.id AND a.reviewed_by IS NOT NULL AND a.configuration=jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',d.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id))) AND NOT EXISTS(SELECT 1 FROM jsonb_each(a.evidence->'test_configurations') cfg WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id::text=cfg.key AND t.organization_id=a.test_organization_id AND cfg.value=jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',t.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))))) THEN RAISE EXCEPTION 'Review a complete copied-workbook test journey before enabling live sync.'; END IF;
 UPDATE plugin_data.csf_sheet_sync_destinations SET seed_cursor=CASE WHEN p_enabled AND NOT enabled THEN NULL ELSE seed_cursor END,seed_completed=CASE WHEN p_enabled AND NOT enabled THEN false ELSE seed_completed END,poll_lease_token=NULL,poll_lease_expires_at=NULL,enabled=p_enabled,privacy_verified_at=CASE WHEN p_privacy_verified THEN now() END,comment_capability=p_comment_capability,configured_by=p_actor_user_id,updated_at=now()
 WHERE organization_id=p_organization_id AND id=p_destination_id RETURNING * INTO d;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.destination_state','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;

CREATE TABLE plugin_data.csf_sheet_sync_local_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,destination_id uuid NOT NULL,binding_id uuid NOT NULL,
 author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,provider_thread_id text,body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),resolved boolean,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,destination_id,binding_id) REFERENCES plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,id) ON DELETE CASCADE
);
ALTER TABLE plugin_data.csf_sheet_sync_local_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_local_messages FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_sync_local_messages TO service_role;

CREATE FUNCTION plugin_data.csf_sheet_sync_snapshot(p_organization_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; n jsonb;
BEGIN
 IF p_record_kind='application' THEN
   SELECT to_jsonb(a) INTO r FROM plugin_data.csf_term_applications a WHERE id=p_record_id AND organization_id=p_organization_id;
 ELSIF p_record_kind='point_submission' THEN
   SELECT to_jsonb(s) INTO r FROM plugin_data.csf_point_submissions s WHERE id=p_record_id AND organization_id=p_organization_id;
 ELSIF p_record_kind='profile' THEN
   SELECT to_jsonb(p) || jsonb_build_object('accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM plugin_data.csf_profile_accounts a WHERE a.organization_id=p_organization_id AND a.profile_id=p.id),'[]'::jsonb),'memberships',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM plugin_data.csf_term_memberships m WHERE m.organization_id=p_organization_id AND m.profile_id=p.id),'[]'::jsonb)) INTO r
   FROM plugin_data.csf_profiles p WHERE id=p_record_id AND organization_id=p_organization_id;
 ELSE RAISE EXCEPTION 'Unsupported sync record.'; END IF;
 IF r IS NULL THEN RAISE EXCEPTION 'Record not found.'; END IF;
 IF p_record_kind='application' THEN r:=r||jsonb_build_object('application_reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'application_id',e.application_id,'actor_user_id',e.actor_user_id,'previous_status',e.previous_status,'next_status',e.next_status,'reason',e.reason,'created_at',e.created_at) ORDER BY e.created_at,e.id) FROM plugin_data.csf_application_status_events e WHERE e.organization_id=p_organization_id AND e.application_id=p_record_id),'[]'::jsonb)); END IF;
 IF p_record_kind='profile' THEN
 r:=r||jsonb_build_object('applications',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM plugin_data.csf_term_applications a WHERE a.organization_id=p_organization_id AND a.profile_id=p_record_id),'[]'::jsonb),'credits',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM plugin_data.csf_credit_records c WHERE c.organization_id=p_organization_id AND c.profile_id=p_record_id),'[]'::jsonb));
 END IF;
 IF p_record_kind IN ('application','profile') THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO n FROM plugin_data.csf_review_notes x WHERE x.organization_id=p_organization_id AND x.subject_id=p_record_id AND x.subject_kind::text=p_record_kind;
 ELSE
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO n FROM plugin_data.csf_submission_reviews x WHERE x.organization_id=p_organization_id AND x.submission_id=p_record_id;
 END IF;
 IF p_record_kind='application' THEN r:=r||jsonb_build_object('files',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM plugin_data.csf_application_files f WHERE f.organization_id=p_organization_id AND f.application_id=p_record_id),'[]'::jsonb));
 ELSIF p_record_kind='point_submission' THEN r:=r||jsonb_build_object('files',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM plugin_data.csf_submission_files f WHERE f.organization_id=p_organization_id AND f.submission_id=p_record_id),'[]'::jsonb),'credits',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM plugin_data.csf_credit_records c WHERE c.organization_id=p_organization_id AND c.submission_id=p_record_id),'[]'::jsonb)); END IF;
 r:=r||jsonb_build_object('comments',n);
 RETURN r;
END $$;

CREATE FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; r jsonb; profile uuid; exists_record boolean;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 IF (d.kind='applications' AND p_record_kind<>'application') OR (d.kind='point_submissions' AND p_record_kind<>'point_submission') OR (d.kind='class' AND p_record_kind<>'profile') THEN RAISE EXCEPTION 'Record kind does not match this destination.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id;
 exists_record:=CASE p_record_kind WHEN 'profile' THEN EXISTS(SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id AND id=p_record_id) WHEN 'application' THEN EXISTS(SELECT 1 FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=p_record_id) ELSE EXISTS(SELECT 1 FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=p_record_id) END;
 IF exists_record AND (d.kind<>'class' OR EXISTS(SELECT 1 FROM plugin_data.csf_cohort_terms WHERE organization_id=p_organization_id AND cohort_id=d.cohort_id AND term_id=d.term_id)) THEN
  r:=plugin_data.csf_sheet_sync_snapshot(p_organization_id,p_record_kind,p_record_id);
  profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
  IF NOT ((p_record_kind='application' AND d.cohort_id IS NOT NULL AND (r->>'cohort_id')::uuid IS DISTINCT FROM d.cohort_id) OR (p_record_kind<>'profile' AND (r->>'term_id')::uuid IS DISTINCT FROM d.term_id) OR (d.cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=p_organization_id AND profile_id=profile AND cohort_id=d.cohort_id AND status='active'))) THEN
   IF p_record_kind='profile' THEN
    r:=r||jsonb_build_object('applications',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(r->'applications') x WHERE x->>'term_id'=d.term_id::text),'[]'::jsonb),'credits',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(r->'credits') x WHERE x->>'term_id'=d.term_id::text),'[]'::jsonb),'memberships',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(r->'memberships') x WHERE x->>'term_id'=d.term_id::text),'[]'::jsonb));
   END IF;
   RETURN r||jsonb_build_object('scope_revision',coalesce(b.scope_revision,0),
    'local_messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM plugin_data.csf_sheet_sync_local_messages m WHERE m.organization_id=p_organization_id AND m.destination_id=d.id AND m.binding_id=b.id),'[]'::jsonb),
    'projection_profile',(SELECT jsonb_build_object('first_name',p.first_name,'last_name',p.last_name) FROM plugin_data.csf_profiles p WHERE p.organization_id=p_organization_id AND p.id=profile),
    'projection_policy',(SELECT to_jsonb(p) FROM plugin_data.csf_term_policies p WHERE p.organization_id=p_organization_id AND p.term_id=d.term_id),
    'projection_attendance',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM plugin_data.csf_meeting_attendance a
     LEFT JOIN plugin_data.csf_meetings m ON m.organization_id=a.organization_id AND m.term_id=a.term_id AND (m.id=a.meeting_id OR (a.meeting_id IS NULL AND m.meeting_key=a.meeting_key))
     LEFT JOIN plugin_data.csf_term_meetings lm ON lm.organization_id=a.organization_id AND lm.term_id=a.term_id AND lm.id=a.term_meeting_id
     LEFT JOIN plugin_data.csf_meeting_sessions ms ON ms.organization_id=a.organization_id AND ms.id=a.meeting_session_id AND ms.meeting_id=m.id
     WHERE a.organization_id=p_organization_id AND a.profile_id=profile AND a.term_id=d.term_id AND coalesce(m.required,lm.required,false) AND coalesce(m.status,lm.status)='active' AND (a.meeting_session_id IS NULL OR (ms.id IS NOT NULL AND ms.status NOT IN ('cancelled','archived')))),'[]'::jsonb),
    'projection_credits',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM plugin_data.csf_credit_records c WHERE c.organization_id=p_organization_id AND c.profile_id=profile AND c.term_id=d.term_id AND c.status='verified' AND (p_record_kind<>'point_submission' OR c.submission_id=p_record_id)),'[]'::jsonb),
    'projection_evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('source_url',f.source_url,'drive_file_id',f.drive_file_id) ORDER BY f.id) FROM plugin_data.csf_application_files f WHERE p_record_kind='application' AND f.organization_id=p_organization_id AND f.application_id=p_record_id),'[]'::jsonb),
    'projection_meetings',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('sessions',coalesce((SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.id) FROM plugin_data.csf_meeting_sessions ms WHERE ms.organization_id=p_organization_id AND ms.meeting_id=m.id),'[]'::jsonb)) ORDER BY m.id) FROM plugin_data.csf_meetings m WHERE m.organization_id=p_organization_id AND m.term_id=d.term_id),'[]'::jsonb));
  END IF;
 END IF;
 IF b.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',p_record_id,'organization_id',p_organization_id,'record_kind',p_record_kind,'destination_id',p_destination_id,'out_of_scope',true,'scope_revision',b.scope_revision);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid) TO service_role;

CREATE FUNCTION plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r jsonb; v text; l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; profile uuid;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id AND organization_id=p_organization_id;
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 r:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id);
 IF r IS NULL THEN RAISE EXCEPTION 'Record is outside this destination.'; END IF;
 profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
 v:=md5(r::text);
 INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,profile_id,logical_key,sheet_id) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,profile,p_record_kind||':'||p_record_id::text,d.sheet_id) ON CONFLICT(destination_id,record_kind,record_id) DO NOTHING;
 UPDATE plugin_data.csf_sheet_sync_bindings SET profile_id=profile WHERE organization_id=p_organization_id AND destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND profile IS NOT NULL AND profile_id IS DISTINCT FROM profile;
 INSERT INTO plugin_data.csf_sheet_writeback_ledger(organization_id,spreadsheet_file_id,sheet_tab,status,destination_id,record_kind,record_id,source_version,payload)
 VALUES(p_organization_id,d.spreadsheet_file_id,NULL,'pending_export',d.id,p_record_kind,p_record_id,v,r)
 ON CONFLICT(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL DO NOTHING RETURNING * INTO l;
 IF l.id IS NULL THEN SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND source_version=v; END IF;
 RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_sheet_sync_record_internal(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION plugin_data.csf_queue_sheet_sync_record(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 result:=plugin_data.csf_queue_sheet_sync_record_internal(p_organization_id,p_destination_id,p_record_kind,p_record_id);
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION plugin_data.csf_claim_sheet_sync_exports(p_organization_id uuid,p_destination_id uuid,p_destination_lease_token uuid,p_limit integer DEFAULT 25) RETURNS SETOF plugin_data.csf_sheet_writeback_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND OR NOT d.enabled OR d.poll_lease_token IS DISTINCT FROM p_destination_lease_token OR p_destination_lease_token IS NULL OR d.poll_lease_expires_at<clock_timestamp() OR NOT (plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'export_sensitive_reports')) THEN RETURN; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status='unknown_outcome',last_error='The write lease expired. Reconcile the destination before retrying.' WHERE destination_id=d.id AND status='exporting' AND lease_expires_at<clock_timestamp();
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status='superseded' WHERE destination_id=d.id AND status IN ('pending_export','retry_export') AND (payload IS DISTINCT FROM plugin_data.csf_sheet_sync_destination_snapshot(organization_id,destination_id,record_kind,record_id) OR source_version<>md5(payload::text));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'export_sensitive_reports')) THEN RETURN; END IF;
 RETURN QUERY WITH candidates AS (
   SELECT l.id FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.destination_id=d.id AND l.status IN ('pending_export','retry_export')
   AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger b WHERE b.destination_id=l.destination_id AND b.record_kind=l.record_kind AND b.record_id=l.record_id AND b.status IN ('exporting','unknown_outcome'))
   ORDER BY l.created_at,l.id LIMIT greatest(1,least(p_limit,100)) FOR UPDATE SKIP LOCKED
 ) UPDATE plugin_data.csf_sheet_writeback_ledger l SET status='exporting',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp() FROM candidates c WHERE l.id=c.id RETURNING l.*;
END $$;

CREATE FUNCTION plugin_data.csf_finish_sheet_sync_export(p_organization_id uuid,p_ledger_id uuid,p_lease_token uuid,p_outcome text,p_remote_version text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l plugin_data.csf_sheet_writeback_ledger%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('exported','retry_export','unknown_outcome') THEN RAISE EXCEPTION 'Invalid export outcome.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND id=p_ledger_id AND destination_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Export attempt not found.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id FOR NO KEY UPDATE;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id FOR UPDATE;
 SELECT e.* INTO l FROM plugin_data.csf_sheet_writeback_ledger e WHERE e.organization_id=p_organization_id AND e.id=p_ledger_id AND e.destination_id=l.destination_id AND e.record_kind=l.record_kind AND e.record_id=l.record_id FOR UPDATE;
 IF NOT FOUND OR l.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Export lease no longer belongs to this attempt.'; END IF;
 IF l.status=p_outcome THEN RETURN to_jsonb(l); END IF;
 IF l.status<>'exporting' OR l.lease_expires_at IS NULL OR l.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Export lease expired. Reconcile before retrying.'; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=p_outcome,last_error=left(p_error,1000),updated_at=now(),sent_at=CASE WHEN p_outcome='exported' THEN now() END WHERE id=l.id RETURNING * INTO l;
 IF p_outcome='exported' THEN
   UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_version=CASE WHEN coalesce((l.payload->>'out_of_scope')::boolean,false) AND last_export_version IS NULL THEN NULL ELSE l.source_version END,remote_version=p_remote_version WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id;
   UPDATE plugin_data.csf_sheet_sync_destinations SET last_synced_at=now() WHERE id=l.destination_id;
 END IF;
 RETURN to_jsonb(l);
END $$;

CREATE FUNCTION plugin_data.csf_record_sheet_sync_change(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid,p_source_version text,p_remote_version text,p_payload jsonb,p_destination_lease_token uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; request jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR NO KEY UPDATE;
 IF NOT FOUND OR NOT d.enabled OR NOT (plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND last_export_version=p_source_version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unrecognized record version.'; END IF;
 IF p_destination_lease_token IS NULL OR d.poll_lease_token IS DISTINCT FROM p_destination_lease_token OR d.poll_lease_expires_at IS NULL OR d.poll_lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Sync lease expired or access changed.'; END IF;
 IF coalesce((plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id)->>'out_of_scope')::boolean,false) THEN RETURN jsonb_build_object('status','out_of_scope'); END IF;
 request:=p_payload-ARRAY['author_display_name','author_provider_id'];
 IF request='{}'::jsonb THEN UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request='{}'::jsonb,last_seen_request_source_version=NULL WHERE id=b.id; RETURN jsonb_build_object('status','unchanged'); END IF;
 IF request=b.last_seen_request AND (b.last_seen_request_source_version IS NOT DISTINCT FROM p_source_version OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes old WHERE old.destination_id=d.id AND old.record_kind=p_record_kind AND old.record_id=p_record_id AND old.source_version=b.last_seen_request_source_version AND old.status='stale' AND old.payload-ARRAY['author_display_name','author_provider_id']=request)) THEN RETURN jsonb_build_object('status','unchanged'); END IF;
 IF p_record_kind NOT IN ('application','point_submission') OR p_payload->>'action' NOT IN ('approved','rejected','needs_action','duplicate') OR p_payload->>'action' IS NULL OR (p_record_kind='application' AND p_payload->>'action'='duplicate') OR p_payload - ARRAY['action','review_notes','awarded_points','author_display_name','author_provider_id'] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported Sheet change.'; END IF;
 IF length(p_remote_version)>500 OR length(p_payload::text)>10000 THEN RAISE EXCEPTION 'Sheet change exceeds the size limit.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_changes(organization_id,destination_id,record_kind,record_id,source_version,remote_version,payload) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,p_source_version,p_remote_version,p_payload)
 ON CONFLICT(destination_id,record_kind,record_id,remote_version,source_version) DO NOTHING RETURNING * INTO c;
 IF c.id IS NULL THEN
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND remote_version=p_remote_version AND source_version=p_source_version;
 IF c.payload<>p_payload OR c.source_version<>p_source_version THEN RAISE EXCEPTION 'Conflicting change uses an existing remote version.'; END IF;
 END IF;
 UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request=request,last_seen_request_source_version=p_source_version WHERE id=b.id;
 RETURN to_jsonb(c);
END $$;

CREATE FUNCTION plugin_data.csf_review_sheet_sync_change(p_organization_id uuid,p_actor_user_id uuid,p_change_id uuid,p_accept boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; r jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND id=p_change_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sheet change not found.'; END IF;
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,CASE WHEN c.record_kind='application' THEN 'decide_applications' ELSE 'verify_submissions' END) THEN RAISE EXCEPTION 'Not authorized to review this record.'; END IF;
 IF c.status<>'pending' THEN RETURN to_jsonb(c); END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'Choose accept or discard.'; END IF;
 p_reason:=nullif(btrim(p_reason),'');
 IF p_reason IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'Enter a review note of 1 to 4000 characters.'; END IF;
 IF p_accept THEN
   IF c.record_kind='application' THEN PERFORM 1 FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE;
   ELSE PERFORM 1 FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE; END IF;
   r:=plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,c.destination_id,c.record_kind,c.record_id);
   IF r IS NULL OR coalesce((r->>'out_of_scope')::boolean,false) OR md5(r::text)<>c.source_version THEN c.status:='stale';
   ELSE
     IF c.record_kind='application' THEN PERFORM plugin_data.csf_decide_term_application(p_organization_id,c.record_id,CASE WHEN c.payload->>'action'='approved' THEN 'accepted' ELSE c.payload->>'action' END,p_reason,p_actor_user_id,c.id);
     ELSE PERFORM plugin_data.csf_review_point_submission_request(p_organization_id,c.record_id,c.payload->>'action',(c.payload->>'awarded_points')::numeric,p_reason,p_actor_user_id,c.id); END IF;
     c.status:='accepted';
   END IF;
 ELSE c.status:='discarded'; END IF;
 UPDATE plugin_data.csf_sheet_sync_changes SET status=c.status,reviewed_by=p_actor_user_id,review_reason=left(p_reason,4000),reviewed_at=now() WHERE id=c.id RETURNING * INTO c;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.change_reviewed','sheet_sync_change',c.id,to_jsonb(c));
 RETURN to_jsonb(c);
END $$;

CREATE FUNCTION plugin_data.csf_seed_sheet_sync_destination(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_cursor uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r record; n integer:=0; last_id uuid; k text;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF d.seed_completed THEN RETURN jsonb_build_object('count',0,'next_cursor',NULL,'completed',true); END IF;
 k:=CASE d.kind WHEN 'applications' THEN 'application' WHEN 'point_submissions' THEN 'point_submission' ELSE 'profile' END;
 FOR r IN
  SELECT DISTINCT candidate.id FROM (
   SELECT a.id,a.profile_id FROM plugin_data.csf_term_applications a WHERE d.kind='applications' AND a.organization_id=p_organization_id AND a.term_id=d.term_id AND (d.cohort_id IS NULL OR a.cohort_id=d.cohort_id)
   UNION ALL SELECT p.id,p.profile_id FROM plugin_data.csf_point_submissions p WHERE d.kind='point_submissions' AND p.organization_id=p_organization_id AND p.term_id=d.term_id
   UNION ALL SELECT f.id,f.id FROM plugin_data.csf_profiles f WHERE d.kind='class' AND f.organization_id=p_organization_id
   UNION ALL SELECT b.record_id,b.profile_id FROM plugin_data.csf_sheet_sync_bindings b WHERE b.organization_id=p_organization_id AND b.destination_id=d.id
  ) candidate WHERE (d.seed_cursor IS NULL OR candidate.id>d.seed_cursor) AND (EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b WHERE b.organization_id=p_organization_id AND b.destination_id=d.id AND b.record_id=candidate.id AND b.record_kind=k) OR d.cohort_id IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=p_organization_id AND profile_id=candidate.profile_id AND cohort_id=d.cohort_id AND status='active'))
  ORDER BY candidate.id LIMIT greatest(1,least(p_limit,200))
 LOOP
  PERFORM plugin_data.csf_queue_sheet_sync_record(p_organization_id,p_actor_user_id,d.id,k,r.id); n:=n+1;last_id:=r.id;
 END LOOP;
 UPDATE plugin_data.csf_sheet_sync_destinations SET seed_cursor=coalesce(last_id,seed_cursor),seed_completed=n<greatest(1,least(p_limit,200)) WHERE id=d.id;
 RETURN jsonb_build_object('count',n,'next_cursor',CASE WHEN n=greatest(1,least(p_limit,200)) THEN last_id ELSE NULL END,'completed',n<greatest(1,least(p_limit,200)));
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_seed_sheet_sync_destination(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_seed_sheet_sync_destination(uuid,uuid,uuid,uuid,integer) TO service_role;

CREATE FUNCTION plugin_data.csf_claim_sheet_sync_destination(p_organization_id uuid,p_destination_id uuid,p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 UPDATE plugin_data.csf_sheet_sync_destinations SET poll_lease_token=gen_random_uuid(),poll_lease_expires_at=clock_timestamp()+interval '2 minutes',next_poll_at=clock_timestamp()+interval '2 minutes'
 WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled AND (p_force OR next_poll_at<=clock_timestamp()) AND (poll_lease_expires_at IS NULL OR poll_lease_expires_at<clock_timestamp()) AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'export_sensitive_reports') RETURNING * INTO d;
 RETURN CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d) END;
END $$;
CREATE FUNCTION plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id uuid,p_destination_id uuid,p_lease_token uuid,p_record_kind text DEFAULT NULL,p_record_id uuid DEFAULT NULL,p_source_version text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled AND poll_lease_token=p_lease_token AND poll_lease_expires_at>clock_timestamp() AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'export_sensitive_reports') FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sync lease expired or access changed.'; END IF;
 IF d.kind='class' AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_cohort_terms WHERE organization_id=p_organization_id AND cohort_id=d.cohort_id AND term_id=d.term_id) THEN RAISE EXCEPTION 'This semester is not configured for this class.'; END IF;
 IF (p_record_kind IS NOT NULL OR p_record_id IS NOT NULL OR p_source_version IS NOT NULL) THEN
  IF p_record_kind IS NULL OR p_record_id IS NULL OR p_source_version IS NULL THEN RAISE EXCEPTION 'Provide the complete export record identity.'; END IF;
  PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=p_destination_id AND record_kind=p_record_kind AND record_id=p_record_id FOR UPDATE;
  IF NOT FOUND OR md5(plugin_data.csf_sheet_sync_destination_snapshot(p_organization_id,p_destination_id,p_record_kind,p_record_id)::text) IS DISTINCT FROM p_source_version THEN RAISE EXCEPTION 'Sheet record changed. Reload before exporting.'; END IF;
 END IF;
 IF d.poll_lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Sync lease expired or access changed.'; END IF;
 RETURN to_jsonb(d);
END $$;
CREATE FUNCTION plugin_data.csf_release_sheet_sync_destination(p_organization_id uuid,p_destination_id uuid,p_lease_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE plugin_data.csf_sheet_sync_destinations SET poll_lease_token=NULL,poll_lease_expires_at=NULL WHERE organization_id=p_organization_id AND id=p_destination_id AND poll_lease_token=p_lease_token;
END $$;
CREATE FUNCTION plugin_data.csf_reconcile_sheet_sync_export(p_organization_id uuid,p_actor_user_id uuid,p_ledger_id uuid,p_was_written boolean,p_remote_version text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l plugin_data.csf_sheet_writeback_ledger%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT (plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF p_was_written IS NULL THEN RAISE EXCEPTION 'Confirm whether the provider write occurred. Keep uncertain writes on hold.'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Record the destination reconciliation result.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE id=p_ledger_id AND organization_id=p_organization_id AND destination_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Export attempt not found.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=l.destination_id AND enabled) THEN RAISE EXCEPTION 'Turn off syncing before reconciling this write.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND status='exporting' AND lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Wait for active export attempts before reconciling this write.'; END IF;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id FOR UPDATE;
 SELECT e.* INTO l FROM plugin_data.csf_sheet_writeback_ledger e WHERE e.organization_id=p_organization_id AND e.id=p_ledger_id AND e.destination_id=l.destination_id AND e.record_kind=l.record_kind AND e.record_id=l.record_id FOR UPDATE;
 IF NOT FOUND OR l.status<>'unknown_outcome' THEN RAISE EXCEPTION 'Export is not awaiting reconciliation.'; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=CASE WHEN p_was_written THEN 'exported' ELSE 'retry_export' END,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=l.id RETURNING * INTO l;
 IF p_was_written THEN UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_version=l.source_version,remote_version=p_remote_version WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.export_reconciled','sheet_writeback_ledger',l.id,jsonb_build_object('was_written',p_was_written,'reason',p_reason));
 RETURN to_jsonb(l);
END $$;

CREATE TABLE plugin_data.csf_sheet_sync_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,destination_id uuid NOT NULL,
 binding_id uuid NOT NULL,
 provider_thread_id text NOT NULL,provider_message_id text NOT NULL,provider_version text NOT NULL,
 author jsonb NOT NULL CHECK(jsonb_typeof(author)='object'),body text NOT NULL CHECK(length(body)<=10000),resolved boolean NOT NULL DEFAULT false,deleted boolean NOT NULL DEFAULT false,
 source text NOT NULL DEFAULT 'google_sheets' CHECK(source='google_sheets'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(destination_id,provider_message_id),
 FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,destination_id,binding_id) REFERENCES plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,id) ON DELETE CASCADE
);
ALTER TABLE plugin_data.csf_sheet_sync_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_comments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_sync_comments TO service_role;
CREATE TABLE plugin_data.csf_sheet_sync_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,destination_id uuid NOT NULL,
 -- Retain the reviewed test-workspace identity after its disposable fixture organization is removed.
 test_organization_id uuid NOT NULL,
 reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,configuration jsonb NOT NULL,evidence jsonb NOT NULL,reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE,
 configuration_hash text GENERATED ALWAYS AS (md5(configuration::text)) STORED, evidence_hash text GENERATED ALWAYS AS (md5(evidence::text)) STORED,
 UNIQUE(destination_id,configuration_hash,evidence_hash)
);
ALTER TABLE plugin_data.csf_sheet_sync_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON plugin_data.csf_sheet_sync_acceptances TO service_role;
CREATE FUNCTION plugin_data.csf_record_sheet_sync_acceptance(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_test_destination_ids uuid[],p_evidence jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; td plugin_data.csf_sheet_sync_destinations%ROWTYPE; test_org uuid; a plugin_data.csf_sheet_sync_acceptances%ROWTYPE; config_snapshot jsonb; x uuid; kinds text[]; export_ids uuid[]; change_ids uuid[]; comment_ids uuid[]; test_configurations jsonb; saved_evidence jsonb;
BEGIN
 IF cardinality(p_test_destination_ids) IS DISTINCT FROM 3 OR (SELECT count(DISTINCT v) FROM unnest(p_test_destination_ids) v)<>3 THEN RAISE EXCEPTION 'Choose the three copied-workbook test destinations.'; END IF;
 SELECT organization_id INTO test_org FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_test_destination_ids[1] AND is_test;
 IF test_org IS NULL OR test_org=p_organization_id THEN RAISE EXCEPTION 'Choose an isolated copied-workbook test workspace.'; END IF;
 PERFORM pg_advisory_xact_lock(k) FROM (SELECT DISTINCT plugin_data.csf_staff_access_lock_key(v) k FROM unnest(ARRAY[p_organization_id,test_org]) v ORDER BY k) locks;
 FOREACH x IN ARRAY ARRAY[p_organization_id,test_org] LOOP
  IF NOT (plugin_data.csf_actor_has_permission(x,p_actor_user_id,'manage_settings') AND plugin_data.csf_actor_has_permission(x,p_actor_user_id,'manage_sheet_sync') AND plugin_data.csf_actor_has_permission(x,p_actor_user_id,'export_sensitive_reports')) THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 END LOOP;
 PERFORM 1 FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids||p_destination_id) ORDER BY id FOR NO KEY UPDATE;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND OR d.is_test OR d.enabled THEN RAISE EXCEPTION 'Turn off the live destination before recording test acceptance.'; END IF;
 IF length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 OR p_reason IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR length(p_evidence->>'observations') NOT BETWEEN 20 AND 10000 OR p_evidence->>'observations' IS NULL OR jsonb_typeof(p_evidence->'provider_versions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Record the inspected test evidence and review reason.'; END IF;
 IF jsonb_typeof(p_evidence->'export_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'change_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'comment_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Supply persisted export, decision and comment receipt IDs.'; END IF;
 SELECT array_agg(v::uuid) INTO export_ids FROM jsonb_array_elements_text(p_evidence->'export_ids') v;
 SELECT array_agg(v::uuid) INTO change_ids FROM jsonb_array_elements_text(p_evidence->'change_ids') v;
 SELECT array_agg(v::uuid) INTO comment_ids FROM jsonb_array_elements_text(p_evidence->'comment_ids') v;
 IF coalesce(cardinality(export_ids),0)<3 OR coalesce(cardinality(change_ids),0)<6 OR coalesce(cardinality(comment_ids),0)<2 THEN RAISE EXCEPTION 'The copied-workbook journey is incomplete.'; END IF;
 PERFORM 1 FROM plugin_data.csf_cohorts WHERE organization_id IN (p_organization_id,test_org) AND id IN (SELECT cohort_id FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids||p_destination_id)) ORDER BY id FOR SHARE;
 PERFORM 1 FROM plugin_data.csf_terms WHERE organization_id IN (p_organization_id,test_org) AND id IN (SELECT term_id FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids||p_destination_id)) ORDER BY id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations t JOIN plugin_data.csf_sheet_sync_test_copy_requests r ON r.copied_file_id=t.spreadsheet_file_id AND r.organization_id=t.organization_id WHERE t.id=ANY(p_test_destination_ids) AND t.organization_id=test_org AND t.kind=d.kind AND r.source_organization_id=p_organization_id AND r.source_file_id=d.spreadsheet_file_id AND r.state='completed' AND t.owned_start_column=d.owned_start_column AND t.managed_headers=d.managed_headers AND (t.cohort_id IS NULL)=(d.cohort_id IS NULL) AND (t.term_id IS NULL)=(d.term_id IS NULL) AND jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id))=jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id))) THEN RAISE EXCEPTION 'The corresponding test destination must use the live columns, class year and semester.'; END IF;
 FOR td IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE id=ANY(p_test_destination_ids) ORDER BY id LOOP
  kinds:=array_append(kinds,td.kind);
  IF td.organization_id<>test_org OR NOT td.is_test OR td.comment_capability<>'available' OR td.privacy_verified_at IS NULL OR td.last_synced_at IS NULL OR nullif(p_evidence->'provider_versions'->>td.id::text,'') IS NULL OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_copy_requests r WHERE r.organization_id=test_org AND r.source_organization_id=p_organization_id AND r.copied_file_id=td.spreadsheet_file_id AND r.state='completed' AND r.provider_subject IS NOT NULL) THEN RAISE EXCEPTION 'Test destinations need verified copied-file lineage and native comment access.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l JOIN plugin_data.csf_sheet_sync_bindings b ON b.destination_id=l.destination_id AND b.record_kind=l.record_kind AND b.record_id=l.record_id WHERE l.id=ANY(export_ids) AND l.destination_id=td.id AND l.status='exported' AND l.source_version=b.last_export_version AND l.source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(test_org,td.id,l.record_kind,l.record_id)::text)) THEN RAISE EXCEPTION 'Each test destination needs a current exported receipt.'; END IF;
  IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=td.id AND status IN ('unknown_outcome','exporting','pending_export','retry_export')) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=td.id AND status='pending') THEN RAISE EXCEPTION 'Resolve outstanding copied-workbook changes before acceptance.'; END IF;
 END LOOP;
 IF NOT kinds @> ARRAY['applications','point_submissions','class'] OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_copy_requests r JOIN plugin_data.csf_sheet_sync_destinations t ON t.spreadsheet_file_id=r.copied_file_id AND t.id=ANY(p_test_destination_ids) WHERE r.organization_id=test_org AND r.source_organization_id=p_organization_id AND r.source_file_id=d.spreadsheet_file_id AND r.state='completed' AND t.kind=d.kind) THEN RAISE EXCEPTION 'The test copies do not cover this live destination.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(export_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=v AND l.organization_id=test_org AND l.destination_id=ANY(p_test_destination_ids) AND l.status='exported')) OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=ANY(export_ids) GROUP BY l.destination_id,l.record_kind,l.record_id HAVING count(DISTINCT source_version)>=2) THEN RAISE EXCEPTION 'Repeated sync needs distinct retained export versions.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(change_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.id=v AND c.organization_id=test_org AND c.destination_id=ANY(p_test_destination_ids) AND c.status='accepted' AND c.reviewed_by IS NOT NULL)) OR EXISTS(SELECT 1 FROM unnest(ARRAY['application','point_submission']) k CROSS JOIN unnest(ARRAY['approved','rejected','needs_action']) actions(requested_action) WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_changes c WHERE c.id=ANY(change_ids) AND c.record_kind=k AND c.payload->>'action'=actions.requested_action AND c.status='accepted')) THEN RAISE EXCEPTION 'Approval, rejection and correction need reviewed application and point receipts.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(comment_ids) v WHERE NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments c WHERE c.id=v AND c.organization_id=test_org AND c.destination_id=ANY(p_test_destination_ids) AND NOT c.deleted)) OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments c WHERE c.id=ANY(comment_ids) GROUP BY c.destination_id,c.provider_thread_id HAVING count(DISTINCT c.provider_message_id)>=2 AND bool_or(c.resolved)) OR jsonb_typeof(p_evidence->'native_receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence->'native_receipts')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'native_receipts') receipt WHERE nullif(btrim(receipt->>'thread_id'),'') IS NULL OR nullif(btrim(receipt->>'post_id'),'') IS NULL OR nullif(btrim(receipt->>'local_version'),'') IS NULL OR NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings b WHERE b.id=(receipt->>'binding_id')::uuid AND b.organization_id=test_org AND b.destination_id=ANY(p_test_destination_ids) AND b.thread_bindings->(receipt->>'local_message_id')=jsonb_build_object('threadId',receipt->>'thread_id','postId',receipt->>'post_id','localVersion',receipt->>'local_version') AND EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.id=ANY(export_ids) AND l.destination_id=b.destination_id AND l.record_kind=b.record_kind AND l.record_id=b.record_id AND l.status='exported' AND l.source_version=b.last_export_version AND l.source_version=md5(plugin_data.csf_sheet_sync_destination_snapshot(test_org,b.destination_id,b.record_kind,b.record_id)::text)))) THEN RAISE EXCEPTION 'Native comments need exported messages, imported replies and resolution receipts.'; END IF;
 SELECT jsonb_object_agg(t.id::text,jsonb_build_object('file',t.spreadsheet_file_id,'sheet',t.sheet_id,'kind',t.kind,'cohort',t.cohort_id,'term',t.term_id,'start',t.owned_start_column,'headers',t.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=t.organization_id AND c.id=t.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=t.organization_id AND tr.id=t.term_id)))) INTO test_configurations FROM plugin_data.csf_sheet_sync_destinations t WHERE t.id=ANY(p_test_destination_ids);
 saved_evidence:=p_evidence||jsonb_build_object('test_configurations',test_configurations);
 config_snapshot:=jsonb_build_object('protocol','csf-sheet-sync-v1','file',d.spreadsheet_file_id,'sheet',d.sheet_id,'kind',d.kind,'cohort',d.cohort_id,'term',d.term_id,'start',d.owned_start_column,'headers',d.managed_headers,'scope',jsonb_build_object('graduation_year',(SELECT c.graduation_year FROM plugin_data.csf_cohorts c WHERE c.organization_id=d.organization_id AND c.id=d.cohort_id),'semester',(SELECT tr.semester FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id),'school_year',(SELECT tr.school_year FROM plugin_data.csf_terms tr WHERE tr.organization_id=d.organization_id AND tr.id=d.term_id)));
 INSERT INTO plugin_data.csf_sheet_sync_acceptances(organization_id,destination_id,test_organization_id,reviewed_by,configuration,evidence,reason) VALUES(p_organization_id,d.id,test_org,p_actor_user_id,config_snapshot,saved_evidence,p_reason) ON CONFLICT(destination_id,configuration_hash,evidence_hash) DO NOTHING RETURNING * INTO a;
 IF a.id IS NULL THEN SELECT * INTO a FROM plugin_data.csf_sheet_sync_acceptances WHERE destination_id=d.id AND configuration=config_snapshot AND evidence=saved_evidence; ELSE
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.test_journey_accepted','sheet_sync_acceptance',a.id,to_jsonb(a)); END IF;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text) TO service_role;

CREATE FUNCTION plugin_data.csf_record_sheet_sync_comment(p_organization_id uuid,p_destination_id uuid,p_lease_token uuid,p_binding_id uuid,p_thread_id text,p_message_id text,p_provider_version text,p_author jsonb,p_body text,p_resolved boolean,p_deleted boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_comments%ROWTYPE;
BEGIN
 PERFORM plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id,p_destination_id,p_lease_token);
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_bindings WHERE id=p_binding_id AND organization_id=p_organization_id AND destination_id=p_destination_id) THEN RAISE EXCEPTION 'Comment binding not found.'; END IF;
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_comments WHERE destination_id=p_destination_id AND provider_message_id=p_message_id FOR UPDATE;
 IF FOUND AND (c.binding_id<>p_binding_id OR c.provider_thread_id<>p_thread_id) THEN RAISE EXCEPTION 'Comment identity conflicts with its existing binding.'; END IF;
 IF FOUND AND c.provider_version<>p_provider_version AND EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE organization_id=p_organization_id AND action='sheet_sync.comment_observed' AND target_id=c.id AND after_data->>'provider_version'=p_provider_version) THEN RETURN to_jsonb(c); END IF;
 IF FOUND AND c.provider_version=p_provider_version THEN
  IF c.author<>p_author OR c.body<>p_body OR c.resolved<>p_resolved OR c.deleted<>p_deleted THEN RAISE EXCEPTION 'Conflicting comment version.'; END IF;
  RETURN to_jsonb(c);
 END IF;
 PERFORM plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id,p_destination_id,p_lease_token);
 INSERT INTO plugin_data.csf_sheet_sync_comments(organization_id,destination_id,binding_id,provider_thread_id,provider_message_id,provider_version,author,body,resolved,deleted)
 VALUES(p_organization_id,p_destination_id,p_binding_id,p_thread_id,p_message_id,p_provider_version,p_author,p_body,p_resolved,p_deleted)
 ON CONFLICT(destination_id,provider_message_id) DO UPDATE SET provider_version=EXCLUDED.provider_version,author=EXCLUDED.author,body=EXCLUDED.body,resolved=EXCLUDED.resolved,deleted=EXCLUDED.deleted,updated_at=now() RETURNING * INTO c;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,action,target_type,target_id,after_data) VALUES(p_organization_id,'sheet_sync.comment_observed','sheet_sync_comment',c.id,to_jsonb(c));
 RETURN to_jsonb(c);
END $$;
CREATE FUNCTION plugin_data.csf_bind_sheet_sync_thread(p_organization_id uuid,p_destination_id uuid,p_lease_token uuid,p_binding_id uuid,p_local_message_id uuid,p_provider_thread_id text,p_provider_post_id text,p_local_version text,p_expected_local_version text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b plugin_data.csf_sheet_sync_bindings%ROWTYPE;
BEGIN
 IF nullif(btrim(p_provider_thread_id),'') IS NULL OR nullif(btrim(p_provider_post_id),'') IS NULL OR nullif(btrim(p_local_version),'') IS NULL THEN RAISE EXCEPTION 'A complete native comment receipt is required.'; END IF;
 PERFORM plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id,p_destination_id,p_lease_token);
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE id=p_binding_id AND organization_id=p_organization_id AND destination_id=p_destination_id FOR UPDATE;
 IF NOT FOUND OR NOT (EXISTS(SELECT 1 FROM plugin_data.csf_review_notes WHERE organization_id=p_organization_id AND id=p_local_message_id AND subject_id=b.record_id AND subject_kind::text=b.record_kind) OR (b.record_kind='application' AND EXISTS(SELECT 1 FROM plugin_data.csf_application_status_events WHERE organization_id=p_organization_id AND id=p_local_message_id AND application_id=b.record_id)) OR (b.record_kind='point_submission' AND EXISTS(SELECT 1 FROM plugin_data.csf_submission_reviews WHERE organization_id=p_organization_id AND id=p_local_message_id AND submission_id=b.record_id)) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_local_messages WHERE organization_id=p_organization_id AND id=p_local_message_id AND binding_id=b.id)) THEN RAISE EXCEPTION 'Local comment binding not found.'; END IF;
 IF b.thread_bindings ? p_local_message_id::text THEN
  IF b.thread_bindings->p_local_message_id::text = jsonb_build_object('threadId',p_provider_thread_id,'postId',p_provider_post_id,'localVersion',p_local_version) THEN RETURN to_jsonb(b); END IF;
  IF p_expected_local_version IS NULL OR b.thread_bindings->p_local_message_id::text->>'threadId' IS DISTINCT FROM p_provider_thread_id OR b.thread_bindings->p_local_message_id::text->>'postId' IS DISTINCT FROM p_provider_post_id OR b.thread_bindings->p_local_message_id::text->>'localVersion' IS DISTINCT FROM p_expected_local_version THEN RAISE EXCEPTION 'Comment receipt conflicts with the recorded provider result.'; END IF;
 ELSIF p_expected_local_version IS NOT NULL THEN RAISE EXCEPTION 'Comment receipt conflicts with the recorded provider result.';
 END IF;
 PERFORM plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id,p_destination_id,p_lease_token);
 UPDATE plugin_data.csf_sheet_sync_bindings SET thread_bindings=thread_bindings||jsonb_build_object(p_local_message_id::text,jsonb_build_object('threadId',p_provider_thread_id,'postId',p_provider_post_id,'localVersion',p_local_version)) WHERE id=b.id RETURNING * INTO b;
 RETURN to_jsonb(b);
END $$;

CREATE FUNCTION plugin_data.csf_add_sheet_sync_local_message(p_organization_id uuid,p_actor_user_id uuid,p_binding_id uuid,p_request_id uuid,p_thread_id text,p_body text,p_resolved boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b plugin_data.csf_sheet_sync_bindings%ROWTYPE; m plugin_data.csf_sheet_sync_local_messages%ROWTYPE; d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'verify_submissions') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable message request identifier is required.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND id=p_binding_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Comment binding not found.'; END IF;
 IF (b.record_kind='application' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'view_applications')) OR (b.record_kind='profile' AND NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_profiles')) THEN RAISE EXCEPTION 'Not authorized to view this discussion.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=b.destination_id AND organization_id=p_organization_id;
 IF NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF p_thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments WHERE binding_id=b.id AND provider_thread_id=p_thread_id) AND NOT EXISTS(SELECT 1 FROM jsonb_each(b.thread_bindings) WHERE value->>'threadId'=p_thread_id) THEN RAISE EXCEPTION 'Thread does not belong to this record.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-message:'||p_request_id::text,0));
 SELECT * INTO m FROM plugin_data.csf_sheet_sync_local_messages WHERE id=p_request_id;
 IF FOUND THEN
  IF m.organization_id<>p_organization_id OR m.binding_id<>b.id OR m.author_user_id IS DISTINCT FROM p_actor_user_id OR m.body<>p_body OR m.provider_thread_id IS DISTINCT FROM p_thread_id OR m.resolved IS DISTINCT FROM p_resolved THEN RAISE EXCEPTION 'Message request conflicts with its previous use.'; END IF;
  RETURN to_jsonb(m);
 END IF;
 INSERT INTO plugin_data.csf_sheet_sync_local_messages(id,organization_id,destination_id,binding_id,author_user_id,provider_thread_id,body,resolved) VALUES(p_request_id,p_organization_id,b.destination_id,b.id,p_actor_user_id,p_thread_id,p_body,p_resolved) RETURNING * INTO m;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.message_added','sheet_sync_local_message',m.id,to_jsonb(m));
 RETURN to_jsonb(m);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean) TO service_role;

CREATE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END; new_row jsonb:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END; r jsonb; targets jsonb:='[]'; k text; rid uuid; org uuid; profile uuid; changed_term uuid; target record; d record;
BEGIN
 IF TG_TABLE_NAME='csf_sheet_sync_local_messages' THEN
  FOR target IN SELECT b.* FROM plugin_data.csf_sheet_sync_bindings b WHERE EXISTS(SELECT 1 FROM unnest(ARRAY[old_row,new_row]) x WHERE x IS NOT NULL AND b.organization_id=(x->>'organization_id')::uuid AND b.id=(x->>'binding_id')::uuid) ORDER BY b.id FOR NO KEY UPDATE LOOP
   UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE id=target.id;
   IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE id=target.destination_id AND organization_id=target.organization_id AND enabled) THEN
    PERFORM plugin_data.csf_queue_sheet_sync_record_internal(target.organization_id,target.destination_id,target.record_kind,target.record_id);
   END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 FOR r IN SELECT DISTINCT x FROM unnest(ARRAY[old_row,new_row]) x WHERE x IS NOT NULL LOOP
  org:=(r->>'organization_id')::uuid; profile:=NULL; k:=NULL; rid:=NULL; changed_term:=(r->>'term_id')::uuid;
  IF TG_TABLE_NAME IN ('csf_term_applications','csf_point_submissions') THEN k:=CASE WHEN TG_TABLE_NAME='csf_term_applications' THEN 'application' ELSE 'point_submission' END; rid:=(r->>'id')::uuid;
  ELSIF TG_TABLE_NAME IN ('csf_application_files','csf_application_status_events') THEN k:='application';rid:=(r->>'application_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('csf_submission_files','csf_submission_reviews') OR (TG_TABLE_NAME='csf_credit_records' AND r->>'submission_id' IS NOT NULL) THEN k:='point_submission';rid:=(r->>'submission_id')::uuid;
  ELSIF TG_TABLE_NAME='csf_review_notes' THEN
   IF r->>'subject_kind' NOT IN ('application','profile') THEN CONTINUE; END IF;
   k:=r->>'subject_kind';rid:=(r->>'subject_id')::uuid; IF k='profile' THEN changed_term:=NULL; END IF;
  ELSIF TG_TABLE_NAME='csf_sheet_sync_local_messages' THEN
   SELECT record_kind,record_id INTO k,rid FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=org AND id=(r->>'binding_id')::uuid;
  ELSE k:='profile';rid:=CASE WHEN TG_TABLE_NAME='csf_profiles' THEN (r->>'id')::uuid ELSE (r->>'profile_id')::uuid END; END IF;
  IF changed_term IS NULL AND k='application' THEN SELECT term_id INTO changed_term FROM plugin_data.csf_term_applications WHERE organization_id=org AND id=rid; ELSIF changed_term IS NULL AND k='point_submission' THEN SELECT term_id INTO changed_term FROM plugin_data.csf_point_submissions WHERE organization_id=org AND id=rid; END IF;
  IF changed_term IS NULL AND k IN ('application','point_submission') AND TG_TABLE_NAME NOT IN ('csf_term_applications','csf_point_submissions') THEN CONTINUE; END IF;
  profile:=CASE WHEN k='profile' THEN rid ELSE (r->>'profile_id')::uuid END;
  IF k IS NOT NULL AND rid IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('org',org,'term',changed_term,'kind',k,'id',rid)); END IF;
  IF profile IS NOT NULL AND k<>'profile' THEN targets:=targets||jsonb_build_array(jsonb_build_object('org',org,'term',changed_term,'kind','profile','id',profile)); END IF;
  IF profile IS NOT NULL AND TG_TABLE_NAME IN ('csf_profiles','csf_meeting_attendance','csf_credit_records') THEN
   targets:=targets||coalesce((SELECT jsonb_agg(jsonb_build_object('org',org,'term',changed_term,'kind','application','id',a.id)) FROM plugin_data.csf_term_applications a WHERE a.organization_id=org AND a.profile_id=profile AND (changed_term IS NULL OR a.term_id=changed_term)),'[]'::jsonb)
    ||coalesce((SELECT jsonb_agg(jsonb_build_object('org',org,'term',changed_term,'kind','point_submission','id',p.id)) FROM plugin_data.csf_point_submissions p WHERE p.organization_id=org AND p.profile_id=profile AND (changed_term IS NULL OR p.term_id=changed_term)),'[]'::jsonb)
    ||coalesce((SELECT jsonb_agg(jsonb_build_object('org',org,'term',changed_term,'kind',b.record_kind,'id',b.record_id)) FROM plugin_data.csf_sheet_sync_bindings b WHERE b.organization_id=org AND b.profile_id=profile AND (changed_term IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=b.destination_id AND (sd.term_id IS NULL OR sd.term_id=changed_term)))),'[]'::jsonb);
  END IF;
 END LOOP;
 PERFORM b.id FROM plugin_data.csf_sheet_sync_bindings b WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(targets) x WHERE b.organization_id=(x->>'org')::uuid AND b.record_kind=x->>'kind' AND b.record_id=(x->>'id')::uuid AND (x->>'term' IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=b.destination_id AND (sd.term_id IS NULL OR sd.term_id=(x->>'term')::uuid)))) ORDER BY b.id FOR NO KEY UPDATE;
 FOR target IN SELECT DISTINCT (x->>'org')::uuid org,x->>'kind' kind,(x->>'id')::uuid id,(x->>'term')::uuid term FROM jsonb_array_elements(targets) x ORDER BY org,kind,id,term LOOP
  UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE organization_id=target.org AND record_kind=target.kind AND record_id=target.id AND (target.term IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations sd WHERE sd.id=destination_id AND (sd.term_id IS NULL OR sd.term_id=target.term)));
  FOR d IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=target.org AND enabled AND (target.term IS NULL OR term_id IS NULL OR term_id=target.term) AND ((target.kind='application' AND kind='applications') OR (target.kind='point_submission' AND kind='point_submissions') OR (target.kind='profile' AND kind='class')) LOOP
   IF plugin_data.csf_sheet_sync_destination_snapshot(target.org,d.id,target.kind,target.id) IS NOT NULL THEN
    PERFORM plugin_data.csf_queue_sheet_sync_record_internal(target.org,d.id,target.kind,target.id);
   END IF;
  END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE FUNCTION plugin_data.csf_queue_cohort_sheet_sync_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END; new_row jsonb:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END; member record; target record; d record;
BEGIN
 PERFORM b.id FROM plugin_data.csf_sheet_sync_bindings b WHERE EXISTS(SELECT 1 FROM unnest(ARRAY[old_row,new_row]) r WHERE r IS NOT NULL AND b.organization_id=(r->>'organization_id')::uuid AND (b.profile_id=(r->>'profile_id')::uuid OR (b.record_kind='profile' AND b.record_id=(r->>'profile_id')::uuid))) ORDER BY b.id FOR NO KEY UPDATE;
 FOR member IN SELECT DISTINCT (r->>'organization_id')::uuid org,(r->>'profile_id')::uuid profile FROM unnest(ARRAY[old_row,new_row]) r WHERE r IS NOT NULL LOOP
  UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE organization_id=member.org AND (profile_id=member.profile OR (record_kind='profile' AND record_id=member.profile));
  FOR d IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=member.org AND enabled LOOP
   FOR target IN
    SELECT 'profile' kind,member.profile id WHERE d.kind='class'
    UNION SELECT 'application',a.id FROM plugin_data.csf_term_applications a WHERE d.kind='applications' AND a.organization_id=member.org AND a.profile_id=member.profile AND a.term_id=d.term_id
    UNION SELECT 'point_submission',p.id FROM plugin_data.csf_point_submissions p WHERE d.kind='point_submissions' AND p.organization_id=member.org AND p.profile_id=member.profile AND p.term_id=d.term_id
    UNION SELECT b.record_kind,b.record_id FROM plugin_data.csf_sheet_sync_bindings b WHERE b.organization_id=member.org AND b.destination_id=d.id AND (b.profile_id=member.profile OR (b.record_kind='profile' AND b.record_id=member.profile))
   LOOP
    IF plugin_data.csf_sheet_sync_destination_snapshot(member.org,d.id,target.kind,target.id) IS NOT NULL THEN PERFORM plugin_data.csf_queue_sheet_sync_record_internal(member.org,d.id,target.kind,target.id); END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_cohort_sheet_sync_records() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION plugin_data.csf_queue_term_sheet_sync_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END; new_row jsonb:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END; scope record; d record; target record;
BEGIN
 PERFORM b.id FROM plugin_data.csf_sheet_sync_bindings b JOIN plugin_data.csf_sheet_sync_destinations dest ON dest.id=b.destination_id WHERE EXISTS(SELECT 1 FROM unnest(ARRAY[old_row,new_row]) r WHERE r IS NOT NULL AND dest.organization_id=(r->>'organization_id')::uuid AND dest.term_id=coalesce((r->>'term_id')::uuid,(SELECT term_id FROM plugin_data.csf_meetings WHERE organization_id=(r->>'organization_id')::uuid AND id=(r->>'meeting_id')::uuid))) ORDER BY b.id FOR NO KEY UPDATE OF b;
 FOR scope IN SELECT DISTINCT (r->>'organization_id')::uuid org,coalesce((r->>'term_id')::uuid,(SELECT term_id FROM plugin_data.csf_meetings WHERE organization_id=(r->>'organization_id')::uuid AND id=(r->>'meeting_id')::uuid)) term FROM unnest(ARRAY[old_row,new_row]) r WHERE r IS NOT NULL LOOP
  FOR d IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=scope.org AND term_id=scope.term LOOP
   UPDATE plugin_data.csf_sheet_sync_bindings SET scope_revision=scope_revision+1 WHERE organization_id=scope.org AND destination_id=d.id;
   IF NOT d.enabled THEN CONTINUE; END IF;
   FOR target IN
    SELECT 'profile' kind,p.id FROM plugin_data.csf_profiles p WHERE d.kind='class' AND p.organization_id=scope.org
    UNION SELECT 'application',a.id FROM plugin_data.csf_term_applications a WHERE d.kind='applications' AND a.organization_id=scope.org AND a.term_id=d.term_id
    UNION SELECT 'point_submission',p.id FROM plugin_data.csf_point_submissions p WHERE d.kind='point_submissions' AND p.organization_id=scope.org AND p.term_id=d.term_id
    UNION SELECT b.record_kind,b.record_id FROM plugin_data.csf_sheet_sync_bindings b WHERE b.organization_id=scope.org AND b.destination_id=d.id
   LOOP
    IF plugin_data.csf_sheet_sync_destination_snapshot(scope.org,d.id,target.kind,target.id) IS NOT NULL THEN PERFORM plugin_data.csf_queue_sheet_sync_record_internal(scope.org,d.id,target.kind,target.id); END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_term_sheet_sync_records() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER csf_sheet_sync_cohort_terms AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_cohort_terms FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_term_sheet_sync_records();
CREATE TRIGGER csf_sheet_sync_policy AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_policies FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_term_sheet_sync_records();
CREATE TRIGGER csf_sheet_sync_meetings AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_meetings FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_term_sheet_sync_records();
CREATE TRIGGER csf_sheet_sync_legacy_meetings AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_meetings FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_term_sheet_sync_records();
CREATE TRIGGER csf_sheet_sync_sessions AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_meeting_sessions FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_term_sheet_sync_records();
CREATE TRIGGER csf_sheet_sync_attendance AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_meeting_attendance FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_cohort_memberships AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_profile_cohort_memberships FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_cohort_sheet_sync_records();
CREATE TRIGGER csf_sheet_sync_application AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_applications FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_points AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_point_submissions FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_profiles AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_profiles FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_accounts AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_profile_accounts FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_memberships AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_memberships FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_credits AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_credit_records FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_application_files AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_application_files FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_submission_files AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_submission_files FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_application_reviews AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_application_status_events FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_point_reviews AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_submission_reviews FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_notes AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_review_notes FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_local_messages AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_sheet_sync_local_messages FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
REVOKE ALL ON FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean),plugin_data.csf_assert_sheet_sync_destination_lease(uuid,uuid,uuid,text,uuid,text),plugin_data.csf_release_sheet_sync_destination(uuid,uuid,uuid),plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text),plugin_data.csf_record_sheet_sync_comment(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,boolean,boolean),plugin_data.csf_bind_sheet_sync_thread(uuid,uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean),plugin_data.csf_assert_sheet_sync_destination_lease(uuid,uuid,uuid,text,uuid,text),plugin_data.csf_release_sheet_sync_destination(uuid,uuid,uuid),plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text),plugin_data.csf_record_sheet_sync_comment(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,boolean,boolean),plugin_data.csf_bind_sheet_sync_thread(uuid,uuid,uuid,uuid,uuid,text,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_register_sheet_sync_test_workspace(uuid,uuid),plugin_data.csf_configure_sheet_sync_destination(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb),plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text),plugin_data.csf_sheet_sync_snapshot(uuid,text,uuid),plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid),plugin_data.csf_claim_sheet_sync_exports(uuid,uuid,uuid,integer),plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text),plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid),plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_sheet_sync_test_workspace(uuid,uuid),plugin_data.csf_configure_sheet_sync_destination(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb),plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text),plugin_data.csf_sheet_sync_snapshot(uuid,text,uuid),plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid),plugin_data.csf_claim_sheet_sync_exports(uuid,uuid,uuid,integer),plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text),plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid),plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text) TO service_role;
COMMIT;
