-- Let an organization admin dismiss the setup checklist.
--
-- The checklist itself is derived from data the organization page already
-- loads, so the only state worth persisting is "an admin decided they are done
-- with it". A nullable timestamp on organizations is enough; a separate table
-- would carry a row per organization to store one nullable value.
--
-- Grants are explicit rather than inherited. public.organizations uses
-- column-level SELECT grants (20260712014700 narrowed client reads to the
-- columns that are safe to expose, keeping join_code and staff_join_token out),
-- so a new column is unreadable by clients until named here. UPDATE is
-- table-level on this table and is already constrained to org admins by the
-- existing RLS policy, so no new write grant is needed.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed_at timestamptz;

COMMENT ON COLUMN public.organizations.setup_checklist_dismissed_at IS
  'When an organization admin dismissed the setup checklist. Null means not dismissed. Not a completion signal: completion is derived.';

GRANT SELECT (setup_checklist_dismissed_at) ON public.organizations TO authenticated;

COMMIT;
