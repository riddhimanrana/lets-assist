-- Anonymous signup identities are project-scoped, but an email opt-out is an
-- address-level decision. Keep every existing identity for the normalized
-- address in sync from one service-only transaction.

CREATE INDEX IF NOT EXISTS anonymous_signups_feedback_normalized_email_idx
  ON public.anonymous_signups ((lower(btrim(email))));

CREATE TABLE private.anonymous_feedback_email_preferences (
  normalized_email text PRIMARY KEY
    CHECK (
      normalized_email = lower(btrim(normalized_email))
      AND length(normalized_email) BETWEEN 3 AND 320
    ),
  opted_out_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.anonymous_feedback_email_preferences
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE private.anonymous_feedback_email_preferences TO postgres;

CREATE OR REPLACE FUNCTION app_private.apply_anonymous_feedback_email_preference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_normalized_email text := nullif(lower(btrim(NEW.email)), '');
BEGIN
  IF v_normalized_email IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'anonymous-feedback-email-preference:' || v_normalized_email,
      0
    )
  );

  SELECT preference.opted_out_at
  INTO NEW.email_opt_out_at
  FROM private.anonymous_feedback_email_preferences AS preference
  WHERE preference.normalized_email = v_normalized_email;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_anonymous_feedback_email_preference
  ON public.anonymous_signups;
CREATE TRIGGER apply_anonymous_feedback_email_preference
BEFORE INSERT OR UPDATE OF email, email_opt_out_at
ON public.anonymous_signups
FOR EACH ROW
EXECUTE FUNCTION app_private.apply_anonymous_feedback_email_preference();

-- Preserve every address that had already opted out before this durable
-- address-level preference existed, then make all of its current identities
-- agree with the earliest recorded decision.
INSERT INTO private.anonymous_feedback_email_preferences (
  normalized_email,
  opted_out_at,
  updated_at
)
SELECT
  lower(btrim(signup.email)),
  min(signup.email_opt_out_at),
  now()
FROM public.anonymous_signups AS signup
WHERE signup.email_opt_out_at IS NOT NULL
  AND nullif(lower(btrim(signup.email)), '') IS NOT NULL
GROUP BY lower(btrim(signup.email))
ON CONFLICT (normalized_email) DO UPDATE
SET
  opted_out_at = least(
    private.anonymous_feedback_email_preferences.opted_out_at,
    excluded.opted_out_at
  ),
  updated_at = now();

UPDATE public.anonymous_signups AS signup
SET email_opt_out_at = preference.opted_out_at
FROM private.anonymous_feedback_email_preferences AS preference
WHERE lower(btrim(signup.email)) = preference.normalized_email
  AND signup.email_opt_out_at IS DISTINCT FROM preference.opted_out_at;

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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'anonymous-feedback-email-preference:' || v_normalized_email,
      0
    )
  );

  IF p_opted_out THEN
    INSERT INTO private.anonymous_feedback_email_preferences (
      normalized_email,
      opted_out_at,
      updated_at
    )
    VALUES (v_normalized_email, now(), now())
    ON CONFLICT (normalized_email) DO UPDATE
    SET opted_out_at = excluded.opted_out_at,
        updated_at = excluded.updated_at;
  ELSE
    DELETE FROM private.anonymous_feedback_email_preferences AS preference
    WHERE preference.normalized_email = v_normalized_email;
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

REVOKE ALL ON FUNCTION app_private.apply_anonymous_feedback_email_preference()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.apply_anonymous_feedback_email_preference()
  TO postgres;
