-- Aggregate verified credits for bounded officer review rosters.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_credit_totals(
  p_organization_id uuid,
  p_term_id uuid,
  p_profile_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_term_id IS NULL
    OR p_profile_ids IS NULL
    OR pg_catalog.cardinality(p_profile_ids) > 1000
    OR pg_catalog.array_position(p_profile_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'A chapter, semester and at most 1000 profile IDs are required.'
      USING ERRCODE = '22023';
  END IF;

  -- A single JSON value preserves the whole bounded result across API row caps.
  RETURN (
    SELECT coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('profile_id', totals.profile_id, 'points', totals.points)
      ORDER BY totals.profile_id
    ), '[]'::jsonb)
    FROM (
      SELECT credit.profile_id, pg_catalog.sum(credit.points) AS points
      FROM plugin_data.csf_credit_records AS credit
      WHERE credit.organization_id = p_organization_id
        AND credit.term_id = p_term_id
        AND credit.status = 'verified'
        AND credit.profile_id = ANY(p_profile_ids)
      GROUP BY credit.profile_id
    ) AS totals
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_review_credit_totals(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_credit_totals(uuid, uuid, uuid[])
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_review_credit_totals(uuid, uuid, uuid[]) IS
  'Server-only verified credit totals for an authorized review roster. Requires explicit chapter, semester and up to 1000 profile IDs. Does not grant access or change credit records.';

COMMIT;
