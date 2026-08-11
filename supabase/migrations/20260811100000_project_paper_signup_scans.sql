-- Paper signup sheet scanning: staging tables for AI-extracted rows from
-- photographed paper sheets, a service-only commit RPC that retroactively
-- records attendance on completed projects, a private storage bucket for the
-- source photos, and a transactional outbox for their deletion. Human review
-- is mandatory; nothing in this migration lets AI output write directly.

-- ---------------------------------------------------------------------------
-- 1. Provenance on project_signups
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_signups
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'digital';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_signups_source_check'
      AND conrelid = 'public.project_signups'::regclass
  ) THEN
    ALTER TABLE public.project_signups
      ADD CONSTRAINT project_signups_source_check
      CHECK (source IN ('digital', 'paper_scan', 'organizer_manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.project_signups.source IS
  'Provenance. digital = self-service signup; paper_scan = organizer-confirmed paper sheet row; organizer_manual reserved for a future walk-in flow.';

CREATE INDEX IF NOT EXISTS project_signups_project_source_idx
  ON public.project_signups (project_id, source)
  WHERE source <> 'digital';

-- ---------------------------------------------------------------------------
-- 1b. Management predicate: the SQL mirror of canManageProjectAccess
--     (lib/projects/management-access.ts). Unlike is_project_organizer, staff
--     only qualify when the project opted into staff management. Lives in
--     app_private so it is never PostgREST-callable; EXECUTE for
--     authenticated exists purely so RLS policies can evaluate it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.can_manage_project(
  p_project_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.projects AS projects
      WHERE projects.id = p_project_id
        AND (
          projects.creator_id = p_user
          OR EXISTS (
            SELECT 1
            FROM public.organization_members AS members
            WHERE members.organization_id = projects.organization_id
              AND members.user_id = p_user
              AND (
                members.role = 'admin'
                OR (members.role = 'staff' AND projects.can_be_managed_by_staff IS TRUE)
              )
          )
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION app_private.can_manage_project(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_manage_project(uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Scan batch
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_paper_scan_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  schedule_id text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'extracting', 'review', 'committing', 'committed', 'failed', 'discarded')),
  image_count integer NOT NULL DEFAULT 0 CHECK (image_count BETWEEN 0 AND 10),
  extracted_row_count integer NOT NULL DEFAULT 0 CHECK (extracted_row_count >= 0),
  committed_row_count integer NOT NULL DEFAULT 0 CHECK (committed_row_count >= 0),
  roster_row_count integer NOT NULL DEFAULT 0 CHECK (roster_row_count >= 0),
  models_used text[] NOT NULL DEFAULT ARRAY[]::text[],
  extraction_error text,
  commit_idempotency_key uuid,
  extracted_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_paper_scan_batches_schedule_not_blank
    CHECK (length(btrim(schedule_id)) > 0)
);

COMMENT ON TABLE public.project_paper_scan_batches IS
  'One organizer scan session for one project slot. schedule_id lives on the batch: one paper sheet is attributed to one slot.';

CREATE INDEX project_paper_scan_batches_project_idx
  ON public.project_paper_scan_batches (project_id, created_at DESC);
CREATE INDEX project_paper_scan_batches_created_by_idx
  ON public.project_paper_scan_batches (created_by, created_at DESC);
CREATE INDEX project_paper_scan_batches_retention_idx
  ON public.project_paper_scan_batches (status, created_at);

CREATE TRIGGER project_paper_scan_batches_updated_at
  BEFORE UPDATE ON public.project_paper_scan_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Scan images
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_paper_scan_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.project_paper_scan_batches(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'paper-signup-scans',
  object_path text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  content_type text NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_paper_scan_images_batch_sequence_key UNIQUE (batch_id, sequence),
  CONSTRAINT project_paper_scan_images_object_key UNIQUE (bucket_id, object_path),
  CONSTRAINT project_paper_scan_images_path_not_blank
    CHECK (length(btrim(object_path)) > 0)
);

CREATE INDEX project_paper_scan_images_batch_idx
  ON public.project_paper_scan_images (batch_id, sequence);

-- ---------------------------------------------------------------------------
-- 4. Extracted rows (staging)
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_paper_scan_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.project_paper_scan_batches(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  image_id uuid REFERENCES public.project_paper_scan_images(id) ON DELETE SET NULL,
  sheet_row_number integer NOT NULL CHECK (sheet_row_number > 0),

  -- AI output, immutable evidence. Reviewer edits go to the columns below.
  raw_extraction jsonb NOT NULL,
  overall_confidence numeric(4,3) NOT NULL DEFAULT 0
    CHECK (overall_confidence BETWEEN 0 AND 1),
  model_id text,

  -- Reviewer-editable working copy, seeded from raw_extraction.
  name text,
  email text,
  phone text,
  check_in_time timestamptz,
  check_out_time timestamptz,
  signature_present boolean NOT NULL DEFAULT false,

  -- Match proposal from the fuzzy matcher; a pre-selection, never a commit.
  match_kind text NOT NULL DEFAULT 'none'
    CHECK (match_kind IN ('none', 'existing_signup', 'existing_profile', 'existing_anonymous')),
  match_signup_id uuid,
  match_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  match_anonymous_id uuid REFERENCES public.anonymous_signups(id) ON DELETE SET NULL,
  match_score numeric(4,3) CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1),
  match_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Review decision and commit outcome.
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'include', 'exclude')),
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'signup_created', 'signup_updated', 'roster_only', 'skipped', 'failed')),
  outcome_detail text,
  over_capacity boolean NOT NULL DEFAULT false,
  committed_signup_id uuid,
  committed_anonymous_id uuid REFERENCES public.anonymous_signups(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_paper_scan_rows_batch_row_key UNIQUE (batch_id, sheet_row_number),
  -- Composite FKs keep a row's signup inside the row's own project. Backed by
  -- the unique index project_signups_id_project_id_key from 20260712011155.
  CONSTRAINT project_paper_scan_rows_match_signup_fkey
    FOREIGN KEY (match_signup_id, project_id)
    REFERENCES public.project_signups (id, project_id) ON DELETE SET NULL,
  CONSTRAINT project_paper_scan_rows_committed_signup_fkey
    FOREIGN KEY (committed_signup_id, project_id)
    REFERENCES public.project_signups (id, project_id) ON DELETE SET NULL,
  CONSTRAINT project_paper_scan_rows_window_ordered
    CHECK (check_in_time IS NULL OR check_out_time IS NULL
           OR check_out_time > check_in_time)
);

CREATE INDEX project_paper_scan_rows_batch_idx
  ON public.project_paper_scan_rows (batch_id, sheet_row_number);
CREATE INDEX project_paper_scan_rows_project_email_idx
  ON public.project_paper_scan_rows (project_id, lower(email))
  WHERE email IS NOT NULL;
-- Idempotency backstop: a retried commit cannot leave two staging rows
-- pointing at one signup.
CREATE UNIQUE INDEX project_paper_scan_rows_committed_signup_key
  ON public.project_paper_scan_rows (committed_signup_id)
  WHERE committed_signup_id IS NOT NULL;

CREATE TRIGGER project_paper_scan_rows_updated_at
  BEFORE UPDATE ON public.project_paper_scan_rows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 5. Roster-only entries (rows without an email)
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_paper_roster_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.project_paper_scan_batches(id) ON DELETE SET NULL,
  scan_row_id uuid REFERENCES public.project_paper_scan_rows(id) ON DELETE SET NULL,
  schedule_id text NOT NULL CHECK (length(btrim(schedule_id)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  phone text,
  check_in_time timestamptz,
  check_out_time timestamptz,
  signature_present boolean NOT NULL DEFAULT false,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_paper_roster_entries_window_ordered
    CHECK (check_in_time IS NULL OR check_out_time IS NULL
           OR check_out_time > check_in_time)
);

COMMENT ON TABLE public.project_paper_roster_entries IS
  'Paper-sheet rows with no legible email. Headcount and export only: no signup, no hours, no certificate.';

CREATE UNIQUE INDEX project_paper_roster_entries_scan_row_key
  ON public.project_paper_roster_entries (scan_row_id)
  WHERE scan_row_id IS NOT NULL;
CREATE INDEX project_paper_roster_entries_project_idx
  ON public.project_paper_roster_entries (project_id, schedule_id);

-- ---------------------------------------------------------------------------
-- 6. Storage deletion outbox (mirrors waiver_storage_deletion_queue)
-- ---------------------------------------------------------------------------

CREATE TABLE public.paper_scan_storage_deletion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL DEFAULT 'paper-signup-scans',
  object_path text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  CONSTRAINT paper_scan_storage_deletion_queue_bucket_path_key
    UNIQUE (bucket_id, object_path),
  CONSTRAINT paper_scan_storage_deletion_queue_path_not_blank
    CHECK (length(btrim(object_path)) > 0)
);

ALTER TABLE public.paper_scan_storage_deletion_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paper_scan_storage_deletion_queue
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.paper_scan_storage_deletion_queue TO service_role;

COMMENT ON TABLE public.paper_scan_storage_deletion_queue IS
  'Service-only transactional outbox for idempotent deletion of private paper-scan photos.';

-- ---------------------------------------------------------------------------
-- 7. RLS and grants: organizers read, service role writes
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_paper_scan_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_paper_scan_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_paper_scan_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_paper_roster_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_paper_scan_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_paper_scan_images FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_paper_scan_rows FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_paper_roster_entries FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.project_paper_scan_batches TO authenticated;
GRANT SELECT ON TABLE public.project_paper_scan_images TO authenticated;
GRANT SELECT ON TABLE public.project_paper_scan_rows TO authenticated;
GRANT SELECT ON TABLE public.project_paper_roster_entries TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_paper_scan_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_paper_scan_images TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_paper_scan_rows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_paper_roster_entries TO service_role;

CREATE POLICY paper_scan_batches_select_organizer
  ON public.project_paper_scan_batches FOR SELECT TO authenticated
  USING (
    app_private.can_manage_project(project_id, (SELECT auth.uid()))
    OR public.is_super_admin()
  );

CREATE POLICY paper_scan_images_select_organizer
  ON public.project_paper_scan_images FOR SELECT TO authenticated
  USING (
    app_private.can_manage_project(project_id, (SELECT auth.uid()))
    OR public.is_super_admin()
  );

CREATE POLICY paper_scan_rows_select_organizer
  ON public.project_paper_scan_rows FOR SELECT TO authenticated
  USING (
    app_private.can_manage_project(project_id, (SELECT auth.uid()))
    OR public.is_super_admin()
  );

CREATE POLICY paper_roster_entries_select_organizer
  ON public.project_paper_roster_entries FOR SELECT TO authenticated
  USING (
    app_private.can_manage_project(project_id, (SELECT auth.uid()))
    OR public.is_super_admin()
  );

-- ---------------------------------------------------------------------------
-- 8. Private storage bucket + policies
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'paper-signup-scans',
  'paper-signup-scans',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Project managers can upload paper signup scans" ON storage.objects;
    CREATE POLICY "Project managers can upload paper signup scans"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'paper-signup-scans'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
            AND app_private.can_manage_project(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can read paper signup scans" ON storage.objects;
    CREATE POLICY "Project managers can read paper signup scans"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'paper-signup-scans'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
            AND app_private.can_manage_project(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can delete paper signup scans" ON storage.objects;
    CREATE POLICY "Project managers can delete paper signup scans"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'paper-signup-scans'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
            AND app_private.can_manage_project(p.id, (SELECT auth.uid()))
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Commit RPC: staging rows -> attended project_signups, atomically
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commit_paper_signup_batch(
  p_batch_id uuid,
  p_actor_id uuid,
  p_row_ids uuid[],
  p_allow_over_capacity boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS TABLE (
  row_id uuid,
  outcome text,
  signup_id uuid,
  anonymous_id uuid,
  user_id uuid,
  over_capacity boolean,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch record;
  v_slot record;
  v_row record;
  v_email text;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_existing_signup record;
  v_profile_id uuid;
  v_anon_id uuid;
  v_new_signup_id uuid;
  v_active_count bigint;
  v_over boolean;
  v_committed integer := 0;
  v_roster integer := 0;
BEGIN
  IF p_batch_id IS NULL OR p_actor_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: invalid input';
  END IF;

  SELECT batches.*
  INTO v_batch
  FROM public.project_paper_scan_batches AS batches
  WHERE batches.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: batch not found';
  END IF;

  -- Defence in depth: the caller (service role) has already authorized, but a
  -- bug there must not let a non-organizer commit. app_private variant because
  -- p_actor_id is not auth.uid() under the service role.
  IF NOT app_private.can_manage_project(v_batch.project_id, p_actor_id) THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: actor is not a project organizer';
  END IF;

  -- Idempotent replay: the same key on a committed batch returns the stored
  -- per-row outcomes without touching signups again.
  IF v_batch.status = 'committed' THEN
    IF v_batch.commit_idempotency_key = p_idempotency_key THEN
      RETURN QUERY
      SELECT scan_rows.id, scan_rows.outcome, scan_rows.committed_signup_id,
             scan_rows.committed_anonymous_id, signups.user_id,
             scan_rows.over_capacity, scan_rows.outcome_detail
      FROM public.project_paper_scan_rows AS scan_rows
      LEFT JOIN public.project_signups AS signups
        ON signups.id = scan_rows.committed_signup_id
      WHERE scan_rows.batch_id = p_batch_id
        AND scan_rows.id = ANY (p_row_ids)
      ORDER BY scan_rows.sheet_row_number;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT scan_rows.id, 'skipped'::text, scan_rows.committed_signup_id,
           scan_rows.committed_anonymous_id, NULL::uuid,
           scan_rows.over_capacity, 'already_committed'::text
    FROM public.project_paper_scan_rows AS scan_rows
    WHERE scan_rows.batch_id = p_batch_id
      AND scan_rows.id = ANY (p_row_ids)
    ORDER BY scan_rows.sheet_row_number;
    RETURN;
  END IF;

  IF v_batch.status NOT IN ('review', 'committing') THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: batch is not reviewable (status %)', v_batch.status;
  END IF;

  SELECT slot.capacity, slot.starts_at, slot.ends_at
  INTO v_slot
  FROM private.resolve_project_schedule_slot(v_batch.project_id, v_batch.schedule_id) AS slot;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: invalid_schedule';
  END IF;

  -- Same lock key as insert_project_signup_with_capacity so paper commits
  -- serialize against concurrent digital signups instead of racing them.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lets-assist-project-signup:' || v_batch.project_id::text || ':' || v_batch.schedule_id,
      0
    )
  );

  UPDATE public.project_paper_scan_batches
  SET status = 'committing', commit_idempotency_key = p_idempotency_key
  WHERE id = p_batch_id;

  FOR v_row IN
    SELECT scan_rows.*
    FROM public.project_paper_scan_rows AS scan_rows
    WHERE scan_rows.batch_id = p_batch_id
      AND scan_rows.id = ANY (p_row_ids)
      AND scan_rows.decision = 'include'
    ORDER BY scan_rows.sheet_row_number
    FOR UPDATE
  LOOP
    row_id := v_row.id;
    signup_id := NULL;
    anonymous_id := NULL;
    user_id := NULL;
    over_capacity := false;
    detail := NULL;

    -- Retried commit after a partial failure: keep the earlier result.
    IF v_row.committed_signup_id IS NOT NULL THEN
      outcome := 'skipped';
      signup_id := v_row.committed_signup_id;
      anonymous_id := v_row.committed_anonymous_id;
      detail := 'already_committed';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Clamp recorded times to the scheduled window. Mirrors
    -- complete_participant_checkout: transcription errors must not mint hours
    -- outside the event.
    v_check_in := GREATEST(COALESCE(v_row.check_in_time, v_slot.starts_at), v_slot.starts_at);
    v_check_out := LEAST(COALESCE(v_row.check_out_time, v_slot.ends_at), v_slot.ends_at);

    IF v_check_out <= v_check_in THEN
      outcome := 'failed';
      detail := 'invalid_time_window';
      UPDATE public.project_paper_scan_rows
      SET outcome = 'failed', outcome_detail = 'invalid_time_window'
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_email := NULLIF(lower(btrim(v_row.email)), '');

    -- No email: roster-only. Headcount record, no signup, no certificate.
    IF v_email IS NULL THEN
      IF NULLIF(btrim(COALESCE(v_row.name, '')), '') IS NULL THEN
        outcome := 'failed';
        detail := 'missing_name';
        UPDATE public.project_paper_scan_rows
        SET outcome = 'failed', outcome_detail = 'missing_name'
        WHERE id = v_row.id;
        RETURN NEXT;
        CONTINUE;
      END IF;

      INSERT INTO public.project_paper_roster_entries (
        project_id, batch_id, scan_row_id, schedule_id, name, phone,
        check_in_time, check_out_time, signature_present, recorded_by
      )
      VALUES (
        v_batch.project_id, p_batch_id, v_row.id, v_batch.schedule_id,
        btrim(v_row.name), v_row.phone, v_check_in, v_check_out,
        v_row.signature_present, p_actor_id
      )
      ON CONFLICT (scan_row_id) WHERE scan_row_id IS NOT NULL DO NOTHING;

      outcome := 'roster_only';
      v_roster := v_roster + 1;
      UPDATE public.project_paper_scan_rows
      SET outcome = 'roster_only', outcome_detail = NULL
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 1) An existing signup for this slot whose identity resolves to this
    --    email (or the reviewer explicitly matched one): mark it attended.
    SELECT signups.id, signups.user_id, signups.anonymous_id, signups.source
    INTO v_existing_signup
    FROM public.project_signups AS signups
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups AS anon ON anon.id = signups.anonymous_id
    WHERE signups.project_id = v_batch.project_id
      AND signups.schedule_id = v_batch.schedule_id
      AND signups.status <> 'rejected'
      AND (
        signups.id = v_row.match_signup_id
        OR lower(COALESCE(profiles.email, '')) = v_email
        OR lower(COALESCE(anon.email, '')) = v_email
      )
    ORDER BY (signups.id = v_row.match_signup_id) DESC, signups.created_at
    LIMIT 1;

    IF FOUND THEN
      -- Same person twice on one sheet (or across two sheets in the batch):
      -- an earlier row already claimed this signup. Keep the first result and
      -- surface the duplicate instead of tripping the unique backstop index.
      IF EXISTS (
        SELECT 1
        FROM public.project_paper_scan_rows AS scan_rows
        WHERE scan_rows.committed_signup_id = v_existing_signup.id
      ) THEN
        outcome := 'skipped';
        signup_id := v_existing_signup.id;
        detail := 'duplicate_in_batch';
        UPDATE public.project_paper_scan_rows
        SET outcome = 'skipped', outcome_detail = 'duplicate_in_batch'
        WHERE id = v_row.id;
        RETURN NEXT;
        CONTINUE;
      END IF;

      UPDATE public.project_signups AS signups
      SET status = 'attended',
          check_in_time = COALESCE(signups.check_in_time, v_check_in),
          check_out_time = COALESCE(signups.check_out_time, v_check_out)
      WHERE signups.id = v_existing_signup.id;

      outcome := 'signup_updated';
      signup_id := v_existing_signup.id;
      anonymous_id := v_existing_signup.anonymous_id;
      user_id := v_existing_signup.user_id;
      v_committed := v_committed + 1;
      UPDATE public.project_paper_scan_rows
      SET outcome = 'signup_updated', outcome_detail = NULL,
          committed_signup_id = v_existing_signup.id,
          committed_anonymous_id = v_existing_signup.anonymous_id
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Capacity check before creating anything new. The event already
    -- happened, so exceeding is allowed only with explicit organizer opt-in.
    SELECT COUNT(*)
    INTO v_active_count
    FROM public.project_signups AS signups
    WHERE signups.project_id = v_batch.project_id
      AND signups.schedule_id = v_batch.schedule_id
      AND signups.status IN ('approved', 'attended');

    v_over := v_active_count >= v_slot.capacity;
    IF v_over AND NOT p_allow_over_capacity THEN
      outcome := 'failed';
      detail := 'slot_full';
      UPDATE public.project_paper_scan_rows
      SET outcome = 'failed', outcome_detail = 'slot_full'
      WHERE id = v_row.id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 2) A platform account with this email (primary or verified alias).
    SELECT profiles.id
    INTO v_profile_id
    FROM public.profiles AS profiles
    WHERE lower(COALESCE(profiles.email, '')) = v_email
    UNION
    SELECT emails.user_id
    FROM public.user_emails AS emails
    WHERE lower(emails.email) = v_email
      AND emails.verified_at IS NOT NULL
    LIMIT 1;

    IF v_profile_id IS NOT NULL THEN
      -- The unique partial index on (user_id, project_id, schedule_id) does
      -- not apply here since we already know no signup exists for this slot.
      INSERT INTO public.project_signups (
        project_id, user_id, schedule_id, status,
        check_in_time, check_out_time, source
      )
      VALUES (
        v_batch.project_id, v_profile_id, v_batch.schedule_id, 'attended',
        v_check_in, v_check_out, 'paper_scan'
      )
      RETURNING id INTO v_new_signup_id;

      outcome := 'signup_created';
      signup_id := v_new_signup_id;
      user_id := v_profile_id;
      over_capacity := v_over;
      v_committed := v_committed + 1;
      UPDATE public.project_paper_scan_rows
      SET outcome = 'signup_created', outcome_detail = NULL,
          over_capacity = v_over,
          committed_signup_id = v_new_signup_id
      WHERE id = v_row.id;
      v_profile_id := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 3) No account: reuse or create the anonymous identity for this email.
    --    confirmed_at is set because the organizer's review is the
    --    confirmation; no double-opt-in email round trip applies here.
    INSERT INTO public.anonymous_signups AS anon (project_id, email, name, phone_number, confirmed_at)
    VALUES (v_batch.project_id, v_email, NULLIF(btrim(COALESCE(v_row.name, '')), ''), v_row.phone, now())
    ON CONFLICT ((lower(email)), project_id) DO UPDATE
      SET name = COALESCE(anon.name, EXCLUDED.name),
          confirmed_at = COALESCE(anon.confirmed_at, EXCLUDED.confirmed_at)
    RETURNING anon.id INTO v_anon_id;

    INSERT INTO public.project_signups (
      project_id, anonymous_id, schedule_id, status,
      check_in_time, check_out_time, source
    )
    VALUES (
      v_batch.project_id, v_anon_id, v_batch.schedule_id, 'attended',
      v_check_in, v_check_out, 'paper_scan'
    )
    RETURNING id INTO v_new_signup_id;

    outcome := 'signup_created';
    signup_id := v_new_signup_id;
    anonymous_id := v_anon_id;
    over_capacity := v_over;
    v_committed := v_committed + 1;
    UPDATE public.project_paper_scan_rows
    SET outcome = 'signup_created', outcome_detail = NULL,
        over_capacity = v_over,
        committed_signup_id = v_new_signup_id,
        committed_anonymous_id = v_anon_id
    WHERE id = v_row.id;
    RETURN NEXT;
  END LOOP;

  UPDATE public.project_paper_scan_batches
  SET status = 'committed',
      committed_at = now(),
      committed_row_count = v_committed,
      roster_row_count = v_roster
  WHERE id = p_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_paper_signup_batch(uuid, uuid, uuid[], boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_paper_signup_batch(uuid, uuid, uuid[], boolean, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Retention: purge scan photos and staging rows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_expired_paper_scan_batches(
  p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch_ids uuid[];
  v_purged integer := 0;
BEGIN
  SELECT COALESCE(array_agg(candidates.id), ARRAY[]::uuid[])
  INTO v_batch_ids
  FROM (
    SELECT batches.id
    FROM public.project_paper_scan_batches AS batches
    WHERE (
        batches.status = 'committed'
        AND batches.committed_at < now() - interval '7 days'
      )
      OR (
        batches.status IN ('draft', 'review', 'failed', 'discarded', 'extracting', 'committing')
        AND batches.created_at < now() - interval '30 days'
      )
      OR (
        batches.status = 'discarded'
        AND batches.updated_at < now() - interval '1 day'
      )
    ORDER BY batches.created_at
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  ) AS candidates;

  IF array_length(v_batch_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Outbox insert and database deletion share this transaction; Storage
  -- objects are removed by the cleanup worker only after commit.
  INSERT INTO public.paper_scan_storage_deletion_queue (bucket_id, object_path)
  SELECT images.bucket_id, images.object_path
  FROM public.project_paper_scan_images AS images
  WHERE images.batch_id = ANY (v_batch_ids)
    AND images.purged_at IS NULL
  ON CONFLICT (bucket_id, object_path) DO NOTHING;

  UPDATE public.project_paper_scan_images
  SET purged_at = now()
  WHERE batch_id = ANY (v_batch_ids)
    AND purged_at IS NULL;

  -- Roster entries survive (batch_id -> NULL via FK); committed signups are
  -- untouched. Only staging evidence is destroyed.
  DELETE FROM public.project_paper_scan_rows WHERE batch_id = ANY (v_batch_ids);
  DELETE FROM public.project_paper_scan_images WHERE batch_id = ANY (v_batch_ids);
  DELETE FROM public.project_paper_scan_batches WHERE id = ANY (v_batch_ids);

  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN v_purged;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_paper_scan_batches(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_paper_scan_batches(integer)
  TO service_role;
