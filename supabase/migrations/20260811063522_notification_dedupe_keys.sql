-- Allow callers to opt specific notifications into replay-safe delivery without
-- suppressing ordinary repeat events. NULL intentionally remains non-unique so
-- a user can receive any number of notifications of the same broad type.

ALTER TABLE public.notifications
  ADD COLUMN dedupe_key text;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_dedupe_key_bounded
  CHECK (
    dedupe_key IS NULL
    OR (
      dedupe_key = btrim(dedupe_key)
      AND char_length(dedupe_key) BETWEEN 1 AND 200
    )
  );

CREATE UNIQUE INDEX notifications_user_dedupe_key_unique
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Optional caller-owned idempotency key. NULL permits repeat delivery; a non-null key is unique per recipient.';
