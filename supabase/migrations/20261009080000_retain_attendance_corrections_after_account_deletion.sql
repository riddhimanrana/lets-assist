BEGIN;

-- Account deletion removes sign-ups but retains correction provenance.
ALTER TABLE private.project_attendance_changes
  ALTER COLUMN signup_id DROP NOT NULL,
  DROP CONSTRAINT project_attendance_changes_signup_id_fkey,
  ADD CONSTRAINT project_attendance_changes_signup_id_fkey
    FOREIGN KEY (signup_id) REFERENCES public.project_signups(id) ON DELETE SET NULL;

COMMIT;
