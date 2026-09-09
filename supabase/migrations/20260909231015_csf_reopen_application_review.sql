BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_review_period(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_kind text,
  p_status text,
  p_title text,
  p_instructions text DEFAULT NULL,
  p_opens_at timestamptz DEFAULT NULL,
  p_closes_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_before jsonb;
  v_reopening boolean := false;
  v_kind plugin_data.csf_review_period_kind := p_kind::plugin_data.csf_review_period_kind;
  v_status plugin_data.csf_review_period_status := p_status::plugin_data.csf_review_period_status;
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF review periods.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to manage CSF review periods.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'A review period needs a title.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND term_id = p_term_id AND kind = v_kind
  FOR UPDATE;

  v_before := pg_catalog.to_jsonb(v_period);

  IF FOUND AND v_period.status = v_status
    AND v_period.title IS NOT DISTINCT FROM v_title
    AND v_period.instructions IS NOT DISTINCT FROM p_instructions
    AND v_period.opens_at IS NOT DISTINCT FROM p_opens_at
    AND v_period.closes_at IS NOT DISTINCT FROM p_closes_at THEN
    RETURN pg_catalog.to_jsonb(v_period);
  END IF;

  v_reopening := FOUND AND v_period.status = 'closed'
    AND v_kind = 'membership_applications' AND v_status = 'open';
  IF FOUND AND v_period.status = 'closed' AND NOT v_reopening THEN
    RAISE EXCEPTION 'This review period is already closed.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT FOUND THEN
    INSERT INTO plugin_data.csf_review_periods (
      organization_id, term_id, kind, status, title, instructions, opens_at, closes_at,
      opened_by, opened_at, created_by
    )
    VALUES (
      p_organization_id, p_term_id, v_kind, v_status, v_title, p_instructions, p_opens_at, p_closes_at,
      CASE WHEN v_status = 'draft' THEN NULL ELSE p_actor_user_id END,
      CASE WHEN v_status = 'draft' THEN NULL ELSE v_now END,
      p_actor_user_id
    )
    RETURNING * INTO v_period;
  ELSE
    UPDATE plugin_data.csf_review_periods
       SET status = v_status,
           title = v_title,
           instructions = p_instructions,
           opens_at = p_opens_at,
           closes_at = p_closes_at,
           opened_by = CASE
             WHEN v_status = 'draft' THEN NULL
             ELSE coalesce(opened_by, p_actor_user_id)
           END,
           opened_at = CASE
             WHEN v_status = 'draft' THEN NULL
             ELSE coalesce(opened_at, v_now)
           END,
           closed_by = CASE WHEN v_status = 'closed' THEN p_actor_user_id ELSE NULL END,
           closed_at = CASE WHEN v_status = 'closed' THEN v_now ELSE NULL END,
           updated_at = v_now
     WHERE id = v_period.id
    RETURNING * INTO v_period;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, before_data, after_data
  )
  VALUES (
    p_organization_id, p_actor_user_id,
    CASE WHEN v_reopening THEN 'review_period.reopened' ELSE 'review_period.' || v_status::text END,
    'csf_review_period', v_period.id, p_term_id, v_before, pg_catalog.to_jsonb(v_period)
  );

  RETURN pg_catalog.to_jsonb(v_period);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_review_period(uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_review_period(uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz) TO service_role;

COMMIT;
