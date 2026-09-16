-- Say what happened, and link to the thing it happened to.
--
-- The publication queue already delivered a notice per recipient with a lease,
-- a retry schedule and a dedupe key. What it could not do was say WHICH post,
-- which activity, or that anything on one member's own record had moved at all,
-- so every notice read "New CSF post" and every button opened a general tab.
--
-- This extends that one queue rather than adding a second. The same deliveries
-- table, the same claim/authorize/finish contract and the same worker carry two
-- further kinds, a member's point submission and a member's profile, whose
-- audience is exactly one person, and the authorization step now publishes the
-- few words a notice may quote alongside the coordinate it may open.
--
-- What is deliberately not here:
--   * No officer review note, no proof file, no points figure and no identity
--     field is ever returned. A profile notice returns no subject at all.
--   * Nothing triggers off application review, term decision staging, decision
--     sync or decision release. Those tables have no trigger in this file, and
--     a staged decision is not a member-visible fact until it is released.
--   * A recipient is never inferred from an email match. Personal notices reach
--     the owning account through the same ownership predicate permanent
--     class-code joins use, and no other way.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One event table, now able to describe a recurrence.
-- ---------------------------------------------------------------------------
-- A post is published once, so its identity was (organization, kind, source).
-- A submission is reviewed, corrected and reviewed again, and a profile can be
-- amended more than once, so the same source legitimately produces more than
-- one event. `event_key` is what distinguishes them; the existing rows take the
-- empty string and keep their exact previous identity.
ALTER TABLE plugin_data.csf_publication_events
  ADD COLUMN event_key text NOT NULL DEFAULT '';

-- Both constraints being replaced were named by Postgres, and the unique one is
-- long enough to have been truncated. They are found by their DEFINITION rather
-- than by a spelled-out name, so this cannot half-apply against a database
-- whose generated name differs by a character.
DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO STRICT v_name FROM pg_constraint
  WHERE conrelid = 'plugin_data.csf_publication_events'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, source_kind, source_id)';
  EXECUTE format('ALTER TABLE plugin_data.csf_publication_events DROP CONSTRAINT %I', v_name);

  SELECT conname INTO STRICT v_name FROM pg_constraint
  WHERE conrelid = 'plugin_data.csf_publication_events'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%source_kind%'
    AND pg_get_constraintdef(oid) LIKE '%post%';
  EXECUTE format('ALTER TABLE plugin_data.csf_publication_events DROP CONSTRAINT %I', v_name);
END;
$$;

ALTER TABLE plugin_data.csf_publication_events
  ADD CONSTRAINT csf_publication_events_coordinate_key
    UNIQUE (organization_id, source_kind, source_id, event_key);

ALTER TABLE plugin_data.csf_publication_events
  ADD CONSTRAINT csf_publication_events_source_kind_check
    CHECK (source_kind IN ('post', 'activity', 'point_submission', 'profile'));

-- A chapter-wide publication happens once and must stay that way. Only the two
-- personal kinds may carry a recurrence key.
ALTER TABLE plugin_data.csf_publication_events
  ADD CONSTRAINT csf_publication_events_recurrence_check
    CHECK (
      (source_kind IN ('post', 'activity') AND event_key = '')
      OR (source_kind IN ('point_submission', 'profile') AND event_key <> '')
    );

COMMENT ON COLUMN plugin_data.csf_publication_events.event_key IS
  'Distinguishes repeat notices about the same record. Empty for a post or an activity, which are published exactly once; a status-and-hour bucket for the personal kinds, which coalesces a burst of officer edits into one notice per member per hour.';

-- ---------------------------------------------------------------------------
-- The address a member has actually proven they control.
-- ---------------------------------------------------------------------------
-- public.profiles.email is a mirror. It can lag a change of address, and it is
-- not evidence that the address was ever confirmed, so mailing from it can send
-- a member's record to an address they no longer hold or never held. The
-- authentication record is the authority: the address must be present, must be
-- confirmed, and the mirror must not disagree with it. A divergence is treated
-- as unusable rather than resolved in either direction, because nothing here
-- can tell which of the two is the stale one.
CREATE FUNCTION plugin_data.csf_verified_account_email(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.lower(pg_catalog.btrim(account.email))
  FROM auth.users AS account
  LEFT JOIN public.profiles AS mirror ON mirror.id = account.id
  WHERE account.id = p_user_id
    AND account.email_confirmed_at IS NOT NULL
    AND nullif(pg_catalog.btrim(coalesce(account.email, '')), '') IS NOT NULL
    AND (
      mirror.id IS NULL
      OR pg_catalog.lower(pg_catalog.btrim(coalesce(mirror.email, '')))
         = pg_catalog.lower(pg_catalog.btrim(account.email))
    );
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_verified_account_email(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_verified_account_email(uuid) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_verified_account_email(uuid) IS
  'The confirmed authentication address for one account, or null. Null when the account has no address, when it was never confirmed, or when the public.profiles mirror disagrees with it. Never falls back to the mirror.';

-- ---------------------------------------------------------------------------
-- 2. The owning account of a profile, and nobody else.
-- ---------------------------------------------------------------------------
-- A personal notice has exactly one legitimate recipient. This returns it, or
-- nothing. It grants no access: it reuses the reviewed ownership predicate, so
-- an unverified link, a deactivated record, or a chapter whose plugin access
-- was withdrawn resolves to no recipient at all.
CREATE FUNCTION plugin_data.csf_publication_profile_owner(
  p_organization_id uuid, p_profile_id uuid
) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT account.user_id
  FROM plugin_data.csf_profile_accounts account
  JOIN public.organization_members member
    ON member.organization_id = account.organization_id
   AND member.user_id = account.user_id
   AND member.status = 'active'
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = p_profile_id
    AND account.status = 'verified'
    AND plugin_data.csf_publication_account_is_owned(
          p_organization_id, p_profile_id, account.user_id)
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_profile_owner(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_profile_owner(uuid, uuid) TO postgres;

-- ---------------------------------------------------------------------------
-- 3. Recipient authorization, extended to the personal kinds.
-- ---------------------------------------------------------------------------
-- The post and activity branches are unchanged. The two new branches admit one
-- user: the owner of the record the notice is about. An officer who can read
-- every submission in the chapter is NOT a recipient of somebody else's notice.
CREATE OR REPLACE FUNCTION plugin_data.csf_publication_recipient_allowed(
  p_organization_id uuid, p_source_kind text, p_source_id uuid, p_user_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_audience text;
  v_cohort_id uuid;
  v_role text;
  v_profile_id uuid;
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
  ELSIF p_source_kind='point_submission' THEN
    -- The submission still has to exist, still has to belong to this chapter,
    -- and still has to belong to a live record. A withdrawn or draft claim is
    -- the member's own unfinished work and is never announced back to them.
    SELECT submission.profile_id INTO v_profile_id
    FROM plugin_data.csf_point_submissions submission
    JOIN plugin_data.csf_profiles profile
      ON profile.organization_id = submission.organization_id
     AND profile.id = submission.profile_id
     AND profile.record_status = 'active'
    WHERE submission.organization_id = p_organization_id
      AND submission.id = p_source_id
      AND submission.status IN ('approved','rejected','needs_action','duplicate');
    IF NOT FOUND THEN RETURN false; END IF;
    RETURN plugin_data.csf_publication_profile_owner(p_organization_id, v_profile_id) = p_user_id;
  ELSIF p_source_kind='profile' THEN
    IF NOT EXISTS (SELECT 1 FROM plugin_data.csf_profiles
      WHERE organization_id=p_organization_id AND id=p_source_id AND record_status='active')
      THEN RETURN false; END IF;
    -- Current-term membership, which is the same audience restriction chapter
    -- mail already respects. It also bounds what a historical correction can
    -- do: reconciling records for members who have since left the chapter
    -- announces nothing to them, because they are no longer an audience.
    IF NOT EXISTS (
      SELECT 1 FROM plugin_data.csf_term_memberships membership
      JOIN plugin_data.csf_terms term
        ON term.organization_id = membership.organization_id
       AND term.id = membership.term_id
       AND term.is_current
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = p_source_id
        AND membership.status IN ('accepted','active','completed')
    ) THEN RETURN false; END IF;
    RETURN plugin_data.csf_publication_profile_owner(p_organization_id, p_source_id) = p_user_id;
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

-- ---------------------------------------------------------------------------
-- 4. The publication recorder, on the new conflict target.
-- ---------------------------------------------------------------------------
-- Behaviour is unchanged. Only the conflict target moves, because the unique
-- constraint it names now includes the recurrence key.
CREATE OR REPLACE FUNCTION plugin_data.csf_record_publication_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text := CASE TG_TABLE_NAME WHEN 'csf_announcements' THEN 'post' ELSE 'activity' END;
  v_event_id uuid;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status <> 'draft' THEN RETURN NEW; END IF;
  INSERT INTO plugin_data.csf_publication_events(organization_id,source_kind,source_id,event_key)
  VALUES (NEW.organization_id,v_kind,NEW.id,'')
  ON CONFLICT (organization_id,source_kind,source_id,event_key) DO NOTHING RETURNING id INTO v_event_id;
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

-- ---------------------------------------------------------------------------
-- 5. Personal events: one recipient, coalesced against bulk edits.
-- ---------------------------------------------------------------------------
-- The bulk-correction problem. An officer fixing a column across a class can
-- touch a hundred rows in one statement. A hundred members each receiving one
-- notice is correct and is what happens here. One member receiving a hundred
-- is not, so the event key buckets by hour: further edits to the same record in
-- the same hour find the existing event and add nothing. The member reads the
-- current state when they open the link, so a coalesced burst loses nothing.
CREATE FUNCTION plugin_data.csf_publication_personal_event_key(p_discriminator text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_discriminator || ':' ||
    pg_catalog.to_char(pg_catalog.date_trunc('hour', pg_catalog.now()), 'YYYYMMDDHH24');
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_personal_event_key(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_personal_event_key(text) TO postgres;

-- The backfill switch. An import or a historical reconciliation rewrites rows
-- that are years old; announcing them would mail a chapter about corrections to
-- records nobody is waiting on. An import path sets this for its transaction and
-- the notice is not recorded at all -- not queued and suppressed later, never
-- created, so there is no row for a future change of mind to release.
--
-- It is read with the missing_ok form, so an ordinary officer edit -- which
-- never sets it -- is unaffected.
CREATE FUNCTION plugin_data.csf_publication_notices_suppressed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    pg_catalog.current_setting('app.csf_suppress_notices', true), '') = 'on';
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_notices_suppressed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_notices_suppressed() TO postgres;

COMMENT ON FUNCTION plugin_data.csf_publication_notices_suppressed() IS
  'True while a bulk import or historical reconciliation has set app.csf_suppress_notices for its transaction. Personal notices are then not recorded at all, which is what stops a backfill of old corrections from becoming a mail storm.';

-- The entry point a bulk lane calls to switch notices off for its own
-- transaction. It must be called inside the transaction that performs the
-- writes, because the setting is transaction-local; a separate call would not
-- reach the trigger.
CREATE FUNCTION plugin_data.csf_suppress_publication_notices()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.set_config('app.csf_suppress_notices', 'on', true);
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_suppress_publication_notices()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_suppress_publication_notices()
  TO postgres, service_role;

COMMENT ON FUNCTION plugin_data.csf_suppress_publication_notices() IS
  'Switches personal notices off for the current transaction. An import, retention or history lane calls this before its writes so a backfill of old corrections records no notices. Transaction-local by design: it cannot be set once and left on.';

CREATE FUNCTION plugin_data.csf_record_personal_notification(
  p_organization_id uuid, p_source_kind text, p_source_id uuid, p_profile_id uuid,
  p_discriminator text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event_id uuid;
  v_user_id uuid;
BEGIN
  IF plugin_data.csf_publication_notices_suppressed() THEN RETURN; END IF;
  v_user_id := plugin_data.csf_publication_profile_owner(p_organization_id, p_profile_id);
  -- No connected account is not an error. The change is already durable, and
  -- the member will read it when they connect.
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF NOT plugin_data.csf_publication_recipient_allowed(
    p_organization_id, p_source_kind, p_source_id, v_user_id) THEN RETURN; END IF;

  INSERT INTO plugin_data.csf_publication_events(organization_id,source_kind,source_id,event_key)
  VALUES (p_organization_id, p_source_kind, p_source_id,
          plugin_data.csf_publication_personal_event_key(p_discriminator))
  ON CONFLICT (organization_id,source_kind,source_id,event_key) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN; END IF;

  INSERT INTO plugin_data.csf_publication_notification_deliveries(organization_id,event_id,user_id)
  VALUES (p_organization_id, v_event_id, v_user_id)
  ON CONFLICT (event_id,user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_personal_notification(uuid,text,uuid,uuid,text) TO postgres;

-- A submission notice fires on the OUTCOME changing, never on the member's own
-- submit or withdraw, and never on an officer editing a note in place.
CREATE FUNCTION plugin_data.csf_record_point_submission_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected','needs_action','duplicate') THEN RETURN NEW; END IF;
  PERFORM plugin_data.csf_record_personal_notification(
    NEW.organization_id, 'point_submission', NEW.id, NEW.profile_id, NEW.status);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_point_submission_notification()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_point_submission_notification() TO postgres;

CREATE TRIGGER csf_point_submissions_personal_notifications
  AFTER UPDATE OF status ON plugin_data.csf_point_submissions
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_record_point_submission_notification();

-- A profile notice fires when a field the member can see on their own record
-- actually changed value. A no-op write, a normalization-only rewrite, or a
-- touch of an internal column announces nothing.
CREATE FUNCTION plugin_data.csf_record_profile_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.record_status <> 'active' THEN RETURN NEW; END IF;
  IF (NEW.first_name, NEW.middle_name, NEW.last_name, NEW.preferred_name,
      NEW.nicknames, NEW.school_email, NEW.personal_email)
     IS NOT DISTINCT FROM
     (OLD.first_name, OLD.middle_name, OLD.last_name, OLD.preferred_name,
      OLD.nicknames, OLD.school_email, OLD.personal_email)
  THEN RETURN NEW; END IF;
  PERFORM plugin_data.csf_record_personal_notification(
    NEW.organization_id, 'profile', NEW.id, NEW.id, 'details');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_record_profile_notification()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_profile_notification() TO postgres;

CREATE TRIGGER csf_profiles_personal_notifications
  AFTER UPDATE OF first_name, middle_name, last_name, preferred_name,
    nicknames, school_email, personal_email
  ON plugin_data.csf_profiles
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_record_profile_notification();

-- ---------------------------------------------------------------------------
-- 6. Authorization: the coordinate, plus the few words a notice may quote.
-- ---------------------------------------------------------------------------
-- The previously returned fields are unchanged, so a worker that has not been
-- updated keeps working. Three are added:
--
--   chapterName       the organization's own public name.
--   authorizedSubject the object's OWN title, for the kinds where the title is
--                     the thing being announced. NULL for a profile, always.
--   recipientEmail    the address this one member may be mailed at, for the
--                     personal kinds only, and only when their preferences
--                     still allow it. NULL for a post or an activity, whose
--                     mail is the broadcast campaign's to send.
CREATE OR REPLACE FUNCTION plugin_data.csf_authorize_publication_notification(
  p_organization_id uuid,p_delivery_id uuid,p_lease_token uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_delivery plugin_data.csf_publication_notification_deliveries%ROWTYPE;
  v_event plugin_data.csf_publication_events%ROWTYPE;
  v_allowed boolean;
  v_tab text := 'csf-home';
  v_param text;
  v_extra text := '';
  v_subject text;
  v_chapter text;
  v_email text;
  v_personal boolean;
BEGIN
  SELECT * INTO v_delivery FROM plugin_data.csf_publication_notification_deliveries
  WHERE organization_id=p_organization_id AND id=p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'processing' OR v_delivery.lease_token IS DISTINCT FROM p_lease_token
    OR v_delivery.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'Notification lease is not current.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO STRICT v_event FROM plugin_data.csf_publication_events
    WHERE organization_id=p_organization_id AND id=v_delivery.event_id;
  v_personal := v_event.source_kind IN ('point_submission','profile');
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

  SELECT nullif(btrim(name),'') INTO v_chapter FROM public.organizations WHERE id=p_organization_id;

  -- The subject, read from the object's own title column and nothing else. The
  -- recipient check above already established that this member may open the
  -- object, so naming it tells them nothing they could not read by following
  -- the link. A profile deliberately falls through with NULL.
  IF v_event.source_kind='post' THEN
    -- The feed. There is no per-post parameter on the surface, so a notice
    -- links to where posts are read rather than to a parameter nothing honours.
    v_tab := CASE WHEN v_tab='csf-overview' THEN 'csf-overview' ELSE 'csf-home' END;
    SELECT nullif(btrim(title),'') INTO v_subject FROM plugin_data.csf_announcements
      WHERE organization_id=p_organization_id AND id=v_event.source_id;
  ELSIF v_event.source_kind='activity' THEN
    -- Activities render on their own tab, and the officer view of that tab is
    -- the Service tab, which needs csf_service before it renders one activity.
    v_extra := CASE WHEN v_tab='csf-overview' THEN '&csf_service=opportunities' ELSE '' END;
    v_tab := 'csf-activities';
    v_param := 'csf_activity';
    SELECT nullif(btrim(title),'') INTO v_subject FROM plugin_data.csf_opportunities
      WHERE organization_id=p_organization_id AND id=v_event.source_id;
  ELSIF v_event.source_kind='point_submission' THEN
    v_tab := 'csf-submissions';
    v_param := 'csf_submission';
    -- The ACTIVITY's title, not the submission's description: a description is
    -- the member's own free text and an officer may have amended it. The title
    -- of the activity they claimed against is a chapter-published string.
    SELECT nullif(btrim(activity.title),'') INTO v_subject
    FROM plugin_data.csf_point_submissions submission
    LEFT JOIN plugin_data.csf_opportunities activity
      ON activity.organization_id = submission.organization_id
     AND activity.id = submission.opportunity_id
    WHERE submission.organization_id=p_organization_id AND submission.id=v_event.source_id;
  ELSIF v_event.source_kind='profile' THEN
    -- My CSF, and deliberately WITHOUT a parameter. csf_profile selects a row
    -- in the staff member directory; putting a profile id in a member's link
    -- would not open and would read like a link to somebody's record.
    v_tab := 'csf-profile';
    v_param := NULL;
    v_subject := NULL;
  END IF;

  -- The address. Personal kinds only, and only while the account still wants
  -- mail at all. It is the confirmed authentication address, never a chapter
  -- roster column and never the profiles mirror, so neither a stale imported
  -- value nor an unconfirmed one can become a destination.
  IF v_personal AND NOT EXISTS (SELECT 1 FROM public.notification_settings
    WHERE user_id=v_delivery.user_id AND email_notifications=false) THEN
    v_email := plugin_data.csf_verified_account_email(v_delivery.user_id);
  END IF;

  RETURN jsonb_build_object('authorized',true,'userId',v_delivery.user_id,
    'organizationId',p_organization_id,'eventId',v_event.id,'sourceKind',v_event.source_kind,
    'sourceId',v_event.source_id,
    'actionUrl','/organization/'||p_organization_id::text||'?tab='||v_tab||v_extra||
      CASE WHEN v_param IS NULL THEN '' ELSE '&'||v_param||'='||v_event.source_id::text END,
    -- Carried so the frozen audience snapshot records which chapter record the
    -- message was about. It is never used to look a recipient up.
    'profileId',CASE WHEN v_event.source_kind='profile' THEN v_event.source_id
      WHEN v_event.source_kind='point_submission' THEN
        (SELECT profile_id FROM plugin_data.csf_point_submissions
         WHERE organization_id=p_organization_id AND id=v_event.source_id)
      ELSE NULL END,
    'dedupeKey','csf-publication:'||v_event.id::text,
    'chapterName',v_chapter,
    'authorizedSubject',v_subject,
    'recipientEmail',v_email);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) TO postgres,service_role;

COMMENT ON FUNCTION plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid) IS
  'Re-checks one leased delivery against current visibility and preferences, then returns the coordinate the worker may open plus the few words it may quote: the chapter name, the object''s own title where the title is the thing being announced, and -- for a personal notice only -- the address this member may be mailed at. Never returns a review note, a proof, a points figure or an identity field.';

-- ---------------------------------------------------------------------------
-- 7. Mail for a personal notice, carried by the reviewed dispatch ledger.
-- ---------------------------------------------------------------------------
-- The notification worker must not send mail itself. It settles a delivery by
-- writing a receipt after the work is done, so a crash, a lost receipt or an
-- expired lease between "provider accepted" and "delivery settled" would leave
-- a row that is re-claimed and sent again. A provider idempotency key does not
-- close that window: it expires, and a lease recovered after it expires
-- presents a key the provider no longer recognises.
--
-- So a personal notice is handed to the ledger that already owns sending. That
-- ledger holds the lease ACROSS the provider call, records the provider
-- receipt, settles the outcome immutably, and treats an unknown answer as a
-- terminal hold that no later attempt may reopen. The hand-off itself writes
-- only to our own tables and is idempotent per event, which is what makes
-- replaying it provably safe.
ALTER TABLE plugin_data.csf_communication_campaigns
  ADD COLUMN source_publication_event_id uuid;

ALTER TABLE plugin_data.csf_communication_campaigns
  ADD CONSTRAINT csf_communication_campaigns_source_notice_organization_fkey
    FOREIGN KEY (source_publication_event_id, organization_id)
    REFERENCES plugin_data.csf_publication_events (id, organization_id)
    ON DELETE RESTRICT;

-- The existing check named only the two broadcast sources.
ALTER TABLE plugin_data.csf_communication_campaigns
  DROP CONSTRAINT csf_communication_campaigns_one_source_check;
ALTER TABLE plugin_data.csf_communication_campaigns
  ADD CONSTRAINT csf_communication_campaigns_one_source_check
    CHECK (
      pg_catalog.num_nonnulls(
        source_announcement_id, source_activity_id, source_publication_event_id
      ) <= 1
    );

-- One live campaign per notice. This index is the whole de-duplication
-- guarantee for a replayed hand-off: a second worker recovering the same lease
-- cannot open a second campaign, it is handed the first one's id.
CREATE UNIQUE INDEX csf_communication_campaigns_live_notice_source_key
  ON plugin_data.csf_communication_campaigns (organization_id, source_publication_event_id)
  WHERE source_publication_event_id IS NOT NULL AND status <> 'cancelled';

COMMENT ON COLUMN plugin_data.csf_communication_campaigns.source_publication_event_id IS
  'The personal CSF notice that originated this one-recipient transactional campaign. A partial unique index keeps one live campaign per notice, which is what makes a replayed hand-off idempotent.';

-- A notice campaign is transactional, has no broadcast topic, and never moves
-- to another notice.
CREATE FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event plugin_data.csf_publication_events%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE'
    AND NEW.source_publication_event_id IS DISTINCT FROM OLD.source_publication_event_id
  THEN
    RAISE EXCEPTION 'A CSF notice campaign source is immutable.' USING ERRCODE='23514';
  END IF;
  IF NEW.source_publication_event_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM plugin_data.csf_publication_events
  WHERE id=NEW.source_publication_event_id AND organization_id=NEW.organization_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF notice does not belong to this organization.'
      USING ERRCODE='23503';
  END IF;
  IF v_event.source_kind NOT IN ('point_submission','profile') THEN
    RAISE EXCEPTION 'Only a personal CSF notice may originate a notice campaign.'
      USING ERRCODE='23514';
  END IF;
  IF NEW.campaign_kind <> 'transactional'
    OR NEW.broadcast_topic_key IS NOT NULL
    OR NEW.audience_kind IS NOT NULL
  THEN
    RAISE EXCEPTION 'A CSF notice campaign is transactional and has no broadcast audience.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope() TO postgres;

CREATE TRIGGER csf_communication_campaigns_notice_scope_guard
  BEFORE INSERT OR UPDATE ON plugin_data.csf_communication_campaigns
  FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_personal_notice_campaign_scope();

CREATE FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(
  p_organization_id uuid,
  p_source_publication_event_id uuid,
  p_subject text,
  p_body_text text,
  p_body_html text DEFAULT NULL,
  p_tags jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_sender_name constant text := 'DVHS CSF';
  c_sender_email constant text := 'csf@notifications.lets-assist.com';
  c_reply_to constant text := 'dvhighcsf@gmail.com';
  v_subject text := nullif(pg_catalog.btrim(coalesce(p_subject,'')),'');
  v_body_text text := nullif(pg_catalog.btrim(coalesce(p_body_text,'')),'');
  v_body_html text := nullif(pg_catalog.btrim(coalesce(p_body_html,'')),'');
  v_correlation text := nullif(pg_catalog.btrim(coalesce(p_correlation_id,'')),'');
  v_tags jsonb := coalesce(p_tags,'{}'::jsonb);
  v_event plugin_data.csf_publication_events%ROWTYPE;
  v_existing plugin_data.csf_communication_campaigns%ROWTYPE;
  v_campaign_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_source_publication_event_id IS NULL THEN
    RAISE EXCEPTION 'A CSF notice email draft requires an organization and a notice.'
      USING ERRCODE='22004';
  END IF;
  IF v_subject IS NULL OR pg_catalog.char_length(v_subject) > 200 THEN
    RAISE EXCEPTION 'A CSF notice email subject is 1 to 200 characters.' USING ERRCODE='22023';
  END IF;
  IF v_body_text IS NULL OR pg_catalog.char_length(v_body_text) > 20000 THEN
    RAISE EXCEPTION 'A CSF notice email plain-text body is 1 to 20000 characters.'
      USING ERRCODE='22023';
  END IF;
  IF v_body_html IS NOT NULL AND pg_catalog.char_length(v_body_html) > 60000 THEN
    RAISE EXCEPTION 'A CSF notice email HTML body is at most 60000 characters.'
      USING ERRCODE='22023';
  END IF;
  IF v_correlation IS NOT NULL
    AND (v_correlation ~ '\s' OR pg_catalog.char_length(v_correlation) > 128)
  THEN
    RAISE EXCEPTION 'A CSF correlation identifier is whitespace-free and at most 128 characters.'
      USING ERRCODE='22023';
  END IF;
  IF pg_catalog.jsonb_typeof(v_tags) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_tags)) > 10
    OR plugin_data.csf_jsonb_carries_raw_content(v_tags)
  THEN
    RAISE EXCEPTION 'CSF notice email tags are at most 10 routing fields and may not carry message content.'
      USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-notice-email:'||p_organization_id::text||':'||p_source_publication_event_id::text, 0));

  SELECT * INTO v_event FROM plugin_data.csf_publication_events
  WHERE id=p_source_publication_event_id AND organization_id=p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF notice does not belong to this organization.' USING ERRCODE='23503';
  END IF;
  IF v_event.source_kind NOT IN ('point_submission','profile') THEN
    RAISE EXCEPTION 'Only a personal CSF notice may be emailed through this path.'
      USING ERRCODE='42501';
  END IF;

  -- Every campaign for this notice, INCLUDING a cancelled one.
  --
  -- The partial unique index deliberately ignores cancelled rows, so that an
  -- operator can withdraw a campaign without permanently blocking the
  -- coordinate. That is exactly why the lookup here must not share the index's
  -- predicate: an automatic replay after a failed receipt would otherwise walk
  -- straight past a campaign an operator had just stopped and open a fresh one,
  -- and the member would receive the message the operator withdrew.
  --
  -- A withdrawn or review-blocked notice is therefore a terminal disposition
  -- for automatic replay. Resending is a deliberate operator act through the
  -- Communications workspace; it is not something a retry may decide.
  SELECT * INTO v_existing FROM plugin_data.csf_communication_campaigns
  WHERE organization_id=p_organization_id
    AND source_publication_event_id=p_source_publication_event_id
  ORDER BY (status = 'cancelled'), created_at DESC, id
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status='cancelled'
      OR v_existing.status='failed'
      OR v_existing.review_blocked_at IS NOT NULL
    THEN
      RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,
        'status',v_existing.status,'campaignKind',v_existing.campaign_kind,
        'contentFinalizedAt',v_existing.content_finalized_at,
        'correlationId',v_correlation,'idempotentReplay',true,
        'disposition','held');
    END IF;
    RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,'status',v_existing.status,
      'campaignKind',v_existing.campaign_kind,'contentFinalizedAt',v_existing.content_finalized_at,
      'correlationId',v_correlation,'idempotentReplay',true,'disposition','open');
  END IF;

  v_campaign_id := pg_catalog.gen_random_uuid();
  BEGIN
    INSERT INTO plugin_data.csf_communication_campaigns (
      id,organization_id,campaign_kind,status,channel,sender_name,sender_email,reply_to_email,
      subject,body_text,body_html,source_publication_event_id,created_by,created_by_identity,
      metadata,audience_snapshot_version,provider_idempotency_key
    ) VALUES (
      v_campaign_id,p_organization_id,'transactional','draft','email',
      c_sender_name,c_sender_email,c_reply_to,v_subject,v_body_text,v_body_html,
      p_source_publication_event_id,
      -- A notice has no human author. It is recorded as system-originated
      -- rather than being attributed to whichever officer's edit produced it.
      NULL,'system:csf-notice',
      v_tags,1,'csf-campaign-'||v_campaign_id::text
    );
  EXCEPTION WHEN unique_violation THEN
    -- The racing writer committed first. Its row is the one that counts, and it
    -- is read without the cancelled predicate for the same reason as above.
    SELECT * INTO v_existing FROM plugin_data.csf_communication_campaigns
    WHERE organization_id=p_organization_id
      AND source_publication_event_id=p_source_publication_event_id
    ORDER BY (status = 'cancelled'), created_at DESC, id
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN RAISE; END IF;
    RETURN pg_catalog.jsonb_build_object('campaignId',v_existing.id,'status',v_existing.status,
      'campaignKind',v_existing.campaign_kind,'contentFinalizedAt',v_existing.content_finalized_at,
      'correlationId',v_correlation,'idempotentReplay',true,
      'disposition',CASE WHEN v_existing.status IN ('cancelled','failed')
        OR v_existing.review_blocked_at IS NOT NULL THEN 'held' ELSE 'open' END);
  END;

  RETURN pg_catalog.jsonb_build_object('campaignId',v_campaign_id,'status','draft',
    'campaignKind','transactional','contentFinalizedAt',NULL,
    'correlationId',v_correlation,'idempotentReplay',false,'disposition','open');
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_personal_notice_campaign_draft(uuid,uuid,text,text,text,jsonb,text)
  TO postgres,service_role;

-- Freezes the notice's content. There is no capability check because there is
-- no actor: the authorization that matters already happened when the delivery
-- this campaign is keyed to was authorized for its one recipient.
CREATE FUNCTION plugin_data.csf_finalize_personal_notice_content(
  p_organization_id uuid, p_campaign_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_campaign plugin_data.csf_communication_campaigns%ROWTYPE;
  v_content_hash text;
BEGIN
  IF p_organization_id IS NULL OR p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'A CSF notice finalization requires an organization and campaign.'
      USING ERRCODE='22004';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-communication-campaign:'||p_organization_id::text||':'||p_campaign_id::text, 0));

  SELECT * INTO v_campaign FROM plugin_data.csf_communication_campaigns
  WHERE id=p_campaign_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That CSF campaign does not exist in this organization.' USING ERRCODE='23503';
  END IF;
  -- Scoped hard: this entry point can only ever finalize a notice campaign, so
  -- it cannot become an actorless way to finalize a broadcast.
  IF v_campaign.source_publication_event_id IS NULL
    OR v_campaign.campaign_kind <> 'transactional'
  THEN
    RAISE EXCEPTION 'Only a personal CSF notice campaign can use notice finalization.'
      USING ERRCODE='42501';
  END IF;
  IF v_campaign.content_finalized_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('organizationId',p_organization_id,
      'campaignId',p_campaign_id,'contentFinalizedAt',v_campaign.content_finalized_at,
      'contentHash',v_campaign.content_hash,'idempotentReplay',true);
  END IF;
  IF v_campaign.status <> 'draft' THEN
    RAISE EXCEPTION 'CSF notice content must be finalized while its campaign is a draft.'
      USING ERRCODE='23514';
  END IF;
  IF nullif(pg_catalog.btrim(coalesce(v_campaign.body_text,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A CSF notice needs a plain-text body before finalization.'
      USING ERRCODE='23514';
  END IF;

  UPDATE plugin_data.csf_communication_campaigns
  SET content_finalized_at=v_now, content_finalized_by=NULL,
    content_finalized_by_identity='system:csf-notice', updated_at=v_now
  WHERE id=p_campaign_id AND organization_id=p_organization_id
  RETURNING content_hash INTO v_content_hash;

  RETURN pg_catalog.jsonb_build_object('organizationId',p_organization_id,
    'campaignId',p_campaign_id,'contentFinalizedAt',v_now,'contentHash',v_content_hash,
    'idempotentReplay',false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_personal_notice_content(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_personal_notice_content(uuid,uuid)
  TO postgres,service_role;

-- ---------------------------------------------------------------------------
-- 8. The immediately-before-send recipient re-check for a notice.
-- ---------------------------------------------------------------------------
-- A lease can last 1800 seconds. In that window a member can lose the record,
-- lose the account link, leave the chapter, or turn either preference off, and
-- the frozen snapshot address can stop being their address. This runs inside
-- the existing dispatch gate, so a notice that is no longer authorized is
-- suppressed rather than sent.
CREATE OR REPLACE FUNCTION plugin_data.csf_publication_email_recipient_allowed(
  p_organization_id uuid, p_snapshot_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s plugin_data.csf_communication_recipient_snapshots%ROWTYPE;
  c plugin_data.csf_communication_campaigns%ROWTYPE;
  p plugin_data.csf_profiles%ROWTYPE;
  e plugin_data.csf_publication_events%ROWTYPE;
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

  -- A personal notice, re-checked here in full because nothing else does.
  IF c.source_publication_event_id IS NOT NULL THEN
    SELECT * INTO e FROM plugin_data.csf_publication_events
      WHERE organization_id=p_organization_id AND id=c.source_publication_event_id;
    IF NOT FOUND OR s.user_id IS NULL THEN RETURN false; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organization_plugin_access
      WHERE organization_id=p_organization_id AND plugin_key='dvhs-csf'
        AND enabled AND is_accessible) THEN RETURN false; END IF;
    -- Still this member's record, still their account, still an active member.
    IF NOT plugin_data.csf_publication_recipient_allowed(
      p_organization_id, e.source_kind, e.source_id, s.user_id) THEN RETURN false; END IF;
    -- Both opt-outs, re-read now rather than trusted from queue time.
    IF EXISTS (SELECT 1 FROM public.notification_settings WHERE user_id=s.user_id
      AND (email_notifications=false OR organization_updates=false)) THEN RETURN false; END IF;
    -- And the frozen address must still be the account's confirmed address, so
    -- an address changed, unconfirmed or reassigned since the snapshot was
    -- taken cannot be mailed from it.
    v_current_email := plugin_data.csf_verified_account_email(s.user_id);
    RETURN v_current_email IS NOT NULL
      AND v_current_email = s.normalized_recipient_email;
  END IF;

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
      -- Same rule for the broadcast fallback. The audience restriction above is
      -- unchanged; this only stops an unconfirmed or diverged address from
      -- being used when the chapter record carries no storable one.
      v_current_email := plugin_data.csf_verified_account_email(v_user_id);
    END IF;
  END IF;
  RETURN v_current_email IS NOT NULL AND v_current_email=s.normalized_recipient_email;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publication_email_recipient_allowed(uuid,uuid) TO postgres;

COMMIT;
