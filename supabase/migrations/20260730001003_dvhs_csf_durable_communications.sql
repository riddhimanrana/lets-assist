-- DVHS CSF durable communications (additive).
--
-- 20260730001001 created the CSF campaign / audience-snapshot / delivery /
-- provider-event foundation. This migration turns that foundation into a
-- dispatch-safe, server-only, durable communications ledger. It deliberately
-- extends the existing tables instead of introducing a second CSF
-- communications domain model: no new campaign table, no new audience table,
-- no new delivery table.
--
-- What is added:
--   * campaign body/identity that can restart a send with no provider state,
--     editable as a draft until an explicit content-finalization transition,
--   * organization- and topic-scoped broadcast preferences that also work for
--     accountless recipient addresses,
--   * a SEPARATE organization- and address-scoped provider-safety projection,
--     because a bounce is not a preference and applies to transactional mail too,
--   * dispatch provenance on every audience snapshot row,
--   * a separate attempt ledger with leases, monotonic attempt numbers, and
--     coordinate-bound provider idempotency keys derived from the complete
--     canonical provider request,
--   * signature-verification metadata plus a conservative, monotonic reduction
--     state machine for out-of-order provider webhooks, resolved through ONE
--     shared primitive,
--   * atomic SECURITY DEFINER RPCs for content finalization, snapshot, audience
--     finalization, claim, immediately-before-dispatch authorization, settle,
--     lease reaping, webhook recording and rebind, unknown-outcome
--     reconciliation, campaign terminalization, and teardown.
--
-- A LEASE IS NOT AUTHORIZATION, AND A LAPSED LEASE IS NOT A RETRY
-- ---------------------------------------------------------------
-- Two rules carry most of the duplicate-send safety here.
--
-- First, claiming a lease hands back attempt coordinates, never a sendable
-- payload. A lease can last 1800 seconds and a recipient can opt out or bounce
-- inside it, so a worker must call
-- plugin_data.csf_authorize_communication_dispatch() immediately before it talks
-- to the provider; that call rechecks consent AND address safety and returns the
-- exact request whose digest the ledger already stored.
--
-- Second, a lapsed lease NEVER returns to the queue. A worker can hand the exact
-- request to Resend and die before settling, and from this side that is
-- indistinguishable from dying before it opened the socket. So lease expiry
-- settles as 'unknown_outcome' with review evidence -- honest, unretryable, and
-- visible -- rather than silently mailing somebody a second time.
--
-- MANDATORY TRANSACTIONAL VERSUS BROADCAST UNSUBSCRIBE
-- ----------------------------------------------------
-- A broadcast is anything a recipient may refuse: newsletters, reminders,
-- partner-club campaign blasts. A transactional message is one the recipient
-- asked for by acting -- an account link, an application decision, a proof
-- rejection. Transactional delivery is MANDATORY: no broadcast opt-out row can
-- suppress it. That is enforced three ways, not by convention:
--   1. plugin_data.csf_communication_broadcast_preferences rejects the reserved
--      'transactional' topic key outright, so no preference row can even name it,
--   2. plugin_data.csf_communication_preference_decision() returns
--      'mandatory_transactional' for a transactional requirement without ever
--      reading the preference table, and
--   3. a CHECK on the audience snapshot forbids a transactional recipient from
--      carrying an 'unsubscribed' or 'suppressed' exclusion reason.
--
-- UNKNOWN OUTCOME SAFETY
-- ----------------------
-- A send whose provider result is genuinely unknown (timeout, connection reset,
-- ambiguous 5xx after the request may already have been accepted) is NOT a
-- retryable failure. Retrying it can double-send. Such an attempt settles as
-- 'unknown_outcome', is forced into human review, and the attempt-ledger state
-- machine refuses every transition back to 'queued' or 'processing'. The only
-- ways out are reconciliation against real provider evidence or an explicit
-- human-review resolution.
--
-- SERVER-ONLY BOUNDARY
-- --------------------
-- Every table here is server-only: RLS enabled with no policies, all privileges
-- revoked from PUBLIC/anon/authenticated, and service_role granted exactly
-- SELECT -- never INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER.
-- Consequential writes go through the SECURITY DEFINER RPCs, which run as the
-- ledger owner and need no grant at all. Every function pins an empty
-- search_path, and every SECURITY DEFINER RPC is executable by service_role
-- alone. No browser role can read a recipient address, a preference row, a
-- lease, or a provider event.
--
-- These tables use uuid primary keys and no serial/identity columns, so this
-- migration creates no sequence and therefore grants no sequence privileges.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Shared immutable helpers
--
-- Defined first because the preflight below and several CHECK constraints call
-- them. A CHECK expression is evaluated with the privileges of the role
-- performing the write, and after section J's convergence that role is always
-- the ledger owner: every legitimate write arrives through a SECURITY DEFINER
-- RPC, for which EXECUTE is implicit and no grant is needed at all.
--
-- Each helper is nonetheless revoked from every client role and granted to
-- service_role, because the server calls the decision, hashing, and
-- classification helpers directly on the READ side. EXECUTE on a function is not
-- a privilege to write a table: service_role holds no INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, or TRIGGER on any table in this migration.
-- ---------------------------------------------------------------------------

-- Strict allowlist for provider webhook metadata. The 20260730001001 sanitizer
-- is a denylist: it proves a document does not obviously carry message content.
-- This is the complementary positive rule required of provider evidence -- only
-- named, scalar, bounded operational fields may be stored at all. Keys are
-- compared with punctuation and case removed, so smtpCode, smtp_code, and
-- SMTP-CODE are the same allowlisted name.
--
-- A key allowlist alone still lets an attacker park megabytes under an
-- allowlisted name, so every dimension is bounded: total encoded size, key
-- count, array length, string length, and numeric magnitude.
CREATE OR REPLACE FUNCTION plugin_data.csf_provider_event_metadata_allowlisted(
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_allowed constant text[] := ARRAY[
    'smtpcode', 'smtpstatuscode', 'statuscode', 'errorcode', 'errorname',
    'bouncetype', 'bouncesubtype', 'bounceclassification',
    'complainttype', 'complaintsubtype', 'feedbacktype',
    'delayreason', 'suppressionreason', 'reasoncode', 'retryable',
    'recipienthash', 'tohash', 'fromhash', 'domainhash', 'linkhosthash',
    'iphash', 'useragenthash',
    'tags', 'topickey', 'attemptnumber', 'providerregion', 'emailid',
    'broadcastid'
  ];
  c_max_total_bytes constant integer := 2048;
  c_max_keys constant integer := 24;
  c_max_array_items constant integer := 16;
  c_max_scalar_length constant integer := 200;
  c_max_numeric_magnitude constant numeric := 1e12;
  v_entry record;
  v_element jsonb;
  v_key_count integer := 0;
  v_array_items integer;
BEGIN
  IF p_metadata IS NULL THEN
    RETURN true;
  END IF;

  IF pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN false;
  END IF;

  -- Total encoded size first: it is the one bound that caps every other
  -- dimension at once, including deeply repeated small values.
  IF pg_catalog.octet_length(p_metadata::text) > c_max_total_bytes THEN
    RETURN false;
  END IF;

  FOR v_entry IN
    SELECT entry.key, entry.value FROM pg_catalog.jsonb_each(p_metadata) AS entry
  LOOP
    v_key_count := v_key_count + 1;
    IF v_key_count > c_max_keys THEN
      RETURN false;
    END IF;

    IF pg_catalog.char_length(v_entry.key) > 64 THEN
      RETURN false;
    END IF;

    IF pg_catalog.regexp_replace(pg_catalog.lower(v_entry.key), '[^a-z0-9]', '', 'g')
      <> ALL (c_allowed)
    THEN
      RETURN false;
    END IF;

    -- Nested objects are how a raw body sneaks past a key-name rule, so an
    -- allowlisted key may hold a scalar or a flat array of scalars and nothing
    -- else.
    IF pg_catalog.jsonb_typeof(v_entry.value) = 'object' THEN
      RETURN false;
    ELSIF pg_catalog.jsonb_typeof(v_entry.value) = 'array' THEN
      SELECT pg_catalog.jsonb_array_length(v_entry.value) INTO v_array_items;
      IF v_array_items > c_max_array_items THEN
        RETURN false;
      END IF;

      FOR v_element IN
        SELECT element.value
        FROM pg_catalog.jsonb_array_elements(v_entry.value) AS element(value)
      LOOP
        IF pg_catalog.jsonb_typeof(v_element) IN ('object', 'array') THEN
          RETURN false;
        END IF;

        IF pg_catalog.jsonb_typeof(v_element) = 'string'
          AND pg_catalog.char_length(v_element #>> '{}') > c_max_scalar_length
        THEN
          RETURN false;
        END IF;

        IF pg_catalog.jsonb_typeof(v_element) = 'number'
          AND pg_catalog.abs((v_element #>> '{}')::numeric) > c_max_numeric_magnitude
        THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSIF pg_catalog.jsonb_typeof(v_entry.value) = 'string'
      AND pg_catalog.char_length(v_entry.value #>> '{}') > c_max_scalar_length
    THEN
      RETURN false;
    ELSIF pg_catalog.jsonb_typeof(v_entry.value) = 'number'
      AND pg_catalog.abs((v_entry.value #>> '{}')::numeric) > c_max_numeric_magnitude
    THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_provider_event_metadata_allowlisted(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_provider_event_metadata_allowlisted(jsonb)
  TO service_role;

-- Severity ordering for delivery truth. Reduction is monotonic in this rank: a
-- provider event may only move a delivery to a strictly higher rank. The three
-- safety states outrank every success state on purpose, so no late or
-- out-of-order 'sent'/'delivered' event can downgrade a recorded bounce,
-- complaint, or suppression. NULL means "not a state this reducer understands",
-- which the reducer treats as "retain the event, change nothing".
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_delivery_state_rank(
  p_status text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_status
    WHEN 'queued' THEN 0
    WHEN 'sent' THEN 10
    WHEN 'delivered' THEN 20
    WHEN 'failed' THEN 30
    WHEN 'suppressed' THEN 40
    WHEN 'bounced' THEN 50
    WHEN 'complained' THEN 60
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_delivery_state_rank(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_delivery_state_rank(text)
  TO service_role;

-- Mirrors the transition table already enforced by
-- plugin_data.csf_enforce_delivery_lifecycle(). The reducer consults this
-- before writing so a contradictory provider event (a bounce reported after a
-- delivered event, say) is retained and escalated for review instead of raising
-- inside a webhook handler.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_delivery_transition_allowed(
  p_from text,
  p_to text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_from = p_to THEN true
    WHEN p_from = 'queued'
      AND p_to IN ('sent', 'bounced', 'suppressed', 'failed') THEN true
    -- 'suppressed' from 'sent' is deliberate and was previously missing from BOTH
    -- transition authorities while csf_communication_event_target_status() already
    -- mapped email.suppressed to it. The result was that Resend's own suppression
    -- signal -- the provider telling us it refused to keep delivering to this
    -- address -- landed as ignored_conflict on any delivery that had reached
    -- 'sent', which is every real send. The single most actionable safety event we
    -- receive was being parked in a review queue instead of acted on.
    WHEN p_from = 'sent'
      AND p_to IN ('delivered', 'bounced', 'complained', 'suppressed', 'failed')
      THEN true
    WHEN p_from = 'delivered' AND p_to IN ('complained', 'suppressed') THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_delivery_transition_allowed(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_delivery_transition_allowed(text, text)
  TO service_role;

-- Provider event type to delivery truth. Anything not named here -- an engagement
-- event, a provider type that did not exist when this shipped, a typo -- maps to
-- NULL, which means the event row is kept as evidence and no delivery state is
-- touched.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_event_target_status(
  p_event_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE pg_catalog.lower(pg_catalog.btrim(coalesce(p_event_type, '')))
    WHEN 'email.sent' THEN 'sent'
    WHEN 'email.delivered' THEN 'delivered'
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained'
    WHEN 'email.failed' THEN 'failed'
    WHEN 'email.suppressed' THEN 'suppressed'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_event_target_status(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_event_target_status(text)
  TO service_role;

-- One definition of a storable address, used by every new CHECK and by the
-- snapshot RPC. Deliberately conservative: no whitespace anywhere, exactly one
-- '@' with content on both sides, and a length the provider will accept.
--
-- POSITION(x IN y) is grammar, not a callable function, so it cannot be
-- schema-qualified. Under SET search_path = '' the only safe spelling of that
-- operation is pg_catalog.strpos(string, substring).
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_email_is_storable(
  p_email text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_email IS NOT NULL
    AND p_email = pg_catalog.btrim(p_email)
    AND p_email !~ '\s'
    AND pg_catalog.char_length(p_email) BETWEEN 3 AND 320
    AND (
      pg_catalog.length(p_email)
      - pg_catalog.length(pg_catalog.replace(p_email, '@', ''))
    ) = 1
    AND pg_catalog.strpos(p_email, '@') > 1
    AND pg_catalog.strpos(p_email, '@') < pg_catalog.char_length(p_email);
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_email_is_storable(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_email_is_storable(text)
  TO service_role;

-- The single reduction decision.
--
-- Both the webhook recorder and the unmatched-evidence rebind path consult this
-- one function, so the two can never drift into disagreeing about whether an
-- event is authoritative. It decides only; it writes nothing.
--
-- Two rules carry the weight:
--   * No real provider time, no authority. An event the provider did not
--     timestamp cannot be ordered against what is already recorded, so it is
--     retained and ignored.
--   * A safety signal (bounce, complaint, suppression) is never dropped for
--     being late. It either advances the delivery to a terminal safety state or
--     is escalated as a conflict -- never silently discarded the way an
--     out-of-order success is.
CREATE OR REPLACE FUNCTION plugin_data.csf_comm_reduction_decision(
  p_event_type text,
  p_provider_occurred_at timestamptz,
  p_delivery_matched boolean,
  p_delivery_status text,
  p_terminal_locked boolean,
  p_last_provider_event_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_target text := plugin_data.csf_communication_event_target_status(p_event_type);
  v_is_safety boolean;
  v_current_rank integer;
  v_target_rank integer;
BEGIN
  IF v_target IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'ignored_unknown_type',
      'applied', false,
      'target', NULL,
      'isSafety', false,
      'needsSentStep', false,
      'reason', 'unrecognized provider event type retained as evidence'
    );
  END IF;

  v_is_safety := v_target IN ('bounced', 'complained', 'suppressed');

  IF NOT coalesce(p_delivery_matched, false) THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'unmatched',
      'applied', false,
      'target', v_target,
      'isSafety', v_is_safety,
      'needsSentStep', false,
      'reason', 'no delivery reports that provider message yet'
    );
  END IF;

  IF p_provider_occurred_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'ignored_no_provider_time',
      'applied', false,
      'target', v_target,
      'isSafety', v_is_safety,
      'needsSentStep', false,
      'reason', 'provider reported no occurrence time, so this event is not authoritative'
    );
  END IF;

  v_current_rank := plugin_data.csf_communication_delivery_state_rank(p_delivery_status);
  v_target_rank := plugin_data.csf_communication_delivery_state_rank(v_target);

  IF v_is_safety THEN
    IF v_target_rank <= v_current_rank THEN
      RETURN pg_catalog.jsonb_build_object(
        'processingState', 'ignored_stale',
        'applied', false,
        'target', v_target,
        'isSafety', true,
        'needsSentStep', false,
        'reason', 'an equal or stronger safety state is already recorded'
      );
    END IF;

    IF plugin_data.csf_communication_delivery_transition_allowed(
      p_delivery_status, v_target
    ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'processingState', 'reduced',
        'applied', true,
        'target', v_target,
        'isSafety', true,
        'needsSentStep', false,
        'reason', NULL
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'ignored_conflict',
      'applied', false,
      'target', v_target,
      'isSafety', true,
      'needsSentStep', false,
      'reason', 'safety signal contradicts recorded delivery truth and needs review'
    );
  END IF;

  IF coalesce(p_terminal_locked, false) THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'ignored_terminal',
      'applied', false,
      'target', v_target,
      'isSafety', false,
      'needsSentStep', false,
      'reason', 'delivery holds a terminal safety state; a later success event cannot downgrade it'
    );
  END IF;

  IF p_last_provider_event_at IS NOT NULL
    AND p_provider_occurred_at < p_last_provider_event_at
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'ignored_stale',
      'applied', false,
      'target', v_target,
      'isSafety', false,
      'needsSentStep', false,
      'reason', 'provider event is older than the last observed event for this delivery'
    );
  END IF;

  IF v_target_rank <= v_current_rank THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'ignored_stale',
      'applied', false,
      'target', v_target,
      'isSafety', false,
      'needsSentStep', false,
      'reason', 'delivery already holds an equal or stronger outcome'
    );
  END IF;

  IF plugin_data.csf_communication_delivery_transition_allowed(
    p_delivery_status, v_target
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'reduced',
      'applied', true,
      'target', v_target,
      'isSafety', false,
      'needsSentStep', false,
      'reason', NULL
    );
  END IF;

  -- Resend can report delivery (or a complaint) before its own sent webhook
  -- lands. Walk the state machine rather than skipping a step.
  IF plugin_data.csf_communication_delivery_transition_allowed(p_delivery_status, 'sent')
    AND plugin_data.csf_communication_delivery_transition_allowed('sent', v_target)
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'processingState', 'reduced',
      'applied', true,
      'target', v_target,
      'isSafety', false,
      'needsSentStep', true,
      'reason', NULL
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'processingState', 'ignored_conflict',
    'applied', false,
    'target', v_target,
    'isSafety', false,
    'needsSentStep', false,
    'reason', 'provider event contradicts recorded delivery truth'
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_comm_reduction_decision(
  text, timestamptz, boolean, text, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_comm_reduction_decision(
  text, timestamptz, boolean, text, boolean, timestamptz
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_comm_reduction_decision(
  text, timestamptz, boolean, text, boolean, timestamptz
) IS
  'The single decision for what a provider webhook may do to delivery truth, shared by the recording and rebind paths. An event with no provider occurrence time is never authoritative, and a bounce/complaint/suppression is never discarded for arriving late -- it reduces or escalates.';

-- Server-derived campaign content digest.
--
-- A caller-supplied hash is an assertion, not proof: nothing stops a client
-- from sending a digest that does not describe the body it also sent. This
-- function is the only definition of a campaign's content identity, and a
-- trigger overwrites whatever the caller supplied with this value. jsonb sorts
-- object keys, so the serialization is canonical.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_campaign_content_hash(
  p_campaign_kind text,
  p_channel text,
  p_sender_name text,
  p_sender_email text,
  p_reply_to_email text,
  p_subject text,
  p_body_text text,
  p_body_html text,
  p_body_metadata jsonb,
  p_topic_key text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'v', 1,
        'campaignKind', p_campaign_kind,
        'channel', p_channel,
        'senderName', p_sender_name,
        'senderEmail', pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email, ''))),
        'replyToEmail', pg_catalog.lower(pg_catalog.btrim(coalesce(p_reply_to_email, ''))),
        'subject', p_subject,
        'bodyText', p_body_text,
        'bodyHtml', p_body_html,
        'bodyMetadata', coalesce(p_body_metadata, '{}'::jsonb),
        'topicKey', p_topic_key
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_campaign_content_hash(
  text, text, text, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_campaign_content_hash(
  text, text, text, text, text, text, text, text, jsonb, text
) TO service_role;

-- Provider tag values are a constrained alphabet: Resend accepts ASCII letters,
-- digits, underscores, and dashes in a tag name or value and nothing else. The
-- routing tags this migration signs into every send therefore pass through this
-- normalizer, and because the SAME normalizer feeds the canonical request
-- document that the payload hash covers, the stored hash describes the tags
-- that will actually be transmitted rather than an idealized version of them.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_tag_value(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE pg_catalog.left(
      pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '[^A-Za-z0-9_-]', '_', 'g'),
      240
    )
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_tag_value(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_tag_value(text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_communication_tag_value(text) IS
  'Normalizes one provider tag value to the alphabet Resend accepts. The canonical request document hashes the normalized value, so the stored payload digest describes the bytes that will actually be transmitted.';

-- Address-safety severity, so a later observation can tighten a block but never
-- loosen one. An expiring hold may become a review hold or an indefinite
-- suppression; the reverse is how a soft bounce arriving after a hard one would
-- quietly unblock a dead mailbox.
CREATE OR REPLACE FUNCTION plugin_data.csf_comm_safety_kind_rank(p_kind text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'expiring' THEN 10
    WHEN 'review_required' THEN 20
    WHEN 'indefinite' THEN 30
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_comm_safety_kind_rank(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_comm_safety_kind_rank(text)
  TO service_role;

-- Resend's bounce vocabulary mapped to what we are allowed to do about it.
--
-- 'Permanent'/'HardBounce' means the mailbox does not exist: suppress
-- indefinitely. 'Transient'/'SoftBounce' means it exists but could not accept the
-- message right now -- full, greylisted, temporarily deferred -- so it earns a
-- delivery HOLD that lapses rather than a permanent block. 'Undetermined' means
-- the provider itself could not tell, and guessing either way is worse than
-- asking a human.
CREATE OR REPLACE FUNCTION plugin_data.csf_comm_bounce_class(p_bounce_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_bounce_type, ''))), '[^a-z]', '', 'g'
    ) IN ('permanent', 'hardbounce', 'hard', 'permanentfailure')
      THEN 'permanent'
    WHEN pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_bounce_type, ''))), '[^a-z]', '', 'g'
    ) IN ('transient', 'softbounce', 'soft', 'temporaryfailure', 'delayed')
      THEN 'transient'
    ELSE 'undetermined'
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_comm_bounce_class(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_comm_bounce_class(text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_comm_safety_kind_rank(text) IS
  'Severity order for address-safety blocks: expiring hold < review hold < indefinite suppression. Blocks tighten and never loosen, so a soft bounce arriving after a hard one cannot unblock a dead mailbox.';
COMMENT ON FUNCTION plugin_data.csf_comm_bounce_class(text) IS
  'Maps a Resend bounce type to permanent, transient, or undetermined, comparing with case and punctuation removed. A permanent bounce suppresses indefinitely, a transient one earns an expiring delivery hold, and an undetermined one goes to a human rather than being guessed either way.';

-- Review state is monotonic: an attempt or delivery under review never quietly
-- returns to an earlier stage.
CREATE OR REPLACE FUNCTION plugin_data.csf_comm_review_state_rank(p_state text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_state
    WHEN 'none' THEN 0
    WHEN 'pending' THEN 1
    WHEN 'escalated' THEN 2
    WHEN 'resolved' THEN 3
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_comm_review_state_rank(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_comm_review_state_rank(text)
  TO service_role;

-- Teardown authority that a service role cannot forge.
--
-- 20260730001001's csf_recovery_teardown_authorized() reads a transaction-local
-- GUC, and any role able to run set_config can set it. That was acceptable when
-- service_role also held DELETE; it is not a boundary on its own. This helper
-- additionally requires that the deleting role IS the table owner, which is
-- true only inside a SECURITY DEFINER purge function and never true for a
-- direct service_role statement.
CREATE OR REPLACE FUNCTION plugin_data.csf_comm_teardown_authorized(
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  -- to_regclass resolves at run time. A literal ::regclass would bind at CREATE
  -- time and this helper is defined before the ledger table exists.
  SELECT coalesce(
    plugin_data.csf_recovery_teardown_authorized(p_organization_id)
      AND CURRENT_USER::text = (
        SELECT pg_catalog.pg_get_userbyid(class.relowner)
        FROM pg_catalog.pg_class AS class
        WHERE class.oid = pg_catalog.to_regclass(
          'plugin_data.csf_communication_dispatch_attempts'
        )
      ),
    false
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_comm_teardown_authorized(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_comm_teardown_authorized(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_communication_campaign_content_hash(
  text, text, text, text, text, text, text, text, jsonb, text
) IS
  'The only definition of a CSF campaign content identity. A trigger overwrites any caller-supplied content_hash with this server-derived value, so a declared digest is never taken as proof.';
COMMENT ON FUNCTION plugin_data.csf_comm_teardown_authorized(uuid) IS
  'Teardown authority that a service role cannot forge: requires both the transaction-local purge flag AND that the deleting role is the ledger owner, which only holds inside the SECURITY DEFINER purge entry point.';

COMMENT ON FUNCTION plugin_data.csf_provider_event_metadata_allowlisted(jsonb) IS
  'True only when provider webhook metadata is a flat object of allowlisted, scalar, bounded operational fields. Complements the 20260730001001 raw-content denylist with a positive rule.';
COMMENT ON FUNCTION plugin_data.csf_communication_delivery_state_rank(text) IS
  'Monotonic severity rank for delivery truth. Bounce, complaint, and suppression outrank sent and delivered so a late provider event can never downgrade a terminal safety state.';
COMMENT ON FUNCTION plugin_data.csf_communication_delivery_transition_allowed(text, text) IS
  'Mirrors the delivery lifecycle trigger transition table so the webhook reducer can retain and escalate a contradictory event instead of raising inside a webhook handler.';
COMMENT ON FUNCTION plugin_data.csf_communication_event_target_status(text) IS
  'Maps a known provider event type to delivery truth. An unknown type maps to NULL: the event is retained as evidence and mutates nothing.';
COMMENT ON FUNCTION plugin_data.csf_communication_email_is_storable(text) IS
  'Single definition of a storable recipient address: trimmed, whitespace-free, exactly one @ with content on both sides, bounded length.';

-- ---------------------------------------------------------------------------
-- B. Preflight
--
-- Two of the rules below tighten tables that may already hold rows. Each is
-- checked first so a deployment that cannot satisfy it fails with an actionable
-- message naming the offending row instead of an opaque constraint violation.
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_row record;
BEGIN
  -- The reduction engine refuses to guess about a delivery state it does not
  -- rank. If a future status is ever added to the delivery CHECK without
  -- teaching the rank function about it, this fails loudly here rather than
  -- silently ignoring webhooks for those rows in production.
  SELECT delivery.id, delivery.organization_id, delivery.status
  INTO v_row
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE plugin_data.csf_communication_delivery_state_rank(delivery.status) IS NULL
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF durable communications preflight failed: delivery % in organization % holds status "%", which plugin_data.csf_communication_delivery_state_rank() does not rank. Teach the rank function that status before applying this migration.',
      v_row.id, v_row.organization_id, v_row.status
      USING ERRCODE = '23514';
  END IF;

  -- The provider metadata allowlist is applied to the existing evidence table.
  SELECT provider_event.id, provider_event.organization_id, provider_event.provider_event_id
  INTO v_row
  FROM plugin_data.csf_communication_provider_events AS provider_event
  WHERE NOT plugin_data.csf_provider_event_metadata_allowlisted(provider_event.metadata)
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF durable communications preflight failed: provider event % in organization % (envelope "%") stores metadata outside the operational allowlist. Reduce that row to allowlisted scalar fields before applying this migration.',
      v_row.id, v_row.organization_id, v_row.provider_event_id
      USING ERRCODE = '23514';
  END IF;

  -- Existing recipient addresses must satisfy the shared storable-address rule
  -- before it becomes a constraint on the preferences table and on every
  -- dispatch-managed snapshot row.
  SELECT snapshot.id, snapshot.organization_id
  INTO v_row
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE NOT plugin_data.csf_communication_email_is_storable(
    pg_catalog.lower(pg_catalog.btrim(snapshot.recipient_email))
  )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF durable communications preflight failed: audience snapshot % in organization % stores a recipient address that is not a single, whitespace-free, bounded mailbox. Repair that row before applying this migration.',
      v_row.id, v_row.organization_id
      USING ERRCODE = '23514';
  END IF;

  -- CROSS-TENANT PROVIDER MESSAGE DUPLICATES, CENSUSED BEFORE THE DDL.
  --
  -- 20260730001001 made provider_message_id unique only per organization, so two
  -- organizations were free to record the same Resend message id. Section F below
  -- promotes that to a GLOBAL unique index, which is what lets a webhook resolve
  -- to exactly one delivery instead of resolving differently depending on which
  -- tenant the caller claimed.
  --
  -- Without this census the promotion fails as a bare
  -- "could not create unique index ... Key (provider_message_id)=(...) is
  -- duplicated" -- which names one value, no organizations, and no rows, leaving
  -- an operator to reverse-engineer a tenant-crossing data problem from a single
  -- string at 2am. Fail here instead, with the coordinates needed to act.
  SELECT
    duplicate.provider_message_id AS id,
    duplicate.organization_ids AS organization_id,
    duplicate.delivery_ids AS status
  INTO v_row
  FROM (
    SELECT
      delivery.provider_message_id,
      pg_catalog.string_agg(
        DISTINCT delivery.organization_id::text, ', ' ORDER BY delivery.organization_id::text
      ) AS organization_ids,
      pg_catalog.string_agg(
        delivery.id::text, ', ' ORDER BY delivery.id::text
      ) AS delivery_ids,
      count(*) AS occurrences
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.provider_message_id IS NOT NULL
    GROUP BY delivery.provider_message_id
    HAVING count(*) > 1
    ORDER BY count(*) DESC, delivery.provider_message_id
    LIMIT 1
  ) AS duplicate;

  IF FOUND THEN
    RAISE EXCEPTION
      'CSF durable communications preflight failed: provider message "%" is recorded by more than one delivery (deliveries %; organizations %). A Resend message identity comes from one shared account and must name exactly one delivery, so this migration promotes it to a globally unique index. Reconcile those rows -- keep the delivery that genuinely sent that message and clear provider_message_id on the others -- before applying this migration.',
      v_row.id, v_row.status, v_row.organization_id
      USING ERRCODE = '23505';
  END IF;

  -- Legacy campaign accounting happens after the columns exist; see the census
  -- immediately below the campaign ALTER.
END
$preflight$;

-- ---------------------------------------------------------------------------
-- C. Campaign body and identity that can restart without provider state
--
-- Everything needed to rebuild and resend a campaign byte-for-byte lives on the
-- campaign row: subject, plain-text body, optional sanitized HTML, body
-- metadata, a stable content hash, the audience/topic it addressed, the term it
-- belongs to, and the exact creator identity. Nothing here reads back from
-- Resend.
--
-- The columns are nullable and the DVHS identity rule is conditional on
-- content_hash for one reason: campaigns recorded before this migration are
-- real history and must keep it. A campaign becomes "dispatch-ready" the moment
-- it records a content hash, and from that moment the full identity rule binds.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_communication_campaigns
  ADD COLUMN body_text text,
  ADD COLUMN body_html text,
  ADD COLUMN body_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN content_hash text,
  ADD COLUMN term_id uuid,
  ADD COLUMN audience_kind text,
  ADD COLUMN broadcast_topic_key text,
  ADD COLUMN created_by_identity text,
  ADD COLUMN audience_finalized_at timestamptz,
  ADD COLUMN audience_digest text,
  ADD COLUMN audience_size integer,
  ADD COLUMN dispatch_started_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text,
  -- A NON-EMPTY DRAFT BODY IS NOT PUBLICATION.
  --
  -- Everything above stays editable while a campaign is being written. Dispatch
  -- content identity is derived and frozen only when an officer explicitly says
  -- the copy is ready, which is what this timestamp records. Before it is set
  -- the campaign has no content_hash and is therefore not dispatch-ready; after
  -- it is set the sender, subject, bodies, metadata, topic, term, and audience
  -- kind freeze together.
  ADD COLUMN content_finalized_at timestamptz,
  ADD COLUMN content_finalized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN content_finalized_by_identity text,
  ADD COLUMN cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN cancelled_by_identity text,
  ADD COLUMN correlation_id text,
  -- Set when unknown provider outcomes exist. A review-blocked campaign is
  -- visibly nonterminal: the terminalization guard refuses to settle it and an
  -- operator can see why without reading the attempt ledger.
  ADD COLUMN review_blocked_at timestamptz,
  ADD COLUMN review_blocked_reason text;

ALTER TABLE plugin_data.csf_communication_campaigns
  -- The term a campaign belongs to, scoped so organization A can never file a
  -- campaign under organization B's semester.
  --
  -- RESTRICT, not SET NULL. A dispatch-ready campaign must name a term, so
  -- ON DELETE SET NULL would either violate that CHECK or silently sever the
  -- semester a send belongs to. Term history is durable: retire the campaign
  -- through the purge entry point before retiring the term.
  ADD CONSTRAINT csf_communication_campaigns_term_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT csf_communication_campaigns_content_hash_check
    CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT csf_communication_campaigns_audience_digest_check
    CHECK (audience_digest IS NULL OR audience_digest ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT csf_communication_campaigns_body_text_check
    CHECK (body_text IS NULL OR nullif(btrim(body_text), '') IS NOT NULL),
  ADD CONSTRAINT csf_communication_campaigns_body_html_check
    CHECK (body_html IS NULL OR nullif(btrim(body_html), '') IS NOT NULL),
  ADD CONSTRAINT csf_communication_campaigns_body_metadata_object_check
    CHECK (jsonb_typeof(body_metadata) = 'object'),
  ADD CONSTRAINT csf_communication_campaigns_audience_kind_check
    CHECK (
      audience_kind IS NULL
      OR audience_kind IN (
        'term_members',
        'partner_club_representatives',
        'staff',
        'applicants',
        'custom_list'
      )
    ),
  -- 'transactional' is a reserved topic name that no broadcast may claim; see
  -- the preferences table, which refuses to store a row for it at all.
  ADD CONSTRAINT csf_communication_campaigns_topic_key_check
    CHECK (
      broadcast_topic_key IS NULL
      OR (
        broadcast_topic_key ~ '^[a-z0-9]([a-z0-9_.-]{0,62}[a-z0-9])?$'
        AND broadcast_topic_key <> 'transactional'
      )
    ),
  ADD CONSTRAINT csf_communication_campaigns_created_by_identity_check
    CHECK (
      created_by_identity IS NULL
      OR (
        nullif(btrim(created_by_identity), '') IS NOT NULL
        AND char_length(created_by_identity) <= 320
      )
    ),
  ADD CONSTRAINT csf_communication_campaigns_audience_size_check
    CHECK (audience_size IS NULL OR audience_size >= 0),
  -- Dispatch can only start after the audience is closed.
  ADD CONSTRAINT csf_communication_campaigns_dispatch_order_check
    CHECK (
      dispatch_started_at IS NULL
      OR (
        audience_finalized_at IS NOT NULL
        AND dispatch_started_at >= audience_finalized_at
      )
    ),
  ADD CONSTRAINT csf_communication_campaigns_audience_finalized_check
    CHECK (
      audience_finalized_at IS NULL
      OR (audience_digest IS NOT NULL AND audience_size IS NOT NULL)
    ),
  -- The whole dispatch-safety contract in one place. A campaign that records a
  -- content hash is a campaign the ledger may send, and such a campaign must
  -- carry the exact DVHS CSF sending identity, a real plain-text body, a body
  -- digest, an audience kind, a term, and a frozen creator identity.
  --
  -- created_by is deliberately absent from this rule: it is ON DELETE SET NULL
  -- against auth.users, so requiring it would make deleting an account fail
  -- against this CHECK. created_by_identity is the durable creator record.
  ADD CONSTRAINT csf_communication_campaigns_dispatch_identity_check
    CHECK (
      content_hash IS NULL
      OR (
        sender_email = 'csf@notifications.lets-assist.com'
        AND sender_name = 'DVHS CSF'
        AND reply_to_email = 'dvhighcsf@gmail.com'
        AND channel = 'email'
        AND nullif(btrim(body_text), '') IS NOT NULL
        AND body_text_hash IS NOT NULL
        AND audience_kind IS NOT NULL
        AND term_id IS NOT NULL
        AND created_by_identity IS NOT NULL
      )
    ),
  -- A dispatch-ready broadcast is scoped to exactly one preference topic; a
  -- dispatch-ready transactional campaign has none, because it cannot be
  -- refused.
  ADD CONSTRAINT csf_communication_campaigns_topic_scope_check
    CHECK (
      content_hash IS NULL
      OR (campaign_kind = 'broadcast') = (broadcast_topic_key IS NOT NULL)
    ),
  -- THE PROVIDER-SIDE TOPIC IS PART OF THE BROADCAST CONTRACT, NOT AN EXTRA.
  --
  -- broadcast_topic_key is OUR consent scope; resend_topic_id is the provider's,
  -- and it is what puts a working one-click unsubscribe in the recipient's mail
  -- client. A dispatch-ready broadcast that omits it ships bulk mail with no
  -- provider-side opt-out path at all -- the fastest way to earn a spam
  -- classification for the whole sending domain.
  --
  -- Transactional mail must NOT carry one: attaching a topic to an application
  -- decision would offer an unsubscribe from mail the recipient asked for by
  -- acting, and a click would then suppress delivery the chapter is obliged to
  -- make.
  ADD CONSTRAINT csf_comm_campaign_resend_topic_scope_check
    CHECK (
      content_hash IS NULL
      OR (campaign_kind = 'broadcast') = (resend_topic_id IS NOT NULL)
    ),
  ADD CONSTRAINT csf_comm_campaign_resend_topic_shape_check
    CHECK (
      resend_topic_id IS NULL
      OR (
        nullif(btrim(resend_topic_id), '') IS NOT NULL
        AND resend_topic_id = btrim(resend_topic_id)
        AND resend_topic_id !~ '\s'
        AND char_length(resend_topic_id) <= 128
      )
    ),
  ADD CONSTRAINT csf_communication_campaigns_cancellation_check
    CHECK (
      (cancelled_at IS NULL AND cancellation_reason IS NULL)
      OR (
        cancelled_at IS NOT NULL
        AND nullif(btrim(cancellation_reason), '') IS NOT NULL
        AND char_length(cancellation_reason) <= 300
        AND status = 'cancelled'
      )
    ),
  -- DISPATCH READINESS IS EXACTLY CONTENT FINALIZATION. The derive trigger
  -- computes content_hash if and only if this timestamp is set, and this rule
  -- makes that equivalence checkable at rest rather than only in the trigger.
  ADD CONSTRAINT csf_communication_campaigns_content_finalized_check
    CHECK ((content_hash IS NULL) = (content_finalized_at IS NULL)),
  -- A finalization is all-or-nothing evidence: when, by whom, and under what
  -- durable identity.
  ADD CONSTRAINT csf_comm_campaign_content_finalizer_check
    CHECK (
      content_finalized_at IS NULL
      OR (
        nullif(btrim(content_finalized_by_identity), '') IS NOT NULL
        AND char_length(content_finalized_by_identity) <= 320
      )
    ),
  ADD CONSTRAINT csf_comm_campaign_canceller_check
    CHECK (
      cancelled_at IS NULL
      OR (
        nullif(btrim(cancelled_by_identity), '') IS NOT NULL
        AND char_length(cancelled_by_identity) <= 320
      )
    ),
  ADD CONSTRAINT csf_comm_campaign_correlation_check
    CHECK (
      correlation_id IS NULL
      OR (
        nullif(btrim(correlation_id), '') IS NOT NULL
        AND correlation_id !~ '\s'
        AND char_length(correlation_id) <= 128
      )
    ),
  ADD CONSTRAINT csf_comm_campaign_review_block_check
    CHECK (
      (review_blocked_at IS NULL) = (review_blocked_reason IS NULL)
      AND (
        review_blocked_at IS NULL
        OR (
          nullif(btrim(review_blocked_reason), '') IS NOT NULL
          AND char_length(review_blocked_reason) <= 300
        )
      )
    ),
  -- UNKNOWN OUTCOMES KEEP A CAMPAIGN NONTERMINAL. A review block is exactly the
  -- statement "nobody knows whether some recipient was mailed", and a campaign
  -- in that condition may not claim it completed or failed. Cancellation stays
  -- reachable: withdrawing a send is an honest terminal answer even when an
  -- individual outcome is unknown.
  ADD CONSTRAINT csf_comm_campaign_review_block_nonterminal_check
    CHECK (review_blocked_at IS NULL OR status <> 'completed');

-- The only definition of campaign content identity. Whatever content_hash a
-- caller supplies is discarded and replaced with the server-derived digest, so
-- "this campaign is dispatch-ready" is a fact about the stored body rather than
-- a claim. A campaign with no plain-text body can never become dispatch-ready.
--
-- A NON-EMPTY DRAFT BODY IS NOT PUBLICATION. The digest is derived only once
-- content_finalized_at is set, so saving a draft repeatedly -- including a draft
-- that already has a full body -- leaves the campaign editable and unsendable.
-- The explicit finalization transition is what derives and freezes identity.
--
-- Named to sort before csf_communication_campaigns_dispatch_lock so the lock
-- compares the derived value, not the caller's.
CREATE OR REPLACE FUNCTION plugin_data.csf_derive_campaign_content_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.content_finalized_at IS NULL
    OR nullif(btrim(coalesce(NEW.body_text, '')), '') IS NULL
  THEN
    NEW.content_hash := NULL;
    RETURN NEW;
  END IF;

  NEW.content_hash := plugin_data.csf_communication_campaign_content_hash(
    NEW.campaign_kind,
    NEW.channel,
    NEW.sender_name,
    NEW.sender_email,
    NEW.reply_to_email,
    NEW.subject,
    NEW.body_text,
    NEW.body_html,
    NEW.body_metadata,
    NEW.broadcast_topic_key
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_campaigns_content_derive
BEFORE INSERT OR UPDATE ON plugin_data.csf_communication_campaigns
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_derive_campaign_content_hash();

REVOKE ALL ON FUNCTION plugin_data.csf_derive_campaign_content_hash()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plugin_data.csf_derive_campaign_content_hash() IS
  'Overwrites any caller-supplied campaign content_hash with the server-derived digest of the stored sender identity, subject, and bodies -- but only once content_finalized_at is set. A draft with a full body is still editable and unsendable, so a caller-declared hash is never accepted as proof of content OR of readiness.';

COMMENT ON COLUMN plugin_data.csf_communication_campaigns.content_finalized_at IS
  'When an officer explicitly declared the copy ready to send. Until then the campaign has no content digest and every draft field stays editable; from then on sender, subject, bodies, metadata, topic, term, and audience kind freeze together.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.review_blocked_at IS
  'Set while some recipient outcome is unknown. A review-blocked campaign is visibly nonterminal: the terminalization guard refuses to mark it completed, and only cancellation or resolving the unknown outcomes clears the way.';

-- Content replay/dedup lookup: "has this exact body already been sent for this
-- organization?" is the question a restart asks first.
CREATE INDEX csf_communication_campaigns_content_hash_idx
  ON plugin_data.csf_communication_campaigns (
    organization_id,
    content_hash,
    created_at DESC,
    id DESC
  )
  WHERE content_hash IS NOT NULL;

-- Tenant foreign-key index for the new term relation.
CREATE INDEX csf_communication_campaigns_term_idx
  ON plugin_data.csf_communication_campaigns (organization_id, term_id)
  WHERE term_id IS NOT NULL;

COMMENT ON COLUMN plugin_data.csf_communication_campaigns.body_text IS
  'Exact plain-text body that was or will be sent. A restart rebuilds the message from this column and never from provider state.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.body_html IS
  'Optional sanitized HTML body. Sanitization happens in the application before the value reaches the database.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.body_metadata IS
  'Optional structured body metadata (template name, variable names, layout version). Never raw message content.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.content_hash IS
  'Stable SHA-256 over the exact sender identity, subject, and body this campaign sends. Its presence is what makes a campaign dispatch-ready, and it is what every attempt idempotency key is bound to.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.broadcast_topic_key IS
  'Preference topic a broadcast is scoped to. NULL for transactional campaigns, which cannot be refused. The reserved key ''transactional'' is rejected outright.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.created_by_identity IS
  'Frozen textual identity of the officer who created the campaign, kept because created_by is detached by ON DELETE SET NULL when an account is removed.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.audience_digest IS
  'SHA-256 over the ordered per-recipient snapshot digests. Two finalizations of the same audience produce the same value, which is how a restart proves it is resending the same audience.';
COMMENT ON COLUMN plugin_data.csf_communication_campaigns.dispatch_started_at IS
  'When the audience was closed and the attempt ledger was allowed to enqueue work. After this, no recipient may be added to the audience.';
COMMENT ON CONSTRAINT csf_communication_campaigns_dispatch_identity_check
  ON plugin_data.csf_communication_campaigns IS
  'A campaign that records a content hash is dispatch-ready and must carry the exact DVHS CSF <csf@notifications.lets-assist.com> sender, the dvhighcsf@gmail.com reply-to, a plain-text body, a body digest, an audience kind, a term, and a frozen creator identity.';

-- Advisory census, now that content_hash exists. Campaigns recorded before this
-- migration are real history: they keep every column they had, they are simply
-- not dispatch-ready, so the ledger will never enqueue them and the DVHS sender
-- identity rule does not apply to them retroactively.
DO $legacy_campaign_census$
DECLARE
  v_legacy integer;
BEGIN
  SELECT count(*) INTO v_legacy
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.content_hash IS NULL;

  IF v_legacy > 0 THEN
    RAISE NOTICE
      'CSF durable communications: % existing campaign(s) carry no content hash and are therefore not dispatch-ready. Their history is preserved; a new send must be created through plugin_data.csf_snapshot_communication_recipients().',
      v_legacy;
  END IF;
END
$legacy_campaign_census$;

-- ---------------------------------------------------------------------------
-- D. Broadcast preferences
--
-- Organization- and topic-scoped consent for refusable mail. Two properties
-- matter most:
--
--   * Accountless recipients are first-class. A partner-club adviser who has
--     never signed in still gets a durable, honored opt-out, because identity
--     here is the normalized address -- user_id and profile_id are optional
--     enrichment, never the key.
--
--   * Transactional mail cannot be touched. The reserved topic key
--     'transactional' is rejected by CHECK, so there is no row shape that could
--     ever express "this person refuses transactional mail".
--
-- This table is a consent record, so ordinary deletes are refused: deleting an
-- opt-out silently resubscribes a person. Removal happens only through the
-- authorized purge.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_communication_broadcast_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  topic_key text NOT NULL,
  recipient_email text NOT NULL,
  normalized_recipient_email text
    GENERATED ALWAYS AS (lower(btrim(recipient_email))) STORED,
  -- Generated, not supplied: the identity a caller matches on can never drift
  -- from the address actually stored.
  recipient_email_hash text
    GENERATED ALWAYS AS (
      encode(
        extensions.digest(lower(btrim(recipient_email)), 'sha256'),
        'hex'
      )
    ) STORED,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  profile_id uuid,
  subscription_state text NOT NULL DEFAULT 'subscribed',
  opt_out_source text,
  opt_out_reason text,
  opt_out_at timestamptz,
  resubscribe_source text,
  resubscribed_at timestamptz,
  last_decision_at timestamptz NOT NULL DEFAULT now(),
  -- WHO DECIDED, AND UNDER WHICH REQUEST.
  --
  -- A consent decision is exactly the kind of claim someone disputes later, so
  -- the projection carries the actor of its CURRENT decision and the history
  -- trigger freezes a copy per decision. 'recipient' is a first-class actor kind
  -- because most opt-outs come from an unsubscribe link with no account behind
  -- it; the CHECK below is what stops such a decision claiming to be staff.
  decision_actor_kind text NOT NULL DEFAULT 'system',
  decision_actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_actor_identity text,
  decision_correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_communication_broadcast_preferences_id_organization_id_key
    UNIQUE (id, organization_id),
  -- One decision per address per topic per organization. The key is the
  -- normalized address, so an accountless recipient is as addressable as a
  -- signed-in one.
  CONSTRAINT csf_communication_broadcast_preferences_scope_key
    UNIQUE (organization_id, topic_key, normalized_recipient_email),
  CONSTRAINT csf_communication_broadcast_preferences_profile_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id)
    ON DELETE SET NULL (profile_id),
  -- The structural guarantee that broadcast preferences can never reach
  -- transactional mail: the reserved topic cannot be named at all.
  CONSTRAINT csf_communication_broadcast_preferences_topic_key_check
    CHECK (
      topic_key ~ '^[a-z0-9]([a-z0-9_.-]{0,62}[a-z0-9])?$'
      AND topic_key <> 'transactional'
    ),
  CONSTRAINT csf_communication_broadcast_preferences_email_shape_check
    CHECK (
      plugin_data.csf_communication_email_is_storable(
        lower(btrim(recipient_email))
      )
    ),
  CONSTRAINT csf_communication_broadcast_preferences_state_check
    CHECK (subscription_state IN ('subscribed', 'unsubscribed')),
  CONSTRAINT csf_communication_broadcast_preferences_opt_out_source_check
    CHECK (
      opt_out_source IS NULL
      OR opt_out_source IN (
        'recipient_unsubscribe_link',
        'provider_complaint',
        'provider_bounce',
        'staff_action',
        'import',
        'api'
      )
    ),
  -- Shortened deliberately: the fully-spelled name would be 64 bytes and
  -- PostgreSQL would silently truncate it to something no test could name.
  CONSTRAINT csf_comm_pref_resubscribe_source_check
    CHECK (
      resubscribe_source IS NULL
      OR resubscribe_source IN ('recipient_action', 'staff_action', 'api')
    ),
  CONSTRAINT csf_communication_broadcast_preferences_reason_bounded_check
    CHECK (opt_out_reason IS NULL OR char_length(opt_out_reason) <= 300),
  -- Consent coherence. An unsubscribed row always records when and from where.
  -- A subscribed row is either untouched, or a real resubscribe that keeps the
  -- original opt-out timestamps as history.
  CONSTRAINT csf_communication_broadcast_preferences_decision_check
    CHECK (
      (
        subscription_state = 'unsubscribed'
        AND opt_out_at IS NOT NULL
        AND opt_out_source IS NOT NULL
        AND (resubscribed_at IS NULL OR opt_out_at > resubscribed_at)
      )
      OR
      (
        subscription_state = 'subscribed'
        AND (
          (opt_out_at IS NULL AND opt_out_source IS NULL AND resubscribed_at IS NULL)
          OR (
            opt_out_at IS NOT NULL
            AND opt_out_source IS NOT NULL
            AND resubscribed_at IS NOT NULL
            AND resubscribe_source IS NOT NULL
            AND resubscribed_at >= opt_out_at
          )
        )
      )
    ),
  CONSTRAINT csf_communication_broadcast_preferences_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT csf_communication_broadcast_preferences_no_raw_content_check
    CHECK (NOT plugin_data.csf_jsonb_carries_raw_content(metadata)),
  CONSTRAINT csf_comm_pref_actor_kind_check
    CHECK (
      decision_actor_kind IN ('staff', 'recipient', 'provider', 'system', 'import', 'api')
    ),
  -- A RECIPIENT DECISION CANNOT MASQUERADE AS STAFF. Only 'staff' may name an
  -- account, and 'staff' must name one, so "an officer did this" and "the
  -- recipient did this" are structurally different claims.
  CONSTRAINT csf_comm_pref_actor_account_check
    CHECK ((decision_actor_kind = 'staff') = (decision_actor_user_id IS NOT NULL)),
  CONSTRAINT csf_comm_pref_actor_identity_check
    CHECK (
      decision_actor_identity IS NULL
      OR (
        nullif(btrim(decision_actor_identity), '') IS NOT NULL
        AND char_length(decision_actor_identity) <= 320
      )
    ),
  CONSTRAINT csf_comm_pref_correlation_check
    CHECK (
      decision_correlation_id IS NULL
      OR (
        nullif(btrim(decision_correlation_id), '') IS NOT NULL
        AND decision_correlation_id !~ '\s'
        AND char_length(decision_correlation_id) <= 128
      )
    )
);

-- "What has this address decided across every topic?" -- the question the
-- snapshot builder and the staff review screen both ask. The scope unique key
-- above leads with topic_key and cannot serve it.
CREATE INDEX csf_communication_broadcast_preferences_address_idx
  ON plugin_data.csf_communication_broadcast_preferences (
    organization_id,
    normalized_recipient_email,
    subscription_state
  );

-- Tenant foreign-key index.
CREATE INDEX csf_communication_broadcast_preferences_profile_idx
  ON plugin_data.csf_communication_broadcast_preferences (organization_id, profile_id)
  WHERE profile_id IS NOT NULL;

-- Covers the ON DELETE SET NULL path when an account is removed.
CREATE INDEX csf_communication_broadcast_preferences_user_idx
  ON plugin_data.csf_communication_broadcast_preferences (user_id)
  WHERE user_id IS NOT NULL;

-- Append-only consent history.
--
-- The preferences row above is a PROJECTION of the current decision, and a
-- projection necessarily forgets: opt out, resubscribe, opt out again, and the
-- middle decision is gone. Consent is exactly the kind of claim someone will
-- later dispute, so every decision is also written here and frozen. The
-- projection stays because dispatch needs one indexed answer per address.
CREATE TABLE plugin_data.csf_communication_preference_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preference_id uuid,
  topic_key text NOT NULL,
  normalized_recipient_email text NOT NULL,
  recipient_email_hash text NOT NULL,
  decision text NOT NULL,
  decision_source text NOT NULL,
  decision_reason text,
  decided_at timestamptz NOT NULL,
  previous_decision text,
  actor_kind text NOT NULL DEFAULT 'system',
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_identity text,
  correlation_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_comm_pref_events_id_organization_id_key
    UNIQUE (id, organization_id),
  -- Detaching the projection must not orphan the history, so this is
  -- deliberately SET NULL rather than CASCADE.
  CONSTRAINT csf_comm_pref_events_preference_fkey
    FOREIGN KEY (preference_id, organization_id)
    REFERENCES plugin_data.csf_communication_broadcast_preferences (id, organization_id)
    ON DELETE SET NULL (preference_id),
  CONSTRAINT csf_comm_pref_events_decision_check
    CHECK (decision IN ('subscribed', 'unsubscribed')),
  CONSTRAINT csf_comm_pref_events_previous_decision_check
    CHECK (
      previous_decision IS NULL
      OR previous_decision IN ('subscribed', 'unsubscribed')
    ),
  CONSTRAINT csf_comm_pref_events_source_check
    CHECK (
      nullif(btrim(decision_source), '') IS NOT NULL
      AND char_length(decision_source) <= 64
    ),
  CONSTRAINT csf_comm_pref_events_reason_check
    CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 300),
  CONSTRAINT csf_comm_pref_events_topic_key_check
    CHECK (
      topic_key ~ '^[a-z0-9]([a-z0-9_.-]{0,62}[a-z0-9])?$'
      AND topic_key <> 'transactional'
    ),
  CONSTRAINT csf_comm_pref_events_email_hash_check
    CHECK (recipient_email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT csf_comm_pref_events_actor_kind_check
    CHECK (actor_kind IN ('staff', 'recipient', 'provider', 'system', 'import', 'api')),
  -- Same structural separation as the projection: recorded history cannot later
  -- be read as "an officer did this" when a recipient link did it.
  --
  -- Unlike the projection this tolerates a detached account, because
  -- actor_user_id is ON DELETE SET NULL and frozen history must survive an
  -- account being removed. actor_identity is the durable record of who acted.
  CONSTRAINT csf_comm_pref_events_actor_account_check
    CHECK (actor_kind = 'staff' OR actor_user_id IS NULL),
  CONSTRAINT csf_comm_pref_events_actor_identity_check
    CHECK (
      actor_identity IS NULL
      OR (
        nullif(btrim(actor_identity), '') IS NOT NULL
        AND char_length(actor_identity) <= 320
      )
    ),
  CONSTRAINT csf_comm_pref_events_correlation_check
    CHECK (
      correlation_id IS NULL
      OR (
        nullif(btrim(correlation_id), '') IS NOT NULL
        AND correlation_id !~ '\s'
        AND char_length(correlation_id) <= 128
      )
    )
);

-- The whole decision history for one address and topic, oldest first.
CREATE INDEX csf_comm_pref_events_timeline_idx
  ON plugin_data.csf_communication_preference_events (
    organization_id,
    topic_key,
    normalized_recipient_email,
    decided_at,
    id
  );

CREATE INDEX csf_comm_pref_events_preference_idx
  ON plugin_data.csf_communication_preference_events (organization_id, preference_id)
  WHERE preference_id IS NOT NULL;

-- Every decision, written by the projection's own trigger so no writer can
-- record a preference without also recording its history.
CREATE OR REPLACE FUNCTION plugin_data.csf_record_preference_decision_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.subscription_state IS NOT DISTINCT FROM OLD.subscription_state
    AND NEW.last_decision_at IS NOT DISTINCT FROM OLD.last_decision_at
  THEN
    -- Enrichment-only edit (linking an account, say). Not a consent decision.
    RETURN NULL;
  END IF;

  INSERT INTO plugin_data.csf_communication_preference_events (
    organization_id, preference_id, topic_key, normalized_recipient_email,
    recipient_email_hash, decision, decision_source, decision_reason,
    decided_at, previous_decision, actor_kind, actor_user_id, actor_identity,
    correlation_id
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    NEW.topic_key,
    NEW.normalized_recipient_email,
    NEW.recipient_email_hash,
    NEW.subscription_state,
    CASE
      WHEN NEW.subscription_state = 'unsubscribed'
        THEN coalesce(NEW.opt_out_source, 'unspecified')
      ELSE coalesce(NEW.resubscribe_source, 'initial_subscription')
    END,
    CASE
      WHEN NEW.subscription_state = 'unsubscribed' THEN NEW.opt_out_reason
      ELSE NULL
    END,
    NEW.last_decision_at,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.subscription_state ELSE NULL END,
    -- Copied from the projection, not from a parameter: a writer cannot record a
    -- decision under one actor and its history under another.
    NEW.decision_actor_kind,
    NEW.decision_actor_user_id,
    NEW.decision_actor_identity,
    NEW.decision_correlation_id
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER csf_communication_broadcast_preferences_history
AFTER INSERT OR UPDATE ON plugin_data.csf_communication_broadcast_preferences
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_record_preference_decision_event();

REVOKE ALL ON FUNCTION plugin_data.csf_record_preference_decision_event()
  FROM PUBLIC, anon, authenticated;

-- Consent history is evidence. It is never updated and never deleted outside
-- the owner-run purge.
CREATE OR REPLACE FUNCTION plugin_data.csf_freeze_preference_decision_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_comm_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF consent history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  -- ON DELETE SET NULL detaching a projection row or an actor account that is
  -- already gone is the only tolerated update. Actor kind, durable identity, and
  -- correlation are frozen with the decision itself.
  IF ROW(
    NEW.id, NEW.organization_id, NEW.topic_key, NEW.normalized_recipient_email,
    NEW.recipient_email_hash, NEW.decision, NEW.decision_source,
    NEW.decision_reason, NEW.decided_at, NEW.previous_decision, NEW.actor_kind,
    NEW.actor_identity, NEW.correlation_id, NEW.recorded_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.topic_key, OLD.normalized_recipient_email,
    OLD.recipient_email_hash, OLD.decision, OLD.decision_source,
    OLD.decision_reason, OLD.decided_at, OLD.previous_decision, OLD.actor_kind,
    OLD.actor_identity, OLD.correlation_id, OLD.recorded_at
  ) THEN
    RAISE EXCEPTION 'CSF consent history is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id THEN
    IF NEW.actor_user_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM auth.users AS account WHERE account.id = OLD.actor_user_id
      )
    THEN
      RAISE EXCEPTION 'CSF consent history is append-only.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.preference_id IS DISTINCT FROM OLD.preference_id THEN
    IF NEW.preference_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM plugin_data.csf_communication_broadcast_preferences AS preference
        WHERE preference.id = OLD.preference_id
      )
    THEN
      RAISE EXCEPTION 'CSF consent history is append-only.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_comm_pref_events_append_only
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_preference_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_freeze_preference_decision_event();

REVOKE ALL ON FUNCTION plugin_data.csf_freeze_preference_decision_event()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE plugin_data.csf_communication_preference_events IS
  'Append-only CSF consent history. Every opt-out and resubscribe is recorded here and frozen, so a repeated opt-out/resubscribe cycle preserves each decision that the current-preference projection necessarily forgets. Server-only.';
COMMENT ON FUNCTION plugin_data.csf_record_preference_decision_event() IS
  'Writes a frozen consent event for every real decision on the preference projection, so no writer can record consent without recording its history.';
COMMENT ON FUNCTION plugin_data.csf_freeze_preference_decision_event() IS
  'Keeps consent history append-only, tolerating only the referential detach of a purged projection row and owner-authorized teardown.';

-- Identity is frozen, history is additive, and consent is never deleted by an
-- ordinary write. An address may opt out, resubscribe, and opt out again; each
-- transition moves last_decision_at forward and never erases the previous one.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_broadcast_preference_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_comm_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF broadcast preferences record consent and cannot be deleted; resubscribe the address or use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.topic_key <> OLD.topic_key
    OR lower(btrim(NEW.recipient_email)) <> lower(btrim(OLD.recipient_email))
  THEN
    RAISE EXCEPTION
      'CSF broadcast preference identity (organization, topic, address) is immutable; record a decision for the new scope instead.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.opt_out_at IS NOT NULL AND NEW.opt_out_at IS NULL THEN
    RAISE EXCEPTION
      'A recorded CSF broadcast opt-out is never erased; resubscribing keeps the opt-out timestamp as history.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.last_decision_at < OLD.last_decision_at THEN
    RAISE EXCEPTION
      'CSF broadcast preference decision time can never move backwards.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_broadcast_preferences_transition
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_broadcast_preferences
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_broadcast_preference_transition();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_broadcast_preference_transition()
  FROM PUBLIC, anon, authenticated;

-- The single decision point for "may we send this to this address?".
--
-- A transactional requirement returns 'mandatory_transactional' without reading
-- the preference table at all. That is deliberate: there is no code path in
-- which a broadcast opt-out row can influence transactional delivery, so no
-- future edit to the preference schema can weaken it either.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_preference_decision(
  p_organization_id uuid,
  p_delivery_requirement text,
  p_topic_key text,
  p_recipient_email text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_preference plugin_data.csf_communication_broadcast_preferences%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF preference decision requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF p_delivery_requirement = 'transactional' THEN
    RETURN pg_catalog.jsonb_build_object(
      'decision', 'mandatory_transactional',
      'reason', 'transactional_delivery_is_mandatory',
      'suppressed', false
    );
  END IF;

  IF p_delivery_requirement IS DISTINCT FROM 'broadcast' THEN
    RAISE EXCEPTION
      'A CSF delivery requirement must be exactly transactional or broadcast.'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_topic_key, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'A CSF broadcast preference decision requires the topic the broadcast is scoped to.'
      USING ERRCODE = '22004';
  END IF;

  SELECT preference.*
  INTO v_preference
  FROM plugin_data.csf_communication_broadcast_preferences AS preference
  WHERE preference.organization_id = p_organization_id
    AND preference.topic_key = btrim(p_topic_key)
    AND preference.normalized_recipient_email = v_email;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'decision', 'no_preference_record',
      'reason', 'no_recorded_broadcast_preference',
      'suppressed', false
    );
  END IF;

  IF v_preference.subscription_state = 'unsubscribed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'decision', 'suppressed_opt_out',
      'reason', 'opted_out_via_' || coalesce(v_preference.opt_out_source, 'unknown_source'),
      'suppressed', true
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'decision', 'allowed',
    'reason', 'subscribed_to_topic',
    'suppressed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_preference_decision(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_preference_decision(uuid, text, text, text)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_communication_broadcast_preferences IS
  'Organization- and topic-scoped consent for refusable CSF mail, keyed by normalized recipient address so accountless recipients are first-class. MANDATORY TRANSACTIONAL VERSUS BROADCAST: the reserved topic key ''transactional'' is rejected by CHECK, so no row here can ever suppress transactional delivery. Server-only: no browser role holds any privilege on this table.';
COMMENT ON COLUMN plugin_data.csf_communication_broadcast_preferences.recipient_email_hash IS
  'Generated SHA-256 of the normalized address, so a matching identity can be carried into snapshots and ledgers without copying the address itself.';
COMMENT ON COLUMN plugin_data.csf_communication_broadcast_preferences.opt_out_at IS
  'When the address refused this topic. Never cleared: a later resubscribe records resubscribed_at and keeps this as history.';
COMMENT ON FUNCTION plugin_data.csf_communication_preference_decision(uuid, text, text, text) IS
  'The single decision point for refusable mail. Returns mandatory_transactional for a transactional requirement without reading the preference table, so a broadcast opt-out can never reach transactional delivery.';
COMMENT ON FUNCTION plugin_data.csf_enforce_broadcast_preference_transition() IS
  'Freezes preference identity, forbids erasing a recorded opt-out, keeps decision time monotonic, and refuses ordinary deletion of a consent record.';

-- ---------------------------------------------------------------------------
-- D2. Address safety, which is NOT consent
--
-- VOLUNTARY CONSENT AND PROVIDER SAFETY ARE DIFFERENT FACTS AND LIVE IN
-- DIFFERENT TABLES.
--
--   * A broadcast opt-out is a preference. It is topic-scoped, it is reversible
--     by the recipient, and it applies ONLY to broadcasts. It lives in
--     csf_communication_broadcast_preferences.
--
--   * A bounce, a complaint, or a provider suppression is not a preference at
--     all -- it is evidence that mail to this ADDRESS is unsafe to send. It is
--     address-scoped, not topic-scoped, and it applies to transactional mail
--     too, because continuing to hammer a dead mailbox or a complaining
--     recipient damages the sending domain for everyone regardless of how
--     mandatory the message is.
--
-- Overloading the preference decision with provider safety would have been the
-- easy shortcut and it would have been wrong twice over: it would have let a
-- provider event masquerade as a recipient's choice, and -- because transactional
-- mail deliberately never reads the preference table -- it would have left
-- transactional sends hammering a hard-bounced address forever.
--
-- The projection answers "may we send to this address at all?" in one indexed
-- lookup. The append-only event table is why the projection can be trusted: a
-- projection necessarily forgets, and an address-level block is exactly the kind
-- of decision someone will later ask to see the evidence for.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_communication_address_safety (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  normalized_recipient_email text
    GENERATED ALWAYS AS (lower(btrim(recipient_email))) STORED,
  recipient_email_hash text
    GENERATED ALWAYS AS (
      encode(extensions.digest(lower(btrim(recipient_email)), 'sha256'), 'hex')
    ) STORED,
  safety_state text NOT NULL DEFAULT 'safe',
  suppression_class text,
  -- NOT ALL BOUNCES MEAN THE SAME THING, AND TREATING THEM ALIKE IS WRONG BOTH
  -- WAYS.
  --
  -- Resend distinguishes permanent from transient bounces. Collapsing them into
  -- one "suppressed" verdict either blocks a real recipient forever because their
  -- mailbox was full for an afternoon, or keeps hammering a mailbox that has been
  -- deleted for a year. So the kind is recorded and the gate honors it:
  --
  --   indefinite      -- permanent/hard bounce, complaint, provider suppression
  --   expiring        -- transient/soft bounce; a delivery HOLD that lapses
  --   review_required -- undetermined bounce or a manual hold; a human decides
  suppression_kind text,
  bounce_class text,
  -- Set only for an expiring hold. The projection is NEVER rewritten when a hold
  -- lapses: the decision function compares this to now(), so expiry needs no
  -- write, no scheduler, and has nothing to race against.
  hold_expires_at timestamptz,
  suppression_reason text,
  suppressed_at timestamptz,
  -- A complaint or an explicit provider suppression is not a transient
  -- condition. Once locked, no later event, no ordinary write, and no audited
  -- release returns this address to 'safe'; removal happens only through the
  -- authorized purge.
  terminal_locked_at timestamptz,
  last_provider_event_at timestamptz,
  observation_count integer NOT NULL DEFAULT 0,
  -- Audited release. A normal write can never turn unsafe safe; only a named
  -- staff actor recording a reason can, and only for a record that is not
  -- terminally locked.
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  released_by_identity text,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_comm_address_safety_id_organization_id_key
    UNIQUE (id, organization_id),
  -- Address-scoped, deliberately with no topic column: safety is not a topic
  -- decision and must not be expressible as one.
  CONSTRAINT csf_comm_address_safety_scope_key
    UNIQUE (organization_id, normalized_recipient_email),
  CONSTRAINT csf_comm_address_safety_email_shape_check
    CHECK (
      plugin_data.csf_communication_email_is_storable(lower(btrim(recipient_email)))
    ),
  CONSTRAINT csf_comm_address_safety_state_check
    CHECK (safety_state IN ('safe', 'suppressed')),
  CONSTRAINT csf_comm_address_safety_class_check
    CHECK (
      suppression_class IS NULL
      OR suppression_class IN (
        'bounce', 'complaint', 'provider_suppression', 'manual_hold'
      )
    ),
  CONSTRAINT csf_comm_address_safety_kind_check
    CHECK (
      suppression_kind IS NULL
      OR suppression_kind IN ('indefinite', 'expiring', 'review_required')
    ),
  -- Only a bounce carries a bounce class, and a bounce always carries one.
  CONSTRAINT csf_comm_address_safety_bounce_class_check
    CHECK (
      (bounce_class IS NULL) = (suppression_class IS DISTINCT FROM 'bounce')
      AND (
        bounce_class IS NULL
        OR bounce_class IN ('permanent', 'transient', 'undetermined')
      )
    ),
  -- An expiring hold always says when it lapses; nothing else may claim one.
  CONSTRAINT csf_comm_address_safety_hold_window_check
    CHECK ((hold_expires_at IS NOT NULL) = (suppression_kind = 'expiring')),
  -- A terminal lock is by definition not releasable and not expiring.
  CONSTRAINT csf_comm_address_safety_terminal_kind_check
    CHECK (terminal_locked_at IS NULL OR suppression_kind = 'indefinite'),
  -- A release is all-or-nothing evidence naming a durable actor, and it is only
  -- coherent on a record that is actually safe again.
  CONSTRAINT csf_comm_address_safety_release_pair_check
    CHECK (
      (released_at IS NULL) = (release_reason IS NULL)
      AND (released_at IS NULL) = (released_by_identity IS NULL)
      AND (
        released_at IS NULL
        OR (
          nullif(btrim(release_reason), '') IS NOT NULL
          AND char_length(release_reason) <= 300
          AND nullif(btrim(released_by_identity), '') IS NOT NULL
          AND char_length(released_by_identity) <= 320
          AND safety_state = 'safe'
          AND terminal_locked_at IS NULL
        )
      )
    ),
  CONSTRAINT csf_comm_address_safety_reason_check
    CHECK (
      suppression_reason IS NULL
      OR (
        nullif(btrim(suppression_reason), '') IS NOT NULL
        AND char_length(suppression_reason) <= 300
      )
    ),
  -- A suppressed address always says what suppressed it, of what kind, and when.
  --
  -- A RELEASED address keeps all of that as history while reading 'safe' again,
  -- which is the whole point of an audited release: the block is lifted, the
  -- evidence that justified it is not erased.
  CONSTRAINT csf_comm_address_safety_evidence_check
    CHECK (
      (
        safety_state = 'safe'
        AND released_at IS NULL
        AND suppressed_at IS NULL
        AND suppression_class IS NULL
        AND suppression_kind IS NULL
      )
      OR (
        safety_state = 'safe'
        AND released_at IS NOT NULL
        AND suppressed_at IS NOT NULL
        AND suppression_class IS NOT NULL
        AND suppression_kind IS NOT NULL
      )
      OR (
        safety_state = 'suppressed'
        AND released_at IS NULL
        AND suppressed_at IS NOT NULL
        AND suppression_class IS NOT NULL
        AND suppression_kind IS NOT NULL
        AND suppression_reason IS NOT NULL
      )
    ),
  CONSTRAINT csf_comm_address_safety_lock_check
    CHECK (terminal_locked_at IS NULL OR safety_state = 'suppressed'),
  CONSTRAINT csf_comm_address_safety_observations_check
    CHECK (observation_count >= 0)
);

-- The dispatch-time question, answered by index: "is this address suppressed in
-- this organization?"
CREATE INDEX csf_comm_address_safety_lookup_idx
  ON plugin_data.csf_communication_address_safety (
    organization_id,
    normalized_recipient_email,
    safety_state
  );

-- The staff worklist of blocked addresses, partial so it stays small.
CREATE INDEX csf_comm_address_safety_suppressed_idx
  ON plugin_data.csf_communication_address_safety (
    organization_id,
    suppressed_at DESC,
    id DESC
  )
  WHERE safety_state = 'suppressed';

-- Append-only address-safety evidence. Every observation that moved -- or tried
-- to move -- the projection is recorded here and frozen.
CREATE TABLE plugin_data.csf_communication_address_safety_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  safety_id uuid,
  normalized_recipient_email text NOT NULL,
  recipient_email_hash text NOT NULL,
  event_class text NOT NULL,
  -- Frozen alongside the class so the projection's current kind can always be
  -- traced to the observation that produced it -- including a hold window that has
  -- since lapsed, which the projection alone can no longer distinguish from one
  -- that never expired.
  event_kind text,
  event_bounce_class text,
  hold_expires_at timestamptz,
  event_reason text NOT NULL,
  provider_event_id text,
  observed_at timestamptz NOT NULL,
  previous_state text NOT NULL,
  next_state text NOT NULL,
  actor_kind text NOT NULL DEFAULT 'provider',
  actor_identity text,
  correlation_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_comm_addr_safety_events_id_organization_id_key
    UNIQUE (id, organization_id),
  -- SET NULL, not CASCADE: purging the projection must not orphan the evidence
  -- that justified it.
  CONSTRAINT csf_comm_addr_safety_events_safety_fkey
    FOREIGN KEY (safety_id, organization_id)
    REFERENCES plugin_data.csf_communication_address_safety (id, organization_id)
    ON DELETE SET NULL (safety_id),
  CONSTRAINT csf_comm_addr_safety_events_class_check
    CHECK (
      event_class IN (
        'bounce', 'complaint', 'provider_suppression', 'manual_hold', 'release'
      )
    ),
  CONSTRAINT csf_comm_addr_safety_events_kind_check
    CHECK (
      event_kind IS NULL
      OR event_kind IN ('indefinite', 'expiring', 'review_required', 'released')
    ),
  CONSTRAINT csf_comm_addr_safety_events_bounce_class_check
    CHECK (
      (event_bounce_class IS NULL) = (event_class IS DISTINCT FROM 'bounce')
      AND (
        event_bounce_class IS NULL
        OR event_bounce_class IN ('permanent', 'transient', 'undetermined')
      )
    ),
  -- A release is the only observation that makes an address safe, and it is the
  -- only one that must name a staff actor.
  CONSTRAINT csf_comm_addr_safety_events_release_check
    CHECK (
      (event_class = 'release') = (next_state = 'safe')
      AND (
        event_class <> 'release'
        OR (actor_kind = 'staff' AND actor_identity IS NOT NULL)
      )
    ),
  CONSTRAINT csf_comm_addr_safety_events_reason_check
    CHECK (
      nullif(btrim(event_reason), '') IS NOT NULL
      AND char_length(event_reason) <= 300
    ),
  CONSTRAINT csf_comm_addr_safety_events_states_check
    CHECK (
      previous_state IN ('safe', 'suppressed')
      AND next_state IN ('safe', 'suppressed')
    ),
  CONSTRAINT csf_comm_addr_safety_events_hash_check
    CHECK (recipient_email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT csf_comm_addr_safety_events_actor_kind_check
    CHECK (actor_kind IN ('staff', 'recipient', 'provider', 'system', 'import', 'api')),
  CONSTRAINT csf_comm_addr_safety_events_actor_identity_check
    CHECK (
      actor_identity IS NULL
      OR (
        nullif(btrim(actor_identity), '') IS NOT NULL
        AND char_length(actor_identity) <= 320
      )
    ),
  CONSTRAINT csf_comm_addr_safety_events_correlation_check
    CHECK (
      correlation_id IS NULL
      OR (
        nullif(btrim(correlation_id), '') IS NOT NULL
        AND correlation_id !~ '\s'
        AND char_length(correlation_id) <= 128
      )
    ),
  CONSTRAINT csf_comm_addr_safety_events_provider_ref_check
    CHECK (
      provider_event_id IS NULL
      OR (
        nullif(btrim(provider_event_id), '') IS NOT NULL
        AND char_length(provider_event_id) <= 255
      )
    )
);

CREATE INDEX csf_comm_addr_safety_events_timeline_idx
  ON plugin_data.csf_communication_address_safety_events (
    organization_id,
    normalized_recipient_email,
    observed_at,
    id
  );

CREATE INDEX csf_comm_addr_safety_events_safety_idx
  ON plugin_data.csf_communication_address_safety_events (organization_id, safety_id)
  WHERE safety_id IS NOT NULL;

-- Safety only ever tightens. An address that bounced is never quietly declared
-- healthy again by a later write, and a terminal lock is written once.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_address_safety_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_comm_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF address safety records provider evidence and cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR lower(btrim(NEW.recipient_email)) <> lower(btrim(OLD.recipient_email))
  THEN
    RAISE EXCEPTION
      'CSF address safety identity (organization, address) is immutable.'
      USING ERRCODE = '23514';
  END IF;

  -- A NORMAL WRITE CANNOT SILENTLY TURN UNSAFE SAFE.
  --
  -- The one legal path from suppressed to safe is an audited release: a named
  -- staff actor, a recorded reason, in this same statement. A terminally locked
  -- record -- a complaint or an explicit provider suppression -- has no path at all.
  IF OLD.safety_state = 'suppressed' AND NEW.safety_state = 'safe' THEN
    IF OLD.terminal_locked_at IS NOT NULL THEN
      RAISE EXCEPTION
        'A CSF address terminally locked by a complaint or provider suppression is never returned to safe.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.released_at IS NULL
      OR NEW.released_by_identity IS NULL
      OR NEW.release_reason IS NULL
      OR OLD.released_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'A CSF address suppressed by provider evidence returns to safe only through an audited release recording the actor and reason.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- A RELEASED ADDRESS MUST STILL BE SUPPRESSIBLE BY A LATER BOUNCE.
  --
  -- These two rules contradicted each other and made the whole
  -- suppress -> release -> new hard bounce path impossible: the applier clears the
  -- release columns when a newer suppression arrives, and this guard forbade
  -- rewriting them, so a released address that later bounced raised instead of being
  -- re-blocked. A recipient whose mailbox died after a release would have kept
  -- receiving mail.
  --
  -- The release columns are the CURRENT release state, not the history. The history
  -- is the append-only event row (event_class = 'release'), which nothing here can
  -- touch -- so clearing them as part of a genuine re-suppression loses no evidence,
  -- and the transition is now permitted for exactly that case. Rewriting a release
  -- while the address stays safe is still refused.
  IF OLD.released_at IS NOT NULL
    AND ROW(NEW.released_at, NEW.released_by_identity, NEW.release_reason)
      IS DISTINCT FROM ROW(OLD.released_at, OLD.released_by_identity, OLD.release_reason)
    AND NOT (
      -- The one permitted transition: safe-because-released becomes suppressed
      -- again, and the superseded release state is cleared wholesale.
      NEW.safety_state = 'suppressed'
      AND NEW.released_at IS NULL
      AND NEW.released_by_identity IS NULL
      AND NEW.release_reason IS NULL
    )
  THEN
    RAISE EXCEPTION
      'A CSF address safety release is recorded once and never rewritten; a later suppression supersedes it rather than editing it.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.suppressed_at IS NOT NULL AND NEW.suppressed_at IS NULL THEN
    RAISE EXCEPTION 'A recorded CSF address suppression time is never erased.'
      USING ERRCODE = '23514';
  END IF;

  -- Severity only tightens WHILE A BLOCK IS LIVE. A later observation may upgrade an
  -- expiring hold to a review hold or to indefinite suppression; nothing downgrades
  -- one.
  --
  -- Scoped to OLD.safety_state = 'suppressed' deliberately. An address that was
  -- audibly RELEASED is safe, and its stale pre-release kind is history rather than a
  -- floor -- otherwise a released address that later drew a soft bounce would be
  -- refused re-suppression because the block an officer had already lifted was more
  -- severe than the new one. A released address starts fresh.
  IF OLD.safety_state = 'suppressed'
    AND OLD.suppression_kind IS NOT NULL
    AND NEW.suppression_kind IS NOT NULL
    AND NEW.safety_state = 'suppressed'
    AND plugin_data.csf_comm_safety_kind_rank(NEW.suppression_kind)
      < plugin_data.csf_comm_safety_kind_rank(OLD.suppression_kind)
  THEN
    RAISE EXCEPTION
      'CSF address safety severity only tightens; an indefinite suppression never becomes an expiring hold.'
      USING ERRCODE = '23514';
  END IF;

  -- A hold window may be extended by a fresh observation but never shortened,
  -- which is what stops a late soft bounce from silently unblocking an address.
  IF OLD.hold_expires_at IS NOT NULL
    AND NEW.hold_expires_at IS NOT NULL
    AND NEW.hold_expires_at < OLD.hold_expires_at
  THEN
    RAISE EXCEPTION 'A CSF address safety hold window is never shortened.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.terminal_locked_at IS NOT NULL
    AND NEW.terminal_locked_at IS DISTINCT FROM OLD.terminal_locked_at
  THEN
    RAISE EXCEPTION
      'A CSF address terminal safety lock is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.observation_count < OLD.observation_count THEN
    RAISE EXCEPTION 'A CSF address safety observation count never decreases.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_comm_address_safety_transition
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_address_safety
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_address_safety_transition();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_address_safety_transition()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION plugin_data.csf_freeze_address_safety_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_comm_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF address safety history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF ROW(
    NEW.id, NEW.organization_id, NEW.normalized_recipient_email,
    NEW.recipient_email_hash, NEW.event_class, NEW.event_kind,
    NEW.event_bounce_class, NEW.hold_expires_at, NEW.event_reason,
    NEW.provider_event_id, NEW.observed_at, NEW.previous_state, NEW.next_state,
    NEW.actor_kind, NEW.actor_identity, NEW.correlation_id, NEW.recorded_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.normalized_recipient_email,
    OLD.recipient_email_hash, OLD.event_class, OLD.event_kind,
    OLD.event_bounce_class, OLD.hold_expires_at, OLD.event_reason,
    OLD.provider_event_id, OLD.observed_at, OLD.previous_state, OLD.next_state,
    OLD.actor_kind, OLD.actor_identity, OLD.correlation_id, OLD.recorded_at
  ) THEN
    RAISE EXCEPTION 'CSF address safety history is append-only.'
      USING ERRCODE = '23514';
  END IF;

  -- The referential detach of a purged projection row is the only tolerated
  -- update, exactly as for consent history.
  IF NEW.safety_id IS DISTINCT FROM OLD.safety_id THEN
    IF NEW.safety_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM plugin_data.csf_communication_address_safety AS safety
        WHERE safety.id = OLD.safety_id
      )
    THEN
      RAISE EXCEPTION 'CSF address safety history is append-only.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_comm_addr_safety_events_append_only
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_address_safety_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_freeze_address_safety_event();

REVOKE ALL ON FUNCTION plugin_data.csf_freeze_address_safety_event()
  FROM PUBLIC, anon, authenticated;

-- The address-level question, asked for BOTH broadcast and transactional mail.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_address_safety_decision(
  p_organization_id uuid,
  p_recipient_email text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_safety plugin_data.csf_communication_address_safety%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF address safety decision requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  SELECT safety.*
  INTO v_safety
  FROM plugin_data.csf_communication_address_safety AS safety
  WHERE safety.organization_id = p_organization_id
    AND safety.normalized_recipient_email = v_email;

  IF NOT FOUND OR v_safety.safety_state = 'safe' THEN
    RETURN pg_catalog.jsonb_build_object(
      'safe', true,
      'state', 'safe',
      'kind', NULL,
      'class', NULL,
      'bounceClass', NULL,
      'reason', NULL,
      'holdExpiresAt', NULL,
      'released', v_safety.released_at IS NOT NULL,
      'terminal', false
    );
  END IF;

  -- AN EXPIRING HOLD LAPSES WITHOUT A WRITE.
  --
  -- A transient bounce means the mailbox exists but could not take the message
  -- right now, so the block is a hold with a window rather than a verdict. Expiry
  -- is evaluated here instead of by a sweeper: there is no row to update, nothing
  -- to schedule, and no race between "the hold lapsed" and "another bounce
  -- arrived". The projection keeps the evidence either way.
  IF v_safety.suppression_kind = 'expiring'
    AND v_safety.hold_expires_at IS NOT NULL
    AND v_safety.hold_expires_at <= now()
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'safe', true,
      'state', 'hold_expired',
      'kind', 'expiring',
      'class', v_safety.suppression_class,
      'bounceClass', v_safety.bounce_class,
      'reason', v_safety.suppression_reason,
      'holdExpiresAt', v_safety.hold_expires_at,
      'released', false,
      'terminal', false
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'safe', false,
    'state', 'suppressed',
    'kind', v_safety.suppression_kind,
    'class', v_safety.suppression_class,
    'bounceClass', v_safety.bounce_class,
    'reason', v_safety.suppression_reason,
    'holdExpiresAt', v_safety.hold_expires_at,
    'released', false,
    'terminal', v_safety.terminal_locked_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_address_safety_decision(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_address_safety_decision(uuid, text)
  TO service_role;

-- The one composite dispatch decision. SAFETY IS EVALUATED FIRST AND FOR EVERY
-- REQUIREMENT; consent is evaluated second and only for broadcasts. That order
-- is the whole point: transactional mail cannot be refused, but it can still be
-- unsendable.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_dispatch_decision(
  p_organization_id uuid,
  p_delivery_requirement text,
  p_topic_key text,
  p_recipient_email text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_safety jsonb;
  v_preference jsonb;
BEGIN
  v_safety := plugin_data.csf_communication_address_safety_decision(
    p_organization_id, p_recipient_email
  );

  IF NOT (v_safety->>'safe')::boolean THEN
    RETURN pg_catalog.jsonb_build_object(
      'authorized', false,
      'blockedBy', 'address_safety',
      'decision', 'suppressed_address_safety',
      'reason', 'address_' || coalesce(v_safety->>'class', 'unsafe'),
      'detail', v_safety->>'reason',
      'safety', v_safety,
      'preference', NULL
    );
  END IF;

  v_preference := plugin_data.csf_communication_preference_decision(
    p_organization_id, p_delivery_requirement, p_topic_key, p_recipient_email
  );

  IF (v_preference->>'suppressed')::boolean THEN
    RETURN pg_catalog.jsonb_build_object(
      'authorized', false,
      'blockedBy', 'broadcast_consent',
      'decision', v_preference->>'decision',
      'reason', v_preference->>'reason',
      'detail', NULL,
      'safety', v_safety,
      'preference', v_preference
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'authorized', true,
    'blockedBy', NULL,
    'decision', v_preference->>'decision',
    'reason', v_preference->>'reason',
    'detail', NULL,
    'safety', v_safety,
    'preference', v_preference
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_dispatch_decision(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_dispatch_decision(uuid, text, text, text)
  TO service_role;

-- Applies one safety observation atomically: it upserts the projection and
-- writes the frozen evidence in the same statement pair, so the projection can
-- never claim a suppression that no event justifies.
--
-- Owner-only. Provider safety is derived from verified webhook evidence inside
-- the resolution primitive; there is deliberately no service-role entry point
-- that lets an operator declare an address unsafe with no evidence trail.
CREATE OR REPLACE FUNCTION plugin_data.csf_apply_communication_address_safety(
  p_organization_id uuid,
  p_recipient_email text,
  p_event_class text,
  p_reason text,
  p_observed_at timestamptz,
  p_provider_event_id text DEFAULT NULL,
  p_actor_kind text DEFAULT 'provider',
  p_actor_identity text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  -- The provider's own bounce type, verbatim. Mapped through
  -- plugin_data.csf_comm_bounce_class() rather than trusted as a class name.
  p_bounce_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- A transient bounce means "not right now", so the hold is measured in days,
  -- not minutes. Three days clears an overnight mailbox-full or a greylisting
  -- window without pretending a dead mailbox is alive.
  c_transient_hold constant interval := interval '72 hours';
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_reason text := pg_catalog.left(
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'provider reported this address unsafe'),
    300
  );
  v_now timestamptz := now();
  v_observed timestamptz := coalesce(p_observed_at, now());
  v_previous text := 'safe';
  v_safety_id uuid;
  v_bounce_class text;
  v_kind text;
  v_hold_expires timestamptz;
  -- A complaint or an explicit provider suppression is a standing decision, not
  -- a transient condition, so it locks terminally: no later event and no audited
  -- release reopens it.
  v_terminal boolean := p_event_class IN ('complaint', 'provider_suppression');
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF address safety observation requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_communication_email_is_storable(v_email) THEN
    RAISE EXCEPTION
      'A CSF address safety observation requires a single, whitespace-free, bounded mailbox address.'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_class NOT IN ('bounce', 'complaint', 'provider_suppression', 'manual_hold') THEN
    RAISE EXCEPTION
      'A CSF address safety observation is a bounce, a complaint, a provider suppression, or a manual hold.'
      USING ERRCODE = '22023';
  END IF;

  -- CLASSIFY BEFORE BLOCKING.
  --
  -- A permanent bounce and a full mailbox are not the same fact, and one verdict
  -- for both is wrong in both directions: it either blocks a real recipient
  -- forever over one bad afternoon, or keeps mailing an address that has not
  -- existed for a year.
  IF p_event_class = 'bounce' THEN
    v_bounce_class := plugin_data.csf_comm_bounce_class(p_bounce_type);
    v_kind := CASE v_bounce_class
      WHEN 'permanent' THEN 'indefinite'
      WHEN 'transient' THEN 'expiring'
      ELSE 'review_required'
    END;
  ELSIF p_event_class = 'manual_hold' THEN
    v_kind := 'review_required';
  ELSE
    v_kind := 'indefinite';
  END IF;

  v_hold_expires := CASE
    WHEN v_kind = 'expiring' THEN v_observed + c_transient_hold
    ELSE NULL
  END;

  -- Serializes concurrent observations for one address. FOR UPDATE below cannot
  -- lock a row that does not exist yet, so without this two webhooks arriving
  -- together for a first-time bounce would both take the insert path and one would
  -- fail on the scope unique key -- aborting a whole webhook transaction over a
  -- projection update that was already correct.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-address-safety:' || p_organization_id::text || ':' || v_email, 0
    )
  );

  SELECT safety.id, safety.safety_state
  INTO v_safety_id, v_previous
  FROM plugin_data.csf_communication_address_safety AS safety
  WHERE safety.organization_id = p_organization_id
    AND safety.normalized_recipient_email = v_email
  FOR UPDATE;

  IF NOT FOUND THEN
    v_previous := 'safe';

    INSERT INTO plugin_data.csf_communication_address_safety (
      organization_id, recipient_email, safety_state, suppression_class,
      suppression_kind, bounce_class, hold_expires_at, suppression_reason,
      suppressed_at, terminal_locked_at, last_provider_event_at, observation_count
    ) VALUES (
      p_organization_id, v_email, 'suppressed', p_event_class, v_kind,
      v_bounce_class, v_hold_expires, v_reason, v_observed,
      CASE WHEN v_terminal THEN v_now ELSE NULL END,
      CASE WHEN p_actor_kind = 'provider' THEN v_observed ELSE NULL END,
      1
    )
    RETURNING id INTO v_safety_id;
  ELSE
    UPDATE plugin_data.csf_communication_address_safety AS safety
    SET
      safety_state = 'suppressed',
      -- SEVERITY TIGHTENS, NEVER LOOSENS. When a later observation is at least as
      -- severe it takes over the labelling; when it is milder -- a soft bounce
      -- arriving after a hard one -- it is still counted and still recorded as
      -- evidence, but it does not relabel or reopen the block.
      suppression_class = CASE
        WHEN v_previous = 'safe'
          OR safety.suppression_class IS NULL
          OR plugin_data.csf_comm_safety_kind_rank(v_kind)
            >= plugin_data.csf_comm_safety_kind_rank(safety.suppression_kind)
          THEN p_event_class
        ELSE safety.suppression_class
      END,
      suppression_kind = CASE
        WHEN v_previous = 'safe'
          OR safety.suppression_kind IS NULL
          OR plugin_data.csf_comm_safety_kind_rank(v_kind)
            >= plugin_data.csf_comm_safety_kind_rank(safety.suppression_kind)
          THEN v_kind
        ELSE safety.suppression_kind
      END,
      bounce_class = CASE
        WHEN v_previous = 'safe'
          OR safety.suppression_kind IS NULL
          OR plugin_data.csf_comm_safety_kind_rank(v_kind)
            >= plugin_data.csf_comm_safety_kind_rank(safety.suppression_kind)
          THEN v_bounce_class
        ELSE safety.bounce_class
      END,
      -- A repeated transient bounce EXTENDS the hold rather than restarting the
      -- clock from nothing; an upgrade to a non-expiring kind drops the window
      -- entirely, which the hold-window CHECK requires.
      hold_expires_at = CASE
        WHEN v_previous = 'safe'
          OR safety.suppression_kind IS NULL
          OR plugin_data.csf_comm_safety_kind_rank(v_kind)
            >= plugin_data.csf_comm_safety_kind_rank(safety.suppression_kind)
          THEN CASE
            WHEN v_kind = 'expiring'
              THEN greatest(coalesce(safety.hold_expires_at, v_hold_expires), v_hold_expires)
            ELSE NULL
          END
        ELSE safety.hold_expires_at
      END,
      suppression_reason = CASE
        WHEN v_previous = 'safe'
          OR safety.suppression_reason IS NULL
          OR plugin_data.csf_comm_safety_kind_rank(v_kind)
            > plugin_data.csf_comm_safety_kind_rank(safety.suppression_kind)
          THEN v_reason
        ELSE safety.suppression_reason
      END,
      suppressed_at = coalesce(safety.suppressed_at, v_observed),
      terminal_locked_at = CASE
        WHEN v_terminal THEN coalesce(safety.terminal_locked_at, v_now)
        ELSE safety.terminal_locked_at
      END,
      last_provider_event_at = CASE
        WHEN p_actor_kind = 'provider'
          THEN greatest(coalesce(safety.last_provider_event_at, v_observed), v_observed)
        ELSE safety.last_provider_event_at
      END,
      observation_count = safety.observation_count + 1,
      -- A NEW BLOCK SUPERSEDES AN EARLIER RELEASE. Without clearing these, the
      -- evidence CHECK would see a suppressed row still claiming to be released.
      released_at = NULL,
      released_by = NULL,
      released_by_identity = NULL,
      release_reason = NULL,
      updated_at = v_now
    WHERE safety.id = v_safety_id;
  END IF;

  INSERT INTO plugin_data.csf_communication_address_safety_events (
    organization_id, safety_id, normalized_recipient_email, recipient_email_hash,
    event_class, event_kind, event_bounce_class, hold_expires_at, event_reason,
    provider_event_id, observed_at, previous_state, next_state, actor_kind,
    actor_identity, correlation_id
  ) VALUES (
    p_organization_id, v_safety_id, v_email,
    pg_catalog.encode(extensions.digest(v_email, 'sha256'), 'hex'),
    p_event_class, v_kind, v_bounce_class, v_hold_expires, v_reason,
    nullif(btrim(coalesce(p_provider_event_id, '')), ''),
    v_observed, v_previous, 'suppressed', p_actor_kind,
    nullif(btrim(coalesce(p_actor_identity, '')), ''),
    nullif(btrim(coalesce(p_correlation_id, '')), '')
  );

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'safetyId', v_safety_id,
    'previousState', v_previous,
    'safetyState', 'suppressed',
    'suppressionClass', p_event_class,
    'suppressionKind', v_kind,
    'bounceClass', v_bounce_class,
    'holdExpiresAt', v_hold_expires,
    'terminal', v_terminal
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_apply_communication_address_safety(
  uuid, text, text, text, timestamptz, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- The audited release. The ONLY path from suppressed back to safe.
--
-- A mailbox really can be recreated, and a review hold exists precisely so a human
-- can decide. What must never happen is an address becoming sendable because
-- somebody ran an UPDATE. So the release is an RPC that requires an active
-- tenant-scoped staff capability, records who and why, keeps the suppression
-- evidence, and refuses outright on a terminally locked record.
CREATE OR REPLACE FUNCTION plugin_data.csf_release_communication_address_safety(
  p_organization_id uuid,
  p_recipient_email text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_capability constant text := 'manage_settings';
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_now timestamptz := now();
  v_safety plugin_data.csf_communication_address_safety%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF address safety release requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 300 THEN
    RAISE EXCEPTION
      'A CSF address safety release records a reason of 1 to 300 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF address safety release must record the staff account that decided it.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to release an address block in this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-address-safety:' || p_organization_id::text || ':' || v_email, 0
    )
  );

  SELECT safety.*
  INTO v_safety
  FROM plugin_data.csf_communication_address_safety AS safety
  WHERE safety.organization_id = p_organization_id
    AND safety.normalized_recipient_email = v_email
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That address holds no CSF safety record in this organization, so there is nothing to release.'
      USING ERRCODE = '23503';
  END IF;

  IF v_safety.safety_state = 'safe' THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'safetyId', v_safety.id,
      'safetyState', 'safe',
      'released', v_safety.released_at IS NOT NULL,
      'idempotentReplay', true
    );
  END IF;

  IF v_safety.terminal_locked_at IS NOT NULL THEN
    RAISE EXCEPTION
      'That CSF address is terminally locked by a complaint or provider suppression and is never released; the recipient must be reached another way.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE plugin_data.csf_communication_address_safety
  SET
    safety_state = 'safe',
    hold_expires_at = NULL,
    suppression_kind = CASE
      WHEN suppression_kind = 'expiring' THEN 'review_required'
      ELSE suppression_kind
    END,
    released_at = v_now,
    released_by = p_actor_user_id,
    released_by_identity = v_actor_identity,
    release_reason = v_reason,
    updated_at = v_now
  WHERE id = v_safety.id;

  INSERT INTO plugin_data.csf_communication_address_safety_events (
    organization_id, safety_id, normalized_recipient_email, recipient_email_hash,
    event_class, event_kind, event_reason, observed_at, previous_state,
    next_state, actor_kind, actor_identity, correlation_id
  ) VALUES (
    p_organization_id, v_safety.id, v_email, v_safety.recipient_email_hash,
    'release', 'released', v_reason, v_now, 'suppressed', 'safe', 'staff',
    v_actor_identity, v_correlation
  );

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'safetyId', v_safety.id,
    'safetyState', 'safe',
    'released', true,
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_release_communication_address_safety(
  uuid, text, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_communication_address_safety(
  uuid, text, text, uuid, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_release_communication_address_safety(
  uuid, text, text, uuid, text
) IS
  'The only path from a suppressed CSF address back to safe. Requires an ACTIVE tenant-scoped staff capability, freezes the actor/reason/correlation, keeps the suppression evidence, downgrades a lapsed expiring hold to a review record, and refuses outright on a terminally locked complaint or provider suppression.';

COMMENT ON TABLE plugin_data.csf_communication_address_safety IS
  'Organization- and address-scoped provider safety projection. VOLUNTARY CONSENT VERSUS PROVIDER SAFETY: this is NOT a preference. It carries no topic column because a bounce or complaint is not a topic decision, and it applies to transactional mail too -- a broadcast opt-out never can. Server-only.';
COMMENT ON TABLE plugin_data.csf_communication_address_safety_events IS
  'Append-only CSF address-safety evidence. Every observation that moved the projection is frozen here, so an address-level block can always be justified. Server-only.';
COMMENT ON FUNCTION plugin_data.csf_communication_address_safety_decision(uuid, text) IS
  'The address-level safety answer, asked for broadcast AND transactional mail alike. Deliberately separate from plugin_data.csf_communication_preference_decision(), which answers a different question about a different kind of fact.';
COMMENT ON FUNCTION plugin_data.csf_communication_dispatch_decision(uuid, text, text, text) IS
  'The one composite send decision: address safety first for every requirement, then topic-scoped broadcast consent. A transactional message cannot be refused by a preference but can still be blocked as unsafe.';
COMMENT ON FUNCTION plugin_data.csf_apply_communication_address_safety(
  uuid, text, text, text, timestamptz, text, text, text, text, text
) IS
  'Owner-only. Atomically upserts the address safety projection and writes its frozen evidence, so the projection can never assert a suppression no event justifies. Classifies bounces: permanent suppresses indefinitely, transient earns an expiring delivery hold, undetermined goes to a review hold. Complaints and provider suppressions lock terminally. Severity only tightens.';
COMMENT ON COLUMN plugin_data.csf_communication_address_safety.suppression_kind IS
  'indefinite, expiring, or review_required. A transient bounce is a HOLD with a window, not a verdict; expiry is evaluated by plugin_data.csf_communication_address_safety_decision() so it needs no sweeper and has nothing to race.';
COMMENT ON COLUMN plugin_data.csf_communication_address_safety.released_at IS
  'Set only by plugin_data.csf_release_communication_address_safety(). A normal write can never turn unsafe safe, and a terminally locked record has no release path at all.';

-- ---------------------------------------------------------------------------
-- E. Audience snapshot dispatch provenance
--
-- 20260730001001 already makes an audience snapshot immutable after insert and
-- undeletable outside the authorized purge. Rows are created already-final by
-- the snapshot RPC, and the set of rows is closed by finalization, so
-- "immutable after dispatch begins" is satisfied by the stronger inherited
-- rule; the trigger below extends that immutability to the columns added here.
--
-- Contact provenance is preserved as digests plus a typed label. That keeps the
-- fact that the response address differed from the preferred address -- which
-- is exactly what a support question needs -- without copying a raw source row
-- or a second live address into the ledger.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_communication_recipient_snapshots
  ADD COLUMN recipient_email_hash text
    GENERATED ALWAYS AS (
      encode(extensions.digest(lower(btrim(recipient_email)), 'sha256'), 'hex')
    ) STORED,
  ADD COLUMN recipient_identity_hash text
    GENERATED ALWAYS AS (
      encode(
        extensions.digest(
          organization_id::text || ':' || lower(btrim(recipient_email)),
          'sha256'
        ),
        'hex'
      )
    ) STORED,
  ADD COLUMN delivery_requirement text,
  ADD COLUMN topic_key text,
  ADD COLUMN preference_decision text,
  ADD COLUMN preference_reason text,
  ADD COLUMN preference_recorded_at timestamptz,
  ADD COLUMN contact_provenance text,
  ADD COLUMN response_contact_hash text,
  ADD COLUMN preferred_contact_hash text,
  ADD COLUMN content_hash text,
  ADD COLUMN recipient_snapshot_hash text;

ALTER TABLE plugin_data.csf_communication_recipient_snapshots
  ADD CONSTRAINT csf_communication_recipient_snapshots_requirement_check
    CHECK (
      delivery_requirement IS NULL
      OR delivery_requirement IN ('transactional', 'broadcast')
    ),
  ADD CONSTRAINT csf_communication_recipient_snapshots_preference_decision_check
    CHECK (
      preference_decision IS NULL
      OR preference_decision IN (
        'allowed',
        'mandatory_transactional',
        'no_preference_record',
        'suppressed_opt_out'
      )
    ),
  ADD CONSTRAINT csf_communication_recipient_snapshots_preference_reason_check
    CHECK (
      preference_reason IS NULL
      OR (
        nullif(btrim(preference_reason), '') IS NOT NULL
        AND char_length(preference_reason) <= 200
      )
    ),
  ADD CONSTRAINT csf_communication_recipient_snapshots_provenance_check
    CHECK (
      contact_provenance IS NULL
      OR contact_provenance IN (
        'response_contact',
        'preferred_contact',
        'account_email',
        'representative_record',
        'staff_entry',
        'import_record'
      )
    ),
  ADD CONSTRAINT csf_communication_recipient_snapshots_topic_key_check
    CHECK (
      topic_key IS NULL
      OR (
        topic_key ~ '^[a-z0-9]([a-z0-9_.-]{0,62}[a-z0-9])?$'
        AND topic_key <> 'transactional'
      )
    ),
  ADD CONSTRAINT csf_communication_recipient_snapshots_hash_shapes_check
    CHECK (
      (response_contact_hash IS NULL OR response_contact_hash ~ '^[0-9a-f]{64}$')
      AND (preferred_contact_hash IS NULL OR preferred_contact_hash ~ '^[0-9a-f]{64}$')
      AND (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$')
      AND (recipient_snapshot_hash IS NULL OR recipient_snapshot_hash ~ '^[0-9a-f]{64}$')
    ),
  -- A snapshot row that records a content hash is dispatch-managed, and a
  -- dispatch-managed row carries its full decision provenance.
  ADD CONSTRAINT csf_communication_recipient_snapshots_dispatch_complete_check
    CHECK (
      content_hash IS NULL
      OR (
        delivery_requirement IS NOT NULL
        AND preference_decision IS NOT NULL
        AND preference_reason IS NOT NULL
        AND preference_recorded_at IS NOT NULL
        AND contact_provenance IS NOT NULL
        AND recipient_snapshot_hash IS NOT NULL
        AND plugin_data.csf_communication_email_is_storable(
          lower(btrim(recipient_email))
        )
      )
    ),
  -- MANDATORY TRANSACTIONAL: a transactional recipient is scoped to no topic,
  -- always records the mandatory decision, and may never be excluded for
  -- unsubscribing or suppression. Address validity, duplication, and
  -- eligibility remain legitimate reasons to skip a transactional recipient;
  -- a broadcast preference is not.
  -- Shortened deliberately: the fully-spelled name would be 67 bytes and
  -- PostgreSQL would silently truncate it.
  ADD CONSTRAINT csf_comm_snapshot_transactional_mandatory_check
    CHECK (
      delivery_requirement IS DISTINCT FROM 'transactional'
      OR (
        preference_decision = 'mandatory_transactional'
        AND topic_key IS NULL
        AND (
          exclusion_reason IS NULL
          OR exclusion_reason IN ('invalid_address', 'duplicate', 'not_eligible')
        )
      )
    ),
  -- A broadcast recipient always names the topic its decision was made against.
  ADD CONSTRAINT csf_communication_recipient_snapshots_broadcast_topic_check
    CHECK (
      delivery_requirement IS DISTINCT FROM 'broadcast'
      OR (
        topic_key IS NOT NULL
        AND preference_decision IN (
          'allowed',
          'no_preference_record',
          'suppressed_opt_out'
        )
      )
    ),
  -- An opt-out decision and an exclusion record must agree, in both directions.
  ADD CONSTRAINT csf_communication_recipient_snapshots_opt_out_agreement_check
    CHECK (
      preference_decision IS NULL
      OR (
        (preference_decision = 'suppressed_opt_out')
        = (subscription_decision = 'excluded' AND exclusion_reason = 'unsubscribed')
      )
    );

-- Reduction and support lookups by recipient identity across campaigns, without
-- reading the address itself.
CREATE INDEX csf_communication_recipient_snapshots_identity_idx
  ON plugin_data.csf_communication_recipient_snapshots (
    organization_id,
    recipient_identity_hash,
    created_at DESC
  );

-- The audience-digest recomputation reads exactly this, in this order.
CREATE INDEX csf_communication_recipient_snapshots_dispatch_idx
  ON plugin_data.csf_communication_recipient_snapshots (
    organization_id,
    campaign_id,
    subscription_decision,
    recipient_snapshot_hash
  )
  WHERE content_hash IS NOT NULL;

-- Extends 20260730001001's immutability to the dispatch provenance columns.
-- Written once by the snapshot RPC and never again: the audience a past send
-- addressed, and why each address was included or skipped, is evidence.
CREATE OR REPLACE FUNCTION plugin_data.csf_freeze_recipient_snapshot_dispatch_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.delivery_requirement, NEW.topic_key, NEW.preference_decision,
    NEW.preference_reason, NEW.preference_recorded_at, NEW.contact_provenance,
    NEW.response_contact_hash, NEW.preferred_contact_hash, NEW.content_hash,
    NEW.recipient_snapshot_hash
  ) IS DISTINCT FROM ROW(
    OLD.delivery_requirement, OLD.topic_key, OLD.preference_decision,
    OLD.preference_reason, OLD.preference_recorded_at, OLD.contact_provenance,
    OLD.response_contact_hash, OLD.preferred_contact_hash, OLD.content_hash,
    OLD.recipient_snapshot_hash
  ) THEN
    RAISE EXCEPTION
      'CSF audience snapshot dispatch provenance is immutable; a send reads only what the snapshot froze.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort before csf_communication_recipient_snapshots_immutable so the
-- more specific diagnostic wins when a caller edits a dispatch column.
CREATE TRIGGER csf_communication_recipient_snapshots_dispatch_frozen
BEFORE UPDATE ON plugin_data.csf_communication_recipient_snapshots
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_freeze_recipient_snapshot_dispatch_fields();

REVOKE ALL ON FUNCTION plugin_data.csf_freeze_recipient_snapshot_dispatch_fields()
  FROM PUBLIC, anon, authenticated;

-- A FINALIZED AUDIENCE IS CLOSED AT THE TABLE, NOT ONLY IN THE RPC.
--
-- The snapshot RPC refuses to run against a finalized campaign, but that is a
-- rule in one function. A late INSERT that skipped it would add a recipient to an
-- audience whose digest was already computed and whose deliveries were already
-- created -- silently mailing somebody the recorded audience does not contain,
-- and permanently breaking the digest that a restart uses to prove it is
-- resending the same audience.
--
-- Section J leaves this table SELECT-only for service_role, so no client or
-- server role can issue that INSERT at all. This trigger is the independent
-- second answer, and it is not redundant: it runs for the OWNER's statements too,
-- which is what a future RPC path or an owner-run backfill would arrive as.
--
-- Idempotent snapshot replay is unaffected: an identical replay never reaches an
-- INSERT at all, because the RPC recognizes the byte-identical row and skips it.
-- What this closes is the addition of a NEW row after finalization.
CREATE OR REPLACE FUNCTION plugin_data.csf_reject_finalized_audience_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_finalized_at timestamptz;
BEGIN
  -- THE CHECK MUST TAKE THE SAME LOCKS, IN THE SAME ORDER, AS FINALIZATION.
  --
  -- A plain SELECT here was a time-of-check/time-of-use hole wide enough to drive
  -- a whole recipient through. Finalization takes the audience advisory lock, then
  -- the campaign row lock, and only then computes the digest, the size, and the
  -- delivery set. An unsynchronized insert could read audience_finalized_at as
  -- NULL, pass this guard, block on nothing, and commit AFTER the digest was
  -- computed -- leaving a recipient in the audience that the digest does not
  -- cover, no delivery row, and therefore a person who is silently never mailed
  -- while the campaign reports success.
  --
  -- Taking the identical advisory lock first, then the campaign row, means this
  -- insert either wins the race and is seen by finalization's own count, or blocks
  -- until finalization commits and then observes a non-null audience_finalized_at
  -- and fails. There is no third outcome. Same order in both paths, so the two can
  -- never deadlock against each other.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-audience:' || NEW.organization_id::text || ':'
        || NEW.campaign_id::text,
      0
    )
  );

  -- FOR KEY SHARE, not FOR UPDATE: this only needs the campaign to hold still, and
  -- a share lock is what an ordinary foreign-key check would take anyway. It is
  -- compatible with other concurrent inserts while still conflicting with
  -- finalization's FOR UPDATE, which is exactly the asymmetry wanted -- many
  -- builders may append in parallel, but none may append across a finalization.
  SELECT campaign.audience_finalized_at
  INTO v_finalized_at
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id
    AND campaign.organization_id = NEW.organization_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    -- csf_communication_recipient_snapshots_campaign_fkey owns this failure and
    -- reports it precisely; duplicating it here would only make the diagnostic
    -- vaguer.
    RETURN NEW;
  END IF;

  IF v_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION
      'This CSF campaign audience is already finalized; a finalized audience never gains a recipient.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_recipient_snapshots_audience_closed
BEFORE INSERT ON plugin_data.csf_communication_recipient_snapshots
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_reject_finalized_audience_insert();

REVOKE ALL ON FUNCTION plugin_data.csf_reject_finalized_audience_insert()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plugin_data.csf_reject_finalized_audience_insert() IS
  'Closes a finalized CSF audience at the table, taking the SAME audience advisory lock and a compatible campaign row lock in the SAME order as finalization. Without that a concurrent insert could read audience_finalized_at as NULL and commit after the digest and delivery set were computed, leaving a recipient the digest does not cover and nobody ever mails.';

COMMENT ON COLUMN plugin_data.csf_communication_recipient_snapshots.delivery_requirement IS
  'Whether this recipient row is transactional (mandatory, unrefusable) or broadcast (refusable through plugin_data.csf_communication_broadcast_preferences).';
COMMENT ON COLUMN plugin_data.csf_communication_recipient_snapshots.preference_decision IS
  'The consent decision as it stood when the snapshot was taken. A later opt-out never rewrites a past audience, and a broadcast opt-out can never produce this value for a transactional row.';
COMMENT ON COLUMN plugin_data.csf_communication_recipient_snapshots.contact_provenance IS
  'Which channel this address came from: the form response, a stated preferred contact, the signed-in account, a representative record, staff entry, or an import.';
COMMENT ON COLUMN plugin_data.csf_communication_recipient_snapshots.response_contact_hash IS
  'SHA-256 of the address the source response supplied, kept so a divergence from the preferred contact stays provable without storing the raw source row.';
COMMENT ON COLUMN plugin_data.csf_communication_recipient_snapshots.recipient_snapshot_hash IS
  'SHA-256 over this row''s addressing and decision material. The ordered set of these digests is the campaign audience digest.';

-- ---------------------------------------------------------------------------
-- F. Delivery reduction state
--
-- The delivery row stays what it was: one row per recipient holding the
-- current, monotonic truth about that recipient's outcome. It is deliberately
-- not overloaded with queue state -- leases, attempt numbers, and per-try
-- provider keys live in the attempt ledger in section G.
--
-- What is added here is only what the reducer needs to be conservative about
-- out-of-order webhooks, plus the human-review flag an unknown outcome raises.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_communication_deliveries
  ADD COLUMN last_provider_event_at timestamptz,
  ADD COLUMN last_provider_event_type text,
  ADD COLUMN terminal_locked_at timestamptz,
  ADD COLUMN unknown_outcome_at timestamptz,
  ADD COLUMN review_state text NOT NULL DEFAULT 'none',
  ADD COLUMN review_reason text;

ALTER TABLE plugin_data.csf_communication_deliveries
  -- Parent tuple for the attempt ledger: an attempt may only attach to a
  -- delivery that agrees with it about organization, campaign, AND recipient,
  -- so a single composite reference proves all three at once.
  ADD CONSTRAINT csf_communication_deliveries_dispatch_identity_key
    UNIQUE (id, organization_id, campaign_id, recipient_snapshot_id),
  ADD CONSTRAINT csf_communication_deliveries_review_state_check
    CHECK (review_state IN ('none', 'pending', 'escalated', 'resolved')),
  ADD CONSTRAINT csf_communication_deliveries_review_reason_check
    CHECK (
      review_reason IS NULL
      OR (
        nullif(btrim(review_reason), '') IS NOT NULL
        AND char_length(review_reason) <= 300
      )
    ),
  -- Only a safety state locks a delivery. Success is never terminal in this
  -- sense: a delivered message can still draw a complaint.
  ADD CONSTRAINT csf_communication_deliveries_terminal_lock_check
    CHECK (
      terminal_locked_at IS NULL
      OR status IN ('bounced', 'complained', 'suppressed')
    ),
  ADD CONSTRAINT csf_communication_deliveries_last_event_type_check
    CHECK (
      last_provider_event_type IS NULL
      OR (
        nullif(btrim(last_provider_event_type), '') IS NOT NULL
        AND char_length(last_provider_event_type) <= 100
      )
    );

-- Provider message identity is GLOBALLY unique, not tenant-scoped.
--
-- Resend message ids come from one shared account. If organization B could
-- record organization A's message id, a webhook naming that id would resolve
-- differently depending on which organization the caller claimed -- a
-- wrong-tenant poisoning path. Globally unique makes the mapping from provider
-- message to delivery unambiguous, so the recording RPC can detect and refuse a
-- cross-tenant claim rather than silently mis-reducing.
--
-- 20260730001001's tenant-scoped csf_communication_deliveries_provider_message_idx
-- is left in place; it still serves per-organization lookups.
CREATE UNIQUE INDEX csf_comm_delivery_provider_message_global_idx
  ON plugin_data.csf_communication_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- The human-review worklist. Partial so it stays small: almost every delivery
-- is never reviewed.
CREATE INDEX csf_communication_deliveries_review_idx
  ON plugin_data.csf_communication_deliveries (
    organization_id,
    review_state,
    updated_at DESC,
    id DESC
  )
  WHERE review_state <> 'none';

-- Reduction bookkeeping is append-forward. The delivery state machine itself is
-- still owned by 20260730001001's csf_enforce_delivery_lifecycle(); this only
-- guarantees the two facts the reducer relies on when it decides whether a late
-- webhook may act: the terminal lock is written once, and the last observed
-- provider time never moves backwards.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_delivery_reduction_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.terminal_locked_at IS NOT NULL
    AND NEW.terminal_locked_at IS DISTINCT FROM OLD.terminal_locked_at
  THEN
    RAISE EXCEPTION
      'A CSF delivery terminal safety lock is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.last_provider_event_at IS NOT NULL
    AND NEW.last_provider_event_at IS NOT NULL
    AND NEW.last_provider_event_at < OLD.last_provider_event_at
  THEN
    RAISE EXCEPTION
      'CSF delivery provider observation time can never move backwards; an older webhook may not overwrite a newer one.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.last_provider_event_at IS NOT NULL AND NEW.last_provider_event_at IS NULL THEN
    RAISE EXCEPTION
      'CSF delivery provider observation time can never be cleared.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.unknown_outcome_at IS NOT NULL
    AND NEW.unknown_outcome_at IS DISTINCT FROM OLD.unknown_outcome_at
  THEN
    RAISE EXCEPTION
      'A CSF delivery unknown-outcome marker is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  -- A delivery that recorded an unknown provider outcome keeps a review state
  -- until somebody resolves it. Clearing the flag would hide the one case where
  -- nobody knows whether the recipient was mailed.
  IF NEW.unknown_outcome_at IS NOT NULL AND NEW.review_state = 'none' THEN
    RAISE EXCEPTION
      'A CSF delivery with an unknown provider outcome always carries a review state.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ONE TRANSITION AUTHORITY, NOT TWO.
--
-- 20260730001001 hardcodes its own copy of the delivery transition table inside
-- csf_enforce_delivery_lifecycle(), and this migration's reducer consults
-- csf_communication_delivery_transition_allowed(). Two copies of one rule is how
-- 'sent' -> 'suppressed' came to be legal in neither: the reducer's target map
-- already produced 'suppressed' for email.suppressed, but both tables refused the
-- edge, so every provider suppression on a real (already-sent) delivery was
-- retained as ignored_conflict and acted on by nobody.
--
-- The trigger is redefined here -- same name, same signature, no edit to the old
-- migration -- to DELEGATE to the shared helper instead of carrying a second copy.
-- Every other rule it enforces is reproduced verbatim.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_delivery_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_campaigns AS campaign
      WHERE campaign.id = OLD.campaign_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF delivery history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.campaign_id <> OLD.campaign_id
    OR NEW.recipient_snapshot_id <> OLD.recipient_snapshot_id
    OR NEW.provider_idempotency_key <> OLD.provider_idempotency_key
  THEN
    RAISE EXCEPTION
      'CSF delivery campaign, recipient, and idempotency identity are frozen once recorded.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_message_id IS NOT NULL
    AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
  THEN
    RAISE EXCEPTION
      'CSF delivery provider message identity is frozen once recorded.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'CSF delivery attempt count can never decrease.'
      USING ERRCODE = '23514';
  END IF;

  -- The one difference from 20260730001001: the transition table is no longer
  -- duplicated here.
  IF NEW.status IS DISTINCT FROM OLD.status
    AND plugin_data.csf_communication_delivery_state_rank(NEW.status) IS NOT NULL
    AND NOT plugin_data.csf_communication_delivery_transition_allowed(
      OLD.status, NEW.status
    )
  THEN
    RAISE EXCEPTION
      'CSF delivery state may only advance; a delivered, bounced, complained, suppressed, or failed delivery never returns to queued or sent.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.queued_at IS DISTINCT FROM OLD.queued_at
    OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
    OR (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
    OR (OLD.failed_at IS NOT NULL AND NEW.failed_at IS DISTINCT FROM OLD.failed_at)
  THEN
    RAISE EXCEPTION
      'CSF delivery lifecycle timestamps are recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.sent_at IS NOT NULL AND NEW.sent_at < NEW.queued_at)
    OR (NEW.failed_at IS NOT NULL AND NEW.failed_at < NEW.queued_at)
    OR (
      NEW.delivered_at IS NOT NULL
      AND (NEW.sent_at IS NULL OR NEW.delivered_at < NEW.sent_at)
    )
  THEN
    RAISE EXCEPTION
      'CSF delivery lifecycle timestamps must be monotonic: queued, then sent, then delivered.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_delivery_lifecycle()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plugin_data.csf_enforce_delivery_lifecycle() IS
  'Freezes delivery identity, forbids attempt-count regression, enforces forward-only state through the SINGLE shared transition authority plugin_data.csf_communication_delivery_transition_allowed(), keeps lifecycle timestamps write-once and monotonic, and blocks direct deletion.';

CREATE TRIGGER csf_communication_deliveries_reduction_state
BEFORE UPDATE ON plugin_data.csf_communication_deliveries
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_delivery_reduction_state();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_delivery_reduction_state()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN plugin_data.csf_communication_deliveries.terminal_locked_at IS
  'When a bounce, complaint, or suppression made this delivery terminally unsafe. UNKNOWN OUTCOME AND OUT-OF-ORDER SAFETY: once set, a later sent or delivered event with an earlier or missing provider time is retained as evidence and ignored for state.';
COMMENT ON COLUMN plugin_data.csf_communication_deliveries.review_state IS
  'Human-review flag. An unknown provider outcome sets this to pending; nothing re-sends on the strength of a pending review.';
COMMENT ON FUNCTION plugin_data.csf_enforce_delivery_reduction_state() IS
  'Guarantees the two facts the webhook reducer depends on: the terminal safety lock is write-once, and the last observed provider time is monotonic.';

-- ---------------------------------------------------------------------------
-- G. Durable attempt ledger
--
-- One row per try. This is the queue, the lease, the provider idempotency
-- allocation, and the per-try outcome -- none of which belong on the delivery
-- row, because a delivery has exactly one truth while a send may be tried
-- several times.
--
-- PROVIDER IDEMPOTENCY IS LOCAL-AUTHORITATIVE. Resend honors an
-- Idempotency-Key for a bounded window; this table honors it forever. A key is
-- allocated once, against one content hash, for one (organization, campaign,
-- recipient, attempt) coordinate, and the allocation outlives any provider
-- retention window. The uniqueness on the key alone is deliberately global
-- rather than tenant-scoped: the key is presented to a single shared Resend
-- account, so two organizations reusing one key would silently collide there.
--
-- UNKNOWN OUTCOME SAFETY. 'unknown_outcome' is a settled state with exactly two
-- exits, both of which require evidence or a human: reconciliation to a real
-- outcome, or an explicit human-review resolution. The state machine below
-- refuses every transition from 'unknown_outcome' back to 'queued' or
-- 'processing', and the enqueue guard refuses to open a new attempt behind one.
-- ---------------------------------------------------------------------------

-- THE CANONICAL PROVIDER REQUEST. One definition, read from stored rows.
--
-- This is the single description of what will be handed to Resend for one
-- (organization, campaign, recipient, attempt) coordinate: the sender identity,
-- the reply-to, this one recipient, the subject, both bodies, the EXACT routing
-- tags, and the exact extra headers. The enqueue trigger hashes this document to
-- allocate the idempotency key, and the dispatch-authorization RPC hands this
-- same document back to the worker. Because both read one function over stored
-- rows, a worker cannot silently add or omit a routing tag: any divergence
-- changes the hash, and the hash the worker is given is the hash the ledger
-- already stored.
--
-- ROUTING TAGS ARE PART OF THE REQUEST, NOT DECORATION. csf_attempt_id is what
-- lets a webhook that beats local settlement still find its attempt without
-- reading message content or a recipient address, so it is signed into the send
-- and covered by the digest.
--
-- STABLE rather than IMMUTABLE: it reads the campaign and snapshot rows. Both
-- are frozen once content is finalized and the audience is closed, so the value
-- is stable for the whole life of an attempt.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_provider_request(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_recipient_snapshot_id uuid,
  p_attempt_id uuid,
  p_attempt_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_snapshot plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  v_headers jsonb;
  v_tags jsonb;
BEGIN
  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT snapshot.*
  INTO v_snapshot
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.id = p_recipient_snapshot_id
    AND snapshot.organization_id = p_organization_id
    AND snapshot.campaign_id = p_campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF audience snapshot for this provider request does not exist in this campaign.'
      USING ERRCODE = '23503';
  END IF;

  v_headers := coalesce(v_campaign.body_metadata->'headers', '{}'::jsonb);
  IF pg_catalog.jsonb_typeof(v_headers) <> 'object' THEN
    RAISE EXCEPTION
      'CSF campaign body metadata headers must be a JSON object of provider headers.'
      USING ERRCODE = '22023';
  END IF;

  -- A DISPATCH-READY BROADCAST MUST CARRY THE PROVIDER TOPIC.
  --
  -- The CHECK on the campaign already enforces this, but the request builder is
  -- what a worker actually calls, so it refuses here too rather than quietly
  -- assembling bulk mail with no provider-side unsubscribe path.
  IF v_campaign.content_hash IS NOT NULL
    AND v_campaign.campaign_kind = 'broadcast'
    AND nullif(btrim(coalesce(v_campaign.resend_topic_id, '')), '') IS NULL
  THEN
    RAISE EXCEPTION
      'A dispatch-ready CSF broadcast must carry a provider topic so the recipient gets a working one-click unsubscribe.'
      USING ERRCODE = '23514';
  END IF;

  -- TAGS AS AN ARRAY, BECAUSE THAT IS WHAT THE SEND API TAKES.
  --
  -- Resend's webhook REPORTS tags as Record<string,string>, and this used to store
  -- that shape -- then hand it to a transport whose request expects
  -- [{name, value}]. Hashing one shape while sending another makes the stored
  -- digest a statement about a document nobody transmits.
  --
  -- Ordered by name so the serialization is canonical: jsonb sorts object keys but
  -- preserves array order, so the order has to be pinned explicitly.
  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('name', tag.name, 'value', tag.value)
      ORDER BY tag.name
    ),
    '[]'::jsonb
  )
  INTO v_tags
  FROM (
    VALUES
      ('csf_plugin', 'dvhs_csf'),
      ('csf_organization_id',
        plugin_data.csf_communication_tag_value(p_organization_id::text)),
      ('csf_campaign_id',
        plugin_data.csf_communication_tag_value(p_campaign_id::text)),
      ('csf_attempt_id',
        plugin_data.csf_communication_tag_value(p_attempt_id::text)),
      ('csf_topic_key',
        plugin_data.csf_communication_tag_value(v_snapshot.topic_key))
  ) AS tag(name, value)
  WHERE tag.value IS NOT NULL;

  -- jsonb sorts object keys, so this serialization is canonical: two builds of
  -- the same coordinate produce byte-identical text and therefore one digest.
  --
  -- THE TWO HALVES ARE DELIBERATELY SEPARATE.
  --
  --   coordinate     -- internal ledger identity. Never transmitted.
  --   providerPayload -- EXACTLY what goes on the wire, and exactly the object the
  --                      worker adapter hands to the transport with no edits.
  --
  -- The digest covers both. Mixing them into one flat object is what let internal
  -- fields drift into something the caller believed was sendable.
  RETURN pg_catalog.jsonb_build_object(
    'v', 3,
    'coordinate', pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'recipientSnapshotId', p_recipient_snapshot_id,
      'attemptId', p_attempt_id,
      'attemptNumber', p_attempt_number,
      'contentHash', v_campaign.content_hash,
      'recipientSnapshotHash', v_snapshot.recipient_snapshot_hash,
      'deliveryRequirement', v_snapshot.delivery_requirement,
      'topicKey', v_snapshot.topic_key
    ),
    'providerPayload', pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'from', pg_catalog.concat(
          coalesce(v_campaign.sender_name, ''), ' <',
          pg_catalog.lower(pg_catalog.btrim(coalesce(v_campaign.sender_email, ''))), '>'
        ),
        'to', pg_catalog.lower(pg_catalog.btrim(coalesce(v_snapshot.recipient_email, ''))),
        'replyTo', pg_catalog.lower(pg_catalog.btrim(coalesce(v_campaign.reply_to_email, ''))),
        'subject', v_campaign.subject,
        'text', v_campaign.body_text,
        'html', v_campaign.body_html,
        'tags', v_tags,
        -- Omitted entirely when empty, so the transmitted request matches the
        -- hashed one byte for byte rather than carrying an empty object the
        -- transport would drop.
        'headers', nullif(v_headers, '{}'::jsonb),
        -- Broadcasts only. A transactional campaign carries no topic, so a
        -- recipient can never unsubscribe from mail the chapter is obliged to send.
        'topicId', CASE
          WHEN v_campaign.campaign_kind = 'broadcast'
            THEN nullif(btrim(coalesce(v_campaign.resend_topic_id, '')), '')
          ELSE NULL
        END,
        -- 'transactional' here is the TRANSPORT's own flag, not the CSF
        -- broadcast/transactional distinction. It selects "do not re-consult the
        -- generic per-user notification settings", which is correct because CSF
        -- consent and address safety were already decided by
        -- plugin_data.csf_authorize_communication_dispatch(). Hashing it is what
        -- stops a worker flipping it to 'general' and having an authorized send
        -- silently dropped by an unrelated preference table.
        'type', 'transactional'
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_provider_request(
  uuid, uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_provider_request(
  uuid, uuid, uuid, uuid, integer
) TO service_role;

-- SHA-256 of the COMPLETE canonical provider request, tags and headers included.
--
-- The previous digest covered only sender, recipient, subject, bodies, and topic.
-- That was not coordinate-safe: the same approved copy legitimately re-sent to
-- the same adviser in next semester's campaign produces the same content, the
-- same address, and therefore the same digest -- so the derived idempotency key
-- collided and Resend, honoring its own key, would have dropped the second send
-- as a duplicate of the first. Including the coordinate and the exact tags is
-- what makes the key name ONE attempt of ONE campaign.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_provider_request_hash(
  p_request jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(coalesce(p_request, '{}'::jsonb)::text, 'sha256'),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_provider_request_hash(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_provider_request_hash(jsonb)
  TO service_role;

-- The provider idempotency key.
--
-- Resend accepts 1-256 characters and remembers a key for 24 hours; this ledger
-- remembers it forever, so the key must be globally unique and reproducible for
-- one attempt long after the provider has forgotten it. Both properties come
-- from the same digest: organization, campaign, recipient snapshot, attempt
-- number, and the complete request payload hash all feed it.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_idempotency_key(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_recipient_snapshot_id uuid,
  p_attempt_number integer,
  p_request_payload_hash text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- 8 + 64 + 1 + at most 2 = 75 characters, comfortably inside the 256 the
  -- provider allows and inside this table's own shape CHECK.
  --
  -- Built with the plain concatenation operator rather than concat_ws(): concat
  -- and concat_ws are STABLE, not IMMUTABLE, so using them here would make this
  -- function's declared volatility a lie.
  SELECT 'csf-att-' || pg_catalog.encode(
      extensions.digest(
        'v2:' || p_organization_id::text
          || ':' || p_campaign_id::text
          || ':' || p_recipient_snapshot_id::text
          || ':' || p_attempt_number::text
          || ':' || coalesce(p_request_payload_hash, ''),
        'sha256'
      ),
      'hex'
    )
    || '-' || p_attempt_number::text;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_idempotency_key(
  uuid, uuid, uuid, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_idempotency_key(
  uuid, uuid, uuid, integer, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_communication_provider_request(
  uuid, uuid, uuid, uuid, integer
) IS
  'The one canonical description of the exact provider request for one attempt coordinate, routing tags and headers included. The enqueue trigger hashes it and the dispatch-authorization RPC returns it, so a worker cannot silently add or omit a tag without changing the stored digest.';
COMMENT ON FUNCTION plugin_data.csf_communication_provider_request_hash(jsonb) IS
  'SHA-256 of the COMPLETE canonical provider request. Covers the attempt coordinate, exact tags, and exact headers, so identical approved copy re-sent in a later campaign hashes differently instead of colliding.';
COMMENT ON FUNCTION plugin_data.csf_communication_idempotency_key(
  uuid, uuid, uuid, integer, text
) IS
  'Derives the provider idempotency key from organization, campaign, recipient snapshot, attempt number, and the complete request payload hash. At most 75 characters, globally unique, and reproducible for the same attempt long after Resend''s own 24-hour window has closed.';

CREATE TABLE plugin_data.csf_communication_dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  recipient_snapshot_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  provider_idempotency_key text NOT NULL,
  content_hash text NOT NULL,
  -- Server-derived digest of the exact provider request this attempt sends.
  -- The idempotency key is derived from it, so the key cannot name a request
  -- other than the one that was actually built.
  request_payload_hash text NOT NULL,
  recipient_email_hash text NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  lease_count integer NOT NULL DEFAULT 0,
  -- CLAIMING IS NOT AUTHORIZATION TO SEND.
  --
  -- A lease may last up to 1800 seconds, and a recipient can opt out or bounce
  -- inside that window, so the claim result is deliberately not a sendable
  -- payload. A worker must call
  -- plugin_data.csf_authorize_communication_dispatch() immediately before it
  -- talks to the provider; that call re-evaluates current consent AND current
  -- address safety and stamps this column with the moment it handed over the
  -- exact request.
  dispatch_authorized_at timestamptz,
  dispatch_authorized_to text,
  correlation_id text,
  -- WHO SETTLED THIS, WHICH DECIDES WHAT A LATER REPORT MEANS.
  --
  -- Resend can deliver a signed webhook before the worker's own HTTP response
  -- comes back, so the provider's evidence legitimately settles an attempt that is
  -- still 'processing'. When the worker's response finally arrives it is a
  -- CONFIRMATION of a settlement that already happened, not a conflicting second
  -- settlement -- and without recording which side settled first there is no way to
  -- tell those apart. Getting it wrong either raises a spurious conflict at the
  -- worker or lets a real double-settlement through.
  settlement_source text,
  worker_confirmed_at timestamptz,
  provider_message_id text,
  provider_status_code integer,
  failure_class text,
  outcome_detail text,
  unknown_reason text,
  review_state text NOT NULL DEFAULT 'none',
  -- Escalation and final reconciliation are separate write-once records, so
  -- 'human_review' can be followed by exactly one later final resolution
  -- without either overwriting the other.
  escalated_at timestamptz,
  escalated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalation_reason text,
  reconciled_outcome text,
  reconciled_at timestamptz,
  -- 'staff' when a human decided what the provider never told us, 'provider'
  -- when verified webhook evidence finally arrived and settled it on its own.
  -- Keeping them distinct matters: an audit must be able to tell "somebody made
  -- a call" apart from "the provider eventually said so".
  reconciled_actor_kind text,
  reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reconciled_by_identity text,
  reconciliation_reason text,
  settled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_communication_dispatch_attempts_id_organization_id_key
    UNIQUE (id, organization_id),
  -- Stable attempt coordinate. This is what makes a replayed worker call a
  -- no-op instead of a second send.
  CONSTRAINT csf_communication_dispatch_attempts_coordinate_key
    UNIQUE (organization_id, campaign_id, recipient_snapshot_id, attempt_number),
  -- Global on purpose; see the header note about the shared Resend account.
  CONSTRAINT csf_communication_dispatch_attempts_provider_idempotency_key
    UNIQUE (provider_idempotency_key),
  -- One composite reference proves organization, campaign, and recipient agree
  -- between the attempt and the delivery it belongs to.
  CONSTRAINT csf_communication_dispatch_attempts_delivery_fkey
    FOREIGN KEY (delivery_id, organization_id, campaign_id, recipient_snapshot_id)
    REFERENCES plugin_data.csf_communication_deliveries
      (id, organization_id, campaign_id, recipient_snapshot_id)
    ON DELETE CASCADE,
  CONSTRAINT csf_communication_dispatch_attempts_state_check
    CHECK (state IN (
      'queued',
      'processing',
      'accepted',
      'delivered',
      'bounced',
      'complained',
      'suppressed',
      'failed',
      'retryable_failure',
      'unknown_outcome'
    )),
  CONSTRAINT csf_communication_dispatch_attempts_attempt_number_check
    CHECK (attempt_number >= 1),
  CONSTRAINT csf_communication_dispatch_attempts_lease_count_check
    CHECK (lease_count >= 0),
  CONSTRAINT csf_communication_dispatch_attempts_idempotency_shape_check
    CHECK (
      nullif(btrim(provider_idempotency_key), '') IS NOT NULL
      AND provider_idempotency_key = btrim(provider_idempotency_key)
      AND provider_idempotency_key !~ '\s'
      AND char_length(provider_idempotency_key) <= 256
    ),
  CONSTRAINT csf_communication_dispatch_attempts_hash_shapes_check
    CHECK (
      content_hash ~ '^[0-9a-f]{64}$'
      AND request_payload_hash ~ '^[0-9a-f]{64}$'
      AND recipient_email_hash ~ '^[0-9a-f]{64}$'
    ),
  -- A provider that handed back a message identity ACCEPTED the send. Auto
  -- retrying that is a duplicate send, so the two facts are made mutually
  -- exclusive at the schema level: such a response is 'accepted', or -- if the
  -- worker genuinely cannot tell -- 'unknown_outcome', never a retryable one.
  CONSTRAINT csf_comm_attempt_retryable_no_message_check
    CHECK (state <> 'retryable_failure' OR provider_message_id IS NULL),
  -- A lease is all-or-nothing, and only a processing attempt holds one.
  CONSTRAINT csf_communication_dispatch_attempts_lease_shape_check
    CHECK (
      (lease_owner IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL)
      OR (
        lease_owner IS NOT NULL
        AND leased_at IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at > leased_at
        AND nullif(btrim(lease_owner), '') IS NOT NULL
        AND char_length(lease_owner) <= 128
      )
    ),
  CONSTRAINT csf_communication_dispatch_attempts_processing_lease_check
    CHECK (state <> 'processing' OR lease_owner IS NOT NULL),
  -- Queued and processing are the only unsettled states.
  CONSTRAINT csf_communication_dispatch_attempts_settled_check
    CHECK ((state IN ('queued', 'processing')) = (settled_at IS NULL)),
  -- UNKNOWN OUTCOME SAFETY, expressed structurally: an unknown outcome always
  -- says why, and always sits in a review queue.
  CONSTRAINT csf_communication_dispatch_attempts_unknown_review_check
    CHECK (
      state <> 'unknown_outcome'
      OR (
        unknown_reason IS NOT NULL
        AND review_state IN ('pending', 'escalated', 'resolved')
      )
    ),
  CONSTRAINT csf_communication_dispatch_attempts_review_state_check
    CHECK (review_state IN ('none', 'pending', 'escalated', 'resolved')),
  -- A final reconciliation is all-or-nothing evidence: outcome, time, actor
  -- kind, and reason are written together or not at all.
  CONSTRAINT csf_communication_dispatch_attempts_reconciled_pair_check
    CHECK (
      (reconciled_at IS NULL) = (reconciled_outcome IS NULL)
      AND (reconciled_at IS NULL) = (reconciliation_reason IS NULL)
      AND (reconciled_at IS NULL) = (reconciled_actor_kind IS NULL)
      AND (
        reconciled_at IS NULL
        OR (
          nullif(btrim(reconciliation_reason), '') IS NOT NULL
          AND char_length(reconciliation_reason) <= 300
        )
      )
    ),
  -- A HUMAN DECISION AND PROVIDER EVIDENCE ARE DIFFERENT CLAIMS. Provider
  -- evidence never names an account, so it can never be mistaken for somebody's
  -- judgement call.
  --
  -- The converse -- staff MUST name an account -- is enforced by the lifecycle
  -- trigger at write time rather than here, because reconciled_by is
  -- ON DELETE SET NULL and a CHECK would make removing an officer's account fail
  -- against their own past decisions. reconciled_by_identity is the durable
  -- record that survives the detach.
  CONSTRAINT csf_comm_attempt_reconciled_actor_check
    CHECK (
      reconciled_actor_kind IS NULL
      OR (
        reconciled_actor_kind IN ('staff', 'provider')
        AND (reconciled_actor_kind <> 'provider' OR reconciled_by IS NULL)
        AND (reconciled_actor_kind <> 'staff' OR reconciled_by_identity IS NOT NULL)
      )
    ),
  CONSTRAINT csf_comm_attempt_reconciled_identity_check
    CHECK (
      reconciled_by_identity IS NULL
      OR (
        nullif(btrim(reconciled_by_identity), '') IS NOT NULL
        AND char_length(reconciled_by_identity) <= 320
      )
    ),
  -- 'human_review' is an escalation, not a final outcome, so it is recorded in
  -- its own write-once columns and is deliberately absent from this list.
  CONSTRAINT csf_communication_dispatch_attempts_reconciled_outcome_check
    CHECK (
      reconciled_outcome IS NULL
      OR reconciled_outcome IN (
        'delivered',
        'bounced',
        'complained',
        'suppressed',
        'failed'
      )
    ),
  CONSTRAINT csf_comm_attempt_escalation_pair_check
    CHECK (
      (escalated_at IS NULL) = (escalation_reason IS NULL)
      AND (
        escalated_at IS NULL
        OR (
          nullif(btrim(escalation_reason), '') IS NOT NULL
          AND char_length(escalation_reason) <= 300
        )
      )
    ),
  -- A settled non-unknown state that carries a reconciliation must agree with
  -- it. This is what makes "every exit from unknown_outcome has coherent
  -- evidence" checkable at rest and not only at transition time.
  CONSTRAINT csf_comm_attempt_reconciled_state_check
    CHECK (reconciled_outcome IS NULL OR reconciled_outcome = state),
  CONSTRAINT csf_communication_dispatch_attempts_status_code_check
    CHECK (provider_status_code IS NULL OR provider_status_code BETWEEN 100 AND 599),
  CONSTRAINT csf_communication_dispatch_attempts_bounded_text_check
    CHECK (
      (failure_class IS NULL OR char_length(failure_class) <= 64)
      AND (outcome_detail IS NULL OR char_length(outcome_detail) <= 1000)
      AND (unknown_reason IS NULL OR char_length(unknown_reason) <= 300)
      AND (provider_message_id IS NULL OR char_length(provider_message_id) <= 255)
    ),
  CONSTRAINT csf_communication_dispatch_attempts_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT csf_communication_dispatch_attempts_no_raw_content_check
    CHECK (NOT plugin_data.csf_jsonb_carries_raw_content(metadata)),
  -- Authorization is all-or-nothing and names the worker it was granted to, so
  -- "which worker was handed this exact request" is answerable after the fact.
  CONSTRAINT csf_comm_attempt_authorization_pair_check
    CHECK (
      (dispatch_authorized_at IS NULL) = (dispatch_authorized_to IS NULL)
      AND (
        dispatch_authorized_to IS NULL
        OR (
          nullif(btrim(dispatch_authorized_to), '') IS NOT NULL
          AND char_length(dispatch_authorized_to) <= 128
        )
      )
    ),
  -- An authorization can only have been granted to a leaseholder, so it can
  -- never appear on an attempt that was never claimed.
  CONSTRAINT csf_comm_attempt_authorization_order_check
    CHECK (dispatch_authorized_at IS NULL OR lease_count >= 1),
  CONSTRAINT csf_comm_attempt_correlation_check
    CHECK (
      correlation_id IS NULL
      OR (
        nullif(btrim(correlation_id), '') IS NOT NULL
        AND correlation_id !~ '\s'
        AND char_length(correlation_id) <= 128
      )
    ),
  -- A settled attempt always names what settled it; an unsettled one never can.
  CONSTRAINT csf_comm_attempt_settlement_source_check
    CHECK (
      (settled_at IS NULL) = (settlement_source IS NULL)
      AND (
        settlement_source IS NULL
        OR settlement_source IN (
          'worker', 'provider', 'reaper', 'cancellation', 'dispatch_refused'
        )
      )
    ),
  -- A worker confirmation only makes sense on an already-settled attempt.
  CONSTRAINT csf_comm_attempt_worker_confirmation_check
    CHECK (worker_confirmed_at IS NULL OR settled_at IS NOT NULL)
);

-- At most one live attempt per recipient. This index -- not a read-then-write
-- check -- arbitrates two workers or two restarts racing the same recipient:
-- both reach the insert and exactly one survives.
CREATE UNIQUE INDEX csf_communication_dispatch_attempts_live_idx
  ON plugin_data.csf_communication_dispatch_attempts (
    organization_id,
    campaign_id,
    recipient_snapshot_id
  )
  WHERE state IN ('queued', 'processing');

-- The claim query, exactly: state = 'queued' AND available_at <= now(),
-- ordered by available_at then id, bounded by LIMIT, with SKIP LOCKED.
CREATE INDEX csf_communication_dispatch_attempts_claim_idx
  ON plugin_data.csf_communication_dispatch_attempts (
    organization_id,
    available_at,
    id
  )
  WHERE state = 'queued';

-- The lease reaper, which runs at the head of every claim.
CREATE INDEX csf_communication_dispatch_attempts_lease_expiry_idx
  ON plugin_data.csf_communication_dispatch_attempts (lease_expires_at)
  WHERE state = 'processing';

-- Campaign progress and per-state counts, and the tenant index for the
-- campaign relation.
CREATE INDEX csf_communication_dispatch_attempts_campaign_state_idx
  ON plugin_data.csf_communication_dispatch_attempts (
    organization_id,
    campaign_id,
    state
  );

-- Per-delivery attempt history, newest attempt first. Also the index the
-- composite delivery foreign key walks on cascade.
CREATE INDEX csf_communication_dispatch_attempts_delivery_idx
  ON plugin_data.csf_communication_dispatch_attempts (
    organization_id,
    delivery_id,
    attempt_number DESC
  );

-- The unknown-outcome worklist.
CREATE INDEX csf_communication_dispatch_attempts_review_idx
  ON plugin_data.csf_communication_dispatch_attempts (
    organization_id,
    review_state,
    settled_at DESC,
    id DESC
  )
  WHERE review_state <> 'none';

-- Enqueue guard. Attempt numbering is derived here rather than trusted from the
-- caller, so it is monotonic by construction: a worker cannot renumber a retry
-- into an already-allocated coordinate, and a legacy delivery that recorded
-- attempts before this ledger existed resumes above its recorded attempt count
-- instead of colliding with it.
--
-- Content binding is derived here too. The attempt copies the campaign's
-- content hash and the snapshot's address digest, which is what makes
-- "the key was allocated for this exact content" a fact rather than a promise.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_dispatch_attempt_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_snapshot plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  v_delivery plugin_data.csf_communication_deliveries%ROWTYPE;
  v_previous_state text;
  v_highest integer;
BEGIN
  IF NEW.state <> 'queued' OR NEW.settled_at IS NOT NULL THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt is always created queued and unsettled; settle it through plugin_data.csf_settle_communication_dispatch_attempt().'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lease_owner IS NOT NULL THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt is created without a lease; a lease is granted only by plugin_data.csf_claim_communication_dispatch_batch().'
      USING ERRCODE = '23514';
  END IF;

  -- Serializes attempt allocation for one recipient. The live-attempt unique
  -- index is still the arbiter; this lock keeps the derived number stable.
  SELECT delivery.*
  INTO v_delivery
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.id = NEW.delivery_id
    AND delivery.organization_id = NEW.organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF delivery for this dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_delivery.campaign_id <> NEW.campaign_id
    OR v_delivery.recipient_snapshot_id <> NEW.recipient_snapshot_id
  THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt must name the campaign and recipient of the delivery it belongs to.'
      USING ERRCODE = '23503';
  END IF;

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = NEW.campaign_id
    AND campaign.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF campaign for this dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.content_hash IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign without a content digest is not dispatch-ready and cannot allocate a provider idempotency key.'
      USING ERRCODE = '23514';
  END IF;

  IF v_campaign.audience_finalized_at IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign audience must be finalized before any dispatch attempt is enqueued.'
      USING ERRCODE = '23514';
  END IF;

  IF v_campaign.status NOT IN ('queued', 'sending') THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt may only be enqueued while its campaign is queued or sending.'
      USING ERRCODE = '23514';
  END IF;

  SELECT snapshot.*
  INTO v_snapshot
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.id = NEW.recipient_snapshot_id
    AND snapshot.organization_id = NEW.organization_id
    AND snapshot.campaign_id = NEW.campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF audience snapshot for this dispatch attempt does not exist in this campaign.'
      USING ERRCODE = '23503';
  END IF;

  IF v_snapshot.subscription_decision <> 'included' THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt may only be enqueued for an audience snapshot whose subscription decision is included.'
      USING ERRCODE = '23514';
  END IF;

  IF v_snapshot.content_hash IS DISTINCT FROM v_campaign.content_hash THEN
    RAISE EXCEPTION
      'A CSF audience snapshot was taken against different campaign content than the one being dispatched; rebuild the audience.'
      USING ERRCODE = '23514';
  END IF;

  -- Derived, never trusted.
  NEW.content_hash := v_campaign.content_hash;
  NEW.recipient_email_hash := v_snapshot.recipient_email_hash;

  SELECT attempt.state
  INTO v_previous_state
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.organization_id = NEW.organization_id
    AND attempt.campaign_id = NEW.campaign_id
    AND attempt.recipient_snapshot_id = NEW.recipient_snapshot_id
  ORDER BY attempt.attempt_number DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_previous_state = 'unknown_outcome' THEN
      RAISE EXCEPTION
        'A CSF dispatch attempt with an unknown provider outcome can never be retried; reconcile it or resolve it through human review.'
        USING ERRCODE = '23514';
    END IF;

    IF v_previous_state IN ('queued', 'processing') THEN
      RAISE EXCEPTION
        'A CSF recipient already has a live dispatch attempt; settle it before enqueuing another.'
        USING ERRCODE = '23514';
    END IF;

    IF v_previous_state <> 'retryable_failure' THEN
      RAISE EXCEPTION
        'Only a retryable CSF dispatch failure may be followed by another attempt; "%" is settled.',
        v_previous_state
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT coalesce(max(attempt.attempt_number), 0)
  INTO v_highest
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.organization_id = NEW.organization_id
    AND attempt.campaign_id = NEW.campaign_id
    AND attempt.recipient_snapshot_id = NEW.recipient_snapshot_id;

  NEW.attempt_number := greatest(v_highest, coalesce(v_delivery.attempt_count, 0)) + 1;

  -- The request digest is computed here, from the stored campaign and the frozen
  -- snapshot, over the COMPLETE canonical request -- attempt coordinate, routing
  -- tags, and headers included. Derived after attempt_number so the digest
  -- covers the coordinate it was actually allocated for.
  NEW.request_payload_hash := plugin_data.csf_communication_provider_request_hash(
    plugin_data.csf_communication_provider_request(
      NEW.organization_id,
      NEW.campaign_id,
      NEW.recipient_snapshot_id,
      NEW.id,
      NEW.attempt_number
    )
  );

  -- The provider key is BOUND to the exact request digest AND to the attempt
  -- coordinate, not merely to a caller-declared content hash. A caller cannot
  -- supply its own: the key is overwritten unconditionally, so a key can never
  -- name a request other than the one about to be sent, a replay of the same
  -- coordinate reproduces the same key, and the same approved copy re-sent in a
  -- later campaign gets a DIFFERENT key instead of colliding with the first
  -- send. Resend's own 24-hour idempotency window is a convenience on top of
  -- this ledger, never a substitute for it.
  NEW.provider_idempotency_key := plugin_data.csf_communication_idempotency_key(
    NEW.organization_id,
    NEW.campaign_id,
    NEW.recipient_snapshot_id,
    NEW.attempt_number,
    NEW.request_payload_hash
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_dispatch_attempts_enqueue
BEFORE INSERT ON plugin_data.csf_communication_dispatch_attempts
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_dispatch_attempt_enqueue();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_dispatch_attempt_enqueue()
  FROM PUBLIC, anon, authenticated;

-- Attempt truth only moves forward, and there is NO backward edge at all.
--
-- The obvious lease reaper -- "the lease lapsed, put the work back on the queue"
-- -- is a duplicate-send generator. A worker that holds a lease may have written
-- the exact request to Resend and died before it could settle: from the ledger's
-- side, "crashed before sending" and "sent, then crashed" are indistinguishable.
-- Requeueing therefore resends an unknown number of already-accepted messages,
-- and Resend's own idempotency window closes after 24 hours, so it will not save
-- us either.
--
-- So the processing -> queued edge does not exist. A lapsed lease settles as
-- 'unknown_outcome' (see plugin_data.csf_reap_communication_dispatch_leases()),
-- which is honest about what is actually known and puts a human in the loop.
-- Only a state PROVEN to be pre-provider could safely return to the queue, and
-- 'processing' is not that state.
--
-- Everything a provider key was allocated against is frozen, and so is every
-- piece of evidence a settled attempt recorded.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_dispatch_attempt_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_comm_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_deliveries AS delivery
      WHERE delivery.id = OLD.delivery_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF dispatch attempt history cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  -- Once a provider idempotency key is allocated, neither the key nor the
  -- request it was allocated against may change.
  IF ROW(
    NEW.id, NEW.organization_id, NEW.campaign_id, NEW.recipient_snapshot_id,
    NEW.delivery_id, NEW.attempt_number, NEW.provider_idempotency_key,
    NEW.content_hash, NEW.request_payload_hash, NEW.recipient_email_hash,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.campaign_id, OLD.recipient_snapshot_id,
    OLD.delivery_id, OLD.attempt_number, OLD.provider_idempotency_key,
    OLD.content_hash, OLD.request_payload_hash, OLD.recipient_email_hash,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt identity, provider idempotency key, and bound request digest are frozen once the key is allocated.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.lease_count < OLD.lease_count THEN
    RAISE EXCEPTION 'A CSF dispatch attempt lease count can never decrease.'
      USING ERRCODE = '23514';
  END IF;

  -- The moment the exact request left the ledger is written once. Rewriting it
  -- would let an operator make a dispatched attempt look as though it had never
  -- been authorized, which is the one fact that decides whether an ambiguous
  -- outcome could have reached the provider.
  IF OLD.dispatch_authorized_at IS NOT NULL
    AND ROW(NEW.dispatch_authorized_at, NEW.dispatch_authorized_to)
      IS DISTINCT FROM ROW(OLD.dispatch_authorized_at, OLD.dispatch_authorized_to)
  THEN
    RAISE EXCEPTION
      'A CSF dispatch authorization is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  -- SETTLED ATTEMPT EVIDENCE IS FROZEN.
  --
  -- A settled attempt is the record of what the provider actually said. Editing
  -- the status code, failure class, detail, unknown reason, or operational
  -- metadata afterwards rewrites that record, and every later decision -- whether
  -- to retry, whether a recipient was mailed, whether an address is safe -- reads
  -- it.
  --
  -- The single exception is the one statement that first records a
  -- reconciliation: resolving an unknown outcome legitimately replaces the
  -- placeholder detail with the decision a human actually made, and the
  -- write-once reconciliation columns above make that statement unrepeatable.
  IF OLD.settled_at IS NOT NULL
    AND ROW(
      NEW.provider_status_code, NEW.failure_class, NEW.outcome_detail,
      NEW.unknown_reason, NEW.metadata
    ) IS DISTINCT FROM ROW(
      OLD.provider_status_code, OLD.failure_class, OLD.outcome_detail,
      OLD.unknown_reason, OLD.metadata
    )
    AND NOT (OLD.reconciled_at IS NULL AND NEW.reconciled_at IS NOT NULL)
  THEN
    RAISE EXCEPTION
      'CSF dispatch attempt evidence is frozen once the attempt settles; only a first reconciliation may record its own decision.'
      USING ERRCODE = '23514';
  END IF;

  -- Review and reconciliation evidence is frozen at the table, not only in the
  -- RPC that normally writes it. These checks run for EVERY UPDATE that reaches
  -- this ledger -- including one the owner issues from a different RPC or a
  -- backfill -- so no single function is the only thing standing between an
  -- operator and a rewritten audit trail. service_role cannot issue such an
  -- UPDATE at all; section J leaves it SELECT-only. This is the layer behind
  -- that missing privilege, for the one role the privilege cannot stop.
  IF plugin_data.csf_comm_review_state_rank(NEW.review_state)
    < plugin_data.csf_comm_review_state_rank(OLD.review_state)
  THEN
    RAISE EXCEPTION
      'CSF dispatch review state is monotonic; it never returns to an earlier stage.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'unknown_outcome' AND NEW.review_state = 'none' THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt with an unknown provider outcome always carries a review state.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.escalated_at IS NOT NULL
    AND ROW(NEW.escalated_at, NEW.escalated_by, NEW.escalation_reason)
      IS DISTINCT FROM ROW(OLD.escalated_at, OLD.escalated_by, OLD.escalation_reason)
    -- An escalating actor account being removed detaches the reference; that is
    -- referential teardown, not a rewrite.
    AND NOT (
      NEW.escalated_by IS NULL
      AND OLD.escalated_by IS NOT NULL
      AND NEW.escalated_at IS NOT DISTINCT FROM OLD.escalated_at
      AND NEW.escalation_reason IS NOT DISTINCT FROM OLD.escalation_reason
    )
  THEN
    RAISE EXCEPTION
      'CSF dispatch escalation evidence is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.reconciled_at IS NOT NULL
    AND ROW(
      NEW.reconciled_at, NEW.reconciled_outcome, NEW.reconciled_actor_kind,
      NEW.reconciled_by, NEW.reconciled_by_identity, NEW.reconciliation_reason
    ) IS DISTINCT FROM ROW(
      OLD.reconciled_at, OLD.reconciled_outcome, OLD.reconciled_actor_kind,
      OLD.reconciled_by, OLD.reconciled_by_identity, OLD.reconciliation_reason
    )
    AND NOT (
      NEW.reconciled_by IS NULL
      AND OLD.reconciled_by IS NOT NULL
      AND NEW.reconciled_at IS NOT DISTINCT FROM OLD.reconciled_at
      AND NEW.reconciled_outcome IS NOT DISTINCT FROM OLD.reconciled_outcome
      AND NEW.reconciled_actor_kind IS NOT DISTINCT FROM OLD.reconciled_actor_kind
      AND NEW.reconciled_by_identity IS NOT DISTINCT FROM OLD.reconciled_by_identity
      AND NEW.reconciliation_reason IS NOT DISTINCT FROM OLD.reconciliation_reason
    )
  THEN
    RAISE EXCEPTION
      'CSF dispatch reconciliation evidence is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  -- Every exit from an unknown provider outcome must arrive with complete,
  -- coherent evidence in the very same statement.
  --
  -- There are exactly two kinds of evidence that can settle an ambiguous send: a
  -- named human who decided, or verified provider webhook evidence that finally
  -- arrived. Both are recorded; neither may pretend to be the other.
  IF OLD.state = 'unknown_outcome' AND NEW.state <> 'unknown_outcome' THEN
    IF NEW.reconciled_at IS NULL
      OR NEW.reconciled_outcome IS NULL
      OR NEW.reconciled_actor_kind IS NULL
      OR NEW.reconciliation_reason IS NULL
      OR NEW.reconciled_outcome <> NEW.state
      OR NEW.review_state <> 'resolved'
      OR (NEW.reconciled_actor_kind = 'staff' AND NEW.reconciled_by IS NULL)
    THEN
      RAISE EXCEPTION
        'Leaving a CSF unknown provider outcome requires a recorded resolution, actor, reason, and matching final state.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.settled_at IS NOT NULL AND NEW.settled_at IS DISTINCT FROM OLD.settled_at THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt settlement time is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_message_id IS NOT NULL
    AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
  THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt provider message identity is frozen once recorded.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    -- UNKNOWN OUTCOME SAFETY. Checked before the general table so the caller
    -- gets the reason that matters rather than a generic transition error.
    IF OLD.state = 'unknown_outcome' AND NEW.state IN ('queued', 'processing') THEN
      RAISE EXCEPTION
        'A CSF dispatch attempt with an unknown provider outcome can never be retried; reconcile it or resolve it through human review.'
        USING ERRCODE = '23514';
    END IF;

    -- NO REQUEUE, EVER. Checked before the general table so a caller that tries
    -- the obvious lease-reaper edge gets told why it is unsafe rather than a
    -- generic transition error.
    IF NEW.state = 'queued' THEN
      RAISE EXCEPTION
        'A CSF dispatch attempt never returns to the queue; a leaseholder may already have handed the request to the provider, so a lapsed lease settles as unknown_outcome instead.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      -- queued -> unknown_outcome exists for exactly one case: signed provider
      -- evidence naming an attempt the ledger never authorized for dispatch. That
      -- contradiction cannot be called a success and must not stay claimable, and
      -- "nobody can say whether this recipient was mailed" is the honest answer.
      -- The edge is safe to allow generally because unknown_outcome is strictly
      -- MORE terminal than queued: it is unretryable by the rule above, it carries a
      -- mandatory review state and reason, and the enqueue guard refuses any
      -- successor behind it.
      (OLD.state = 'queued' AND NEW.state IN (
        'processing', 'failed', 'suppressed', 'unknown_outcome'
      ))
      OR (OLD.state = 'processing' AND NEW.state IN (
        'accepted', 'failed', 'retryable_failure', 'suppressed', 'unknown_outcome'
      ))
      OR (OLD.state = 'accepted' AND NEW.state IN (
        'delivered', 'bounced', 'complained', 'suppressed', 'failed'
      ))
      OR (OLD.state = 'delivered' AND NEW.state = 'complained')
      OR (OLD.state = 'unknown_outcome' AND NEW.state IN (
        'delivered', 'bounced', 'complained', 'suppressed', 'failed'
      ))
    ) THEN
      RAISE EXCEPTION
        'A CSF dispatch attempt may not move from "%" to "%"; attempt state only advances.',
        OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_dispatch_attempts_lifecycle
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_dispatch_attempts
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_dispatch_attempt_lifecycle();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_dispatch_attempt_lifecycle()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE plugin_data.csf_communication_dispatch_attempts IS
  'Durable per-try dispatch ledger: queue, lease, locally authoritative provider idempotency allocation, and settled outcome. UNKNOWN OUTCOME SAFETY: an attempt settled as unknown_outcome can only be reconciled against provider evidence or resolved by human review; it can never return to queued or processing. Server-only: no browser role holds any privilege on this table.';
COMMENT ON COLUMN plugin_data.csf_communication_dispatch_attempts.provider_idempotency_key IS
  'Locally authoritative idempotency key. Unique globally rather than per organization because it is presented to one shared Resend account, and honored here long after Resend''s own idempotency window has closed.';
COMMENT ON COLUMN plugin_data.csf_communication_dispatch_attempts.content_hash IS
  'Campaign content digest this key was allocated against, copied by the enqueue trigger and frozen by the lifecycle trigger. Content cannot be mutated behind an allocated key.';
COMMENT ON COLUMN plugin_data.csf_communication_dispatch_attempts.lease_expires_at IS
  'When this attempt''s lease lapses. A lapsed lease does NOT return the attempt to the queue: the holder may already have handed the request to the provider, so plugin_data.csf_reap_communication_dispatch_leases() settles it as unknown_outcome for review instead.';
COMMENT ON COLUMN plugin_data.csf_communication_dispatch_attempts.unknown_reason IS
  'Why the provider outcome is unknown. Required for the unknown_outcome state, which is settled and unretryable by construction.';
COMMENT ON COLUMN plugin_data.csf_communication_dispatch_attempts.dispatch_authorized_at IS
  'When plugin_data.csf_authorize_communication_dispatch() re-checked consent and address safety and handed this worker the exact provider request. A lease alone authorizes nothing: it may last 1800 seconds, and a recipient can opt out or bounce inside that window.';
COMMENT ON FUNCTION plugin_data.csf_enforce_dispatch_attempt_enqueue() IS
  'Derives monotonic attempt numbers, the complete-request digest, and the coordinate-bound provider key; proves campaign/recipient/delivery ownership and dispatch readiness; and refuses to open a new attempt behind a live or unknown-outcome one.';
COMMENT ON FUNCTION plugin_data.csf_enforce_dispatch_attempt_lifecycle() IS
  'Freezes attempt identity, its allocated provider key, its authorization stamp, and all settled evidence; enforces forward-only attempt states with NO edge back to queued; and refuses every retry of an unknown outcome.';

-- ---------------------------------------------------------------------------
-- H. Provider webhook verification and reduction state
--
-- The database does not verify signatures and does not pretend to. The
-- application verifies the signature over the exact raw request body, then
-- calls the recording RPC with the digest of that same body and the
-- verification metadata. What the database guarantees is narrower and
-- checkable: a refusal to record anything the caller has not asserted as
-- verified, deduplication by envelope id, an allowlist on what may be stored,
-- and a conservative reduction that never downgrades a safety state.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_communication_provider_events
  ADD COLUMN signature_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN signature_verified_at timestamptz,
  ADD COLUMN signature_scheme text,
  ADD COLUMN signature_key_id text,
  -- The attempt this evidence resolved against, learned from the signed
  -- csf_attempt_id routing tag or from the delivery the provider message names.
  -- Bound at most once, exactly like delivery_id.
  ADD COLUMN attempt_id uuid,
  -- occurred_at is NOT NULL in 20260730001001 and therefore always holds
  -- something. provider_occurred_at holds the time the PROVIDER actually
  -- reported, and is NULL when the provider reported none. Only a real provider
  -- time is authoritative, so only a non-null value here may reduce.
  ADD COLUMN provider_occurred_at timestamptz,
  ADD COLUMN processing_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN reduction_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN reduced_to_status text,
  ADD COLUMN reduced_at timestamptz,
  ADD COLUMN ignored_reason text;

ALTER TABLE plugin_data.csf_communication_provider_events
  -- One composite reference proves the attempt agrees with this event about the
  -- organization. SET NULL rather than CASCADE: purging an attempt must not
  -- silently discard the provider's own account of what happened.
  ADD CONSTRAINT csf_comm_event_attempt_fkey
    FOREIGN KEY (attempt_id, organization_id)
    REFERENCES plugin_data.csf_communication_dispatch_attempts (id, organization_id)
    ON DELETE SET NULL (attempt_id),
  ADD CONSTRAINT csf_communication_provider_events_signature_pair_check
    CHECK (signature_verified = (signature_verified_at IS NOT NULL)),
  ADD CONSTRAINT csf_communication_provider_events_signature_scheme_check
    CHECK (
      signature_scheme IS NULL
      OR (signature_scheme IN ('svix') AND signature_verified)
    ),
  ADD CONSTRAINT csf_communication_provider_events_signature_key_id_check
    CHECK (
      signature_key_id IS NULL
      OR (
        nullif(btrim(signature_key_id), '') IS NOT NULL
        AND char_length(signature_key_id) <= 128
      )
    ),
  ADD CONSTRAINT csf_communication_provider_events_processing_state_check
    CHECK (processing_state IN (
      'pending',
      'reduced',
      'unmatched',
      'ignored_unknown_type',
      'ignored_stale',
      'ignored_terminal',
      'ignored_conflict',
      'ignored_no_provider_time'
    )),
  ADD CONSTRAINT csf_comm_event_provider_time_check
    CHECK (provider_occurred_at IS NULL OR provider_occurred_at = occurred_at),
  -- Only verified, time-stamped evidence may ever have moved delivery truth.
  -- Rows recorded before this migration default to signature_verified = false
  -- and provider_occurred_at NULL, so they are structurally unverified and
  -- structurally non-reducible.
  ADD CONSTRAINT csf_comm_event_verified_reduction_check
    CHECK (
      NOT reduction_applied
      OR (
        signature_verified
        AND signature_scheme IS NOT NULL
        AND signature_verified_at IS NOT NULL
        AND provider_occurred_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT csf_communication_provider_events_reduced_pair_check
    CHECK (
      reduction_applied = (reduced_at IS NOT NULL)
      AND (reduced_to_status IS NULL OR reduction_applied)
      AND (NOT reduction_applied OR processing_state = 'reduced')
    ),
  ADD CONSTRAINT csf_communication_provider_events_reduced_status_check
    CHECK (
      reduced_to_status IS NULL
      OR plugin_data.csf_communication_delivery_state_rank(reduced_to_status) IS NOT NULL
    ),
  ADD CONSTRAINT csf_communication_provider_events_ignored_reason_check
    CHECK (
      ignored_reason IS NULL
      OR (
        nullif(btrim(ignored_reason), '') IS NOT NULL
        AND char_length(ignored_reason) <= 200
      )
    ),
  -- Positive rule to complement 20260730001001's raw-content denylist.
  --
  -- The name matters. PostgreSQL evaluates a relation's CHECK constraints in
  -- constraint-name order, and a document carrying a raw body fails this rule
  -- AND the denylist rule. Sorting "operational_allowlist" after
  -- "no_raw_content" keeps the denylist's more specific diagnostic as the one a
  -- writer actually sees, which is what the 20260730001001 suite asserts.
  ADD CONSTRAINT csf_communication_provider_events_operational_allowlist_check
    CHECK (plugin_data.csf_provider_event_metadata_allowlisted(metadata));

-- Per-attempt provider evidence: "what did the provider say about this exact
-- try?" -- the question a review screen asks about an unknown outcome.
CREATE INDEX csf_comm_event_attempt_idx
  ON plugin_data.csf_communication_provider_events (organization_id, attempt_id)
  WHERE attempt_id IS NOT NULL;

-- The reduction backlog: events recorded but not yet resolved against a
-- delivery, usually because the webhook beat the delivery row.
CREATE INDEX csf_communication_provider_events_reduction_idx
  ON plugin_data.csf_communication_provider_events (
    organization_id,
    processing_state,
    occurred_at,
    id
  )
  WHERE processing_state IN ('pending', 'unmatched');

-- Reduction bookkeeping settles once. 20260730001001 already froze the
-- evidential columns; this covers the columns added above so a second pass
-- cannot quietly rewrite what a first pass concluded.
CREATE OR REPLACE FUNCTION plugin_data.csf_freeze_provider_event_reduction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW.signature_verified, NEW.signature_verified_at, NEW.signature_scheme,
    NEW.signature_key_id
  ) IS DISTINCT FROM ROW(
    OLD.signature_verified, OLD.signature_verified_at, OLD.signature_scheme,
    OLD.signature_key_id
  ) THEN
    RAISE EXCEPTION
      'CSF provider webhook signature verification metadata is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_occurred_at IS DISTINCT FROM NEW.provider_occurred_at THEN
    RAISE EXCEPTION
      'The provider occurrence time on CSF webhook evidence is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  -- Two settlements are legal, and only two:
  --   pending   -> any settled state, when the event is first recorded, and
  --   unmatched -> reduced | ignored_*, when a webhook that arrived before its
  --                delivery row is later rebound to it.
  -- Everything else is frozen, so an operator cannot re-run a reduction.
  IF NEW.processing_state IS DISTINCT FROM OLD.processing_state
    AND NOT (
      OLD.processing_state = 'pending'
      OR (
        OLD.processing_state = 'unmatched'
        AND (
          NEW.processing_state = 'reduced'
          OR NEW.processing_state LIKE 'ignored\_%'
        )
      )
    )
  THEN
    RAISE EXCEPTION
      'A CSF provider webhook event settles once; only unmatched evidence may later be rebound.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.reduction_applied AND NOT NEW.reduction_applied THEN
    RAISE EXCEPTION
      'A CSF provider webhook reduction can never be withdrawn.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.reduced_at IS NOT NULL AND NEW.reduced_at IS DISTINCT FROM OLD.reduced_at THEN
    RAISE EXCEPTION
      'A CSF provider webhook reduction time is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  -- The attempt binding follows the same one-shot rule as delivery_id: an event
  -- finds the attempt it was always describing exactly once, and a purged
  -- attempt may detach it.
  IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
    AND NOT (OLD.attempt_id IS NULL AND NEW.attempt_id IS NOT NULL)
    AND NOT (
      NEW.attempt_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_communication_dispatch_attempts AS attempt
        WHERE attempt.id = OLD.attempt_id
      )
    )
  THEN
    RAISE EXCEPTION
      'A CSF provider event may be attached to its dispatch attempt once and never re-pointed.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Runs alongside csf_communication_provider_events_append_only, which owns the
-- evidential columns and passes a pure reduction update straight through.
CREATE TRIGGER csf_communication_provider_events_reduction_frozen
BEFORE UPDATE ON plugin_data.csf_communication_provider_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_freeze_provider_event_reduction();

REVOKE ALL ON FUNCTION plugin_data.csf_freeze_provider_event_reduction()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN plugin_data.csf_communication_provider_events.signature_verified IS
  'Asserted by the application after it verified the provider signature over the exact raw request body. The database does not verify signatures; plugin_data.csf_record_communication_provider_event() refuses to record an event where this is not true.';
COMMENT ON COLUMN plugin_data.csf_communication_provider_events.processing_state IS
  'What the reducer did with this event: reduced, or ignored because the type is unknown, the provider time is stale, the delivery is terminally locked, the event contradicts recorded truth, or no delivery matched yet.';
COMMENT ON CONSTRAINT csf_communication_provider_events_operational_allowlist_check
  ON plugin_data.csf_communication_provider_events IS
  'Provider evidence stores only allowlisted, scalar, bounded operational fields. Complements the raw-content denylist from 20260730001001 with a positive rule.';
COMMENT ON FUNCTION plugin_data.csf_freeze_provider_event_reduction() IS
  'Freezes signature verification metadata and settles reduction bookkeeping exactly once per provider event.';

-- ---------------------------------------------------------------------------
-- I. Atomic server-only RPCs
--
-- Every RPC below is SECURITY DEFINER with an empty search_path, executable by
-- service_role alone, validates organization / campaign / delivery ownership
-- before it writes, and bounds every input it accepts. None of them build SQL
-- from caller-supplied text: identifiers are never interpolated, and every
-- caller value reaches the database as a bound parameter of a static statement.
-- ---------------------------------------------------------------------------

-- Guarded uuid parsing. A malformed caller value produces this migration's own
-- diagnostic instead of an invalid_text_representation crash, and the shape is
-- tested before any cast runs.
CREATE OR REPLACE FUNCTION plugin_data.csf_communication_optional_uuid(
  p_value text,
  p_label text
)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_trimmed text := nullif(btrim(coalesce(p_value, '')), '');
BEGIN
  IF v_trimmed IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_trimmed !~ c_uuid_shape THEN
    RAISE EXCEPTION 'The CSF communications value "%" is not a UUID.', p_label
      USING ERRCODE = '22P02';
  END IF;

  RETURN v_trimmed::uuid;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_communication_optional_uuid(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_communication_optional_uuid(text, text)
  TO service_role;

-- I.1 Create the audience snapshot.
--
-- Idempotent by recipient: a replayed call adds only the addresses that are not
-- already recorded, so a partially completed build resumes safely. Rows are
-- written already-final, which is why 20260730001001's immutability rule and
-- this migration's dispatch-provenance freeze are compatible with a multi-call
-- build: the set of rows grows until finalization closes it, but no row ever
-- changes.
CREATE OR REPLACE FUNCTION plugin_data.csf_snapshot_communication_recipients(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_recipients jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_recipients constant integer := 500;
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_now timestamptz := now();
  v_entry jsonb;
  v_index integer := 0;
  v_email text;
  v_name text;
  v_requirement text;
  v_declared_requirement text;
  v_topic text;
  v_provenance text;
  v_decision jsonb;
  v_preference_decision text;
  v_preference_reason text;
  v_subscription text;
  v_exclusion text;
  v_declared_exclusion text;
  v_response_hash text;
  v_preferred_hash text;
  v_snapshot_hash text;
  v_existing_hash text;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_included integer := 0;
  v_excluded integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'A CSF audience snapshot requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  IF p_recipients IS NULL OR pg_catalog.jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'A CSF audience snapshot requires a JSON array of recipients.'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_array_length(p_recipients) < 1
    OR pg_catalog.jsonb_array_length(p_recipients) > c_max_recipients
  THEN
    RAISE EXCEPTION
      'A CSF audience snapshot call carries between 1 and % recipients; page larger audiences.',
      c_max_recipients
      USING ERRCODE = '22023';
  END IF;

  -- Serializes concurrent builders of the same audience.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-audience:' || p_organization_id::text || ':' || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.content_hash IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign must record its content digest and DVHS sending identity before an audience is built.'
      USING ERRCODE = '23514';
  END IF;

  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION
      'A CSF campaign audience may only be built while the campaign is a draft.'
      USING ERRCODE = '23514';
  END IF;

  IF v_campaign.audience_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION
      'This CSF campaign audience is already finalized; a finalized audience never gains a recipient.'
      USING ERRCODE = '23514';
  END IF;

  v_requirement := CASE
    WHEN v_campaign.campaign_kind = 'transactional' THEN 'transactional'
    ELSE 'broadcast'
  END;
  v_topic := CASE
    WHEN v_requirement = 'broadcast' THEN v_campaign.broadcast_topic_key
    ELSE NULL
  END;

  FOR v_entry IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(p_recipients) AS element(value)
  LOOP
    v_index := v_index + 1;

    IF pg_catalog.jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'CSF audience recipient % is not a JSON object.', v_index
        USING ERRCODE = '22023';
    END IF;

    v_email := pg_catalog.lower(pg_catalog.btrim(coalesce(v_entry->>'email', '')));

    IF NOT plugin_data.csf_communication_email_is_storable(v_email) THEN
      RAISE EXCEPTION
        'CSF audience recipient % does not carry a single, whitespace-free, bounded mailbox address.',
        v_index
        USING ERRCODE = '22023';
    END IF;

    v_name := nullif(btrim(coalesce(v_entry->>'name', '')), '');
    IF v_name IS NOT NULL AND pg_catalog.char_length(v_name) > 200 THEN
      RAISE EXCEPTION 'CSF audience recipient % carries an oversized display name.', v_index
        USING ERRCODE = '22023';
    END IF;

    -- A caller may state the requirement, but only to agree with the campaign.
    -- It cannot downgrade a transactional send into a refusable one.
    v_declared_requirement := nullif(btrim(coalesce(v_entry->>'requirement', '')), '');
    IF v_declared_requirement IS NOT NULL
      AND v_declared_requirement <> v_requirement
    THEN
      RAISE EXCEPTION
        'CSF audience recipient % declares requirement "%" but the campaign is %.',
        v_index, v_declared_requirement, v_requirement
        USING ERRCODE = '22023';
    END IF;

    v_provenance := nullif(btrim(coalesce(v_entry->>'provenance', '')), '');
    IF v_provenance IS NULL
      OR v_provenance NOT IN (
        'response_contact', 'preferred_contact', 'account_email',
        'representative_record', 'staff_entry', 'import_record'
      )
    THEN
      RAISE EXCEPTION
        'CSF audience recipient % must record where its address came from.',
        v_index
        USING ERRCODE = '22023';
    END IF;

    -- Preference evaluation. For a transactional campaign this returns
    -- 'mandatory_transactional' without touching the preference table at all.
    v_decision := plugin_data.csf_communication_preference_decision(
      p_organization_id, v_requirement, v_topic, v_email
    );
    v_preference_decision := v_decision->>'decision';
    v_preference_reason := v_decision->>'reason';

    v_declared_exclusion := nullif(btrim(coalesce(v_entry->>'exclusionReason', '')), '');
    IF v_declared_exclusion IS NOT NULL
      AND v_declared_exclusion NOT IN ('invalid_address', 'duplicate', 'not_eligible')
    THEN
      RAISE EXCEPTION
        'CSF audience recipient % may only be skipped for an invalid address, a duplicate, or ineligibility; consent is decided by the preference table.',
        v_index
        USING ERRCODE = '22023';
    END IF;

    IF v_declared_exclusion IS NOT NULL THEN
      v_subscription := 'excluded';
      v_exclusion := v_declared_exclusion;
    ELSIF (v_decision->>'suppressed')::boolean THEN
      v_subscription := 'excluded';
      v_exclusion := 'unsubscribed';
    ELSE
      v_subscription := 'included';
      v_exclusion := NULL;
    END IF;

    v_response_hash := CASE
      WHEN nullif(btrim(coalesce(v_entry->>'responseContactEmail', '')), '') IS NULL THEN NULL
      ELSE encode(
        extensions.digest(
          pg_catalog.lower(pg_catalog.btrim(v_entry->>'responseContactEmail')),
          'sha256'
        ),
        'hex'
      )
    END;
    v_preferred_hash := CASE
      WHEN nullif(btrim(coalesce(v_entry->>'preferredContactEmail', '')), '') IS NULL THEN NULL
      ELSE encode(
        extensions.digest(
          pg_catalog.lower(pg_catalog.btrim(v_entry->>'preferredContactEmail')),
          'sha256'
        ),
        'hex'
      )
    END;

    -- The digest covers every material field of the frozen row, so comparing
    -- it IS comparing the complete snapshot.
    v_snapshot_hash := encode(
      extensions.digest(
        pg_catalog.jsonb_build_object(
          'campaignId', p_campaign_id,
          'contentHash', v_campaign.content_hash,
          'emailHash', encode(extensions.digest(v_email, 'sha256'), 'hex'),
          'recipientName', v_name,
          'requirement', v_requirement,
          'topicKey', v_topic,
          'preferenceDecision', v_preference_decision,
          'subscriptionDecision', v_subscription,
          'exclusionReason', v_exclusion,
          'provenance', v_provenance,
          'responseContactHash', v_response_hash,
          'preferredContactHash', v_preferred_hash,
          'profileId', plugin_data.csf_communication_optional_uuid(
            v_entry->>'profileId', 'profileId'
          ),
          'userId', plugin_data.csf_communication_optional_uuid(
            v_entry->>'userId', 'userId'
          ),
          'clubRepresentativeId', plugin_data.csf_communication_optional_uuid(
            v_entry->>'clubRepresentativeId', 'clubRepresentativeId'
          ),
          'partnerClubTermId', plugin_data.csf_communication_optional_uuid(
            v_entry->>'partnerClubTermId', 'partnerClubTermId'
          )
        )::text,
        'sha256'
      ),
      'hex'
    );

    -- Replay handling. An address already in this audience is only a no-op when
    -- the recomputed snapshot is byte-identical to the frozen one. A materially
    -- different replay -- a changed name, a flipped consent decision, a
    -- different provenance -- is a conflict, not an idempotent retry, because
    -- silently keeping the first version would mean the caller and the ledger
    -- disagree about who was mailed and why.
    SELECT existing.recipient_snapshot_hash
    INTO v_existing_hash
    FROM plugin_data.csf_communication_recipient_snapshots AS existing
    WHERE existing.organization_id = p_organization_id
      AND existing.campaign_id = p_campaign_id
      AND existing.normalized_recipient_email = v_email;

    IF FOUND THEN
      IF v_existing_hash IS DISTINCT FROM v_snapshot_hash THEN
        RAISE EXCEPTION
          'CSF audience recipient % is already recorded for this campaign with a materially different snapshot; a finalized audience row is never rewritten.',
          v_index
          USING ERRCODE = '23505';
      END IF;

      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO plugin_data.csf_communication_recipient_snapshots (
      organization_id, campaign_id, snapshot_version, recipient_email,
      recipient_name, profile_id, user_id, club_representative_id,
      partner_club_term_id, subscription_decision, exclusion_reason,
      delivery_requirement, topic_key, preference_decision, preference_reason,
      preference_recorded_at, contact_provenance, response_contact_hash,
      preferred_contact_hash, content_hash, recipient_snapshot_hash
    )
    SELECT
      p_organization_id, p_campaign_id, v_campaign.audience_snapshot_version,
      v_email, v_name,
      plugin_data.csf_communication_optional_uuid(v_entry->>'profileId', 'profileId'),
      plugin_data.csf_communication_optional_uuid(v_entry->>'userId', 'userId'),
      plugin_data.csf_communication_optional_uuid(
        v_entry->>'clubRepresentativeId', 'clubRepresentativeId'
      ),
      plugin_data.csf_communication_optional_uuid(
        v_entry->>'partnerClubTermId', 'partnerClubTermId'
      ),
      v_subscription, v_exclusion, v_requirement, v_topic,
      v_preference_decision, v_preference_reason, v_now, v_provenance,
      v_response_hash, v_preferred_hash, v_campaign.content_hash, v_snapshot_hash;

    v_inserted := v_inserted + 1;
    IF v_subscription = 'included' THEN
      v_included := v_included + 1;
    ELSE
      v_excluded := v_excluded + 1;
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'snapshotVersion', v_campaign.audience_snapshot_version,
    'deliveryRequirement', v_requirement,
    'topicKey', v_topic,
    'recorded', v_inserted,
    'alreadyRecorded', v_skipped,
    'included', v_included,
    'excluded', v_excluded
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_snapshot_communication_recipients(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_snapshot_communication_recipients(uuid, uuid, jsonb)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_snapshot_communication_recipients(uuid, uuid, jsonb) IS
  'Atomically records audience rows for a draft, dispatch-ready CSF campaign with the consent decision, contact provenance, and digests frozen at snapshot time. Idempotent per address. A transactional campaign is evaluated as mandatory and cannot be suppressed by a broadcast opt-out.';

-- I.2 Campaign content lock.
--
-- Two rules, checked in this order so the caller gets the reason that matters:
-- content may not change once a provider idempotency key has been allocated
-- against it, and content may not change once the campaign has recorded a
-- content digest at all. The second subsumes the first, but the first is the
-- statement the dispatch contract actually makes, so it earns its own message.
--
-- Named to sort before csf_communication_campaigns_lifecycle so these specific
-- diagnostics win over the general post-draft freeze.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_campaign_dispatch_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_content_changed boolean;
BEGIN
  -- resend_topic_id IS PART OF THE FINALIZED CONTENT CONTRACT.
  --
  -- 20260730001001 freezes it only once the campaign leaves draft, but content
  -- finalization happens WHILE the campaign is still a draft -- so between those two
  -- points the provider topic was editable even though the attempt's payload digest
  -- and idempotency key had already been derived from it. Repointing it there would
  -- have sent a broadcast under a different unsubscribe topic than the one the
  -- ledger vouched for, with the stored digest still claiming otherwise.
  --
  -- It belongs in the same tuple as the subject and the body, and it freezes at the
  -- same moment they do.
  v_content_changed := ROW(
    NEW.subject, NEW.sender_name, NEW.sender_email, NEW.reply_to_email,
    NEW.body_text, NEW.body_html, NEW.body_text_hash, NEW.body_html_hash,
    NEW.body_metadata, NEW.content_hash, NEW.resend_topic_id
  ) IS DISTINCT FROM ROW(
    OLD.subject, OLD.sender_name, OLD.sender_email, OLD.reply_to_email,
    OLD.body_text, OLD.body_html, OLD.body_text_hash, OLD.body_html_hash,
    OLD.body_metadata, OLD.content_hash, OLD.resend_topic_id
  );

  IF v_content_changed THEN
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.organization_id = OLD.organization_id
        AND attempt.campaign_id = OLD.id
    ) THEN
      RAISE EXCEPTION
        'CSF campaign content cannot change after a provider idempotency key has been allocated against it.'
        USING ERRCODE = '23514';
    END IF;

    -- A NON-EMPTY DRAFT BODY IS NOT PUBLICATION, so this keys off the explicit
    -- finalization transition rather than "the body is no longer empty". Before
    -- finalization there is no content digest and every field above is editable;
    -- after it, all of them freeze together.
    IF OLD.content_finalized_at IS NOT NULL THEN
      RAISE EXCEPTION
        'CSF campaign sender identity, subject, and body are frozen once the campaign content is finalized.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- THE TERM, TOPIC, AND AUDIENCE KIND ARE DRAFT FIELDS UNTIL FINALIZATION.
  --
  -- These used to be write-once from the first save, which meant an officer who
  -- picked the wrong semester or the wrong topic in a half-written draft could
  -- never fix it -- the campaign had to be abandoned and retyped. They are part of
  -- the dispatch identity, so they freeze WITH the content, not before it.
  --
  -- term_id is ON DELETE SET NULL, so a removed term detaches it rather than
  -- failing this freeze even after finalization.
  IF OLD.content_finalized_at IS NOT NULL
    AND NEW.term_id IS DISTINCT FROM OLD.term_id
    AND OLD.term_id IS NOT NULL
  THEN
    IF NEW.term_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_terms AS term WHERE term.id = OLD.term_id
      )
    THEN
      RAISE EXCEPTION
        'A CSF campaign term reference is frozen once the campaign content is finalized.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (
      OLD.content_finalized_at IS NOT NULL
      AND NEW.audience_kind IS DISTINCT FROM OLD.audience_kind
    )
    OR (
      OLD.content_finalized_at IS NOT NULL
      AND NEW.broadcast_topic_key IS DISTINCT FROM OLD.broadcast_topic_key
    )
    OR (
      OLD.content_finalized_at IS NOT NULL
      AND NEW.content_finalized_at IS DISTINCT FROM OLD.content_finalized_at
    )
    OR (
      OLD.created_by_identity IS NOT NULL
      AND NEW.created_by_identity IS DISTINCT FROM OLD.created_by_identity
    )
    OR (OLD.audience_digest IS NOT NULL AND NEW.audience_digest IS DISTINCT FROM OLD.audience_digest)
    OR (OLD.audience_size IS NOT NULL AND NEW.audience_size IS DISTINCT FROM OLD.audience_size)
    OR (
      OLD.audience_finalized_at IS NOT NULL
      AND NEW.audience_finalized_at IS DISTINCT FROM OLD.audience_finalized_at
    )
    OR (
      OLD.dispatch_started_at IS NOT NULL
      AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at
    )
  THEN
    RAISE EXCEPTION
      'CSF campaign audience identity and dispatch markers are recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort before csf_communication_campaigns_dispatch_lock.
CREATE TRIGGER csf_communication_campaigns_dispatch_lock
BEFORE UPDATE ON plugin_data.csf_communication_campaigns
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_campaign_dispatch_lock();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_campaign_dispatch_lock()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plugin_data.csf_enforce_campaign_dispatch_lock() IS
  'Rejects any campaign content mutation once a provider idempotency key is allocated or the content is explicitly finalized, freezes sender/subject/bodies/metadata/topic/term/audience-kind together at that transition, and makes the audience and dispatch markers write-once. Before finalization every draft field stays editable.';

-- I.3 Finalize the audience and open the dispatch ledger.
--
-- Closes the audience, records the digest that lets a restart prove it is
-- resending the same audience, creates one delivery per included recipient, and
-- enqueues each recipient's first attempt. Idempotent: a replayed call after a
-- successful finalization returns the recorded digest and changes nothing.
CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_communication_recipient_snapshot(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_expected_included_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_now timestamptz := now();
  v_total integer := 0;
  v_included integer := 0;
  v_digest text;
  v_deliveries integer := 0;
  v_attempts integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'A CSF audience finalization requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  IF p_expected_included_count IS NOT NULL
    AND (p_expected_included_count < 0 OR p_expected_included_count > 100000)
  THEN
    RAISE EXCEPTION 'The expected CSF audience size is out of range.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-audience:' || p_organization_id::text || ':' || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.content_hash IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign without a content digest is not dispatch-ready and cannot finalize an audience.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*)::integer,
    (count(*) FILTER (WHERE snapshot.subscription_decision = 'included'))::integer,
    encode(
      extensions.digest(
        coalesce(
          pg_catalog.string_agg(
            snapshot.recipient_snapshot_hash, ':'
            ORDER BY snapshot.recipient_snapshot_hash
          ),
          ''
        ),
        'sha256'
      ),
      'hex'
    )
  INTO v_total, v_included, v_digest
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.organization_id = p_organization_id
    AND snapshot.campaign_id = p_campaign_id
    AND snapshot.content_hash = v_campaign.content_hash;

  -- Idempotent replay. The digest is recomputed above and compared, so a replay
  -- that would silently finalize a different audience is refused instead.
  IF v_campaign.audience_finalized_at IS NOT NULL THEN
    IF v_campaign.audience_digest IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION
        'This CSF campaign audience was finalized against a different recipient set; a finalized audience is never re-finalized.'
        USING ERRCODE = '23514';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'audienceDigest', v_campaign.audience_digest,
      'audienceSize', v_campaign.audience_size,
      'includedRecipients', v_included,
      'deliveriesCreated', 0,
      'attemptsEnqueued', 0,
      'idempotentReplay', true
    );
  END IF;

  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION
      'A CSF campaign audience is finalized out of draft exactly once.'
      USING ERRCODE = '23514';
  END IF;

  IF v_included < 1 THEN
    RAISE EXCEPTION
      'A CSF campaign cannot be dispatched to an empty audience.'
      USING ERRCODE = '23514';
  END IF;

  IF p_expected_included_count IS NOT NULL AND p_expected_included_count <> v_included THEN
    RAISE EXCEPTION
      'The CSF audience holds % included recipients, not the % the caller expected.',
      v_included, p_expected_included_count
      USING ERRCODE = '23514';
  END IF;

  -- Campaign first: the attempt enqueue guard requires a queued campaign with a
  -- closed audience.
  UPDATE plugin_data.csf_communication_campaigns
  SET
    audience_finalized_at = v_now,
    audience_digest = v_digest,
    audience_size = v_total,
    dispatch_started_at = v_now,
    status = 'queued',
    queued_at = coalesce(queued_at, v_now),
    updated_at = v_now
  WHERE id = p_campaign_id
    AND organization_id = p_organization_id;

  -- One delivery per included recipient. The key is derived from the content
  -- and recipient digests so a replay reproduces it exactly.
  INSERT INTO plugin_data.csf_communication_deliveries (
    organization_id, campaign_id, recipient_snapshot_id,
    provider_idempotency_key, status, queued_at
  )
  SELECT
    p_organization_id,
    p_campaign_id,
    snapshot.id,
    'csf-dlv-' || pg_catalog.left(v_campaign.content_hash, 16)
      || '-' || pg_catalog.left(snapshot.recipient_snapshot_hash, 32),
    'queued',
    v_now
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.organization_id = p_organization_id
    AND snapshot.campaign_id = p_campaign_id
    AND snapshot.subscription_decision = 'included'
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_deliveries AS existing
      WHERE existing.organization_id = p_organization_id
        AND existing.campaign_id = p_campaign_id
        AND existing.recipient_snapshot_id = snapshot.id
    );
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  -- First attempt per delivery. attempt_number and the provider key are derived
  -- by the enqueue trigger, so nothing here can allocate a colliding key.
  INSERT INTO plugin_data.csf_communication_dispatch_attempts (
    organization_id, campaign_id, recipient_snapshot_id, delivery_id,
    attempt_number, provider_idempotency_key, content_hash,
    recipient_email_hash, available_at
  )
  SELECT
    p_organization_id,
    p_campaign_id,
    delivery.recipient_snapshot_id,
    delivery.id,
    1,
    NULL,
    v_campaign.content_hash,
    snapshot.recipient_email_hash,
    v_now
  FROM plugin_data.csf_communication_deliveries AS delivery
  JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
    ON snapshot.id = delivery.recipient_snapshot_id
    AND snapshot.organization_id = delivery.organization_id
  WHERE delivery.organization_id = p_organization_id
    AND delivery.campaign_id = p_campaign_id
    AND delivery.status = 'queued'
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.organization_id = p_organization_id
        AND attempt.campaign_id = p_campaign_id
        AND attempt.recipient_snapshot_id = delivery.recipient_snapshot_id
    );
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'audienceDigest', v_digest,
    'audienceSize', v_total,
    'includedRecipients', v_included,
    'deliveriesCreated', v_deliveries,
    'attemptsEnqueued', v_attempts,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finalize_communication_recipient_snapshot(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_communication_recipient_snapshot(uuid, uuid, integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_finalize_communication_recipient_snapshot(uuid, uuid, integer) IS
  'Atomically closes a CSF campaign audience, records the audience digest, creates one delivery per included recipient, and enqueues each first attempt. Replaying it after success returns the recorded digest and refuses to finalize a different recipient set.';

-- I.3b Reap lapsed dispatch leases -- HONESTLY.
--
-- THE OBVIOUS LEASE REAPER IS A DUPLICATE-SEND GENERATOR.
--
-- The tempting implementation is "the lease lapsed, so the worker died, so put
-- the work back on the queue". It is wrong, and the reason is that a lapsed lease
-- carries no information about whether the provider was contacted. A worker can
-- write the exact request to Resend and then be OOM-killed before it commits a
-- settlement; from this side that is indistinguishable from a worker that died
-- before it ever opened the socket. Requeueing therefore re-sends an unknown
-- number of already-accepted messages to real people, and Resend's own
-- idempotency key is remembered for only 24 hours, so it will not deduplicate a
-- retry that happens after that window either.
--
-- So a lapsed lease settles as 'unknown_outcome': a settled, unretryable attempt
-- with a recorded reason, a pending review flag, an unknown-outcome marker on the
-- delivery, and a review block on the campaign. That is the honest answer --
-- nobody knows whether this recipient was mailed -- and it puts a human in the
-- loop instead of silently mailing somebody twice.
--
-- THIS RUNS REGARDLESS OF CAMPAIGN STATUS. A cancelled campaign's leased work is
-- exactly as ambiguous as a live campaign's, and leaving it stranded in
-- 'processing' forever would mean cancellation quietly abandoned the one case
-- that most needs review.
CREATE OR REPLACE FUNCTION plugin_data.csf_reap_communication_dispatch_leases(
  p_organization_id uuid,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_reason constant text :=
    'dispatch lease lapsed with no settlement; the holder may already have handed the request to the provider';
  -- Bounded so one sweep can never take an unbounded number of campaign locks.
  c_max_campaigns constant integer := 100;
  v_now timestamptz := now();
  v_settled integer := 0;
  v_batch_settled integer := 0;
  v_delivery_ids uuid[] := '{}'::uuid[];
  v_batch_delivery_ids uuid[] := '{}'::uuid[];
  v_campaign_ids uuid[] := '{}'::uuid[];
  v_scope_campaign_ids uuid[] := '{}'::uuid[];
  v_campaign_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF dispatch lease reap requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  -- CANONICAL LOCK ORDER, STEP 1: BOUNDED, UNLOCKED CAMPAIGN DISCOVERY.
  --
  -- The previous body opened with a cross-campaign `FOR UPDATE` scan over the
  -- attempt ledger -- rank 4 of the canonical order, taken with no campaign lock at
  -- all. Cancellation holds the campaign advisory lock and then reaches for exactly
  -- those attempt rows, so the two orders inverted and could deadlock. Discovering
  -- the campaigns WITHOUT a lock first is what lets every subsequent row lock sit
  -- underneath the campaign lock that guards it.
  --
  -- The list is ASCENDING BY CAMPAIGN ID, and every path that locks more than one
  -- campaign in a transaction uses the same ascending order, so two concurrent
  -- sweeps can never hold each other's next campaign lock.
  SELECT coalesce(
    pg_catalog.array_agg(scope.campaign_id ORDER BY scope.campaign_id),
    '{}'::uuid[]
  )
  INTO v_scope_campaign_ids
  FROM (
    SELECT DISTINCT attempt.campaign_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.organization_id = p_organization_id
      AND (p_campaign_id IS NULL OR attempt.campaign_id = p_campaign_id)
      AND attempt.state = 'processing'
      AND attempt.lease_expires_at IS NOT NULL
      AND attempt.lease_expires_at <= v_now
    ORDER BY attempt.campaign_id
    LIMIT c_max_campaigns
  ) AS scope;

  -- ONE CAMPAIGN AT A TIME, EACH UNDER ITS OWN CANONICAL PROLOGUE.
  FOREACH v_campaign_id IN ARRAY v_scope_campaign_ids
  LOOP
    -- STEP 2: the campaign advisory lock.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf-communication-campaign:' || p_organization_id::text || ':'
          || v_campaign_id::text,
        0
      )
    );

    -- STEP 3: the campaign row. A campaign that vanished between the unlocked
    -- discovery and here has taken its attempts with it (ON DELETE CASCADE), so
    -- there is nothing left to settle.
    PERFORM 1
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.id = v_campaign_id
      AND campaign.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- STEP 4: this campaign's lapsed attempts, in stable id order, under the
    -- campaign lock. The predicate is re-evaluated here, so a lease that was
    -- renewed or settled since the unlocked discovery is simply not reaped.
    WITH lapsed AS (
      SELECT attempt.id
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.organization_id = p_organization_id
        AND attempt.campaign_id = v_campaign_id
        AND attempt.state = 'processing'
        AND attempt.lease_expires_at IS NOT NULL
        AND attempt.lease_expires_at <= v_now
      ORDER BY attempt.id
      FOR UPDATE OF attempt
    ),
    settled AS (
      UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
      SET
        state = 'unknown_outcome',
        unknown_reason = c_reason,
        outcome_detail = c_reason,
        review_state = CASE
          WHEN attempt.review_state = 'none' THEN 'pending'
          ELSE attempt.review_state
        END,
        settlement_source = 'reaper',
        lease_owner = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        settled_at = v_now,
        updated_at = v_now
      FROM lapsed
      WHERE attempt.id = lapsed.id
      RETURNING attempt.delivery_id
    )
    SELECT
      count(*)::integer,
      coalesce(pg_catalog.array_agg(DISTINCT settled.delivery_id), '{}'::uuid[])
    INTO v_batch_settled, v_batch_delivery_ids
    FROM settled;

    IF v_batch_settled > 0 THEN
      v_settled := v_settled + v_batch_settled;
      v_delivery_ids := v_delivery_ids || v_batch_delivery_ids;
      v_campaign_ids := v_campaign_ids || ARRAY[v_campaign_id];
    END IF;
  END LOOP;

  IF v_settled = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'settledUnknownOutcomes', 0,
      'deliveriesMarkedForReview', 0,
      'campaignsReviewBlocked', 0
    );
  END IF;

  UPDATE plugin_data.csf_communication_deliveries AS delivery
  SET
    attempt_count = delivery.attempt_count + 1,
    unknown_outcome_at = coalesce(delivery.unknown_outcome_at, v_now),
    review_state = CASE
      WHEN delivery.review_state = 'none' THEN 'pending'
      ELSE delivery.review_state
    END,
    review_reason = coalesce(delivery.review_reason, c_reason),
    last_error = coalesce(delivery.last_error, c_reason),
    updated_at = v_now
  WHERE delivery.id = ANY (v_delivery_ids)
    AND delivery.organization_id = p_organization_id;

  -- The campaign becomes visibly review-blocked, which is what stops the
  -- terminalization guard from ever calling it completed.
  UPDATE plugin_data.csf_communication_campaigns AS campaign
  SET
    review_blocked_at = coalesce(campaign.review_blocked_at, v_now),
    review_blocked_reason = coalesce(campaign.review_blocked_reason, c_reason),
    updated_at = v_now
  WHERE campaign.id = ANY (v_campaign_ids)
    AND campaign.organization_id = p_organization_id
    -- A completed campaign cannot hold a review block; the terminalization guard
    -- guarantees no live attempt existed when it settled, so this filter only
    -- keeps the CHECK satisfiable and never hides real ambiguity.
    AND campaign.status <> 'completed';

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'settledUnknownOutcomes', v_settled,
    'deliveriesMarkedForReview', coalesce(
      pg_catalog.array_length(v_delivery_ids, 1), 0
    ),
    'campaignsReviewBlocked', coalesce(
      pg_catalog.array_length(v_campaign_ids, 1), 0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reap_communication_dispatch_leases(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reap_communication_dispatch_leases(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_reap_communication_dispatch_leases(uuid, uuid) IS
  'Settles every lapsed CSF dispatch lease as unknown_outcome -- never back to queued. A leaseholder may have handed the exact request to the provider before dying, so requeueing would re-send to real people; instead the attempt settles unretryably, the delivery is marked for review, and the campaign becomes review-blocked. Runs for cancelled campaigns too, so cancellation never strands ambiguous work.';

-- I.4 Claim a bounded batch of work under a lease.
--
-- Settles lapsed leases first, then takes at most p_batch_size queued attempts
-- with FOR UPDATE SKIP LOCKED so concurrent workers never block each other and
-- never take the same row. NOTHING HERE AUTHORIZES A SEND: the claim hands back
-- attempt coordinates, not a provider payload. A worker must call
-- plugin_data.csf_authorize_communication_dispatch() immediately before it talks
-- to the provider.
CREATE OR REPLACE FUNCTION plugin_data.csf_claim_communication_dispatch_batch(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_worker_id text,
  p_batch_size integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_batch constant integer := 100;
  c_min_lease constant integer := 30;
  c_max_lease constant integer := 1800;
  -- Bounded so one claim can never take an unbounded number of campaign locks.
  c_max_campaigns constant integer := 100;
  v_worker text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_now timestamptz := now();
  v_reaped jsonb;
  v_reaped_unknown integer := 0;
  v_claims jsonb;
  v_claimed_ids uuid[] := '{}'::uuid[];
  v_batch_claimed_ids uuid[] := '{}'::uuid[];
  v_suppressed_delivery_ids uuid[] := '{}'::uuid[];
  v_scope_campaign_ids uuid[] := '{}'::uuid[];
  v_campaign_id uuid;
  v_campaign_status text;
  v_remaining integer;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF dispatch claim requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF v_worker IS NULL OR pg_catalog.char_length(v_worker) > 128 THEN
    RAISE EXCEPTION 'A CSF dispatch claim requires a worker identity of at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > c_max_batch THEN
    RAISE EXCEPTION 'A CSF dispatch claim takes between 1 and % attempts.', c_max_batch
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_seconds IS NULL
    OR p_lease_seconds < c_min_lease
    OR p_lease_seconds > c_max_lease
  THEN
    RAISE EXCEPTION 'A CSF dispatch lease lasts between % and % seconds.',
      c_min_lease, c_max_lease
      USING ERRCODE = '22023';
  END IF;

  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.id = p_campaign_id
      AND campaign.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- CANONICAL LOCK ORDER, STEP 1: BOUNDED, UNLOCKED CAMPAIGN DISCOVERY.
  --
  -- The previous body opened with a cross-campaign `FOR UPDATE ... SKIP LOCKED`
  -- scan over the attempt ledger. SKIP LOCKED keeps two CLAIMS from blocking each
  -- other, but it does nothing about the claim-versus-cancellation direction:
  -- cancellation holds the campaign advisory lock and then updates this
  -- campaign's attempts, so a claim that had already taken an attempt row and was
  -- waiting on a campaign lock closed the cycle. The campaigns are therefore
  -- discovered WITHOUT a lock and each one is processed under its own prologue.
  --
  -- ASCENDING BY CAMPAIGN ID, matching the reaper, so two workers walking
  -- overlapping campaign sets can never hold each other's next campaign lock.
  --
  -- The scope is the UNION of "has claimable queued work" and "has a lapsed
  -- lease", because the reap this call performs now happens per campaign INSIDE
  -- the loop rather than as one org-wide sweep beforehand. An org-wide reap ahead
  -- of the loop took campaign locks in its own discovery order, and two sessions
  -- whose reap and claim sets overlapped differently could then hold each other's
  -- next lock. One ascending walk that covers both reasons removes that entirely,
  -- and it still reaps a campaign whose only work is an expired lease.
  SELECT coalesce(
    pg_catalog.array_agg(scope.campaign_id ORDER BY scope.campaign_id),
    '{}'::uuid[]
  )
  INTO v_scope_campaign_ids
  FROM (
    SELECT DISTINCT attempt.campaign_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_campaigns AS campaign
      ON campaign.id = attempt.campaign_id
      AND campaign.organization_id = attempt.organization_id
    WHERE attempt.organization_id = p_organization_id
      AND (p_campaign_id IS NULL OR attempt.campaign_id = p_campaign_id)
      AND (
        -- Claimable work, which only a live campaign yields.
        (
          attempt.state = 'queued'
          AND attempt.available_at <= v_now
          AND campaign.status IN ('queued', 'sending')
        )
        -- Ambiguous work, which is reaped whatever the campaign status is: a
        -- cancelled campaign's lapsed lease is exactly as unaccounted for as a
        -- live one's, and stranding it would hide the case most needing review.
        OR (
          attempt.state = 'processing'
          AND attempt.lease_expires_at IS NOT NULL
          AND attempt.lease_expires_at <= v_now
        )
      )
    ORDER BY attempt.campaign_id
    LIMIT c_max_campaigns
  ) AS scope;

  v_remaining := p_batch_size;

  FOREACH v_campaign_id IN ARRAY v_scope_campaign_ids
  LOOP
    -- STEP 2: the campaign advisory lock.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf-communication-campaign:' || p_organization_id::text || ':'
          || v_campaign_id::text,
        0
      )
    );

    -- STEP 3: the campaign row, whose status is re-read under the lock. A
    -- cancellation that committed between the unlocked discovery and here is
    -- visible now, and this campaign yields no claimable work.
    SELECT campaign.status
    INTO v_campaign_status
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.id = v_campaign_id
      AND campaign.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Lapsed leases settle as unknown_outcome. They are NOT returned to the queue:
    -- see plugin_data.csf_reap_communication_dispatch_leases() for why requeueing
    -- an unsettled lease re-sends real mail. Because the reaped work becomes
    -- settled and unretryable, running this for every campaign status is safe --
    -- nothing it touches can ever be claimed again. Scoped to this campaign, so it
    -- re-enters the advisory lock this loop already holds instead of acquiring a
    -- second campaign's lock out of order.
    v_reaped := plugin_data.csf_reap_communication_dispatch_leases(
      p_organization_id, v_campaign_id
    );
    v_reaped_unknown := v_reaped_unknown
      + coalesce((v_reaped->>'settledUnknownOutcomes')::integer, 0);

    IF v_remaining <= 0 OR v_campaign_status NOT IN ('queued', 'sending') THEN
      CONTINUE;
    END IF;

    -- STEP 4: this campaign's queued attempts. SKIP LOCKED is preserved because it
    -- is still exactly right HERE: two workers holding two different campaign locks
    -- must not serialize on one campaign's rows, and a row another worker is
    -- already claiming is simply not ours.
    WITH claimable AS (
      SELECT attempt.id
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.organization_id = p_organization_id
        AND attempt.campaign_id = v_campaign_id
        AND attempt.state = 'queued'
        AND attempt.available_at <= v_now
      ORDER BY attempt.available_at, attempt.id
      LIMIT v_remaining
      FOR UPDATE OF attempt SKIP LOCKED
    ),
    claimed AS (
      UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
      SET
        state = 'processing',
        lease_owner = v_worker,
        leased_at = v_now,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        lease_count = attempt.lease_count + 1,
        updated_at = v_now
      FROM claimable
      WHERE attempt.id = claimable.id
      RETURNING attempt.id
    )
    SELECT coalesce(pg_catalog.array_agg(claimed.id), '{}'::uuid[])
    INTO v_batch_claimed_ids
    FROM claimed;

    v_claimed_ids := v_claimed_ids || v_batch_claimed_ids;
    v_remaining := v_remaining
      - coalesce(pg_catalog.array_length(v_batch_claimed_ids, 1), 0);
  END LOOP;

  -- CONSENT AND ADDRESS SAFETY ARE RE-EVALUATED AT CLAIM TIME TOO.
  --
  -- The snapshot froze the decision that was true when the audience was built.
  -- Between then and now the recipient may have unsubscribed, or the provider may
  -- have told us the address bounced, and honouring either only as far as the
  -- snapshot would mail somebody who has since said no or whose mailbox is dead.
  -- Any attempt the composite decision refuses is settled as suppressed here,
  -- inside the same transaction, before the claim is handed back -- so the worker
  -- never sees it.
  --
  -- This is an efficiency measure, not the authorization boundary. A lease can
  -- last 1800 seconds and the recipient can act inside it, so the real gate is
  -- plugin_data.csf_authorize_communication_dispatch(). Filtering here simply
  -- avoids handing out work that is already known to be unsendable.
  --
  -- Note that the requirement comes from the frozen snapshot, so a transactional
  -- attempt is still exempt from CONSENT -- but not from address SAFETY, which
  -- applies to every requirement.
  WITH revoked AS (
    SELECT
      attempt.id,
      attempt.delivery_id,
      plugin_data.csf_communication_dispatch_decision(
        attempt.organization_id,
        snapshot.delivery_requirement,
        snapshot.topic_key,
        snapshot.recipient_email
      ) AS decision
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    JOIN plugin_data.csf_communication_recipient_snapshots AS snapshot
      ON snapshot.id = attempt.recipient_snapshot_id
      AND snapshot.organization_id = attempt.organization_id
    WHERE attempt.id = ANY (v_claimed_ids)
  ),
  refused AS (
    SELECT
      revoked.id,
      revoked.delivery_id,
      CASE revoked.decision->>'blockedBy'
        WHEN 'address_safety' THEN
          'provider reported this address unsafe: ' || (revoked.decision->>'reason')
        ELSE 'recipient opted out of this topic after the audience was frozen'
      END AS detail
    FROM revoked
    WHERE NOT (revoked.decision->>'authorized')::boolean
  ),
  settled AS (
    UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
    SET
      state = 'suppressed',
      lease_owner = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      failure_class = 'dispatch_refused',
      outcome_detail = refused.detail,
      settlement_source = 'dispatch_refused',
      settled_at = v_now,
      updated_at = v_now
    FROM refused
    WHERE attempt.id = refused.id
    RETURNING attempt.id, attempt.delivery_id, refused.detail
  )
  SELECT coalesce(pg_catalog.array_agg(settled.delivery_id), '{}'::uuid[])
  INTO v_suppressed_delivery_ids
  FROM settled;

  IF pg_catalog.array_length(v_suppressed_delivery_ids, 1) > 0 THEN
    UPDATE plugin_data.csf_communication_deliveries AS delivery
    SET
      status = 'suppressed',
      terminal_locked_at = coalesce(delivery.terminal_locked_at, v_now),
      attempt_count = delivery.attempt_count + 1,
      last_error = coalesce(
        (
          SELECT attempt.outcome_detail
          FROM plugin_data.csf_communication_dispatch_attempts AS attempt
          WHERE attempt.delivery_id = delivery.id
            AND attempt.organization_id = delivery.organization_id
          ORDER BY attempt.attempt_number DESC
          LIMIT 1
        ),
        'dispatch refused before the request left the ledger'
      ),
      updated_at = v_now
    WHERE delivery.id = ANY (v_suppressed_delivery_ids)
      AND delivery.organization_id = p_organization_id
      AND plugin_data.csf_communication_delivery_transition_allowed(
        delivery.status, 'suppressed'
      );
  END IF;

  -- Only attempts that survived the re-check are handed out.
  --
  -- DELIBERATELY NOT A SENDABLE PAYLOAD. There is no from, no to, no subject, no
  -- body, and no tag list here -- only coordinates and the lease window. A worker
  -- that wanted to send from this alone would have to invent the request, which is
  -- exactly the divergence the payload digest exists to prevent. The provider
  -- idempotency key is included for observability, not as a licence: presenting it
  -- without the matching payload is what
  -- plugin_data.csf_authorize_communication_dispatch() exists to make impossible.
  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'attemptId', attempt.id,
        'campaignId', attempt.campaign_id,
        'deliveryId', attempt.delivery_id,
        'recipientSnapshotId', attempt.recipient_snapshot_id,
        'attemptNumber', attempt.attempt_number,
        'providerIdempotencyKey', attempt.provider_idempotency_key,
        'contentHash', attempt.content_hash,
        'requestPayloadHash', attempt.request_payload_hash,
        'leaseExpiresAt', attempt.lease_expires_at,
        'requiresDispatchAuthorization', true
      )
      ORDER BY attempt.attempt_number, attempt.id
    ),
    '[]'::jsonb
  )
  INTO v_claims
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = ANY (v_claimed_ids)
    AND attempt.state = 'processing'
    AND attempt.lease_owner = v_worker;

  -- A campaign with work in flight is sending. Forward-only, so a settled
  -- campaign is left alone.
  UPDATE plugin_data.csf_communication_campaigns AS campaign
  SET status = 'sending', updated_at = v_now
  WHERE campaign.organization_id = p_organization_id
    AND campaign.status = 'queued'
    AND campaign.id IN (
      SELECT (claim.value->>'campaignId')::uuid
      FROM pg_catalog.jsonb_array_elements(v_claims) AS claim(value)
    );

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'workerId', v_worker,
    'leaseSeconds', p_lease_seconds,
    -- Named for what actually happens. A lapsed lease is settled as an unknown
    -- outcome, never reclaimed into a claimable state. Summed across the campaigns
    -- this call walked, since the reap is now per campaign under that campaign's
    -- own lock.
    'unknownOutcomeExpiredLeases', v_reaped_unknown,
    'suppressedAtClaim', coalesce(
      pg_catalog.array_length(v_suppressed_delivery_ids, 1), 0
    ),
    'claimedCount', pg_catalog.jsonb_array_length(v_claims),
    'claims', v_claims,
    'claimAuthorizesSend', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_claim_communication_dispatch_batch(uuid, uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_communication_dispatch_batch(uuid, uuid, text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_communication_dispatch_batch(uuid, uuid, text, integer, integer) IS
  'Atomically settles lapsed leases as unknown outcomes and claims a bounded batch of queued CSF dispatch attempts with FOR UPDATE SKIP LOCKED. Only a queued or sending campaign yields work. The result is deliberately NOT a sendable payload: a worker must call plugin_data.csf_authorize_communication_dispatch() immediately before contacting the provider.';

-- I.4a Authorize one dispatch, immediately before the request is sent.
--
-- A LEASE IS NOT AUTHORIZATION TO SEND.
--
-- A lease may last up to 1800 seconds. Inside that half hour a recipient can click
-- an unsubscribe link, or the provider can tell us their address bounced -- and a
-- claim-time consent check cannot know about either. Treating the claim result as
-- a send-authorizing payload therefore mails people who have already said no.
--
-- So the claim hands back coordinates and THIS call hands back the request. It
-- re-evaluates current broadcast consent AND current address safety, and it
-- returns the exact canonical payload whose digest the ledger already stored,
-- alongside that digest and the allocated idempotency key. A worker that adds or
-- omits a routing tag produces a request whose hash no longer matches the one it
-- was given, which is checkable rather than merely discouraged.
CREATE OR REPLACE FUNCTION plugin_data.csf_authorize_communication_dispatch(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_now timestamptz := now();
  v_attempt plugin_data.csf_communication_dispatch_attempts%ROWTYPE;
  v_snapshot plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  v_campaign_id uuid;
  v_campaign_status text;
  v_decision jsonb;
  v_request jsonb;
  v_coordinate jsonb;
  v_provider_payload jsonb;
  v_hash text;
  v_detail text;
BEGIN
  IF p_organization_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF dispatch authorization requires an organization and an attempt.'
      USING ERRCODE = '22004';
  END IF;

  IF v_worker IS NULL OR pg_catalog.char_length(v_worker) > 128 THEN
    RAISE EXCEPTION
      'A CSF dispatch authorization requires the worker identity that holds the lease.'
      USING ERRCODE = '22023';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF dispatch correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- CANONICAL LOCK ORDER, STEP 1: BOUNDED, UNLOCKED COORDINATE DISCOVERY.
  --
  -- Authorization receives only an attempt id, so the campaign it must lock is
  -- discovered without a row lock first. Taking the attempt FOR UPDATE ahead of the
  -- campaign advisory lock -- as this body used to -- is the same inversion against
  -- cancellation that the settlement path carried.
  SELECT attempt.campaign_id
  INTO v_campaign_id
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- STEP 2: the campaign advisory lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || v_campaign_id::text,
      0
    )
  );

  -- STEP 3: the campaign row.
  SELECT campaign.status
  INTO v_campaign_status
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = v_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- STEP 4: the attempt, re-read under the campaign lock, coordinate re-validated.
  SELECT attempt.*
  INTO v_attempt
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_attempt.campaign_id IS DISTINCT FROM v_campaign_id THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt changed campaign between coordinate discovery and the campaign lock; refusing to authorize a send against a stale coordinate.'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.state <> 'processing' THEN
    RAISE EXCEPTION
      'Only a leased CSF dispatch attempt can be authorized for dispatch; this one is "%".',
      v_attempt.state
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.lease_owner IS DISTINCT FROM v_worker THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt is leased to another worker; a stale worker may not be authorized to send it.'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.lease_expires_at IS NULL OR v_attempt.lease_expires_at <= v_now THEN
    RAISE EXCEPTION
      'This CSF dispatch lease has expired; renew the claim before asking to send.'
      USING ERRCODE = '23514';
  END IF;

  -- A LEASE TAKEN BEFORE CANCELLATION MUST NOT AUTHORIZE A SEND AFTER IT.
  --
  -- Cancellation reports live leases rather than stealing them, so a worker can
  -- legitimately still hold one when the campaign is withdrawn. Reaching the
  -- consent recheck and the payload build from here would hand that worker a
  -- complete sendable request -- sender, recipient, subject, both bodies, topic,
  -- and the allocated idempotency key -- for a campaign an officer has already
  -- stopped. The status is therefore consulted BEFORE any of that is assembled,
  -- and it is read under the same advisory lock cancellation holds, so the two
  -- cannot interleave.
  --
  -- FENCING COMES FIRST, THOUGH. This branch SETTLES the attempt, and a settlement
  -- is only ever the live leaseholder's to make: letting a stale or lapsed worker
  -- reach it would let somebody who cannot speak for this attempt write its final
  -- outcome. A lapsed lease on a cancelled campaign therefore still raises above
  -- and is settled by the reaper as an unknown outcome, which is the honest answer
  -- -- nobody knows whether the lapsed holder had already sent.
  --
  -- The live holder's attempt settles here rather than being handed back: nothing
  -- left the ledger for it, which makes 'failed' the observed truth and keeps the
  -- reaper from later inventing an unknown outcome for a send that provably never
  -- happened. It matches how cancellation itself settles the queued attempts it
  -- can reach.
  IF v_campaign_status NOT IN ('queued', 'sending') THEN
    v_detail := pg_catalog.left(
      'campaign is "' || v_campaign_status
        || '" and can no longer authorize a dispatch',
      1000
    );

    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET
      state = 'failed',
      failure_class = CASE
        WHEN v_campaign_status = 'cancelled' THEN 'campaign_cancelled'
        ELSE 'campaign_not_sendable'
      END,
      outcome_detail = v_detail,
      correlation_id = coalesce(correlation_id, v_correlation),
      settlement_source = 'dispatch_refused',
      lease_owner = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      settled_at = v_now,
      updated_at = v_now
    WHERE id = p_attempt_id;

    UPDATE plugin_data.csf_communication_deliveries AS delivery
    SET
      status = CASE
        WHEN plugin_data.csf_communication_delivery_transition_allowed(
          delivery.status, 'failed'
        ) THEN 'failed'
        ELSE delivery.status
      END,
      failed_at = CASE
        WHEN plugin_data.csf_communication_delivery_transition_allowed(
          delivery.status, 'failed'
        ) THEN coalesce(delivery.failed_at, greatest(v_now, delivery.queued_at))
        ELSE delivery.failed_at
      END,
      attempt_count = delivery.attempt_count + 1,
      last_error = v_detail,
      updated_at = v_now
    WHERE delivery.id = v_attempt.delivery_id
      AND delivery.organization_id = p_organization_id;

    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'attemptId', p_attempt_id,
      'deliveryId', v_attempt.delivery_id,
      'authorized', false,
      'blockedBy', 'campaign_status',
      'decision', 'refused',
      'reason', v_detail,
      'campaignStatus', v_campaign_status,
      'attemptState', 'failed',
      'coordinate', NULL,
      'providerPayload', NULL,
      'requestPayloadHash', NULL,
      'providerIdempotencyKey', NULL
    );
  END IF;

  SELECT snapshot.*
  INTO v_snapshot
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.id = v_attempt.recipient_snapshot_id
    AND snapshot.organization_id = p_organization_id
    AND snapshot.campaign_id = v_attempt.campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF audience snapshot for this dispatch attempt does not exist in this campaign.'
      USING ERRCODE = '23503';
  END IF;

  -- The recheck. Address safety for every requirement; topic-scoped consent for
  -- broadcasts only.
  v_decision := plugin_data.csf_communication_dispatch_decision(
    p_organization_id,
    v_snapshot.delivery_requirement,
    v_snapshot.topic_key,
    v_snapshot.recipient_email
  );

  IF NOT (v_decision->>'authorized')::boolean THEN
    v_detail := CASE v_decision->>'blockedBy'
      WHEN 'address_safety' THEN
        'provider reported this address unsafe: ' || (v_decision->>'reason')
      ELSE 'recipient opted out of this topic after the audience was frozen'
    END;

    -- Refused work settles here rather than being handed back for the worker to
    -- decide about. A refusal is a real, terminal outcome for this recipient.
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET
      state = 'suppressed',
      failure_class = 'dispatch_refused',
      outcome_detail = v_detail,
      correlation_id = coalesce(correlation_id, v_correlation),
      settlement_source = 'dispatch_refused',
      lease_owner = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      settled_at = v_now,
      updated_at = v_now
    WHERE id = p_attempt_id;

    UPDATE plugin_data.csf_communication_deliveries AS delivery
    SET
      status = CASE
        WHEN plugin_data.csf_communication_delivery_transition_allowed(
          delivery.status, 'suppressed'
        ) THEN 'suppressed'
        ELSE delivery.status
      END,
      terminal_locked_at = CASE
        WHEN plugin_data.csf_communication_delivery_transition_allowed(
          delivery.status, 'suppressed'
        ) THEN coalesce(delivery.terminal_locked_at, v_now)
        ELSE delivery.terminal_locked_at
      END,
      attempt_count = delivery.attempt_count + 1,
      last_error = v_detail,
      updated_at = v_now
    WHERE delivery.id = v_attempt.delivery_id
      AND delivery.organization_id = p_organization_id;

    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'attemptId', p_attempt_id,
      'deliveryId', v_attempt.delivery_id,
      'authorized', false,
      'blockedBy', v_decision->>'blockedBy',
      'decision', v_decision->>'decision',
      'reason', v_decision->>'reason',
      'attemptState', 'suppressed',
      'coordinate', NULL,
      'providerPayload', NULL,
      'requestPayloadHash', NULL,
      'providerIdempotencyKey', NULL
    );
  END IF;

  -- The exact request, rebuilt from the same one function the enqueue trigger
  -- hashed.
  v_request := plugin_data.csf_communication_provider_request(
    p_organization_id,
    v_attempt.campaign_id,
    v_attempt.recipient_snapshot_id,
    v_attempt.id,
    v_attempt.attempt_number
  );
  v_hash := plugin_data.csf_communication_provider_request_hash(v_request);
  v_coordinate := v_request->'coordinate';
  -- The idempotency key is DERIVED from the digest, so it cannot also be inside
  -- the hashed document without being circular. It is merged into the sendable
  -- payload here, which is the last point before the payload leaves the ledger.
  v_provider_payload := (v_request->'providerPayload')
    || pg_catalog.jsonb_build_object(
      'idempotencyKey', v_attempt.provider_idempotency_key
    );

  -- A DIVERGENCE HERE IS A BUG, NOT A WARNING. If the payload the worker is about
  -- to send no longer hashes to what the key was allocated against, then the
  -- campaign or snapshot changed behind an allocated idempotency key, and sending
  -- would present a key that names a different message. Refuse rather than send.
  IF v_hash IS DISTINCT FROM v_attempt.request_payload_hash THEN
    RAISE EXCEPTION
      'The CSF provider request for this attempt no longer matches the digest its idempotency key was allocated against; refusing to authorize a send the ledger cannot vouch for.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE plugin_data.csf_communication_dispatch_attempts
  SET
    dispatch_authorized_at = coalesce(dispatch_authorized_at, v_now),
    dispatch_authorized_to = coalesce(dispatch_authorized_to, v_worker),
    correlation_id = coalesce(correlation_id, v_correlation),
    updated_at = v_now
  WHERE id = p_attempt_id;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'attemptId', p_attempt_id,
    'deliveryId', v_attempt.delivery_id,
    'campaignId', v_attempt.campaign_id,
    'recipientSnapshotId', v_attempt.recipient_snapshot_id,
    'attemptNumber', v_attempt.attempt_number,
    'authorized', true,
    'blockedBy', NULL,
    'decision', v_decision->>'decision',
    'reason', v_decision->>'reason',
    'attemptState', 'processing',
    -- Internal ledger identity. The worker uses it to settle; it is never sent.
    'coordinate', v_coordinate,
    -- The EXACT sendable request. The worker adapter passes this object to the
    -- transport with no additions, no removals, and no reshaping -- which is why
    -- its digest is a meaningful statement about what the recipient receives.
    'providerPayload', v_provider_payload,
    'requestPayloadHash', v_hash,
    'providerIdempotencyKey', v_attempt.provider_idempotency_key,
    'leaseExpiresAt', v_attempt.lease_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text) IS
  'The immediately-before-dispatch gate. A lease can last 1800 seconds, so this re-checks current broadcast consent AND current address safety, settles refused work as suppressed, and otherwise returns an internal coordinate plus the EXACT sendable providerPayload -- from, to, replyTo, subject, bodies, tag array, headers, topicId, transport type, and idempotency key -- whose digest the ledger already stored. The worker adapter forwards providerPayload unchanged, so the digest describes what the recipient actually receives.';

-- I.4b Cancel a campaign atomically.
--
-- Cancellation has to be a single transaction that both stops future work and
-- settles the work already queued. Setting the campaign status alone would
-- leave queued attempts that the next reaper would happily hand out, so the two
-- happen together: the queued attempts settle, the campaign moves to
-- 'cancelled', and the claim path's campaign-status filter keeps anything that
-- is still leased from ever being reclaimed.
CREATE OR REPLACE FUNCTION plugin_data.csf_cancel_communication_campaign(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- 'manage_settings' is the existing chapter-administration capability -- held by
  -- owner, advisor, and co-president -- and withdrawing a chapter-wide send is
  -- exactly that kind of decision. csf_actor_has_permission() is tenant-scoped and
  -- requires an ACTIVE membership plus an in-date staff position, so a former
  -- officer, a member of another chapter, or any signed-in account that merely
  -- exists is refused.
  c_capability constant text := 'manage_settings';
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_now timestamptz := now();
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_reaped jsonb;
  v_settled integer := 0;
  v_deliveries integer := 0;
  v_still_leased integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'A CSF campaign cancellation requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 300 THEN
    RAISE EXCEPTION
      'A CSF campaign cancellation records a reason of 1 to 300 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF cancellation correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- THE ACTOR IS AUTHORIZATION, NOT DECORATION.
  --
  -- Checking only that the account exists would let any signed-in user in any
  -- organization stop another chapter's send, because service_role reaches this
  -- RPC on behalf of whoever is holding the session.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign cancellation must record the staff account that decided it.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to cancel a campaign in this organization.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  -- The durable actor record. created_by-style references are ON DELETE SET NULL,
  -- so an account removal must not erase who cancelled a send.
  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  -- The same campaign advisory lock plugin_data.csf_settle_communication_dispatch_attempt()
  -- takes, so a live worker's settlement and this cancellation cannot interleave
  -- into a rolled-back settlement and a fabricated unknown outcome.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.status = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'status', 'cancelled',
      'attemptsSettled', 0,
      'deliveriesSettled', 0,
      'attemptsStillLeased', 0,
      'expiredLeasesSettledUnknown', 0,
      'idempotentReplay', true
    );
  END IF;

  IF v_campaign.status NOT IN ('draft', 'queued', 'sending') THEN
    RAISE EXCEPTION
      'A settled CSF campaign ("%") cannot be cancelled.', v_campaign.status
      USING ERRCODE = '23514';
  END IF;

  -- CANCELLATION SETTLES EXPIRED LEASED WORK HONESTLY.
  --
  -- Work whose lease already lapsed is ambiguous: the holder may have sent it. If
  -- cancellation left it in 'processing', nothing would ever settle it -- the claim
  -- path refuses to yield work for a cancelled campaign, so no later sweep would
  -- reach it, and the ledger would carry a permanently unsettled attempt that no
  -- review queue surfaces. Reaping first turns each of those into an honest
  -- unknown_outcome with review evidence.
  --
  -- This is deliberately NOT a retry. Nothing here re-enqueues anything, and the
  -- attempts it settles are unretryable by construction.
  v_reaped := plugin_data.csf_reap_communication_dispatch_leases(
    p_organization_id, p_campaign_id
  );

  -- Queued work settles now. queued -> failed is a legal attempt transition, and
  -- a queued attempt is provably pre-provider: it never held a lease, so nothing
  -- was ever handed over for it.
  UPDATE plugin_data.csf_communication_dispatch_attempts AS attempt
  SET
    state = 'failed',
    failure_class = 'campaign_cancelled',
    outcome_detail = v_reason,
    correlation_id = coalesce(attempt.correlation_id, v_correlation),
    settlement_source = 'cancellation',
    lease_owner = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    settled_at = v_now,
    updated_at = v_now
  WHERE attempt.organization_id = p_organization_id
    AND attempt.campaign_id = p_campaign_id
    AND attempt.state = 'queued';
  GET DIAGNOSTICS v_settled = ROW_COUNT;

  -- Anything STILL leased holds a live lease and belongs to a worker that may yet
  -- settle it honestly. It is reported, not stolen; the campaign-status filter on
  -- the claim path stops it being handed to anybody else, and when its lease does
  -- lapse the reaper settles it as an unknown outcome rather than a retry.
  SELECT count(*)::integer
  INTO v_still_leased
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.campaign_id = p_campaign_id
    AND attempt.state = 'processing';

  UPDATE plugin_data.csf_communication_deliveries AS delivery
  SET
    status = 'failed',
    failed_at = coalesce(delivery.failed_at, greatest(v_now, delivery.queued_at)),
    last_error = v_reason,
    updated_at = v_now
  WHERE delivery.organization_id = p_organization_id
    AND delivery.campaign_id = p_campaign_id
    AND delivery.status = 'queued'
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.organization_id = delivery.organization_id
        AND attempt.delivery_id = delivery.id
        AND attempt.state IN ('queued', 'processing')
    );
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  UPDATE plugin_data.csf_communication_campaigns
  SET
    status = 'cancelled',
    cancelled_at = v_now,
    cancellation_reason = v_reason,
    cancelled_by = p_actor_user_id,
    cancelled_by_identity = v_actor_identity,
    correlation_id = coalesce(correlation_id, v_correlation),
    completed_at = coalesce(completed_at, v_now),
    updated_at = v_now
  WHERE id = p_campaign_id
    AND organization_id = p_organization_id;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'status', 'cancelled',
    'attemptsSettled', v_settled,
    'deliveriesSettled', v_deliveries,
    'attemptsStillLeased', v_still_leased,
    'expiredLeasesSettledUnknown', coalesce(
      (v_reaped->>'settledUnknownOutcomes')::integer, 0
    ),
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_cancel_communication_campaign(uuid, uuid, text, uuid, text) IS
  'Atomically cancels a CSF campaign under an ACTIVE tenant-scoped staff capability: settles expired leased work as unknown outcomes, settles every queued attempt, settles the deliveries left with no live attempt, and freezes the actor and correlation that decided it. Never enqueues a retry. Work under a live lease is reported rather than stolen.';

-- I.5 Settle one attempt.
--
-- UNKNOWN OUTCOME SAFETY lives here. 'accepted', 'failed', 'suppressed', and
-- 'retryable_failure' are outcomes the worker actually observed.
-- 'unknown_outcome' is the honest answer when the worker cannot tell whether
-- the provider accepted the send, and it deliberately does NOT enqueue a
-- retry -- retrying an ambiguous send is how a recipient gets the same message
-- twice. It settles the attempt, marks the delivery for human review, and
-- leaves reconciliation to real provider evidence.
CREATE OR REPLACE FUNCTION plugin_data.csf_settle_communication_dispatch_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status_code integer DEFAULT NULL,
  p_failure_class text DEFAULT NULL,
  p_detail text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT 60,
  p_max_attempts integer DEFAULT 5,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_failure_class text := nullif(btrim(coalesce(p_failure_class, '')), '');
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_now timestamptz := now();
  -- Computed once, then used BOTH to compare an idempotent replay and to write
  -- the row. Deriving it twice from two copies of the same CASE expression is how
  -- a replay comparison silently drifts from what settlement actually stores.
  v_unknown_reason text;
  v_attempt plugin_data.csf_communication_dispatch_attempts%ROWTYPE;
  v_delivery plugin_data.csf_communication_deliveries%ROWTYPE;
  v_campaign_id uuid;
  v_campaign_status text;
  v_target_delivery_status text;
  v_retry_enqueued boolean := false;
  v_cancelled_without_retry boolean := false;
  v_next_attempt_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'A CSF dispatch settlement requires an organization and an attempt.'
      USING ERRCODE = '22004';
  END IF;

  IF v_worker IS NULL OR pg_catalog.char_length(v_worker) > 128 THEN
    RAISE EXCEPTION 'A CSF dispatch settlement requires the worker identity that holds the lease.'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome NOT IN (
    'accepted', 'failed', 'retryable_failure', 'suppressed', 'unknown_outcome'
  ) THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt settles as accepted, failed, retryable_failure, suppressed, or unknown_outcome.'
      USING ERRCODE = '22023';
  END IF;

  IF p_retry_after_seconds IS NULL
    OR p_retry_after_seconds < 0
    OR p_retry_after_seconds > 86400
  THEN
    RAISE EXCEPTION 'A CSF dispatch retry delay is between 0 and 86400 seconds.'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10 THEN
    RAISE EXCEPTION 'A CSF recipient is tried between 1 and 10 times.'
      USING ERRCODE = '22023';
  END IF;

  IF v_detail IS NOT NULL AND pg_catalog.char_length(v_detail) > 1000 THEN
    v_detail := pg_catalog.left(v_detail, 1000);
  END IF;

  IF v_failure_class IS NOT NULL AND pg_catalog.char_length(v_failure_class) > 64 THEN
    RAISE EXCEPTION 'A CSF dispatch failure class is at most 64 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_message_id IS NOT NULL AND pg_catalog.char_length(v_message_id) > 255 THEN
    RAISE EXCEPTION 'A CSF provider message identity is at most 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- Operational scalars only, under the same positive rule provider evidence
  -- obeys. A worker cannot park a raw provider response on the attempt ledger.
  IF NOT plugin_data.csf_provider_event_metadata_allowlisted(v_metadata) THEN
    RAISE EXCEPTION
      'CSF dispatch settlement metadata may hold only allowlisted, scalar, bounded operational fields.'
      USING ERRCODE = '22023';
  END IF;

  -- Derived after v_detail has been bounded, so it is exactly the value the
  -- UPDATE below stores.
  v_unknown_reason := CASE
    WHEN p_outcome = 'unknown_outcome'
      THEN coalesce(v_detail, 'provider outcome could not be determined')
    ELSE NULL
  END;

  -- CANONICAL LOCK ORDER, STEP 1: BOUNDED, UNLOCKED COORDINATE DISCOVERY.
  --
  -- This RPC receives only an attempt id, so it cannot take the campaign advisory
  -- lock until it knows which campaign the attempt belongs to. Reading that
  -- coordinate WITHOUT a row lock is the whole point: the previous body took the
  -- attempt FOR UPDATE first and only then asked for the advisory lock, which is
  -- the exact inversion of cancellation's advisory -> campaign -> attempts order.
  -- Two sessions -- one settling attempt X, one cancelling X's campaign -- could
  -- therefore each hold what the other was waiting for, and PostgreSQL broke the
  -- cycle with SQLSTATE 40P01.
  SELECT attempt.campaign_id
  INTO v_campaign_id
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- STEP 2: the campaign advisory lock, taken before any row lock, exactly as
  -- cancellation, claim, reap, authorization, and the evidence resolver take it.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || v_campaign_id::text,
      0
    )
  );

  -- STEP 3: the campaign row.
  SELECT campaign.status
  INTO v_campaign_status
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = v_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- STEP 4: the attempt, re-read UNDER the campaign lock because step 1 was
  -- deliberately unlocked. Fail closed if the coordinate moved: an attempt whose
  -- campaign changed between the discovery read and here is not the row this
  -- transaction reasoned about, and settling it would attribute a provider outcome
  -- to the wrong send.
  SELECT attempt.*
  INTO v_attempt
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_attempt.campaign_id IS DISTINCT FROM v_campaign_id THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt changed campaign between coordinate discovery and the campaign lock; refusing to settle against a stale coordinate.'
      USING ERRCODE = '23514';
  END IF;

  -- SETTLED EVIDENCE IS FROZEN, SO A REPLAY MUST MATCH ALL OF IT.
  --
  -- Replay handling compares every piece of evidence the settlement recorded, not
  -- merely its state name. Two different provider responses that happen to map to
  -- the same outcome are NOT the same settlement: comparing only the state would
  -- silently discard the second provider message identity, the second status code,
  -- or a different failure detail -- and because settled evidence is frozen, the
  -- discarded version could never be recovered.
  --
  -- outcome_detail and unknown_reason are compared as the values this RPC WOULD
  -- have stored -- the bounded forms -- so a caller replaying an over-long detail
  -- still matches.
  --
  -- Note that v_unknown_reason is compared as a VARIABLE rather than as an inline
  -- CASE expression. PL/pgSQL does not parse an IF condition itself: it scans
  -- forward for the terminating THEN at paren depth zero and hands the text before
  -- it to the SQL parser. A bare CASE here is therefore cut at the CASE's OWN
  -- THEN, and the fragment that reaches the parser ends while still expecting one.
  IF v_attempt.settled_at IS NOT NULL THEN
    -- THE PROVIDER GOT HERE FIRST, AND THE WORKER IS CONFIRMING, NOT CONFLICTING.
    --
    -- Resend routinely delivers a signed webhook before the send call's own HTTP
    -- response returns. The resolver settles the attempt from that evidence, so by
    -- the time the worker reports 'accepted' the attempt may already read
    -- 'accepted', 'delivered', or even 'bounced'. Comparing outcome names would
    -- call that a conflicting re-settlement and raise -- punishing a worker for
    -- being slower than a webhook, and (because the raise aborts its transaction)
    -- leaving the worker to retry forever.
    --
    -- A worker acceptance that agrees with the provider's own message identity is
    -- therefore recorded as a confirmation. The provider's evidence stays
    -- authoritative; nothing is rewritten.
    -- The same reasoning covers a worker whose settlement committed but whose
    -- response was lost, if a provider event advanced the attempt before it
    -- retried: it is still confirming an acceptance the ledger already knows
    -- something stronger and consistent about. 'failed' is deliberately excluded --
    -- a worker claiming acceptance of an attempt recorded as failed is a real
    -- contradiction and must still raise.
    IF p_outcome = 'accepted'
      AND (
        v_attempt.settlement_source = 'provider'
        OR v_attempt.state IN ('delivered', 'bounced', 'complained', 'suppressed')
      )
      AND (
        v_message_id IS NULL
        OR v_attempt.provider_message_id IS NULL
        OR v_attempt.provider_message_id = v_message_id
      )
    THEN
      UPDATE plugin_data.csf_communication_dispatch_attempts
      SET
        worker_confirmed_at = coalesce(worker_confirmed_at, v_now),
        updated_at = v_now
      WHERE id = p_attempt_id;

      RETURN pg_catalog.jsonb_build_object(
        'organizationId', p_organization_id,
        'attemptId', p_attempt_id,
        'deliveryId', v_attempt.delivery_id,
        'attemptState', v_attempt.state,
        'settlementSource', 'provider',
        'workerConfirmedProviderSettlement', true,
        'retryEnqueued', false,
        'idempotentReplay', true
      );
    END IF;

    -- A LATE WORKER NEVER OVERWRITES A RECONCILED RESULT -- AND IS NEVER LEFT
    -- SPINNING BY ONE EITHER.
    --
    -- Once provider evidence or an officer has reconciled this attempt, its state
    -- is no longer the state the worker settled, so the exact-evidence comparison
    -- below can never match and would raise. A raise aborts the worker's
    -- transaction, which is how a settlement whose HTTP response was merely lost
    -- turns into an unbounded retry loop against a ledger that has already moved
    -- on. So the two cases are separated: a worker replaying the settlement that
    -- reconciliation superseded is told so and stops, and anything else is refused
    -- by name rather than by a confusing "different provider evidence" message.
    IF v_attempt.reconciled_at IS NOT NULL THEN
      IF p_outcome = 'unknown_outcome'
        AND v_attempt.unknown_reason IS NOT DISTINCT FROM v_unknown_reason
      THEN
        RETURN pg_catalog.jsonb_build_object(
          'organizationId', p_organization_id,
          'attemptId', p_attempt_id,
          'deliveryId', v_attempt.delivery_id,
          'attemptState', v_attempt.state,
          'reconciledOutcome', v_attempt.reconciled_outcome,
          'reconciledActorKind', v_attempt.reconciled_actor_kind,
          'supersededByReconciliation', true,
          'retryEnqueued', false,
          'idempotentReplay', true
        );
      END IF;

      RAISE EXCEPTION
        'That CSF dispatch attempt was already reconciled as "%" on % evidence; a late worker settlement never overwrites a reconciled result.',
        v_attempt.reconciled_outcome, v_attempt.reconciled_actor_kind
        USING ERRCODE = '23514';
    END IF;

    IF v_attempt.state = p_outcome
      AND v_attempt.provider_message_id IS NOT DISTINCT FROM v_message_id
      AND v_attempt.provider_status_code IS NOT DISTINCT FROM p_provider_status_code
      AND v_attempt.failure_class IS NOT DISTINCT FROM v_failure_class
      AND v_attempt.outcome_detail IS NOT DISTINCT FROM v_detail
      AND v_attempt.unknown_reason IS NOT DISTINCT FROM v_unknown_reason
      AND v_attempt.metadata IS NOT DISTINCT FROM v_metadata
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'organizationId', p_organization_id,
        'attemptId', p_attempt_id,
        'deliveryId', v_attempt.delivery_id,
        'attemptState', v_attempt.state,
        'retryEnqueued', false,
        'idempotentReplay', true
      );
    END IF;

    RAISE EXCEPTION
      'That CSF dispatch attempt already settled as "%" with different provider evidence and cannot be re-settled as "%".',
      v_attempt.state, p_outcome
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.state <> 'processing' THEN
    RAISE EXCEPTION
      'Only a leased CSF dispatch attempt can be settled; this one is "%".',
      v_attempt.state
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.lease_owner IS DISTINCT FROM v_worker THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt is leased to another worker; a stale worker may not settle it.'
      USING ERRCODE = '23514';
  END IF;

  -- An expired lease means the attempt may already have been reclaimed and
  -- re-sent by someone else. Accepting a settlement on it would record an
  -- outcome for a send this worker can no longer speak for.
  IF v_attempt.lease_expires_at IS NULL OR v_attempt.lease_expires_at <= v_now THEN
    RAISE EXCEPTION
      'This CSF dispatch lease has expired; the attempt may already have been reclaimed and cannot be settled by the lapsed holder.'
      USING ERRCODE = '23514';
  END IF;

  IF p_outcome = 'accepted' AND v_message_id IS NULL THEN
    RAISE EXCEPTION
      'An accepted CSF dispatch attempt must record the provider message identity it was accepted as.'
      USING ERRCODE = '23514';
  END IF;

  -- A PROVIDER ACCEPTANCE IMPLIES THE LEDGER HANDED OVER A REQUEST.
  --
  -- The only payload a worker may send is the one
  -- plugin_data.csf_authorize_communication_dispatch() returns, and that call
  -- stamps the attempt. An 'accepted' settlement on an attempt that was never
  -- authorized therefore describes a send the ledger did not sanction, which is
  -- either a worker that built its own request or a confused coordinate. Both need
  -- to be visible.
  --
  -- 'unknown_outcome' is deliberately exempt: a worker that genuinely cannot tell
  -- what happened must always be able to say so.
  IF p_outcome = 'accepted' AND v_attempt.dispatch_authorized_at IS NULL THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt was never authorized for dispatch, so it cannot report a provider acceptance; authorize it through plugin_data.csf_authorize_communication_dispatch() before sending.'
      USING ERRCODE = '23514';
  END IF;

  -- A provider that returned a message identity ACCEPTED the send. Calling that
  -- retryable would schedule a duplicate. Such a response is 'accepted', or --
  -- if the worker truly cannot tell what happened -- 'unknown_outcome'.
  IF p_outcome = 'retryable_failure' AND v_message_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A CSF dispatch response that carries a provider message identity was accepted and can never be auto-retried; settle it as accepted or as unknown_outcome.'
      USING ERRCODE = '23514';
  END IF;

  SELECT delivery.*
  INTO v_delivery
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.id = v_attempt.delivery_id
    AND delivery.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The CSF delivery for this dispatch attempt is missing.'
      USING ERRCODE = '23503';
  END IF;

  UPDATE plugin_data.csf_communication_dispatch_attempts
  SET
    state = p_outcome,
    provider_message_id = coalesce(provider_message_id, v_message_id),
    provider_status_code = coalesce(p_provider_status_code, provider_status_code),
    failure_class = v_failure_class,
    outcome_detail = v_detail,
    unknown_reason = v_unknown_reason,
    review_state = CASE WHEN p_outcome = 'unknown_outcome' THEN 'pending' ELSE review_state END,
    metadata = v_metadata,
    settlement_source = 'worker',
    lease_owner = NULL,
    leased_at = NULL,
    lease_expires_at = NULL,
    settled_at = v_now,
    updated_at = v_now
  WHERE id = p_attempt_id;

  -- Delivery truth. Each settled attempt counts, and the status only moves when
  -- the delivery state machine actually permits the move.
  v_target_delivery_status := CASE p_outcome
    WHEN 'accepted' THEN 'sent'
    WHEN 'failed' THEN 'failed'
    WHEN 'suppressed' THEN 'suppressed'
    ELSE NULL
  END;

  IF v_target_delivery_status IS NOT NULL
    AND NOT plugin_data.csf_communication_delivery_transition_allowed(
      v_delivery.status, v_target_delivery_status
    )
  THEN
    v_target_delivery_status := NULL;
  END IF;

  UPDATE plugin_data.csf_communication_deliveries
  SET
    attempt_count = attempt_count + 1,
    status = coalesce(v_target_delivery_status, status),
    provider_message_id = coalesce(provider_message_id, v_message_id),
    sent_at = CASE
      WHEN v_target_delivery_status = 'sent' THEN coalesce(sent_at, greatest(v_now, queued_at))
      ELSE sent_at
    END,
    failed_at = CASE
      WHEN v_target_delivery_status = 'failed' THEN coalesce(failed_at, greatest(v_now, queued_at))
      ELSE failed_at
    END,
    terminal_locked_at = CASE
      WHEN v_target_delivery_status = 'suppressed' THEN coalesce(terminal_locked_at, v_now)
      ELSE terminal_locked_at
    END,
    last_error = CASE
      WHEN p_outcome IN ('failed', 'retryable_failure') THEN v_detail
      ELSE last_error
    END,
    unknown_outcome_at = CASE
      WHEN p_outcome = 'unknown_outcome' THEN coalesce(unknown_outcome_at, v_now)
      ELSE unknown_outcome_at
    END,
    review_state = CASE
      WHEN p_outcome = 'unknown_outcome' AND review_state = 'none' THEN 'pending'
      ELSE review_state
    END,
    review_reason = CASE
      WHEN p_outcome = 'unknown_outcome' AND review_reason IS NULL
        THEN coalesce(pg_catalog.left(v_detail, 300), 'provider outcome could not be determined')
      ELSE review_reason
    END,
    updated_at = v_now
  WHERE id = v_attempt.delivery_id
    AND organization_id = p_organization_id;

  -- AN UNKNOWN OUTCOME MAKES THE CAMPAIGN VISIBLY REVIEW-BLOCKED, whichever path
  -- produced it. The lease reaper does the same, so an operator looking at the
  -- campaign never has to read the attempt ledger to learn that some recipient's
  -- fate is unaccounted for -- and the terminalization guard refuses to call such a
  -- campaign completed.
  IF p_outcome = 'unknown_outcome' THEN
    UPDATE plugin_data.csf_communication_campaigns AS campaign
    SET
      review_blocked_at = coalesce(campaign.review_blocked_at, v_now),
      review_blocked_reason = coalesce(
        campaign.review_blocked_reason,
        pg_catalog.left(
          coalesce(v_detail, 'a recipient provider outcome could not be determined'),
          300
        )
      ),
      updated_at = v_now
    WHERE campaign.id = v_attempt.campaign_id
      AND campaign.organization_id = p_organization_id
      AND campaign.status <> 'completed';
  END IF;

  -- Only an observed, retryable failure earns another attempt. An unknown
  -- outcome never reaches this branch.
  --
  -- A CANCELLED CAMPAIGN EARNS NO SUCCESSOR, AND SAYING SO IS NOT OPTIONAL.
  --
  -- Cancellation reports the leases it could not settle rather than stealing them,
  -- so a worker can legitimately still be holding one when the campaign is
  -- withdrawn. If that worker then reported a retryable failure, this branch used
  -- to attempt the successor INSERT anyway; the enqueue guard rejects an attempt on
  -- a cancelled campaign, and because that raise happens inside the settlement
  -- transaction it rolled back the ENTIRE settlement. The attempt stayed
  -- 'processing' with a lease nobody would renew, and the reaper later converted a
  -- perfectly well-understood retryable failure into a fabricated
  -- 'unknown_outcome' -- manufacturing ambiguity out of a known outcome, which is
  -- exactly the thing this ledger exists to avoid.
  --
  -- So the campaign status is consulted first, and a cancelled campaign records the
  -- observed failure with no successor. v_campaign_status was read under BOTH the
  -- campaign advisory lock and the campaign row lock above -- the same two locks
  -- cancellation takes, in the same order -- so it cannot change underneath this.
  IF p_outcome = 'retryable_failure' THEN
    IF v_campaign_status = 'cancelled' THEN
      UPDATE plugin_data.csf_communication_deliveries
      SET
        status = CASE
          WHEN plugin_data.csf_communication_delivery_transition_allowed(status, 'failed')
            THEN 'failed'
          ELSE status
        END,
        failed_at = CASE
          WHEN plugin_data.csf_communication_delivery_transition_allowed(status, 'failed')
            THEN coalesce(failed_at, greatest(v_now, queued_at))
          ELSE failed_at
        END,
        last_error = coalesce(
          v_detail, 'retryable failure observed after the campaign was cancelled'
        ),
        updated_at = v_now
      WHERE id = v_attempt.delivery_id
        AND organization_id = p_organization_id;

      v_cancelled_without_retry := true;
    ELSIF v_attempt.attempt_number < p_max_attempts THEN
      INSERT INTO plugin_data.csf_communication_dispatch_attempts (
        organization_id, campaign_id, recipient_snapshot_id, delivery_id,
        attempt_number, provider_idempotency_key, content_hash,
        recipient_email_hash, available_at
      ) VALUES (
        p_organization_id, v_attempt.campaign_id, v_attempt.recipient_snapshot_id,
        v_attempt.delivery_id, v_attempt.attempt_number + 1, NULL,
        v_attempt.content_hash, v_attempt.recipient_email_hash,
        v_now + pg_catalog.make_interval(secs => p_retry_after_seconds)
      )
      RETURNING id INTO v_next_attempt_id;

      v_retry_enqueued := true;
    ELSE
      -- Out of tries. The delivery settles as failed if the state machine still
      -- allows it; otherwise it keeps whatever terminal truth it already holds.
      UPDATE plugin_data.csf_communication_deliveries
      SET
        status = CASE
          WHEN plugin_data.csf_communication_delivery_transition_allowed(status, 'failed')
            THEN 'failed'
          ELSE status
        END,
        failed_at = CASE
          WHEN plugin_data.csf_communication_delivery_transition_allowed(status, 'failed')
            THEN coalesce(failed_at, greatest(v_now, queued_at))
          ELSE failed_at
        END,
        updated_at = v_now
      WHERE id = v_attempt.delivery_id
        AND organization_id = p_organization_id;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'attemptId', p_attempt_id,
    'deliveryId', v_attempt.delivery_id,
    'attemptNumber', v_attempt.attempt_number,
    'attemptState', p_outcome,
    'deliveryStatus', coalesce(v_target_delivery_status, v_delivery.status),
    'retryEnqueued', v_retry_enqueued,
    'nextAttemptId', v_next_attempt_id,
    -- True when an observed retryable failure was recorded WITHOUT a successor
    -- because the campaign had already been cancelled. The outcome is known and
    -- settled; it simply will not be tried again.
    'retrySuppressedByCancellation', v_cancelled_without_retry,
    'campaignStatus', v_campaign_status,
    'requiresHumanReview', p_outcome = 'unknown_outcome',
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_settle_communication_dispatch_attempt(
  uuid, uuid, text, text, text, integer, text, text, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_settle_communication_dispatch_attempt(
  uuid, uuid, text, text, text, integer, text, text, integer, integer, jsonb
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_settle_communication_dispatch_attempt(
  uuid, uuid, text, text, text, integer, text, text, integer, integer, jsonb
) IS
  'Atomically settles one leased CSF dispatch attempt and reduces its delivery. An idempotent replay must match every recorded piece of evidence -- outcome, provider message identity, status code, failure class, detail, unknown reason, and metadata -- because settled evidence is frozen and a mismatched replay would otherwise discard the difference. UNKNOWN OUTCOME SAFETY: an unknown_outcome settlement never enqueues a retry, marks the delivery for human review, and leaves resolution to provider evidence or plugin_data.csf_reconcile_communication_unknown_outcome().';

-- I.5b THE ONE PROVIDER-EVIDENCE RESOLUTION PRIMITIVE.
--
-- Recording a fresh webhook and rebinding a previously unmatched one are the same
-- operation reached from two directions, and they used to be two bodies of code
-- doing almost-but-not-quite the same thing. Almost-but-not-quite is how a bounce
-- ends up locking a delivery on one path and not the other. So both call this.
--
-- Given one already-recorded, signature-verified event row, this atomically:
--
--   1. binds the delivery's provider-message identity when the webhook is the
--      first thing to tell us what it is (the webhook-beats-settlement case),
--   2. binds the matching attempt, resolved from the SIGNED csf_attempt_id
--      routing tag -- never from message content and never from a recipient
--      address,
--   3. advances an 'accepted' or 'unknown_outcome' attempt to the evidence-backed
--      outcome, recording that PROVIDER evidence resolved it rather than a human,
--   4. reduces delivery truth through the same monotonic decision function,
--   5. resolves review state on both the attempt and the delivery,
--   6. updates the address-safety projection for a bounce, complaint, or
--      suppression, and
--   7. leaves every evidential column of the provider event itself untouched --
--      only the reduction bookkeeping, the delivery binding, and the attempt
--      binding are written.
--
-- Owner-only: it assumes its caller already proved the event is verified and
-- tenant-owned.
CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_communication_provider_evidence(
  p_organization_id uuid,
  p_event_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_event plugin_data.csf_communication_provider_events%ROWTYPE;
  v_delivery plugin_data.csf_communication_deliveries%ROWTYPE;
  v_attempt plugin_data.csf_communication_dispatch_attempts%ROWTYPE;
  v_decision jsonb;
  v_processing_state text;
  v_applied boolean := false;
  v_is_safety boolean := false;
  v_target text;
  v_reason text;
  v_attempt_target text;
  v_attempt_advanced boolean := false;
  v_bound_delivery_message boolean := false;
  v_recipient_email text;
  v_safety_class text;
  v_safety jsonb;
  v_occurred timestamptz;
  -- Coordinates learned by the bounded UNLOCKED discovery pass, then re-proved
  -- under lock. Fail-closed comparison happens against these, never against a
  -- second read of the same untrusted row.
  v_scope_campaign_id uuid;
  v_scope_attempt_id uuid;
  v_scope_delivery_id uuid;
  v_scope_message_id text;
  -- The event's OWN attempt binding as discovered, kept separate from
  -- v_scope_attempt_id, which the fallback lookup may substitute. The fail-closed
  -- comparison must be against what the event said, not against what discovery
  -- chose on its behalf.
  v_tag_attempt_id uuid;
  v_tag_delivery_id uuid;
  v_message_delivery_id uuid;
  v_message_delivery_org uuid;
  v_message_delivery_campaign_id uuid;
  v_unauthorized_evidence boolean := false;
  v_attempt_unauthorized boolean := false;
BEGIN
  -- =========================================================================
  -- CANONICAL LOCK ORDER, STEP 1: BOUNDED, UNLOCKED COORDINATE DISCOVERY.
  --
  -- This function receives only an event row id, and the previous body simply
  -- took that event FOR UPDATE and worked outwards -- provider event (rank 5),
  -- then attempt (rank 3), then delivery (rank 4), with no campaign lock at all.
  -- That is the exact inverse of the manual-binding path, which goes attempt ->
  -- delivery -> event, so a resolver and a rebind touching one delivery could
  -- each hold what the other needed next.
  --
  -- So nothing is locked until the campaign is known. Everything below reads
  -- unlocked, and every value it learns is re-proved under lock afterwards.
  -- =========================================================================
  SELECT event.attempt_id, event.provider_message_id
  INTO v_tag_attempt_id, v_scope_message_id
  FROM plugin_data.csf_communication_provider_events AS event
  WHERE event.id = p_event_row_id
    AND event.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That CSF provider webhook event does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  v_scope_attempt_id := v_tag_attempt_id;

  -- The signed attempt tag is the strongest coordinate: it names the try, and
  -- through it the campaign and the delivery, without reading a byte of message
  -- content or a recipient address. Ownership was validated when the tag was
  -- accepted; re-scoping the lookup here means a later rebind cannot reach across
  -- tenants either.
  IF v_scope_attempt_id IS NOT NULL THEN
    SELECT attempt.campaign_id, attempt.delivery_id
    INTO v_scope_campaign_id, v_tag_delivery_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = v_scope_attempt_id
      AND attempt.organization_id = p_organization_id;

    IF NOT FOUND THEN
      v_scope_attempt_id := NULL;
    END IF;
  END IF;

  -- Global message lookup, then a tenant check: a message belonging to another
  -- organization is refused rather than quietly filed as unmatched under this one.
  -- Run even when the signed tag already named a delivery, because that is the
  -- only way the two can be compared.
  IF v_scope_message_id IS NOT NULL THEN
    SELECT delivery.id, delivery.campaign_id, delivery.organization_id
    INTO v_message_delivery_id, v_message_delivery_campaign_id, v_message_delivery_org
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.provider_message_id = v_scope_message_id;

    IF v_message_delivery_id IS NOT NULL
      AND v_message_delivery_org <> p_organization_id
    THEN
      RAISE EXCEPTION
        'That CSF provider message belongs to another organization; refusing to resolve cross-tenant webhook evidence.'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- The attempt and the delivery must be describing the same recipient. If the
  -- signed tag names an attempt on a different delivery than the provider message
  -- resolves to, something is badly wrong and guessing would corrupt both.
  IF v_tag_delivery_id IS NOT NULL
    AND v_message_delivery_id IS NOT NULL
    AND v_tag_delivery_id <> v_message_delivery_id
  THEN
    RAISE EXCEPTION
      'This CSF webhook names a dispatch attempt and a provider message that belong to different deliveries; refusing to bind contradictory evidence.'
      USING ERRCODE = '23514';
  END IF;

  v_scope_delivery_id := coalesce(v_tag_delivery_id, v_message_delivery_id);
  v_scope_campaign_id := coalesce(v_scope_campaign_id, v_message_delivery_campaign_id);

  -- NO SIGNED TAG, BUT STILL BINDABLE.
  --
  -- A send made before the routing tags shipped -- or any event whose tag was
  -- dropped in transit -- still names a provider message, and the delivery it
  -- resolves to has exactly one attempt that reported that message identity. That
  -- is a fact about the ledger, not a guess about content, so it is safe to bind.
  -- Falling back to the newest settled attempt covers the case where the worker
  -- recorded the message on the delivery but not the attempt. Chosen here, while
  -- unlocked, so the attempt lock below still precedes the delivery lock.
  IF v_scope_attempt_id IS NULL AND v_scope_delivery_id IS NOT NULL THEN
    SELECT attempt.id
    INTO v_scope_attempt_id
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.organization_id = p_organization_id
      AND attempt.delivery_id = v_scope_delivery_id
      AND (
        attempt.provider_message_id IS NOT DISTINCT FROM v_scope_message_id
        OR attempt.state IN ('accepted', 'unknown_outcome', 'delivered')
      )
    ORDER BY
      (attempt.provider_message_id IS NOT DISTINCT FROM v_scope_message_id) DESC,
      attempt.attempt_number DESC
    LIMIT 1;
  END IF;

  -- STEP 2: the campaign advisory lock. Skipped only when the evidence names no
  -- campaign at all -- an event with neither a bindable attempt nor a known
  -- provider message, which mutates nothing and is filed as unmatched below.
  IF v_scope_campaign_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf-communication-campaign:' || p_organization_id::text || ':'
          || v_scope_campaign_id::text,
        0
      )
    );

    -- STEP 3: the campaign row.
    PERFORM 1
    FROM plugin_data.csf_communication_campaigns AS campaign
    WHERE campaign.id = v_scope_campaign_id
      AND campaign.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The CSF campaign this webhook evidence resolves to no longer exists in this organization.'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- STEP 4: the attempt.
  IF v_scope_attempt_id IS NOT NULL THEN
    SELECT attempt.*
    INTO v_attempt
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = v_scope_attempt_id
      AND attempt.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND OR v_attempt.campaign_id IS DISTINCT FROM v_scope_campaign_id THEN
      RAISE EXCEPTION
        'The CSF dispatch attempt this webhook evidence names moved campaign between discovery and the campaign lock; refusing to resolve against a stale coordinate.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- STEP 5: the delivery.
  IF v_scope_delivery_id IS NOT NULL THEN
    SELECT delivery.*
    INTO v_delivery
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.id = v_scope_delivery_id
      AND delivery.organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND OR v_delivery.campaign_id IS DISTINCT FROM v_scope_campaign_id THEN
      RAISE EXCEPTION
        'The CSF delivery this webhook evidence resolves to moved campaign between discovery and the campaign lock; refusing to resolve against a stale coordinate.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- STEP 6: the evidence row itself, last, and re-proved against the coordinates
  -- the whole prologue was built on.
  SELECT event.*
  INTO v_event
  FROM plugin_data.csf_communication_provider_events AS event
  WHERE event.id = p_event_row_id
    AND event.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That CSF provider webhook event does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF NOT v_event.signature_verified THEN
    RAISE EXCEPTION
      'CSF provider webhook evidence is only resolved after the application verifies the signature over the exact raw request body.'
      USING ERRCODE = '23514';
  END IF;

  IF v_event.processing_state NOT IN ('pending', 'unmatched') THEN
    RAISE EXCEPTION
      'Only pending or unmatched CSF webhook evidence can be resolved; this event is already "%".',
      v_event.processing_state
      USING ERRCODE = '23514';
  END IF;

  -- FAIL CLOSED ON A MOVED COORDINATE. The discovery pass was unlocked, so a
  -- concurrent rebind could have bound this event to a different attempt or
  -- message in between. Resolving anyway would apply provider evidence to a
  -- recipient it was never about.
  IF v_event.provider_message_id IS DISTINCT FROM v_scope_message_id
    OR v_event.attempt_id IS DISTINCT FROM v_tag_attempt_id
  THEN
    RAISE EXCEPTION
      'This CSF webhook evidence was re-bound between coordinate discovery and the campaign lock; refusing to resolve against a stale coordinate.'
      USING ERRCODE = '23514';
  END IF;

  v_occurred := v_event.provider_occurred_at;

  -- AN UNAUTHORIZED ATTEMPT MAY NOT RESERVE A PROVIDER IDENTITY.
  --
  -- Read here, before any binding, because csf_comm_delivery_provider_message_global_idx
  -- makes provider_message_id unique across every organization, so binding it to a
  -- delivery is a one-time, irreversible claim. The authorization check used to
  -- live below the two binding writes, which meant unauthorized evidence still
  -- consumed the identity on its way to being filed as a conflict -- and once
  -- consumed, the real authorized send that later reports the SAME message id
  -- cannot bind it. Evidence the ledger never released must not be able to take a
  -- unique coordinate away from a send it did release. The attempt binding is a
  -- per-try join rather than a unique one, but it is gated with the delivery
  -- because a contradicted attempt must not look joined to provider evidence.
  --
  -- This gates identity binding only. The event row itself stays immutable and
  -- durable, and the unauthorized branch below still files the incident.
  v_attempt_unauthorized :=
    v_attempt.id IS NOT NULL AND v_attempt.dispatch_authorized_at IS NULL;

  -- THE WEBHOOK BEAT LOCAL SETTLEMENT.
  --
  -- No delivery reported this message identity yet, but the signed attempt tag
  -- named the attempt it belongs to, so the delivery is known even though the
  -- worker has not committed its settlement. Binding the identity here is what
  -- turns "unmatched forever" into "resolved on arrival".
  IF NOT v_attempt_unauthorized
    AND v_delivery.id IS NOT NULL
    AND v_event.provider_message_id IS NOT NULL
    AND v_delivery.provider_message_id IS NULL
  THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET provider_message_id = v_event.provider_message_id, updated_at = v_now
    WHERE id = v_delivery.id
      AND organization_id = p_organization_id;

    v_delivery.provider_message_id := v_event.provider_message_id;
    v_bound_delivery_message := true;
  END IF;

  -- The attempt and the delivery must be describing the same recipient. If the
  -- signed tag names an attempt on a different delivery than the provider message
  -- resolves to, something is badly wrong and guessing would corrupt both.
  IF v_attempt.id IS NOT NULL
    AND v_delivery.id IS NOT NULL
    AND v_attempt.delivery_id <> v_delivery.id
  THEN
    RAISE EXCEPTION
      'This CSF webhook names a dispatch attempt and a provider message that belong to different deliveries; refusing to bind contradictory evidence.'
      USING ERRCODE = '23514';
  END IF;

  -- Bind the message identity onto the attempt too, so the per-try ledger can be
  -- joined to provider evidence directly. Write-once, hence the NULL guard -- and
  -- never for an attempt the ledger never authorized, per the gate above.
  IF NOT v_attempt_unauthorized
    AND v_attempt.id IS NOT NULL
    AND v_event.provider_message_id IS NOT NULL
    AND v_attempt.provider_message_id IS NULL
  THEN
    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET provider_message_id = v_event.provider_message_id, updated_at = v_now
    WHERE id = v_attempt.id;

    v_attempt.provider_message_id := v_event.provider_message_id;
  END IF;

  v_decision := plugin_data.csf_comm_reduction_decision(
    v_event.event_type,
    v_occurred,
    v_delivery.id IS NOT NULL,
    v_delivery.status,
    v_delivery.terminal_locked_at IS NOT NULL,
    v_delivery.last_provider_event_at
  );

  v_processing_state := v_decision->>'processingState';
  v_applied := (v_decision->>'applied')::boolean;
  v_target := v_decision->>'target';
  v_is_safety := (v_decision->>'isSafety')::boolean;
  v_reason := v_decision->>'reason';

  -- =========================================================================
  -- PROVIDER ACCEPTANCE REQUIRES AN AUTHORIZED ATTEMPT.
  --
  -- plugin_data.csf_authorize_communication_dispatch() is the only thing that ever
  -- hands a sendable payload out of this ledger, and it stamps dispatch_authorized_at
  -- when it does. So a signed 'email.sent' -- or any other evidence that would move
  -- state -- naming an attempt with NO recorded authorization is a contradiction:
  -- the provider says it accepted a message for a try the ledger never released.
  --
  -- Treating that as an ordinary success was the dangerous answer. It walked a
  -- QUEUED attempt into 'accepted' on the strength of a routing tag alone, and a
  -- queued attempt is exactly the thing a worker is still entitled to claim and
  -- send. The evidence would have manufactured the appearance of a completed send
  -- while leaving a real one pending.
  --
  -- So the evidence is kept -- it is signed, and it is the only record that this
  -- happened -- and it is filed as a conflict rather than a reduction. An unsettled
  -- attempt is settled as unknown_outcome, which is both honest (nobody can say
  -- whether this recipient was mailed) and terminal: the enqueue guard refuses a
  -- successor behind an unknown outcome, so neither the attempt nor its delivery can
  -- ever be dispatched again. An already-settled attempt keeps its frozen evidence
  -- and only the delivery and the campaign are escalated.
  -- =========================================================================
  IF v_applied AND v_attempt_unauthorized THEN
    v_unauthorized_evidence := true;
    v_applied := false;
    v_processing_state := 'ignored_conflict';
    v_target := NULL;
    v_reason := pg_catalog.left(
      'signed provider evidence "' || v_event.event_type
        || '" names a CSF dispatch attempt that was never authorized for dispatch',
      500
    );

    IF v_attempt.state IN ('queued', 'processing') THEN
      UPDATE plugin_data.csf_communication_dispatch_attempts
      SET
        state = 'unknown_outcome',
        unknown_reason = v_reason,
        outcome_detail = v_reason,
        review_state = 'escalated',
        -- provider_message_id is deliberately NOT bound here. Settling the
        -- incident must not do what the gate above just refused to do: an
        -- unauthorized attempt does not get to consume the globally unique
        -- provider identity. The identity stays readable on the immutable
        -- event row, which is where the evidence belongs.
        settlement_source = 'provider',
        lease_owner = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        settled_at = v_now,
        updated_at = v_now
      WHERE id = v_attempt.id;

      v_attempt.state := 'unknown_outcome';
      v_attempt.settled_at := v_now;
      v_attempt.settlement_source := 'provider';
      v_attempt.review_state := 'escalated';
    END IF;

    IF v_delivery.id IS NOT NULL THEN
      UPDATE plugin_data.csf_communication_deliveries
      SET
        review_state = 'escalated',
        review_reason = coalesce(review_reason, pg_catalog.left(v_reason, 300)),
        unknown_outcome_at = coalesce(unknown_outcome_at, v_now),
        updated_at = v_now
      WHERE id = v_delivery.id
        AND organization_id = p_organization_id;
    END IF;

    IF v_scope_campaign_id IS NOT NULL THEN
      UPDATE plugin_data.csf_communication_campaigns AS campaign
      SET
        review_blocked_at = coalesce(campaign.review_blocked_at, v_now),
        review_blocked_reason = coalesce(
          campaign.review_blocked_reason, pg_catalog.left(v_reason, 300)
        ),
        updated_at = v_now
      WHERE campaign.id = v_scope_campaign_id
        AND campaign.organization_id = p_organization_id
        AND campaign.status <> 'completed';
    END IF;
  END IF;

  -- Resend can report delivery before its own sent webhook lands. Walk the state
  -- machine rather than skipping a step.
  IF v_applied AND (v_decision->>'needsSentStep')::boolean THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET
      status = 'sent',
      sent_at = coalesce(sent_at, greatest(v_occurred, queued_at)),
      updated_at = v_now
    WHERE id = v_delivery.id
      AND organization_id = p_organization_id;
  END IF;

  IF v_applied THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET
      status = v_target,
      -- A 'sent' or 'delivered' reduction must leave sent_at populated, or the
      -- delivery lifecycle trigger's queued-then-sent-then-delivered rule fails on
      -- the next event.
      sent_at = CASE
        WHEN v_target IN ('sent', 'delivered')
          THEN coalesce(sent_at, greatest(v_occurred, queued_at))
        ELSE sent_at
      END,
      delivered_at = CASE
        WHEN v_target = 'delivered'
          THEN coalesce(delivered_at, greatest(v_occurred, sent_at, queued_at))
        ELSE delivered_at
      END,
      failed_at = CASE
        WHEN v_target IN ('bounced', 'failed')
          THEN coalesce(failed_at, greatest(v_occurred, queued_at))
        ELSE failed_at
      END,
      terminal_locked_at = CASE
        WHEN v_target IN ('bounced', 'complained', 'suppressed')
          THEN coalesce(terminal_locked_at, v_now)
        ELSE terminal_locked_at
      END,
      last_provider_event_at = greatest(
        coalesce(last_provider_event_at, v_occurred), v_occurred
      ),
      last_provider_event_type = v_event.event_type,
      updated_at = v_now
    WHERE id = v_delivery.id
      AND organization_id = p_organization_id;
  ELSIF v_delivery.id IS NOT NULL
    AND (
      v_processing_state = 'ignored_conflict'
      -- SIGNED SAFETY EVIDENCE WITH NO PROVIDER TIME IS NOT AN ORDINARY IGNORE.
      --
      -- csf_comm_reduction_decision() returns ignored_no_provider_time BEFORE it
      -- reaches the safety branch, so a bounce, complaint, or suppression that
      -- arrived without an authoritative occurrence time used to fall through
      -- every arm here and leave the delivery completely untouched -- no review
      -- state, no reason, nothing on a worklist. The caller then read a 200 and
      -- an unremarkable result and treated it as ordinary success.
      --
      -- That is the exact evidence class we cannot afford to lose. The missing
      -- timestamp means we may not REDUCE (ranking needs an authoritative time)
      -- and may not suppress the address -- both of those still require
      -- v_applied, which stays false -- but it does not make the signal go away.
      -- Somebody said this address bounced or complained. It gets filed as
      -- strictly as a contradiction: escalated, with a reason, for a human.
      OR (v_is_safety AND v_processing_state = 'ignored_no_provider_time')
    )
  THEN
    -- Contradictions are not dropped. A human decides. A contradicted SAFETY
    -- signal escalates outright rather than joining the ordinary review queue,
    -- because the failure mode it guards against is mailing someone who bounced
    -- or complained.
    UPDATE plugin_data.csf_communication_deliveries
    SET
      review_state = CASE
        WHEN v_is_safety THEN 'escalated'
        WHEN review_state = 'none' THEN 'pending'
        ELSE review_state
      END,
      review_reason = coalesce(review_reason, v_reason),
      updated_at = v_now
    WHERE id = v_delivery.id
      AND organization_id = p_organization_id;
  END IF;

  -- Step 3: the attempt follows the evidence.
  IF v_applied AND v_attempt.id IS NOT NULL THEN
    -- 'sent' IS PROVIDER ACCEPTANCE, AND ITS ABSENCE HERE WAS THE WHOLE BUG.
    --
    -- csf_communication_event_target_status() maps email.sent to delivery 'sent',
    -- and the delivery duly reduced -- but this mapping had no 'sent' case, so
    -- v_attempt_target stayed NULL and the walk-out-of-processing branch below never
    -- fired. The attempt sat in 'processing' holding a lease while the provider had
    -- already said in a signed webhook that it accepted the message. The lease then
    -- lapsed and the reaper settled it 'unknown_outcome': the ledger manufactured
    -- ambiguity about a send the provider had confirmed in writing, and demanded a
    -- human reconcile it.
    --
    -- email.sent means "we accepted this message", which is exactly what the attempt
    -- state 'accepted' asserts.
    v_attempt_target := CASE v_target
      WHEN 'sent' THEN 'accepted'
      WHEN 'delivered' THEN 'delivered'
      WHEN 'bounced' THEN 'bounced'
      WHEN 'complained' THEN 'complained'
      WHEN 'suppressed' THEN 'suppressed'
      WHEN 'failed' THEN 'failed'
      ELSE NULL
    END;

    -- THE WEBHOOK CAN BEAT THE WORKER'S OWN HTTP RESPONSE.
    --
    -- A 'processing' attempt with signed provider evidence against it is not
    -- ambiguous at all: the provider is telling us it accepted, delivered, or
    -- bounced this exact message, which proves the request left the ledger. Leaving
    -- the attempt in 'processing' meant the lease eventually lapsed and the reaper
    -- manufactured an 'unknown_outcome' for a send whose fate the provider had
    -- already told us in writing -- and if the worker did come back, its settlement
    -- collided with the delivery the webhook had already reduced.
    --
    -- So the attempt is walked out of 'processing' here, releasing the lease. The
    -- state machine has no direct processing -> delivered edge, so it goes through
    -- 'accepted' first, which is exactly what the provider's acceptance means.
    IF v_attempt_target IS NOT NULL AND v_attempt.state = 'processing' THEN
      UPDATE plugin_data.csf_communication_dispatch_attempts
      SET
        state = 'accepted',
        provider_message_id = coalesce(provider_message_id, v_event.provider_message_id),
        outcome_detail = pg_catalog.left(
          'provider evidence "' || v_event.event_type
            || '" arrived before the worker reported back',
          1000
        ),
        settlement_source = 'provider',
        lease_owner = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        settled_at = v_now,
        updated_at = v_now
      WHERE id = v_attempt.id;

      -- Keep the in-memory copy in step so the branches below see the attempt as
      -- it now is rather than as it was read.
      v_attempt.state := 'accepted';
      v_attempt.settled_at := v_now;
      v_attempt.settlement_source := 'provider';
      v_attempt_advanced := true;
    END IF;

    IF v_attempt_target IS NOT NULL
      AND v_attempt.state <> v_attempt_target
      AND (
        v_attempt.state IN ('accepted', 'unknown_outcome')
        OR (v_attempt.state = 'delivered' AND v_attempt_target = 'complained')
      )
    THEN
      IF v_attempt.state = 'unknown_outcome' THEN
        -- PROVIDER EVIDENCE IS A LEGITIMATE EXIT FROM AN UNKNOWN OUTCOME, and it
        -- is recorded as such. reconciled_actor_kind = 'provider' with no account
        -- attached is what keeps "the provider eventually told us" distinguishable
        -- from "an officer made a call".
        UPDATE plugin_data.csf_communication_dispatch_attempts
        SET
          state = v_attempt_target,
          review_state = 'resolved',
          reconciled_outcome = v_attempt_target,
          reconciled_at = v_now,
          reconciled_actor_kind = 'provider',
          reconciliation_reason = pg_catalog.left(
            'verified provider evidence "' || v_event.event_type
            || '" resolved this unknown outcome',
            300
          ),
          updated_at = v_now
        WHERE id = v_attempt.id;
      ELSE
        UPDATE plugin_data.csf_communication_dispatch_attempts
        SET
          state = v_attempt_target,
          review_state = CASE
            WHEN review_state = 'pending' THEN 'resolved'
            ELSE review_state
          END,
          updated_at = v_now
        WHERE id = v_attempt.id;
      END IF;

      v_attempt_advanced := true;
    END IF;
  END IF;

  -- Step 5: an unknown outcome that provider evidence has now explained is no
  -- longer a mystery, so the delivery's review flag resolves with it.
  IF v_attempt_advanced AND v_attempt.state = 'unknown_outcome' THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET
      review_state = 'resolved',
      review_reason = coalesce(
        review_reason,
        'resolved by verified provider evidence'
      ),
      updated_at = v_now
    WHERE id = v_delivery.id
      AND organization_id = p_organization_id;
  END IF;

  -- Step 6: address safety. A bounce, complaint, or suppression is evidence about
  -- the ADDRESS, so it updates the safety projection in this same transaction --
  -- not the topic-scoped preference table, which is about consent and would let
  -- the block leak into transactional mail as a fake opt-out.
  IF v_applied AND v_target IN ('bounced', 'complained', 'suppressed') THEN
    v_safety_class := CASE v_target
      WHEN 'bounced' THEN 'bounce'
      WHEN 'complained' THEN 'complaint'
      ELSE 'provider_suppression'
    END;

    SELECT snapshot.recipient_email
    INTO v_recipient_email
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.id = v_delivery.recipient_snapshot_id
      AND snapshot.organization_id = p_organization_id;

    IF v_recipient_email IS NOT NULL THEN
      v_safety := plugin_data.csf_apply_communication_address_safety(
        p_organization_id,
        v_recipient_email,
        v_safety_class,
        pg_catalog.left(
          'provider reported "' || v_event.event_type || '"'
          || coalesce(
            ' (' || (v_event.metadata->>'bounceType') || ')', ''
          ),
          300
        ),
        v_occurred,
        v_event.provider_event_id,
        'provider',
        NULL,
        NULL,
        -- The provider's own bounce type, forwarded verbatim for classification.
        -- A permanent bounce and a full mailbox must not become the same block.
        v_event.metadata->>'bounceType'
      );
    END IF;
  END IF;

  -- Step 7: the event's own bookkeeping, settled exactly once. Every evidential
  -- column -- envelope id, type, message id, payload hash, metadata, occurrence
  -- time, verification metadata -- is deliberately absent from this statement.
  UPDATE plugin_data.csf_communication_provider_events
  SET
    delivery_id = CASE
      -- csf_communication_provider_events_linked_message_check requires a linked
      -- event to name a message, so an event with no message identity stays
      -- unlinked even when the attempt tag told us which delivery it belongs to.
      WHEN v_delivery.id IS NOT NULL AND v_event.provider_message_id IS NOT NULL
        THEN v_delivery.id
      ELSE delivery_id
    END,
    -- Bound at most once, so an event resolved without a signed tag still records
    -- which try the provider was talking about.
    attempt_id = coalesce(attempt_id, v_attempt.id),
    processing_state = v_processing_state,
    reduction_applied = v_applied,
    reduced_to_status = CASE WHEN v_applied THEN v_target ELSE NULL END,
    reduced_at = CASE WHEN v_applied THEN v_now ELSE NULL END,
    ignored_reason = v_reason
  WHERE id = v_event.id;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'eventRowId', v_event.id,
    'providerEventId', v_event.provider_event_id,
    'deliveryId', v_delivery.id,
    'attemptId', v_attempt.id,
    'processingState', v_processing_state,
    'reductionApplied', v_applied,
    'reducedToStatus', CASE WHEN v_applied THEN v_target ELSE NULL END,
    'deliveryStatus', CASE WHEN v_applied THEN v_target ELSE v_delivery.status END,
    'attemptAdvanced', v_attempt_advanced,
    'attemptState', CASE
      WHEN v_attempt_advanced THEN v_attempt_target
      ELSE v_attempt.state
    END,
    'boundDeliveryMessageId', v_bound_delivery_message,
    'addressSafety', v_safety,
    -- True when signed evidence named an attempt the ledger never authorized. The
    -- event is retained, nothing became a success, and the attempt and delivery are
    -- review-blocked and unsendable.
    'unauthorizedAttemptEvidence', v_unauthorized_evidence,
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_communication_provider_evidence(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_resolve_communication_provider_evidence(uuid, uuid) IS
  'The ONE atomic provider-evidence resolution primitive, shared by the recording and rebind paths so they cannot drift. Binds the delivery provider-message identity and the attempt named by the signed csf_attempt_id tag, advances an accepted or unknown_outcome attempt to the evidence-backed outcome, reduces delivery truth, resolves review state, updates the address-safety projection for a bounce/complaint/suppression, and leaves every evidential column of the event itself frozen.';

-- I.6 Record one verified provider webhook event and reduce it.
--
-- THE DATABASE DOES NOT VERIFY SIGNATURES. The application verifies the
-- provider signature over the exact raw request body and then calls this RPC
-- with the digest of that same body plus the verification metadata. This RPC
-- refuses to record anything the caller has not asserted as verified, and it
-- stores that assertion so an audit can see what was claimed and by which
-- scheme and key.
--
-- OUT-OF-ORDER SAFETY. Reduction is monotonic in delivery rank and additionally
-- conservative about time: an event whose provider time is earlier than the
-- last observed one, or missing entirely, is retained as evidence and ignored
-- for state. A bounce, complaint, or suppression locks the delivery, and a
-- later 'sent' or 'delivered' can never unlock it. An event that contradicts
-- recorded truth is retained and escalated to human review rather than applied
-- or dropped. An unknown event type is retained and mutates nothing.
CREATE OR REPLACE FUNCTION plugin_data.csf_record_communication_provider_event(
  p_organization_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_occurred_at timestamptz,
  p_raw_body_hash text,
  p_signature_verified boolean,
  p_signature_scheme text DEFAULT 'svix',
  p_signature_key_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  -- From the SIGNED routing tags inside the verified body. Never from a query
  -- parameter, a header, or any other channel outside the signature.
  p_attempt_id uuid DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id text := nullif(btrim(coalesce(p_provider_event_id, '')), '');
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_key_id text := nullif(btrim(coalesce(p_signature_key_id, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_now timestamptz := now();
  v_occurred timestamptz;
  v_attempt plugin_data.csf_communication_dispatch_attempts%ROWTYPE;
  v_existing plugin_data.csf_communication_provider_events%ROWTYPE;
  v_recorded_id uuid;
  v_resolution jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF provider event requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF p_signature_verified IS NOT TRUE THEN
    RAISE EXCEPTION
      'CSF provider webhook events are only recorded after the application verifies the signature over the exact raw request body; the database does not verify signatures.'
      USING ERRCODE = '23514';
  END IF;

  IF v_event_id IS NULL OR pg_catalog.char_length(v_event_id) > 255 OR v_event_id ~ '\s' THEN
    RAISE EXCEPTION
      'A CSF provider event requires the verified webhook envelope id, without whitespace and at most 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_event_type IS NULL OR pg_catalog.char_length(v_event_type) > 100 THEN
    RAISE EXCEPTION 'A CSF provider event requires an event type of at most 100 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_message_id IS NOT NULL AND pg_catalog.char_length(v_message_id) > 255 THEN
    RAISE EXCEPTION 'A CSF provider message identity is at most 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF p_raw_body_hash IS NULL OR p_raw_body_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'A CSF provider event requires the SHA-256 of the exact verified raw request body.'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_signature_scheme, 'svix') <> 'svix' THEN
    RAISE EXCEPTION 'Only the svix webhook signature scheme is supported.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT plugin_data.csf_provider_event_metadata_allowlisted(v_metadata) THEN
    RAISE EXCEPTION
      'CSF provider event metadata may hold only allowlisted, scalar, bounded operational fields.'
      USING ERRCODE = '22023';
  END IF;

  v_occurred := coalesce(p_occurred_at, v_now);

  -- THE SIGNED ATTEMPT TAG IS VALIDATED BEFORE IT IS TRUSTED TO BIND ANYTHING.
  --
  -- The tag came from inside the verified body, which proves the provider signed
  -- it -- not that it names something this organization owns. So the attempt is
  -- resolved tenant-scoped, and its campaign coordinate must agree with the
  -- campaign tag when one is present. Only then is it allowed to name the
  -- delivery whose provider-message identity this webhook may bind.
  IF p_attempt_id IS NOT NULL THEN
    SELECT attempt.*
    INTO v_attempt
    FROM plugin_data.csf_communication_dispatch_attempts AS attempt
    WHERE attempt.id = p_attempt_id
      AND attempt.organization_id = p_organization_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The CSF dispatch attempt named by this webhook routing tag does not exist in this organization.'
        USING ERRCODE = '23503';
    END IF;

    IF p_campaign_id IS NOT NULL AND v_attempt.campaign_id <> p_campaign_id THEN
      RAISE EXCEPTION
        'This CSF webhook routing tag names a dispatch attempt from a different campaign than the campaign tag; refusing to bind contradictory evidence.'
        USING ERRCODE = '23514';
    END IF;

    -- The snapshot ownership chain, checked rather than assumed. The attempt's
    -- composite delivery reference already proves organization, campaign, and
    -- recipient agree, so this is the one remaining link worth stating.
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
      WHERE snapshot.id = v_attempt.recipient_snapshot_id
        AND snapshot.organization_id = p_organization_id
        AND snapshot.campaign_id = v_attempt.campaign_id
    ) THEN
      RAISE EXCEPTION
        'The CSF audience snapshot behind this webhook routing tag does not belong to the tagged campaign in this organization.'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- Cross-tenant message poisoning is refused here, before anything is recorded.
  -- The lookup is deliberately NOT organization-scoped: provider_message_id is
  -- globally unique across deliveries, so looking it up globally is what lets a
  -- mis-routed webhook be REFUSED instead of quietly filed as "unmatched" under
  -- the wrong tenant.
  IF v_message_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.provider_message_id = v_message_id
      AND delivery.organization_id <> p_organization_id
  ) THEN
    RAISE EXCEPTION
      'That CSF provider message belongs to another organization; refusing to record cross-tenant webhook evidence.'
      USING ERRCODE = '23503';
  END IF;

  -- DEDUPLICATION HAPPENS BEFORE ANY REDUCTION, and a replay is only idempotent
  -- when every immutable coordinate matches. An envelope id replayed with a
  -- different organization, raw-body digest, event type, message identity, or
  -- provider time is not a retry -- it is either a forgery or a provider bug,
  -- and swallowing it would hide both.
  -- Recorded unbound, then resolved. The delivery binding is the resolution
  -- primitive's job, so there is exactly one place that decides what a webhook may
  -- attach itself to.
  INSERT INTO plugin_data.csf_communication_provider_events (
    organization_id, delivery_id, attempt_id, provider, provider_event_id,
    event_type, provider_message_id, occurred_at, provider_occurred_at,
    received_at, payload_hash, metadata, signature_verified,
    signature_verified_at, signature_scheme, signature_key_id, processing_state
  ) VALUES (
    p_organization_id, NULL, v_attempt.id, 'resend', v_event_id, v_event_type,
    v_message_id, v_occurred, p_occurred_at, v_now, p_raw_body_hash, v_metadata,
    true, v_now, 'svix', v_key_id, 'pending'
  )
  ON CONFLICT ON CONSTRAINT csf_communication_provider_events_provider_event_id_key
  DO NOTHING
  RETURNING id INTO v_recorded_id;

  IF v_recorded_id IS NULL THEN
    SELECT existing.*
    INTO v_existing
    FROM plugin_data.csf_communication_provider_events AS existing
    WHERE existing.provider = 'resend'
      AND existing.provider_event_id = v_event_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'A concurrent writer removed CSF provider webhook evidence mid-transaction.'
        USING ERRCODE = '40001';
    END IF;

    IF v_existing.organization_id <> p_organization_id
      OR v_existing.payload_hash <> p_raw_body_hash
      OR v_existing.event_type <> v_event_type
      OR v_existing.provider_message_id IS DISTINCT FROM v_message_id
      OR v_existing.provider_occurred_at IS DISTINCT FROM p_occurred_at
    THEN
      RAISE EXCEPTION
        'CSF provider webhook envelope "%" was already recorded with different immutable evidence; refusing a conflicting replay.',
        v_event_id
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'providerEventId', v_event_id,
      'eventRowId', v_existing.id,
      'duplicate', true,
      'processingState', v_existing.processing_state,
      'reductionApplied', v_existing.reduction_applied,
      'deliveryId', v_existing.delivery_id,
      'attemptId', v_existing.attempt_id
    );
  END IF;

  -- ONE PRIMITIVE DECIDES WHAT EVIDENCE MAY DO. Recording no longer carries its
  -- own copy of the reduction logic, so this path and the rebind path cannot drift
  -- into disagreeing about whether a bounce locks a delivery.
  v_resolution := plugin_data.csf_resolve_communication_provider_evidence(
    p_organization_id, v_recorded_id
  );

  RETURN v_resolution
    || pg_catalog.jsonb_build_object('duplicate', false)
    || pg_catalog.jsonb_build_object(
      'ignoredReason', v_resolution->>'reason'
    );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_communication_provider_event(
  uuid, text, text, text, timestamptz, text, boolean, text, text, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_communication_provider_event(
  uuid, text, text, text, timestamptz, text, boolean, text, text, jsonb, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_record_communication_provider_event(
  uuid, text, text, text, timestamptz, text, boolean, text, text, jsonb, uuid, uuid
) IS
  'Atomically records one already-verified provider webhook event, deduplicated by envelope id, then hands it to plugin_data.csf_resolve_communication_provider_evidence() -- the same primitive the rebind path uses. The database does not verify signatures: it refuses events the caller has not asserted as verified over the raw body. The signed attempt and campaign routing tags are validated against this organization before they are trusted to bind anything, and query parameters are never consulted.';

-- I.6b Rebind unmatched webhook evidence to the delivery it always described.
--
-- Webhooks routinely beat the row they refer to: Resend can report 'delivered'
-- before the worker's own settlement has committed the provider message id.
-- Such an event is recorded as 'unmatched' rather than dropped, and this RPC is
-- how it is later attached and reduced -- exactly once.
--
-- 20260730001001 already permits precisely one null -> matching delivery_id
-- transition on provider evidence, and this migration's freeze trigger permits
-- precisely one unmatched -> reduced|ignored_* processing transition. Every
-- other evidential column stays frozen throughout.
CREATE OR REPLACE FUNCTION plugin_data.csf_rebind_communication_provider_event(
  p_organization_id uuid,
  p_provider_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id text := nullif(btrim(coalesce(p_provider_event_id, '')), '');
  v_event plugin_data.csf_communication_provider_events%ROWTYPE;
  v_resolution jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF provider event rebind requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF v_event_id IS NULL OR pg_catalog.char_length(v_event_id) > 255 THEN
    RAISE EXCEPTION 'A CSF provider event rebind requires the webhook envelope id.'
      USING ERRCODE = '22023';
  END IF;

  -- BOUNDED, UNLOCKED READ. Deliberately not FOR UPDATE.
  --
  -- Taking the provider-event row -- rank 5 of the canonical order -- before
  -- plugin_data.csf_resolve_communication_provider_evidence() has had a chance to
  -- take the campaign advisory lock is the inversion this wave exists to remove.
  -- The resolver owns the whole prologue (unlocked discovery, campaign advisory,
  -- campaign row, attempt, delivery, event) and re-validates every coordinate under
  -- those locks, including that the event is still pending or unmatched. The checks
  -- below are bounded pre-flight diagnostics on unlocked state: they turn the two
  -- cases a caller can actually fix into their own messages, and the resolver's
  -- locked check remains the authoritative gate that makes a rebind happen once.
  SELECT event.*
  INTO v_event
  FROM plugin_data.csf_communication_provider_events AS event
  WHERE event.provider = 'resend'
    AND event.provider_event_id = v_event_id
    AND event.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That CSF provider webhook event does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_event.processing_state <> 'unmatched' THEN
    RAISE EXCEPTION
      'Only unmatched CSF webhook evidence can be rebound; this event is already "%".',
      v_event.processing_state
      USING ERRCODE = '23514';
  END IF;

  -- An event with neither a provider message identity nor a signed attempt tag
  -- names nothing at all, so no later fact can ever attach it.
  IF v_event.provider_message_id IS NULL AND v_event.attempt_id IS NULL THEN
    RAISE EXCEPTION
      'Unmatched CSF webhook evidence with no provider message identity and no signed attempt tag can never be rebound.'
      USING ERRCODE = '23514';
  END IF;

  -- THE SAME PRIMITIVE. This path exists only because the delivery may not have
  -- existed when the event first arrived; what the evidence is ALLOWED to do is
  -- decided in exactly one place, shared with the recording path.
  v_resolution := plugin_data.csf_resolve_communication_provider_evidence(
    p_organization_id, v_event.id
  );

  RETURN v_resolution || pg_catalog.jsonb_build_object(
    'rebound', (v_resolution->>'processingState') <> 'unmatched'
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_rebind_communication_provider_event(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_rebind_communication_provider_event(uuid, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_rebind_communication_provider_event(uuid, text) IS
  'Re-runs plugin_data.csf_resolve_communication_provider_evidence() for unmatched CSF webhook evidence once the delivery it always described finally exists. Shares one primitive with the recording path, permits exactly the unmatched -> reduced|ignored_* transition, keeps every evidential column frozen, and refuses a cross-tenant provider message.';

-- I.7 Reconcile an unknown outcome. Never retry one.
--
-- This is the only exit from 'unknown_outcome' other than a provider webhook
-- landing on its own. The resolution set contains no retry: 'queued',
-- 'processing', 'accepted', and 'retry' are all rejected by name with the
-- reason, so a caller that tries to re-send an ambiguous attempt gets told why
-- rather than a generic constraint error.
--
-- 'human_review' escalates and leaves the attempt unknown. Every other
-- resolution records a real outcome, and only reduces the delivery when the
-- delivery state machine still permits that move.
CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_communication_unknown_outcome(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_resolution text,
  p_reason text,
  p_provider_message_id text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_correlation_id text DEFAULT NULL,
  -- Optional: the provider's bounce type, when the officer actually read one off
  -- the provider's dashboard. Left NULL it classifies as undetermined, which earns
  -- a review hold rather than a permanent block.
  p_bounce_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The same chapter-administration capability cancellation requires. Overriding
  -- what the provider never told us is at least as consequential as withdrawing a
  -- send, and csf_actor_has_permission() is tenant-scoped, so an officer of
  -- another chapter cannot reach this organization's ambiguous sends.
  c_capability constant text := 'manage_settings';
  v_recipient_email text;
  v_safety jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_now timestamptz := now();
  v_attempt plugin_data.csf_communication_dispatch_attempts%ROWTYPE;
  v_delivery plugin_data.csf_communication_deliveries%ROWTYPE;
  v_campaign_id uuid;
  v_delivery_status text;
  v_reduced boolean := false;
  v_bound_message boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF unknown-outcome reconciliation requires an organization and an attempt.'
      USING ERRCODE = '22004';
  END IF;

  -- UNKNOWN OUTCOME SAFETY, stated to the caller in the caller's own terms.
  IF p_resolution IN ('queued', 'processing', 'accepted', 'retry', 'retryable_failure') THEN
    RAISE EXCEPTION
      'A CSF dispatch attempt with an unknown provider outcome can never be retried; resolve it as delivered, bounced, complained, suppressed, failed, or human_review.'
      USING ERRCODE = '23514';
  END IF;

  IF p_resolution NOT IN (
    'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'human_review'
  ) THEN
    RAISE EXCEPTION
      'A CSF unknown outcome resolves to delivered, bounced, complained, suppressed, failed, or human_review.'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 300 THEN
    RAISE EXCEPTION
      'A CSF unknown-outcome reconciliation records a reason of 1 to 300 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_message_id IS NOT NULL AND pg_catalog.char_length(v_message_id) > 255 THEN
    RAISE EXCEPTION 'A CSF provider message identity is at most 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF reconciliation correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- THE ACTOR IS AUTHORIZATION, NOT DECORATION.
  --
  -- A reconciliation is a human overriding what the provider never told us, so it
  -- names a human -- and that human must actually hold CSF staff authority in THIS
  -- organization. Merely proving the account exists would let any signed-in user
  -- declare another chapter's ambiguous send delivered.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF unknown-outcome reconciliation must record the account that decided it.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to reconcile an unknown dispatch outcome in this organization.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  -- CANONICAL LOCK ORDER, STEPS 1-4.
  --
  -- Reconciliation used to open on the attempt row with no campaign lock at all,
  -- which put it at rank 3 of the canonical order while cancellation and the
  -- evidence resolver both reach the same rows from rank 1. Bounded unlocked
  -- discovery, then the campaign advisory lock, then the campaign row, then the
  -- attempt re-read and re-validated under both.
  SELECT attempt.campaign_id
  INTO v_campaign_id
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || v_campaign_id::text,
      0
    )
  );

  PERFORM 1
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = v_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_attempt.campaign_id IS DISTINCT FROM v_campaign_id THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt changed campaign between coordinate discovery and the campaign lock; refusing to reconcile against a stale coordinate.'
      USING ERRCODE = '23514';
  END IF;

  -- PRIOR RECONCILIATION IS CHECKED FIRST.
  --
  -- A finally reconciled attempt no longer sits in 'unknown_outcome', so
  -- testing the state before the reconciliation record would report the replay
  -- as "not an unknown outcome" -- a confusing error for what is really an
  -- idempotent retry.
  -- AN EXACT REPLAY MEANS EVERY FROZEN COORDINATE, NOT JUST THE VERDICT.
  --
  -- Comparing only outcome and reason meant a replay carrying a DIFFERENT provider
  -- message identity, a different deciding officer, or a different correlation was
  -- reported as an idempotent success -- and the differing values were dropped on
  -- the floor. That is the worst possible answer: the caller believes its evidence
  -- was recorded, and the ledger silently kept somebody else's.
  IF v_attempt.reconciled_at IS NOT NULL THEN
    IF v_attempt.reconciled_outcome = p_resolution
      AND v_attempt.reconciliation_reason IS NOT DISTINCT FROM v_reason
      AND v_attempt.reconciled_by IS NOT DISTINCT FROM p_actor_user_id
      AND v_attempt.reconciled_by_identity IS NOT DISTINCT FROM v_actor_identity
      AND v_attempt.correlation_id IS NOT DISTINCT FROM v_correlation
      -- Null-or-equal. A replay may omit the message identity, but it may never
      -- name a different one.
      AND (
        v_message_id IS NULL
        OR v_attempt.provider_message_id IS NOT DISTINCT FROM v_message_id
      )
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'organizationId', p_organization_id,
        'attemptId', p_attempt_id,
        'deliveryId', v_attempt.delivery_id,
        'resolution', v_attempt.reconciled_outcome,
        'attemptState', v_attempt.state,
        'deliveryReduced', false,
        'idempotentReplay', true
      );
    END IF;

    RAISE EXCEPTION
      'That CSF unknown outcome was already reconciled as "%" with different evidence -- outcome, reason, deciding account, correlation, or provider message identity -- and is not reconciled twice.',
      v_attempt.reconciled_outcome
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.state <> 'unknown_outcome' THEN
    RAISE EXCEPTION
      'Only a CSF dispatch attempt with an unknown provider outcome is reconciled; this one is "%".',
      v_attempt.state
      USING ERRCODE = '23514';
  END IF;

  -- NULL-OR-EQUAL, NEVER SILENTLY OVERWRITTEN.
  --
  -- The binding used to be `coalesce(provider_message_id, v_message_id)`, which
  -- quietly discarded a supplied identity whenever one was already recorded. If the
  -- two disagree, one of them is wrong about which message actually went to this
  -- recipient, and picking the older one by accident of coalesce order is not a
  -- decision anybody made.
  IF v_message_id IS NOT NULL
    AND v_attempt.provider_message_id IS NOT NULL
    AND v_attempt.provider_message_id <> v_message_id
  THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt already reports provider message "%", so it cannot be reconciled against "%"; provider message identity is bound once.',
      v_attempt.provider_message_id, v_message_id
      USING ERRCODE = '23514';
  END IF;

  SELECT delivery.*
  INTO v_delivery
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.id = v_attempt.delivery_id
    AND delivery.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The CSF delivery for this dispatch attempt is missing.'
      USING ERRCODE = '23503';
  END IF;

  IF p_resolution = 'human_review' THEN
    -- ESCALATION IS NOT A RESOLUTION. The attempt stays 'unknown_outcome' and
    -- stays unretryable, and exactly one later final resolution is still
    -- allowed -- which is why escalation writes its own columns rather than the
    -- reconciliation ones.
    IF v_attempt.escalated_at IS NOT NULL THEN
      IF v_attempt.escalation_reason IS NOT DISTINCT FROM v_reason
        AND v_attempt.escalated_by IS NOT DISTINCT FROM p_actor_user_id
        AND v_attempt.correlation_id IS NOT DISTINCT FROM v_correlation
      THEN
        RETURN pg_catalog.jsonb_build_object(
          'organizationId', p_organization_id,
          'attemptId', p_attempt_id,
          'deliveryId', v_attempt.delivery_id,
          'resolution', 'human_review',
          'attemptState', v_attempt.state,
          'deliveryStatus', v_delivery.status,
          'deliveryReduced', false,
          'idempotentReplay', true
        );
      END IF;

      RAISE EXCEPTION
        'That CSF unknown outcome was already escalated with different evidence -- reason, escalating account, or correlation; escalation evidence is recorded once.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE plugin_data.csf_communication_dispatch_attempts
    SET
      review_state = 'escalated',
      escalated_at = v_now,
      escalated_by = p_actor_user_id,
      escalation_reason = v_reason,
      correlation_id = coalesce(correlation_id, v_correlation),
      updated_at = v_now
    WHERE id = p_attempt_id;

    UPDATE plugin_data.csf_communication_deliveries
    SET
      review_state = 'escalated',
      review_reason = v_reason,
      updated_at = v_now
    WHERE id = v_attempt.delivery_id
      AND organization_id = p_organization_id;

    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'attemptId', p_attempt_id,
      'deliveryId', v_attempt.delivery_id,
      'resolution', 'human_review',
      'attemptState', 'unknown_outcome',
      'deliveryStatus', v_delivery.status,
      'deliveryReduced', false,
      'escalated', true,
      'idempotentReplay', false
    );
  END IF;

  -- Final resolution. The lifecycle trigger independently requires every field
  -- written here, so an operator cannot reach the same state with a bare UPDATE
  -- and no evidence.
  UPDATE plugin_data.csf_communication_dispatch_attempts
  SET
    state = p_resolution,
    review_state = 'resolved',
    reconciled_outcome = p_resolution,
    reconciled_at = v_now,
    reconciled_actor_kind = 'staff',
    reconciled_by = p_actor_user_id,
    reconciled_by_identity = v_actor_identity,
    reconciliation_reason = v_reason,
    provider_message_id = coalesce(provider_message_id, v_message_id),
    correlation_id = coalesce(correlation_id, v_correlation),
    outcome_detail = v_reason,
    updated_at = v_now
  WHERE id = p_attempt_id;

  -- A SUPPLIED PROVIDER MESSAGE ID BINDS BOTH SIDES.
  --
  -- The operator found the message identity in the provider's dashboard, which is
  -- exactly the fact that lets previously unmatched webhook evidence for it be
  -- rebound. Binding it only to the attempt would leave the delivery unnameable,
  -- so a webhook that arrived before this reconciliation would stay unmatched
  -- forever -- the provider's own account of what happened, discarded by an
  -- omission. Bind the delivery too.
  IF v_message_id IS NOT NULL AND v_delivery.provider_message_id IS NULL THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET provider_message_id = v_message_id, updated_at = v_now
    WHERE id = v_attempt.delivery_id
      AND organization_id = p_organization_id;

    v_bound_message := true;
  END IF;

  -- THE DELIVERY WALKS TO THE RESOLUTION.
  --
  -- Leaving a delivery 'queued' after deciding the message was delivered would
  -- make the ledger disagree with itself. The delivery state machine forbids
  -- queued -> delivered and queued -> complained directly, so the walk takes
  -- the legal intermediate 'sent' step first. Bounce, suppression, and failure
  -- are legal from 'queued' and need no intermediate.
  v_delivery_status := v_delivery.status;

  IF v_delivery_status <> p_resolution THEN
    IF NOT plugin_data.csf_communication_delivery_transition_allowed(
      v_delivery_status, p_resolution
    )
      AND plugin_data.csf_communication_delivery_transition_allowed(v_delivery_status, 'sent')
      AND plugin_data.csf_communication_delivery_transition_allowed('sent', p_resolution)
    THEN
      UPDATE plugin_data.csf_communication_deliveries
      SET
        status = 'sent',
        sent_at = coalesce(sent_at, greatest(v_now, queued_at)),
        updated_at = v_now
      WHERE id = v_attempt.delivery_id
        AND organization_id = p_organization_id;

      v_delivery_status := 'sent';
    END IF;

    IF plugin_data.csf_communication_delivery_transition_allowed(
      v_delivery_status, p_resolution
    ) THEN
      UPDATE plugin_data.csf_communication_deliveries
      SET
        status = p_resolution,
        delivered_at = CASE
          WHEN p_resolution = 'delivered'
            THEN coalesce(delivered_at, greatest(v_now, sent_at, queued_at))
          ELSE delivered_at
        END,
        failed_at = CASE
          WHEN p_resolution IN ('bounced', 'failed')
            THEN coalesce(failed_at, greatest(v_now, queued_at))
          ELSE failed_at
        END,
        terminal_locked_at = CASE
          WHEN p_resolution IN ('bounced', 'complained', 'suppressed')
            THEN coalesce(terminal_locked_at, v_now)
          ELSE terminal_locked_at
        END,
        review_state = 'resolved',
        review_reason = v_reason,
        updated_at = v_now
      WHERE id = v_attempt.delivery_id
        AND organization_id = p_organization_id;

      v_delivery_status := p_resolution;
      v_reduced := true;
    END IF;
  END IF;

  IF NOT v_reduced THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET
      review_state = 'resolved',
      review_reason = v_reason,
      updated_at = v_now
    WHERE id = v_attempt.delivery_id
      AND organization_id = p_organization_id;
  END IF;

  -- AN OFFICER'S SAFETY VERDICT MUST PROTECT THE NEXT SEND TOO.
  --
  -- Resolving an unknown outcome as bounced, complained, or suppressed is exactly
  -- the same FACT about the address that a provider webhook carries -- an officer
  -- read it off the provider's dashboard. Updating only the attempt and the
  -- delivery left the address-safety projection untouched, so the very next
  -- campaign cheerfully mailed a mailbox an officer had just recorded as dead, and
  -- the ledger contained no evidence to explain why.
  --
  -- Same reducer, same paired projection/event write, same transaction -- with a
  -- staff actor and the shared correlation instead of a provider event id.
  IF p_resolution IN ('bounced', 'complained', 'suppressed') THEN
    SELECT snapshot.recipient_email
    INTO v_recipient_email
    FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
    WHERE snapshot.id = v_attempt.recipient_snapshot_id
      AND snapshot.organization_id = p_organization_id;

    IF v_recipient_email IS NOT NULL THEN
      v_safety := plugin_data.csf_apply_communication_address_safety(
        p_organization_id,
        v_recipient_email,
        CASE p_resolution
          WHEN 'bounced' THEN 'bounce'
          WHEN 'complained' THEN 'complaint'
          ELSE 'provider_suppression'
        END,
        pg_catalog.left('staff reconciliation: ' || v_reason, 300),
        v_now,
        NULL,
        'staff',
        v_actor_identity,
        v_correlation,
        -- An officer reconciling a bounce has no provider bounce type to hand us,
        -- so the class is deliberately left undetermined: that produces a REVIEW
        -- hold rather than an indefinite block, which is the honest severity for a
        -- verdict reached without the provider's own classification.
        p_bounce_type
      );
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'attemptId', p_attempt_id,
    'deliveryId', v_attempt.delivery_id,
    'resolution', p_resolution,
    'attemptState', p_resolution,
    'deliveryStatus', v_delivery_status,
    'deliveryReduced', v_reduced,
    'boundDeliveryMessageId', v_bound_message,
    'addressSafety', v_safety,
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'escalated', false,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_communication_unknown_outcome(
  uuid, uuid, text, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_communication_unknown_outcome(
  uuid, uuid, text, text, text, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_reconcile_communication_unknown_outcome(
  uuid, uuid, text, text, text, uuid, text, text
) IS
  'UNKNOWN OUTCOME SAFETY: the staff exit from an unknown provider outcome, requiring an ACTIVE tenant-scoped CSF staff capability and freezing the actor, durable identity, and correlation that decided it. An exact replay must match EVERY frozen coordinate including actor and correlation; the provider message binding is null-or-equal and never silently overwritten. A bounced, complained, or suppressed resolution writes paired address-safety projection and evidence rows in the same transaction, so the verdict protects the next send too. Rejects every retry-shaped resolution by name and never re-sends.';

-- I.7b Bind a provider message identity that was not known at settlement time.
--
-- A DISCOVERY IS NOT A REPLAY.
--
-- An attempt can settle honestly with no provider message identity -- a timeout, an
-- unknown outcome, a response that never arrived -- and an officer can later find
-- the identity in the provider's dashboard. That is a real workflow, and it used to
-- be smuggled through the reconciliation path's coalesce(): pass the id on a
-- "replay" and it would be quietly absorbed with no evidence that anything new had
-- been learned.
--
-- It gets its own operation instead. One-shot, capability-gated, with its own
-- durable evidence, and it re-runs the shared resolution primitive over any
-- webhook evidence that was waiting for exactly this identity.
CREATE OR REPLACE FUNCTION plugin_data.csf_bind_communication_provider_message(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_provider_message_id text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_capability constant text := 'manage_settings';
  v_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_now timestamptz := now();
  v_attempt plugin_data.csf_communication_dispatch_attempts%ROWTYPE;
  v_delivery plugin_data.csf_communication_deliveries%ROWTYPE;
  v_event plugin_data.csf_communication_provider_events%ROWTYPE;
  v_campaign_id uuid;
  v_rebound integer := 0;
  v_resolution jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF provider message binding requires an organization and an attempt.'
      USING ERRCODE = '22004';
  END IF;

  IF v_message_id IS NULL OR pg_catalog.char_length(v_message_id) > 255 THEN
    RAISE EXCEPTION
      'A CSF provider message binding requires the provider message identity, at most 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 300 THEN
    RAISE EXCEPTION
      'A CSF provider message binding records a reason of 1 to 300 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF provider message binding must record the staff account that discovered it.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to bind a provider message identity in this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  -- CANONICAL LOCK ORDER, STEPS 1-4. Manual binding used to run attempt ->
  -- delivery -> provider events with no campaign lock, which is the order the
  -- evidence resolver traverses in reverse; the two could each hold what the other
  -- needed next. Discovery is unlocked, then the campaign advisory lock, then the
  -- campaign row, then the attempt.
  SELECT attempt.campaign_id
  INTO v_campaign_id
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || v_campaign_id::text,
      0
    )
  );

  PERFORM 1
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = v_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF dispatch attempt does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_attempt.campaign_id IS DISTINCT FROM v_campaign_id THEN
    RAISE EXCEPTION
      'This CSF dispatch attempt changed campaign between coordinate discovery and the campaign lock; refusing to bind a provider message against a stale coordinate.'
      USING ERRCODE = '23514';
  END IF;

  -- Idempotent only for the IDENTICAL identity. A different one is a conflict, not
  -- a second discovery.
  IF v_attempt.provider_message_id IS NOT NULL THEN
    IF v_attempt.provider_message_id = v_message_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'organizationId', p_organization_id,
        'attemptId', p_attempt_id,
        'providerMessageId', v_message_id,
        'reboundEvents', 0,
        'idempotentReplay', true
      );
    END IF;

    RAISE EXCEPTION
      'This CSF dispatch attempt already reports provider message "%"; a provider message identity is bound exactly once.',
      v_attempt.provider_message_id
      USING ERRCODE = '23514';
  END IF;

  -- The global uniqueness of provider_message_id is what makes webhook routing
  -- unambiguous, so a cross-tenant or cross-delivery collision is refused here with
  -- a diagnostic rather than as a bare index violation.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_communication_deliveries AS delivery
    WHERE delivery.provider_message_id = v_message_id
      AND delivery.id <> v_attempt.delivery_id
  ) THEN
    RAISE EXCEPTION
      'Another CSF delivery already reports provider message "%"; one provider message names exactly one delivery.',
      v_message_id
      USING ERRCODE = '23505';
  END IF;

  SELECT delivery.*
  INTO v_delivery
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.id = v_attempt.delivery_id
    AND delivery.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The CSF delivery for this dispatch attempt is missing.'
      USING ERRCODE = '23503';
  END IF;

  UPDATE plugin_data.csf_communication_dispatch_attempts
  SET
    provider_message_id = v_message_id,
    correlation_id = coalesce(correlation_id, v_correlation),
    updated_at = v_now
  WHERE id = p_attempt_id;

  IF v_delivery.provider_message_id IS NULL THEN
    UPDATE plugin_data.csf_communication_deliveries
    SET provider_message_id = v_message_id, updated_at = v_now
    WHERE id = v_delivery.id
      AND organization_id = p_organization_id;
  END IF;

  -- Durable evidence that something was LEARNED here, distinct from the
  -- reconciliation that may have settled this attempt earlier.
  INSERT INTO plugin_data.csf_communication_address_safety_events (
    organization_id, safety_id, normalized_recipient_email, recipient_email_hash,
    event_class, event_kind, event_reason, observed_at, previous_state,
    next_state, actor_kind, actor_identity, correlation_id
  )
  SELECT
    p_organization_id, NULL, snapshot.normalized_recipient_email,
    snapshot.recipient_email_hash, 'manual_hold', 'review_required',
    pg_catalog.left('provider message identity bound: ' || v_reason, 300),
    v_now, 'safe', 'suppressed', 'staff', v_actor_identity, v_correlation
  FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.id = v_attempt.recipient_snapshot_id
    AND snapshot.organization_id = p_organization_id
    -- Only when the address is ALREADY blocked. Binding an identity is not itself
    -- a safety signal, so this records provenance beside an existing block rather
    -- than inventing one.
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_address_safety AS safety
      WHERE safety.organization_id = p_organization_id
        AND safety.normalized_recipient_email = snapshot.normalized_recipient_email
        AND safety.safety_state = 'suppressed'
    );

  -- Any webhook that was waiting for exactly this identity can now resolve. Same
  -- shared primitive, so the rebind reduces identically to a first-arrival event.
  FOR v_event IN
    SELECT event.*
    FROM plugin_data.csf_communication_provider_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.provider_message_id = v_message_id
      AND event.processing_state = 'unmatched'
    ORDER BY event.occurred_at, event.id
  LOOP
    v_resolution := plugin_data.csf_resolve_communication_provider_evidence(
      p_organization_id, v_event.id
    );
    v_rebound := v_rebound + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'attemptId', p_attempt_id,
    'deliveryId', v_attempt.delivery_id,
    'providerMessageId', v_message_id,
    'reboundEvents', v_rebound,
    'lastResolution', v_resolution,
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_bind_communication_provider_message(
  uuid, uuid, text, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_bind_communication_provider_message(
  uuid, uuid, text, text, uuid, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_bind_communication_provider_message(
  uuid, uuid, text, text, uuid, text
) IS
  'The explicit one-time enrichment for a provider message identity discovered after settlement. Capability-gated, idempotent only for the identical identity, refuses a conflicting one, refuses a collision with another delivery, and re-runs the shared resolution primitive over every quarantined unmatched event that was waiting for exactly this identity. Deliberately NOT smuggled through an idempotent reconciliation replay, which would absorb a discovery with no evidence that anything was learned.';

-- I.8 Finalize campaign content -- the explicit "this copy is ready" transition.
--
-- A NON-EMPTY DRAFT BODY IS NOT PUBLICATION. Before this call the campaign has no
-- content digest, so every draft field stays editable and the ledger will not
-- enqueue it; after it, sender, subject, both bodies, metadata, topic, term, and
-- audience kind freeze together. Separating the two is what lets an officer save a
-- half-written blast, come back tomorrow, fix a typo, and only then commit.
CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_communication_campaign_content(
  p_organization_id uuid,
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_capability constant text := 'manage_settings';
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_actor_identity text;
  v_now timestamptz := now();
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_content_hash text;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign content finalization requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign content finalization must record the staff account that declared the copy ready.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to finalize campaign content in this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  -- CANONICAL LOCK ORDER. The campaign coordinate arrives as a parameter, so there
  -- is nothing to discover -- but the advisory lock still comes first, because
  -- freezing the content a campaign will send is a campaign-scoped decision and
  -- must serialize against cancellation and dispatch exactly like every other one.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  IF v_campaign.content_finalized_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'contentFinalizedAt', v_campaign.content_finalized_at,
      'contentHash', v_campaign.content_hash,
      'idempotentReplay', true
    );
  END IF;

  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION
      'CSF campaign content is finalized while the campaign is still a draft; this one is "%".',
      v_campaign.status
      USING ERRCODE = '23514';
  END IF;

  IF nullif(btrim(coalesce(v_campaign.body_text, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign needs a plain-text body before its content can be finalized.'
      USING ERRCODE = '23514';
  END IF;

  -- The derive trigger computes content_hash from the stored content the moment
  -- this timestamp lands, so readiness is a fact about the body rather than a
  -- claim made alongside it.
  UPDATE plugin_data.csf_communication_campaigns
  SET
    content_finalized_at = v_now,
    content_finalized_by = p_actor_user_id,
    content_finalized_by_identity = v_actor_identity,
    correlation_id = coalesce(correlation_id, v_correlation),
    updated_at = v_now
  WHERE id = p_campaign_id
    AND organization_id = p_organization_id
  RETURNING content_hash INTO v_content_hash;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'contentFinalizedAt', v_now,
    'contentHash', v_content_hash,
    'actorUserId', p_actor_user_id,
    'actorIdentity', v_actor_identity,
    'correlationId', v_correlation,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finalize_communication_campaign_content(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_communication_campaign_content(
  uuid, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_finalize_communication_campaign_content(
  uuid, uuid, uuid, text
) IS
  'The explicit "this copy is ready" transition. Requires an ACTIVE tenant-scoped CSF staff capability, records who declared it, and lets the derive trigger compute the content digest -- which is what makes the campaign dispatch-ready and freezes sender, subject, bodies, metadata, topic, term, and audience kind together. A non-empty draft body alone does none of this.';

-- I.9 Authoritative campaign terminalization.
--
-- A CAMPAIGN CANNOT DECLARE ITSELF DONE WHILE ITS WORK IS STILL OPEN.
--
-- 'completed' and 'failed' are read as "every recipient has an answer". Setting
-- either while attempts are queued, leased, awaiting a retry, or -- worst -- sitting
-- in unknown_outcome would report a finished send that nobody can actually account
-- for, and an unknown outcome is precisely the case a human still has to look at.
--
-- The guard below is the authority, not the RPC. It runs for EVERY UPDATE that
-- reaches this table -- including one the owner issues from a different RPC or a
-- backfill -- so the rule cannot be sidestepped by writing the status column
-- directly. service_role cannot write the column at all; section J leaves it
-- SELECT-only. This guard is the layer behind that missing privilege, for the one
-- role no privilege check stops.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_campaign_terminalization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_live integer := 0;
  v_unknown integer := 0;
  v_unsent integer := 0;
BEGIN
  -- CANCELLATION IS AN RPC, NOT A COLUMN WRITE.
  --
  -- csf_communication_campaigns_cancellation_check only says "if cancelled_at is
  -- set then status must be cancelled" -- it never said the converse. While
  -- service_role still held UPDATE on this table, an `UPDATE ... SET status =
  -- 'cancelled'` therefore sailed straight through it. That WAS a real hole, not a
  -- theoretical one: it stopped the campaign in the UI while leaving every queued
  -- attempt claimable, recorded no actor, no reason and no correlation, and settled
  -- no delivery. The next claim sweep then happily mailed a withdrawn campaign.
  --
  -- Section J has since removed that grant, so no server or client role can issue
  -- the statement. The converse rule is still enforced here because the OWNER can
  -- issue it, and every owned RPC runs as the owner: transitions INTO cancelled
  -- require the full evidence tuple, which only
  -- plugin_data.csf_cancel_communication_campaign() writes. Rows that were already
  -- cancelled before this migration are left alone.
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF NEW.cancelled_at IS NULL
      OR NEW.cancellation_reason IS NULL
      OR NEW.cancelled_by_identity IS NULL
    THEN
      RAISE EXCEPTION
        'A CSF campaign is cancelled through plugin_data.csf_cancel_communication_campaign(), which settles the outstanding work and records the actor and reason; a bare status update would stop the campaign on screen while leaving its queued attempts claimable.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR NEW.status NOT IN ('completed', 'failed')
  THEN
    RETURN NEW;
  END IF;

  -- 'cancelled' is deliberately absent from the statuses this guards: withdrawing
  -- a send is an honest terminal answer even when an individual outcome is
  -- unknown, and plugin_data.csf_cancel_communication_campaign() settles the
  -- ambiguous work as unknown outcomes on its way through.
  --
  -- WHAT COUNTS AS RETRYABLE WORK STILL OUTSTANDING. A 'retryable_failure' that
  -- already has a successor attempt is not itself outstanding -- the successor is,
  -- and it is counted as queued or processing in its own right. Counting the
  -- predecessor too would mean any campaign that ever retried a recipient could
  -- never terminalize at all. Conversely, a retryable failure with no successor
  -- and no settled delivery IS outstanding: the tries ran out without an answer.
  SELECT
    count(*) FILTER (
      WHERE attempt.state IN ('queued', 'processing')
        OR (
          attempt.state = 'retryable_failure'
          AND delivery.status = 'queued'
          AND NOT EXISTS (
            SELECT 1
            FROM plugin_data.csf_communication_dispatch_attempts AS successor
            WHERE successor.organization_id = attempt.organization_id
              AND successor.campaign_id = attempt.campaign_id
              AND successor.recipient_snapshot_id = attempt.recipient_snapshot_id
              AND successor.attempt_number > attempt.attempt_number
          )
        )
    )::integer,
    count(*) FILTER (WHERE attempt.state = 'unknown_outcome')::integer
  INTO v_live, v_unknown
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  JOIN plugin_data.csf_communication_deliveries AS delivery
    ON delivery.id = attempt.delivery_id
    AND delivery.organization_id = attempt.organization_id
  WHERE attempt.organization_id = NEW.organization_id
    AND attempt.campaign_id = NEW.id;

  IF v_live > 0 THEN
    RAISE EXCEPTION
      'This CSF campaign still has % dispatch attempt(s) queued, leased, or awaiting a retry and cannot be marked "%" yet.',
      v_live, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF v_unknown > 0 THEN
    RAISE EXCEPTION
      'This CSF campaign still has % dispatch attempt(s) with an unknown provider outcome; resolve or reconcile them before marking it "%".',
      v_unknown, NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- A delivery still sitting in 'queued' was never dispatched at all, so no
  -- recipient outcome exists for it. A delivery in 'sent' HAS a settled dispatch
  -- outcome and is merely awaiting an optional provider confirmation that may
  -- never arrive; blocking on that would strand campaigns forever, and the
  -- delivery row keeps advancing on its own as webhooks land.
  SELECT count(*)::integer
  INTO v_unsent
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = NEW.organization_id
    AND delivery.campaign_id = NEW.id
    AND delivery.status = 'queued';

  IF v_unsent > 0 THEN
    RAISE EXCEPTION
      'This CSF campaign still has % delivery row(s) that were never dispatched and cannot be marked "%" yet.',
      v_unsent, NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- The review block is the visible statement that some outcome is unknown. The
  -- CHECK forbids pairing it with 'completed'; this raises the diagnostic that
  -- actually explains why rather than letting the constraint report a shape error.
  IF NEW.review_blocked_at IS NOT NULL AND NEW.status = 'completed' THEN
    RAISE EXCEPTION
      'This CSF campaign is review-blocked and cannot be marked completed; clear the block by resolving the unknown outcomes behind it.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_communication_campaigns_terminalization
BEFORE UPDATE ON plugin_data.csf_communication_campaigns
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_enforce_campaign_terminalization();

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_campaign_terminalization()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plugin_data.csf_enforce_campaign_terminalization() IS
  'The authority on CSF campaign terminalization. Rejects completed/failed while any attempt is queued, leased, awaiting a retry, or holding an unknown provider outcome, while any delivery was never dispatched, or while the campaign is review-blocked. Runs for every UPDATE that reaches the table, including one the owner issues outside the finalization RPC, so the rule is not a property of a single function. service_role holds no write privilege on this table at all -- it is SELECT-only -- so this guard exists for the owner, whom no privilege check stops.';

-- The locked aggregation. It computes the same condition the guard enforces, so a
-- caller gets a considered answer instead of an exception, and it takes the
-- campaign row FOR UPDATE first so two concurrent finalizers cannot both decide.
CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_communication_campaign(
  p_organization_id uuid,
  p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_live integer := 0;
  v_unknown integer := 0;
  v_settled integer := 0;
  v_succeeded integer := 0;
  v_failed integer := 0;
  v_unsent integer := 0;
  v_target text;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign finalization requires an organization and a campaign.'
      USING ERRCODE = '22004';
  END IF;

  -- CANONICAL LOCK ORDER. Terminalization reads the whole attempt and delivery
  -- ledger for this campaign and then writes the campaign row, so it must hold the
  -- campaign advisory lock the settlement, claim, reap, and cancellation paths hold
  -- -- otherwise a settlement committing mid-aggregation could make this call
  -- declare a campaign complete against counts that were already stale.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:' || p_organization_id::text || ':'
        || p_campaign_id::text,
      0
    )
  );

  SELECT campaign.*
  INTO v_campaign
  FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- The same liveness rule the guard enforces; see
  -- plugin_data.csf_enforce_campaign_terminalization() for why a retryable failure
  -- with a successor is not itself outstanding.
  SELECT
    count(*) FILTER (
      WHERE attempt.state IN ('queued', 'processing')
        OR (
          attempt.state = 'retryable_failure'
          AND delivery.status = 'queued'
          AND NOT EXISTS (
            SELECT 1
            FROM plugin_data.csf_communication_dispatch_attempts AS successor
            WHERE successor.organization_id = attempt.organization_id
              AND successor.campaign_id = attempt.campaign_id
              AND successor.recipient_snapshot_id = attempt.recipient_snapshot_id
              AND successor.attempt_number > attempt.attempt_number
          )
        )
    )::integer,
    count(*) FILTER (WHERE attempt.state = 'unknown_outcome')::integer
  INTO v_live, v_unknown
  FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  JOIN plugin_data.csf_communication_deliveries AS delivery
    ON delivery.id = attempt.delivery_id
    AND delivery.organization_id = attempt.organization_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.campaign_id = p_campaign_id;

  SELECT
    count(*) FILTER (WHERE delivery.status = 'queued')::integer,
    count(*) FILTER (WHERE delivery.status IN ('sent', 'delivered'))::integer,
    count(*) FILTER (
      WHERE delivery.status IN ('bounced', 'complained', 'suppressed', 'failed')
    )::integer,
    count(*) FILTER (WHERE delivery.status <> 'queued')::integer
  INTO v_unsent, v_succeeded, v_failed, v_settled
  FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = p_organization_id
    AND delivery.campaign_id = p_campaign_id;

  IF v_campaign.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'status', v_campaign.status,
      'terminalized', false,
      'liveAttempts', v_live,
      'unknownAttempts', v_unknown,
      'undispatchedDeliveries', v_unsent,
      'succeededDeliveries', v_succeeded,
      'failedDeliveries', v_failed,
      'settledDeliveries', v_settled,
      'reviewBlocked', v_campaign.review_blocked_at IS NOT NULL,
      'idempotentReplay', true
    );
  END IF;

  IF v_campaign.status NOT IN ('queued', 'sending') THEN
    RAISE EXCEPTION
      'A CSF campaign is finalized out of queued or sending; this one is "%".',
      v_campaign.status
      USING ERRCODE = '23514';
  END IF;

  -- NONTERMINAL IS A RESULT, NOT AN ERROR. A scheduler polls this, and an
  -- exception per poll would be noise. What matters is that it does not lie: the
  -- campaign keeps its live status and the caller is told exactly what is open.
  IF v_live > 0 OR v_unknown > 0 OR v_unsent > 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'campaignId', p_campaign_id,
      'status', v_campaign.status,
      'terminalized', false,
      'liveAttempts', v_live,
      'unknownAttempts', v_unknown,
      'undispatchedDeliveries', v_unsent,
      'succeededDeliveries', v_succeeded,
      'failedDeliveries', v_failed,
      'settledDeliveries', v_settled,
      -- An unknown outcome is exactly the condition that keeps a campaign
      -- nonterminal AND visibly review-blocked.
      'reviewBlocked', v_unknown > 0 OR v_campaign.review_blocked_at IS NOT NULL,
      'blockedBy', CASE
        WHEN v_unknown > 0 THEN 'unknown_outcomes'
        WHEN v_live > 0 THEN 'live_attempts'
        ELSE 'undispatched_deliveries'
      END,
      'idempotentReplay', false
    );
  END IF;

  -- Wholly settled. A send that reached nobody is a failure; one that reached at
  -- least one recipient completed, with the per-recipient truth still readable
  -- from the delivery ledger.
  v_target := CASE WHEN v_succeeded > 0 THEN 'completed' ELSE 'failed' END;

  UPDATE plugin_data.csf_communication_campaigns
  SET
    status = v_target,
    completed_at = coalesce(completed_at, v_now),
    -- Every unknown outcome behind the block has been resolved -- the guard above
    -- proved it -- so the live gate is lifted. The evidence itself is untouched:
    -- it lives in the attempt ledger and the frozen provider events.
    review_blocked_at = NULL,
    review_blocked_reason = NULL,
    updated_at = v_now
  WHERE id = p_campaign_id
    AND organization_id = p_organization_id;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'campaignId', p_campaign_id,
    'status', v_target,
    'terminalized', true,
    'liveAttempts', 0,
    'unknownAttempts', 0,
    'undispatchedDeliveries', 0,
    'succeededDeliveries', v_succeeded,
    'failedDeliveries', v_failed,
    'settledDeliveries', v_settled,
    'reviewBlocked', false,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finalize_communication_campaign(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_communication_campaign(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_finalize_communication_campaign(uuid, uuid) IS
  'Locked aggregation that terminalizes a CSF campaign only on wholly settled evidence. Takes the campaign FOR UPDATE, then refuses -- as a reported result rather than an exception -- while any attempt is queued, leased, awaiting a retry, or unknown, or any delivery was never dispatched. An unknown outcome keeps the campaign nonterminal and visibly review-blocked.';

-- ---------------------------------------------------------------------------
-- I.10 Webhook quarantine, because Resend retries every non-200
--
-- RETURNING 409 DOES NOT STOP A RETRY.
--
-- The route previously answered 409 for a conflicting replay on the theory that a
-- 4xx tells the provider not to bother again. Resend retries every delivery whose
-- response is not HTTP 200. So a signed event we could not route -- a tag naming an
-- attempt in another tenant, an envelope replayed with different immutable
-- evidence -- came back on a retry schedule, failed identically, and was answered
-- 409 again, forever. Nothing was ever recorded, so nobody could see it happening.
--
-- The fix is not a different status code. It is to make the fault DURABLE, and only
-- then answer 200. The provider stops retrying because we genuinely accepted
-- responsibility for the event; an operator can see it; and a real storage outage
-- still returns 5xx, where a retry is exactly what we want.
--
-- What is stored is deliberately narrow: the envelope identity, the bounded hash of
-- the raw body the signature was verified over, a reason code, and a bounded
-- diagnostic. Never the body itself, never a recipient address.
-- ---------------------------------------------------------------------------

CREATE TABLE plugin_data.csf_communication_webhook_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: the whole point is that some of these could NOT be routed to a
  -- tenant. ON DELETE CASCADE when it is known, so a purged organization takes its
  -- quarantine with it.
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'resend',
  provider_event_id text NOT NULL,
  event_type text,
  provider_message_id text,
  raw_body_hash text NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  claimed_organization_id uuid,
  claimed_attempt_id uuid,
  claimed_campaign_id uuid,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by_identity text,
  resolution_note text,
  CONSTRAINT csf_comm_webhook_quarantine_envelope_key
    UNIQUE (provider, provider_event_id, reason_code),
  CONSTRAINT csf_comm_webhook_quarantine_provider_check
    CHECK (provider = 'resend'),
  CONSTRAINT csf_comm_webhook_quarantine_event_id_shape_check
    CHECK (
      nullif(btrim(provider_event_id), '') IS NOT NULL
      AND provider_event_id = btrim(provider_event_id)
      AND provider_event_id !~ '\s'
      AND char_length(provider_event_id) <= 255
    ),
  CONSTRAINT csf_comm_webhook_quarantine_body_hash_check
    CHECK (raw_body_hash ~ '^[0-9a-f]{64}$'),
  -- A CLOSED SET, AND IT MUST BE THE ROUTE'S SET EXACTLY.
  --
  -- This list previously admitted a vocabulary the route had stopped emitting:
  -- 'unroutable_attempt', 'contradictory_routing_tags',
  -- 'cross_tenant_provider_message', and 'permanent_application_conflict' were
  -- allowed here and produced by nothing, while the codes the route actually
  -- derives for a permanent conflict -- 'contradictory_routing_evidence',
  -- 'cross_tenant_evidence', 'unknown_tenant_coordinate' -- were not allowed at
  -- all. That is not a cosmetic drift. A real permanent conflict would have
  -- reached the quarantine RPC, violated this CHECK, and been reported to the
  -- route as a quarantine outage: 503, which makes Resend retry forever the exact
  -- class of fault the quarantine exists to make durable. Route mocks could not
  -- see it, because a mock accepts any string.
  --
  -- The vocabulary now lives in three places that a static contract test holds
  -- identical: CSF_ROUTE_QUARANTINE_REASON_CODES in the webhook route, the
  -- argument validation in csf_quarantine_communication_webhook(), and this CHECK.
  -- The only asymmetry is deliberate and asserted -- see the reserved code below.
  CONSTRAINT csf_comm_webhook_quarantine_reason_check
    CHECK (
      reason_code IN (
        'unroutable_tenant',
        'malformed_event_shape',
        'unsupported_event_shape',
        'immutable_replay_conflict',
        'contradictory_routing_evidence',
        'cross_tenant_evidence',
        'unknown_tenant_coordinate',
        -- AUTHORED BY THE RPC, NEVER BY A CALLER. The same envelope and reason
        -- arriving with DIFFERENT immutable evidence is not a retry of a known
        -- fault, so it cannot be folded into the existing row's counter. The RPC
        -- rejects this code as an argument precisely so the only way to produce
        -- one is the serialized compare-then-act path that proves the mismatch.
        'conflicting_quarantine_evidence'
      )
    ),
  CONSTRAINT csf_comm_webhook_quarantine_detail_check
    CHECK (
      reason_detail IS NULL
      OR (
        nullif(btrim(reason_detail), '') IS NOT NULL
        AND char_length(reason_detail) <= 500
      )
    ),
  CONSTRAINT csf_comm_webhook_quarantine_event_type_check
    CHECK (event_type IS NULL OR char_length(event_type) <= 100),
  CONSTRAINT csf_comm_webhook_quarantine_message_id_check
    CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 255),
  CONSTRAINT csf_comm_webhook_quarantine_occurrences_check
    CHECK (occurrence_count >= 1),
  CONSTRAINT csf_comm_webhook_quarantine_window_check
    CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT csf_comm_webhook_quarantine_resolution_check
    CHECK (
      (resolved_at IS NULL) = (resolution_note IS NULL)
      AND (resolved_at IS NULL) = (resolved_by_identity IS NULL)
      AND (
        resolved_at IS NULL
        OR (
          nullif(btrim(resolution_note), '') IS NOT NULL
          AND char_length(resolution_note) <= 500
          AND nullif(btrim(resolved_by_identity), '') IS NOT NULL
          AND char_length(resolved_by_identity) <= 320
        )
      )
    )
);

-- The triage worklist, newest first, partial so it stays small.
CREATE INDEX csf_comm_webhook_quarantine_open_idx
  ON plugin_data.csf_communication_webhook_quarantine (
    last_seen_at DESC,
    id DESC
  )
  WHERE resolved_at IS NULL;

CREATE INDEX csf_comm_webhook_quarantine_tenant_idx
  ON plugin_data.csf_communication_webhook_quarantine (organization_id, last_seen_at DESC)
  WHERE organization_id IS NOT NULL;

-- Quarantine is evidence: the body hash, envelope identity, reason, and claimed
-- coordinates are frozen. Only the dedup counters and a one-time triage resolution
-- may be written after the first capture.
CREATE OR REPLACE FUNCTION plugin_data.csf_freeze_webhook_quarantine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_comm_teardown_authorized(
      coalesce(OLD.organization_id, OLD.claimed_organization_id)
    ) THEN
      RETURN OLD;
    END IF;

    IF OLD.organization_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF webhook quarantine evidence cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  IF ROW(
    NEW.id, NEW.provider, NEW.provider_event_id, NEW.event_type,
    NEW.provider_message_id, NEW.raw_body_hash, NEW.reason_code,
    NEW.reason_detail, NEW.claimed_organization_id, NEW.claimed_attempt_id,
    NEW.claimed_campaign_id, NEW.first_seen_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.provider, OLD.provider_event_id, OLD.event_type,
    OLD.provider_message_id, OLD.raw_body_hash, OLD.reason_code,
    OLD.reason_detail, OLD.claimed_organization_id, OLD.claimed_attempt_id,
    OLD.claimed_campaign_id, OLD.first_seen_at
  ) THEN
    RAISE EXCEPTION 'CSF webhook quarantine evidence is append-only.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.occurrence_count < OLD.occurrence_count
    OR NEW.last_seen_at < OLD.last_seen_at
  THEN
    RAISE EXCEPTION
      'CSF webhook quarantine dedup counters only move forward.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.resolved_at IS NOT NULL
    AND ROW(NEW.resolved_at, NEW.resolved_by_identity, NEW.resolution_note)
      IS DISTINCT FROM ROW(OLD.resolved_at, OLD.resolved_by_identity, OLD.resolution_note)
  THEN
    RAISE EXCEPTION
      'A CSF webhook quarantine triage decision is recorded once and never rewritten.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER csf_comm_webhook_quarantine_append_only
BEFORE UPDATE OR DELETE ON plugin_data.csf_communication_webhook_quarantine
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_freeze_webhook_quarantine();

REVOKE ALL ON FUNCTION plugin_data.csf_freeze_webhook_quarantine()
  FROM PUBLIC, anon, authenticated;

-- Capture one unroutable or permanently conflicting signed webhook, durably.
--
-- Deduplicated on (provider, envelope id, reason), so a provider retry of the same
-- fault increments a counter instead of growing the table without bound -- and the
-- route can answer 200 on the retry too, because the fault is already durable.
CREATE OR REPLACE FUNCTION plugin_data.csf_quarantine_communication_webhook(
  p_provider_event_id text,
  p_raw_body_hash text,
  p_reason_code text,
  p_reason_detail text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_claimed_organization_id uuid DEFAULT NULL,
  p_claimed_attempt_id uuid DEFAULT NULL,
  p_claimed_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id text := nullif(btrim(coalesce(p_provider_event_id, '')), '');
  v_now timestamptz := now();
  v_id uuid;
  v_count integer;
  v_first boolean := false;
  v_existing record;
  v_conflict record;
  v_digest_retained boolean := true;
  -- The closed vocabulary a CALLER may use. 'conflicting_quarantine_evidence' is
  -- absent on purpose: this function authors it and nobody else may claim it.
  -- Held identical to the route's CSF_ROUTE_QUARANTINE_REASON_CODES and to
  -- csf_comm_webhook_quarantine_reason_check by a static contract test.
  v_caller_reasons constant text[] := ARRAY[
    'unroutable_tenant',
    'malformed_event_shape',
    'unsupported_event_shape',
    'immutable_replay_conflict',
    'contradictory_routing_evidence',
    'cross_tenant_evidence',
    'unknown_tenant_coordinate'
  ];
BEGIN
  IF v_event_id IS NULL OR pg_catalog.char_length(v_event_id) > 255 OR v_event_id ~ '\s' THEN
    RAISE EXCEPTION
      'A CSF webhook quarantine record requires the verified envelope id, without whitespace and at most 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF p_raw_body_hash IS NULL OR p_raw_body_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'A CSF webhook quarantine record requires the SHA-256 of the exact verified raw request body.'
      USING ERRCODE = '22023';
  END IF;

  -- THE REASON IS VALIDATED HERE, NOT LEFT TO THE TABLE CHECK.
  --
  -- Relying on the CHECK meant an unmodelled reason surfaced as a constraint
  -- violation indistinguishable, to the route, from a storage fault -- so the
  -- route answered 503 and Resend retried a request that could never succeed. A
  -- named 22023 at the boundary says which input was wrong, and it fires before
  -- any lock is taken.
  IF p_reason_code IS NULL OR NOT (p_reason_code = ANY (v_caller_reasons)) THEN
    RAISE EXCEPTION
      'A CSF webhook quarantine reason must be one of the closed route-emitted codes; "conflicting_quarantine_evidence" is authored by this function alone.'
      USING ERRCODE = '22023';
  END IF;

  -- =========================================================================
  -- SERIALIZE THE COORDINATE BEFORE READING IT.
  --
  -- The compare-then-act below is only sound if nothing can insert this
  -- coordinate between the read and the write, and FOR UPDATE cannot provide that:
  -- an ABSENT row locks nothing. Two concurrent FIRST captures for the same
  -- envelope and reason carrying DIFFERENT digests therefore both saw NOT FOUND,
  -- both fell through to the insert, and the loser's ON CONFLICT DO UPDATE blindly
  -- incremented the winner's counter -- recording "we saw this same fault twice"
  -- about a body whose digest was then gone for good, with the freeze trigger
  -- guaranteeing it could never be written afterwards.
  --
  -- LOCK ORDER. This function takes at most two advisory locks, in one order:
  --
  --   1. the coordinate (provider, envelope, p_reason_code)  -- always
  --   2. the coordinate (provider, envelope, 'conflicting_quarantine_evidence')
  --      -- only on a mismatch, and only while holding 1
  --
  -- There is no cycle, because 2 can never be somebody's 1: the validation above
  -- refuses 'conflicting_quarantine_evidence' as an argument, so no caller can
  -- enter holding the conflict coordinate and then reach for another. Distinct
  -- envelopes never contend, and two callers with the same envelope and reason are
  -- fully serialized by 1 alone.
  --
  -- The namespace is its own ('csf-communication-quarantine:'), disjoint from the
  -- campaign and address-safety namespaces. This function locks no campaign,
  -- attempt, delivery, or provider-event row, so it composes with the canonical
  -- campaign order by not participating in it: no path holds a quarantine
  -- coordinate and then reaches for a campaign lock, or the reverse.
  -- =========================================================================
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-quarantine:resend:' || v_event_id || ':' || p_reason_code, 0
    )
  );

  -- A REPEAT IS ONLY A REPEAT IF THE EVIDENCE MATCHES.
  --
  -- A bare ON CONFLICT ... DO UPDATE used to serve this whole function, incrementing
  -- the counter for any second arrival of the same (envelope, reason). But the
  -- envelope id is chosen by the sender of the request, and the row's whole
  -- evidential value is the raw-body digest and the claimed coordinates. Folding a
  -- DIFFERENT digest into an existing row's counter would silently assert "we saw
  -- this same fault again" about a body we had never seen -- and because the freeze
  -- trigger forbids rewriting the digest, the stored evidence would keep describing
  -- the first body forever. There is no ON CONFLICT clause left anywhere below:
  -- with the coordinate serialized, every write here is a decided one.
  --
  -- So the existing row is read and compared first. Identical evidence increments;
  -- differing evidence is recorded as its own conflicting-evidence row, never merged.
  SELECT
    quarantine.id,
    quarantine.raw_body_hash,
    quarantine.event_type,
    quarantine.provider_message_id,
    quarantine.claimed_organization_id,
    quarantine.claimed_attempt_id,
    quarantine.claimed_campaign_id
  INTO v_existing
  FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
  WHERE quarantine.provider = 'resend'
    AND quarantine.provider_event_id = v_event_id
    AND quarantine.reason_code = p_reason_code
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.raw_body_hash = p_raw_body_hash
      AND v_existing.event_type IS NOT DISTINCT FROM nullif(btrim(coalesce(p_event_type, '')), '')
      AND v_existing.provider_message_id IS NOT DISTINCT FROM nullif(btrim(coalesce(p_provider_message_id, '')), '')
      AND v_existing.claimed_organization_id IS NOT DISTINCT FROM p_claimed_organization_id
      AND v_existing.claimed_attempt_id IS NOT DISTINCT FROM p_claimed_attempt_id
      AND v_existing.claimed_campaign_id IS NOT DISTINCT FROM p_claimed_campaign_id
    THEN
      -- The provider retried a fault we already hold. Count it and acknowledge.
      UPDATE plugin_data.csf_communication_webhook_quarantine
      SET occurrence_count = occurrence_count + 1, last_seen_at = v_now
      WHERE id = v_existing.id
      RETURNING id, occurrence_count INTO v_id, v_count;

      RETURN pg_catalog.jsonb_build_object(
        'quarantineId', v_id,
        'providerEventId', v_event_id,
        'reasonCode', p_reason_code,
        'occurrenceCount', v_count,
        'firstCapture', false,
        'exactReplay', true,
        'conflict', false,
        'digestRetained', true,
        'durable', true
      );
    END IF;

    -- Same envelope, same reason, DIFFERENT immutable evidence. Both facts are worth
    -- keeping, and the prior row must not be touched.
    --
    -- Lock 2 of 2. Two callers under DIFFERENT reasons can both land here for one
    -- envelope, and they hold different first locks, so this coordinate needs its
    -- own. See the lock-order note above for why this cannot deadlock against 1.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf-communication-quarantine:resend:' || v_event_id
          || ':conflicting_quarantine_evidence',
        0
      )
    );

    SELECT
      quarantine.id,
      quarantine.raw_body_hash
    INTO v_conflict
    FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
    WHERE quarantine.provider = 'resend'
      AND quarantine.provider_event_id = v_event_id
      AND quarantine.reason_code = 'conflicting_quarantine_evidence'
    FOR UPDATE;

    IF FOUND THEN
      -- The conflict record already exists. Its digest is frozen, so a further
      -- mismatching body can only be COUNTED, not stored -- the unique key is
      -- (provider, envelope, reason) and there is no third row to put it in.
      -- That bound is reported rather than hidden: digestRetained says whether the
      -- stored digest is this caller's, so an operator reading occurrenceCount
      -- knows when to go to the provider's own dashboard for the rest.
      v_digest_retained := v_conflict.raw_body_hash = p_raw_body_hash;

      UPDATE plugin_data.csf_communication_webhook_quarantine
      SET occurrence_count = occurrence_count + 1, last_seen_at = v_now
      WHERE id = v_conflict.id
      RETURNING id, occurrence_count INTO v_id, v_count;
    ELSE
      -- No ON CONFLICT clause: the coordinate is locked, so an insert here cannot
      -- race. A unique violation at this point would be a genuine bug and must
      -- surface as one rather than be absorbed into somebody else's counter.
      INSERT INTO plugin_data.csf_communication_webhook_quarantine (
        organization_id, provider, provider_event_id, event_type,
        provider_message_id, raw_body_hash, reason_code, reason_detail,
        claimed_organization_id, claimed_attempt_id, claimed_campaign_id,
        occurrence_count, first_seen_at, last_seen_at
      )
      SELECT
        (
          SELECT organization.id
          FROM public.organizations AS organization
          WHERE organization.id = p_claimed_organization_id
        ),
        'resend', v_event_id,
        nullif(btrim(coalesce(p_event_type, '')), ''),
        nullif(btrim(coalesce(p_provider_message_id, '')), ''),
        p_raw_body_hash, 'conflicting_quarantine_evidence',
        pg_catalog.left(
          'envelope replayed under reason "' || p_reason_code
            || '" with different immutable evidence',
          500
        ),
        p_claimed_organization_id, p_claimed_attempt_id, p_claimed_campaign_id,
        1, v_now, v_now
      RETURNING id, occurrence_count INTO v_id, v_count;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'quarantineId', v_id,
      'providerEventId', v_event_id,
      'reasonCode', 'conflicting_quarantine_evidence',
      'occurrenceCount', v_count,
      'firstCapture', v_count = 1,
      'exactReplay', false,
      'conflict', true,
      'digestRetained', v_digest_retained,
      'durable', true
    );
  END IF;

  -- First capture, under the coordinate lock taken above. The organization link is
  -- only set when the claimed tenant actually exists; otherwise the claim is
  -- retained in claimed_organization_id as an assertion rather than a reference,
  -- which is the whole point of an unroutable event -- organization stays null
  -- until evidence proves one.
  --
  -- The ON CONFLICT DO UPDATE that used to sit here was the bug. It read as
  -- harmless idempotence and was in fact the only path by which a first capture's
  -- digest could be lost: it fired exactly when a concurrent first capture had won
  -- the race, and it incremented that winner's counter without ever comparing the
  -- two bodies. With the coordinate serialized, the absence proved above still
  -- holds at this statement, so there is nothing left to absorb -- and a unique
  -- violation here would now be a real bug, which is what it should look like.
  INSERT INTO plugin_data.csf_communication_webhook_quarantine (
    organization_id, provider, provider_event_id, event_type,
    provider_message_id, raw_body_hash, reason_code, reason_detail,
    claimed_organization_id, claimed_attempt_id, claimed_campaign_id,
    occurrence_count, first_seen_at, last_seen_at
  )
  SELECT
    (
      SELECT organization.id
      FROM public.organizations AS organization
      WHERE organization.id = p_claimed_organization_id
    ),
    'resend', v_event_id,
    nullif(btrim(coalesce(p_event_type, '')), ''),
    nullif(btrim(coalesce(p_provider_message_id, '')), ''),
    p_raw_body_hash, p_reason_code,
    pg_catalog.left(nullif(btrim(coalesce(p_reason_detail, '')), ''), 500),
    p_claimed_organization_id, p_claimed_attempt_id, p_claimed_campaign_id,
    1, v_now, v_now
  RETURNING id, occurrence_count INTO v_id, v_count;

  v_first := v_count = 1;

  RETURN pg_catalog.jsonb_build_object(
    'quarantineId', v_id,
    'providerEventId', v_event_id,
    'reasonCode', p_reason_code,
    'occurrenceCount', v_count,
    'firstCapture', v_first,
    'exactReplay', false,
    'conflict', false,
    'digestRetained', true,
    'durable', true
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_quarantine_communication_webhook(
  text, text, text, text, text, text, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_quarantine_communication_webhook(
  text, text, text, text, text, text, uuid, uuid, uuid
) TO service_role;

COMMENT ON TABLE plugin_data.csf_communication_webhook_quarantine IS
  'Durable capture of signed Resend webhooks that could not be routed or hit a permanent application conflict. Resend retries every non-200 response, so answering 409 never stopped a retry -- it just discarded the event invisibly. The route now records the fault here and only then answers 200. Stores the envelope identity, the bounded hash of the verified raw body, a closed-set reason code, and a bounded diagnostic; never the body and never a recipient address. Server-only.';
COMMENT ON FUNCTION plugin_data.csf_quarantine_communication_webhook(
  text, text, text, text, text, text, uuid, uuid, uuid
) IS
  'Durably captures one unroutable or permanently conflicting signed webhook, deduplicated on (provider, envelope id, reason) so a provider retry increments a counter rather than growing the table. Takes a transaction advisory lock on that exact coordinate FIRST, because an absent row locks nothing and two concurrent first captures carrying different digests would otherwise merge and lose one. Only identical evidence increments; a differing digest or claimed coordinate forks a conflicting_quarantine_evidence row under its own coordinate lock, and never rewrites the first. Reason codes are validated here against the same closed vocabulary the route emits and the table CHECK admits; conflicting_quarantine_evidence is authored only by this function and refused as an argument. The route answers 200 only after this commits, and 5xx when it does not, so provider retries stay useful for real outages.';

-- ---------------------------------------------------------------------------
-- J. Server-only boundaries
--
-- plugin_data still carries an ALTER DEFAULT PRIVILEGES rule that grants
-- authenticated SELECT/INSERT/UPDATE/DELETE on new tables in this schema, so a
-- new table here is client-readable until it is explicitly revoked. All SIX
-- tables this migration creates are revoked below -- broadcast preferences,
-- preference events, address safety, address-safety events, dispatch attempts,
-- and the webhook quarantine -- and RLS is enabled with no policies at all.
--
-- The privileges are re-asserted for the four tables this migration alters as
-- well -- campaigns, recipient snapshots, deliveries, and provider events, all
-- created by 20260730001001 -- which is what makes the block below a complete
-- ten-table inventory. They were already revoked correctly after that migration;
-- restating them keeps a fresh replay's end state independent of statement order
-- and makes the boundary checkable in one place.
--
-- THE WRITE BOUNDARY IS A PRIVILEGE, NOT A FLAG.
--
-- Previously service_role held SELECT/INSERT/UPDATE/DELETE on these ledgers, and
-- the only thing standing between it and a wiped audit trail was a
-- transaction-local GUC -- which service_role can set itself with set_config().
-- That is not a boundary.
--
-- ALL TEN LEDGERS ARE READ-ONLY TO service_role. The grant block below revokes
-- every privilege from it and re-grants SELECT alone: broadcast preferences,
-- preference events, address safety, address-safety events, the webhook
-- quarantine, dispatch attempts, campaigns, recipient snapshots, deliveries, and
-- provider events. Each of them asserts that a projection row and the append-only
-- record justifying it are written together by ONE owner function, and any direct
-- INSERT/UPDATE grant would contradict exactly that. Consequential writes go
-- through the SECURITY DEFINER RPCs, which run as the ledger owner and need no
-- grant at all; removal happens solely through the purge entry point, on the same
-- footing.
--
-- TRUNCATE would bypass every immutability trigger in one statement, and
-- REFERENCES/TRIGGER would let a holder attach new structure to audited history,
-- so none of those is granted to anyone either.
--
-- The triggers are not the boundary on their own. They validate SHAPE, and a
-- forged tuple that satisfies every one of them is still forged. The missing
-- privilege is the authorization.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_communication_broadcast_preferences
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_preference_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_address_safety
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_address_safety_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_webhook_quarantine
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_dispatch_attempts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_campaigns
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_recipient_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_deliveries
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_communication_provider_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  plugin_data.csf_communication_broadcast_preferences,
  plugin_data.csf_communication_preference_events,
  plugin_data.csf_communication_address_safety,
  plugin_data.csf_communication_address_safety_events,
  plugin_data.csf_communication_webhook_quarantine,
  plugin_data.csf_communication_dispatch_attempts,
  plugin_data.csf_communication_campaigns,
  plugin_data.csf_communication_recipient_snapshots,
  plugin_data.csf_communication_deliveries,
  plugin_data.csf_communication_provider_events
FROM PUBLIC, anon, authenticated, service_role;

-- EVERY CONSEQUENTIAL LEDGER IS READ-ONLY TO service_role.
--
-- This block used to grant service_role INSERT and UPDATE on campaigns, attempts,
-- snapshots, deliveries, provider events, and both preference tables. Address
-- safety and the webhook quarantine were already reduced to SELECT, with the
-- reasoning recorded below -- and that reasoning applies verbatim to the other
-- seven. A direct write grant means a bare statement can forge a complete-looking
-- tuple on any of them: a dispatch attempt that was never enqueued through the
-- guard, a delivery reduced with no attempt behind it, a provider event asserting
-- a signature nobody verified, or a consent record with no decision history.
--
-- The triggers are not the boundary either. They validate SHAPE -- monotonicity,
-- immutability, coherent evidence -- and a forged tuple that satisfies every one
-- of them is still forged. Authorization is the missing privilege.
--
-- Reads stay open because dispatch, review screens, the decision helpers, and the
-- server services all need them. Consequential writes go exclusively through the
-- SECURITY DEFINER RPCs above, which run as the ledger owner and therefore need no
-- grant at all:
--
--   plugin_data.csf_snapshot_communication_recipients()
--   plugin_data.csf_finalize_communication_recipient_snapshot()
--   plugin_data.csf_finalize_communication_campaign_content()
--   plugin_data.csf_finalize_communication_campaign()
--   plugin_data.csf_claim_communication_dispatch_batch()
--   plugin_data.csf_authorize_communication_dispatch()
--   plugin_data.csf_settle_communication_dispatch_attempt()
--   plugin_data.csf_reap_communication_dispatch_leases()
--   plugin_data.csf_cancel_communication_campaign()
--   plugin_data.csf_record_communication_provider_event()
--   plugin_data.csf_rebind_communication_provider_event()
--   plugin_data.csf_reconcile_communication_unknown_outcome()
--   plugin_data.csf_bind_communication_provider_message()
--   plugin_data.csf_communication_preference_decision()
--   plugin_data.csf_apply_communication_address_safety()
--   plugin_data.csf_release_communication_address_safety()
--   plugin_data.csf_quarantine_communication_webhook()
--
-- NOTE FOR FIXTURE AUTHORS: a pgTAP suite runs as the database owner, which
-- bypasses grant checks entirely, so fixtures keep working. Any assertion that
-- means something about service_role must SET LOCAL ROLE service_role -- and the
-- suite must not restore a broad grant merely to make setup convenient.
GRANT SELECT ON TABLE
  plugin_data.csf_communication_broadcast_preferences,
  plugin_data.csf_communication_preference_events,
  plugin_data.csf_communication_address_safety,
  plugin_data.csf_communication_address_safety_events,
  plugin_data.csf_communication_webhook_quarantine,
  plugin_data.csf_communication_dispatch_attempts,
  plugin_data.csf_communication_campaigns,
  plugin_data.csf_communication_recipient_snapshots,
  plugin_data.csf_communication_deliveries,
  plugin_data.csf_communication_provider_events
TO service_role;

-- ---------------------------------------------------------------------------
-- K. Lifecycle purge integration
--
-- Requirement: the EXACT existing entry point,
-- plugin_data.csf_purge_recovery_foundations(uuid) from 20260730001001, must
-- cover the new tables in child-before-parent order. It is not renamed and not
-- replaced by a differently named RPC: it is redefined below with the same
-- signature and return type, and it delegates the new tables to a clearly named
-- helper that runs first.
--
-- Ordering matters. Dispatch attempts are children of deliveries, so they must
-- be removed before the delivery sweep the original body performs. Broadcast
-- preferences hang off the organization alone, but they are removed in the same
-- helper so one call retires the whole durable-communications footprint.
--
-- THE COMPLETE DURABLE FOOTPRINT ONE CALL RETIRES, enumerated rather than
-- summarized, in the order the two bodies below delete it:
--
--   plugin_data.csf_purge_durable_communications(uuid) -- the helper, first
--     1. plugin_data.csf_communication_dispatch_attempts
--     2. plugin_data.csf_communication_preference_events
--     3. plugin_data.csf_communication_broadcast_preferences
--     4. plugin_data.csf_communication_address_safety_events
--     5. plugin_data.csf_communication_address_safety
--     6. plugin_data.csf_communication_webhook_quarantine
--          (organization_id OR claimed_organization_id: an unroutable event has
--           only the claim, and would otherwise outlive the tenant it names)
--
--   plugin_data.csf_purge_recovery_foundations(uuid) -- the entry point, after
--     7.  plugin_data.csf_communication_provider_events
--     8.  plugin_data.csf_communication_deliveries
--     9.  plugin_data.csf_communication_recipient_snapshots
--     10. plugin_data.csf_communication_campaigns
--     11. plugin_data.csf_partner_club_term_events
--     12. plugin_data.csf_partner_club_representatives
--     13. public.organization_calendar_events, restricted to
--         source_kind IN ('csf_opportunity', 'csf_meeting_session',
--         'csf_deadline') -- CSF projections only, never a project_schedule
--         binding and never public.projects
--
-- That is all ten csf_communication_% ledgers, both partner-club tables, and the
-- three CSF calendar projection kinds. Each body's exact returned key set is
-- named on the function itself; both are contracts, not counts.
--
-- The helper saves and restores the teardown flag rather than clearing it, so
-- calling it standalone works and calling it from inside the entry point does
-- not disarm the deletes that follow.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_purge_durable_communications(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_flag text;
  v_attempts integer := 0;
  v_preference_events integer := 0;
  v_preferences integer := 0;
  v_safety_events integer := 0;
  v_safety integer := 0;
  v_quarantine integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF durable communications purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  v_previous_flag := coalesce(
    pg_catalog.current_setting('plugin_data.csf_recovery_purge_organization', true),
    ''
  );

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    p_organization_id::text,
    true
  );

  -- Child before parent: attempts reference deliveries, and consent history
  -- references the preference projection.
  DELETE FROM plugin_data.csf_communication_dispatch_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id;
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_preference_events AS decision
  WHERE decision.organization_id = p_organization_id;
  GET DIAGNOSTICS v_preference_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_broadcast_preferences AS preference
  WHERE preference.organization_id = p_organization_id;
  GET DIAGNOSTICS v_preferences = ROW_COUNT;

  -- Address-safety evidence references the safety projection, so it goes first for
  -- the same reason consent history precedes the preference projection.
  DELETE FROM plugin_data.csf_communication_address_safety_events AS safety_event
  WHERE safety_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_safety_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_address_safety AS safety
  WHERE safety.organization_id = p_organization_id;
  GET DIAGNOSTICS v_safety = ROW_COUNT;

  -- Quarantine rows may carry a NULL organization_id precisely because they could
  -- not be routed, so the claimed tenant is swept too. Otherwise an unroutable
  -- event naming a purged organization would outlive it forever.
  DELETE FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
  WHERE quarantine.organization_id = p_organization_id
    OR quarantine.claimed_organization_id = p_organization_id;
  GET DIAGNOSTICS v_quarantine = ROW_COUNT;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    v_previous_flag,
    true
  );

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'dispatchAttempts', v_attempts,
    'preferenceDecisionEvents', v_preference_events,
    'broadcastPreferences', v_preferences,
    'addressSafetyEvents', v_safety_events,
    'addressSafetyRecords', v_safety,
    'webhookQuarantine', v_quarantine
  );
END;
$$;

-- Deliberately granted to NOBODY.
--
-- A partial purge helper reachable by service_role would be a second, narrower
-- deletion boundary to defend. It is unnecessary: this function is only ever
-- called from csf_purge_recovery_foundations(), which is SECURITY DEFINER and
-- therefore executes it as the owner, for whom EXECUTE is implicit.
REVOKE ALL ON FUNCTION plugin_data.csf_purge_durable_communications(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_purge_durable_communications(uuid) IS
  'Owner-only helper that retires one organization''s durable-communications footprint, child before parent: plugin_data.csf_communication_dispatch_attempts, plugin_data.csf_communication_preference_events, plugin_data.csf_communication_broadcast_preferences, plugin_data.csf_communication_address_safety_events, plugin_data.csf_communication_address_safety, and plugin_data.csf_communication_webhook_quarantine (matched on organization_id OR claimed_organization_id, because an unroutable event carries only the claim). Returns EXACTLY these keys: organizationId, dispatchAttempts, preferenceDecisionEvents, broadcastPreferences, addressSafetyEvents, addressSafetyRecords, webhookQuarantine. Executable by nobody directly: it runs solely inside plugin_data.csf_purge_recovery_foundations(), and saves/restores the teardown flag so it composes there.';

-- The exact 20260730001001 entry point, extended. Signature, return type,
-- ordering of the original deletions, and every original result key are
-- preserved; the new tables are removed FIRST, by the helper above, and every one
-- of them is reported by name.
--
-- The result contract is exact rather than a count of keys, because a count is
-- satisfied by the wrong key. This function returns EXACTLY:
--
--   organizationId, dispatchAttempts, preferenceDecisionEvents,
--   broadcastPreferences, addressSafetyEvents, addressSafetyRecords,
--   webhookQuarantine, providerEvents, deliveries, recipientSnapshots,
--   campaigns, partnerClubTermEvents, partnerClubRepresentatives,
--   calendarProjections
--
-- The first seven are the helper's own contract, forwarded verbatim:
--
--   organizationId, dispatchAttempts, preferenceDecisionEvents,
--   broadcastPreferences, addressSafetyEvents, addressSafetyRecords,
--   webhookQuarantine
--
-- calendarProjections counts public.organization_calendar_events rows for this
-- organization whose source_kind is one of the three CSF projections --
-- 'csf_opportunity', 'csf_meeting_session', 'csf_deadline' -- and nothing else.
CREATE OR REPLACE FUNCTION plugin_data.csf_purge_recovery_foundations(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_durable jsonb;
  v_provider_events integer := 0;
  v_deliveries integer := 0;
  v_snapshots integer := 0;
  v_campaigns integer := 0;
  v_club_term_events integer := 0;
  v_representatives integer := 0;
  v_calendar_events integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    p_organization_id::text,
    true
  );

  -- Durable communications first: dispatch attempts are children of the
  -- deliveries removed below. The helper restores the flag it found, which is
  -- the flag this function just set, so the deletions that follow stay
  -- authorized.
  v_durable := plugin_data.csf_purge_durable_communications(p_organization_id);

  DELETE FROM plugin_data.csf_communication_provider_events AS provider_event
  WHERE provider_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_provider_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = p_organization_id;
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.organization_id = p_organization_id;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = p_organization_id;
  GET DIAGNOSTICS v_campaigns = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_term_events AS club_event
  WHERE club_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_club_term_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_representatives AS representative
  WHERE representative.organization_id = p_organization_id;
  GET DIAGNOSTICS v_representatives = ROW_COUNT;

  -- CSF projections only. project_schedule bindings and public.projects are
  -- deliberately out of scope: this RPC retires plugin projections, never the
  -- core scheduling records they were derived from.
  DELETE FROM public.organization_calendar_events AS calendar_event
  WHERE calendar_event.organization_id = p_organization_id
    AND calendar_event.source_kind IN (
      'csf_opportunity',
      'csf_meeting_session',
      'csf_deadline'
    );
  GET DIAGNOSTICS v_calendar_events = ROW_COUNT;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    '',
    true
  );

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'dispatchAttempts', coalesce((v_durable->>'dispatchAttempts')::integer, 0),
    'preferenceDecisionEvents',
      coalesce((v_durable->>'preferenceDecisionEvents')::integer, 0),
    'broadcastPreferences', coalesce((v_durable->>'broadcastPreferences')::integer, 0),
    'addressSafetyEvents', coalesce((v_durable->>'addressSafetyEvents')::integer, 0),
    'addressSafetyRecords', coalesce((v_durable->>'addressSafetyRecords')::integer, 0),
    'webhookQuarantine', coalesce((v_durable->>'webhookQuarantine')::integer, 0),
    'providerEvents', v_provider_events,
    'deliveries', v_deliveries,
    'recipientSnapshots', v_snapshots,
    'campaigns', v_campaigns,
    'partnerClubTermEvents', v_club_term_events,
    'partnerClubRepresentatives', v_representatives,
    'calendarProjections', v_calendar_events
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) IS
  'Service-role-only authorized teardown of one organization''s recovery-foundation and durable-communications records plus CSF calendar projections, child before parent. Delegates the durable-communications tables to plugin_data.csf_purge_durable_communications() first, then removes plugin_data.csf_communication_provider_events, plugin_data.csf_communication_deliveries, plugin_data.csf_communication_recipient_snapshots, plugin_data.csf_communication_campaigns, plugin_data.csf_partner_club_term_events, plugin_data.csf_partner_club_representatives, and finally public.organization_calendar_events restricted to source_kind IN (''csf_opportunity'', ''csf_meeting_session'', ''csf_deadline''). Returns EXACTLY these keys: organizationId, dispatchAttempts, preferenceDecisionEvents, broadcastPreferences, addressSafetyEvents, addressSafetyRecords, webhookQuarantine, providerEvents, deliveries, recipientSnapshots, campaigns, partnerClubTermEvents, partnerClubRepresentatives, calendarProjections. Never deletes public.projects or project_schedule calendar bindings.';

-- ---------------------------------------------------------------------------
-- L. Boundary documentation
--
-- The three rules a reader of this schema most needs stated outright.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE plugin_data.csf_communication_campaigns IS
  'Durable CSF email campaign record. A campaign that records content_hash is dispatch-ready: it carries the exact DVHS CSF <csf@notifications.lets-assist.com> sender, the dvhighcsf@gmail.com reply-to, an immutable subject and plain-text body, and enough identity to restart a send with no provider state at all. MANDATORY TRANSACTIONAL VERSUS BROADCAST: campaign_kind = ''transactional'' cannot be refused and carries no topic; campaign_kind = ''broadcast'' is scoped to exactly one preference topic and is refusable. Server-only: no browser role holds any privilege on this table.';

COMMENT ON TABLE plugin_data.csf_communication_recipient_snapshots IS
  'Immutable audience snapshot. A past campaign audience is reconstructed from these rows alone, never from a current mutable membership or roster join. Rows are written already-final by plugin_data.csf_snapshot_communication_recipients() and the set is closed by finalization, so a snapshot is immutable well before dispatch begins. MANDATORY TRANSACTIONAL VERSUS BROADCAST: a row with delivery_requirement = ''transactional'' can be skipped for an invalid address, a duplicate, or ineligibility, but a CHECK forbids it from ever carrying an ''unsubscribed'' or ''suppressed'' exclusion. Server-only.';

COMMENT ON TABLE plugin_data.csf_communication_deliveries IS
  'Per-recipient delivery ledger holding one monotonic truth per recipient. Queue state, leases, and per-try provider keys deliberately live in plugin_data.csf_communication_dispatch_attempts instead. OUT-OF-ORDER SAFETY: reduction is monotonic in plugin_data.csf_communication_delivery_state_rank(), and a bounce, complaint, or suppression sets terminal_locked_at so a later sent or delivered event with an earlier or missing provider time is retained as evidence and ignored for state. Server-only.';

COMMENT ON TABLE plugin_data.csf_communication_provider_events IS
  'Deduplicated, sanitized Resend webhook evidence keyed by verified Svix envelope id. SERVER-ONLY BOUNDARY AND VERIFICATION: the database does not verify signatures. The application verifies the raw request body, then calls plugin_data.csf_record_communication_provider_event() with that body''s digest and the verification metadata; the RPC refuses anything not asserted as verified. Only allowlisted, scalar, bounded operational fields may be stored, and raw email bodies and attachments are rejected at any nesting depth.';

COMMENT ON COLUMN plugin_data.csf_communication_provider_events.payload_hash IS
  'Required SHA-256 of the exact verified raw webhook request body -- the same bytes the application checked the signature over -- so evidence can be re-verified without storing message content.';

COMMENT ON COLUMN plugin_data.csf_communication_dispatch_attempts.state IS
  'Per-try outcome. UNKNOWN OUTCOME SAFETY: ''unknown_outcome'' is settled and unretryable. The lifecycle trigger refuses every transition from it back to ''queued'' or ''processing'', the enqueue guard refuses to open a new attempt behind one, and plugin_data.csf_reconcile_communication_unknown_outcome() rejects every retry-shaped resolution by name.';

COMMENT ON COLUMN plugin_data.csf_communication_broadcast_preferences.topic_key IS
  'Preference topic this decision is scoped to. MANDATORY TRANSACTIONAL VERSUS BROADCAST: the reserved key ''transactional'' is rejected by CHECK, so this table cannot express refusal of transactional mail.';

COMMENT ON COLUMN plugin_data.csf_communication_broadcast_preferences.user_id IS
  'Optional signed-in account. Accountless recipients are first-class: identity here is the normalized address, and an adviser who has never signed in still gets a durable, honored opt-out.';

COMMIT;
