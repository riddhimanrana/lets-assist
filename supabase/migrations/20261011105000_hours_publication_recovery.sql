-- Recover already-authorized delivery work without replaying ambiguous sends.
-- This migration neither enables a worker nor approves historical publication.
BEGIN;

-- One row per canonical session the automatic worker has tried to publish.
-- The claim RPC is the only reader and writer.
CREATE TABLE app_private.hours_publication_discovery_attempts (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  publish_key text NOT NULL CHECK (char_length(btrim(publish_key)) BETWEEN 1 AND 200),
  last_attempt_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  PRIMARY KEY (project_id, publish_key)
);
ALTER TABLE app_private.hours_publication_discovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.hours_publication_discovery_attempts FROM PUBLIC,anon,authenticated,service_role;

-- Recovery selection has its own ledger. first_attempt_at and last_attempt_at
-- own the 15 minute provider lease and the 24 hour idempotency window, and a
-- delivery that fails before its provider claim never advances them, so they
-- cannot order the sweep without letting such a delivery hold its place forever.
ALTER TABLE public.hours_publication_email_outbox
  ADD COLUMN recovery_selected_at timestamptz,
  ADD COLUMN recovery_selection_count integer NOT NULL DEFAULT 0 CHECK (recovery_selection_count >= 0);
CREATE INDEX hours_publication_email_outbox_recovery_idx
  ON public.hours_publication_email_outbox (recovery_selected_at NULLS FIRST, created_at, id)
  WHERE state IN ('queued','retryable_failure','processing','unknown_outcome');

-- 'ignored' rows carry no attendance. A 'valid' row satisfies the atomic
-- publication duration rules. Everything else blocks its whole session.
CREATE FUNCTION private.hours_attendance_row_state(p_status text,p_check_in timestamptz,p_check_out timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_status IS NULL OR p_status NOT IN ('attended','approved','pending') THEN 'ignored'
    WHEN p_status <> 'attended' AND p_check_in IS NULL AND p_check_out IS NULL THEN 'ignored'
    WHEN p_status = 'pending' THEN 'invalid'
    WHEN p_check_in IS NULL OR p_check_out IS NULL OR NOT isfinite(p_check_in) OR NOT isfinite(p_check_out) THEN 'invalid'
    WHEN p_check_out <= p_check_in OR round(extract(epoch FROM p_check_out - p_check_in) / 60) < 1
      OR p_check_out > p_check_in + interval '24 hours' THEN 'invalid'
    ELSE 'valid'
  END;
$$;
REVOKE ALL ON FUNCTION private.hours_attendance_row_state(text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.hours_attendance_row_state(text,timestamptz,timestamptz) TO postgres;

-- Classification, selection, the attempt record, and the entry JSON are one
-- statement and therefore one snapshot. Every helper it calls is STABLE and
-- reads that same snapshot. Entry JSON is built for the claimed sessions
-- alone, so neither the Data API row cap nor an oversized session can produce
-- a truncated snapshot.
CREATE FUNCTION public.claim_due_hours_publications(p_approved_from timestamptz,p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit,10),10),1);
  v_held jsonb;
  v_ready integer;
  v_claimed integer;
  v_sessions jsonb;
BEGIN
  IF p_approved_from IS NULL OR NOT isfinite(p_approved_from) OR p_approved_from > v_now THEN
    RAISE EXCEPTION 'an explicit past approval boundary is required' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('lets-assist-hours-publication-claim',0)) THEN
    RETURN jsonb_build_object('contended',true,'counted',false,'sessions','[]'::jsonb,
      'pendingSessions','null'::jsonb,'heldSessions','null'::jsonb);
  END IF;

  DELETE FROM app_private.hours_publication_discovery_attempts attempt USING public.projects project
    WHERE project.id=attempt.project_id AND COALESCE(project.published->>attempt.publish_key,'')='true';

  WITH evidence AS (
    SELECT signup.project_id,signup.schedule_id,signup.check_out_time,project.creator_id,project.published,
      private.hours_attendance_row_state(signup.status::text,signup.check_in_time,signup.check_out_time) AS row_state,
      private.project_hours_publish_key(project.event_type::text,project.schedule,signup.schedule_id) AS publish_key
    FROM public.project_signups signup
    JOIN public.projects project ON project.id=signup.project_id
    WHERE project.verification_method::text IN ('manual','qr-code')
      AND project.status::text IS DISTINCT FROM 'cancelled'
      AND NOT (project.event_type::text='oneTime' AND COALESCE(project.published->>'oneTime','')='true')
      AND (signup.status::text='attended' OR (signup.status::text IN ('approved','pending')
        AND (signup.check_in_time IS NOT NULL OR signup.check_out_time IS NOT NULL)))
  ), candidates AS MATERIALIZED (
    SELECT evidence.project_id,evidence.creator_id,evidence.publish_key,
      count(*) AS required_count,
      count(*) FILTER (WHERE evidence.row_state='invalid') AS invalid_count,
      min(evidence.check_out_time) FILTER (WHERE evidence.row_state='valid') AS first_checkout,
      max(evidence.check_out_time) FILTER (WHERE evidence.row_state='valid') AS last_checkout
    FROM evidence
    WHERE evidence.row_state<>'ignored'
      AND (evidence.publish_key IS NULL OR COALESCE(evidence.published->>evidence.publish_key,'')<>'true')
    GROUP BY evidence.project_id,evidence.creator_id,evidence.publish_key,
      CASE WHEN evidence.publish_key IS NULL THEN evidence.schedule_id END
  ), classified AS MATERIALIZED (
    -- Held sessions are classified before the ready limit, so a blocked
    -- backlog cannot occupy a claim slot.
    SELECT candidate.project_id,candidate.publish_key,candidate.last_checkout,CASE
        WHEN candidate.publish_key IS NULL OR slot.ends_at IS NULL THEN 'invalidSchedule'
        WHEN slot.ends_at > v_now OR candidate.last_checkout > v_now - interval '48 hours' THEN 'notDue'
        WHEN candidate.creator_id IS NULL
          OR NOT app_private.account_deletion_actor_is_active(candidate.creator_id) THEN 'missingCreator'
        WHEN candidate.required_count > 1000 THEN 'oversized'
        WHEN candidate.invalid_count > 0 OR EXISTS (
          SELECT 1 FROM public.project_paper_scan_batches batch
          JOIN public.projects batch_project ON batch_project.id=batch.project_id
          WHERE batch.project_id=candidate.project_id AND batch.status IN ('extracting','review','committing')
            AND private.project_hours_publish_key(batch_project.event_type::text,batch_project.schedule,batch.schedule_id)
              =candidate.publish_key) THEN 'invalidAttendance'
        WHEN candidate.first_checkout < p_approved_from THEN 'historical'
        ELSE 'ready'
      END AS disposition
    FROM candidates candidate
    LEFT JOIN LATERAL private.resolve_project_schedule_slot(candidate.project_id,candidate.publish_key) slot ON true
  ), ready AS MATERIALIZED (
    SELECT classified.project_id,classified.publish_key,classified.last_checkout,attempt.last_attempt_at
    FROM classified
    LEFT JOIN app_private.hours_publication_discovery_attempts attempt
      ON attempt.project_id=classified.project_id AND attempt.publish_key=classified.publish_key
    WHERE classified.disposition='ready'
  ), selected AS MATERIALIZED (
    SELECT ready.project_id,ready.publish_key,row_number() OVER (
        ORDER BY COALESCE(ready.last_attempt_at,'-infinity'::timestamptz),ready.last_checkout,ready.project_id,ready.publish_key
      ) AS claim_order
    FROM ready
    WHERE ready.last_attempt_at IS NULL OR ready.last_attempt_at <= v_now - interval '15 minutes'
    ORDER BY claim_order
    LIMIT v_limit
  ), marked AS (
    -- Recorded before publication, so a session that keeps failing rotates
    -- behind the others and becomes claimable again after the cooldown.
    INSERT INTO app_private.hours_publication_discovery_attempts AS attempt(project_id,publish_key,last_attempt_at)
      SELECT selected.project_id,selected.publish_key,v_now FROM selected
      ON CONFLICT (project_id,publish_key) DO UPDATE
        SET last_attempt_at=EXCLUDED.last_attempt_at,attempt_count=attempt.attempt_count+1
      RETURNING attempt.project_id,attempt.publish_key
  )
  SELECT jsonb_build_object(
      'historical',(SELECT count(*) FROM classified WHERE classified.disposition='historical'),
      'oversized',(SELECT count(*) FROM classified WHERE classified.disposition='oversized'),
      'invalidAttendance',(SELECT count(*) FROM classified WHERE classified.disposition='invalidAttendance'),
      'missingCreator',(SELECT count(*) FROM classified WHERE classified.disposition='missingCreator'),
      'invalidSchedule',(SELECT count(*) FROM classified WHERE classified.disposition='invalidSchedule')),
    (SELECT count(*) FROM ready),
    (SELECT count(*) FROM marked),
    -- The entries are read by the statement that classified the session. No
    -- attendee who arrives or moves across the boundary afterwards can enter
    -- a snapshot that was approved without them.
    (SELECT jsonb_agg(jsonb_build_object('projectId',project.id,'publishKey',selected.publish_key,
        'scheduleId',selected.publish_key,'creatorId',project.creator_id,'projectTitle',project.title,
        'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object('signupId',signup.id,'checkIn',signup.check_in_time,
            'checkOut',signup.check_out_time,'attendanceRevision',signup.attendance_revision) ORDER BY signup.id),'[]'::jsonb)
          FROM public.project_signups signup
          WHERE signup.project_id=project.id
            AND private.hours_attendance_row_state(signup.status::text,signup.check_in_time,signup.check_out_time)='valid'
            AND private.project_hours_publish_key(project.event_type::text,project.schedule,signup.schedule_id)=selected.publish_key)
        ) ORDER BY selected.claim_order)
      FROM selected
      JOIN marked ON marked.project_id=selected.project_id AND marked.publish_key=selected.publish_key
      JOIN public.projects project ON project.id=selected.project_id)
  INTO v_held,v_ready,v_claimed,v_sessions;

  RETURN jsonb_build_object('contended',false,'counted',true,'sessions',COALESCE(v_sessions,'[]'::jsonb),
    'pendingSessions',v_ready-v_claimed,'heldSessions',v_held);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_hours_publications(timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_hours_publications(timestamptz,integer) TO service_role;

-- The earlier body relabelled any returned receipt as automatic, including an
-- organizer's manual receipt replayed by an identical automatic request. The
-- origin now changes only for a receipt this call created. Existing rows are
-- left as they are.
CREATE OR REPLACE FUNCTION public.publish_volunteer_hours_transactional_automatic(
  p_actor_id uuid, p_project_id uuid, p_schedule_id text, p_entries jsonb, p_request_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_receipt_id uuid;
BEGIN
  v_result := private.publish_volunteer_hours_transactional(p_actor_id,p_project_id,p_schedule_id,p_entries,p_request_key);
  v_receipt_id := NULLIF(v_result->>'receiptId','')::uuid;
  IF v_receipt_id IS NULL THEN
    RAISE EXCEPTION 'automatic hours publication returned no receipt';
  END IF;
  IF v_result->>'outcome' = 'accepted' THEN
    UPDATE public.hours_publication_receipts SET publication_origin='automatic' WHERE id=v_receipt_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'automatic hours publication receipt is missing';
    END IF;
  END IF;
  RETURN private.hours_publication_result(v_receipt_id,v_result->>'outcome');
END;
$$;
REVOKE ALL ON FUNCTION public.publish_volunteer_hours_transactional_automatic(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_volunteer_hours_transactional_automatic(uuid,uuid,text,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.publish_volunteer_hours_transactional_automatic(uuid,uuid,text,jsonb,text) IS
  'Service-only atomic hours publication entrypoint. Records automatic origin for a newly accepted receipt and never relabels a replayed one.';

-- A claimed snapshot is published only while it still equals the session's
-- required attendance. The existing atomic transaction stays the final arbiter.
CREATE FUNCTION public.publish_claimed_volunteer_hours_automatic(
  p_actor_id uuid, p_project_id uuid, p_schedule_id text, p_entries jsonb, p_request_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_publish_key text;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;
  PERFORM private.lock_paper_attendance_account(p_actor_id);
  SELECT * INTO v_project FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE='P0002';
  END IF;
  IF v_project.creator_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'automatic publication is attributed to the project creator' USING ERRCODE='42501';
  END IF;
  -- A lost-response retry replays the committed receipt. Publication itself
  -- advances attendance revisions, so the snapshot is compared only before it.
  IF NOT EXISTS (SELECT 1 FROM public.hours_publication_receipts receipt WHERE receipt.request_key=p_request_key) THEN
    v_publish_key:=private.project_hours_publish_key(v_project.event_type::text,v_project.schedule,p_schedule_id);
    IF v_publish_key IS NULL OR v_project.status::text IS NOT DISTINCT FROM 'cancelled'
      OR v_project.verification_method::text NOT IN ('manual','qr-code')
      OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'invalid claimed publication' USING ERRCODE='22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM (SELECT signup.id,signup.check_in_time,signup.check_out_time,signup.attendance_revision,
          private.hours_attendance_row_state(signup.status::text,signup.check_in_time,signup.check_out_time) AS row_state
        FROM public.project_signups signup
        WHERE signup.project_id=p_project_id
          AND private.project_hours_publish_key(v_project.event_type::text,v_project.schedule,signup.schedule_id)=v_publish_key) live
      FULL JOIN (SELECT (entry.value->>'signupId')::uuid AS signup_id,(entry.value->>'checkIn')::timestamptz AS check_in,
          (entry.value->>'checkOut')::timestamptz AS check_out,(entry.value->>'attendanceRevision')::integer AS attendance_revision
        FROM jsonb_array_elements(p_entries) AS entry(value)) claimed ON claimed.signup_id=live.id
      WHERE live.id IS NULL
        OR (claimed.signup_id IS NULL AND live.row_state<>'ignored')
        OR (claimed.signup_id IS NOT NULL AND (live.row_state<>'valid'
          OR live.check_in_time IS DISTINCT FROM claimed.check_in
          OR live.check_out_time IS DISTINCT FROM claimed.check_out
          OR live.attendance_revision IS DISTINCT FROM claimed.attendance_revision))
    ) THEN
      RAISE EXCEPTION 'claimed attendance snapshot changed' USING ERRCODE='PT409';
    END IF;
  END IF;
  RETURN public.publish_volunteer_hours_transactional_automatic(p_actor_id,p_project_id,p_schedule_id,p_entries,p_request_key);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_claimed_volunteer_hours_automatic(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_claimed_volunteer_hours_automatic(uuid,uuid,text,jsonb,text) TO service_role;

CREATE FUNCTION public.recover_supplemental_verified_certificates(
  p_project_id uuid, p_schedule_id text, p_signup_ids uuid[], p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_receipt public.hours_publication_receipts%ROWTYPE;
  v_publish_key text;
  v_inserted_ids uuid[];
  v_certificate_ids uuid[];
  v_hash text;
  v_publication jsonb;
  v_deliveries jsonb;
  v_untracked integer;
BEGIN
  IF p_actor_id IS NOT NULL THEN
    PERFORM private.lock_paper_attendance_account(p_actor_id);
  END IF;
  IF p_actor_id IS NULL OR p_project_id IS NULL OR p_signup_ids IS NULL
    OR cardinality(p_signup_ids) NOT BETWEEN 1 AND 500
    OR array_position(p_signup_ids,NULL) IS NOT NULL
    OR NULLIF(btrim(p_schedule_id),'') IS NULL THEN
    RAISE EXCEPTION 'invalid supplemental certificate recovery' USING ERRCODE='22023';
  END IF;
  IF NOT private.lock_attendance_management(p_project_id,p_actor_id) THEN
    RAISE EXCEPTION 'not authorized to recover certificates' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT v_project FROM public.projects WHERE id=p_project_id;
  v_publish_key:=private.project_hours_publish_key(v_project.event_type,v_project.schedule,p_schedule_id);
  IF v_publish_key IS NULL OR COALESCE(v_project.published->>v_publish_key,'')<>'true' THEN
    RAISE EXCEPTION 'session hours are not published' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(array_agg(issued.id),ARRAY[]::uuid[]) INTO v_inserted_ids
    FROM public.issue_supplemental_verified_certificates(p_project_id,p_schedule_id,p_signup_ids,p_actor_id) issued;
  -- Only awards of this project and session are in scope, whatever was requested.
  SELECT COALESCE(array_agg(cert.id),ARRAY[]::uuid[]) INTO v_certificate_ids
    FROM public.certificates cert JOIN public.project_signups signup ON signup.id=cert.signup_id
    WHERE signup.id=ANY(p_signup_ids) AND signup.project_id=p_project_id AND cert.project_id=p_project_id
      AND private.project_hours_publish_key(v_project.event_type,v_project.schedule,signup.schedule_id)=v_publish_key
      AND (cert.type='verified' OR cert.type IS NULL);

  -- Only newly issued awards acquire new delivery work. An old award without
  -- a ledger may already have been emailed; do not guess or replay it.
  IF cardinality(v_inserted_ids)>0 THEN
    v_hash:=encode(extensions.digest('supplemental-hours-recovery:v1:'||p_project_id::text||':'||v_publish_key,'sha256'),'hex');
    INSERT INTO public.hours_publication_receipts(project_id,schedule_id,publish_key,request_key,request_hash,requested_by)
      VALUES(p_project_id,v_publish_key,v_publish_key,'hours-publication:v1:'||v_hash,v_hash,p_actor_id)
      ON CONFLICT(project_id,publish_key) DO UPDATE SET project_id=EXCLUDED.project_id
      RETURNING * INTO v_receipt;
    INSERT INTO public.hours_publication_email_outbox(receipt_id,certificate_id,idempotency_key,state,settled_at,safe_code)
      SELECT v_receipt.id,cert.id,'hours-publication:v1:certificate:'||cert.id,
        CASE WHEN NULLIF(btrim(cert.volunteer_email),'') IS NULL OR NULLIF(btrim(cert.volunteer_name),'') IS NULL THEN 'skipped' ELSE 'queued' END,
        CASE WHEN NULLIF(btrim(cert.volunteer_email),'') IS NULL OR NULLIF(btrim(cert.volunteer_name),'') IS NULL THEN now() END,
        CASE WHEN NULLIF(btrim(cert.volunteer_email),'') IS NULL OR NULLIF(btrim(cert.volunteer_name),'') IS NULL THEN 'recipient_missing' END
      FROM public.certificates cert WHERE cert.id=ANY(v_inserted_ids) AND cert.project_id=p_project_id
      ON CONFLICT(certificate_id,delivery_revision) DO NOTHING;
    INSERT INTO public.notifications(user_id,title,body,type,severity,action_url,displayed,read,dedupe_key)
      SELECT cert.user_id,'Your Volunteer Hours Have Been Published! 🎉',
        format('Your volunteer certificate for "%s" is now available.',v_project.title),
        'project_updates','success','/certificates/'||cert.id,false,false,'hours-publication:certificate:'||cert.id
      FROM public.certificates cert WHERE cert.id=ANY(v_inserted_ids) AND cert.project_id=p_project_id AND cert.user_id IS NOT NULL
      ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    UPDATE public.hours_publication_receipts SET
      certificate_count=(SELECT count(*) FROM public.certificates cert WHERE cert.project_id=p_project_id
        AND private.project_hours_publish_key(v_project.event_type,v_project.schedule,cert.schedule_id)=v_publish_key
        AND (cert.type='verified' OR cert.type IS NULL)),
      email_work_count=(SELECT count(*) FROM public.hours_publication_email_outbox work WHERE work.receipt_id=v_receipt.id)
      WHERE id=v_receipt.id;
  ELSE
    SELECT * INTO v_receipt FROM public.hours_publication_receipts WHERE project_id=p_project_id AND publish_key=v_publish_key;
  END IF;
  SELECT count(*) INTO v_untracked FROM unnest(v_certificate_ids) requested(id)
    WHERE NOT EXISTS(SELECT 1 FROM public.hours_publication_email_outbox work
      WHERE work.certificate_id=requested.id AND work.delivery_revision=0);
  IF v_receipt.id IS NOT NULL THEN
    -- A replay returns only the requested awards' deliveries, never the rest
    -- of the session, and reads no more of the ledger than those rows.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('deliveryId',work.id,'state',work.state,
        'payloadPrepared',work.payload_snapshot IS NOT NULL,'idempotencyKey',work.idempotency_key,
        'certificateId',cert.id,'volunteerName',cert.volunteer_name,'volunteerEmail',cert.volunteer_email,
        'eventStart',cert.event_start,'eventEnd',cert.event_end,'creditedMinutes',cert.credited_minutes,
        'attendanceRevision',cert.attendance_revision) ORDER BY cert.signup_id),'[]'::jsonb)
      INTO v_deliveries
      FROM public.hours_publication_email_outbox work
      JOIN public.certificates cert ON cert.id=work.certificate_id
      WHERE work.receipt_id=v_receipt.id AND work.delivery_revision=0 AND work.certificate_id=ANY(v_certificate_ids);
    SELECT jsonb_build_object('outcome','replayed','receiptId',receipt.id,'requestKey',receipt.request_key,
        'certificatesCreated',receipt.certificate_count,'projectTitle',v_project.title,
        'projectTimezone',v_project.project_timezone,'publicationOrigin',receipt.publication_origin,
        'deliveries',v_deliveries)
      INTO v_publication
      FROM public.hours_publication_receipts receipt WHERE receipt.id=v_receipt.id;
  END IF;
  RETURN jsonb_build_object('issued',cardinality(v_inserted_ids),'publication',COALESCE(v_publication,'null'::jsonb),
    'recoveryRequired',v_untracked>0);
END;
$$;
REVOKE ALL ON FUNCTION public.recover_supplemental_verified_certificates(uuid,text,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_supplemental_verified_certificates(uuid,text,uuid[],uuid) TO service_role;

-- Pending deliveries of an original publication, plus a corrected delivery
-- only where the private request ledger proves an organizer asked for that
-- exact receipt, the frozen certificate snapshot exists, and the receipt and
-- provider keys name the same certificate and revision. An edited certificate
-- or a higher attendance revision is not approval, and nothing here creates a
-- correction receipt, key, or request. The per-delivery claim still owns the
-- lease and the provider window; selection writes only its own two columns.
--
-- The result is an inventory, not just a batch: pendingDeliveries counts work
-- still owed after this claim and heldDeliveries counts work that will not be
-- sent automatically (an unknown provider outcome, or an unfrozen initial
-- delivery whose award was corrected afterwards). Both are counted in the
-- statement that selects and marks, over these ledgers only. An award with
-- no ledger row is never counted or enqueued.
CREATE FUNCTION public.claim_hours_publication_email_recovery(p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit,25),25),1);
  v_result jsonb;
BEGIN
  WITH ledger AS MATERIALIZED (
    -- Every unresolved delivery this job answers for, classified once.
    -- Accepted work is done, a skipped recipient was never going to be sent,
    -- and a definitive provider refusal is a settled answer.
    SELECT work.id,CASE
        WHEN work.state='unknown_outcome' THEN 'held'
        -- An initial delivery renders the award as it stands when its payload
        -- is first frozen. After a reviewed correction of this exact award,
        -- an unfrozen initial delivery would send the corrected hours under
        -- the original intent, so it waits for an explicit decision.
        WHEN work.delivery_revision=0 AND work.payload_snapshot IS NULL AND EXISTS (
          SELECT 1 FROM private.project_attendance_changes changes
          WHERE changes.signup_id=certificate.signup_id
            AND changes.result->>'certificateId'=certificate.id::text
            AND changes.old_credited_minutes IS NOT NULL
            AND changes.created_at>=certificate.created_at
            AND changes.new_revision<=certificate.attendance_revision) THEN 'held'
        WHEN work.state='processing' AND work.last_attempt_at >= v_now - interval '15 minutes' THEN 'pending'
        WHEN work.recovery_selected_at > v_now - interval '15 minutes' THEN 'pending'
        ELSE 'eligible'
      END AS disposition
    FROM public.hours_publication_email_outbox work
    JOIN public.certificates certificate ON certificate.id=work.certificate_id
    WHERE work.state IN ('queued','retryable_failure','processing','unknown_outcome')
      AND (
        (work.delivery_revision=0 AND work.certificate_snapshot IS NULL)
        OR (work.delivery_revision>0 AND work.certificate_snapshot IS NOT NULL
          AND work.idempotency_key='hours-correction:v1:certificate:'||work.certificate_id::text
            ||':revision:'||work.delivery_revision::text
          AND EXISTS (SELECT 1 FROM public.hours_publication_receipts correction
            WHERE correction.id=work.receipt_id
              AND correction.publish_key='certificate-correction:'||work.certificate_id::text
                ||':'||work.delivery_revision::text)
          AND EXISTS (SELECT 1 FROM private.corrected_certificate_delivery_requests request
            WHERE request.receipt_id=work.receipt_id))
      )
  ), due AS MATERIALIZED (
    -- The state and cooldown are repeated on the row itself so that a row
    -- another claim took after this snapshot fails the lock recheck.
    SELECT work.id FROM public.hours_publication_email_outbox work
    JOIN ledger ON ledger.id=work.id AND ledger.disposition='eligible'
    WHERE (work.state IN ('queued','retryable_failure')
        OR (work.state='processing' AND work.last_attempt_at < v_now - interval '15 minutes'))
      AND (work.recovery_selected_at IS NULL OR work.recovery_selected_at <= v_now - interval '15 minutes')
    ORDER BY work.recovery_selected_at NULLS FIRST,work.created_at,work.id
    LIMIT v_limit FOR UPDATE OF work SKIP LOCKED
  ), marked AS (
    UPDATE public.hours_publication_email_outbox work
      SET recovery_selected_at=v_now,recovery_selection_count=work.recovery_selection_count+1
    FROM due WHERE work.id=due.id
    RETURNING work.id,work.receipt_id,work.certificate_id,work.state,work.idempotency_key,
      work.payload_snapshot IS NOT NULL AS payload_prepared,work.certificate_snapshot,work.created_at
  )
  -- Eligible work this claim did not take, including rows another claim holds,
  -- stays pending. The inventory is counted; only the selected rows become JSON.
  SELECT jsonb_build_object('counted',true,
    'pendingDeliveries',(SELECT count(*) FROM ledger WHERE ledger.disposition IN ('pending','eligible'))
      -(SELECT count(*) FROM marked),
    'heldDeliveries',(SELECT count(*) FROM ledger WHERE ledger.disposition='held'),
    'groups',(SELECT COALESCE(jsonb_agg(grouped.item ORDER BY grouped.first_created,grouped.receipt_id),'[]'::jsonb)
  FROM (
    SELECT receipt.id AS receipt_id,min(marked.created_at) AS first_created,
      jsonb_build_object('projectId',receipt.project_id,'scheduleId',receipt.schedule_id,
        'publication',jsonb_build_object('outcome','replayed','receiptId',receipt.id,'requestKey',receipt.request_key,
          'certificatesCreated',receipt.certificate_count,
          -- A corrected delivery is described by its frozen snapshot, never
          -- by today's certificate or project.
          'projectTitle',COALESCE(max(marked.certificate_snapshot->>'projectTitle'),project.title),
          'projectTimezone',CASE WHEN bool_or(marked.certificate_snapshot IS NOT NULL)
            THEN max(marked.certificate_snapshot->>'projectTimezone') ELSE project.project_timezone END,
          'publicationOrigin',receipt.publication_origin,
          'deliveries',jsonb_agg(jsonb_build_object('deliveryId',marked.id,'state',marked.state,
            'payloadPrepared',marked.payload_prepared,'idempotencyKey',marked.idempotency_key,
            'certificateId',certificate.id,
            'volunteerName',CASE WHEN marked.certificate_snapshot IS NOT NULL THEN marked.certificate_snapshot->'volunteerName' ELSE to_jsonb(certificate.volunteer_name) END,
            'volunteerEmail',CASE WHEN marked.certificate_snapshot IS NOT NULL THEN marked.certificate_snapshot->'volunteerEmail' ELSE to_jsonb(certificate.volunteer_email) END,
            'eventStart',CASE WHEN marked.certificate_snapshot IS NOT NULL THEN marked.certificate_snapshot->'eventStart' ELSE to_jsonb(certificate.event_start) END,
            'eventEnd',CASE WHEN marked.certificate_snapshot IS NOT NULL THEN marked.certificate_snapshot->'eventEnd' ELSE to_jsonb(certificate.event_end) END,
            'creditedMinutes',CASE WHEN marked.certificate_snapshot IS NOT NULL THEN marked.certificate_snapshot->'creditedMinutes' ELSE to_jsonb(certificate.credited_minutes) END,
            'attendanceRevision',CASE WHEN marked.certificate_snapshot IS NOT NULL THEN marked.certificate_snapshot->'attendanceRevision' ELSE to_jsonb(certificate.attendance_revision) END
            ) ORDER BY marked.created_at,marked.id))) AS item
    FROM marked
    JOIN public.hours_publication_receipts receipt ON receipt.id=marked.receipt_id
    JOIN public.projects project ON project.id=receipt.project_id
    JOIN public.certificates certificate ON certificate.id=marked.certificate_id
    GROUP BY receipt.id,project.id
  ) grouped)) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_hours_publication_email_recovery(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_hours_publication_email_recovery(integer) TO service_role;

COMMENT ON FUNCTION public.claim_due_hours_publications(timestamptz,integer) IS
  'Service-only fair claim of at most ten complete, explicitly approved session snapshots. Held sessions are counted, never claimed.';
COMMENT ON FUNCTION public.publish_claimed_volunteer_hours_automatic(uuid,uuid,text,jsonb,text) IS
  'Service-only automatic publication of a claimed snapshot. A changed time, revision, or required row refuses the publication.';
COMMENT ON FUNCTION public.recover_supplemental_verified_certificates(uuid,text,uuid[],uuid) IS
  'Service-only supplemental award issuance with its receipt, email ledger, and notification in one transaction. Awards without a ledger are reported, not resent.';
COMMENT ON FUNCTION public.claim_hours_publication_email_recovery(integer) IS
  'Service-only claim of at most 25 pending deliveries, least recently selected first: original publications and explicitly requested corrections only.';

COMMIT;
