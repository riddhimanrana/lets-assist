-- Member removal now goes through an authorized Server Action and a
-- service-only transactional RPC that records auto-join suppression. Direct
-- Data API deletes could bypass that product boundary (and the legacy policy
-- recursively queried its own table), so remove the client delete surface.
DROP POLICY IF EXISTS "Manage deletes" ON public.organization_members;
REVOKE DELETE ON TABLE public.organization_members FROM anon, authenticated;
