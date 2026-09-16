-- A member can say "something is wrong" from My CSF, and an officer sees it.
--
-- The existing correction request is bound to one application and one check
-- type, so a member could only raise it while an application was missing
-- information. A member who sees the wrong meeting attendance, the wrong
-- point total, a misspelled name, or the wrong class had no way to say so
-- except finding an officer in person. This gives every connected member one
-- plain form, and every officer with manage_profiles one queue.
--
-- Nothing here changes a record. A report is a message with a category,
-- pointing at the member's own profile; resolving it is an officer act with a
-- note, and any actual correction still goes through the existing audited
-- edit paths.

BEGIN;

CREATE TABLE plugin_data.csf_member_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'name', 'class', 'attendance', 'points', 'application', 'membership', 'other'
  )),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 8 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_member_reports_resolution_check CHECK (
    (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (status IN ('resolved', 'dismissed') AND resolved_at IS NOT NULL
        AND nullif(btrim(resolution_note), '') IS NOT NULL)
  )
);

CREATE INDEX csf_member_reports_open_idx
  ON plugin_data.csf_member_reports (organization_id, created_at DESC)
  WHERE status = 'open';
CREATE INDEX csf_member_reports_profile_idx
  ON plugin_data.csf_member_reports (organization_id, profile_id, created_at DESC);

ALTER TABLE plugin_data.csf_member_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_member_reports FROM anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_member_reports TO service_role;

COMMENT ON TABLE plugin_data.csf_member_reports IS
  'A member''s own "something is wrong" report about their CSF record; an officer queue, never a record edit.';

-- ---------------------------------------------------------------------------
-- Submitting: the member reports about their own connected record only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_submit_member_report(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_message text,
  p_term_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_message text := pg_catalog.btrim(coalesce(p_message, ''));
  v_open_count integer;
  v_report_id uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before reporting a problem with your record.';
  END IF;
  IF p_category IS NULL OR p_category NOT IN (
    'name', 'class', 'attendance', 'points', 'application', 'membership', 'other'
  ) THEN
    RAISE EXCEPTION 'Choose what is wrong.';
  END IF;
  IF pg_catalog.char_length(v_message) < 8 OR pg_catalog.char_length(v_message) > 2000 THEN
    RAISE EXCEPTION 'Describe the problem in 8 to 2000 characters.';
  END IF;

  SELECT account.profile_id INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  JOIN plugin_data.csf_profiles AS profile
    ON profile.id = account.profile_id AND profile.organization_id = account.organization_id
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
    AND profile.record_status = 'active'
  ORDER BY account.is_primary DESC, account.linked_at DESC
  LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Connect your CSF record before reporting a problem with it.';
  END IF;

  -- A member with five open reports is not being heard; more forms will not
  -- help, and a queue of duplicates hides the real problem.
  SELECT pg_catalog.count(*) INTO v_open_count
  FROM plugin_data.csf_member_reports
  WHERE organization_id = p_organization_id AND profile_id = v_profile_id AND status = 'open';
  IF v_open_count >= 5 THEN
    RAISE EXCEPTION 'You already have five open reports. An officer will get to them.';
  END IF;

  INSERT INTO plugin_data.csf_member_reports (
    organization_id, profile_id, reported_by, term_id, category, message
  ) VALUES (
    p_organization_id, v_profile_id, p_actor_user_id, p_term_id, p_category, v_message
  )
  RETURNING id INTO v_report_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    after_data, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_profile_id, 'profile.member_report_submitted',
    'csf_member_reports', v_report_id,
    pg_catalog.jsonb_build_object('category', p_category, 'termId', p_term_id),
    'member_report'
  );

  RETURN pg_catalog.jsonb_build_object('reportId', v_report_id, 'profileId', v_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_member_report(uuid,uuid,text,text,uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Resolving: an officer with manage_profiles closes it with a note.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_member_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_report plugin_data.csf_member_reports%ROWTYPE;
  v_note text := pg_catalog.btrim(coalesce(p_note, ''));
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles') THEN
    RAISE EXCEPTION 'Not authorized to resolve member reports.' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Choose whether the report was resolved or dismissed.';
  END IF;
  IF pg_catalog.char_length(v_note) < 4 OR pg_catalog.char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Say what you did about it, in 4 to 1000 characters.';
  END IF;

  SELECT * INTO v_report
  FROM plugin_data.csf_member_reports
  WHERE organization_id = p_organization_id AND id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member report not found.';
  END IF;
  IF v_report.status <> 'open' THEN
    -- Already closed. Idempotent so a double click is not an error.
    RETURN pg_catalog.jsonb_build_object('reportId', v_report.id, 'status', v_report.status, 'replayed', true);
  END IF;

  UPDATE plugin_data.csf_member_reports
     SET status = p_decision,
         resolved_by = p_actor_user_id,
         resolved_at = pg_catalog.now(),
         resolution_note = v_note,
         updated_at = pg_catalog.now()
   WHERE id = p_report_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'profile.member_report_' || p_decision,
    'csf_member_reports', p_report_id,
    pg_catalog.jsonb_build_object('status', 'open', 'category', v_report.category),
    pg_catalog.jsonb_build_object('status', p_decision, 'note', v_note),
    'member_report_' || p_decision
  );

  RETURN pg_catalog.jsonb_build_object('reportId', p_report_id, 'status', p_decision, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_member_report(uuid,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_member_report(uuid,uuid,uuid,text,text)
  TO service_role;

COMMIT;

-- csf_member_reports.profile_id is a new FK into csf_profiles, so the merge
-- machinery has to know about it: a report follows its member to the surviving
-- record. Both functions follow the established base/wrapper convention rather
-- than restating the whole body.
ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  RENAME TO csf_profile_merge_reference_plan_member_report_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
BEGIN
  v_plan := plugin_data.csf_profile_merge_reference_plan_member_report_base(
    p_organization_id, p_source_profile_id
  );
  RETURN pg_catalog.jsonb_set(
    v_plan,
    '{sameTransactionRewrites}',
    COALESCE(v_plan -> 'sameTransactionRewrites', '[]'::jsonb)
      || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'reference', 'plugin_data.csf_member_reports.profile_id',
          'scope', 'all member-filed record reports',
          'sourceCount', (
            SELECT pg_catalog.count(*)
            FROM plugin_data.csf_member_reports AS referenced_row
            WHERE referenced_row.organization_id = p_organization_id
              AND referenced_row.profile_id = p_source_profile_id
          )
        )
      ),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION
  plugin_data.csf_profile_merge_reference_plan_member_report_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  plugin_data.csf_profile_merge_reference_plan_member_report_base(uuid, uuid)
  TO service_role;

ALTER FUNCTION plugin_data.csf_merge_profiles_account_order_base(
  uuid, uuid, uuid, text, uuid
) RENAME TO csf_merge_profiles_member_report_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles_account_order_base(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_moved integer := 0;
BEGIN
  -- Move the reports before the base runs, so its zero-live-reference
  -- postconditions and the profile delete both see a clean source record.
  UPDATE plugin_data.csf_member_reports SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN plugin_data.csf_merge_profiles_member_report_base(
    p_organization_id, p_source_profile_id, p_target_profile_id,
    p_reason, p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(
  uuid, uuid, uuid, text, uuid
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_member_report_base(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_member_report_base(
  uuid, uuid, uuid, text, uuid
) TO service_role;
