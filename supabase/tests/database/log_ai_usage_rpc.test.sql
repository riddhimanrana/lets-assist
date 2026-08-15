BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

-- The regression: usage-tracker.ts called a function that did not exist, and the
-- caller swallowed the failure. Existence is therefore the first assertion.
SELECT extensions.has_function(
  'public',
  'log_ai_usage',
  'AI usage logging has a callable write path'
);

SELECT extensions.is(
  (
    SELECT prosecdef
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'log_ai_usage'
  ),
  true,
  'log_ai_usage is SECURITY DEFINER so it can reach the unexposed plugin_data schema'
);

-- Client roles must never reach billing attribution directly.
WITH roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
)
SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)
    FROM roles
    WHERE pg_catalog.has_function_privilege(
      roles.role_name,
      'public.log_ai_usage(text, text, uuid, uuid, text, text, integer, integer, numeric, integer, boolean, text, jsonb)',
      'EXECUTE'
    )
  ),
  0::bigint,
  'client roles cannot execute log_ai_usage'
);

SELECT extensions.is(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.log_ai_usage(text, text, uuid, uuid, text, text, integer, integer, numeric, integer, boolean, text, jsonb)',
    'EXECUTE'
  ),
  true,
  'service_role can execute log_ai_usage'
);

-- A row actually lands.
SELECT extensions.isnt(
  public.log_ai_usage(
    p_gateway_scope := 'platform',
    p_model_id := 'google/gemini-2.5-flash-lite',
    p_feature := 'paper-signup-scan',
    p_input_tokens := 1800,
    p_output_tokens := 400,
    p_latency_ms := 4200
  ),
  NULL,
  'log_ai_usage returns the inserted row id'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)
    FROM plugin_data.ai_usage_log
    WHERE feature = 'paper-signup-scan'
  ),
  1::bigint,
  'the usage row is written to plugin_data.ai_usage_log'
);

-- total_tokens is derived, not trusted, so billing cannot self-contradict.
SELECT extensions.is(
  (
    SELECT total_tokens
    FROM plugin_data.ai_usage_log
    WHERE feature = 'paper-signup-scan'
  ),
  2200,
  'total_tokens is derived from input + output'
);

-- Required inputs are rejected rather than written as junk.
SELECT extensions.throws_ok(
  $$SELECT public.log_ai_usage(p_gateway_scope := '', p_model_id := 'google/gemini-2.5-flash-lite')$$,
  NULL,
  NULL,
  'a blank gateway scope is rejected'
);

SELECT extensions.throws_ok(
  $$SELECT public.log_ai_usage(p_gateway_scope := 'platform', p_model_id := '')$$,
  NULL,
  NULL,
  'a blank model id is rejected'
);

SELECT * FROM extensions.finish();

ROLLBACK;
