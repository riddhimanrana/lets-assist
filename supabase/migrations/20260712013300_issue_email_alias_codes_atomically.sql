-- Serialize verification-code issuance per normalized email so concurrent
-- resend requests cannot all pass a read-then-write cooldown check.
CREATE OR REPLACE FUNCTION public.issue_user_email_alias_verification(
  p_user_id uuid,
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (
  status text,
  email_id uuid,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_record public.user_emails%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL
    OR v_email = ''
    OR length(v_email) > 320
    OR p_token_hash IS NULL
    OR length(p_token_hash) <> 64
    OR p_expires_at <= v_now
    OR p_expires_at > v_now + interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid email-alias verification issue request';
  END IF;

  -- The advisory transaction lock closes the no-row insert race as well as
  -- serializing updates to an existing alias row.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-email-alias:' || v_email, 0)
  );

  SELECT aliases.*
  INTO v_record
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF FOUND THEN
    IF v_record.user_id <> p_user_id THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::integer;
      RETURN;
    END IF;

    IF v_record.verified_at IS NOT NULL THEN
      RETURN QUERY SELECT 'already_verified'::text, v_record.id, 0;
      RETURN;
    END IF;

    IF v_record.verification_last_sent_at IS NOT NULL
      AND v_record.verification_last_sent_at + interval '60 seconds' > v_now
    THEN
      RETURN QUERY
      SELECT
        'cooldown'::text,
        v_record.id,
        greatest(
          1,
          ceil(
            extract(epoch FROM (
              v_record.verification_last_sent_at + interval '60 seconds' - v_now
            ))
          )::integer
        );
      RETURN;
    END IF;

    UPDATE public.user_emails
    SET verification_token = NULL,
        verification_token_hash = p_token_hash,
        verification_expires_at = p_expires_at,
        verification_attempts = 0,
        verification_locked_until = NULL,
        verification_last_sent_at = v_now,
        verified_at = NULL,
        is_primary = false,
        updated_at = v_now
    WHERE id = v_record.id;

    RETURN QUERY SELECT 'issued'::text, v_record.id, 0;
    RETURN;
  END IF;

  INSERT INTO public.user_emails (
    user_id,
    email,
    verification_token,
    verification_token_hash,
    verification_expires_at,
    verification_attempts,
    verification_locked_until,
    verification_last_sent_at,
    verified_at,
    is_primary,
    updated_at
  )
  VALUES (
    p_user_id,
    v_email,
    NULL,
    p_token_hash,
    p_expires_at,
    0,
    NULL,
    v_now,
    NULL,
    false,
    v_now
  )
  RETURNING id INTO v_record.id;

  RETURN QUERY SELECT 'issued'::text, v_record.id, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz) IS
  'Atomically reserves an email-alias verification send and enforces its per-alias resend cooldown.';
