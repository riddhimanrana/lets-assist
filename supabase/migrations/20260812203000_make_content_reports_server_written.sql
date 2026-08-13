-- AUD-041: moderation evidence is server-written.
--
-- Reporters keep owner-scoped SELECT and lose every direct write. Submission
-- moves behind one reviewed transaction that owns moderation state, charges
-- the combined quota atomically, and is replay-safe under a deterministic
-- request key. The reporter link becomes detachable so account deletion can
-- retain evidence without retaining identity.

BEGIN;

-- ---------------------------------------------------------------------------
-- Evidence columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS reporter_reference text;

COMMENT ON COLUMN public.content_reports.request_key IS
  'Server-derived sha256 idempotency key. One report per key; retries resolve to the existing row.';
COMMENT ON COLUMN public.content_reports.reporter_reference IS
  'Non-reversible sha256 of the reporter id. Survives account deletion so repeat-reporter patterns stay visible without retaining identity.';

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_request_key_format_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_request_key_format_check
  CHECK (request_key IS NULL OR request_key ~ '^[0-9a-f]{64}$');

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reporter_reference_format_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reporter_reference_format_check
  CHECK (reporter_reference IS NULL OR reporter_reference ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS content_reports_request_key_uidx
  ON public.content_reports (request_key);

UPDATE public.content_reports
SET reporter_reference = pg_catalog.encode(
  extensions.digest(
    pg_catalog.convert_to(
      'content-report-reporter:' || reporter_id::text,
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
)
WHERE reporter_id IS NOT NULL
  AND reporter_reference IS NULL;

-- Deleting an account must not silently erase moderation evidence, and it must
-- not be blocked by it either. The actor link is detached; the pseudonymous
-- reference and the report itself remain.
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reporter_id_fkey;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Client write closure
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS content_reports_insert_merged ON public.content_reports;
DROP POLICY IF EXISTS content_reports_update_merged ON public.content_reports;
DROP POLICY IF EXISTS content_reports_delete_merged ON public.content_reports;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.content_reports
  FROM PUBLIC, anon, authenticated;

-- Table-level revocation does not remove column-level grants, so every current
-- column is named explicitly.
REVOKE
  INSERT (
    id, reporter_id, content_type, content_id, reason, description, status,
    priority, reviewed_by, reviewed_at, resolution_notes, created_at,
    updated_at, resolved_at, ai_metadata, request_key, reporter_reference
  ),
  UPDATE (
    id, reporter_id, content_type, content_id, reason, description, status,
    priority, reviewed_by, reviewed_at, resolution_notes, created_at,
    updated_at, resolved_at, ai_metadata, request_key, reporter_reference
  )
  ON TABLE public.content_reports
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.content_reports
  TO service_role;

-- ---------------------------------------------------------------------------
-- Reviewed client relation ACL catalog
--
-- Restated literally from 20260812101100 with the three content_reports write
-- entries removed. No catalog deparsing is used to build this definition.
-- ---------------------------------------------------------------------------

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
      ('account_data_export_jobs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_catalog()
  TO service_role;

-- ---------------------------------------------------------------------------
-- The one reviewed submission transaction
--
-- Idempotency is checked first, so a retry never charges quota again. The
-- combined user/IP decision is evaluated over locked rows and only committed
-- when every bucket passes, so a denied second bucket cannot consume the
-- first. Moderation state (status, priority, timestamps, reporter reference)
-- is derived here, never accepted from the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_content_report(
  p_request_key text,
  p_reporter_id uuid,
  p_content_type text,
  p_content_id uuid,
  p_reason text,
  p_description text,
  p_rate_limit_keys text[],
  p_rate_limit_limits integer[],
  p_rate_limit_window_seconds integer
)
RETURNS TABLE (
  report_id uuid,
  replayed boolean,
  allowed boolean,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_bucket_count integer;
  v_denied_count integer;
  v_denied_reset timestamptz;
  v_existing_id uuid;
  v_report_id uuid;
  v_priority text;
BEGIN
  IF p_request_key IS NULL OR p_request_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid content report request key';
  END IF;
  IF p_reporter_id IS NULL THEN
    RAISE EXCEPTION 'content reports require an authenticated reporter';
  END IF;
  IF p_content_type IS NULL
    OR p_content_type NOT IN ('project', 'profile', 'organization') THEN
    RAISE EXCEPTION 'unsupported content report target type';
  END IF;
  IF p_content_id IS NULL THEN
    RAISE EXCEPTION 'content reports require a target identifier';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
    'spam', 'harassment', 'inappropriate_content', 'misinformation',
    'copyright', 'privacy_violation', 'violence', 'hate_speech', 'other'
  ) THEN
    RAISE EXCEPTION 'unsupported content report reason';
  END IF;
  IF p_description IS NULL
    OR pg_catalog.length(p_description) < 10
    OR pg_catalog.length(p_description) > 8000 THEN
    RAISE EXCEPTION 'content report description is out of bounds';
  END IF;

  v_bucket_count := pg_catalog.array_length(p_rate_limit_keys, 1);
  IF v_bucket_count IS NULL
    OR v_bucket_count < 1
    OR v_bucket_count > 4
    OR pg_catalog.array_length(p_rate_limit_limits, 1) IS DISTINCT FROM v_bucket_count THEN
    RAISE EXCEPTION 'invalid content report quota bucket set';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_rate_limit_keys) AS bucket_key
    WHERE bucket_key IS NULL
      OR pg_catalog.length(bucket_key) = 0
      OR pg_catalog.length(bucket_key) > 200
  ) THEN
    RAISE EXCEPTION 'invalid content report quota key';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_rate_limit_limits) AS bucket_limit
    WHERE bucket_limit IS NULL OR bucket_limit < 1 OR bucket_limit > 10000
  ) THEN
    RAISE EXCEPTION 'invalid content report quota limit';
  END IF;
  IF p_rate_limit_window_seconds IS NULL
    OR p_rate_limit_window_seconds < 1
    OR p_rate_limit_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid content report quota window';
  END IF;

  -- Serialize identical requests so a concurrent retry replays instead of
  -- charging quota and racing the unique key.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.submit_content_report:' || p_request_key, 0)
  );

  SELECT existing.id
  INTO v_existing_id
  FROM public.content_reports AS existing
  WHERE existing.request_key = p_request_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, true, true, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.api_rate_limits AS limits (
    rate_limit_key, window_started_at, request_count, updated_at
  )
  SELECT bucket_key, v_now, 0, v_now
  FROM pg_catalog.unnest(p_rate_limit_keys) AS bucket_key
  ON CONFLICT (rate_limit_key) DO NOTHING;

  -- Deterministic lock order across buckets keeps concurrent submissions from
  -- deadlocking against each other.
  PERFORM 1
  FROM public.api_rate_limits AS limits
  WHERE limits.rate_limit_key = ANY (p_rate_limit_keys)
  ORDER BY limits.rate_limit_key
  FOR UPDATE;

  SELECT
    pg_catalog.count(*) FILTER (WHERE evaluated.request_count >= evaluated.bucket_limit),
    pg_catalog.max(
      evaluated.window_started_at
      + pg_catalog.make_interval(secs => p_rate_limit_window_seconds)
    ) FILTER (WHERE evaluated.request_count >= evaluated.bucket_limit)
  INTO v_denied_count, v_denied_reset
  FROM (
    SELECT
      bucket.bucket_limit,
      CASE
        WHEN limits.window_started_at
             + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= v_now
          THEN v_now
        ELSE limits.window_started_at
      END AS window_started_at,
      CASE
        WHEN limits.window_started_at
             + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= v_now
          THEN 0
        ELSE limits.request_count
      END AS request_count
    -- The multi-argument form of unnest is parser syntax and cannot be
    -- schema-qualified; pg_catalog still resolves it under the pinned path.
    FROM unnest(p_rate_limit_keys, p_rate_limit_limits)
      AS bucket(bucket_key, bucket_limit)
    JOIN public.api_rate_limits AS limits
      ON limits.rate_limit_key = bucket.bucket_key
  ) AS evaluated;

  IF v_denied_count > 0 THEN
    RETURN QUERY SELECT NULL::uuid, false, false, v_denied_reset;
    RETURN;
  END IF;

  UPDATE public.api_rate_limits AS limits
  SET
    window_started_at = CASE
      WHEN limits.window_started_at
           + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= v_now
        THEN v_now
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at
           + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= v_now
        THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = v_now
  WHERE limits.rate_limit_key = ANY (p_rate_limit_keys);

  v_priority := CASE
    WHEN p_reason IN ('violence', 'hate_speech') THEN 'high'
    ELSE 'normal'
  END;

  INSERT INTO public.content_reports (
    reporter_id,
    reporter_reference,
    content_type,
    content_id,
    reason,
    description,
    status,
    priority,
    created_at,
    updated_at,
    request_key
  )
  VALUES (
    p_reporter_id,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'content-report-reporter:' || p_reporter_id::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    p_content_type,
    p_content_id,
    p_reason,
    p_description,
    'pending',
    v_priority,
    v_now,
    v_now,
    p_request_key
  )
  RETURNING id INTO v_report_id;

  RETURN QUERY SELECT v_report_id, false, true, NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_content_report(
  text, uuid, text, uuid, text, text, text[], integer[], integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_content_report(
  text, uuid, text, uuid, text, text, text[], integer[], integer
) TO service_role;

-- ---------------------------------------------------------------------------
-- Fail closed on residual client write authority
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  client_role text;
  report_column text;
BEGIN
  IF (
    SELECT pg_catalog.array_agg(privilege ORDER BY privilege)
    FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'content_reports'
      AND role_name = 'authenticated'
  ) IS DISTINCT FROM ARRAY['SELECT'::text] THEN
    RAISE EXCEPTION
      'content_reports client relation catalog must contain authenticated SELECT only';
  END IF;

  FOREACH client_role IN ARRAY ARRAY['anon'::text, 'authenticated'::text]
  LOOP
    IF pg_catalog.has_table_privilege(client_role, 'public.content_reports', 'INSERT')
      OR pg_catalog.has_table_privilege(client_role, 'public.content_reports', 'UPDATE')
      OR pg_catalog.has_table_privilege(client_role, 'public.content_reports', 'DELETE')
    THEN
      RAISE EXCEPTION '% retains a content_reports table write privilege', client_role;
    END IF;

    FOR report_column IN
      SELECT attribute.attname
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.content_reports'::pg_catalog.regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    LOOP
      IF pg_catalog.has_column_privilege(
           client_role, 'public.content_reports', report_column, 'INSERT'
         )
        OR pg_catalog.has_column_privilege(
             client_role, 'public.content_reports', report_column, 'UPDATE'
           )
      THEN
        RAISE EXCEPTION
          '% retains a content_reports column write privilege on %',
          client_role, report_column;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.content_reports'::pg_catalog.regclass
      AND polcmd IN ('a', 'w', 'd')
  ) THEN
    RAISE EXCEPTION 'content_reports retains a client write policy';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.submit_content_report(text, uuid, text, uuid, text, text, text[], integer[], integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute the content report transaction';
  END IF;
END;
$$;

COMMIT;
