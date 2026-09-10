-- Queue versioned Sheet exports and staff-reviewed inbound changes behind private destination leases.
BEGIN;

CREATE TABLE plugin_data.csf_sheet_sync_test_workspaces (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  registered_by uuid NOT NULL REFERENCES auth.users(id), registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_data.csf_sheet_sync_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  spreadsheet_file_id text NOT NULL CHECK (length(spreadsheet_file_id) BETWEEN 8 AND 200),
  sheet_id integer NOT NULL CHECK (sheet_id >= 0),
  kind text NOT NULL CHECK (kind IN ('applications','class','point_submissions')),
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id), term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id),
  is_test boolean NOT NULL, enabled boolean NOT NULL DEFAULT false,
  configured_by uuid NOT NULL REFERENCES auth.users(id),
  privacy_verified_at timestamptz, comment_capability text NOT NULL DEFAULT 'pending' CHECK (comment_capability IN ('pending','available','blocked')),
  owned_start_column integer NOT NULL DEFAULT 0 CHECK(owned_start_column>=0),
  managed_headers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(managed_headers)='array'),
  poll_lease_token uuid, poll_lease_expires_at timestamptz,
  next_poll_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE(spreadsheet_file_id,sheet_id), CHECK (NOT enabled OR (privacy_verified_at IS NOT NULL AND comment_capability='available'))
);
CREATE TABLE plugin_data.csf_sheet_sync_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  destination_id uuid NOT NULL, record_kind text NOT NULL CHECK(record_kind IN ('application','point_submission','profile')),
  record_id uuid NOT NULL, logical_key text NOT NULL, sheet_id integer NOT NULL CHECK(sheet_id>=0),
  last_export_version text, remote_version text, last_seen_request jsonb NOT NULL DEFAULT '{}'::jsonb, thread_bindings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(thread_bindings)='object'),
  UNIQUE(destination_id,record_kind,record_id), UNIQUE(destination_id,logical_key),
  FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE plugin_data.csf_sheet_writeback_ledger
  ALTER COLUMN application_id DROP NOT NULL, ALTER COLUMN row_number DROP NOT NULL, ALTER COLUMN decision DROP NOT NULL,
  DROP CONSTRAINT csf_sheet_writeback_ledger_status_check,
  ADD COLUMN destination_id uuid REFERENCES plugin_data.csf_sheet_sync_destinations(id),
  ADD COLUMN record_kind text CHECK(record_kind IN ('application','point_submission','profile')),
  ADD COLUMN record_id uuid, ADD COLUMN source_version text, ADD COLUMN payload jsonb,
  ADD COLUMN lease_token uuid, ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT csf_sheet_writeback_ledger_status_check CHECK(status IN ('queued','sent','failed','pending_export','exporting','exported','retry_export','unknown_outcome','superseded')),
  ADD CONSTRAINT csf_sheet_writeback_shape CHECK(
    (destination_id IS NULL AND application_id IS NOT NULL AND row_number IS NOT NULL AND decision IS NOT NULL AND record_kind IS NULL AND status IN ('queued','sent','failed'))
    OR (destination_id IS NOT NULL AND application_id IS NULL AND record_kind IS NOT NULL AND record_id IS NOT NULL AND source_version IS NOT NULL AND payload IS NOT NULL AND status IN ('pending_export','exporting','exported','retry_export','unknown_outcome','superseded'))),
  ADD CONSTRAINT csf_sheet_writeback_destination_org_fk FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id);
CREATE UNIQUE INDEX csf_sheet_export_version_unique ON plugin_data.csf_sheet_writeback_ledger(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL;
CREATE INDEX csf_sheet_export_pending ON plugin_data.csf_sheet_writeback_ledger(destination_id,created_at) WHERE status IN ('pending_export','retry_export','exporting','unknown_outcome');
CREATE TABLE plugin_data.csf_sheet_sync_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, destination_id uuid NOT NULL,
  record_kind text NOT NULL CHECK(record_kind IN ('application','point_submission')),
  record_id uuid NOT NULL, source_version text NOT NULL, remote_version text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','discarded','stale')),
  reviewed_by uuid REFERENCES auth.users(id), review_reason text, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(destination_id,record_kind,record_id,remote_version),
  FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['csf_sheet_sync_test_workspaces','csf_sheet_sync_destinations','csf_sheet_sync_bindings','csf_sheet_sync_changes'] LOOP
    EXECUTE format('ALTER TABLE plugin_data.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON plugin_data.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT ALL ON plugin_data.%I TO service_role',t);
  END LOOP;
END $$;

CREATE FUNCTION plugin_data.csf_register_sheet_sync_test_workspace(p_organization_id uuid,p_actor_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_settings') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=p_organization_id) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Register an empty test workspace before copying records.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_test_workspaces VALUES(p_organization_id,p_actor_user_id,now());
END $$;

CREATE FUNCTION plugin_data.csf_configure_sheet_sync_destination(p_organization_id uuid,p_actor_user_id uuid,p_spreadsheet_file_id text,p_sheet_id integer,p_kind text,p_cohort_id uuid,p_term_id uuid,p_is_test boolean,p_owned_start_column integer DEFAULT 0,p_managed_headers jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_terms WHERE id=p_term_id AND organization_id=p_organization_id) OR (p_cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_cohorts WHERE id=p_cohort_id AND organization_id=p_organization_id)) THEN RAISE EXCEPTION 'Semester or class does not belong to this organization.'; END IF;
 IF p_is_test IS DISTINCT FROM EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_test_workspaces WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Test destinations require an isolated test workspace.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-destination:'||p_spreadsheet_file_id,0));
 IF EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_destinations WHERE spreadsheet_file_id=p_spreadsheet_file_id AND organization_id<>p_organization_id) THEN RAISE EXCEPTION 'This spreadsheet belongs to another workspace.'; END IF;
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
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 UPDATE plugin_data.csf_sheet_sync_destinations SET poll_lease_token=NULL,poll_lease_expires_at=NULL,enabled=p_enabled,privacy_verified_at=CASE WHEN p_privacy_verified THEN now() END,comment_capability=p_comment_capability,configured_by=p_actor_user_id,updated_at=now()
 WHERE organization_id=p_organization_id AND id=p_destination_id RETURNING * INTO d;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination not found.'; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.destination_state','sheet_sync_destination',d.id,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;

CREATE TABLE plugin_data.csf_sheet_sync_local_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,destination_id uuid NOT NULL,binding_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_sync_bindings(id),
 author_user_id uuid NOT NULL REFERENCES auth.users(id),provider_thread_id text,body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),resolved boolean,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id)
);
ALTER TABLE plugin_data.csf_sheet_sync_local_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_local_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON plugin_data.csf_sheet_sync_local_messages TO service_role;

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
 r:=r||jsonb_build_object('comments',n,'local_messages',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM plugin_data.csf_sheet_sync_local_messages m JOIN plugin_data.csf_sheet_sync_bindings b ON b.id=m.binding_id WHERE m.organization_id=p_organization_id AND b.record_kind=p_record_kind AND b.record_id=p_record_id),'[]'::jsonb));
 RETURN r;
END $$;

CREATE FUNCTION plugin_data.csf_queue_sheet_sync_record(p_organization_id uuid,p_actor_user_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE; r jsonb; v text; l plugin_data.csf_sheet_writeback_ledger%ROWTYPE; profile uuid;
BEGIN
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=p_destination_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 r:=plugin_data.csf_sheet_sync_snapshot(p_organization_id,p_record_kind,p_record_id);
 profile:=CASE WHEN p_record_kind='profile' THEN p_record_id ELSE (r->>'profile_id')::uuid END;
 IF (p_record_kind='application' AND d.cohort_id IS NOT NULL AND (r->>'cohort_id')::uuid<>d.cohort_id) OR (p_record_kind<>'profile' AND (r->>'term_id')::uuid<>d.term_id) OR (d.cohort_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=p_organization_id AND profile_id=profile AND cohort_id=d.cohort_id AND status='active')) OR (d.kind='applications' AND p_record_kind<>'application') OR (d.kind='point_submissions' AND p_record_kind<>'point_submission') OR (d.kind='class' AND p_record_kind<>'profile') THEN RAISE EXCEPTION 'Record is outside this destination.'; END IF;
 v:=md5(r::text);
 INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,logical_key,sheet_id) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,p_record_kind||':'||p_record_id::text,d.sheet_id) ON CONFLICT(destination_id,record_kind,record_id) DO NOTHING;
 INSERT INTO plugin_data.csf_sheet_writeback_ledger(organization_id,spreadsheet_file_id,sheet_tab,status,destination_id,record_kind,record_id,source_version,payload)
 VALUES(p_organization_id,d.spreadsheet_file_id,NULL,'pending_export',d.id,p_record_kind,p_record_id,v,r)
 ON CONFLICT(destination_id,record_kind,record_id,source_version) WHERE destination_id IS NOT NULL DO NOTHING RETURNING * INTO l;
 IF l.id IS NULL THEN SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND source_version=v; END IF;
 RETURN to_jsonb(l);
END $$;

CREATE FUNCTION plugin_data.csf_claim_sheet_sync_exports(p_organization_id uuid,p_destination_id uuid,p_destination_lease_token uuid,p_limit integer DEFAULT 25) RETURNS SETOF plugin_data.csf_sheet_writeback_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id FOR UPDATE;
 IF NOT FOUND OR NOT d.enabled OR d.poll_lease_token IS DISTINCT FROM p_destination_lease_token OR p_destination_lease_token IS NULL OR d.poll_lease_expires_at<now() OR NOT plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'manage_sheet_sync') THEN RETURN; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status='unknown_outcome',last_error='The write lease expired. Reconcile the destination before retrying.' WHERE destination_id=d.id AND status='exporting' AND lease_expires_at<now();
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status='superseded' WHERE destination_id=d.id AND status IN ('pending_export','retry_export') AND source_version<>md5(plugin_data.csf_sheet_sync_snapshot(organization_id,record_kind,record_id)::text);
 RETURN QUERY WITH candidates AS (
   SELECT l.id FROM plugin_data.csf_sheet_writeback_ledger l WHERE l.destination_id=d.id AND l.status IN ('pending_export','retry_export')
   AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_writeback_ledger b WHERE b.destination_id=l.destination_id AND b.record_kind=l.record_kind AND b.record_id=l.record_id AND b.status IN ('exporting','unknown_outcome'))
   ORDER BY l.created_at,l.id LIMIT greatest(1,least(p_limit,100)) FOR UPDATE SKIP LOCKED
 ) UPDATE plugin_data.csf_sheet_writeback_ledger l SET status='exporting',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() FROM candidates c WHERE l.id=c.id RETURNING l.*;
END $$;

CREATE FUNCTION plugin_data.csf_finish_sheet_sync_export(p_organization_id uuid,p_ledger_id uuid,p_lease_token uuid,p_outcome text,p_remote_version text,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l plugin_data.csf_sheet_writeback_ledger%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('exported','retry_export','unknown_outcome') THEN RAISE EXCEPTION 'Invalid export outcome.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id=p_organization_id AND id=p_ledger_id AND destination_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR l.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Export lease no longer belongs to this attempt.'; END IF;
 IF l.status=p_outcome THEN RETURN to_jsonb(l); END IF;
 IF l.status<>'exporting' OR l.lease_expires_at<now() THEN RAISE EXCEPTION 'Export lease expired. Reconcile before retrying.'; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=p_outcome,last_error=left(p_error,1000),updated_at=now(),sent_at=CASE WHEN p_outcome='exported' THEN now() END WHERE id=l.id RETURNING * INTO l;
 IF p_outcome='exported' THEN
   UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_version=l.source_version,remote_version=p_remote_version WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id;
   UPDATE plugin_data.csf_sheet_sync_destinations SET last_synced_at=now() WHERE id=l.destination_id;
 END IF;
 RETURN to_jsonb(l);
END $$;

CREATE FUNCTION plugin_data.csf_record_sheet_sync_change(p_organization_id uuid,p_destination_id uuid,p_record_kind text,p_record_id uuid,p_source_version text,p_remote_version text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; d plugin_data.csf_sheet_sync_destinations%ROWTYPE; b plugin_data.csf_sheet_sync_bindings%ROWTYPE; request jsonb;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id;
 IF NOT FOUND OR NOT d.enabled OR NOT plugin_data.csf_actor_has_permission(p_organization_id,d.configured_by,'manage_sheet_sync') THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND last_export_version=p_source_version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unrecognized record version.'; END IF;
 request:=p_payload-ARRAY['author_display_name','author_provider_id'];
 IF request='{}'::jsonb THEN UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request='{}'::jsonb WHERE id=b.id; RETURN jsonb_build_object('status','unchanged'); END IF;
 IF request=b.last_seen_request THEN RETURN jsonb_build_object('status','unchanged'); END IF;
 IF p_record_kind NOT IN ('application','point_submission') OR p_payload->>'action' NOT IN ('approved','rejected','needs_action','duplicate') OR p_payload->>'action' IS NULL OR (p_record_kind='application' AND p_payload->>'action'='duplicate') OR p_payload - ARRAY['action','review_notes','awarded_points','author_display_name','author_provider_id'] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported Sheet change.'; END IF;
 IF length(p_remote_version)>500 OR length(p_payload::text)>10000 THEN RAISE EXCEPTION 'Sheet change exceeds the size limit.'; END IF;
 INSERT INTO plugin_data.csf_sheet_sync_changes(organization_id,destination_id,record_kind,record_id,source_version,remote_version,payload) VALUES(p_organization_id,d.id,p_record_kind,p_record_id,p_source_version,p_remote_version,p_payload)
 ON CONFLICT(destination_id,record_kind,record_id,remote_version) DO NOTHING RETURNING * INTO c;
 IF c.id IS NULL THEN
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE destination_id=d.id AND record_kind=p_record_kind AND record_id=p_record_id AND remote_version=p_remote_version;
 IF c.payload<>p_payload OR c.source_version<>p_source_version THEN RAISE EXCEPTION 'Conflicting change uses an existing remote version.'; END IF;
 END IF;
 UPDATE plugin_data.csf_sheet_sync_bindings SET last_seen_request=request WHERE id=b.id;
 RETURN to_jsonb(c);
END $$;

CREATE FUNCTION plugin_data.csf_review_sheet_sync_change(p_organization_id uuid,p_actor_user_id uuid,p_change_id uuid,p_accept boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c plugin_data.csf_sheet_sync_changes%ROWTYPE; r jsonb;
BEGIN
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO c FROM plugin_data.csf_sheet_sync_changes WHERE organization_id=p_organization_id AND id=p_change_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sheet change not found.'; END IF;
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,CASE WHEN c.record_kind='application' THEN 'decide_applications' ELSE 'verify_submissions' END) THEN RAISE EXCEPTION 'Not authorized to review this record.'; END IF;
 IF c.status<>'pending' THEN RETURN to_jsonb(c); END IF;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'Choose accept or discard.'; END IF;
 IF p_accept THEN
   IF c.record_kind='application' THEN PERFORM 1 FROM plugin_data.csf_term_applications WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE;
   ELSE PERFORM 1 FROM plugin_data.csf_point_submissions WHERE organization_id=p_organization_id AND id=c.record_id FOR UPDATE; END IF;
   r:=plugin_data.csf_sheet_sync_snapshot(p_organization_id,c.record_kind,c.record_id);
   IF md5(r::text)<>c.source_version THEN c.status:='stale';
   ELSE
     IF c.record_kind='application' THEN PERFORM plugin_data.csf_decide_term_application(p_organization_id,c.record_id,CASE WHEN c.payload->>'action'='approved' THEN 'accepted' ELSE c.payload->>'action' END,c.payload->>'review_notes',p_actor_user_id,c.id);
     ELSE PERFORM plugin_data.csf_review_point_submission_request(p_organization_id,c.record_id,c.payload->>'action',(c.payload->>'awarded_points')::numeric,c.payload->>'review_notes',p_actor_user_id,c.id); END IF;
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
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 k:=CASE d.kind WHEN 'applications' THEN 'application' WHEN 'point_submissions' THEN 'point_submission' ELSE 'profile' END;
 FOR r IN
  SELECT candidate.id FROM (
   SELECT a.id,a.profile_id FROM plugin_data.csf_term_applications a WHERE d.kind='applications' AND a.organization_id=p_organization_id AND a.term_id=d.term_id AND (d.cohort_id IS NULL OR a.cohort_id=d.cohort_id)
   UNION ALL SELECT p.id,p.profile_id FROM plugin_data.csf_point_submissions p WHERE d.kind='point_submissions' AND p.organization_id=p_organization_id AND p.term_id=d.term_id
   UNION ALL SELECT f.id,f.id FROM plugin_data.csf_profiles f WHERE d.kind='class' AND f.organization_id=p_organization_id
  ) candidate WHERE (p_cursor IS NULL OR candidate.id>p_cursor) AND (d.cohort_id IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=p_organization_id AND profile_id=candidate.profile_id AND cohort_id=d.cohort_id AND status='active'))
  ORDER BY candidate.id LIMIT greatest(1,least(p_limit,200))
 LOOP
  PERFORM plugin_data.csf_queue_sheet_sync_record(p_organization_id,p_actor_user_id,d.id,k,r.id); n:=n+1;last_id:=r.id;
 END LOOP;
 RETURN jsonb_build_object('count',n,'next_cursor',CASE WHEN n=greatest(1,least(p_limit,200)) THEN last_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_seed_sheet_sync_destination(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_seed_sheet_sync_destination(uuid,uuid,uuid,uuid,integer) TO service_role;

CREATE FUNCTION plugin_data.csf_claim_sheet_sync_destination(p_organization_id uuid,p_destination_id uuid,p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 UPDATE plugin_data.csf_sheet_sync_destinations SET poll_lease_token=gen_random_uuid(),poll_lease_expires_at=now()+interval '2 minutes',next_poll_at=now()+interval '2 minutes'
 WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled AND (p_force OR next_poll_at<=now()) AND (poll_lease_expires_at IS NULL OR poll_lease_expires_at<now()) AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'manage_sheet_sync') RETURNING * INTO d;
 RETURN CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d) END;
END $$;
CREATE FUNCTION plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id uuid,p_destination_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=p_organization_id AND id=p_destination_id AND enabled AND poll_lease_token=p_lease_token AND poll_lease_expires_at>now() AND plugin_data.csf_actor_has_permission(organization_id,configured_by,'manage_sheet_sync');
 IF NOT FOUND THEN RAISE EXCEPTION 'Sync lease expired or access changed.'; END IF;
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
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'manage_sheet_sync') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Record the destination reconciliation result.'; END IF;
 SELECT * INTO l FROM plugin_data.csf_sheet_writeback_ledger WHERE id=p_ledger_id AND organization_id=p_organization_id AND destination_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR l.status<>'unknown_outcome' THEN RAISE EXCEPTION 'Export is not awaiting reconciliation.'; END IF;
 UPDATE plugin_data.csf_sheet_writeback_ledger SET status=CASE WHEN p_was_written THEN 'exported' ELSE 'retry_export' END,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=l.id RETURNING * INTO l;
 IF p_was_written THEN UPDATE plugin_data.csf_sheet_sync_bindings SET last_export_version=l.source_version,remote_version=p_remote_version WHERE destination_id=l.destination_id AND record_kind=l.record_kind AND record_id=l.record_id; END IF;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.export_reconciled','sheet_writeback_ledger',l.id,jsonb_build_object('was_written',p_was_written,'reason',p_reason));
 RETURN to_jsonb(l);
END $$;

CREATE TABLE plugin_data.csf_sheet_sync_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,destination_id uuid NOT NULL,
 binding_id uuid NOT NULL REFERENCES plugin_data.csf_sheet_sync_bindings(id),
 provider_thread_id text NOT NULL,provider_message_id text NOT NULL,provider_version text NOT NULL,
 author jsonb NOT NULL CHECK(jsonb_typeof(author)='object'),body text NOT NULL CHECK(length(body)<=10000),resolved boolean NOT NULL DEFAULT false,deleted boolean NOT NULL DEFAULT false,
 source text NOT NULL DEFAULT 'google_sheets' CHECK(source='google_sheets'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(destination_id,provider_message_id),
 FOREIGN KEY(organization_id,destination_id) REFERENCES plugin_data.csf_sheet_sync_destinations(organization_id,id)
);
ALTER TABLE plugin_data.csf_sheet_sync_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plugin_data.csf_sheet_sync_comments FROM PUBLIC,anon,authenticated;
GRANT ALL ON plugin_data.csf_sheet_sync_comments TO service_role;
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
 INSERT INTO plugin_data.csf_sheet_sync_comments(organization_id,destination_id,binding_id,provider_thread_id,provider_message_id,provider_version,author,body,resolved,deleted)
 VALUES(p_organization_id,p_destination_id,p_binding_id,p_thread_id,p_message_id,p_provider_version,p_author,p_body,p_resolved,p_deleted)
 ON CONFLICT(destination_id,provider_message_id) DO UPDATE SET provider_version=EXCLUDED.provider_version,author=EXCLUDED.author,body=EXCLUDED.body,resolved=EXCLUDED.resolved,deleted=EXCLUDED.deleted,updated_at=now() RETURNING * INTO c;
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,action,target_type,target_id,after_data) VALUES(p_organization_id,'sheet_sync.comment_observed','sheet_sync_comment',c.id,to_jsonb(c));
 RETURN to_jsonb(c);
END $$;
CREATE FUNCTION plugin_data.csf_bind_sheet_sync_thread(p_organization_id uuid,p_destination_id uuid,p_lease_token uuid,p_binding_id uuid,p_local_message_id uuid,p_provider_thread_id text,p_provider_post_id text,p_local_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b plugin_data.csf_sheet_sync_bindings%ROWTYPE;
BEGIN
 PERFORM plugin_data.csf_assert_sheet_sync_destination_lease(p_organization_id,p_destination_id,p_lease_token);
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE id=p_binding_id AND organization_id=p_organization_id AND destination_id=p_destination_id FOR UPDATE;
 IF NOT FOUND OR NOT (EXISTS(SELECT 1 FROM plugin_data.csf_review_notes WHERE organization_id=p_organization_id AND id=p_local_message_id AND subject_id=b.record_id AND subject_kind::text=b.record_kind) OR (b.record_kind='point_submission' AND EXISTS(SELECT 1 FROM plugin_data.csf_submission_reviews WHERE organization_id=p_organization_id AND id=p_local_message_id AND submission_id=b.record_id)) OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_local_messages WHERE organization_id=p_organization_id AND id=p_local_message_id AND binding_id=b.id)) THEN RAISE EXCEPTION 'Local comment binding not found.'; END IF;
 IF b.thread_bindings ? p_local_message_id::text AND b.thread_bindings->p_local_message_id::text->>'threadId'<>p_provider_thread_id THEN RAISE EXCEPTION 'Comment already has a different provider thread.'; END IF;
 UPDATE plugin_data.csf_sheet_sync_bindings SET thread_bindings=thread_bindings||jsonb_build_object(p_local_message_id::text,jsonb_build_object('threadId',p_provider_thread_id,'postId',p_provider_post_id,'localVersion',p_local_version)) WHERE id=b.id RETURNING * INTO b;
 RETURN to_jsonb(b);
END $$;

CREATE FUNCTION plugin_data.csf_add_sheet_sync_local_message(p_organization_id uuid,p_actor_user_id uuid,p_binding_id uuid,p_request_id uuid,p_thread_id text,p_body text,p_resolved boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b plugin_data.csf_sheet_sync_bindings%ROWTYPE; m plugin_data.csf_sheet_sync_local_messages%ROWTYPE; d plugin_data.csf_sheet_sync_destinations%ROWTYPE;
BEGIN
 IF NOT plugin_data.csf_actor_has_permission(p_organization_id,p_actor_user_id,'verify_submissions') THEN RAISE EXCEPTION 'Not authorized.'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable message request identifier is required.'; END IF;
 SELECT * INTO b FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id=p_organization_id AND id=p_binding_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Comment binding not found.'; END IF;
 SELECT * INTO d FROM plugin_data.csf_sheet_sync_destinations WHERE id=b.destination_id AND organization_id=p_organization_id;
 IF NOT d.enabled THEN RAISE EXCEPTION 'Sync destination is disabled.'; END IF;
 IF p_thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_sync_comments WHERE binding_id=b.id AND provider_thread_id=p_thread_id) AND NOT EXISTS(SELECT 1 FROM jsonb_each(b.thread_bindings) WHERE value->>'threadId'=p_thread_id) THEN RAISE EXCEPTION 'Thread does not belong to this record.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('csf-sheet-message:'||p_request_id::text,0));
 SELECT * INTO m FROM plugin_data.csf_sheet_sync_local_messages WHERE id=p_request_id;
 IF FOUND THEN
  IF m.organization_id<>p_organization_id OR m.binding_id<>b.id OR m.author_user_id<>p_actor_user_id OR m.body<>p_body OR m.provider_thread_id IS DISTINCT FROM p_thread_id OR m.resolved IS DISTINCT FROM p_resolved THEN RAISE EXCEPTION 'Message request conflicts with its previous use.'; END IF;
  RETURN to_jsonb(m);
 END IF;
 INSERT INTO plugin_data.csf_sheet_sync_local_messages(id,organization_id,destination_id,binding_id,author_user_id,provider_thread_id,body,resolved) VALUES(p_request_id,p_organization_id,b.destination_id,b.id,p_actor_user_id,p_thread_id,p_body,p_resolved) RETURNING * INTO m;
 PERFORM plugin_data.csf_queue_sheet_sync_record(p_organization_id,d.configured_by,d.id,b.record_kind,b.record_id);
 INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,after_data) VALUES(p_organization_id,p_actor_user_id,'sheet_sync.message_added','sheet_sync_local_message',m.id,to_jsonb(m));
 RETURN to_jsonb(m);
END $$;
REVOKE ALL ON FUNCTION plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean) TO service_role;

CREATE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END; k text; rid uuid; d record; profile uuid; target record;
BEGIN
 IF TG_TABLE_NAME IN ('csf_term_applications','csf_point_submissions') THEN k:=CASE WHEN TG_TABLE_NAME='csf_term_applications' THEN 'application' ELSE 'point_submission' END; rid:=(r->>'id')::uuid;
 ELSIF TG_TABLE_NAME='csf_application_files' THEN k:='application';rid:=(r->>'application_id')::uuid;
 ELSIF TG_TABLE_NAME='csf_submission_files' OR (TG_TABLE_NAME='csf_credit_records' AND r->>'submission_id' IS NOT NULL) THEN k:='point_submission';rid:=(r->>'submission_id')::uuid;
 ELSIF TG_TABLE_NAME='csf_review_notes' THEN
  IF r->>'subject_kind' NOT IN ('application','profile') THEN RETURN NEW; END IF;
  k:=r->>'subject_kind'; rid:=(r->>'subject_id')::uuid;
 ELSIF TG_TABLE_NAME='csf_submission_reviews' THEN k:='point_submission';rid:=(r->>'submission_id')::uuid;
 ELSE k:='profile'; rid:=CASE WHEN TG_TABLE_NAME='csf_profiles' THEN (r->>'id')::uuid ELSE (r->>'profile_id')::uuid END; END IF;
 profile:=CASE WHEN k='profile' THEN rid ELSE (r->>'profile_id')::uuid END;
 FOR target IN SELECT k AS kind,rid AS id UNION SELECT 'profile',profile WHERE profile IS NOT NULL AND k<>'profile' LOOP
 FOR d IN SELECT * FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id=(r->>'organization_id')::uuid AND enabled LOOP
  IF plugin_data.csf_actor_has_permission(d.organization_id,d.configured_by,'manage_sheet_sync')
    AND ((target.kind='application' AND d.kind='applications') OR (target.kind='point_submission' AND d.kind='point_submissions') OR (target.kind='profile' AND d.kind='class'))
    AND (d.cohort_id IS NULL OR EXISTS(SELECT 1 FROM plugin_data.csf_profile_cohort_memberships WHERE organization_id=d.organization_id AND profile_id=coalesce(profile,(SELECT profile_id FROM plugin_data.csf_term_applications WHERE id=rid AND organization_id=d.organization_id),(SELECT profile_id FROM plugin_data.csf_point_submissions WHERE id=rid AND organization_id=d.organization_id)) AND cohort_id=d.cohort_id AND status='active'))
    AND (target.kind='profile' OR d.term_id=coalesce((r->>'term_id')::uuid,(SELECT term_id FROM plugin_data.csf_term_applications WHERE id=rid AND organization_id=d.organization_id),(SELECT term_id FROM plugin_data.csf_point_submissions WHERE id=rid AND organization_id=d.organization_id))) THEN
    PERFORM plugin_data.csf_queue_sheet_sync_record(d.organization_id,d.configured_by,d.id,target.kind,target.id);
  END IF;
 END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER csf_sheet_sync_application AFTER INSERT OR UPDATE ON plugin_data.csf_term_applications FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_points AFTER INSERT OR UPDATE ON plugin_data.csf_point_submissions FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_profiles AFTER INSERT OR UPDATE ON plugin_data.csf_profiles FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_accounts AFTER INSERT OR UPDATE OR DELETE ON plugin_data.csf_profile_accounts FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_memberships AFTER INSERT OR UPDATE ON plugin_data.csf_term_memberships FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_credits AFTER INSERT OR UPDATE ON plugin_data.csf_credit_records FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_application_files AFTER INSERT OR UPDATE ON plugin_data.csf_application_files FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_submission_files AFTER INSERT OR UPDATE ON plugin_data.csf_submission_files FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_point_reviews AFTER INSERT OR UPDATE ON plugin_data.csf_submission_reviews FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
CREATE TRIGGER csf_sheet_sync_notes AFTER INSERT OR UPDATE ON plugin_data.csf_review_notes FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_queue_changed_sheet_sync_record();
REVOKE ALL ON FUNCTION plugin_data.csf_queue_changed_sheet_sync_record() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean),plugin_data.csf_assert_sheet_sync_destination_lease(uuid,uuid,uuid),plugin_data.csf_release_sheet_sync_destination(uuid,uuid,uuid),plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text),plugin_data.csf_record_sheet_sync_comment(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,boolean,boolean),plugin_data.csf_bind_sheet_sync_thread(uuid,uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean),plugin_data.csf_assert_sheet_sync_destination_lease(uuid,uuid,uuid),plugin_data.csf_release_sheet_sync_destination(uuid,uuid,uuid),plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text),plugin_data.csf_record_sheet_sync_comment(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,boolean,boolean),plugin_data.csf_bind_sheet_sync_thread(uuid,uuid,uuid,uuid,uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_register_sheet_sync_test_workspace(uuid,uuid),plugin_data.csf_configure_sheet_sync_destination(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb),plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text),plugin_data.csf_sheet_sync_snapshot(uuid,text,uuid),plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid),plugin_data.csf_claim_sheet_sync_exports(uuid,uuid,uuid,integer),plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text),plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb),plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_sheet_sync_test_workspace(uuid,uuid),plugin_data.csf_configure_sheet_sync_destination(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb),plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text),plugin_data.csf_sheet_sync_snapshot(uuid,text,uuid),plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid),plugin_data.csf_claim_sheet_sync_exports(uuid,uuid,uuid,integer),plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text),plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb),plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text) TO service_role;
COMMIT;
