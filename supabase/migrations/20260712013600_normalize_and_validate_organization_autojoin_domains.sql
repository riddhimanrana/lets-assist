UPDATE public.organizations
SET auto_join_domain = lower(btrim(auto_join_domain))
WHERE auto_join_domain IS NOT NULL
  AND auto_join_domain IS DISTINCT FROM lower(btrim(auto_join_domain));

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_autojoin_domain_format_check
  CHECK (
    auto_join_domain IS NULL
    OR (
      auto_join_domain = lower(btrim(auto_join_domain))
      AND length(auto_join_domain) <= 253
      AND auto_join_domain ~ '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
      AND auto_join_domain NOT IN (
        'aol.com',
        'gmail.com',
        'googlemail.com',
        'hotmail.com',
        'icloud.com',
        'live.com',
        'mail.com',
        'msn.com',
        'outlook.com',
        'proton.me',
        'protonmail.com',
        'yahoo.com',
        'ymail.com'
      )
    )
  )
  NOT VALID;

ALTER TABLE public.organizations
  VALIDATE CONSTRAINT organizations_autojoin_domain_format_check;
