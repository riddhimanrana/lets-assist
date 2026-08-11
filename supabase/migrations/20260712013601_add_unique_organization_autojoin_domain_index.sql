CREATE UNIQUE INDEX CONCURRENTLY organizations_autojoin_domain_unique_idx
  ON public.organizations (auto_join_domain)
  WHERE auto_join_domain IS NOT NULL;
