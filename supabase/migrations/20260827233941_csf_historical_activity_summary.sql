-- Give the officer Activities screen a bounded, grouped projection of the
-- exact labels already committed to each member's historical activity ledger.
-- This does not turn historical evidence into a claimable current activity.

BEGIN;

CREATE INDEX IF NOT EXISTS csf_profile_activity_events_historical_summary_idx
  ON plugin_data.csf_profile_activity_events (organization_id, term_id)
  WHERE source = 'sheet' AND event_type = 'legacy_import';

CREATE OR REPLACE FUNCTION plugin_data.csf_list_historical_activity_summaries(
  p_organization_id uuid,
  p_term_id uuid DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 250
)
RETURNS TABLE (
  activity_key text,
  title text,
  term_id uuid,
  term_code text,
  term_label text,
  cohort_id uuid,
  cohort_label text,
  member_count bigint,
  record_count bigint,
  minimum_points numeric,
  maximum_points numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH historical AS (
    SELECT
      lower(regexp_replace(btrim(event.title), '[[:space:]]+', ' ', 'g')) AS activity_key,
      btrim(event.title) AS title,
      event.term_id,
      term.code AS term_code,
      coalesce(nullif(btrim(term.label), ''), term.code) AS term_label,
      source.cohort_id,
      cohort.label AS cohort_label,
      event.profile_id,
      event.id,
      event.counted_points
    FROM plugin_data.csf_profile_activity_events AS event
    JOIN plugin_data.csf_terms AS term
      ON term.organization_id = event.organization_id
     AND term.id = event.term_id
    JOIN plugin_data.csf_sheet_sources AS source
      ON source.organization_id = event.organization_id
     AND source.id::text = event.source_ref ->> 'sourceId'
    LEFT JOIN plugin_data.csf_cohorts AS cohort
      ON cohort.organization_id = source.organization_id
     AND cohort.id = source.cohort_id
    WHERE event.organization_id = p_organization_id
      AND event.source = 'sheet'
      AND event.event_type = 'legacy_import'
      AND event.source_ref @> '{"processor":"class_history_import"}'::jsonb
      AND nullif(btrim(event.title), '') IS NOT NULL
      AND (p_term_id IS NULL OR event.term_id = p_term_id)
      AND (p_cohort_id IS NULL OR source.cohort_id = p_cohort_id)
  )
  SELECT
    historical.activity_key,
    min(historical.title) AS title,
    historical.term_id,
    historical.term_code,
    historical.term_label,
    historical.cohort_id,
    min(historical.cohort_label) AS cohort_label,
    count(DISTINCT historical.profile_id) AS member_count,
    count(historical.id) AS record_count,
    min(historical.counted_points) AS minimum_points,
    max(historical.counted_points) AS maximum_points
  FROM historical
  GROUP BY
    historical.activity_key,
    historical.term_id,
    historical.term_code,
    historical.term_label,
    historical.cohort_id
  ORDER BY historical.term_code DESC, title ASC, historical.activity_key ASC
  LIMIT greatest(1, least(coalesce(p_limit, 250), 500));
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_historical_activity_summaries(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_list_historical_activity_summaries(
  uuid, uuid, uuid, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_list_historical_activity_summaries(
  uuid, uuid, uuid, integer
) IS
'Returns a bounded organization-scoped summary of reviewed class-workbook activity labels and their per-member awarded-point range. Service-role only; historical rows remain non-claimable evidence.';

COMMIT;
