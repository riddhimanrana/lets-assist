-- Pending email-alias verification is not ownership. Keep challenges in a
-- service-only table so an unverified request cannot reserve the globally
-- unique verified alias in public.user_emails.

CREATE TABLE public.email_alias_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_alias_verification_challenges_user_email_key
    UNIQUE (user_id, email),
  CONSTRAINT email_alias_verification_challenges_email_normalized
    CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
  CONSTRAINT email_alias_verification_challenges_token_hash_format
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_alias_verification_challenges_attempts_bounded
    CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX email_alias_verification_challenges_email_idx
  ON public.email_alias_verification_challenges (email);

ALTER TABLE public.email_alias_verification_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_alias_verification_challenges
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.email_alias_verification_challenges TO service_role;

COMMENT ON TABLE public.email_alias_verification_challenges IS
  'Service-only, short-lived hashed challenges for secondary email verification.';
COMMENT ON COLUMN public.email_alias_verification_challenges.token_hash IS
  'HMAC-SHA-256 digest of the verification code; plaintext codes are never persisted.';

-- Preserve usable pending challenges and active brute-force lockouts from the
-- old representation before removing unverified rows from user_emails. Legacy
-- plaintext-only requests are deliberately not copied.
INSERT INTO public.email_alias_verification_challenges (
  user_id,
  email,
  token_hash,
  expires_at,
  attempts,
  locked_until,
  last_sent_at,
  created_at,
  updated_at
)
SELECT
  aliases.user_id,
  lower(btrim(aliases.email)),
  lower(aliases.verification_token_hash),
  aliases.verification_expires_at,
  least(greatest(coalesce(aliases.verification_attempts, 0), 0), 5),
  aliases.verification_locked_until,
  coalesce(
    aliases.verification_last_sent_at,
    aliases.updated_at,
    aliases.created_at,
    now()
  ),
  coalesce(aliases.created_at, now()),
  coalesce(aliases.updated_at, now())
FROM public.user_emails AS aliases
WHERE aliases.verified_at IS NULL
  AND aliases.verification_token_hash ~ '^[0-9A-Fa-f]{64}$'
  AND aliases.verification_expires_at IS NOT NULL
  AND (
    aliases.verification_expires_at > clock_timestamp()
    OR aliases.verification_locked_until > clock_timestamp()
  )
ON CONFLICT (user_id, email) DO UPDATE
SET token_hash = EXCLUDED.token_hash,
    expires_at = EXCLUDED.expires_at,
    attempts = EXCLUDED.attempts,
    locked_until = EXCLUDED.locked_until,
    last_sent_at = EXCLUDED.last_sent_at,
    updated_at = EXCLUDED.updated_at
WHERE EXCLUDED.updated_at >= public.email_alias_verification_challenges.updated_at;

-- The old functions depend on challenge columns in user_emails and the issuer
-- return shape changes from email_id to challenge_id.
DROP FUNCTION IF EXISTS public.issue_user_email_alias_verification(
  uuid,
  text,
  text,
  timestamptz
);
DROP FUNCTION IF EXISTS public.issue_user_email_alias_verification_unlocked(
  uuid,
  text,
  text,
  timestamptz
);
DROP FUNCTION IF EXISTS public.verify_user_email_alias(uuid, text, text);

DELETE FROM public.user_emails
WHERE verified_at IS NULL;

-- Normalize before retaining the global verified-email uniqueness constraint.
-- If production contains conflicting case variants, fail rather than silently
-- transferring a verified address between users.
UPDATE public.user_emails
SET email = lower(btrim(email)),
    is_primary = coalesce(is_primary, false),
    updated_at = now()
WHERE email IS DISTINCT FROM lower(btrim(email))
   OR is_primary IS NULL;

ALTER TABLE public.user_emails
  DROP CONSTRAINT IF EXISTS user_emails_verification_attempts_nonnegative,
  ALTER COLUMN verified_at SET NOT NULL,
  ALTER COLUMN is_primary SET DEFAULT false,
  ALTER COLUMN is_primary SET NOT NULL,
  ADD CONSTRAINT user_emails_email_normalized
    CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
  DROP COLUMN verification_token,
  DROP COLUMN verification_token_hash,
  DROP COLUMN verification_expires_at,
  DROP COLUMN verification_attempts,
  DROP COLUMN verification_locked_until,
  DROP COLUMN verification_last_sent_at;

DROP POLICY IF EXISTS "Users can insert their own emails" ON public.user_emails;
DROP POLICY IF EXISTS "Users can update their own emails" ON public.user_emails;
REVOKE INSERT, UPDATE ON TABLE public.user_emails
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.user_emails IS
  'Verified primary and secondary account emails. Pending verification state is stored separately.';

-- Repair historical duplicate/stale primary flags from the authoritative Auth
-- email before enforcing one primary row per user. A cross-user verified alias
-- conflict is intentionally left secondary for manual reconciliation rather
-- than silently transferring ownership.
UPDATE public.user_emails
SET is_primary = false,
    updated_at = now()
WHERE is_primary;

INSERT INTO public.user_emails (
  user_id,
  email,
  is_primary,
  verified_at,
  updated_at
)
SELECT
  users.id,
  lower(btrim(users.email::text)),
  true,
  coalesce(users.email_confirmed_at, users.created_at, now()),
  now()
FROM auth.users AS users
WHERE users.email IS NOT NULL
  AND btrim(users.email::text) <> ''
ON CONFLICT (email) DO UPDATE
SET is_primary = true,
    verified_at = coalesce(public.user_emails.verified_at, EXCLUDED.verified_at),
    updated_at = EXCLUDED.updated_at
WHERE public.user_emails.user_id = EXCLUDED.user_id;

CREATE UNIQUE INDEX user_emails_one_primary_per_user_idx
  ON public.user_emails (user_id)
  WHERE is_primary;

-- A self-update RLS policy previously let a client spoof profiles.email. Keep
-- that field auth-owned so it cannot become an alternative alias-reservation
-- vector. Auth/service paths execute as postgres or service_role; an initial
-- client fallback insert is allowed only when it exactly matches the signed
-- JWT identity.
CREATE OR REPLACE FUNCTION private.protect_profile_auth_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claim_email text;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'profile email changes require the verified auth flow'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.email IS NOT NULL THEN
    v_claim_email := nullif(auth.jwt() ->> 'email', '');
    IF NEW.id IS DISTINCT FROM auth.uid()
      OR lower(btrim(NEW.email::text)) IS DISTINCT FROM lower(btrim(v_claim_email))
    THEN
      RAISE EXCEPTION 'profile email must match the authenticated identity'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_auth_email ON public.profiles;
CREATE TRIGGER protect_profile_auth_email
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION private.protect_profile_auth_email();

REVOKE ALL ON FUNCTION private.protect_profile_auth_email()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_primary_user_email(p_user_id uuid)
RETURNS TABLE (
  status text,
  primary_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_verified_owner uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT lower(btrim(users.email::text))
  INTO v_email
  FROM auth.users AS users
  WHERE users.id = p_user_id
    AND users.email IS NOT NULL
    AND btrim(users.email::text) <> '';

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_primary_email'::text, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-user-email-primary:' || p_user_id::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-email-alias:' || v_email, 0)
  );

  SELECT aliases.user_id
  INTO v_verified_owner
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF v_verified_owner IS NOT NULL AND v_verified_owner <> p_user_id THEN
    RETURN QUERY SELECT 'conflict'::text, v_email;
    RETURN;
  END IF;

  UPDATE public.user_emails AS aliases
  SET is_primary = false,
      updated_at = v_now
  WHERE aliases.user_id = p_user_id
    AND aliases.email <> v_email
    AND aliases.is_primary;

  INSERT INTO public.user_emails (
    user_id,
    email,
    is_primary,
    verified_at,
    updated_at
  )
  VALUES (p_user_id, v_email, true, v_now, v_now)
  ON CONFLICT (email) DO NOTHING;

  SELECT aliases.user_id
  INTO v_verified_owner
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF v_verified_owner <> p_user_id OR v_verified_owner IS NULL THEN
    RETURN QUERY SELECT 'conflict'::text, v_email;
    RETURN;
  END IF;

  UPDATE public.user_emails
  SET is_primary = true,
      verified_at = coalesce(verified_at, v_now),
      updated_at = v_now
  WHERE user_id = p_user_id
    AND email = v_email;

  UPDATE public.profiles
  SET email = v_email,
      updated_at = v_now
  WHERE id = p_user_id
    AND email IS DISTINCT FROM v_email;

  DELETE FROM public.email_alias_verification_challenges AS challenges
  WHERE challenges.email = v_email;

  RETURN QUERY SELECT 'synced'::text, v_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_user_email_alias_verification(
  p_user_id uuid,
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (
  status text,
  challenge_id uuid,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_now timestamptz := clock_timestamp();
  v_challenge public.email_alias_verification_challenges%ROWTYPE;
  v_primary_owner uuid;
  v_verified_owner uuid;
  v_primary_sync_status text;
BEGIN
  IF p_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users AS users WHERE users.id = p_user_id)
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    OR length(v_email) > 320
    OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at IS NULL
    OR p_expires_at <= v_now
    OR p_expires_at > v_now + interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid email-alias verification issue request';
  END IF;

  -- Serialize verified ownership changes by normalized address. Pending rows
  -- remain per-user and therefore do not reserve the address globally.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-email-alias:' || v_email, 0)
  );

  SELECT users.id
  INTO v_primary_owner
  FROM auth.users AS users
  WHERE users.email IS NOT NULL
    AND lower(btrim(users.email::text)) = v_email
  LIMIT 1;

  SELECT aliases.user_id
  INTO v_verified_owner
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF (v_primary_owner IS NOT NULL AND v_primary_owner <> p_user_id)
    OR (v_verified_owner IS NOT NULL AND v_verified_owner <> p_user_id)
  THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  IF v_verified_owner = p_user_id THEN
    DELETE FROM public.email_alias_verification_challenges AS challenges
    WHERE challenges.email = v_email;
    RETURN QUERY SELECT 'already_verified'::text, NULL::uuid, 0;
    RETURN;
  END IF;

  -- A user's primary Auth email is already verified. Synchronize the public
  -- read model rather than sending a redundant secondary-email challenge.
  IF v_primary_owner = p_user_id THEN
    SELECT synced.status
    INTO v_primary_sync_status
    FROM public.sync_primary_user_email(p_user_id) AS synced;

    IF v_primary_sync_status = 'synced' THEN
      RETURN QUERY SELECT 'already_verified'::text, NULL::uuid, 0;
      RETURN;
    END IF;

    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  SELECT challenges.*
  INTO v_challenge
  FROM public.email_alias_verification_challenges AS challenges
  WHERE challenges.user_id = p_user_id
    AND challenges.email = v_email
  FOR UPDATE;

  IF FOUND THEN
    IF v_challenge.locked_until IS NOT NULL
      AND v_challenge.locked_until > v_now
    THEN
      RETURN QUERY
      SELECT
        'locked'::text,
        v_challenge.id,
        greatest(
          1,
          ceil(extract(epoch FROM (v_challenge.locked_until - v_now)))::integer
        );
      RETURN;
    END IF;

    IF v_challenge.last_sent_at + interval '60 seconds' > v_now THEN
      RETURN QUERY
      SELECT
        'cooldown'::text,
        v_challenge.id,
        greatest(
          1,
          ceil(
            extract(epoch FROM (
              v_challenge.last_sent_at + interval '60 seconds' - v_now
            ))
          )::integer
        );
      RETURN;
    END IF;

    UPDATE public.email_alias_verification_challenges
    SET token_hash = p_token_hash,
        expires_at = p_expires_at,
        attempts = 0,
        locked_until = NULL,
        last_sent_at = v_now,
        updated_at = v_now
    WHERE id = v_challenge.id;

    RETURN QUERY SELECT 'issued'::text, v_challenge.id, 0;
    RETURN;
  END IF;

  INSERT INTO public.email_alias_verification_challenges (
    user_id,
    email,
    token_hash,
    expires_at,
    attempts,
    last_sent_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_email,
    p_token_hash,
    p_expires_at,
    0,
    v_now,
    v_now
  )
  RETURNING id INTO v_challenge.id;

  RETURN QUERY SELECT 'issued'::text, v_challenge.id, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_user_email_alias(
  p_user_id uuid,
  p_email text,
  p_token_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_now timestamptz := clock_timestamp();
  v_challenge public.email_alias_verification_challenges%ROWTYPE;
  v_attempts integer;
  v_primary_owner uuid;
  v_verified_owner uuid;
  v_is_primary boolean := false;
BEGIN
  IF p_user_id IS NULL
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    OR length(v_email) > 320
    OR p_token_hash !~ '^[0-9a-f]{64}$'
  THEN
    RETURN 'invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-email-alias:' || v_email, 0)
  );

  SELECT challenges.*
  INTO v_challenge
  FROM public.email_alias_verification_challenges AS challenges
  WHERE challenges.user_id = p_user_id
    AND challenges.email = v_email
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  IF v_challenge.locked_until IS NOT NULL
    AND v_challenge.locked_until > v_now
  THEN
    RETURN 'locked';
  END IF;

  IF v_challenge.expires_at <= v_now THEN
    DELETE FROM public.email_alias_verification_challenges
    WHERE id = v_challenge.id;
    RETURN 'invalid';
  END IF;

  IF v_challenge.token_hash <> p_token_hash THEN
    v_attempts := least(v_challenge.attempts + 1, 5);
    UPDATE public.email_alias_verification_challenges
    SET attempts = v_attempts,
        locked_until = CASE
          WHEN v_attempts >= 5 THEN v_now + interval '15 minutes'
          ELSE NULL
        END,
        updated_at = v_now
    WHERE id = v_challenge.id;

    IF v_attempts >= 5 THEN
      RETURN 'locked';
    END IF;
    RETURN 'invalid';
  END IF;

  -- Auth owns the primary-email truth. profiles.email is synchronized only
  -- after this authoritative check and never used alone to claim an address.
  SELECT users.id
  INTO v_primary_owner
  FROM auth.users AS users
  WHERE users.email IS NOT NULL
    AND lower(btrim(users.email::text)) = v_email
  LIMIT 1;

  SELECT aliases.user_id
  INTO v_verified_owner
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF (v_primary_owner IS NOT NULL AND v_primary_owner <> p_user_id)
    OR (v_verified_owner IS NOT NULL AND v_verified_owner <> p_user_id)
  THEN
    DELETE FROM public.email_alias_verification_challenges AS challenges
    WHERE challenges.email = v_email;
    RETURN 'unavailable';
  END IF;

  v_is_primary := coalesce(v_primary_owner = p_user_id, false);

  IF v_is_primary THEN
    UPDATE public.user_emails AS aliases
    SET is_primary = false,
        updated_at = v_now
    WHERE aliases.user_id = p_user_id
      AND aliases.email <> v_email
      AND aliases.is_primary;
  END IF;

  INSERT INTO public.user_emails (
    user_id,
    email,
    is_primary,
    verified_at,
    updated_at
  )
  VALUES (p_user_id, v_email, v_is_primary, v_now, v_now)
  ON CONFLICT (email) DO NOTHING;

  SELECT aliases.user_id
  INTO v_verified_owner
  FROM public.user_emails AS aliases
  WHERE aliases.email = v_email
  FOR UPDATE;

  IF v_verified_owner <> p_user_id OR v_verified_owner IS NULL THEN
    DELETE FROM public.email_alias_verification_challenges AS challenges
    WHERE challenges.email = v_email;
    RETURN 'unavailable';
  END IF;

  UPDATE public.user_emails
  SET is_primary = is_primary OR v_is_primary,
      verified_at = coalesce(verified_at, v_now),
      updated_at = v_now
  WHERE user_id = p_user_id
    AND email = v_email;

  IF v_is_primary THEN
    UPDATE public.profiles
    SET email = v_email,
        updated_at = v_now
    WHERE id = p_user_id
      AND email IS DISTINCT FROM v_email;
  END IF;

  -- Once ownership is proven, all competing pending challenges for this
  -- globally unique verified address are obsolete.
  DELETE FROM public.email_alias_verification_challenges AS challenges
  WHERE challenges.email = v_email;

  RETURN 'verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_user_email_alias_verification(
  p_challenge_id uuid,
  p_user_id uuid,
  p_token_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_id uuid;
BEGIN
  IF p_challenge_id IS NULL
    OR p_user_id IS NULL
    OR p_token_hash !~ '^[0-9a-f]{64}$'
  THEN
    RETURN false;
  END IF;

  DELETE FROM public.email_alias_verification_challenges AS challenges
  WHERE challenges.id = p_challenge_id
    AND challenges.user_id = p_user_id
    AND challenges.token_hash = p_token_hash
  RETURNING challenges.id INTO v_deleted_id;

  RETURN v_deleted_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_user_email_alias_verification(
  uuid,
  text,
  text,
  timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_primary_user_email(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_user_email_alias(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_user_email_alias_verification(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_user_email_alias_verification(
  uuid,
  text,
  text,
  timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_primary_user_email(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_user_email_alias(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_user_email_alias_verification(uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.issue_user_email_alias_verification(uuid, text, text, timestamptz) IS
  'Issues a per-user hashed alias challenge without reserving the globally unique verified address.';
COMMENT ON FUNCTION public.sync_primary_user_email(uuid) IS
  'Atomically synchronizes the one primary public email from authoritative Auth state.';
COMMENT ON FUNCTION public.verify_user_email_alias(uuid, text, text) IS
  'Atomically verifies a challenge and claims the unique verified alias.';
COMMENT ON FUNCTION public.discard_user_email_alias_verification(uuid, uuid, text) IS
  'Deletes only the exact challenge whose email delivery failed.';
