-- Remove a Production-only policy absent from the reviewed invitation contract.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP POLICY IF EXISTS "Org admins can delete invitations"
  ON public.organization_invitations;

COMMIT;
