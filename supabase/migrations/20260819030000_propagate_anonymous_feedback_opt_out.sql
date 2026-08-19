-- Anonymous signup identities are project-scoped, but an email opt-out is an
-- address-level decision. Keep every existing identity for the normalized
-- address in sync from one service-only transaction.

CREATE INDEX IF NOT EXISTS anonymous_signups_feedback_normalized_email_idx
  ON public.anonymous_signups ((lower(btrim(email))));

CREATE OR REPLACE FUNCTION public.set_anonymous_feedback_email_opt_out(
  p_anonymous_signup_id uuid,
  p_opted_out boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_normalized_email text;
  v_updated integer := 0;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_anonymous_signup_id IS NULL OR p_opted_out IS NULL THEN
    RAISE EXCEPTION 'invalid anonymous feedback preference request'
      USING errcode = '22023';
  END IF;

  SELECT nullif(lower(btrim(signup.email)), '')
  INTO v_normalized_email
  FROM public.anonymous_signups AS signup
  WHERE signup.id = p_anonymous_signup_id;

  IF v_normalized_email IS NULL THEN
    RAISE EXCEPTION 'anonymous signup not found' USING errcode = 'P0002';
  END IF;

  UPDATE public.anonymous_signups AS signup
  SET email_opt_out_at = CASE WHEN p_opted_out THEN now() ELSE NULL END
  WHERE lower(btrim(signup.email)) = v_normalized_email;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.set_anonymous_feedback_email_opt_out(uuid, boolean)
IS 'Service-only propagation of project-feedback email preference across all project-scoped anonymous identities for one normalized address.';

REVOKE ALL ON FUNCTION public.set_anonymous_feedback_email_opt_out(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_anonymous_feedback_email_opt_out(uuid, boolean)
  TO service_role;
