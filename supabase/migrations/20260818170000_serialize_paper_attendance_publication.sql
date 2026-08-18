-- Serialize paper-attendance commits with hours publication and reject a
-- publication snapshot that omitted newly committed attendance.

ALTER TABLE public.hours_publication_receipts
  ADD COLUMN publication_origin text NOT NULL DEFAULT 'manual';
ALTER TABLE public.hours_publication_receipts
  ADD CONSTRAINT hours_publication_receipts_origin_check
  CHECK (publication_origin IN ('manual', 'automatic'));

CREATE OR REPLACE FUNCTION private.hours_publication_result(
  p_receipt_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'outcome', p_outcome,
    'receiptId', receipts.id,
    'requestKey', receipts.request_key,
    'certificatesCreated', receipts.certificate_count,
    'projectTitle', projects.title,
    'projectTimezone', projects.project_timezone,
    'publicationOrigin', receipts.publication_origin,
    'deliveries', COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'deliveryId', outbox.id,
          'state', outbox.state,
          'payloadPrepared', outbox.payload_snapshot IS NOT NULL,
          'idempotencyKey', outbox.idempotency_key,
          'certificateId', certificates.id,
          'volunteerName', certificates.volunteer_name,
          'volunteerEmail', certificates.volunteer_email,
          'eventStart', certificates.event_start,
          'eventEnd', certificates.event_end
        ) ORDER BY certificates.signup_id
      ) FILTER (WHERE outbox.id IS NOT NULL),
      '[]'::jsonb
    )
  )
  FROM public.hours_publication_receipts AS receipts
  JOIN public.projects AS projects ON projects.id = receipts.project_id
  LEFT JOIN public.hours_publication_email_outbox AS outbox
    ON outbox.receipt_id = receipts.id
  LEFT JOIN public.certificates AS certificates
    ON certificates.id = outbox.certificate_id
  WHERE receipts.id = p_receipt_id
  GROUP BY receipts.id, projects.id;
$$;

REVOKE ALL ON FUNCTION private.hours_publication_result(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.hours_publication_result(uuid, text)
  TO postgres;

-- The product permits event capacities up to 1,000. Raise the existing atomic
-- publication transaction's bounded input limit without editing its historical
-- migration; fail closed if the expected reviewed body ever drifts.
DO $raise_hours_publication_limit$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'private.publish_volunteer_hours_transactional_legacy_status_fallback(uuid,uuid,text,jsonb,text)'::regprocedure
  )
  INTO v_definition;

  v_updated_definition := pg_catalog.regexp_replace(
    v_definition,
    'v_entry_count[[:space:]]*>[[:space:]]*500',
    'v_entry_count > 1000',
    'g'
  );
  v_updated_definition := pg_catalog.replace(
    v_updated_definition,
    'publication entries must contain between 1 and 500 signups',
    'publication entries must contain between 1 and 1000 signups'
  );

  IF v_updated_definition = v_definition
    OR v_updated_definition ~ 'v_entry_count[[:space:]]*>[[:space:]]*500'
    OR v_updated_definition LIKE '%between 1 and 500 signups%'
  THEN
    RAISE EXCEPTION 'reviewed hours publication limit source drifted';
  END IF;

  EXECUTE v_updated_definition;
END;
$raise_hours_publication_limit$;

REVOKE ALL ON FUNCTION
  private.publish_volunteer_hours_transactional_legacy_status_fallback(
    uuid, uuid, text, jsonb, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.publish_volunteer_hours_transactional_legacy_status_fallback(
    uuid, uuid, text, jsonb, text
  )
  TO postgres;

CREATE OR REPLACE FUNCTION public.publish_volunteer_hours_transactional_automatic(
  p_actor_id uuid,
  p_project_id uuid,
  p_schedule_id text,
  p_entries jsonb,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_receipt_id uuid;
BEGIN
  v_result := private.publish_volunteer_hours_transactional(
    p_actor_id,
    p_project_id,
    p_schedule_id,
    p_entries,
    p_request_key
  );
  v_receipt_id := NULLIF(v_result ->> 'receiptId', '')::uuid;
  IF v_receipt_id IS NULL THEN
    RAISE EXCEPTION 'automatic hours publication returned no receipt';
  END IF;

  UPDATE public.hours_publication_receipts
  SET publication_origin = 'automatic'
  WHERE id = v_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automatic hours publication receipt is missing';
  END IF;

  RETURN private.hours_publication_result(
    v_receipt_id,
    v_result ->> 'outcome'
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.publish_volunteer_hours_transactional_automatic(
    uuid, uuid, text, jsonb, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.publish_volunteer_hours_transactional_automatic(
    uuid, uuid, text, jsonb, text
  )
  TO service_role;

COMMENT ON FUNCTION
  public.publish_volunteer_hours_transactional_automatic(
    uuid, uuid, text, jsonb, text
  ) IS
  'Service-only atomic hours publication entrypoint that durably records automatic origin for retry-safe email rendering.';

-- The paper commit RPC receives and revalidates the authenticated staff actor,
-- while its row triggers run under the service role. Carry that reviewed actor
-- through the same transaction so late certificate issuance keeps the correct
-- audit identity without trusting a browser-writable column.
DO $carry_paper_commit_actor$
DECLARE
  v_definition text;
  v_updated_definition text;
  v_authorization_block text := $block$
  IF NOT app_private.can_manage_project(v_batch.project_id, p_actor_id) THEN
    RAISE EXCEPTION 'commit_paper_signup_batch: actor is not a project organizer';
  END IF;
$block$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.commit_paper_signup_batch(uuid,uuid,uuid[],boolean,uuid)'::regprocedure
  )
  INTO v_definition;

  v_updated_definition := pg_catalog.replace(
    v_definition,
    v_authorization_block,
    v_authorization_block || $block$

  PERFORM pg_catalog.set_config(
    'app.paper_commit_actor_id',
    p_actor_id::text,
    true
  );
$block$
  );

  IF v_updated_definition = v_definition
    OR v_updated_definition NOT LIKE '%app.paper_commit_actor_id%'
  THEN
    RAISE EXCEPTION 'reviewed paper commit actor source drifted';
  END IF;

  EXECUTE v_updated_definition;
END;
$carry_paper_commit_actor$;

REVOKE ALL ON FUNCTION
  public.commit_paper_signup_batch(uuid, uuid, uuid[], boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.commit_paper_signup_batch(uuid, uuid, uuid[], boolean, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION app_private.lock_paper_scan_project_for_commit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'committing' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM projects.id
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'paper scan project not found';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.lock_paper_scan_project_for_commit()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.lock_paper_scan_project_for_commit()
  TO postgres;

DROP TRIGGER IF EXISTS lock_paper_scan_project_for_commit
  ON public.project_paper_scan_batches;
CREATE TRIGGER lock_paper_scan_project_for_commit
  BEFORE UPDATE OF status ON public.project_paper_scan_batches
  FOR EACH ROW
  EXECUTE FUNCTION app_private.lock_paper_scan_project_for_commit();

CREATE OR REPLACE FUNCTION app_private.guard_hours_publication_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_publish_key text;
BEGIN
  FOR v_publish_key IN
    SELECT published.key
    FROM pg_catalog.jsonb_each_text(COALESCE(NEW.published, '{}'::jsonb)) AS published(key, value)
    WHERE published.value = 'true'
      AND COALESCE(OLD.published ->> published.key, 'false') <> 'true'
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.project_signups AS signups
      LEFT JOIN public.certificates AS certificates
        ON certificates.signup_id = signups.id
       AND certificates.type = 'verified'
      WHERE signups.project_id = NEW.id
        AND signups.status = 'attended'
        AND signups.check_in_time IS NOT NULL
        AND signups.check_out_time IS NOT NULL
        AND signups.check_out_time > signups.check_in_time
        AND signups.check_out_time <= signups.check_in_time + interval '24 hours'
        AND private.project_hours_publish_key(
          NEW.event_type,
          NEW.schedule,
          signups.schedule_id
        ) = v_publish_key
        AND certificates.id IS NULL
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'publication snapshot is stale; refresh attendance before publishing';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_hours_publication_completeness()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.guard_hours_publication_completeness()
  TO postgres;

DROP TRIGGER IF EXISTS guard_hours_publication_completeness
  ON public.projects;
CREATE TRIGGER guard_hours_publication_completeness
  BEFORE UPDATE OF published ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION app_private.guard_hours_publication_completeness();

COMMENT ON FUNCTION app_private.lock_paper_scan_project_for_commit() IS
  'Locks the parent project before a paper batch creates attendance so hours publication cannot overlap it.';
COMMENT ON FUNCTION app_private.guard_hours_publication_completeness() IS
  'Rejects a newly published session when eligible attended signups still lack verified certificates.';

CREATE OR REPLACE FUNCTION app_private.issue_verified_certificate_for_late_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_publish_key text;
  v_certificate_id uuid;
  v_receipt_id uuid;
  v_request_hash text;
  v_commit_actor_id uuid := NULLIF(
    pg_catalog.current_setting('app.paper_commit_actor_id', true),
    ''
  )::uuid;
BEGIN
  IF session_user <> 'postgres'
    AND COALESCE(auth.role()::text, '') <> 'service_role'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'attended'
    OR NEW.check_in_time IS NULL
    OR NEW.check_out_time IS NULL
    OR NEW.check_out_time <= NEW.check_in_time
    OR NEW.check_out_time > NEW.check_in_time + interval '24 hours'
  THEN
    RETURN NEW;
  END IF;

  SELECT projects.*
  INTO v_project
  FROM public.projects AS projects
  WHERE projects.id = NEW.project_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_publish_key := private.project_hours_publish_key(
    v_project.event_type,
    v_project.schedule,
    NEW.schedule_id
  );

  IF v_publish_key IS NOT NULL
    AND COALESCE((v_project.published ->> v_publish_key)::boolean, false)
  THEN
    -- This executes inside the attendance write transaction. A paper batch
    -- cannot commit a late attendee to an already-published session without
    -- also committing that attendee's verified certificate.
    SELECT issued.id
    INTO v_certificate_id
    FROM public.issue_supplemental_verified_certificates(
      NEW.project_id,
      NEW.schedule_id,
      ARRAY[NEW.id],
      COALESCE(v_commit_actor_id, v_project.creator_id)
    ) AS issued;

    IF v_certificate_id IS NOT NULL THEN
      v_request_hash := pg_catalog.encode(
        extensions.digest(
          'late-certificate:' || v_certificate_id::text,
          'sha256'
        ),
        'hex'
      );

      INSERT INTO public.hours_publication_receipts (
        project_id,
        schedule_id,
        publish_key,
        request_key,
        request_hash,
        requested_by,
        certificate_count,
        email_work_count
      ) VALUES (
        NEW.project_id,
        NEW.schedule_id,
        v_publish_key,
        'hours-publication:v1:' || v_request_hash,
        v_request_hash,
        COALESCE(v_commit_actor_id, v_project.creator_id),
        0,
        0
      )
      ON CONFLICT (project_id, publish_key) DO UPDATE
        SET project_id = EXCLUDED.project_id
      RETURNING id INTO v_receipt_id;

      INSERT INTO public.hours_publication_email_outbox (
        receipt_id,
        certificate_id,
        idempotency_key,
        state,
        settled_at,
        safe_code
      )
      SELECT
        v_receipt_id,
        certificates.id,
        'hours-publication:v1:certificate:' || certificates.id,
        CASE
          WHEN NULLIF(certificates.volunteer_email, '') IS NULL
            OR NULLIF(certificates.volunteer_name, '') IS NULL
          THEN 'skipped'
          ELSE 'queued'
        END,
        CASE
          WHEN NULLIF(certificates.volunteer_email, '') IS NULL
            OR NULLIF(certificates.volunteer_name, '') IS NULL
          THEN now()
          ELSE NULL
        END,
        CASE
          WHEN NULLIF(certificates.volunteer_email, '') IS NULL
            OR NULLIF(certificates.volunteer_name, '') IS NULL
          THEN 'recipient_missing'
          ELSE NULL
        END
      FROM public.certificates AS certificates
      WHERE certificates.id = v_certificate_id
      ON CONFLICT (certificate_id) DO NOTHING;

      UPDATE public.hours_publication_receipts AS receipts
      SET
        certificate_count = (
          SELECT count(*)::integer
          FROM public.certificates AS certificates
          WHERE certificates.project_id = NEW.project_id
            AND certificates.schedule_id = NEW.schedule_id
            AND certificates.type = 'verified'
        ),
        email_work_count = (
          SELECT count(*)::integer
          FROM public.hours_publication_email_outbox AS outbox
          WHERE outbox.receipt_id = v_receipt_id
        )
      WHERE receipts.id = v_receipt_id;
    END IF;

    IF v_certificate_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id,
        title,
        body,
        type,
        severity,
        action_url,
        displayed,
        read,
        dedupe_key
      ) VALUES (
        NEW.user_id,
        'Your Volunteer Hours Have Been Published! 🎉',
        pg_catalog.format(
          'Your volunteer certificate for "%s" is now available.',
          v_project.title
        ),
        'project_updates',
        'success',
        '/certificates/' || v_certificate_id,
        false,
        false,
        'hours-publication:certificate:' || v_certificate_id
      )
      ON CONFLICT (user_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL
        DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.issue_verified_certificate_for_late_attendance()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.issue_verified_certificate_for_late_attendance()
  TO postgres;

DROP TRIGGER IF EXISTS issue_verified_certificate_for_late_attendance
  ON public.project_signups;
CREATE TRIGGER issue_verified_certificate_for_late_attendance
  AFTER INSERT OR UPDATE OF status, check_in_time, check_out_time
  ON public.project_signups
  FOR EACH ROW
  EXECUTE FUNCTION app_private.issue_verified_certificate_for_late_attendance();

COMMENT ON FUNCTION app_private.issue_verified_certificate_for_late_attendance() IS
  'Atomically issues a verified certificate when attendance lands after its project session was published.';
