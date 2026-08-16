-- Remove the example plugins seeded for visibility-tier testing.
--
-- `calendar-tools`, `community-impact-radar` and `family-liaison-workbench`
-- were never real products. Migration 20260412001000 introduced two of them
-- explicitly as "additional example plugins for tier testing"; the third came
-- from the local fixtures. They carried real cost: a stale calendar-tools
-- version in those fixtures disagreed with its published release and broke
-- `bun run supabase:seed:local-dev` outright.
--
-- Only `dvhs-csf` and `dv-speech-debate` are real, so the catalog says so.
--
-- Deletes are scoped to these three keys and ordered child-first. Installs and
-- entitlements are removed before the catalog row so a foreign key cannot hold
-- a half-removed plugin in place. Any organization that had one installed
-- simply loses a surface that was never a product.

do $$
declare
  removed_keys text[] := array[
    'calendar-tools',
    'community-impact-radar',
    'family-liaison-workbench'
  ];
begin
  delete from public.organization_plugin_installs
  where plugin_key = any (removed_keys);

  delete from public.organization_plugin_entitlements
  where plugin_key = any (removed_keys);

  delete from public.plugin_versions
  where plugin_key = any (removed_keys);

  delete from public.plugins
  where key = any (removed_keys);
end;
$$;
