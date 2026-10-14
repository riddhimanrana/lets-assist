-- Preserve the submitted wall-clock zone for new self-reported certificates.
-- Legacy rows remain NULL: their original zone cannot be recovered from UTC.
ALTER TABLE public.certificates
  ADD COLUMN event_timezone text
    CHECK (event_timezone IS NULL OR
      (char_length(event_timezone) BETWEEN 1 AND 100 AND event_timezone = btrim(event_timezone)));
COMMENT ON COLUMN public.certificates.event_timezone IS
  'Validated IANA timezone submitted for self-reported volunteer hours; NULL for legacy records.';
