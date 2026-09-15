-- CSF earning ceiling and application intake guards (PR 588 follow-up).
--
-- 1. plugin_data.csf_assert_activity_earning_award only compared an award with
--    the activity-wide ceiling. For rule sets whose components span both
--    categories (per_item: drive max 2 beside non-drive max 3; shifts with
--    mixed categories) an officer could approve 3 drive points with a note
--    even though the member selected only the 2-point drive component. The
--    award must now also stay within the ceiling of the components the member
--    actually selected. Signature, authorization, the activity-wide ceiling,
--    the per-person cap, and the duplicate-shift refusal are unchanged, so the
--    begin, resubmit, review, and appeal paths all inherit the fix.
-- 2. plugin_data.csf_set_application_intake now refuses to open intake unless
--    the term is the current open semester. Closing keeps its existing
--    semantics (any non-closed, non-archived term; no-op when already closed).
-- 3. plugin_data.csf_enforce_new_application_intake() receives the explicit
--    postgres execute grant that every owner-only trigger helper carries.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Award assertion: selection-scoped ceiling for mixed-category rule sets
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_activity_earning_award(
  p_organization_id uuid,
  p_profile_id uuid,
  p_opportunity_id uuid,
  p_submission_id uuid,
  p_points numeric,
  p_rules_snapshot jsonb,
  p_selection jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_normalized jsonb;
  v_rules jsonb;
  v_mode text;
  v_ceiling numeric;
  v_selected_count integer := 0;
  v_selected_categories integer := 0;
  v_selected_category text;
  v_selected_sum numeric;
  v_selected_max numeric;
  v_allow_multiple boolean;
  v_selection_ceiling numeric;
  v_verified numeric;
  v_person_cap numeric;
  v_shift_keys text[];
  v_duplicates text;
BEGIN
  IF p_organization_id IS NULL OR p_profile_id IS NULL OR p_opportunity_id IS NULL
    OR p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Activity award assertion inputs are incomplete.';
  END IF;

  -- The eligibility helper already holds the semester advisory lock and this
  -- row lock; taking it again here keeps the assertion safe when a caller
  -- reaches it through another path.
  SELECT activity.*
  INTO v_activity
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id
    AND activity.id = p_opportunity_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;

  IF p_rules_snapshot IS NOT NULL
    AND (p_rules_snapshot -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(p_rules_snapshot);
    v_rules := v_normalized -> 'rules';
    v_mode := v_rules ->> 'mode';
    v_ceiling := (v_normalized ->> 'ceilingPoints')::numeric;
    IF p_points > v_ceiling THEN
      RAISE EXCEPTION 'Awarded points exceed this submission''s maximum of %.',
        pg_catalog.trim_scale(v_ceiling);
    END IF;

    -- The activity-wide ceiling is the larger category ceiling. An override
    -- must also stay within what the selected components can earn: the sum of
    -- selected per-item maximums, the shift policy applied to the selected
    -- shifts, or the single selected component's maximum.
    IF p_selection IS NOT NULL
      AND pg_catalog.jsonb_typeof(p_selection -> 'items') = 'array'
      AND pg_catalog.jsonb_array_length(p_selection -> 'items') > 0 THEN
      SELECT
        pg_catalog.count(*)::integer,
        pg_catalog.count(DISTINCT component.value ->> 'category')::integer,
        pg_catalog.min(component.value ->> 'category'),
        pg_catalog.sum(
          CASE component.value ->> 'kind'
            WHEN 'fixed' THEN (component.value ->> 'points')::numeric
            WHEN 'shift' THEN (component.value ->> 'points')::numeric
            ELSE (component.value ->> 'maxPoints')::numeric
          END
        ),
        pg_catalog.max(
          CASE component.value ->> 'kind'
            WHEN 'fixed' THEN (component.value ->> 'points')::numeric
            WHEN 'shift' THEN (component.value ->> 'points')::numeric
            ELSE (component.value ->> 'maxPoints')::numeric
          END
        )
      INTO v_selected_count, v_selected_categories, v_selected_category,
        v_selected_sum, v_selected_max
      FROM pg_catalog.jsonb_array_elements(v_rules -> 'components') AS component(value)
      WHERE component.value ->> 'key' IN (
        SELECT item.value ->> 'key'
        FROM pg_catalog.jsonb_array_elements(p_selection -> 'items') AS item(value)
        WHERE pg_catalog.jsonb_typeof(item.value) = 'object'
      );
      IF v_selected_count = 0 THEN
        RAISE EXCEPTION 'Selection refers to an unknown component.';
      END IF;
      IF v_selected_categories > 1 THEN
        RAISE EXCEPTION 'Submit drive and non-drive items as separate submissions.';
      END IF;

      IF v_mode = 'shifts' THEN
        v_allow_multiple := coalesce(
          (v_rules -> 'shiftPolicy' ->> 'allowMultiple')::boolean,
          false
        );
        v_selection_ceiling := least(
          (v_rules -> 'shiftPolicy' ->> 'combinedMaxPoints')::numeric,
          CASE WHEN v_allow_multiple THEN v_selected_sum ELSE v_selected_max END
        );
      ELSIF v_mode = 'per_item' THEN
        v_selection_ceiling := v_selected_sum;
      ELSE
        v_selection_ceiling := v_selected_max;
      END IF;
      v_selection_ceiling := least(v_selection_ceiling, v_ceiling);

      IF p_points > v_selection_ceiling THEN
        RAISE EXCEPTION 'Awarded points exceed the maximum of % for the selected % items.',
          pg_catalog.trim_scale(v_selection_ceiling),
          CASE WHEN v_selected_category = 'drive' THEN 'drive' ELSE 'non-drive' END;
      END IF;
    END IF;
  END IF;

  SELECT least(v_activity.point_cap, policy.max_points_per_activity)
  INTO v_person_cap
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_activity.term_id
    AND policy.published_at IS NOT NULL;
  IF v_person_cap IS NULL THEN
    RAISE EXCEPTION 'A published semester policy is required for this point action.';
  END IF;

  IF v_person_cap IS NOT NULL THEN
    SELECT coalesce(pg_catalog.sum(credit.points), 0)
    INTO v_verified
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.profile_id = p_profile_id
      AND credit.opportunity_id = p_opportunity_id
      AND credit.status = 'verified'
      AND credit.submission_id IS DISTINCT FROM p_submission_id;
    IF v_verified + p_points > v_person_cap THEN
      RAISE EXCEPTION 'This activity allows at most % points per person; % already verified.',
        v_person_cap, v_verified;
    END IF;
  END IF;

  IF p_rules_snapshot ->> 'mode' = 'shifts' AND p_selection IS NOT NULL THEN
    SELECT pg_catalog.array_agg(element.value ->> 'key')
    INTO v_shift_keys
    FROM pg_catalog.jsonb_array_elements(coalesce(p_selection -> 'items', '[]'::jsonb)) AS element(value);
    IF coalesce(pg_catalog.array_length(v_shift_keys, 1), 0) > 0 THEN
      SELECT pg_catalog.string_agg(DISTINCT element.value ->> 'key', ', ')
      INTO v_duplicates
      FROM plugin_data.csf_point_submissions AS prior
      JOIN plugin_data.csf_credit_records AS credit
        ON credit.organization_id = prior.organization_id
       AND credit.submission_id = prior.id
       AND credit.status = 'verified'
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
        coalesce(prior.earning_selection -> 'items', '[]'::jsonb)
      ) AS element(value)
      WHERE prior.organization_id = p_organization_id
        AND prior.profile_id = p_profile_id
        AND prior.opportunity_id = p_opportunity_id
        AND prior.id IS DISTINCT FROM p_submission_id
        AND prior.earning_rules_snapshot ->> 'mode' = 'shifts'
        AND element.value ->> 'key' = ANY (v_shift_keys);
      IF v_duplicates IS NOT NULL THEN
        RAISE EXCEPTION 'Shift % was already awarded for this member.', v_duplicates;
      END IF;
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION plugin_data.csf_assert_activity_earning_award(
  uuid, uuid, uuid, uuid, numeric, jsonb, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_activity_earning_award(
  uuid, uuid, uuid, uuid, numeric, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_activity_earning_award(
  uuid, uuid, uuid, uuid, numeric, jsonb, jsonb
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_assert_activity_earning_award(uuid, uuid, uuid, uuid, numeric, jsonb, jsonb) IS
  'Under the semester lock: enforces the activity-wide ceiling of a rule snapshot, the ceiling of the components the member selected, the activity''s per-person maximum across verified credit, and refuses re-awarding a shift already verified for the member.';

-- ---------------------------------------------------------------------------
-- B. Application intake: opening requires the current open semester
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_set_application_intake(
  p_organization_id uuid,
  p_term_id uuid,
  p_accepts_new_applications boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_terms%ROWTYPE;
  v_after plugin_data.csf_terms%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_staff_access:' || p_organization_id::text,
      0
    )
  );

  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_cohorts_terms'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF application intake.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_accepts_new_applications IS NULL THEN
    RAISE EXCEPTION 'Choose whether this semester accepts new applications.'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Serialize the decision with the native-application insert guard. The
  -- staff-access lock stays first so permission changes keep their established
  -- ordering before any term-scoped intake work.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_term_id::text,
      0
    )
  );

  SELECT term.* INTO v_before
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semester was not found in this organization.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_before.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived CSF semesters cannot accept new applications.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Only the current open semester may take new native applications. A planned
  -- future term or a previous term that is still open cannot be switched on,
  -- and the check runs before the no-op return so a stale "open" request for a
  -- term that stopped being current is refused rather than reported unchanged.
  IF p_accepts_new_applications
    AND (v_before.is_current IS DISTINCT FROM true
      OR v_before.lifecycle_status <> 'open') THEN
    RAISE EXCEPTION 'Only the current open CSF semester can accept new applications.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_before.accepts_new_applications = p_accepts_new_applications THEN
    RETURN pg_catalog.jsonb_build_object(
      'termId', v_before.id,
      'acceptsNewApplications', v_before.accepts_new_applications,
      'changed', false
    );
  END IF;

  UPDATE plugin_data.csf_terms
  SET accepts_new_applications = p_accepts_new_applications,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id
    AND id = p_term_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    CASE
      WHEN p_accepts_new_applications THEN 'application_intake.opened'
      ELSE 'application_intake.closed'
    END,
    'csf_terms',
    v_after.id,
    v_after.id,
    pg_catalog.jsonb_build_object('acceptsNewApplications', v_before.accepts_new_applications),
    pg_catalog.jsonb_build_object('acceptsNewApplications', v_after.accepts_new_applications),
    'staff_action',
    v_after.id::text,
    CASE
      WHEN p_accepts_new_applications THEN 'native_application_intake_opened'
      ELSE 'native_application_intake_closed'
    END
  );

  RETURN pg_catalog.jsonb_build_object(
    'termId', v_after.id,
    'acceptsNewApplications', v_after.accepts_new_applications,
    'changed', true
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_set_application_intake(uuid, uuid, boolean, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_application_intake(uuid, uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_intake(uuid, uuid, boolean, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_set_application_intake(uuid, uuid, boolean, uuid) IS
  'Service-only, permission-checked switch for new native website applications in one organization term. Opening requires the current open semester; closing works for any semester that is not closed or archived.';

-- ---------------------------------------------------------------------------
-- C. Trigger helper ACL: explicit owner grant beside the revoke
-- ---------------------------------------------------------------------------

ALTER FUNCTION plugin_data.csf_enforce_new_application_intake() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_enforce_new_application_intake()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_new_application_intake() TO postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
