BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(30);

SELECT extensions.has_table(
  'public',
  'api_rate_limit_receipts',
  'durable API quota receipts exist'
);

SELECT extensions.is(
  (
    SELECT relrowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.api_rate_limit_receipts'::regclass
  ),
  true,
  'durable API quota receipts enforce RLS'
);

WITH roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege(
    role_name,
    'public.api_rate_limit_receipts',
    privilege_name
  ),
  pg_catalog.format(
    '%s cannot %s durable API quota receipts',
    role_name,
    privilege_name
  )
)
FROM roles
CROSS JOIN privileges;

WITH privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT pg_catalog.has_table_privilege(
    'service_role',
    'public.api_rate_limit_receipts',
    privilege_name
  ),
  pg_catalog.format(
    'service_role uses the RPC rather than direct %s receipt access',
    privilege_name
  )
)
FROM privileges;

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'anon',
    'public.consume_ai_quota(text,text,jsonb,integer)',
    'EXECUTE'
  ),
  'anon cannot execute atomic AI quota charging'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.consume_ai_quota(text,text,jsonb,integer)',
    'EXECUTE'
  ),
  'authenticated cannot execute atomic AI quota charging'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
    ) AS acl
    WHERE proc.oid =
      'public.consume_ai_quota(text,text,jsonb,integer)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute grant on atomic AI quota charging'
);

SELECT extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.consume_ai_quota(text,text,jsonb,integer)',
    'EXECUTE'
  ),
  'service_role can execute atomic AI quota charging'
);

DELETE FROM public.api_rate_limit_receipts
WHERE request_key IN (
  repeat('a', 64),
  repeat('d', 64),
  repeat('e', 64),
  repeat('1', 64)
);
DELETE FROM public.api_rate_limits
WHERE rate_limit_key LIKE 'pgtap:atomic-ai-quota:%';

SELECT extensions.ok(
  (
    SELECT allowed AND NOT replayed
    FROM public.consume_ai_quota(
      repeat('a', 64),
      repeat('b', 64),
      jsonb_build_array(
        jsonb_build_object('key', 'pgtap:atomic-ai-quota:user', 'limit', 10),
        jsonb_build_object('key', 'pgtap:atomic-ai-quota:ip', 'limit', 30)
      ),
      600
    )
  ),
  'a fresh combined quota request is allowed'
);

SELECT extensions.results_eq(
  $$
    SELECT rate_limit_key, request_count
    FROM public.api_rate_limits
    WHERE rate_limit_key IN (
      'pgtap:atomic-ai-quota:user',
      'pgtap:atomic-ai-quota:ip'
    )
    ORDER BY rate_limit_key
  $$,
  $$
    VALUES
      ('pgtap:atomic-ai-quota:ip'::text, 1),
      ('pgtap:atomic-ai-quota:user'::text, 1)
  $$,
  'one transaction charges every combined bucket exactly once'
);

SELECT extensions.ok(
  (
    SELECT allowed
    FROM public.consume_ai_quota(
      repeat('a', 64),
      repeat('b', 64),
      jsonb_build_array(
        jsonb_build_object('key', 'pgtap:atomic-ai-quota:user', 'limit', 10),
        jsonb_build_object('key', 'pgtap:atomic-ai-quota:ip', 'limit', 30)
      ),
      600
    )
  ),
  'an exact request replay returns the durable allowed decision'
);

SELECT extensions.ok(
  (
    SELECT replayed
    FROM public.consume_ai_quota(
      repeat('a', 64),
      repeat('b', 64),
      jsonb_build_array(
        jsonb_build_object('key', 'pgtap:atomic-ai-quota:user', 'limit', 10),
        jsonb_build_object('key', 'pgtap:atomic-ai-quota:ip', 'limit', 30)
      ),
      600
    )
  ),
  'an exact request replay is identified as replayed'
);

SELECT extensions.results_eq(
  $$
    SELECT rate_limit_key, request_count
    FROM public.api_rate_limits
    WHERE rate_limit_key IN (
      'pgtap:atomic-ai-quota:user',
      'pgtap:atomic-ai-quota:ip'
    )
    ORDER BY rate_limit_key
  $$,
  $$
    VALUES
      ('pgtap:atomic-ai-quota:ip'::text, 1),
      ('pgtap:atomic-ai-quota:user'::text, 1)
  $$,
  'an exact replay consumes no additional quota'
);

INSERT INTO public.api_rate_limits (
  rate_limit_key,
  window_started_at,
  request_count,
  updated_at
)
VALUES
  ('pgtap:atomic-ai-quota:denied-user', clock_timestamp(), 3, clock_timestamp()),
  ('pgtap:atomic-ai-quota:denied-ip', clock_timestamp(), 1, clock_timestamp());

SELECT extensions.ok(
  NOT (
    SELECT allowed
    FROM public.consume_ai_quota(
      repeat('d', 64),
      repeat('c', 64),
      jsonb_build_array(
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:denied-user',
          'limit',
          10
        ),
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:denied-ip',
          'limit',
          1
        )
      ),
      600
    )
  ),
  'a full second bucket denies the combined request'
);

SELECT extensions.is(
  (
    SELECT request_count
    FROM public.api_rate_limits
    WHERE rate_limit_key = 'pgtap:atomic-ai-quota:denied-user'
  ),
  3,
  'a second-bucket denial does not consume the first bucket'
);

SELECT extensions.ok(
  (
    SELECT replayed
    FROM public.consume_ai_quota(
      repeat('d', 64),
      repeat('c', 64),
      jsonb_build_array(
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:denied-user',
          'limit',
          10
        ),
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:denied-ip',
          'limit',
          1
        )
      ),
      600
    )
  ),
  'a repeated denial is replayed without touching either bucket'
);

INSERT INTO public.api_rate_limits (
  rate_limit_key,
  window_started_at,
  request_count,
  updated_at
)
VALUES (
  'pgtap:atomic-ai-quota:error-first',
  clock_timestamp(),
  2,
  clock_timestamp()
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.consume_ai_quota(
      repeat('e', 64),
      repeat('f', 64),
      jsonb_build_array(
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:error-first',
          'limit',
          10
        ),
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:error-second',
          'limit',
          0
        )
      ),
      600
    )
  $$,
  '22023',
  'invalid AI quota buckets',
  'an invalid second bucket aborts the entire request'
);

SELECT extensions.is(
  (
    SELECT request_count
    FROM public.api_rate_limits
    WHERE rate_limit_key = 'pgtap:atomic-ai-quota:error-first'
  ),
  2,
  'a second-bucket error does not consume the first bucket'
);

SELECT extensions.ok(
  (
    SELECT allowed
    FROM public.consume_ai_quota(
      repeat('1', 64),
      repeat('2', 64),
      jsonb_build_array(
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:conflict',
          'limit',
          10
        )
      ),
      600
    )
  ),
  'the conflicting-replay fixture is accepted once'
);

SELECT extensions.throws_ok(
  $$
    SELECT *
    FROM public.consume_ai_quota(
      repeat('1', 64),
      repeat('3', 64),
      jsonb_build_array(
        jsonb_build_object(
          'key',
          'pgtap:atomic-ai-quota:conflict',
          'limit',
          10
        )
      ),
      600
    )
  $$,
  '22023',
  'AI quota request key scope mismatch',
  'a request key cannot be replayed with a different fingerprint'
);

SELECT * FROM extensions.finish();

ROLLBACK;
