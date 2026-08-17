-- Turn paper-signup notifications into durable work created by the same
-- transaction that commits attendance. Provider delivery is a separate,
-- explicitly enabled worker; the scan commit never sends inline.

BEGIN;

CREATE TABLE public.paper_signup_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_batch_id uuid NOT NULL,
  source_scan_row_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  anonymous_id uuid REFERENCES public.anonymous_signups(id) ON DELETE SET NULL,
  recipient_class text NOT NULL DEFAULT 'anonymous_attendee'
    CHECK (recipient_class = 'anonymous_attendee'),
  template_key text NOT NULL DEFAULT 'paper-signup-recorded'
    CHECK (template_key = 'paper-signup-recorded'),
  topic_class text NOT NULL DEFAULT 'transactional'
    CHECK (topic_class = 'transactional'),
  recipient_email text NOT NULL CHECK (recipient_email = lower(btrim(recipient_email))),
  recipient_name text,
  anonymous_profile_token text NOT NULL,
  project_title text NOT NULL,
  organizer_name text NOT NULL,
  schedule_id text NOT NULL,
  project_timezone text NOT NULL,
  idempotency_key text NOT NULL UNIQUE
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'leased', 'sending', 'accepted', 'skipped', 'failed', 'unknown_outcome')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  provider_state text NOT NULL DEFAULT 'unsubmitted'
    CHECK (provider_state IN ('unsubmitted', 'accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'unknown')),
  safe_code text CHECK (safe_code IS NULL OR char_length(safe_code) <= 100),
  accepted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_signup_notification_outbox_lease_shape CHECK (
    (state IN ('leased', 'sending') AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state NOT IN ('leased', 'sending') AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT paper_signup_notification_outbox_acceptance_shape CHECK (
    state <> 'accepted'
    OR (provider_message_id IS NOT NULL AND accepted_at IS NOT NULL AND provider_state <> 'unsubmitted')
  )
);

CREATE INDEX paper_signup_notification_outbox_claim_idx
  ON public.paper_signup_notification_outbox (next_attempt_at, created_at)
  WHERE state = 'queued';
CREATE INDEX paper_signup_notification_outbox_provider_idx
  ON public.paper_signup_notification_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.paper_signup_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paper_signup_notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.paper_signup_notification_outbox TO service_role;

COMMENT ON TABLE public.paper_signup_notification_outbox IS
  'Service-only durable paper-signup notification work. One immutable item is created atomically for each newly-created anonymous attendance identity.';

CREATE OR REPLACE FUNCTION private.enqueue_paper_signup_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recipient public.anonymous_signups%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_batch public.project_paper_scan_batches%ROWTYPE;
  v_organizer_name text;
BEGIN
  IF NEW.outcome <> 'signup_created'
    OR NEW.committed_anonymous_id IS NULL
    OR (OLD.outcome = 'signup_created' AND OLD.committed_anonymous_id IS NOT DISTINCT FROM NEW.committed_anonymous_id)
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT v_recipient
  FROM public.anonymous_signups
  WHERE id = NEW.committed_anonymous_id;

  SELECT * INTO STRICT v_project
  FROM public.projects
  WHERE id = NEW.project_id;

  SELECT * INTO STRICT v_batch
  FROM public.project_paper_scan_batches
  WHERE id = NEW.batch_id AND project_id = NEW.project_id;

  SELECT COALESCE(NULLIF(btrim(profiles.full_name), ''), 'The project organizer')
  INTO v_organizer_name
  FROM public.profiles
  WHERE profiles.id = v_project.creator_id;

  INSERT INTO public.paper_signup_notification_outbox (
    source_batch_id,
    source_scan_row_id,
    project_id,
    anonymous_id,
    recipient_email,
    recipient_name,
    anonymous_profile_token,
    project_title,
    organizer_name,
    schedule_id,
    project_timezone,
    idempotency_key
  ) VALUES (
    NEW.batch_id,
    NEW.id,
    NEW.project_id,
    NEW.committed_anonymous_id,
    lower(btrim(v_recipient.email)),
    NULLIF(btrim(v_recipient.name), ''),
    v_recipient.token,
    v_project.title,
    COALESCE(v_organizer_name, 'The project organizer'),
    v_batch.schedule_id,
    COALESCE(NULLIF(v_project.project_timezone, ''), 'America/Los_Angeles'),
    'paper-signup-recorded/' || NEW.id::text
  )
  ON CONFLICT (source_scan_row_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_paper_signup_notification() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER project_paper_scan_rows_enqueue_notification
AFTER UPDATE OF outcome, committed_anonymous_id
ON public.project_paper_scan_rows
FOR EACH ROW
EXECUTE FUNCTION private.enqueue_paper_signup_notification();

CREATE OR REPLACE FUNCTION private.protect_paper_signup_notification_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_batch_id IS DISTINCT FROM OLD.source_batch_id
    OR NEW.source_scan_row_id IS DISTINCT FROM OLD.source_scan_row_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.anonymous_id IS DISTINCT FROM OLD.anonymous_id
    OR NEW.recipient_class IS DISTINCT FROM OLD.recipient_class
    OR NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.topic_class IS DISTINCT FROM OLD.topic_class
    OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
    OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
    OR NEW.anonymous_profile_token IS DISTINCT FROM OLD.anonymous_profile_token
    OR NEW.project_title IS DISTINCT FROM OLD.project_title
    OR NEW.organizer_name IS DISTINCT FROM OLD.organizer_name
    OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
    OR NEW.project_timezone IS DISTINCT FROM OLD.project_timezone
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'paper signup notification identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_paper_signup_notification_identity() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER paper_signup_notification_identity_immutable
BEFORE UPDATE ON public.paper_signup_notification_outbox
FOR EACH ROW
EXECUTE FUNCTION private.protect_paper_signup_notification_identity();

CREATE OR REPLACE FUNCTION public.claim_paper_signup_notifications(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.paper_signup_notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR char_length(p_worker_id) > 200
    OR p_limit NOT BETWEEN 1 AND 50
    OR p_lease_seconds NOT BETWEEN 30 AND 300
  THEN
    RAISE EXCEPTION 'invalid paper signup notification claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM public.paper_signup_notification_outbox AS outbox
    WHERE outbox.state = 'queued'
      AND outbox.attempts < 3
      AND outbox.next_attempt_at <= now()
    ORDER BY outbox.next_attempt_at, outbox.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.paper_signup_notification_outbox AS outbox
  SET state = 'leased',
      lease_owner = p_worker_id,
      lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  FROM candidates
  WHERE outbox.id = candidates.id
  RETURNING outbox.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_paper_signup_notification_dispatch(
  p_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt integer;
BEGIN
  UPDATE public.paper_signup_notification_outbox AS outbox
  SET state = 'sending', attempts = attempts + 1, updated_at = now()
  WHERE outbox.id = p_id
    AND outbox.state = 'leased'
    AND outbox.lease_owner = p_worker_id
    AND outbox.lease_token = p_lease_token
    AND outbox.lease_expires_at > now()
  RETURNING attempts INTO v_attempt;

  IF v_attempt IS NULL THEN
    RAISE EXCEPTION 'paper signup notification lease is not dispatchable';
  END IF;
  RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_paper_signup_notification(
  p_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_safe_code text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.paper_signup_notification_outbox%ROWTYPE;
  v_state text;
BEGIN
  SELECT * INTO STRICT v_row
  FROM public.paper_signup_notification_outbox AS outbox
  WHERE outbox.id = p_id
    AND outbox.state IN ('leased', 'sending')
    AND outbox.lease_owner = p_worker_id
    AND outbox.lease_token = p_lease_token
  FOR UPDATE;

  IF p_outcome = 'accepted' AND NULLIF(btrim(COALESCE(p_provider_message_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'accepted notification requires a provider message id';
  END IF;

  v_state := CASE p_outcome
    WHEN 'accepted' THEN 'accepted'
    WHEN 'skipped' THEN 'skipped'
    WHEN 'unknown_outcome' THEN 'unknown_outcome'
    WHEN 'definitive_failure' THEN 'failed'
    WHEN 'retryable_pre_send' THEN CASE WHEN v_row.attempts < 3 THEN 'queued' ELSE 'failed' END
    ELSE NULL
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'invalid paper signup notification outcome';
  END IF;

  UPDATE public.paper_signup_notification_outbox
  SET state = v_state,
      next_attempt_at = CASE
        WHEN v_state = 'queued' THEN now() + make_interval(secs => (30 * power(2, GREATEST(v_row.attempts - 1, 0)))::integer)
        ELSE next_attempt_at
      END,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      provider_message_id = CASE WHEN v_state = 'accepted' THEN p_provider_message_id ELSE provider_message_id END,
      provider_state = CASE WHEN v_state = 'accepted' THEN 'accepted' WHEN v_state = 'unknown_outcome' THEN 'unknown' ELSE provider_state END,
      safe_code = NULLIF(btrim(COALESCE(p_safe_code, '')), ''),
      accepted_at = CASE WHEN v_state = 'accepted' THEN now() ELSE accepted_at END,
      settled_at = CASE WHEN v_state = 'queued' THEN NULL ELSE now() END,
      updated_at = now()
  WHERE id = p_id;

  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_paper_signup_notification_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.paper_signup_notification_outbox
  SET state = CASE WHEN state = 'leased' THEN 'queued' ELSE 'unknown_outcome' END,
      next_attempt_at = CASE WHEN state = 'leased' THEN now() ELSE next_attempt_at END,
      provider_state = CASE WHEN state = 'sending' THEN 'unknown' ELSE provider_state END,
      safe_code = CASE WHEN state = 'sending' THEN 'expired_dispatch_lease' ELSE 'expired_pre_send_lease' END,
      settled_at = CASE WHEN state = 'sending' THEN now() ELSE NULL END,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE state IN ('leased', 'sending')
    AND lease_expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_paper_signup_notifications(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_paper_signup_notification_dispatch(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_paper_signup_notification(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_paper_signup_notification_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paper_signup_notifications(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_paper_signup_notification_dispatch(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_paper_signup_notification(uuid, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_paper_signup_notification_leases() TO service_role;

COMMIT;
