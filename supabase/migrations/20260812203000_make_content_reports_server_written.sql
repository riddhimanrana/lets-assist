-- AUD-041: moderation evidence is server-written.
--
-- Reporters keep owner-scoped SELECT and lose every direct write. Submission
-- moves behind one reviewed transaction that owns moderation state, confirms
-- the reported target actually exists, charges the combined quota atomically,
-- and replays a retry for a bounded window. The reporter link becomes
-- detachable so account deletion can retain evidence without retaining
-- identity, and the pseudonym itself is a random value rather than anything
-- derivable from the account.

BEGIN;

-- ---------------------------------------------------------------------------
-- Reporter pseudonyms
--
-- A report keeps a stable, opaque reference to its reporter so moderators can
-- still see that several reports came from one person, including after that
-- account is deleted. The reference is a random UUID minted here and stored
-- only in this server-only mapping: it carries no information about the
-- account and cannot be recomputed from one. (A digest of the user id would
-- be neither: the input space is a single UUID, so anyone holding a candidate
-- id can confirm it by hashing.)
--
-- Deleting an account nulls the mapping's reporter_id and leaves the
-- reference, so the reports stay linked to each other and to no one.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reporter_references (
  reference uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT reporter_references_reporter_id_key UNIQUE (reporter_id)
);

COMMENT ON TABLE public.reporter_references IS
  'Server-only mapping from a reporter account to its random opaque moderation pseudonym. Service role only; detached on account deletion.';
COMMENT ON COLUMN public.reporter_references.reference IS
  'Random pseudonym stored on content_reports. Not derived from the account and not recomputable.';
COMMENT ON COLUMN public.reporter_references.reporter_id IS
  'Reporter account, or NULL once that account is deleted.';

ALTER TABLE public.reporter_references ENABLE ROW LEVEL SECURITY;

-- Row-level security with no policy at all, matching `api_rate_limits`: any
-- role that somehow reached the table still sees nothing. The service role and
-- the SECURITY DEFINER owner below are the only intended readers, and they are
-- exempt. RLS is not forced, because forcing it would lock out the definer
-- that has to mint these rows.
REVOKE ALL ON TABLE public.reporter_references FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reporter_references TO service_role;

-- ---------------------------------------------------------------------------
-- Evidence columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS request_sequence integer,
  ADD COLUMN IF NOT EXISTS replay_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reporter_reference uuid;

COMMENT ON COLUMN public.content_reports.request_fingerprint IS
  'Server-derived sha256 of the reporter and the substance of the report. Carries no time component.';
COMMENT ON COLUMN public.content_reports.request_sequence IS
  'Which occurrence of this fingerprint the row is. Unique per fingerprint, so a concurrent duplicate cannot commit twice.';
COMMENT ON COLUMN public.content_reports.replay_expires_at IS
  'Server clock deadline until which an identical resubmission replays this row instead of creating a new one.';
COMMENT ON COLUMN public.content_reports.reporter_reference IS
  'Random opaque reporter pseudonym. Survives account deletion so repeat-reporter patterns stay visible without retaining identity.';

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_request_fingerprint_format_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_request_fingerprint_format_check
  CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_request_sequence_positive_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_request_sequence_positive_check
  CHECK (request_sequence IS NULL OR request_sequence >= 1);

-- Fingerprint and sequence are written together or not at all: a row with one
-- and not the other could neither be replayed nor protected from duplication.
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_request_identity_complete_check;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_request_identity_complete_check
  CHECK (
    (request_fingerprint IS NULL AND request_sequence IS NULL AND replay_expires_at IS NULL)
    OR (request_fingerprint IS NOT NULL AND request_sequence IS NOT NULL AND replay_expires_at IS NOT NULL)
  );

-- The idempotency backstop. The submission transaction already serializes one
-- fingerprint through an advisory lock, so this index should never be the
-- thing that rejects a request; it exists so that a future caller that forgets
-- the lock still cannot store the same occurrence twice.
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_request_occurrence_uidx
  ON public.content_reports (request_fingerprint, request_sequence);

-- Mint a pseudonym for every reporter that already has reports, then adopt it.
INSERT INTO public.reporter_references (reporter_id)
SELECT DISTINCT reports.reporter_id
FROM public.content_reports AS reports
WHERE reports.reporter_id IS NOT NULL
ON CONFLICT (reporter_id) DO NOTHING;

UPDATE public.content_reports AS reports
SET reporter_reference = mapping.reference
FROM public.reporter_references AS mapping
WHERE mapping.reporter_id = reports.reporter_id
  AND reports.reporter_reference IS NULL;

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reporter_reference_fkey;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reporter_reference_fkey
  FOREIGN KEY (reporter_reference)
  REFERENCES public.reporter_references(reference)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_content_reports_reporter_reference
  ON public.content_reports (reporter_reference);

-- Deleting an account must not silently erase moderation evidence, and it must
-- not be blocked by it either. The actor link is detached; the pseudonymous
-- reference and the report itself remain.
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reporter_id_fkey;
ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.detach_content_report_reporter(
  p_reporter_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_reporter_id IS NULL THEN
    RAISE EXCEPTION 'content report detachment requires a reporter';
  END IF;

  UPDATE public.content_reports
  SET reporter_id = NULL
  WHERE reporter_id = p_reporter_id;

  UPDATE public.reporter_references
  SET reporter_id = NULL
  WHERE reporter_id = p_reporter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.detach_content_report_reporter(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detach_content_report_reporter(uuid)
  TO service_role;

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
    updated_at, resolved_at, ai_metadata, request_fingerprint,
    request_sequence, replay_expires_at, reporter_reference
  ),
  UPDATE (
    id, reporter_id, content_type, content_id, reason, description, status,
    priority, reviewed_by, reviewed_at, resolution_notes, created_at,
    updated_at, resolved_at, ai_metadata, request_fingerprint,
    request_sequence, replay_expires_at, reporter_reference
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
-- entries removed. `reporter_references` is deliberately absent: the catalog
-- enumerates client-reachable grants, and no client role may touch that table.
-- No catalog deparsing is used to build this definition.
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
-- Combined quota decision
--
-- One decision over an arbitrary set of buckets. Every bucket is locked in a
-- deterministic order so concurrent callers queue instead of deadlocking, all
-- of them are evaluated before any of them is charged, and the charge is
-- skipped entirely when any bucket is already exhausted. That last property is
-- the point: a caller whose IP bucket is full must not thereby burn a slot in
-- their own user bucket.
--
-- The caller supplies the clock so a single transaction evaluates every one of
-- its decisions against one instant.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.consume_rate_limit_buckets(
  p_rate_limit_keys text[],
  p_rate_limit_limits integer[],
  p_rate_limit_window_seconds integer,
  p_now timestamptz
)
RETURNS TABLE (
  allowed boolean,
  reset_at timestamptz
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bucket_count integer;
  v_denied_count integer;
  v_denied_reset timestamptz;
BEGIN
  v_bucket_count := pg_catalog.array_length(p_rate_limit_keys, 1);
  IF v_bucket_count IS NULL
    OR v_bucket_count < 1
    OR v_bucket_count > 4
    OR pg_catalog.array_length(p_rate_limit_limits, 1) IS DISTINCT FROM v_bucket_count THEN
    RAISE EXCEPTION 'invalid quota bucket set';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_rate_limit_keys) AS bucket_key
    WHERE bucket_key IS NULL
      OR pg_catalog.length(bucket_key) = 0
      OR pg_catalog.length(bucket_key) > 200
  ) THEN
    RAISE EXCEPTION 'invalid quota key';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_rate_limit_limits) AS bucket_limit
    WHERE bucket_limit IS NULL OR bucket_limit < 1 OR bucket_limit > 10000
  ) THEN
    RAISE EXCEPTION 'invalid quota limit';
  END IF;
  IF p_rate_limit_window_seconds IS NULL
    OR p_rate_limit_window_seconds < 1
    OR p_rate_limit_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid quota window';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'quota decisions require a server clock reading';
  END IF;

  INSERT INTO public.api_rate_limits AS limits (
    rate_limit_key, window_started_at, request_count, updated_at
  )
  SELECT bucket_key, p_now, 0, p_now
  FROM pg_catalog.unnest(p_rate_limit_keys) AS bucket_key
  ON CONFLICT (rate_limit_key) DO NOTHING;

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
             + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= p_now
          THEN p_now
        ELSE limits.window_started_at
      END AS window_started_at,
      CASE
        WHEN limits.window_started_at
             + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= p_now
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
    RETURN QUERY SELECT false, v_denied_reset;
    RETURN;
  END IF;

  UPDATE public.api_rate_limits AS limits
  SET
    window_started_at = CASE
      WHEN limits.window_started_at
           + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= p_now
        THEN p_now
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at
           + pg_catalog.make_interval(secs => p_rate_limit_window_seconds) <= p_now
        THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = p_now
  WHERE limits.rate_limit_key = ANY (p_rate_limit_keys);

  RETURN QUERY SELECT true, NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION app_private.consume_rate_limit_buckets(
  text[], integer[], integer, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.consume_rate_limit_buckets(
  text[], integer[], integer, timestamptz
) TO postgres;

-- ---------------------------------------------------------------------------
-- Attempt metering
--
-- Charged by the service before it resolves anything about the target, so the
-- paths that store nothing — a forged target, a malformed location, a replay,
-- an exhausted report quota — still cost the caller something. The ceiling the
-- service passes is much higher than the stored-report quota, so this bounds
-- abuse without standing between a person and a report they meant to file.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consume_content_report_attempt(
  p_rate_limit_keys text[],
  p_rate_limit_limits integer[],
  p_rate_limit_window_seconds integer
)
RETURNS TABLE (
  allowed boolean,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  RETURN QUERY
  SELECT decision.allowed, decision.reset_at
  FROM app_private.consume_rate_limit_buckets(
    p_rate_limit_keys,
    p_rate_limit_limits,
    p_rate_limit_window_seconds,
    v_now
  ) AS decision;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_content_report_attempt(
  text[], integer[], integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_content_report_attempt(
  text[], integer[], integer
) TO service_role;

-- ---------------------------------------------------------------------------
-- The one reviewed submission transaction
--
-- Order matters and is deliberate. Idempotency is resolved first, so a retry
-- never charges quota again. Target existence is confirmed next, so a forged
-- identifier cannot become durable evidence and cannot spend the reporter's
-- report quota either. Only a submission that is going to be stored reaches
-- the combined user/IP decision, which is evaluated over locked rows and
-- committed only when every bucket passes. Moderation state (status,
-- priority, timestamps, reporter reference, replay deadline) is derived here,
-- never accepted from the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_content_report(
  p_request_fingerprint text,
  p_reporter_id uuid,
  p_content_type text,
  p_content_id uuid,
  p_reason text,
  p_description text,
  p_replay_window_seconds integer,
  p_rate_limit_keys text[],
  p_rate_limit_limits integer[],
  p_rate_limit_window_seconds integer
)
RETURNS TABLE (
  outcome text,
  report_id uuid,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_existing_id uuid;
  v_target_exists boolean;
  v_allowed boolean;
  v_reset_at timestamptz;
  v_reference uuid;
  v_sequence integer;
  v_report_id uuid;
  v_priority text;
BEGIN
  IF p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid content report request fingerprint';
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
  IF p_replay_window_seconds IS NULL
    OR p_replay_window_seconds < 1
    OR p_replay_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid content report replay window';
  END IF;

  v_priority := CASE
    WHEN p_reason IN ('violence', 'hate_speech') THEN 'high'
    ELSE 'normal'
  END;

  -- Serialize identical requests so a concurrent retry replays instead of
  -- charging quota and racing the occurrence index.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public.submit_content_report:' || p_request_fingerprint, 0
    )
  );

  -- Replay only inside the window this deployment configured. Past the
  -- deadline the same report is a new report again, which is what lets someone
  -- re-file something that was reviewed and dismissed.
  SELECT existing.id
  INTO v_existing_id
  FROM public.content_reports AS existing
  WHERE existing.request_fingerprint = p_request_fingerprint
    AND existing.replay_expires_at > v_now
  ORDER BY existing.request_sequence DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, title, body, type, read, data, action_url, displayed, severity,
      dedupe_key
    )
    SELECT
      user_record.id,
      CASE
        WHEN v_priority = 'high' THEN 'High-priority user report'
        ELSE 'New user report'
      END,
      p_reason || ' (' || p_content_type
        || ') report submitted. Please review in the admin dashboard.',
      'general',
      false,
      pg_catalog.jsonb_build_object(
        'batchKey', 'content_report:' || v_priority,
        'count', 1,
        'latest', p_reason || ' (' || p_content_type || ')',
        'lastEvent', pg_catalog.jsonb_build_object(
          'type', 'content_report',
          'reportId', v_existing_id,
          'reason', p_reason,
          'contentType', p_content_type,
          'priority', v_priority,
          'occurredAt', v_now
        )
      ),
      '/admin?tab=reports',
      false,
      CASE WHEN v_priority = 'high' THEN 'warning' ELSE 'info' END,
      'content-report:' || v_existing_id::text
    FROM auth.users AS user_record
    WHERE user_record.raw_app_meta_data @> '{"is_super_admin":true}'::jsonb
      OR pg_catalog.lower(
           pg_catalog.btrim(user_record.raw_app_meta_data ->> 'role')
         ) = 'super_admin'
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT 'replayed'::text, v_existing_id, NULL::timestamptz;
    RETURN;
  END IF;

  -- Existence only. Whether this reporter was allowed to see the target is
  -- decided in the caller's RLS-scoped session, which is the only place that
  -- knows who is asking; repeating it here would need this definer function to
  -- reimplement every visibility rule. What this check adds is that an
  -- arbitrary UUID cannot become a moderation queue item.
  IF p_content_type = 'project' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.projects AS target WHERE target.id = p_content_id
    ) INTO v_target_exists;
  ELSIF p_content_type = 'profile' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles AS target WHERE target.id = p_content_id
    ) INTO v_target_exists;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.organizations AS target WHERE target.id = p_content_id
    ) INTO v_target_exists;
  END IF;

  -- Generic on purpose: the caller learns the submission was rejected and
  -- nothing about which relation was consulted or what it holds.
  IF NOT v_target_exists THEN
    RETURN QUERY SELECT 'invalid_target'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT decision.allowed, decision.reset_at
  INTO v_allowed, v_reset_at
  FROM app_private.consume_rate_limit_buckets(
    p_rate_limit_keys,
    p_rate_limit_limits,
    p_rate_limit_window_seconds,
    v_now
  ) AS decision;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid, v_reset_at;
    RETURN;
  END IF;

  SELECT mapping.reference
  INTO v_reference
  FROM public.reporter_references AS mapping
  WHERE mapping.reporter_id = p_reporter_id;

  IF v_reference IS NULL THEN
    INSERT INTO public.reporter_references AS mapping (reporter_id)
    VALUES (p_reporter_id)
    ON CONFLICT (reporter_id) DO UPDATE
      SET reporter_id = EXCLUDED.reporter_id
    RETURNING mapping.reference INTO v_reference;
  END IF;

  SELECT COALESCE(pg_catalog.max(existing.request_sequence), 0) + 1
  INTO v_sequence
  FROM public.content_reports AS existing
  WHERE existing.request_fingerprint = p_request_fingerprint;

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
    request_fingerprint,
    request_sequence,
    replay_expires_at
  )
  VALUES (
    p_reporter_id,
    v_reference,
    p_content_type,
    p_content_id,
    p_reason,
    p_description,
    'pending',
    v_priority,
    v_now,
    v_now,
    p_request_fingerprint,
    v_sequence,
    v_now + pg_catalog.make_interval(secs => p_replay_window_seconds)
  )
  RETURNING id INTO v_report_id;

  INSERT INTO public.notifications (
    user_id, title, body, type, read, data, action_url, displayed, severity,
    dedupe_key
  )
  SELECT
    user_record.id,
    CASE
      WHEN v_priority = 'high' THEN 'High-priority user report'
      ELSE 'New user report'
    END,
    p_reason || ' (' || p_content_type
      || ') report submitted. Please review in the admin dashboard.',
    'general',
    false,
    pg_catalog.jsonb_build_object(
      'batchKey', 'content_report:' || v_priority,
      'count', 1,
      'latest', p_reason || ' (' || p_content_type || ')',
      'lastEvent', pg_catalog.jsonb_build_object(
        'type', 'content_report',
        'reportId', v_report_id,
        'reason', p_reason,
        'contentType', p_content_type,
        'priority', v_priority,
        'occurredAt', v_now
      )
    ),
    '/admin?tab=reports',
    false,
    CASE WHEN v_priority = 'high' THEN 'warning' ELSE 'info' END,
    'content-report:' || v_report_id::text
  FROM auth.users AS user_record
  WHERE user_record.raw_app_meta_data @> '{"is_super_admin":true}'::jsonb
    OR pg_catalog.lower(
         pg_catalog.btrim(user_record.raw_app_meta_data ->> 'role')
       ) = 'super_admin'
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT 'created'::text, v_report_id, NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_content_report(
  text, uuid, text, uuid, text, text, integer, text[], integer[], integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_content_report(
  text, uuid, text, uuid, text, text, integer, text[], integer[], integer
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

  IF EXISTS (
    SELECT 1
    FROM app_private.client_relation_grant_catalog()
    WHERE relation_name = 'reporter_references'
  ) THEN
    RAISE EXCEPTION 'reporter_references must not be client reachable';
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

    IF pg_catalog.has_table_privilege(client_role, 'public.reporter_references', 'SELECT')
      OR pg_catalog.has_table_privilege(client_role, 'public.reporter_references', 'INSERT')
      OR pg_catalog.has_table_privilege(client_role, 'public.reporter_references', 'UPDATE')
      OR pg_catalog.has_table_privilege(client_role, 'public.reporter_references', 'DELETE')
    THEN
      RAISE EXCEPTION '% retains a reporter_references privilege', client_role;
    END IF;

    IF pg_catalog.has_function_privilege(
         client_role,
         'public.submit_content_report(text, uuid, text, uuid, text, text, integer, text[], integer[], integer)',
         'EXECUTE'
       )
      OR pg_catalog.has_function_privilege(
           client_role,
           'public.consume_content_report_attempt(text[], integer[], integer)',
           'EXECUTE'
         )
      OR pg_catalog.has_function_privilege(
           client_role,
           'public.detach_content_report_reporter(uuid)',
           'EXECUTE'
         )
    THEN
      RAISE EXCEPTION '% retains a content report function privilege', client_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.content_reports'::pg_catalog.regclass
      AND polcmd IN ('a', 'w', 'd')
  ) THEN
    RAISE EXCEPTION 'content_reports retains a client write policy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.reporter_references'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'reporter_references must have no RLS policy';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.submit_content_report(text, uuid, text, uuid, text, text, integer, text[], integer[], integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute the content report transaction';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.consume_content_report_attempt(text[], integer[], integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute the content report attempt meter';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.detach_content_report_reporter(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot detach a content report reporter';
  END IF;
END;
$$;

COMMIT;
