-- Wrap the original atomic issuer so a resend cannot reset an active
-- brute-force lockout. The advisory lock is re-entrant within this transaction.
ALTER FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz)
  RENAME TO issue_user_email_alias_verification_unlocked;

REVOKE ALL ON FUNCTION public.issue_user_email_alias_verification_unlocked(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

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
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-email-alias:' || v_email, 0)
  );

  SELECT aliases.*
  INTO v_record
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF FOUND
    AND v_record.user_id = p_user_id
    AND v_record.verification_locked_until IS NOT NULL
    AND v_record.verification_locked_until > v_now
  THEN
    RETURN QUERY
    SELECT
      'locked'::text,
      v_record.id,
      greatest(
        1,
        ceil(extract(epoch FROM (v_record.verification_locked_until - v_now)))::integer
      );
    RETURN;
  END IF;

  RETURN QUERY
  SELECT issued.status, issued.email_id, issued.retry_after_seconds
  FROM public.issue_user_email_alias_verification_unlocked(
    p_user_id,
    v_email,
    p_token_hash,
    p_expires_at
  ) AS issued;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz) IS
  'Atomically reserves an email-alias verification send without resetting an active brute-force lockout.';
