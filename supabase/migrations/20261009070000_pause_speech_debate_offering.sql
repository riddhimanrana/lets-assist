-- Pause the private Speech and Debate offering without deleting retained data
-- or changing any organization's installation or selected runtime.
BEGIN;

UPDATE public.plugins
SET is_active = false,
    force_update_version = NULL,
    description = 'Development is on hold. This private plugin is not available for installation.',
    updated_at = now()
WHERE key = 'dv-speech-debate';

COMMIT;
