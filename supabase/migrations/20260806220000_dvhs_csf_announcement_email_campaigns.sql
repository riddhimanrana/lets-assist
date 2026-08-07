-- DVHS CSF: cohort-targeted posts with optional ledger-backed email delivery.
--
-- Product contract Amendment 1 (v1.1) reinstates a narrow member posts surface:
-- cohort-scoped announcements whose publication may queue exactly one email
-- campaign through the durable communications ledger. This migration adds the
-- cohort/email linkage on both sides of that relationship and teaches the
-- campaign draft entry point to record which post a campaign was born from.
--
-- Shape decisions:
--
-- 1. `audience_cohort_id` follows the announcements table's existing
--    single-column FK convention (`term_id`), with tenant scoping enforced in
--    the same authorized entry points that already scope every announcement
--    read and write.
-- 2. The class-audience-requires-cohort CHECK is added NOT VALID on purpose.
--    Pre-v1.1 announcement rows are migration history (contract §16.2) and may
--    carry `audience = 'class'` from before a cohort column existed; they are
--    not rewritten. Every new or updated row is checked.
-- 3. `source_announcement_id` gets a partial unique index over live campaigns:
--    at most one non-cancelled campaign per post per organization. This is the
--    database-level double-send guard for ~500-recipient sends — a retried
--    "publish with email" can only ever land on the existing campaign.
-- 4. `audience_kind` gains 'cohort_members'; the audience itself is still
--    resolved and snapshotted by the authorized service chain.
-- 5. `csf_create_communication_campaign_draft` is DROPPED and recreated with a
--    trailing `p_source_announcement_id` parameter. A bare CREATE OR REPLACE
--    with a new signature would leave the old 12-argument overload behind and
--    make later calls ambiguous.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Announcements: cohort targeting and email linkage
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_announcements
  ADD COLUMN IF NOT EXISTS audience_cohort_id uuid
    REFERENCES plugin_data.csf_cohorts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_campaign_id uuid
    REFERENCES plugin_data.csf_communication_campaigns(id) ON DELETE SET NULL;

COMMENT ON COLUMN plugin_data.csf_announcements.audience_cohort_id IS
  'The single graduating-class cohort a class-audience post targets. Required for audience = ''class'' on every row written after Amendment 1; pre-v1.1 history is exempt via the NOT VALID check.';
COMMENT ON COLUMN plugin_data.csf_announcements.email_requested IS
  'Whether the publishing officer asked for this post to also be delivered as email. The request is an intent flag; delivery truth lives in the linked campaign and its ledger.';
COMMENT ON COLUMN plugin_data.csf_announcements.email_campaign_id IS
  'The durable communications campaign queued for this post, if any. Written by the authorized announcement-email entry point after the campaign draft is created.';

ALTER TABLE plugin_data.csf_announcements
  DROP CONSTRAINT IF EXISTS csf_announcements_class_audience_cohort_check;
ALTER TABLE plugin_data.csf_announcements
  ADD CONSTRAINT csf_announcements_class_audience_cohort_check
  CHECK (audience <> 'class' OR audience_cohort_id IS NOT NULL)
  NOT VALID;

CREATE INDEX IF NOT EXISTS csf_announcements_cohort_feed_idx
  ON plugin_data.csf_announcements
    (organization_id, audience_cohort_id, status, pinned DESC, published_at DESC)
  WHERE audience_cohort_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Campaigns: post provenance, live-campaign uniqueness, cohort audience
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_communication_campaigns
  ADD COLUMN IF NOT EXISTS source_announcement_id uuid
    REFERENCES plugin_data.csf_announcements(id) ON DELETE SET NULL;

COMMENT ON COLUMN plugin_data.csf_communication_campaigns.source_announcement_id IS
  'The announcement this campaign was queued from, when it was born from a post''s "also send as email" request. At most one non-cancelled campaign may exist per announcement per organization.';

CREATE UNIQUE INDEX IF NOT EXISTS
  csf_communication_campaigns_live_source_announcement_key
  ON plugin_data.csf_communication_campaigns (organization_id, source_announcement_id)
  WHERE source_announcement_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE plugin_data.csf_communication_campaigns
  DROP CONSTRAINT IF EXISTS csf_communication_campaigns_audience_kind_check;
ALTER TABLE plugin_data.csf_communication_campaigns
  ADD CONSTRAINT csf_communication_campaigns_audience_kind_check
    CHECK (
      audience_kind IS NULL
      OR audience_kind IN (
        'term_members',
        'cohort_members',
        'partner_club_representatives',
        'staff',
        'applicants',
        'custom_list'
      )
    );

-- ---------------------------------------------------------------------------
-- 3. The manage_posts staff capability
--
-- Authoring, pinning, scheduling, archiving, and emailing member posts is its
-- own capability rather than a rider on manage_opportunities: publicity roles
-- hold both, but a future custom role can post without being able to touch
-- point-bearing activities. The catalog function is the single source both
-- custom-role entry points validate against.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_role_permission_catalog()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
    'review_applications','view_applications','review_application_checks',
    'decide_applications','assign_applications','write_application_notes',
    'manage_restrictions','manage_opportunities','manage_posts','manage_partner_clubs',
    'verify_participation','process_points','verify_submissions','manage_review_periods',
    'manage_meetings',
    'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
    'manage_payment_review','import_applications','import_members','import_meetings',
    'import_partner_clubs','manage_sheet_sync','resolve_imports','manage_settings',
    'export_membership_reports','export_dues_reports','export_service_reports',
    'export_club_reports','export_reports','export_sensitive_reports','view_audit_history'
  ]::text[];
$$;

-- ---------------------------------------------------------------------------
-- 4. Campaign draft entry point learns its source post
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS plugin_data.csf_create_communication_campaign_draft(
  uuid, text, text, text, uuid, uuid, text, text, text, text, jsonb, text
);

CREATE FUNCTION plugin_data.csf_create_communication_campaign_draft(
  p_organization_id uuid,
  p_campaign_kind text,
  p_subject text,
  p_body_text text,
  p_actor_user_id uuid,
  p_term_id uuid DEFAULT NULL,
  p_audience_kind text DEFAULT NULL,
  p_body_html text DEFAULT NULL,
  p_broadcast_topic_key text DEFAULT NULL,
  p_resend_topic_id text DEFAULT NULL,
  p_tags jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL,
  p_source_announcement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The same chapter-administration capability cancellation, content
  -- finalization, and reconciliation require. csf_actor_has_permission() is
  -- tenant-scoped and admits an organization admin -- the owner/adviser seat --
  -- or an ACTIVE staff position whose role holds the capability, with the
  -- position's own date window respected. An ordinary member, an applicant, a
  -- club representative, an inactive position, and an officer of another chapter
  -- all fail it.
  c_capability constant text := 'manage_settings';
  c_sender_name constant text := 'DVHS CSF';
  c_sender_email constant text := 'csf@notifications.lets-assist.com';
  c_reply_to constant text := 'dvhighcsf@gmail.com';
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_body_text text := nullif(btrim(coalesce(p_body_text, '')), '');
  v_body_html text := nullif(btrim(coalesce(p_body_html, '')), '');
  v_topic text := nullif(btrim(coalesce(p_broadcast_topic_key, '')), '');
  v_resend_topic text := nullif(btrim(coalesce(p_resend_topic_id, '')), '');
  v_correlation text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_tags jsonb := coalesce(p_tags, '{}'::jsonb);
  v_actor_identity text;
  v_campaign_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF campaign draft requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF campaign draft must record the account that authored it.'
      USING ERRCODE = '22004';
  END IF;

  -- AUTHORIZATION BEFORE ANYTHING ELSE, and before any lock is taken.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, c_capability
  ) THEN
    RAISE EXCEPTION
      'That account does not hold the CSF staff capability required to author a communications campaign in this organization.'
      USING ERRCODE = '42501';
  END IF;

  IF p_campaign_kind IS DISTINCT FROM 'broadcast'
    AND p_campaign_kind IS DISTINCT FROM 'transactional'
  THEN
    RAISE EXCEPTION
      'A CSF campaign is exactly one of broadcast or transactional.'
      USING ERRCODE = '22023';
  END IF;

  -- BOUNDED INPUTS. The subject travels in a mail header and the body is stored
  -- and hashed; both are bounded here so a caller cannot author a row the ledger
  -- would later refuse to finalize, or push an unbounded document into evidence.
  IF v_subject IS NULL OR pg_catalog.char_length(v_subject) > 200 THEN
    RAISE EXCEPTION
      'A CSF campaign subject is 1 to 200 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_body_text IS NULL OR pg_catalog.char_length(v_body_text) > 20000 THEN
    RAISE EXCEPTION
      'A CSF campaign plain-text body is 1 to 20000 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_body_html IS NOT NULL AND pg_catalog.char_length(v_body_html) > 60000 THEN
    RAISE EXCEPTION
      'A CSF campaign HTML body is at most 60000 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION
      'A CSF campaign correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_tags) <> 'object' THEN
    RAISE EXCEPTION 'CSF campaign tags are a JSON object.'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(v_tags)) > 10 THEN
    RAISE EXCEPTION 'A CSF campaign carries at most 10 tags.'
      USING ERRCODE = '22023';
  END IF;

  -- Content-bearing metadata is refused at any depth by the table CHECK; saying
  -- so here gives the caller the reason rather than a constraint name.
  IF plugin_data.csf_jsonb_carries_raw_content(v_tags) THEN
    RAISE EXCEPTION
      'CSF campaign tags are routing metadata and may not carry message content.'
      USING ERRCODE = '22023';
  END IF;

  -- MANDATORY TRANSACTIONAL VERSUS BROADCAST, refused at the door. A
  -- transactional campaign cannot be refused by a recipient, so attaching a
  -- topic to it would offer an unsubscribe from mail the chapter is obliged to
  -- send -- and one click would then suppress it.
  IF p_campaign_kind = 'transactional' AND (v_topic IS NOT NULL OR v_resend_topic IS NOT NULL) THEN
    RAISE EXCEPTION
      'A CSF transactional campaign carries no preference topic and no provider topic; it cannot be refused.'
      USING ERRCODE = '22023';
  END IF;

  IF p_campaign_kind = 'broadcast' AND v_topic IS NULL THEN
    RAISE EXCEPTION
      'A CSF broadcast campaign is scoped to exactly one preference topic.'
      USING ERRCODE = '22004';
  END IF;

  IF p_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.id = p_term_id
      AND term.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION
      'That CSF term does not belong to this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- A campaign born from a post names a real post in the SAME organization. A
  -- post from another chapter is a foreign-key-shaped lie and is refused with
  -- the same error class as the term check above. An announcement-born campaign
  -- is member-facing mail and is therefore broadcast by definition; the
  -- transactional kind is reserved for mail the chapter is obliged to send.
  IF p_source_announcement_id IS NOT NULL THEN
    IF p_campaign_kind IS DISTINCT FROM 'broadcast' THEN
      RAISE EXCEPTION
        'A CSF campaign queued from an announcement is a broadcast.'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_announcements AS announcement
      WHERE announcement.id = p_source_announcement_id
        AND announcement.organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION
        'That CSF announcement does not belong to this organization.'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT lower(btrim(coalesce(account.email, '')))
  INTO v_actor_identity
  FROM auth.users AS account
  WHERE account.id = p_actor_user_id;

  v_actor_identity := coalesce(
    nullif(v_actor_identity, ''), 'user:' || p_actor_user_id::text
  );

  v_campaign_id := pg_catalog.gen_random_uuid();

  INSERT INTO plugin_data.csf_communication_campaigns (
    id, organization_id, campaign_kind, status, channel,
    sender_name, sender_email, reply_to_email,
    subject, body_text, body_html, term_id, audience_kind,
    broadcast_topic_key, resend_topic_id,
    source_announcement_id,
    created_by, created_by_identity, metadata,
    audience_snapshot_version, provider_idempotency_key
  ) VALUES (
    v_campaign_id, p_organization_id, p_campaign_kind, 'draft', 'email',
    -- Fixed, not accepted. See the header note.
    c_sender_name, c_sender_email, c_reply_to,
    v_subject, v_body_text, v_body_html, p_term_id, p_audience_kind,
    v_topic, v_resend_topic,
    p_source_announcement_id,
    p_actor_user_id, v_actor_identity, v_tags,
    1,
    -- Derived from the campaign coordinate, never supplied.
    'csf-campaign-' || v_campaign_id::text
  );

  RETURN pg_catalog.jsonb_build_object(
    'campaignId', v_campaign_id,
    'status', 'draft',
    'campaignKind', p_campaign_kind,
    'correlationId', v_correlation
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_communication_campaign_draft(
  uuid, text, text, text, uuid, uuid, text, text, text, text, jsonb, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_communication_campaign_draft(
  uuid, text, text, text, uuid, uuid, text, text, text, text, jsonb, text, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_communication_campaign_draft(
  uuid, text, text, text, uuid, uuid, text, text, text, text, jsonb, text, uuid
) IS
  'Creates one DRAFT CSF campaign for a single organization. Requires the tenant-scoped manage_settings capability and raises 42501 otherwise, so ordinary members, applicants, club representatives, inactive positions, and actors from another chapter cannot author. The sender identity (DVHS CSF <csf@notifications.lets-assist.com>), the dvhighcsf@gmail.com reply-to, the content and body digests, the provider idempotency key, and every lifecycle timestamp are DERIVED, never accepted: a caller can never choose an arbitrary From or Reply-To. A transactional campaign is refused a preference or provider topic; a broadcast campaign requires one. A campaign may name the announcement it was queued from; the announcement must belong to the same organization, the campaign kind must be broadcast, and a partial unique index keeps at most one live campaign per announcement. Creates a draft only -- finalization, audience closure, and dispatch remain separate authorized transitions.';

COMMIT;
