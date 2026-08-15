-- Give AI usage logging a write path that exists.
--
-- lib/ai/usage-tracker.ts called `supabase.rpc('execute_sql', { query, args })`.
-- No such function has ever existed in this database. Every call therefore
-- failed, and because logAiUsage catches and console.errors without
-- propagating, the failure was invisible: `plugin_data.ai_usage_log` held zero
-- rows on both local and hosted Development while AI features ran normally.
-- Rate limiting was unaffected (it uses public.consume_ai_quota), so only cost
-- and billing attribution were lost.
--
-- plugin_data is deliberately not exposed through the Data API, so supabase-js
-- cannot insert into it directly. A service-role-only SECURITY DEFINER function
-- in public is the same shape already used by public.consume_ai_quota.

CREATE OR REPLACE FUNCTION public.log_ai_usage(
  p_gateway_scope text,
  p_model_id text,
  p_organization_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_plugin_key text DEFAULT NULL,
  p_feature text DEFAULT NULL,
  p_input_tokens integer DEFAULT 0,
  p_output_tokens integer DEFAULT 0,
  p_estimated_cost_usd numeric DEFAULT NULL,
  p_latency_ms integer DEFAULT NULL,
  p_success boolean DEFAULT true,
  p_error_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  -- COALESCE and GREATEST are SQL constructs resolved by the parser, not
  -- pg_catalog functions; they must not be schema-qualified even under
  -- `SET search_path = ''`.
  v_input_tokens integer := greatest(coalesce(p_input_tokens, 0), 0);
  v_output_tokens integer := greatest(coalesce(p_output_tokens, 0), 0);
BEGIN
  IF p_gateway_scope IS NULL OR pg_catalog.btrim(p_gateway_scope) = '' THEN
    RAISE EXCEPTION 'log_ai_usage requires a gateway scope';
  END IF;

  IF p_model_id IS NULL OR pg_catalog.btrim(p_model_id) = '' THEN
    RAISE EXCEPTION 'log_ai_usage requires a model id';
  END IF;

  -- total_tokens is a GENERATED column (input_tokens + output_tokens) and must
  -- not appear in the column list; the database derives it, so the billing
  -- total cannot disagree with its own components.
  INSERT INTO plugin_data.ai_usage_log (
    organization_id,
    user_id,
    plugin_key,
    gateway_scope,
    model_id,
    feature,
    input_tokens,
    output_tokens,
    estimated_cost_usd,
    latency_ms,
    success,
    error_message,
    metadata
  )
  VALUES (
    p_organization_id,
    p_user_id,
    p_plugin_key,
    p_gateway_scope,
    p_model_id,
    p_feature,
    v_input_tokens,
    v_output_tokens,
    p_estimated_cost_usd,
    p_latency_ms,
    coalesce(p_success, true),
    p_error_message,
    coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_ai_usage(
  text, text, uuid, uuid, text, text, integer, integer, numeric, integer, boolean, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.log_ai_usage(
  text, text, uuid, uuid, text, text, integer, integer, numeric, integer, boolean, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.log_ai_usage(
  text, text, uuid, uuid, text, text, integer, integer, numeric, integer, boolean, text, jsonb
) IS
  'Service-role-only AI usage/billing attribution write into plugin_data.ai_usage_log; intentionally excluded from the client-callable public function catalog.';
