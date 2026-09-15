BEGIN;

-- Fixed and assessed submissions start at the configured ceiling. A lower
-- per-person cap would prevent every submission for that activity.
ALTER TABLE plugin_data.csf_opportunities
  DROP CONSTRAINT csf_opportunities_point_cap_check,
  ADD CONSTRAINT csf_opportunities_point_cap_check CHECK (
    point_cap IS NULL OR (
      point_cap > 0 AND (
        point_cap >= point_value
        OR coalesce(earning_rules ->> 'mode', '') IN ('quantity', 'per_item', 'shifts')
      )
    )
  );

COMMIT;
