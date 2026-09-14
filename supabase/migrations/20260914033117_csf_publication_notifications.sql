-- Persist publication notices without contacting an email provider.
BEGIN;

ALTER TABLE public.notification_settings
  ADD COLUMN organization_updates boolean NOT NULL DEFAULT true;

CREATE TABLE plugin_data.csf_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('post','activity')),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_kind, source_id),
  UNIQUE (id, organization_id)
);
CREATE TABLE plugin_data.csf_publication_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','delivered','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, organization_id)
    REFERENCES plugin_data.csf_publication_events(id, organization_id) ON DELETE CASCADE,
  UNIQUE (event_id, user_id),
  CHECK ((status = 'processing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX csf_publication_notification_ready_idx
  ON plugin_data.csf_publication_notification_deliveries(next_attempt_at, id)
  WHERE status IN ('queued','processing');
ALTER TABLE plugin_data.csf_publication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_publication_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_publication_events,
  plugin_data.csf_publication_notification_deliveries FROM PUBLIC, anon, authenticated, service_role;

-- Match the reviewed ownership predicate used by permanent class-code joins.
CREATE FUNCTION plugin_data.csf_publication_account_is_owned(
  p_organization_id uuid,p_profile_id uuid,p_user_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts account
    JOIN plugin_data.csf_profiles owned
      ON owned.organization_id=account.organization_id AND owned.id=account.profile_id
    WHERE account.organization_id=p_organization_id AND account.profile_id=p_profile_id
      AND account.user_id=p_user_id AND account.status='verified' AND owned.record_status='active'
      AND (account.connection_basis='officer_decision'
        OR (account.connection_basis='verified_email'
          AND owned.source_summary->>'createdBy'='permanent_class_code'
          AND owned.source_summary->>'accountOwnerUserId'=p_user_id::text))
  );
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_account_is_owned(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_account_is_owned(uuid,uuid,uuid) TO postgres;

-- This helper grants no access. It intersects current source visibility with
-- active organization membership and, where needed, a verified class link.
CREATE FUNCTION plugin_data.csf_publication_recipient_allowed(
  p_organization_id uuid, p_source_kind text, p_source_id uuid, p_user_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_audience text;
  v_cohort_id uuid;
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access WHERE organization_id=p_organization_id
    AND plugin_key='dvhs-csf' AND enabled AND is_accessible) THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.organization_members
    WHERE organization_id=p_organization_id AND user_id=p_user_id AND status='active';
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_source_kind='post' THEN
    SELECT audience, audience_cohort_id INTO v_audience, v_cohort_id
    FROM plugin_data.csf_announcements
    WHERE organization_id=p_organization_id AND id=p_source_id AND status='published'
      AND (expires_at IS NULL OR expires_at > now());
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_audience='officers' THEN
      RETURN v_role IN ('admin','staff') AND coalesce(plugin_data.csf_actor_has_permission(p_organization_id,p_user_id,'manage_posts'),false);
    END IF;
    IF v_audience IN ('public','members') THEN RETURN true; END IF;
    IF v_audience <> 'class' OR v_cohort_id IS NULL THEN RETURN false; END IF;
  ELSIF p_source_kind='activity' THEN
    SELECT cohort_id INTO v_cohort_id FROM plugin_data.csf_opportunities
    WHERE organization_id=p_organization_id AND id=p_source_id AND status='published';
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_cohort_id IS NULL OR (v_role IN ('admin','staff') AND
      plugin_data.csf_actor_has_permission(p_organization_id,p_user_id,'manage_opportunities')) THEN RETURN true; END IF;
  ELSE RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts a
    JOIN plugin_data.csf_profiles p ON p.id=a.profile_id AND p.organization_id=a.organization_id
    WHERE a.organization_id=p_organization_id AND a.user_id=p_user_id
      AND plugin_data.csf_publication_account_is_owned(p_organization_id,a.profile_id,p_user_id)
      AND (v_cohort_id IS NULL OR EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_cohort_memberships c
        WHERE c.organization_id=p_organization_id AND c.profile_id=a.profile_id
          AND c.cohort_id=v_cohort_id AND c.status='active'
          AND 1=(SELECT count(*) FROM plugin_data.csf_profile_cohort_memberships active_cohort
            WHERE active_cohort.organization_id=p_organization_id
              AND active_cohort.profile_id=a.profile_id AND active_cohort.status='active')))
  );
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid) TO postgres;

CREATE FUNCTION plugin_data.csf_record_publication_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'csf_announcements' THEN 'post' ELSE 'activity' END;
  v_event_id uuid;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status <> 'draft' THEN RETURN NEW; END IF;
  INSERT INTO plugin_data.csf_publication_events(organization_id,source_kind,source_id)
  VALUES (NEW.organization_id,v_kind,NEW.id)
  ON CONFLICT (organization_id,source_kind,source_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO plugin_data.csf_publication_notification_deliveries(organization_id,event_id,user_id)
  SELECT NEW.organization_id,v_event_id,m.user_id FROM public.organization_members m
  WHERE m.organization_id=NEW.organization_id AND m.status='active'
    AND plugin_data.csf_publication_recipient_allowed(NEW.organization_id,v_kind,NEW.id,m.user_id)
  ON CONFLICT (event_id,user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_publication_notifications()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_publication_notifications() TO postgres;
CREATE TRIGGER csf_announcements_publication_notifications
  AFTER INSERT OR UPDATE OF status ON plugin_data.csf_announcements
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_record_publication_notifications();
CREATE TRIGGER csf_activities_publication_notifications
  AFTER INSERT OR UPDATE OF status ON plugin_data.csf_opportunities
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_record_publication_notifications();

CREATE FUNCTION plugin_data.csf_claim_publication_notifications(p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_claims jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Choose a notification batch between 1 and 50.' USING ERRCODE='22023';
  END IF;
  WITH candidates AS (
    SELECT id FROM plugin_data.csf_publication_notification_deliveries
    WHERE (status='queued' AND next_attempt_at<=now())
      OR (status='processing' AND lease_expires_at<=now())
    ORDER BY next_attempt_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE plugin_data.csf_publication_notification_deliveries d
    SET status='processing',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',
      attempts=d.attempts+1
    FROM candidates c WHERE d.id=c.id
    RETURNING d.id,d.organization_id,d.lease_token
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'organizationId',organization_id,'leaseToken',lease_token)),'[]'::jsonb)
    INTO v_claims FROM claimed;
  RETURN v_claims;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_publication_notifications(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_publication_notifications(integer) TO postgres,service_role;

CREATE FUNCTION plugin_data.csf_authorize_publication_notification(
  p_organization_id uuid,p_delivery_id uuid,p_lease_token uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_delivery plugin_data.csf_publication_notification_deliveries%ROWTYPE;
  v_event plugin_data.csf_publication_events%ROWTYPE;
  v_allowed boolean;
  v_tab text := 'csf-home';
BEGIN
  SELECT * INTO v_delivery FROM plugin_data.csf_publication_notification_deliveries
  WHERE organization_id=p_organization_id AND id=p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'processing' OR v_delivery.lease_token IS DISTINCT FROM p_lease_token
    OR v_delivery.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'Notification lease is not current.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT v_event FROM plugin_data.csf_publication_events
    WHERE organization_id=p_organization_id AND id=v_delivery.event_id;
  v_allowed := plugin_data.csf_publication_recipient_allowed(p_organization_id,v_event.source_kind,v_event.source_id,v_delivery.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.notification_settings
      WHERE user_id=v_delivery.user_id AND organization_updates=false);
  IF NOT v_allowed THEN
    UPDATE plugin_data.csf_publication_notification_deliveries
    SET status='skipped',completed_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=v_delivery.id;
    RETURN jsonb_build_object('authorized',false);
  END IF;
  IF (v_event.source_kind='post' AND EXISTS (SELECT 1 FROM plugin_data.csf_announcements
      WHERE organization_id=p_organization_id AND id=v_event.source_id AND audience='officers'))
    OR (v_event.source_kind='activity' AND EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id=p_organization_id AND user_id=v_delivery.user_id AND status='active' AND role IN ('admin','staff')) AND
      plugin_data.csf_actor_has_permission(p_organization_id,v_delivery.user_id,'manage_opportunities')) THEN
    v_tab := 'csf-overview';
  END IF;
  RETURN jsonb_build_object('authorized',true,'userId',v_delivery.user_id,
    'organizationId',p_organization_id,'eventId',v_event.id,'sourceKind',v_event.source_kind,
    'sourceId',v_event.source_id,'actionUrl','/organization/'||p_organization_id::text||'?tab='||v_tab,
    'dedupeKey','csf-publication:'||v_event.id::text);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) TO postgres,service_role;

CREATE FUNCTION plugin_data.csf_finish_publication_notification(
  p_organization_id uuid,p_delivery_id uuid,p_lease_token uuid,p_outcome text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_delivery plugin_data.csf_publication_notification_deliveries%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('delivered','skipped','retryable') OR p_outcome IS NULL THEN
    RAISE EXCEPTION 'Invalid notification outcome.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_delivery FROM plugin_data.csf_publication_notification_deliveries
  WHERE organization_id=p_organization_id AND id=p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'processing' OR v_delivery.lease_token IS DISTINCT FROM p_lease_token
    OR v_delivery.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'Notification lease is not current.' USING ERRCODE='40001';
  END IF;
  UPDATE plugin_data.csf_publication_notification_deliveries
  SET status=CASE WHEN p_outcome='retryable' THEN 'queued' ELSE p_outcome END,
    completed_at=CASE WHEN p_outcome='retryable' THEN NULL ELSE now() END,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*greatest(1,v_delivery.attempts))),
    lease_token=NULL,lease_expires_at=NULL
  WHERE id=v_delivery.id;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text) TO postgres,service_role;

-- Account preferences supplement chapter consent for publication broadcasts.
-- Missing account links never become inferred ownership through an email match.
CREATE FUNCTION plugin_data.csf_publication_email_recipient_allowed(p_organization_id uuid,p_snapshot_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  c plugin_data.csf_communication_campaigns%ROWTYPE;
  p plugin_data.csf_profiles%ROWTYPE;
  v_user_id uuid;
  v_source_kind text;
  v_source_id uuid;
  v_current_email text;
  v_source_term uuid;
  v_source_cohort uuid;
  v_source_audience text;
BEGIN
  SELECT * INTO STRICT s FROM plugin_data.csf_communication_recipient_snapshots
    WHERE organization_id=p_organization_id AND id=p_snapshot_id;
  SELECT * INTO STRICT c FROM plugin_data.csf_communication_campaigns
    WHERE organization_id=p_organization_id AND id=s.campaign_id;
  IF s.delivery_requirement IS DISTINCT FROM 'broadcast' OR
    (c.source_announcement_id IS NULL AND c.source_activity_id IS NULL) THEN RETURN true; END IF;
  v_source_kind := CASE WHEN c.source_announcement_id IS NOT NULL THEN 'post' ELSE 'activity' END;
  v_source_id := coalesce(c.source_announcement_id,c.source_activity_id);
  IF v_source_kind='post' THEN
    SELECT term_id,audience_cohort_id,audience INTO v_source_term,v_source_cohort,v_source_audience
      FROM plugin_data.csf_announcements WHERE organization_id=p_organization_id AND id=v_source_id
      AND status='published' AND (expires_at IS NULL OR expires_at>now());
    IF NOT FOUND OR v_source_audience='public' OR c.audience_kind IS DISTINCT FROM
      (CASE v_source_audience WHEN 'members' THEN 'term_members' WHEN 'class' THEN 'cohort_members' WHEN 'officers' THEN 'staff' END)
      THEN RETURN false; END IF;
  ELSE
    SELECT term_id,cohort_id INTO v_source_term,v_source_cohort FROM plugin_data.csf_opportunities
      WHERE organization_id=p_organization_id AND id=v_source_id AND status='published';
    IF NOT FOUND OR c.audience_kind IS DISTINCT FROM
      (CASE WHEN v_source_cohort IS NULL THEN 'term_members' ELSE 'cohort_members' END) THEN RETURN false; END IF;
  END IF;
  IF ((v_source_kind='activity' OR v_source_term IS NOT NULL) AND c.term_id IS DISTINCT FROM v_source_term)
    OR c.audience_cohort_id IS DISTINCT FROM v_source_cohort THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access WHERE organization_id=p_organization_id
    AND plugin_key='dvhs-csf' AND enabled AND is_accessible) THEN RETURN false; END IF;
  v_user_id := s.user_id;
  IF s.profile_id IS NOT NULL THEN
    SELECT * INTO p FROM plugin_data.csf_profiles WHERE organization_id=p_organization_id
      AND id=s.profile_id AND record_status='active';
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_user_id IS NOT NULL AND NOT
      plugin_data.csf_publication_account_is_owned(p_organization_id,s.profile_id,v_user_id) THEN
      RETURN false;
    END IF;
    IF v_user_id IS NULL THEN
      SELECT user_id INTO v_user_id FROM plugin_data.csf_profile_accounts
        WHERE organization_id=p_organization_id AND profile_id=s.profile_id
          AND plugin_data.csf_publication_account_is_owned(p_organization_id,s.profile_id,user_id)
        ORDER BY is_primary DESC,linked_at DESC,id LIMIT 1;
    END IF;
    v_current_email := CASE
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.personal_email)))
        THEN lower(btrim(p.personal_email))
      WHEN plugin_data.csf_communication_email_is_storable(lower(btrim(p.school_email)))
        THEN lower(btrim(p.school_email))
      ELSE NULL END;
  END IF;
  IF c.audience_kind IN ('term_members','cohort_members') THEN
    IF s.profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM plugin_data.csf_term_memberships
      WHERE organization_id=p_organization_id AND profile_id=s.profile_id AND term_id=c.term_id
        AND status IN ('accepted','active','completed')) THEN RETURN false; END IF;
    IF c.audience_kind='cohort_members' AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_profile_cohort_memberships
      WHERE organization_id=p_organization_id AND profile_id=s.profile_id AND cohort_id=c.audience_cohort_id AND status='active') THEN RETURN false; END IF;
  ELSIF c.audience_kind='staff' THEN
    IF v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id=p_organization_id AND user_id=v_user_id AND status='active' AND role IN ('admin','staff'))
      OR plugin_data.csf_actor_has_permission(p_organization_id,v_user_id,'manage_posts') IS DISTINCT FROM true THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id
      AND user_id=v_user_id AND status='active') THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM public.notification_settings WHERE user_id=v_user_id
      AND (email_notifications=false OR organization_updates=false)) THEN RETURN false; END IF;
    IF v_current_email IS NULL THEN
      SELECT lower(btrim(email)) INTO v_current_email FROM public.profiles WHERE id=v_user_id;
    END IF;
  END IF;
  RETURN v_current_email IS NOT NULL AND v_current_email=s.normalized_recipient_email;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid) TO postgres;

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

  IF (v_decision->>'authorized')::boolean AND NOT
    plugin_data.csf_publication_email_recipient_allowed(p_organization_id,v_snapshot.id) THEN
    v_decision := jsonb_build_object('authorized',false,'blockedBy','publication_recipient',
      'decision','suppressed_publication_recipient','reason','recipient_or_preferences_changed');
  END IF;

  IF NOT (v_decision->>'authorized')::boolean THEN
    v_detail := CASE v_decision->>'blockedBy'
      WHEN 'address_safety' THEN
        'provider reported this address unsafe: ' || (v_decision->>'reason')
      WHEN 'publication_recipient' THEN 'publication recipient or account preferences no longer allow delivery'
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
  TO postgres,service_role;

COMMENT ON FUNCTION plugin_data.csf_authorize_communication_dispatch(uuid, uuid, text, text) IS
  'The immediately-before-dispatch gate. A lease can last 1800 seconds, so this re-checks current broadcast consent AND current address safety, settles refused work as suppressed, and otherwise returns an internal coordinate plus the EXACT sendable providerPayload -- from, to, replyTo, subject, bodies, tag array, headers, topicId, transport type, and idempotency key -- whose digest the ledger already stored. The worker adapter forwards providerPayload unchanged, so the digest describes what the recipient actually receives.';


COMMIT;
