-- Flexible CSF activity earning rules.
--
-- An activity may now carry a versioned earning rule set (fixed award,
-- quantity, per item, selectable shifts, officer assessment) whose components
-- each name an explicit drive/non-drive category. Members choose what they did,
-- the database calculates the suggested points, and every submission keeps a
-- snapshot of the rules and selection it was evaluated under. Rule edits bump
-- the activity's rules version and never touch awarded history.
--
-- `point_cap` is now the per-person maximum for the activity: approvals add
-- the new award to the member's already-verified credit for that activity
-- under the semester lock. `point_value`/`point_type` remain the legacy fixed
-- award for activities without rules and hold the per-submission ceiling and lead
-- category for activities with rules, so every existing reader keeps working.
--
-- Wrapper signatures are unchanged. The request-aware begin/resubmit writers
-- gain `_v2` entrypoints that accept the member's selection; the original
-- signatures delegate to them so no service-role caller can skip the rules.
-- Restated bodies reproduce the live definitions, including the generic
-- `plugins` bucket coordinates applied by 20260818040246.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_opportunities
  ADD COLUMN IF NOT EXISTS earning_rules jsonb,
  ADD COLUMN IF NOT EXISTS earning_rules_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS external_capacity text,
  ADD COLUMN IF NOT EXISTS signup_links jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE plugin_data.csf_opportunities
  DROP CONSTRAINT IF EXISTS csf_opportunities_earning_rules_object_check,
  ADD CONSTRAINT csf_opportunities_earning_rules_object_check
    CHECK (earning_rules IS NULL OR pg_catalog.jsonb_typeof(earning_rules) = 'object'),
  DROP CONSTRAINT IF EXISTS csf_opportunities_earning_rules_version_check,
  ADD CONSTRAINT csf_opportunities_earning_rules_version_check
    CHECK (earning_rules_version >= 1),
  DROP CONSTRAINT IF EXISTS csf_opportunities_external_capacity_check,
  ADD CONSTRAINT csf_opportunities_external_capacity_check
    CHECK (external_capacity IS NULL OR pg_catalog.length(external_capacity) <= 500),
  DROP CONSTRAINT IF EXISTS csf_opportunities_signup_links_array_check,
  ADD CONSTRAINT csf_opportunities_signup_links_array_check
    CHECK (pg_catalog.jsonb_typeof(signup_links) = 'array');

ALTER TABLE plugin_data.csf_opportunities
  DROP CONSTRAINT csf_opportunities_point_cap_check,
  ADD CONSTRAINT csf_opportunities_point_cap_check CHECK (
    point_cap IS NULL OR (
      point_cap > 0 AND (earning_rules IS NOT NULL OR point_cap >= point_value)
    )
  );

COMMENT ON COLUMN plugin_data.csf_opportunities.earning_rules IS
  'Version 1 earning rules (mode + categorized components). NULL keeps the legacy fixed award from point_value/point_type.';
COMMENT ON COLUMN plugin_data.csf_opportunities.earning_rules_version IS
  'Increments whenever earning rules, point value, point type, or the per-person maximum change. Submissions snapshot the version they were evaluated under.';
COMMENT ON COLUMN plugin_data.csf_opportunities.point_cap IS
  'Maximum verified points one member may earn from this activity across all of their submissions. NULL means no per-person maximum beyond the semester policy.';
COMMENT ON COLUMN plugin_data.csf_opportunities.external_capacity IS
  'Descriptive external volunteer capacity shown to members (for example "20 volunteers per shift"). Never a point limit.';
COMMENT ON COLUMN plugin_data.csf_opportunities.signup_links IS
  'Additional {label, url} signup links beside the single signup_url.';

ALTER TABLE plugin_data.csf_point_submissions
  ADD COLUMN IF NOT EXISTS earning_rules_version integer,
  ADD COLUMN IF NOT EXISTS earning_rules_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS earning_selection jsonb,
  ADD COLUMN IF NOT EXISTS suggested_points numeric(6,2);

-- Keep one unfinished submission per activity. A reviewed rules-based
-- submission can be followed by another shift or donation submission.
-- Legacy activities retain their original single-submission behavior.
DROP INDEX plugin_data.csf_point_submissions_one_active_activity_claim_idx;
CREATE UNIQUE INDEX csf_point_submissions_one_active_activity_claim_idx
  ON plugin_data.csf_point_submissions (organization_id, profile_id, term_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL
    AND status NOT IN ('rejected', 'duplicate', 'withdrawn')
    AND (status <> 'approved' OR earning_rules_snapshot IS NULL
      OR earning_rules_snapshot -> 'legacy' = 'true'::jsonb);

ALTER TABLE plugin_data.csf_point_submissions
  DROP CONSTRAINT IF EXISTS csf_point_submissions_earning_rules_version_check,
  ADD CONSTRAINT csf_point_submissions_earning_rules_version_check
    CHECK (earning_rules_version IS NULL OR earning_rules_version >= 1),
  DROP CONSTRAINT IF EXISTS csf_point_submissions_earning_rules_snapshot_check,
  ADD CONSTRAINT csf_point_submissions_earning_rules_snapshot_check
    CHECK (earning_rules_snapshot IS NULL OR pg_catalog.jsonb_typeof(earning_rules_snapshot) = 'object'),
  DROP CONSTRAINT IF EXISTS csf_point_submissions_earning_selection_check,
  ADD CONSTRAINT csf_point_submissions_earning_selection_check
    CHECK (earning_selection IS NULL OR pg_catalog.jsonb_typeof(earning_selection) = 'object'),
  DROP CONSTRAINT IF EXISTS csf_point_submissions_suggested_points_check,
  ADD CONSTRAINT csf_point_submissions_suggested_points_check
    CHECK (suggested_points IS NULL OR suggested_points > 0);

COMMENT ON COLUMN plugin_data.csf_point_submissions.earning_rules_snapshot IS
  'The activity earning rules this submission was evaluated under. Later rule edits never rewrite it.';
COMMENT ON COLUMN plugin_data.csf_point_submissions.earning_selection IS
  'The member selection ({version, items:[{key, quantity}]}) the suggested points were calculated from.';
COMMENT ON COLUMN plugin_data.csf_point_submissions.suggested_points IS
  'Rule-calculated points for the selection. NULL for officer-assessed activities, where the reviewer decides.';

-- ---------------------------------------------------------------------------
-- B. Pure rule helpers (owner-only, mirrored by services/activity-earning-rules.ts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_earning_points_value(
  p_value jsonb,
  p_field text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_points numeric;
BEGIN
  IF p_value IS NULL OR pg_catalog.jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION '% must be a positive number with at most two decimals, up to 100.', p_field;
  END IF;
  v_points := (p_value #>> '{}')::numeric;
  IF v_points <= 0 OR v_points > 100 OR pg_catalog.round(v_points, 2) <> v_points THEN
    RAISE EXCEPTION '% must be a positive number with at most two decimals, up to 100.', p_field;
  END IF;
  RETURN v_points;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_normalize_earning_rules(p_rules jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_mode text;
  v_components jsonb;
  v_component jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_count integer;
  v_key text;
  v_label text;
  v_category text;
  v_kind text;
  v_expected_kind text;
  v_keys text[] := ARRAY[]::text[];
  v_points numeric;
  v_max numeric;
  v_per_group numeric;
  v_units numeric;
  v_unit_label text;
  v_instructions text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_shift_policy jsonb;
  v_allow_multiple boolean;
  v_combined_max numeric;
  v_ceiling_non_drive numeric := 0;
  v_ceiling_drive numeric := 0;
  v_shift_sum_non_drive numeric := 0;
  v_shift_sum_drive numeric := 0;
  v_shift_max_non_drive numeric := 0;
  v_shift_max_drive numeric := 0;
  v_ceiling numeric;
  v_ceiling_type text;
  v_result jsonb;
BEGIN
  IF p_rules IS NULL OR pg_catalog.jsonb_typeof(p_rules) <> 'object' THEN
    RAISE EXCEPTION 'Earning rules must be an object.';
  END IF;
  -- Type guards stay in their own statements: SQL does not promise
  -- left-to-right short-circuiting inside one OR chain.
  IF pg_catalog.jsonb_typeof(p_rules -> 'version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Earning rules version 1 is required.';
  END IF;
  IF (p_rules ->> 'version')::numeric <> 1 THEN
    RAISE EXCEPTION 'Earning rules version 1 is required.';
  END IF;
  v_mode := p_rules ->> 'mode';
  IF v_mode IS NULL
    OR v_mode NOT IN ('fixed', 'quantity', 'per_item', 'shifts', 'assessment') THEN
    RAISE EXCEPTION 'Choose a valid earning mode.';
  END IF;
  v_components := p_rules -> 'components';
  IF v_components IS NULL OR pg_catalog.jsonb_typeof(v_components) <> 'array' THEN
    RAISE EXCEPTION 'Earning rules need at least one component.';
  END IF;
  v_count := pg_catalog.jsonb_array_length(v_components);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Earning rules need at least one component.';
  END IF;
  IF v_count > 20 THEN
    RAISE EXCEPTION 'Earning rules need between 1 and 20 components.';
  END IF;
  IF v_mode IN ('fixed', 'quantity', 'assessment') AND v_count <> 1 THEN
    RAISE EXCEPTION 'This earning mode uses exactly one component.';
  END IF;
  v_expected_kind := CASE v_mode
    WHEN 'fixed' THEN 'fixed'
    WHEN 'quantity' THEN 'quantity'
    WHEN 'per_item' THEN 'per_item'
    WHEN 'shifts' THEN 'shift'
    ELSE 'assessment'
  END;

  FOR v_component IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(v_components) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_component) <> 'object' THEN
      RAISE EXCEPTION 'Each earning component must be an object.';
    END IF;
    v_key := pg_catalog.btrim(coalesce(v_component ->> 'key', ''));
    IF v_key !~ '^[a-z0-9][a-z0-9-]{0,39}$' THEN
      RAISE EXCEPTION 'Component keys use lowercase letters, numbers, and hyphens.';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'Component keys must be unique.';
    END IF;
    v_keys := pg_catalog.array_append(v_keys, v_key);
    v_label := nullif(pg_catalog.btrim(coalesce(v_component ->> 'label', '')), '');
    IF v_label IS NULL OR pg_catalog.length(v_label) > 120 THEN
      RAISE EXCEPTION 'Each component needs a label of 120 characters or fewer.';
    END IF;
    v_category := v_component ->> 'category';
    IF v_category IS NULL OR v_category NOT IN ('non_drive', 'drive') THEN
      RAISE EXCEPTION 'Each component needs a drive or non-drive category.';
    END IF;
    v_kind := v_component ->> 'kind';
    IF v_kind IS DISTINCT FROM v_expected_kind THEN
      RAISE EXCEPTION 'Component kinds must match the earning mode.';
    END IF;

    IF v_kind = 'fixed' THEN
      v_points := plugin_data.csf_earning_points_value(v_component -> 'points', 'Fixed award points');
      v_normalized := v_normalized || pg_catalog.jsonb_build_object(
        'key', v_key, 'label', v_label, 'category', v_category, 'kind', 'fixed',
        'points', v_points
      );
      IF v_category = 'drive' THEN
        v_ceiling_drive := greatest(v_ceiling_drive, v_points);
      ELSE
        v_ceiling_non_drive := greatest(v_ceiling_non_drive, v_points);
      END IF;
    ELSIF v_kind = 'quantity' THEN
      IF pg_catalog.jsonb_typeof(v_component -> 'unitsPerPoint') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Units per point must be a whole number from 1 to 1000.';
      END IF;
      v_units := (v_component ->> 'unitsPerPoint')::numeric;
      IF v_units < 1 OR v_units > 1000 OR pg_catalog.trunc(v_units) <> v_units THEN
        RAISE EXCEPTION 'Units per point must be a whole number from 1 to 1000.';
      END IF;
      IF v_component -> 'pointsPerGroup' IS NULL
        OR pg_catalog.jsonb_typeof(v_component -> 'pointsPerGroup') = 'null' THEN
        v_per_group := 1;
      ELSE
        v_per_group := plugin_data.csf_earning_points_value(v_component -> 'pointsPerGroup', 'Points per group');
      END IF;
      v_max := plugin_data.csf_earning_points_value(v_component -> 'maxPoints', 'Maximum points');
      v_unit_label := nullif(pg_catalog.btrim(coalesce(v_component ->> 'unitLabel', '')), '');
      IF v_unit_label IS NULL THEN
        v_unit_label := 'items';
      ELSIF pg_catalog.length(v_unit_label) > 40 THEN
        RAISE EXCEPTION 'Unit label must be between 1 and 40 characters.';
      END IF;
      v_normalized := v_normalized || pg_catalog.jsonb_build_object(
        'key', v_key, 'label', v_label, 'category', v_category, 'kind', 'quantity',
        'unitLabel', v_unit_label, 'unitsPerPoint', v_units::integer,
        'pointsPerGroup', v_per_group, 'maxPoints', v_max
      );
      IF v_category = 'drive' THEN
        v_ceiling_drive := greatest(v_ceiling_drive, v_max);
      ELSE
        v_ceiling_non_drive := greatest(v_ceiling_non_drive, v_max);
      END IF;
    ELSIF v_kind = 'per_item' THEN
      v_points := plugin_data.csf_earning_points_value(v_component -> 'pointsPerItem', 'Points per item');
      v_max := plugin_data.csf_earning_points_value(v_component -> 'maxPoints', 'Maximum points');
      v_unit_label := nullif(pg_catalog.btrim(coalesce(v_component ->> 'unitLabel', '')), '');
      IF v_unit_label IS NULL THEN
        v_unit_label := 'items';
      ELSIF pg_catalog.length(v_unit_label) > 40 THEN
        RAISE EXCEPTION 'Unit label must be between 1 and 40 characters.';
      END IF;
      v_normalized := v_normalized || pg_catalog.jsonb_build_object(
        'key', v_key, 'label', v_label, 'category', v_category, 'kind', 'per_item',
        'unitLabel', v_unit_label, 'pointsPerItem', v_points, 'maxPoints', v_max
      );
      IF v_category = 'drive' THEN
        v_ceiling_drive := v_ceiling_drive + v_max;
      ELSE
        v_ceiling_non_drive := v_ceiling_non_drive + v_max;
      END IF;
    ELSIF v_kind = 'shift' THEN
      v_points := plugin_data.csf_earning_points_value(v_component -> 'points', 'Shift points');
      BEGIN
        v_starts_at := nullif(v_component ->> 'startsAt', '')::timestamptz;
        v_ends_at := nullif(v_component ->> 'endsAt', '')::timestamptz;
      EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
        RAISE EXCEPTION 'Shift start must be a valid date and time.';
      END;
      IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
        RAISE EXCEPTION 'Add a shift start before giving it an end time.';
      END IF;
      IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
        RAISE EXCEPTION 'A shift must end after it starts.';
      END IF;
      v_normalized := v_normalized || pg_catalog.jsonb_build_object(
        'key', v_key, 'label', v_label, 'category', v_category, 'kind', 'shift',
        'points', v_points,
        'startsAt', CASE WHEN v_starts_at IS NULL THEN NULL ELSE pg_catalog.to_char(v_starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
        'endsAt', CASE WHEN v_ends_at IS NULL THEN NULL ELSE pg_catalog.to_char(v_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END
      );
      IF v_category = 'drive' THEN
        v_shift_sum_drive := v_shift_sum_drive + v_points;
        v_shift_max_drive := greatest(v_shift_max_drive, v_points);
      ELSE
        v_shift_sum_non_drive := v_shift_sum_non_drive + v_points;
        v_shift_max_non_drive := greatest(v_shift_max_non_drive, v_points);
      END IF;
    ELSE
      v_instructions := nullif(pg_catalog.btrim(coalesce(v_component ->> 'instructions', '')), '');
      IF v_instructions IS NULL OR pg_catalog.length(v_instructions) > 2000 THEN
        RAISE EXCEPTION 'Assessment instructions must be between 1 and 2000 characters.';
      END IF;
      v_max := plugin_data.csf_earning_points_value(v_component -> 'maxPoints', 'Maximum points');
      v_normalized := v_normalized || pg_catalog.jsonb_build_object(
        'key', v_key, 'label', v_label, 'category', v_category, 'kind', 'assessment',
        'instructions', v_instructions, 'maxPoints', v_max
      );
      IF v_category = 'drive' THEN
        v_ceiling_drive := greatest(v_ceiling_drive, v_max);
      ELSE
        v_ceiling_non_drive := greatest(v_ceiling_non_drive, v_max);
      END IF;
    END IF;
  END LOOP;

  v_result := pg_catalog.jsonb_build_object(
    'version', 1,
    'mode', v_mode,
    'components', v_normalized
  );

  IF v_mode = 'shifts' THEN
    v_shift_policy := p_rules -> 'shiftPolicy';
    IF v_shift_policy IS NULL OR pg_catalog.jsonb_typeof(v_shift_policy) <> 'object'
      OR pg_catalog.jsonb_typeof(v_shift_policy -> 'allowMultiple') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Shift rules need a shift policy with allowMultiple.';
    END IF;
    v_allow_multiple := (v_shift_policy ->> 'allowMultiple')::boolean;
    v_combined_max := plugin_data.csf_earning_points_value(v_shift_policy -> 'combinedMaxPoints', 'Combined shift maximum');
    v_ceiling_non_drive := least(
      v_combined_max,
      CASE WHEN v_allow_multiple THEN v_shift_sum_non_drive ELSE v_shift_max_non_drive END
    );
    v_ceiling_drive := least(
      v_combined_max,
      CASE WHEN v_allow_multiple THEN v_shift_sum_drive ELSE v_shift_max_drive END
    );
    v_result := v_result || pg_catalog.jsonb_build_object(
      'shiftPolicy', pg_catalog.jsonb_build_object(
        'allowMultiple', v_allow_multiple,
        'combinedMaxPoints', v_combined_max
      )
    );
  END IF;

  IF v_ceiling_drive > v_ceiling_non_drive THEN
    v_ceiling := v_ceiling_drive;
    v_ceiling_type := 'drive';
  ELSE
    v_ceiling := v_ceiling_non_drive;
    v_ceiling_type := 'non_drive';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'rules', v_result,
    'ceilingPoints', pg_catalog.round(v_ceiling, 2),
    'ceilingPointType', v_ceiling_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_effective_earning_rules(
  p_earning_rules jsonb,
  p_point_value numeric,
  p_point_type text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_earning_rules IS NOT NULL THEN p_earning_rules
    WHEN coalesce(p_point_value, 0) > 0 AND p_point_type IN ('non_drive', 'drive') THEN
      pg_catalog.jsonb_build_object(
        'version', 1,
        'mode', 'fixed',
        'legacy', true,
        'components', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'key', 'fixed',
            'label', 'Activity credit',
            'category', p_point_type,
            'kind', 'fixed',
            'points', p_point_value
          )
        )
      )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_default_earning_selection(p_rules jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_rules ->> 'mode' = 'fixed' AND (p_rules -> 'components' -> 0 ->> 'key') IS NOT NULL THEN
      pg_catalog.jsonb_build_object(
        'version', 1,
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('key', p_rules -> 'components' -> 0 ->> 'key')
        )
      )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_calculate_earning(
  p_rules jsonb,
  p_selection jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_mode text := p_rules ->> 'mode';
  v_items jsonb;
  v_item jsonb;
  v_component jsonb;
  v_key text;
  v_quantity numeric;
  v_category text;
  v_points numeric := 0;
  v_component_points numeric;
  v_count integer := 0;
  v_assessment boolean := false;
  v_shift_keys text[] := ARRAY[]::text[];
  v_component_keys text[] := ARRAY[]::text[];
  v_breakdown jsonb := '[]'::jsonb;
  v_allow_multiple boolean;
  v_combined_max numeric;
BEGIN
  IF p_rules IS NULL OR pg_catalog.jsonb_typeof(p_rules) <> 'object'
    OR v_mode IS NULL
    OR v_mode NOT IN ('fixed', 'quantity', 'per_item', 'shifts', 'assessment') THEN
    RAISE EXCEPTION 'Choose a valid earning mode.';
  END IF;
  IF p_selection IS NULL OR pg_catalog.jsonb_typeof(p_selection) <> 'object' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_selection -> 'version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;
  IF (p_selection ->> 'version')::numeric <> 1 THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_selection -> 'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;
  v_items := p_selection -> 'items';
  IF pg_catalog.jsonb_array_length(v_items) = 0
    OR pg_catalog.jsonb_array_length(v_items) > 20 THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;

  FOR v_item IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(v_items) AS element(value)
  LOOP
    v_count := v_count + 1;
    IF pg_catalog.jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Selection refers to an unknown component.';
    END IF;
    v_key := v_item ->> 'key';
    SELECT element.value
    INTO v_component
    FROM pg_catalog.jsonb_array_elements(p_rules -> 'components') AS element(value)
    WHERE element.value ->> 'key' = v_key
    LIMIT 1;
    IF v_key IS NULL OR v_component IS NULL THEN
      RAISE EXCEPTION 'Selection refers to an unknown component.';
    END IF;
    IF v_key = ANY (v_component_keys) THEN
      RAISE EXCEPTION 'Each component can be selected once.';
    END IF;
    v_component_keys := pg_catalog.array_append(v_component_keys, v_key);

    IF v_category IS NULL THEN
      v_category := v_component ->> 'category';
    ELSIF v_category IS DISTINCT FROM (v_component ->> 'category') THEN
      RAISE EXCEPTION 'Submit drive and non-drive items as separate submissions.';
    END IF;

    v_quantity := NULL;
    IF v_item -> 'quantity' IS NOT NULL AND pg_catalog.jsonb_typeof(v_item -> 'quantity') <> 'null' THEN
      IF pg_catalog.jsonb_typeof(v_item -> 'quantity') <> 'number' THEN
        RAISE EXCEPTION 'Quantities must be whole numbers.';
      END IF;
      v_quantity := (v_item ->> 'quantity')::numeric;
      IF v_quantity < 0 OR v_quantity > 100000 OR pg_catalog.trunc(v_quantity) <> v_quantity THEN
        RAISE EXCEPTION 'Quantities must be whole numbers.';
      END IF;
    END IF;

    IF v_mode = 'fixed' THEN
      IF v_count > 1 OR (v_component ->> 'kind') <> 'fixed' THEN
        RAISE EXCEPTION 'This activity awards one fixed amount.';
      END IF;
      v_component_points := (v_component ->> 'points')::numeric;
      v_points := v_component_points;
    ELSIF v_mode = 'quantity' THEN
      IF v_count > 1 OR (v_component ->> 'kind') <> 'quantity' THEN
        RAISE EXCEPTION 'This activity counts one quantity.';
      END IF;
      IF v_quantity IS NULL THEN
        RAISE EXCEPTION 'Enter how many % you completed.', v_component ->> 'unitLabel';
      END IF;
      v_component_points := least(
        pg_catalog.round(
          pg_catalog.floor(v_quantity / (v_component ->> 'unitsPerPoint')::numeric)
            * (v_component ->> 'pointsPerGroup')::numeric,
          2
        ),
        (v_component ->> 'maxPoints')::numeric
      );
      IF v_component_points <= 0 THEN
        RAISE EXCEPTION 'At least % % are needed for one point.',
          v_component ->> 'unitsPerPoint', v_component ->> 'unitLabel';
      END IF;
      v_points := v_component_points;
    ELSIF v_mode = 'per_item' THEN
      IF (v_component ->> 'kind') <> 'per_item' THEN
        RAISE EXCEPTION 'Selection refers to an unknown component.';
      END IF;
      IF v_quantity IS NULL OR v_quantity < 1 THEN
        RAISE EXCEPTION 'Enter how many % you completed.', v_component ->> 'unitLabel';
      END IF;
      v_component_points := least(
        pg_catalog.round(v_quantity * (v_component ->> 'pointsPerItem')::numeric, 2),
        (v_component ->> 'maxPoints')::numeric
      );
      v_points := pg_catalog.round(v_points + v_component_points, 2);
    ELSIF v_mode = 'shifts' THEN
      IF (v_component ->> 'kind') <> 'shift' THEN
        RAISE EXCEPTION 'Selection refers to an unknown component.';
      END IF;
      v_component_points := (v_component ->> 'points')::numeric;
      v_points := pg_catalog.round(v_points + v_component_points, 2);
      v_shift_keys := pg_catalog.array_append(v_shift_keys, v_key);
    ELSE
      IF v_count > 1 OR (v_component ->> 'kind') <> 'assessment' THEN
        RAISE EXCEPTION 'This activity is assessed by an officer.';
      END IF;
      v_component_points := (v_component ->> 'maxPoints')::numeric;
      v_points := v_component_points;
      v_assessment := true;
    END IF;

    v_breakdown := v_breakdown || pg_catalog.jsonb_build_object(
      'key', v_key,
      'label', v_component ->> 'label',
      'quantity', v_quantity,
      'points', v_component_points
    );
  END LOOP;

  IF v_mode = 'shifts' THEN
    IF pg_catalog.jsonb_typeof(p_rules -> 'shiftPolicy') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Shift rules need a shift policy with allowMultiple.';
    END IF;
    v_allow_multiple := coalesce((p_rules -> 'shiftPolicy' ->> 'allowMultiple')::boolean, false);
    v_combined_max := (p_rules -> 'shiftPolicy' ->> 'combinedMaxPoints')::numeric;
    IF NOT v_allow_multiple AND v_count > 1 THEN
      RAISE EXCEPTION 'Choose one shift for this activity.';
    END IF;
    v_points := least(v_points, v_combined_max);
  END IF;

  IF v_points IS NULL OR v_points <= 0 THEN
    RAISE EXCEPTION 'This selection does not earn any points.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'points', pg_catalog.round(v_points, 2),
    'pointType', v_category,
    'suggestedPoints', CASE WHEN v_assessment THEN NULL ELSE pg_catalog.round(v_points, 2) END,
    'assessment', v_assessment,
    'shiftKeys', pg_catalog.to_jsonb(v_shift_keys),
    'componentKeys', pg_catalog.to_jsonb(v_component_keys),
    'breakdown', v_breakdown
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_normalize_signup_links(p_links jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_link jsonb;
  v_label text;
  v_url text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_links IS NULL OR pg_catalog.jsonb_typeof(p_links) = 'null' THEN
    RETURN v_result;
  END IF;
  IF pg_catalog.jsonb_typeof(p_links) <> 'array' THEN
    RAISE EXCEPTION 'Signup links must be a list.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_links) > 10 THEN
    RAISE EXCEPTION 'Add at most 10 signup links.';
  END IF;
  FOR v_link IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(p_links) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_link) <> 'object' THEN
      RAISE EXCEPTION 'Each signup link needs a label and URL.';
    END IF;
    v_url := pg_catalog.btrim(coalesce(v_link ->> 'url', ''));
    v_label := pg_catalog.btrim(coalesce(v_link ->> 'label', ''));
    IF v_url = '' AND v_label = '' THEN
      CONTINUE;
    END IF;
    IF v_url !~* '^https?://' OR pg_catalog.length(v_url) > 2000 THEN
      RAISE EXCEPTION 'Each signup link must be an http(s) URL under 2000 characters.';
    END IF;
    IF pg_catalog.length(v_label) > 120 THEN
      RAISE EXCEPTION 'Signup link labels must be 120 characters or fewer.';
    END IF;
    v_result := v_result || pg_catalog.jsonb_build_object(
      'label', CASE WHEN v_label = '' THEN 'Signup' ELSE v_label END,
      'url', v_url
    );
  END LOOP;
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Award assertion: per-person cumulative cap, snapshot ceiling, shifts
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
  v_ceiling numeric;
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
    v_ceiling := (plugin_data.csf_normalize_earning_rules(p_rules_snapshot) ->> 'ceilingPoints')::numeric;
    IF p_points > v_ceiling THEN
      RAISE EXCEPTION 'Awarded points exceed this submission''s maximum of %.',
        pg_catalog.trim_scale(v_ceiling);
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

-- ---------------------------------------------------------------------------
-- D. Eligibility: rule-driven activities carry per-selection categories
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_opportunity_id uuid,
  p_partner_club_term_id uuid,
  p_source text,
  p_points numeric,
  p_point_type text,
  p_has_proof boolean,
  p_allow_closed_activity boolean,
  p_allow_legacy_manual boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_source_cap numeric(6,2);
  v_effective_cap numeric(6,2);
  v_proof_required boolean := false;
BEGIN
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points must be greater than zero.';
  END IF;
  IF p_point_type IS NULL OR p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_source IS NULL OR (p_source NOT IN ('student', 'staff')
    AND NOT (coalesce(p_allow_legacy_manual, false) AND p_source = 'manual')) THEN
    RAISE EXCEPTION 'This point source must use its dedicated reconciliation workflow.';
  END IF;
  IF p_source = 'manual'
    AND (p_opportunity_id IS NOT NULL OR p_partner_club_term_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A manual award cannot use a structured point source.';
  END IF;

  -- Match the canonical semester-close/evidence-writer lock before taking
  -- term-scoped row locks. This prevents a close from racing a validated
  -- point transition after its authority snapshot.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_term_id::text,
    0
  ));

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.record_status <> 'active' THEN
    RAISE EXCEPTION 'An active CSF profile is required for this point action.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point actions are only available for the current open semester.';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.status NOT IN ('accepted', 'active') THEN
    RAISE EXCEPTION 'An accepted or active semester membership is required for this point action.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_policy.published_at IS NULL THEN
    RAISE EXCEPTION 'A published semester policy is required for this point action.';
  END IF;
  IF p_points > v_policy.max_points_per_activity THEN
    RAISE EXCEPTION 'Points exceed the semester activity limit of %.',
      v_policy.max_points_per_activity;
  END IF;

  IF p_opportunity_id IS NOT NULL THEN
    SELECT opportunity.*
    INTO v_opportunity
    FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = p_opportunity_id
      AND opportunity.term_id = p_term_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity belongs to a different organization or semester.';
    END IF;
    IF (coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status NOT IN ('published', 'closed'))
      OR (NOT coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status <> 'published') THEN
      RAISE EXCEPTION 'This CSF activity is not available for this point action.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded outside member point submissions.';
    END IF;
    -- Rule-driven activities resolve the category from the selected
    -- components; the stored point_type is only the lead category there.
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive')
      OR (v_opportunity.earning_rules IS NULL
        AND v_opportunity.point_type <> p_point_type) THEN
      RAISE EXCEPTION 'Point type does not match the selected CSF activity.';
    END IF;
    IF v_opportunity.cohort_id IS NOT NULL
      AND v_membership.cohort_id IS DISTINCT FROM v_opportunity.cohort_id THEN
      RAISE EXCEPTION 'This CSF activity is assigned to a different class.';
    END IF;

    v_source_cap := coalesce(
      v_opportunity.point_cap,
      CASE WHEN v_opportunity.point_value > 0 THEN v_opportunity.point_value END,
      v_policy.max_points_per_activity
    );
    v_effective_cap := least(v_policy.max_points_per_activity, v_source_cap);
    IF p_points > v_effective_cap THEN
      RAISE EXCEPTION 'Points exceed the selected activity limit of %.', v_effective_cap;
    END IF;
    v_proof_required := v_opportunity.evidence_policy = 'required';
  ELSIF p_partner_club_term_id IS NOT NULL THEN
    SELECT club_term.*
    INTO v_partner_term
    FROM plugin_data.csf_partner_club_terms AS club_term
    JOIN plugin_data.csf_partner_clubs AS club
      ON club.organization_id = club_term.organization_id
     AND club.id = club_term.partner_club_id
    WHERE club_term.organization_id = p_organization_id
      AND club_term.id = p_partner_club_term_id
      AND club_term.term_id = p_term_id
      AND club.status = 'active'
    FOR UPDATE OF club_term, club;
    IF NOT FOUND OR v_partner_term.workflow_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not active for the current semester.';
    END IF;
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    -- Only active standing is enforced here, bounded by the semester policy
    -- cap already checked above.
    v_proof_required := p_source = 'student';
  ELSE
    IF p_source = 'student' THEN
      IF v_policy.outside_volunteering_allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Outside volunteering is not allowed by the published semester policy.';
      END IF;
      v_proof_required := true;
    ELSE
      -- An authorized staff/manual entry is the only unstructured source that
      -- may intentionally waive a proof file.
      v_proof_required := false;
    END IF;
  END IF;

  IF v_proof_required AND p_has_proof IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A proof file is required for this point action.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- E. Activity create/update implementations accept versioned rules
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_create_activity_locked_impl(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_status text;
  v_title text;
  v_signup_mode text;
  v_linked_project_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_rules_input jsonb := p_activity -> 'earningRules';
  v_normalized jsonb;
  v_rules jsonb;
  v_point_value numeric;
  v_point_type text;
  v_external_capacity text;
  v_signup_links jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_activity) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Activity payload must be an object.';
  END IF;

  v_status := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'status'), ''), 'draft');
  v_title := nullif(pg_catalog.btrim(p_activity ->> 'title'), '');
  v_signup_mode := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'signupMode'), ''), 'external');
  BEGIN
    v_linked_project_id := nullif(p_activity ->> 'linkedProjectId', '')::uuid;
    v_starts_at := nullif(p_activity ->> 'startsAt', '')::timestamptz;
    v_ends_at := nullif(p_activity ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Activity dates and linked project must be valid.';
  END;

  IF p_term_id IS NULL THEN RAISE EXCEPTION 'A CSF semester is required.'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'New activities must be saved as draft or published.'; END IF;
  IF v_signup_mode NOT IN ('external', 'lets_assist_project', 'none') THEN RAISE EXCEPTION 'Choose a valid activity signup source.'; END IF;
  IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF v_signup_mode = 'lets_assist_project' AND v_linked_project_id IS NULL THEN
    RAISE EXCEPTION 'A Let''s Assist project is required for this signup source.';
  END IF;
  IF v_status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'External signup posts need a signup URL.';
  END IF;

  -- Versioned earning rules are optional; a payload without them keeps the
  -- legacy fixed award. With rules, the stored point value is the per-submission
  -- ceiling and the stored point type is the lead category.
  IF v_rules_input IS NOT NULL AND pg_catalog.jsonb_typeof(v_rules_input) <> 'null' THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(v_rules_input);
    v_rules := v_normalized -> 'rules';
    v_point_value := (v_normalized ->> 'ceilingPoints')::numeric;
    v_point_type := v_normalized ->> 'ceilingPointType';
  ELSE
    v_rules := NULL;
    v_point_value := coalesce((p_activity ->> 'pointValue')::numeric, 0);
    v_point_type := coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive');
  END IF;
  v_external_capacity := nullif(pg_catalog.btrim(coalesce(p_activity ->> 'externalCapacity', '')), '');
  IF v_external_capacity IS NOT NULL AND pg_catalog.length(v_external_capacity) > 500 THEN
    RAISE EXCEPTION 'External volunteer capacity must be 500 characters or fewer.';
  END IF;
  v_signup_links := plugin_data.csf_normalize_signup_links(p_activity -> 'signupLinks');

  v_request := pg_catalog.jsonb_build_object(
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.create'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', v_receipt.target_id,
      'status', v_receipt.after_data ->> 'status',
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester was not found in this organization.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities cannot be created in a closed or archived semester.';
  END IF;

  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    JOIN plugin_data.csf_cohort_terms AS cohort_term
      ON cohort_term.organization_id = cohort.organization_id
      AND cohort_term.cohort_id = cohort.id
      AND cohort_term.term_id = p_term_id
      AND cohort_term.status <> 'archived'
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'That semester is not active for the selected graduating class in this organization.';
  END IF;
  IF v_linked_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects AS project
    WHERE project.organization_id = p_organization_id AND project.id = v_linked_project_id
  ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  INSERT INTO plugin_data.csf_opportunities (
    organization_id, term_id, cohort_id, title, body, starts_at, ends_at,
    location, signup_url, contact_email, point_value, point_type, point_cap,
    signup_mode, requires_point_submission, evidence_policy, source_organization,
    created_by_user_id, status, linked_project_id, published_at,
    earning_rules, earning_rules_version, external_capacity, signup_links
  ) VALUES (
    p_organization_id,
    p_term_id,
    p_cohort_id,
    v_title,
    coalesce(nullif(p_activity ->> 'body', ''), v_title),
    v_starts_at,
    v_ends_at,
    nullif(p_activity ->> 'location', ''),
    CASE
      WHEN v_signup_mode = 'lets_assist_project' THEN '/projects/' || v_linked_project_id::text
      ELSE nullif(p_activity ->> 'signupUrl', '')
    END,
    nullif(p_activity ->> 'contactEmail', ''),
    v_point_value,
    v_point_type,
    nullif(p_activity ->> 'pointCap', '')::numeric,
    v_signup_mode,
    coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
    coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
    nullif(p_activity ->> 'sourceOrganization', ''),
    p_actor_user_id,
    v_status,
    v_linked_project_id,
    CASE WHEN v_status = 'published' THEN pg_catalog.now() ELSE NULL END,
    v_rules,
    1,
    v_external_capacity,
    v_signup_links
  ) RETURNING * INTO v_activity;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.create',
    'csf_opportunities', v_activity.id, p_term_id,
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_activity.title,
      'status', v_activity.status,
      'cohortId', v_activity.cohort_id,
      'linkedProjectId', v_activity.linked_project_id,
      'earningRulesVersion', v_activity.earning_rules_version
    ),
    p_request_id, 'activity_created'
  );

  RETURN pg_catalog.jsonb_build_object(
    'activityId', v_activity.id,
    'status', v_activity.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_activity_locked_impl(
  p_organization_id uuid,
  p_activity_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_title text;
  v_signup_mode text;
  v_linked_project_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_rules_input jsonb := p_activity -> 'earningRules';
  v_normalized jsonb;
  v_rules jsonb;
  v_point_value numeric;
  v_point_type text;
  v_point_cap numeric;
  v_external_capacity text;
  v_signup_links jsonb;
  v_rules_version integer;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable activity request identifier is required.'; END IF;
  IF p_activity_id IS NULL OR p_term_id IS NULL THEN RAISE EXCEPTION 'Activity and semester are required.'; END IF;
  IF pg_catalog.jsonb_typeof(p_activity) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Activity payload must be an object.'; END IF;

  v_title := nullif(pg_catalog.btrim(p_activity ->> 'title'), '');
  v_signup_mode := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'signupMode'), ''), 'external');
  BEGIN
    v_linked_project_id := nullif(p_activity ->> 'linkedProjectId', '')::uuid;
    v_starts_at := nullif(p_activity ->> 'startsAt', '')::timestamptz;
    v_ends_at := nullif(p_activity ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Activity dates and linked project must be valid.';
  END;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_signup_mode NOT IN ('external', 'lets_assist_project', 'none') THEN RAISE EXCEPTION 'Choose a valid activity signup source.'; END IF;
  IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF v_signup_mode = 'lets_assist_project' AND v_linked_project_id IS NULL THEN
    RAISE EXCEPTION 'A Let''s Assist project is required for this signup source.';
  END IF;

  IF v_rules_input IS NOT NULL AND pg_catalog.jsonb_typeof(v_rules_input) <> 'null' THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(v_rules_input);
    v_rules := v_normalized -> 'rules';
    v_point_value := (v_normalized ->> 'ceilingPoints')::numeric;
    v_point_type := v_normalized ->> 'ceilingPointType';
  ELSE
    v_rules := NULL;
    v_point_value := coalesce((p_activity ->> 'pointValue')::numeric, 0);
    v_point_type := coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive');
  END IF;
  v_point_cap := nullif(p_activity ->> 'pointCap', '')::numeric;
  v_external_capacity := nullif(pg_catalog.btrim(coalesce(p_activity ->> 'externalCapacity', '')), '');
  IF v_external_capacity IS NOT NULL AND pg_catalog.length(v_external_capacity) > 500 THEN
    RAISE EXCEPTION 'External volunteer capacity must be 500 characters or fewer.';
  END IF;
  v_signup_links := plugin_data.csf_normalize_signup_links(p_activity -> 'signupLinks');

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.update'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id,
      'status', v_receipt.after_data ->> 'status',
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity was not found in this organization.'; END IF;
  IF v_before.status IN ('closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Closed, cancelled, or archived activities cannot be edited.';
  END IF;
  IF v_before.status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'Published external-signup activities require a signup URL.';
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester was not found in this organization.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities in a closed or archived semester cannot be edited.';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    JOIN plugin_data.csf_cohort_terms AS cohort_term
      ON cohort_term.organization_id = cohort.organization_id
      AND cohort_term.cohort_id = cohort.id
      AND cohort_term.term_id = p_term_id
      AND cohort_term.status <> 'archived'
    WHERE cohort.organization_id = p_organization_id AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'That semester is not active for the selected graduating class in this organization.';
  END IF;
  IF v_linked_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects AS project
    WHERE project.organization_id = p_organization_id AND project.id = v_linked_project_id
  ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  -- Any change to how points are earned starts a new rules version. Existing
  -- submissions keep the snapshot they were evaluated under.
  v_rules_version := CASE
    WHEN v_before.earning_rules IS DISTINCT FROM v_rules
      OR v_before.point_value IS DISTINCT FROM v_point_value::numeric(6,2)
      OR v_before.point_type IS DISTINCT FROM v_point_type
      OR v_before.point_cap IS DISTINCT FROM v_point_cap::numeric(6,2)
    THEN v_before.earning_rules_version + 1
    ELSE v_before.earning_rules_version
  END;

  UPDATE plugin_data.csf_opportunities
  SET term_id = p_term_id,
      cohort_id = p_cohort_id,
      title = v_title,
      body = coalesce(nullif(p_activity ->> 'body', ''), v_title),
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      location = nullif(p_activity ->> 'location', ''),
      signup_url = CASE
        WHEN v_signup_mode = 'lets_assist_project' THEN '/projects/' || v_linked_project_id::text
        ELSE nullif(p_activity ->> 'signupUrl', '')
      END,
      contact_email = nullif(p_activity ->> 'contactEmail', ''),
      point_value = v_point_value,
      point_type = v_point_type,
      point_cap = v_point_cap,
      signup_mode = v_signup_mode,
      requires_point_submission = coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
      evidence_policy = coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
      source_organization = nullif(p_activity ->> 'sourceOrganization', ''),
      linked_project_id = v_linked_project_id,
      earning_rules = v_rules,
      earning_rules_version = v_rules_version,
      external_capacity = v_external_capacity,
      signup_links = v_signup_links,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.update',
    'csf_opportunities', p_activity_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'title', v_before.title, 'status', v_before.status, 'termId', v_before.term_id,
      'cohortId', v_before.cohort_id, 'linkedProjectId', v_before.linked_project_id,
      'earningRulesVersion', v_before.earning_rules_version
    ),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_after.title, 'status', v_after.status, 'termId', v_after.term_id,
      'cohortId', v_after.cohort_id, 'linkedProjectId', v_after.linked_project_id,
      'earningRulesVersion', v_after.earning_rules_version
    ),
    p_request_id, 'activity_updated'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', v_after.id,
    'status', v_after.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- F. Request-aware begin (v2 accepts the member selection)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_submission_request_v2(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_opportunity_id uuid,
  p_partner_club_term_id uuid,
  p_source text,
  p_description text,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_actor_user_id uuid,
  p_file_original_filename text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_proof_sha256 text,
  p_request_id uuid,
  p_earning_selection jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_source, '')));
  v_original_filename text := nullif(
    pg_catalog.btrim(coalesce(p_file_original_filename, '')),
    ''
  );
  v_mime_type text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_file_mime_type, ''))
  );
  v_proof_sha256 text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_proof_sha256, ''))
  );
  v_has_proof boolean;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_finalize_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_fail_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_proof plugin_data.csf_submission_files%ROWTYPE;
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_submission_id uuid;
  v_file_id uuid;
  v_upload_token uuid;
  v_object_path text;
  v_begin_state jsonb;
  v_current_state jsonb;
  v_canonical_audit_id uuid;
  v_rules jsonb;
  v_selection jsonb;
  v_calculation jsonb;
  v_earning jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-submission request identifier is required.';
  END IF;
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF v_source NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'Interactive point submissions must use a student or staff source.';
  END IF;
  IF p_earning_selection IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_earning_selection) <> 'object' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;

  v_has_proof := v_original_filename IS NOT NULL
    OR v_mime_type <> ''
    OR p_file_size_bytes IS NOT NULL
    OR v_proof_sha256 <> '';
  IF v_has_proof THEN
    IF v_original_filename IS NULL
      OR pg_catalog.length(v_original_filename) > 255
      OR v_mime_type NOT IN (
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'
      )
      OR p_file_size_bytes IS NULL
      OR p_file_size_bytes <= 0
      OR p_file_size_bytes > 10485760
      OR v_proof_sha256 !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Validated proof metadata and digest are required together.';
    END IF;
  ELSE
    v_original_filename := NULL;
    v_mime_type := NULL;
    v_proof_sha256 := NULL;
  END IF;

  -- Current authorization is required before any request receipt is read.
  IF v_source = 'staff' THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY[]::text[]
    );
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point submission.';
    END IF;
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'profileId', p_profile_id,
    'termId', p_term_id,
    'opportunityId', p_opportunity_id,
    'partnerClubTermId', p_partner_club_term_id,
    'source', v_source,
    'description', v_description,
    'claimedPoints', p_claimed_points,
    'pointType', p_point_type,
    'activityDate', p_activity_date,
    'hasProof', v_has_proof,
    'proofFilename', v_original_filename,
    'proofMimeType', v_mime_type,
    'proofSizeBytes', p_file_size_bytes,
    'proofSha256', v_proof_sha256
  );
  -- Fingerprints of pre-rules requests stay byte-identical: the selection key
  -- joins the intent only when a caller supplies one.
  IF p_earning_selection IS NOT NULL THEN
    v_intent := v_intent || pg_catalog.jsonb_build_object('earningSelection', p_earning_selection);
  END IF;
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'begin_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.begin_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_point_submissions'
      OR v_receipt.target_id IS NULL
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;

    SELECT submission.*
    INTO v_submission
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.organization_id = p_organization_id
      AND submission.id = v_receipt.target_id
      AND submission.profile_id = p_profile_id
      AND submission.term_id = p_term_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The committed point-submission receipt no longer resolves to its submission.';
    END IF;

    v_current_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      v_submission.id
    );
    IF v_has_proof THEN
      BEGIN
        v_file_id := (v_receipt.after_data ->> 'fileId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'The committed point-proof receipt is invalid.';
      END;
      SELECT proof.*
      INTO v_proof
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.id = v_file_id
        AND proof.uploaded_by = p_actor_user_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The committed point-proof receipt no longer resolves to its proof.';
      END IF;

      IF v_submission.status = 'draft' AND v_proof.upload_status = 'pending' THEN
        IF v_receipt.after_data -> 'beginState' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The pending point submission changed. Ask a CSF officer to reconcile it before retrying.';
        END IF;
        PERFORM plugin_data.csf_assert_point_submission_eligibility(
          p_organization_id,
          v_submission.profile_id,
          v_submission.term_id,
          v_submission.opportunity_id,
          v_submission.partner_club_term_id,
          v_submission.source,
          v_submission.claimed_points,
          v_submission.point_type,
          true,
          false,
          false
        );
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'pending',
          'objectPath', v_proof.object_path,
          'uploadToken', v_proof.upload_token,
          'proofSha256', v_proof_sha256,
          'idempotent', true
        );
      END IF;

      SELECT audit.*
      INTO v_finalize_receipt
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.correlation_id = p_request_id
        AND audit.source_type = 'point_proof_finalize_request'
        AND audit.action = 'point_submission.proof_finalize_request_committed'
      LIMIT 1;
      IF v_submission.status = 'submitted'
        AND v_proof.upload_status = 'finalized'
        AND FOUND THEN
        IF v_finalize_receipt.target_id IS DISTINCT FROM v_submission.id
          OR v_finalize_receipt.after_data ->> 'fileId' IS DISTINCT FROM v_proof.id::text
          OR v_finalize_receipt.after_data -> 'state' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The finalized point submission changed. Reload Point submissions.';
        END IF;
        PERFORM plugin_data.csf_assert_point_submission_eligibility(
          p_organization_id,
          v_submission.profile_id,
          v_submission.term_id,
          v_submission.opportunity_id,
          v_submission.partner_club_term_id,
          v_submission.source,
          v_submission.claimed_points,
          v_submission.point_type,
          true,
          false,
          false
        );
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'submitted',
          'idempotent', true
        );
      END IF;

      SELECT audit.*
      INTO v_fail_receipt
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.correlation_id = p_request_id
        AND audit.source_type = 'point_proof_fail_request'
        AND audit.action = 'point_submission.proof_fail_request_committed'
      LIMIT 1;
      IF v_submission.status = 'withdrawn'
        AND v_proof.upload_status = 'failed'
        AND FOUND THEN
        IF v_fail_receipt.target_id IS DISTINCT FROM v_submission.id
          OR v_fail_receipt.after_data ->> 'fileId' IS DISTINCT FROM v_proof.id::text
          OR v_fail_receipt.after_data -> 'state' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The failed point submission changed. Ask a CSF officer to reconcile it.';
        END IF;
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'failed',
          'idempotent', true
        );
      END IF;
      RAISE EXCEPTION 'The committed point-proof request has a stale lifecycle state.';
    END IF;

    IF v_submission.status IS DISTINCT FROM 'submitted'
      OR v_receipt.after_data -> 'beginState' IS DISTINCT FROM v_current_state THEN
      RAISE EXCEPTION 'The committed point submission is no longer current. Reload Point submissions.';
    END IF;
    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_submission.claimed_points,
      v_submission.point_type,
      false,
      false,
      false
    );
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', v_submission.id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  -- Internal coordinates are generated only after proving this request has no
  -- prior receipt. A retry can therefore never fork a second proof path.
  v_submission_id := pg_catalog.gen_random_uuid();
  IF v_has_proof THEN
    v_file_id := pg_catalog.gen_random_uuid();
    v_upload_token := pg_catalog.gen_random_uuid();
    v_object_path := p_organization_id::text || '/dvhs-csf'
      || '/profiles/' || p_profile_id::text
      || '/terms/' || p_term_id::text
      || '/submissions/' || v_submission_id::text
      || '/' || pg_catalog.gen_random_uuid()::text || '-proof';
  END IF;

  PERFORM plugin_data.csf_begin_point_submission(
    p_organization_id,
    v_submission_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    v_source,
    v_description,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_actor_user_id,
    v_file_id,
    CASE WHEN v_has_proof THEN 'plugins' ELSE NULL END,
    v_object_path,
    v_original_filename,
    v_mime_type,
    p_file_size_bytes,
    v_upload_token,
    p_request_id
  );

  -- The eligibility helper above locked the activity under the semester lock.
  -- Evaluate the selection against those locked rules, snapshot them onto the
  -- submission, and enforce the per-person cap before the receipt is written.
  IF p_opportunity_id IS NOT NULL THEN
    SELECT activity.*
    INTO v_activity
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = p_opportunity_id;
    v_rules := plugin_data.csf_effective_earning_rules(
      v_activity.earning_rules,
      v_activity.point_value,
      v_activity.point_type
    );
    IF v_rules IS NOT NULL THEN
      v_selection := coalesce(
        p_earning_selection,
        plugin_data.csf_default_earning_selection(v_rules)
      );
      IF v_selection IS NULL THEN
        RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
      END IF;
      v_calculation := plugin_data.csf_calculate_earning(v_rules, v_selection);
      IF (v_rules -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
        IF pg_catalog.round(p_claimed_points, 2) <> (v_calculation ->> 'points')::numeric THEN
          RAISE EXCEPTION 'Requested points must match the calculated % for this selection.',
            pg_catalog.trim_scale((v_calculation ->> 'points')::numeric);
        END IF;
        IF p_point_type IS DISTINCT FROM (v_calculation ->> 'pointType') THEN
          RAISE EXCEPTION 'Point type does not match the selected earning components.';
        END IF;
      END IF;
      UPDATE plugin_data.csf_point_submissions
      SET earning_rules_version = v_activity.earning_rules_version,
          earning_rules_snapshot = v_rules,
          earning_selection = v_selection,
          suggested_points = (v_calculation ->> 'suggestedPoints')::numeric
      WHERE organization_id = p_organization_id
        AND id = v_submission_id;
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        p_profile_id,
        p_opportunity_id,
        v_submission_id,
        p_claimed_points,
        v_rules,
        v_selection
      );
      v_earning := pg_catalog.jsonb_build_object(
        'rulesVersion', v_activity.earning_rules_version,
        'selection', v_selection,
        'suggestedPoints', v_calculation -> 'suggestedPoints',
        'assessment', v_calculation -> 'assessment'
      );
    END IF;
  END IF;

  v_begin_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    v_submission_id
  );
  IF v_begin_state IS NULL THEN
    RAISE EXCEPTION 'Point-submission begin did not create a canonical submission.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.target_id = v_submission_id
    AND audit.source_type = 'point_submission'
    AND audit.action IN ('point_submission.create', 'point_submission.proof_pending')
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-submission begin did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    p_profile_id,
    'point_submission.begin_request_committed',
    'csf_point_submissions',
    v_submission_id,
    p_term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'begin_submission',
      'requestFingerprint', v_request_fingerprint,
      'proofDigest', v_proof_sha256,
      'fileId', v_file_id,
      'canonicalAuditId', v_canonical_audit_id,
      'beginState', v_begin_state,
      'earning', v_earning
    ),
    p_request_id,
    'point_action_request',
    v_submission_id::text,
    'point_submission_begin_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', v_submission_id,
    'fileId', v_file_id,
    'status', CASE WHEN v_has_proof THEN 'pending' ELSE 'submitted' END,
    'objectPath', v_object_path,
    'uploadToken', v_upload_token,
    'proofSha256', v_proof_sha256,
    'suggestedPoints', v_calculation -> 'suggestedPoints',
    'idempotent', false
  );
END;
$$;

-- The original signature delegates so it cannot skip the rules.
CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_submission_request(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_opportunity_id uuid,
  p_partner_club_term_id uuid,
  p_source text,
  p_description text,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_actor_user_id uuid,
  p_file_original_filename text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_proof_sha256 text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT plugin_data.csf_begin_point_submission_request_v2(
    p_organization_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    p_source,
    p_description,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_actor_user_id,
    p_file_original_filename,
    p_file_mime_type,
    p_file_size_bytes,
    p_proof_sha256,
    p_request_id,
    NULL::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- G. Request-aware resubmission (v2 accepts a corrected selection)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(
  p_organization_id uuid,
  p_submission_id uuid,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_description text,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_earning_selection jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_audit_id uuid;
  v_has_finalized_proof boolean := false;
  v_rules jsonb;
  v_selection jsonb;
  v_calculation jsonb;
  v_earning jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-resubmission request identifier is required.';
  END IF;
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF p_earning_selection IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_earning_selection) <> 'object' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
    AND submission.source = 'student'
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = submission.organization_id
        AND account.profile_id = submission.profile_id
        AND account.user_id = p_actor_user_id
        AND account.status = 'verified'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may correct and resubmit this point submission.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'claimedPoints', p_claimed_points,
    'pointType', p_point_type,
    'activityDate', p_activity_date,
    'description', v_description
  );
  IF p_earning_selection IS NOT NULL THEN
    v_intent := v_intent || pg_catalog.jsonb_build_object('earningSelection', p_earning_selection);
  END IF;
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'resubmit_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.resubmit_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'The resubmitted point submission is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = p_request_id
        AND audit.action = 'point_submission.resubmit'
        AND audit.target_id = p_submission_id
    ) THEN
      RAISE EXCEPTION 'The resubmission receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status <> 'finalized'
  ) THEN
    RAISE EXCEPTION 'Point-submission proof must be finalized before resubmission.';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status = 'finalized'
      AND proof.bucket = 'plugins'
      AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
  ) INTO v_has_finalized_proof;
  PERFORM plugin_data.csf_assert_point_submission_eligibility(
    p_organization_id,
    v_submission.profile_id,
    v_submission.term_id,
    v_submission.opportunity_id,
    v_submission.partner_club_term_id,
    v_submission.source,
    p_claimed_points,
    p_point_type,
    v_has_finalized_proof,
    false,
    false
  );

  -- A correction is re-evaluated under the activity's current rules, which the
  -- eligibility helper has just locked. The submission keeps its earlier review
  -- history; only its snapshot and suggested points move forward.
  IF v_submission.opportunity_id IS NOT NULL THEN
    SELECT activity.*
    INTO v_activity
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = v_submission.opportunity_id;
    v_rules := plugin_data.csf_effective_earning_rules(
      v_activity.earning_rules,
      v_activity.point_value,
      v_activity.point_type
    );
    IF v_rules IS NOT NULL THEN
      v_selection := coalesce(
        p_earning_selection,
        CASE
          WHEN v_submission.earning_rules_version IS NOT DISTINCT FROM v_activity.earning_rules_version
            THEN v_submission.earning_selection
          ELSE NULL
        END,
        plugin_data.csf_default_earning_selection(v_rules)
      );
      IF v_selection IS NULL THEN
        RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
      END IF;
      v_calculation := plugin_data.csf_calculate_earning(v_rules, v_selection);
      IF (v_rules -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
        IF pg_catalog.round(p_claimed_points, 2) <> (v_calculation ->> 'points')::numeric THEN
          RAISE EXCEPTION 'Requested points must match the calculated % for this selection.',
            pg_catalog.trim_scale((v_calculation ->> 'points')::numeric);
        END IF;
        IF p_point_type IS DISTINCT FROM (v_calculation ->> 'pointType') THEN
          RAISE EXCEPTION 'Point type does not match the selected earning components.';
        END IF;
      END IF;
    END IF;
  END IF;

  v_result := plugin_data.csf_resubmit_point_submission(
    p_organization_id,
    p_submission_id,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    v_description,
    p_actor_user_id,
    p_request_id
  );

  IF v_rules IS NOT NULL THEN
    UPDATE plugin_data.csf_point_submissions
    SET earning_rules_version = v_activity.earning_rules_version,
        earning_rules_snapshot = v_rules,
        earning_selection = v_selection,
        suggested_points = (v_calculation ->> 'suggestedPoints')::numeric
    WHERE organization_id = p_organization_id
      AND id = p_submission_id;
    PERFORM plugin_data.csf_assert_activity_earning_award(
      p_organization_id,
      v_submission.profile_id,
      v_submission.opportunity_id,
      p_submission_id,
      p_claimed_points,
      v_rules,
      v_selection
    );
    v_earning := pg_catalog.jsonb_build_object(
      'previousRulesVersion', v_submission.earning_rules_version,
      'rulesVersion', v_activity.earning_rules_version,
      'selection', v_selection,
      'suggestedPoints', v_calculation -> 'suggestedPoints',
      'assessment', v_calculation -> 'assessment'
    );
  END IF;

  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Point resubmission did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'point_submission.resubmit'
    AND audit.target_id = p_submission_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point resubmission did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.resubmit_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'resubmit_submission',
      'requestFingerprint', v_request_fingerprint,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state,
      'earning', v_earning
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_submission_resubmit_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'status', 'submitted',
    'suggestedPoints', v_calculation -> 'suggestedPoints',
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_resubmit_point_submission_request(
  p_organization_id uuid,
  p_submission_id uuid,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_description text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT plugin_data.csf_resubmit_point_submission_request_v2(
    p_organization_id,
    p_submission_id,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_description,
    p_actor_user_id,
    p_request_id,
    NULL::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- H. Review: suggested points, audited overrides, per-person cap
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_submission_v2(
  p_organization_id uuid,
  p_submission_id uuid,
  p_action text,
  p_awarded_points numeric,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_lock_term_id uuid;
  v_review_notes text := nullif(pg_catalog.btrim(coalesce(p_review_notes, '')), '');
BEGIN
  IF p_action IS NULL
    OR p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;

  -- Permission is resolved and locked before any private submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );

  SELECT submission.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point submissions can only be reviewed in the current open semester.';
  END IF;

  IF p_action = 'approved' THEN
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving points.';
    END IF;

    v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Awarded points must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'plugins'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );

    -- Rule-driven submissions: an award that departs from the calculated value, or
    -- any officer-assessed award, carries a written reason into the audit.
    IF v_submission.earning_rules_snapshot IS NOT NULL
      AND (v_submission.earning_rules_snapshot -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
      IF v_submission.earning_rules_snapshot ->> 'mode' = 'assessment'
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Officer assessment requires review notes that explain the awarded points.';
      END IF;
      IF v_submission.suggested_points IS NOT NULL
        AND v_awarded_points <> v_submission.suggested_points
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Explain why the awarded points differ from the calculated %.',
          v_submission.suggested_points;
      END IF;
    END IF;
    IF v_submission.opportunity_id IS NOT NULL THEN
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        v_submission.profile_id,
        v_submission.opportunity_id,
        v_submission.id,
        v_awarded_points,
        v_submission.earning_rules_snapshot,
        v_submission.earning_selection
      );
    END IF;
  END IF;

  RETURN plugin_data.csf_review_point_submission_v2_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_action,
    p_awarded_points,
    p_review_notes,
    p_actor_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_appeal(
  p_organization_id uuid,
  p_appeal_id uuid,
  p_decision text,
  p_resolution_notes text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appeal plugin_data.csf_point_appeals%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_credit plugin_data.csf_credit_records%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_resolution_notes text := nullif(pg_catalog.btrim(coalesce(p_resolution_notes, '')), '');
  v_lock_term_id uuid;
BEGIN
  IF p_decision IS NULL
    OR p_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF v_resolution_notes IS NULL OR pg_catalog.length(v_resolution_notes) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal resolution notes must contain between 1 and 2000 characters.';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'A point-appeal decision correlation identifier is required.';
  END IF;

  -- Permission is resolved and locked before any private appeal evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['process_points']::text[]
  );

  SELECT appeal.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point appeal was not found or has already been decided.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT appeal.*
  INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id
  FOR UPDATE;
  IF NOT FOUND OR v_appeal.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Point appeal was not found or has already been decided.';
  END IF;
  IF v_appeal.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point appeal semester changed; refresh and try again.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = v_appeal.submission_id
    AND submission.profile_id = v_appeal.profile_id
    AND submission.term_id = v_appeal.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'The appealed point submission is no longer reviewable.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point appeals can only be reviewed in the current open semester.';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving an appeal.';
    END IF;

    v_awarded_points := coalesce(v_appeal.requested_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Appeal award must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before appeal approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'plugins'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );
    IF v_submission.opportunity_id IS NOT NULL THEN
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        v_submission.profile_id,
        v_submission.opportunity_id,
        v_submission.id,
        v_awarded_points,
        v_submission.earning_rules_snapshot,
        v_submission.earning_selection
      );
    END IF;
  END IF;

  SELECT credit.*
  INTO v_credit
  FROM plugin_data.csf_credit_records AS credit
  WHERE credit.organization_id = p_organization_id
    AND credit.submission_id = v_submission.id
  ORDER BY credit.created_at DESC, credit.id DESC
  LIMIT 1
  FOR UPDATE;

  RETURN plugin_data.csf_review_point_appeal_authority_base_20260810(
    p_organization_id,
    p_appeal_id,
    p_decision,
    v_resolution_notes,
    p_actor_user_id,
    p_correlation_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- I. Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_earning_points_value(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_earning_points_value(jsonb, text) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_normalize_earning_rules(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalize_earning_rules(jsonb) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_effective_earning_rules(jsonb, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_effective_earning_rules(jsonb, numeric, text) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_default_earning_selection(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_default_earning_selection(jsonb) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_calculate_earning(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_calculate_earning(jsonb, jsonb) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_normalize_signup_links(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalize_signup_links(jsonb) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_activity_earning_award(
  uuid, uuid, uuid, uuid, numeric, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_activity_earning_award(
  uuid, uuid, uuid, uuid, numeric, jsonb, jsonb
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_update_activity_locked_impl(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity_locked_impl(
  uuid, uuid, uuid, uuid, jsonb, uuid, uuid
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_request_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission_request_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid, jsonb
) TO postgres, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) TO postgres, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(
  uuid, uuid, numeric, text, date, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(
  uuid, uuid, numeric, text, date, text, uuid, uuid, jsonb
) TO postgres, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) TO postgres, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_normalize_earning_rules(jsonb) IS
  'Validates a version 1 CSF earning rule set and returns {rules, ceilingPoints, ceilingPointType}. Categories are explicit per component; nothing is inferred from labels.';
COMMENT ON FUNCTION plugin_data.csf_calculate_earning(jsonb, jsonb) IS
  'Turns a member selection into {points, pointType, suggestedPoints, assessment, shiftKeys, componentKeys, breakdown} under one rule set. Mixed-category selections are refused.';
COMMENT ON FUNCTION plugin_data.csf_assert_activity_earning_award(uuid, uuid, uuid, uuid, numeric, jsonb, jsonb) IS
  'Under the semester lock: enforces the submission ceiling of a rule snapshot, the activity''s per-person maximum across verified credit, and refuses re-awarding a shift already verified for the member.';
COMMENT ON FUNCTION plugin_data.csf_begin_point_submission_request_v2(uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid, text, text, bigint, text, uuid, jsonb) IS
  'Request-aware point submission begin that evaluates the member selection against the locked activity rules, snapshots rules version/selection/suggested points onto the submission, and enforces the per-person cap. The original signature delegates here with no selection.';
COMMENT ON FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(uuid, uuid, numeric, text, date, text, uuid, uuid, jsonb) IS
  'Request-aware correction resubmission that re-evaluates the selection under the activity''s current rules while preserving earlier review and audit history.';

NOTIFY pgrst, 'reload schema';

COMMIT;
