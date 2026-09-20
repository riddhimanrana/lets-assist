BEGIN;

CREATE TABLE private.anonymous_account_links (
  anonymous_id uuid PRIMARY KEY REFERENCES public.anonymous_signups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  signup_ids uuid[] NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.anonymous_account_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.anonymous_account_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.anonymous_account_links TO service_role;

-- The server verifies the destination session. The guest token is rechecked
-- while holding locks, so a concurrent claim cannot transfer another owner's data.
CREATE FUNCTION public.link_guest_attendance_account(
  p_anonymous_id uuid, p_user_id uuid, p_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_guest public.anonymous_signups%ROWTYPE;
  v_prior private.anonymous_account_links%ROWTYPE;
  v_signup_ids uuid[];
BEGIN
  IF p_anonymous_id IS NULL OR p_user_id IS NULL OR NULLIF(btrim(p_token),'') IS NULL THEN
    RAISE EXCEPTION 'guest access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_guest FROM public.anonymous_signups
    WHERE id=p_anonymous_id AND token::text=btrim(p_token);
  IF NOT FOUND THEN RAISE EXCEPTION 'guest access denied' USING ERRCODE='42501'; END IF;
  -- Match the project-first order used by attendance and publication operations.
  PERFORM id FROM public.projects WHERE id=v_guest.project_id FOR UPDATE;
  SELECT * INTO v_guest FROM public.anonymous_signups
    WHERE id=p_anonymous_id AND token::text=btrim(p_token) FOR UPDATE;
  IF NOT FOUND OR (v_guest.linked_user_id IS NOT NULL AND v_guest.linked_user_id<>p_user_id) THEN
    RAISE EXCEPTION 'guest access denied' USING ERRCODE='42501';
  END IF;
  PERFORM id FROM auth.users WHERE id=p_user_id AND NOT COALESCE(is_anonymous,false)
    AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'destination account unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_prior FROM private.anonymous_account_links WHERE anonymous_id=p_anonymous_id;
  IF FOUND THEN
    IF v_prior.user_id<>p_user_id THEN RAISE EXCEPTION 'guest access denied' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('outcome','replayed','signupCount',cardinality(v_prior.signup_ids));
  END IF;

  -- Recover old partial transfers only from retained signup provenance or an
  -- unassigned certificate already attached to this account's signup.
  SELECT COALESCE(array_agg(DISTINCT signup_id),ARRAY[]::uuid[]) INTO v_signup_ids FROM (
    SELECT signup.id AS signup_id FROM public.project_signups signup WHERE signup.anonymous_id=p_anonymous_id
    UNION SELECT row.committed_signup_id FROM public.project_paper_scan_rows row
      WHERE row.committed_anonymous_id=p_anonymous_id AND row.committed_signup_id IS NOT NULL
    UNION SELECT waiver.signup_id FROM public.waiver_signatures waiver WHERE waiver.anonymous_id=p_anonymous_id
    UNION SELECT certificate.signup_id FROM public.certificates certificate
      JOIN public.project_signups signup ON signup.id=certificate.signup_id
      WHERE certificate.project_id=v_guest.project_id AND certificate.user_id IS NULL
        AND signup.user_id=p_user_id AND signup.anonymous_id IS NULL
        AND lower(certificate.volunteer_email)=lower(v_guest.email)
  ) candidates;
  PERFORM id FROM public.project_signups WHERE id=ANY(v_signup_ids) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.project_signups WHERE id=ANY(v_signup_ids)
    AND (project_id IS DISTINCT FROM v_guest.project_id OR (user_id IS NOT NULL AND user_id<>p_user_id)
      OR (anonymous_id IS NOT NULL AND anonymous_id<>p_anonymous_id))) THEN
    RAISE EXCEPTION 'guest attendance ownership conflict' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM public.project_signups guest JOIN public.project_signups account
    ON account.project_id=guest.project_id AND account.schedule_id=guest.schedule_id
    WHERE guest.id=ANY(v_signup_ids) AND account.user_id=p_user_id AND account.id<>guest.id) THEN
    RAISE EXCEPTION 'account already has attendance for this session' USING ERRCODE='23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.project_signups guest
    JOIN public.project_signups account ON account.project_id=guest.project_id AND account.user_id=p_user_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(private.signup_attendance_intervals(guest.id),'[]'::jsonb),
      jsonb_build_array(jsonb_build_object('checkIn',guest.check_in_time,'checkOut',guest.check_out_time)))) guest_visit
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(private.signup_attendance_intervals(account.id),'[]'::jsonb),
      jsonb_build_array(jsonb_build_object('checkIn',account.check_in_time,'checkOut',account.check_out_time)))) account_visit
    WHERE guest.id=ANY(v_signup_ids) AND account.id<>ALL(v_signup_ids)
      AND (guest.status IN ('approved','attended') OR EXISTS(SELECT 1 FROM public.certificates WHERE signup_id=guest.id AND type='verified'))
      AND (account.status IN ('approved','attended') OR EXISTS(SELECT 1 FROM public.certificates WHERE signup_id=account.id AND type='verified'))
      AND (guest_visit.value->>'checkIn')::timestamptz < (account_visit.value->>'checkOut')::timestamptz
      AND (guest_visit.value->>'checkOut')::timestamptz > (account_visit.value->>'checkIn')::timestamptz
  ) THEN RAISE EXCEPTION 'account has overlapping attendance' USING ERRCODE='23505'; END IF;
  PERFORM id FROM public.certificates WHERE signup_id=ANY(v_signup_ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM public.waiver_signatures WHERE anonymous_id=p_anonymous_id OR signup_id=ANY(v_signup_ids) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.certificates WHERE signup_id=ANY(v_signup_ids)
    AND (project_id IS DISTINCT FROM v_guest.project_id OR (user_id IS NOT NULL AND user_id<>p_user_id)))
    OR EXISTS(SELECT 1 FROM public.waiver_signatures WHERE (anonymous_id=p_anonymous_id OR signup_id=ANY(v_signup_ids))
      AND (project_id IS DISTINCT FROM v_guest.project_id OR (user_id IS NOT NULL AND user_id<>p_user_id)
        OR (anonymous_id IS NOT NULL AND anonymous_id<>p_anonymous_id))) THEN
    RAISE EXCEPTION 'guest evidence ownership conflict' USING ERRCODE='23505';
  END IF;

  UPDATE public.project_signups SET user_id=p_user_id,anonymous_id=NULL WHERE id=ANY(v_signup_ids);
  UPDATE public.waiver_signatures SET user_id=p_user_id,anonymous_id=NULL
    WHERE anonymous_id=p_anonymous_id OR signup_id=ANY(v_signup_ids);
  UPDATE public.certificates SET user_id=p_user_id WHERE signup_id=ANY(v_signup_ids);
  UPDATE public.anonymous_signups SET linked_user_id=p_user_id WHERE id=p_anonymous_id;
  INSERT INTO private.anonymous_account_links(anonymous_id,user_id,signup_ids)
    VALUES(p_anonymous_id,p_user_id,v_signup_ids);
  RETURN jsonb_build_object('outcome','accepted','signupCount',cardinality(v_signup_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.link_guest_attendance_account(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.link_guest_attendance_account(uuid,uuid,text) TO service_role;

COMMIT;
