-- Turn the existing scheduled-post storage shape into an operable, fail-closed
-- publication lifecycle. The worker is service-only and never queues email.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schedule provenance and durable operator holds
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_announcements
  -- Intentionally not an auth.users FK. This is immutable scheduling
  -- provenance: deleting the user must not let ON DELETE SET NULL fight the
  -- lifecycle guard or block account deletion. The worker rechecks the UUID
  -- against current authority and records schedule_actor_unavailable.
  ADD COLUMN scheduled_by uuid,
  ADD COLUMN schedule_revision uuid,
  ADD COLUMN scheduled_publish_hold_reason text,
  ADD COLUMN scheduled_publish_held_at timestamptz,
  ADD COLUMN scheduled_publish_last_checked_at timestamptz;

ALTER TABLE plugin_data.csf_announcements
  ADD CONSTRAINT csf_announcements_schedule_hold_reason_check
  CHECK (
    scheduled_publish_hold_reason IS NULL
    OR scheduled_publish_hold_reason IN (
      'legacy_due_requires_review',
      'schedule_time_unavailable',
      'schedule_actor_unavailable',
      'plugin_unavailable',
      'term_unavailable',
      'cohort_unavailable',
      'post_expired',
      'scheduled_email_not_supported'
    )
  ) NOT VALID,
  ADD CONSTRAINT csf_announcements_schedule_hold_time_check
  CHECK (
    (scheduled_publish_hold_reason IS NULL) =
      (scheduled_publish_held_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT csf_announcements_schedule_provenance_check
  CHECK (
    status <> 'scheduled'
    OR (
      schedule_revision IS NOT NULL
      AND (
        scheduled_by IS NOT NULL
        OR scheduled_publish_hold_reason IS NOT NULL
      )
    )
  ) NOT VALID,
  ADD CONSTRAINT csf_announcements_published_lifecycle_check
  CHECK (
    status <> 'published'
    OR (published_at IS NOT NULL AND scheduled_for IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT csf_announcements_scheduled_lifecycle_check
  CHECK (
    status <> 'scheduled'
    OR (
      published_at IS NULL
      AND (
        scheduled_for IS NOT NULL
        OR scheduled_publish_hold_reason = 'schedule_time_unavailable'
      )
    )
  ) NOT VALID,
  ADD CONSTRAINT csf_announcements_archived_unpinned_check
  CHECK (status <> 'archived' OR pinned = false) NOT VALID;

COMMENT ON COLUMN plugin_data.csf_announcements.scheduled_by IS
  'The human manage_posts actor UUID who most recently chose this schedule. Intentionally unreferenced so account deletion cannot erase provenance or block deletion; the worker rechecks current authority and holds deleted actors.';
COMMENT ON COLUMN plugin_data.csf_announcements.schedule_revision IS
  'A new opaque identity for each distinct schedule time; it is the idempotency coordinate for one hold or one automatic-publication audit.';
COMMENT ON COLUMN plugin_data.csf_announcements.scheduled_publish_hold_reason IS
  'Fail-closed reason automatic publication stopped. An officer must edit the post and choose a new future time after correcting the condition.';
COMMENT ON COLUMN plugin_data.csf_announcements.scheduled_publish_held_at IS
  'When the current schedule revision first entered its durable operator hold.';
COMMENT ON COLUMN plugin_data.csf_announcements.scheduled_publish_last_checked_at IS
  'When the bounded publisher last evaluated this schedule revision.';

-- Non-scheduled legacy rows must not retain an actionable due time. Historical
-- publication time remains untouched; this only removes a schedule that cannot
-- be executed in the row's current lifecycle state.
UPDATE plugin_data.csf_announcements
SET scheduled_for = NULL,
    scheduled_by = NULL,
    schedule_revision = NULL,
    scheduled_publish_hold_reason = NULL,
    scheduled_publish_held_at = NULL,
    scheduled_publish_last_checked_at = NULL,
    pinned = CASE WHEN status = 'archived' THEN false ELSE pinned END
WHERE status <> 'scheduled';

-- Preserve a defensible publication instant for malformed historical live
-- rows before validating the lifecycle constraint. This is a reconciliation
-- of already-public state, not an automatic publication.
UPDATE plugin_data.csf_announcements
SET published_at = coalesce(published_at, updated_at, created_at)
WHERE status = 'published'
  AND published_at IS NULL;

-- Capture the best existing human provenance without inventing an account. A
-- deleted/unknown actor remains NULL and is held below.
UPDATE plugin_data.csf_announcements
SET scheduled_by = coalesce(updated_by, created_by),
    schedule_revision = gen_random_uuid(),
    published_at = NULL
WHERE status = 'scheduled';

UPDATE plugin_data.csf_announcements
SET scheduled_publish_hold_reason = 'schedule_time_unavailable',
    scheduled_publish_held_at = statement_timestamp(),
    scheduled_publish_last_checked_at = statement_timestamp()
WHERE status = 'scheduled'
  AND scheduled_for IS NULL;

UPDATE plugin_data.csf_announcements
SET scheduled_publish_hold_reason = 'schedule_actor_unavailable',
    scheduled_publish_held_at = statement_timestamp(),
    scheduled_publish_last_checked_at = statement_timestamp()
WHERE status = 'scheduled'
  AND scheduled_for IS NOT NULL
  AND scheduled_by IS NULL;

-- Deploying the worker must never turn historical overdue rows into surprise
-- publications. They enter a named review hold and require an explicit new
-- future time from an authorized officer.
UPDATE plugin_data.csf_announcements
SET scheduled_publish_hold_reason = 'legacy_due_requires_review',
    scheduled_publish_held_at = statement_timestamp(),
    scheduled_publish_last_checked_at = statement_timestamp()
WHERE status = 'scheduled'
  AND scheduled_by IS NOT NULL
  AND scheduled_for IS NOT NULL
  AND scheduled_for <= statement_timestamp()
  AND scheduled_publish_hold_reason IS NULL;

ALTER TABLE plugin_data.csf_announcements
  VALIDATE CONSTRAINT csf_announcements_schedule_hold_reason_check,
  VALIDATE CONSTRAINT csf_announcements_schedule_hold_time_check,
  VALIDATE CONSTRAINT csf_announcements_schedule_provenance_check,
  VALIDATE CONSTRAINT csf_announcements_published_lifecycle_check,
  VALIDATE CONSTRAINT csf_announcements_scheduled_lifecycle_check,
  VALIDATE CONSTRAINT csf_announcements_archived_unpinned_check;

CREATE INDEX csf_announcements_due_publish_idx
  ON plugin_data.csf_announcements (scheduled_for, id)
  WHERE status = 'scheduled'
    AND scheduled_publish_hold_reason IS NULL;

CREATE UNIQUE INDEX csf_admin_audit_events_scheduled_publish_idx
  ON plugin_data.csf_admin_audit_events (
    organization_id, correlation_id
  )
  WHERE source_type = 'scheduled_post_publisher'
    AND action = 'post_published_automatically';

CREATE UNIQUE INDEX csf_admin_audit_events_scheduled_hold_idx
  ON plugin_data.csf_admin_audit_events (
    organization_id, correlation_id
  )
  WHERE source_type = 'scheduled_post_publisher_hold'
    AND action = 'post_schedule_held';

-- Historical holds receive one bounded immutable transition receipt. Content,
-- addresses, and provider state are deliberately absent.
INSERT INTO plugin_data.csf_admin_audit_events (
  organization_id,
  actor_user_id,
  action,
  target_type,
  target_id,
  term_id,
  before_data,
  after_data,
  correlation_id,
  source_type,
  source_id,
  reason_code
)
SELECT
  announcement.organization_id,
  NULL,
  'post_schedule_held',
  'csf_announcement',
  announcement.id,
  announcement.term_id,
  pg_catalog.jsonb_build_object(
    'status', 'scheduled',
    'scheduledFor', announcement.scheduled_for,
    'scheduleRevision', announcement.schedule_revision
  ),
  pg_catalog.jsonb_build_object(
    'status', 'scheduled',
    'holdReason', announcement.scheduled_publish_hold_reason,
    'heldAt', announcement.scheduled_publish_held_at,
    'systemActor', 'csf_scheduled_post_publisher',
    'scheduledByUserId', announcement.scheduled_by
  ),
  announcement.schedule_revision,
  'scheduled_post_publisher_hold',
  'migration:20260810002428',
  announcement.scheduled_publish_hold_reason
FROM plugin_data.csf_announcements AS announcement
WHERE announcement.status = 'scheduled'
  AND announcement.scheduled_publish_hold_reason IS NOT NULL;

-- A distinct future time is the explicit retry action. It refreshes the human
-- provenance, creates a new idempotency coordinate, and clears the old hold.
-- Leaving scheduled state clears all actionable schedule metadata; published
-- and archived rows therefore cannot retain a live due time.
CREATE FUNCTION plugin_data.csf_guard_announcement_schedule_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'scheduled' THEN
    NEW.scheduled_for := NULL;
    NEW.scheduled_by := NULL;
    NEW.schedule_revision := NULL;
    NEW.scheduled_publish_hold_reason := NULL;
    NEW.scheduled_publish_held_at := NULL;
    NEW.scheduled_publish_last_checked_at := NULL;
    IF NEW.status = 'archived' THEN
      NEW.pinned := false;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
    OR OLD.status IS DISTINCT FROM 'scheduled'
    OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for THEN
    NEW.scheduled_by := coalesce(NEW.updated_by, NEW.created_by);
    NEW.schedule_revision := gen_random_uuid();
    NEW.scheduled_publish_hold_reason := NULL;
    NEW.scheduled_publish_held_at := NULL;
    NEW.scheduled_publish_last_checked_at := NULL;
  ELSE
    -- The current schedule's provenance is immutable. A worker may add the
    -- first hold, but neither an ordinary edit nor a direct service call may
    -- clear or rewrite that hold without choosing a distinct future time.
    NEW.scheduled_by := OLD.scheduled_by;
    NEW.schedule_revision := OLD.schedule_revision;
    IF OLD.scheduled_publish_hold_reason IS NOT NULL THEN
      NEW.scheduled_publish_hold_reason :=
        OLD.scheduled_publish_hold_reason;
      NEW.scheduled_publish_held_at := OLD.scheduled_publish_held_at;
      NEW.scheduled_publish_last_checked_at :=
        OLD.scheduled_publish_last_checked_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  plugin_data.csf_guard_announcement_schedule_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_announcements_schedule_lifecycle_guard
BEFORE INSERT OR UPDATE ON plugin_data.csf_announcements
FOR EACH ROW EXECUTE FUNCTION
  plugin_data.csf_guard_announcement_schedule_lifecycle();

-- ---------------------------------------------------------------------------
-- Preserve csf_mutate_post's external name while adding truthful live-edit
-- semantics around the atomic primitive introduced in 20260810000028.
-- ---------------------------------------------------------------------------

ALTER FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) RENAME TO csf_mutate_post_atomic_inner;

REVOKE ALL ON FUNCTION plugin_data.csf_mutate_post_atomic_inner(
  uuid, text, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_mutate_post(
  p_organization_id uuid,
  p_operation text,
  p_post_id uuid,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_operation, '')));
  v_status text;
  v_publish boolean;
  v_scheduled_text text;
  v_scheduled_for timestamptz;
  v_has_receipt boolean := false;
BEGIN
  -- Authorization and the stable request coordinate precede every receipt or
  -- post read. This wrapper deliberately repeats the inner primitive's check.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_posts'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable post request identifier is required.';
  END IF;

  -- Same lock key and order as the inner receipt primitive. Re-acquiring this
  -- transaction lock inside the inner function is safe and keeps new requests,
  -- exact replays, and hostile request-id reuse serialized identically.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_post_mutation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.source_type = 'post_mutation_request'
      AND audit.action IN (
        'post_created',
        'post_updated',
        'post_pinned',
        'post_unpinned',
        'post_archived'
      )
  )
  INTO v_has_receipt;

  -- The inner primitive owns fingerprint and current-state verification. A
  -- scheduled receipt replay after automatic publication reaches that check and
  -- returns its bounded stale-state refusal rather than becoming a second edit.
  IF v_has_receipt THEN
    RETURN plugin_data.csf_mutate_post_atomic_inner(
      p_organization_id,
      p_operation,
      p_post_id,
      p_payload,
      p_actor_user_id,
      p_request_id
    );
  END IF;

  IF v_operation = 'update' THEN
    SELECT announcement.status
    INTO v_status
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.organization_id = p_organization_id
      AND announcement.id = p_post_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That post was not found in this chapter.';
    END IF;

    IF pg_catalog.jsonb_typeof(p_payload) = 'object'
      AND pg_catalog.jsonb_typeof(p_payload -> 'publish') = 'boolean' THEN
      v_publish := (p_payload ->> 'publish')::boolean;
    END IF;

    IF v_status = 'published'
      AND (
        v_publish IS DISTINCT FROM true
        OR pg_catalog.jsonb_typeof(p_payload -> 'scheduledFor')
          IS DISTINCT FROM 'null'
      ) THEN
      RAISE EXCEPTION
        'Published post edits stay live. Archive the post or create a new scheduled post.';
    END IF;
  END IF;

  -- A past time is not a schedule; Publish now is the explicit immediate path.
  -- Invalid timestamp shapes continue to the inner primitive for its canonical
  -- validation message.
  IF v_operation IN ('create', 'update')
    AND pg_catalog.jsonb_typeof(p_payload) = 'object'
    AND pg_catalog.jsonb_typeof(p_payload -> 'publish') = 'boolean'
    AND (p_payload ->> 'publish')::boolean = false
    AND pg_catalog.jsonb_typeof(p_payload -> 'scheduledFor') = 'string' THEN
    v_scheduled_text := p_payload ->> 'scheduledFor';
    IF v_scheduled_text ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      BEGIN
        v_scheduled_for := v_scheduled_text::timestamptz;
      EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR invalid_time_zone_displacement_value THEN
        v_scheduled_for := NULL;
      END;
      IF v_scheduled_for IS NOT NULL
        AND v_scheduled_for <= pg_catalog.statement_timestamp() THEN
        RAISE EXCEPTION
          'Choose a future time, or publish the post now.';
      END IF;
    END IF;
  END IF;

  RETURN plugin_data.csf_mutate_post_atomic_inner(
    p_organization_id,
    p_operation,
    p_post_id,
    p_payload,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_mutate_post(
  uuid, text, uuid, jsonb, uuid, uuid
) IS 'Service-only CSF post mutation boundary. Authorization and request serialization precede reads; exact receipts retain inner fingerprint/state checks; published edits cannot pretend to become drafts or schedules; schedule times must be future.';
COMMENT ON FUNCTION plugin_data.csf_mutate_post_atomic_inner(
  uuid, text, uuid, jsonb, uuid, uuid
) IS 'Internal atomic post mutation and receipt primitive. Direct service_role execution is revoked; call csf_mutate_post instead.';

-- A schedule hold is a material post-state change. Include every schedule
-- provenance/hold coordinate in the canonical receipt state so replaying the
-- earlier save cannot misleadingly answer "scheduled" after the worker has
-- stopped it for officer review. Campaign/provider linkage remains excluded.
CREATE OR REPLACE FUNCTION plugin_data.csf_post_mutation_state(
  p_post plugin_data.csf_announcements
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'postId', (p_post).id,
    'organizationId', (p_post).organization_id,
    'termId', (p_post).term_id,
    'title', (p_post).title,
    'body', (p_post).body,
    'audience', (p_post).audience,
    'audienceCohortId', (p_post).audience_cohort_id,
    'status', (p_post).status,
    'pinned', (p_post).pinned,
    'publishedAtEpoch', CASE
      WHEN (p_post).published_at IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).published_at)
    END,
    'scheduledForEpoch', CASE
      WHEN (p_post).scheduled_for IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).scheduled_for)
    END,
    'scheduledBy', (p_post).scheduled_by,
    'scheduleRevision', (p_post).schedule_revision,
    'scheduleHoldReason', (p_post).scheduled_publish_hold_reason,
    'scheduleHeldAtEpoch', CASE
      WHEN (p_post).scheduled_publish_held_at IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).scheduled_publish_held_at)
    END,
    'scheduleLastCheckedAtEpoch', CASE
      WHEN (p_post).scheduled_publish_last_checked_at IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).scheduled_publish_last_checked_at)
    END,
    'expiresAtEpoch', CASE
      WHEN (p_post).expires_at IS NULL THEN NULL
      ELSE extract(epoch FROM (p_post).expires_at)
    END,
    'emailRequested', (p_post).email_requested,
    'createdBy', (p_post).created_by,
    'updatedBy', (p_post).updated_by,
    'createdAtEpoch', extract(epoch FROM (p_post).created_at),
    'updatedAtEpoch', extract(epoch FROM (p_post).updated_at)
  );
$$;

COMMENT ON FUNCTION plugin_data.csf_post_mutation_state(
  plugin_data.csf_announcements
) IS 'Internal canonical CSF post state used to verify immutable mutation receipts. Schedule provenance and durable holds are state; campaign/provider linkage remains excluded.';

-- ---------------------------------------------------------------------------
-- Bounded, retry-safe due publisher
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_publish_due_posts(
  p_limit integer,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_limit constant integer := 50;
  v_limit integer := coalesce(p_limit, 0);
  v_worker_id text := pg_catalog.btrim(coalesce(p_worker_id, ''));
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_post plugin_data.csf_announcements%ROWTYPE;
  v_hold_reason text;
  v_examined integer := 0;
  v_published integer := 0;
  v_held integer := 0;
  v_plugin_holds integer := 0;
  v_actor_holds integer := 0;
  v_term_holds integer := 0;
  v_cohort_holds integer := 0;
  v_expired_holds integer := 0;
  v_email_holds integer := 0;
  v_organization_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_limit < 1 OR v_limit > c_max_limit THEN
    RAISE EXCEPTION 'Scheduled post publisher limit must be between 1 and 50.';
  END IF;
  IF v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$' THEN
    RAISE EXCEPTION
      'Scheduled post publisher worker id must be 1 to 96 routing characters.';
  END IF;

  FOR v_post IN
    SELECT announcement.*
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.status = 'scheduled'
      AND announcement.scheduled_for <= v_now
      AND announcement.scheduled_publish_hold_reason IS NULL
    ORDER BY announcement.scheduled_for, announcement.id
    LIMIT v_limit
    FOR UPDATE OF announcement SKIP LOCKED
  LOOP
    v_examined := v_examined + 1;
    v_hold_reason := NULL;

    -- Revalidate every authority/source coordinate under the post row lock.
    -- The worker cannot revive a disabled plugin, a revoked scheduling actor, a
    -- closed term, or an inactive class merely because the due time arrived.
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_plugin_access AS access
      WHERE access.organization_id = v_post.organization_id
        AND access.plugin_key = 'dvhs-csf'
        AND access.enabled = true
        AND access.is_accessible = true
    ) THEN
      v_hold_reason := 'plugin_unavailable';
      v_plugin_holds := v_plugin_holds + 1;
    ELSIF v_post.scheduled_by IS NULL
      OR plugin_data.csf_actor_has_permission(
        v_post.organization_id,
        v_post.scheduled_by,
        'manage_posts'
      ) IS DISTINCT FROM true THEN
      v_hold_reason := 'schedule_actor_unavailable';
      v_actor_holds := v_actor_holds + 1;
    ELSIF v_post.term_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = v_post.organization_id
          AND term.id = v_post.term_id
          AND term.lifecycle_status NOT IN ('closed', 'archived')
      ) THEN
      v_hold_reason := 'term_unavailable';
      v_term_holds := v_term_holds + 1;
    ELSIF v_post.audience = 'class'
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_cohorts AS cohort
        WHERE cohort.organization_id = v_post.organization_id
          AND cohort.id = v_post.audience_cohort_id
          AND cohort.status = 'active'
      ) THEN
      v_hold_reason := 'cohort_unavailable';
      v_cohort_holds := v_cohort_holds + 1;
    ELSIF v_post.expires_at IS NOT NULL AND v_post.expires_at <= v_now THEN
      v_hold_reason := 'post_expired';
      v_expired_holds := v_expired_holds + 1;
    ELSIF v_post.email_requested IS DISTINCT FROM false THEN
      -- Scheduling email is intentionally not a product feature. Never turn an
      -- inconsistent legacy intent flag into a provider operation.
      v_hold_reason := 'scheduled_email_not_supported';
      v_email_holds := v_email_holds + 1;
    END IF;

    IF v_hold_reason IS NOT NULL THEN
      UPDATE plugin_data.csf_announcements
      SET scheduled_publish_hold_reason = v_hold_reason,
          scheduled_publish_held_at = v_now,
          scheduled_publish_last_checked_at = v_now
      WHERE organization_id = v_post.organization_id
        AND id = v_post.id;

      INSERT INTO plugin_data.csf_admin_audit_events (
        organization_id,
        actor_user_id,
        action,
        target_type,
        target_id,
        term_id,
        before_data,
        after_data,
        correlation_id,
        source_type,
        source_id,
        reason_code
      ) VALUES (
        v_post.organization_id,
        NULL,
        'post_schedule_held',
        'csf_announcement',
        v_post.id,
        v_post.term_id,
        pg_catalog.jsonb_build_object(
          'status', 'scheduled',
          'scheduledFor', v_post.scheduled_for,
          'scheduleRevision', v_post.schedule_revision
        ),
        pg_catalog.jsonb_build_object(
          'status', 'scheduled',
          'holdReason', v_hold_reason,
          'heldAt', v_now,
          'systemActor', 'csf_scheduled_post_publisher',
          'scheduledByUserId', v_post.scheduled_by
        ),
        v_post.schedule_revision,
        'scheduled_post_publisher_hold',
        v_worker_id,
        v_hold_reason
      );
      v_held := v_held + 1;
      IF NOT v_post.organization_id = ANY(v_organization_ids) THEN
        v_organization_ids := pg_catalog.array_append(
          v_organization_ids,
          v_post.organization_id
        );
      END IF;
      CONTINUE;
    END IF;

    UPDATE plugin_data.csf_announcements
    SET status = 'published',
        published_at = v_now,
        updated_at = v_now
    WHERE organization_id = v_post.organization_id
      AND id = v_post.id;

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      term_id,
      before_data,
      after_data,
      correlation_id,
      source_type,
      source_id,
      reason_code
    ) VALUES (
      v_post.organization_id,
      NULL,
      'post_published_automatically',
      'csf_announcement',
      v_post.id,
      v_post.term_id,
      pg_catalog.jsonb_build_object(
        'status', 'scheduled',
        'scheduledFor', v_post.scheduled_for,
        'scheduleRevision', v_post.schedule_revision
      ),
      pg_catalog.jsonb_build_object(
        'status', 'published',
        'publishedAt', v_now,
        'systemActor', 'csf_scheduled_post_publisher',
        'scheduledByUserId', v_post.scheduled_by,
        'emailQueued', false
      ),
      v_post.schedule_revision,
      'scheduled_post_publisher',
      v_worker_id,
      'scheduled_time_reached'
    );

    v_published := v_published + 1;
    IF NOT v_post.organization_id = ANY(v_organization_ids) THEN
      v_organization_ids := pg_catalog.array_append(
        v_organization_ids,
        v_post.organization_id
      );
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'examined', v_examined,
    'published', v_published,
    'held', v_held,
    'holds', pg_catalog.jsonb_build_object(
      'pluginUnavailable', v_plugin_holds,
      'actorUnavailable', v_actor_holds,
      'termUnavailable', v_term_holds,
      'cohortUnavailable', v_cohort_holds,
      'expired', v_expired_holds,
      'scheduledEmailUnsupported', v_email_holds
    ),
    'organizationIds', pg_catalog.to_jsonb(v_organization_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_publish_due_posts(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publish_due_posts(integer, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_publish_due_posts(integer, text) IS
  'Service-only bounded due-post publisher. Uses FOR UPDATE SKIP LOCKED, revalidates active CSF plugin/actor/term/cohort/expiry/email conditions, commits one post transition and immutable system audit atomically, and never queues email.';

NOTIFY pgrst, 'reload schema';

COMMIT;
