-- Service-only export requests, leased archive receipts, and explicit delivery outcomes.
BEGIN;
ALTER TABLE public.account_data_export_jobs
  ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN artifact_sha256 text,
  ADD COLUMN artifact_ready_at timestamptz,
  ADD COLUMN artifact_expires_at timestamptz,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'not_attempted'
    CHECK (delivery_status IN ('not_attempted', 'sending', 'accepted', 'skipped', 'failed')),
  ADD COLUMN delivery_attempted_at timestamptz,
  ADD COLUMN provider_message_id text;
ALTER TABLE public.account_data_export_jobs ALTER COLUMN protocol_version SET DEFAULT 2;
-- Old processing jobs may already have reached the provider. Operators reconcile
-- legacy jobs before adoption; the new worker never retries them automatically.
REVOKE INSERT ON public.account_data_export_jobs FROM anon, authenticated;
CREATE OR REPLACE FUNCTION app_private.client_relation_grant_catalog()
RETURNS TABLE (
  relation_name text,
  role_name text,
  privilege text,
  columns text[]
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT *
  FROM (
    VALUES
      ('account_data_export_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('certificate_verification_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('certificate_verification_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('content_reports'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_invitation_acceptance_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_invitation_acceptance_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_members'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_members'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_members'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_plugin_access'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_entitlements'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_feature_flags'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_installs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_public_member_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_public_member_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_public_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_public_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organizations'::text, 'anon'::text, 'SELECT'::text, ARRAY['allowed_email_domains', 'created_at', 'description', 'id', 'logo_url', 'name', 'show_members_publicly', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organizations'::text, 'authenticated'::text, 'INSERT'::text, ARRAY['allowed_email_domains', 'auto_join_domain', 'created_at', 'created_by', 'description', 'id', 'join_code', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'staff_join_token', 'staff_join_token_created_at', 'staff_join_token_expires_at', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'SELECT'::text, ARRAY['allowed_email_domains', 'created_at', 'description', 'id', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'UPDATE'::text, ARRAY['allowed_email_domains', 'auto_join_domain', 'created_at', 'created_by', 'description', 'id', 'join_code', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'staff_join_token', 'staff_join_token_created_at', 'staff_join_token_expires_at', 'type', 'username', 'verified', 'website']::text[]),
      ('plugin_audit_logs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugin_runtime_contracts'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugin_versions'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugins'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_discovery_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('project_discovery_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_paper_roster_entries'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_batches'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_images'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_rows'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_signups'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_signups'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('projects'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('projects_with_creator'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('projects_with_creator'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('public_profile_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('public_profile_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('system_banners'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('user_certificate_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('user_certificate_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_emails'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_emails'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'UPDATE'::text, NULL)
  ) AS catalog(relation_name, role_name, privilege, columns);
$$;

REVOKE ALL ON FUNCTION app_private.client_relation_grant_catalog()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_catalog()
  TO service_role;

CREATE TABLE app_private.account_export_artifacts (
  storage_path text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.account_data_export_jobs(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 50000000),
  planned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  removed_at timestamptz
);
ALTER TABLE app_private.account_export_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.account_export_artifacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON app_private.account_export_artifacts TO service_role;
CREATE INDEX account_export_artifacts_expiry_idx ON app_private.account_export_artifacts(expires_at)
  WHERE removed_at IS NULL;

CREATE FUNCTION public.request_account_data_export(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.account_data_export_jobs%ROWTYPE; v_email text; v_created boolean := false;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'export_auth_required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_user_id) THEN
    RAISE EXCEPTION 'export_account_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id
    AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL;
  IF nullif(v_email, '') IS NULL THEN RAISE EXCEPTION 'export_verified_email_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM public.account_data_export_jobs WHERE user_id = p_user_id
    AND (status IN ('pending', 'processing') OR requested_at > now() - interval '24 hours')
    ORDER BY requested_at DESC LIMIT 1;
  IF v_job.id IS NULL THEN
    v_created := true;
    INSERT INTO public.account_data_export_jobs(user_id, requested_by, delivery_email, request_metadata)
      VALUES (p_user_id, p_user_id, v_email, '{"requested_from":"account_security"}') RETURNING * INTO v_job;
    INSERT INTO public.account_data_export_audit_logs(job_id, user_id, event_type, status, source)
      VALUES (v_job.id, p_user_id, 'requested', 'info', 'account-security');
  END IF;
  RETURN jsonb_build_object('id', v_job.id, 'status', v_job.status, 'requested_at', v_job.requested_at,
    'delivery_email', v_job.delivery_email, 'protocol_version', v_job.protocol_version, 'existing', NOT v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_data_export(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_account_data_export(uuid) TO service_role;

CREATE FUNCTION public.claim_account_data_export_jobs(p_limit integer DEFAULT 1)
RETURNS SETOF public.account_data_export_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_candidate record; v_job public.account_data_export_jobs%ROWTYPE; v_count integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5 THEN RAISE EXCEPTION 'export_invalid_limit'; END IF;
  FOR v_candidate IN SELECT id, user_id FROM public.account_data_export_jobs
    WHERE protocol_version = 2 AND app_private.account_deletion_actor_is_active(user_id)
      AND (status IN ('pending', 'processing') OR (status = 'completed' AND delivery_status = 'not_attempted'))
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    ORDER BY requested_at, id LIMIT 25
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || v_candidate.user_id::text, 0)) THEN CONTINUE; END IF;
    IF NOT app_private.account_deletion_actor_is_active(v_candidate.user_id) THEN CONTINUE; END IF;
    SELECT * INTO v_job FROM public.account_data_export_jobs WHERE id = v_candidate.id
      AND protocol_version = 2
      AND (status IN ('pending', 'processing') OR (status = 'completed' AND delivery_status = 'not_attempted'))
      AND (lease_expires_at IS NULL OR lease_expires_at < now()) FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_job.artifact_ready_at IS NOT NULL AND (v_job.artifact_expires_at IS NULL OR v_job.artifact_expires_at <= now()) THEN
      UPDATE public.account_data_export_jobs SET delivery_status = 'failed', lease_token = NULL, lease_expires_at = NULL,
        error_message = 'Archive expired before notification.', updated_at = now() WHERE id = v_job.id;
      INSERT INTO public.account_data_export_audit_logs(job_id,user_id,event_type,status,source)
        VALUES(v_job.id,v_job.user_id,'notification_expired','error','export-worker');
      CONTINUE;
    END IF;
    IF v_job.attempt_count >= 5 AND v_job.artifact_ready_at IS NULL THEN
      UPDATE public.account_data_export_jobs SET status = 'failed', failed_at = now(),
        error_message = 'Archive generation could not be confirmed.', lease_token = NULL, lease_expires_at = NULL
        WHERE id = v_job.id;
      CONTINUE;
    END IF;
    UPDATE public.account_data_export_jobs SET
      status = CASE WHEN artifact_ready_at IS NULL THEN 'processing' ELSE 'completed' END,
      lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes',
      started_at = coalesce(started_at, now()), last_attempt_at = now(), attempt_count = attempt_count + 1,
      updated_at = now()
      WHERE id = v_job.id RETURNING * INTO v_job;
    RETURN NEXT v_job;
    v_count := v_count + 1;
    EXIT WHEN v_count >= p_limit;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_data_export_jobs(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_data_export_jobs(integer) TO service_role;

CREATE FUNCTION public.advance_account_data_export(p_job_id uuid, p_lease uuid, p_step text, p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.account_data_export_jobs%ROWTYPE; v_user uuid; v_path text; v_email text; v_outcome text;
BEGIN
  SELECT user_id INTO v_user FROM public.account_data_export_jobs WHERE id = p_job_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'export_job_missing' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || v_user::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(v_user) THEN RAISE EXCEPTION 'export_account_unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM public.account_data_export_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.protocol_version <> 2 OR v_job.lease_token IS DISTINCT FROM p_lease
    OR p_lease IS NULL OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'export_lease_lost' USING ERRCODE = '55P03';
  END IF;
  IF p_step = 'plan_artifact' AND v_job.status = 'processing' AND v_job.artifact_ready_at IS NULL THEN
    v_path := v_user::text || '/' || p_job_id::text || '/' || p_lease::text || '.zip';
    IF NOT (p_data ?& ARRAY['sha256','size_bytes','record_count','datasets_count','manifest'])
      OR jsonb_typeof(p_data->'sha256') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_data->'size_bytes') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_data->'record_count') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_data->'datasets_count') IS DISTINCT FROM 'number'
      OR p_data->>'sha256' !~ '^[a-f0-9]{64}$' OR p_data->>'sha256' IS NULL
      OR (p_data->>'size_bytes')::bigint NOT BETWEEN 1 AND 50000000
      OR p_data->>'size_bytes' IS NULL OR (p_data->>'record_count')::integer NOT BETWEEN 0 AND 100000
      OR (p_data->>'datasets_count')::integer NOT BETWEEN 1 AND 100
      OR (p_data->'manifest'->>'totalDatasets')::integer IS DISTINCT FROM (p_data->>'datasets_count')::integer OR jsonb_typeof(p_data->'manifest') <> 'object'
      OR octet_length((p_data->'manifest')::text) > 20000 THEN RAISE EXCEPTION 'export_invalid_artifact'; END IF;
    INSERT INTO app_private.account_export_artifacts(storage_path, job_id, sha256, size_bytes)
      VALUES (v_path, p_job_id, p_data->>'sha256', (p_data->>'size_bytes')::bigint);
    UPDATE public.account_data_export_jobs SET storage_path = v_path, artifact_sha256 = p_data->>'sha256',
      zip_size_bytes = (p_data->>'size_bytes')::bigint, record_count = (p_data->>'record_count')::integer,
      datasets_count = (p_data->>'datasets_count')::integer, export_metadata = jsonb_build_object('manifest', p_data->'manifest'),
      updated_at = now() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'archive_ready' AND v_job.status = 'processing' AND v_job.storage_path IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app_private.account_export_artifacts a WHERE a.storage_path = v_job.storage_path
      AND a.job_id = p_job_id AND a.sha256 = v_job.artifact_sha256 AND a.size_bytes = v_job.zip_size_bytes
      AND a.removed_at IS NULL AND a.expires_at > now()) THEN RAISE EXCEPTION 'export_artifact_missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'data-exports' AND o.name = v_job.storage_path
      AND (o.metadata->>'size') ~ '^[0-9]{1,9}$' AND (o.metadata->>'size')::bigint = v_job.zip_size_bytes) THEN
      RAISE EXCEPTION 'export_storage_unconfirmed';
    END IF;
    UPDATE public.account_data_export_jobs SET status = 'completed', completed_at = now(), artifact_ready_at = now(),
      artifact_expires_at = (SELECT expires_at FROM app_private.account_export_artifacts WHERE storage_path = v_job.storage_path),
      signed_url = NULL, signed_url_expires_at = NULL, error_message = NULL, updated_at = now()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'begin_delivery' AND v_job.status = 'completed' AND v_job.delivery_status = 'not_attempted' THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_user AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL;
    IF nullif(v_email, '') IS NULL OR v_job.artifact_expires_at IS NULL OR v_job.artifact_expires_at <= now() THEN RAISE EXCEPTION 'export_delivery_unavailable'; END IF;
    UPDATE public.account_data_export_jobs SET delivery_status = 'sending', delivery_attempted_at = now(),
      delivery_email = v_email, updated_at = now() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'settle_delivery' AND v_job.delivery_status = 'sending' THEN
    v_outcome := p_data->>'outcome';
    IF v_outcome NOT IN ('accepted', 'skipped', 'failed', 'unknown') OR v_outcome IS NULL THEN RAISE EXCEPTION 'export_invalid_outcome'; END IF;
    UPDATE public.account_data_export_jobs SET delivery_status = CASE WHEN v_outcome = 'unknown' THEN 'sending' ELSE v_outcome END,
      provider_message_id = CASE WHEN v_outcome = 'accepted' THEN left(p_data->>'message_id', 200) ELSE NULL END,
      lease_expires_at = NULL, lease_token = NULL, updated_at = now()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'failed' AND v_job.status = 'processing' THEN
    UPDATE public.account_data_export_jobs SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
      failed_at = CASE WHEN attempt_count >= 5 THEN now() ELSE NULL END,
      error_message = 'Archive generation could not be confirmed.', lease_expires_at = now() + interval '20 minutes',
      lease_token = NULL, updated_at = now() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSE RAISE EXCEPTION 'export_transition_refused';
  END IF;
  INSERT INTO public.account_data_export_audit_logs(job_id, user_id, event_type, status, source, details)
    VALUES (p_job_id, v_user, p_step, CASE WHEN p_step = 'failed' THEN 'error' ELSE 'info' END, 'export-worker',
      jsonb_build_object('attempt', v_job.attempt_count, 'delivery_status', v_job.delivery_status));
  RETURN to_jsonb(v_job);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_account_data_export(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_account_data_export(uuid,uuid,text,jsonb) TO service_role;
CREATE FUNCTION public.expired_account_export_artifacts(p_limit integer DEFAULT 10)
RETURNS TABLE(storage_path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.storage_path FROM app_private.account_export_artifacts a
    WHERE a.removed_at IS NULL AND a.expires_at < now()
    ORDER BY a.expires_at, a.storage_path LIMIT greatest(0, least(p_limit, 25));
$$;
REVOKE ALL ON FUNCTION public.expired_account_export_artifacts(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expired_account_export_artifacts(integer) TO service_role;

CREATE FUNCTION public.confirm_account_export_artifact_removed(p_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'data-exports' AND name = p_path) THEN RETURN false; END IF;
  UPDATE app_private.account_export_artifacts SET removed_at = now()
    WHERE storage_path = p_path AND expires_at < now() AND removed_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_account_export_artifact_removed(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_account_export_artifact_removed(text) TO service_role;
COMMIT;
