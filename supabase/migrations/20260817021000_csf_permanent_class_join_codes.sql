-- Permanent graduating-class codes are separate from term-scoped direct and
-- reusable onboarding links. Rotation invalidates the previous code without
-- changing the lasting class record or activating semester membership.

CREATE TABLE plugin_data.csf_class_join_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-F0-9]{8}$'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotated', 'revoked')),
  replaces_code_id uuid,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT csf_class_join_codes_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_class_join_codes_replaces_organization_fkey
    FOREIGN KEY (replaces_code_id, organization_id)
    REFERENCES plugin_data.csf_class_join_codes(id, organization_id) ON DELETE SET NULL,
  CONSTRAINT csf_class_join_codes_id_organization_key
    UNIQUE (id, organization_id),
  CONSTRAINT csf_class_join_codes_revocation_shape_check CHECK (
    (status = 'active' AND revoked_by IS NULL AND revoked_at IS NULL)
    OR
    (status IN ('rotated', 'revoked') AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX csf_class_join_codes_code_uidx
  ON plugin_data.csf_class_join_codes (code);
CREATE UNIQUE INDEX csf_class_join_codes_active_cohort_uidx
  ON plugin_data.csf_class_join_codes (organization_id, cohort_id)
  WHERE status = 'active';
CREATE INDEX csf_class_join_codes_history_idx
  ON plugin_data.csf_class_join_codes (organization_id, cohort_id, created_at DESC);

ALTER TABLE plugin_data.csf_class_join_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_class_join_codes
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_class_join_codes TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_rotate_class_join_code(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous plugin_data.csf_class_join_codes%ROWTYPE;
  v_created plugin_data.csf_class_join_codes%ROWTYPE;
  v_code text;
  v_attempt integer := 0;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_cohorts_terms'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF class codes.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':class-code:' || p_cohort_id::text,
      0
    )
  );

  PERFORM 1
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = p_cohort_id
    AND cohort.status <> 'archived'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active CSF class was not found.';
  END IF;

  SELECT join_code.*
  INTO v_previous
  FROM plugin_data.csf_class_join_codes AS join_code
  WHERE join_code.organization_id = p_organization_id
    AND join_code.cohort_id = p_cohort_id
    AND join_code.status = 'active'
  FOR UPDATE;

  IF v_previous.id IS NOT NULL THEN
    UPDATE plugin_data.csf_class_join_codes
    SET status = 'rotated',
        revoked_by = p_actor_user_id,
        revoked_at = now(),
        revoke_reason = 'Rotated by an authorized CSF owner.'
    WHERE id = v_previous.id;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
    BEGIN
      INSERT INTO plugin_data.csf_class_join_codes (
        organization_id, cohort_id, code, replaces_code_id, created_by
      ) VALUES (
        p_organization_id, p_cohort_id, v_code, v_previous.id, p_actor_user_id
      ) RETURNING * INTO v_created;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 8 THEN
        RAISE EXCEPTION 'Could not generate a unique CSF class code.';
      END IF;
    END;
  END LOOP;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'class.join_code.rotated',
    'csf_class_join_codes', v_created.id,
    jsonb_build_object(
      'cohortId', p_cohort_id,
      'replacedCodeId', v_previous.id,
      'status', v_created.status
    ),
    v_correlation_id, 'class_join_code', v_created.id::text,
    CASE WHEN v_previous.id IS NULL THEN 'class_code_created' ELSE 'class_code_rotated' END
  );

  RETURN jsonb_build_object(
    'id', v_created.id,
    'cohortId', v_created.cohort_id,
    'code', v_created.code,
    'status', v_created.status,
    'createdAt', v_created.created_at,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_revoke_class_join_code(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid,
  p_reason text DEFAULT 'Disabled by an authorized CSF owner.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code plugin_data.csf_class_join_codes%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_cohorts_terms'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF class codes.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':class-code:' || p_cohort_id::text,
      0
    )
  );

  UPDATE plugin_data.csf_class_join_codes
  SET status = 'revoked',
      revoked_by = p_actor_user_id,
      revoked_at = now(),
      revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
  WHERE organization_id = p_organization_id
    AND cohort_id = p_cohort_id
    AND status = 'active'
  RETURNING * INTO v_code;

  IF v_code.id IS NULL THEN
    RETURN jsonb_build_object('revoked', false, 'alreadyInactive', true);
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'class.join_code.revoked',
    'csf_class_join_codes', v_code.id,
    jsonb_build_object('cohortId', p_cohort_id, 'status', 'revoked'),
    v_correlation_id, 'class_join_code', v_code.id::text,
    'class_code_revoked'
  );

  RETURN jsonb_build_object(
    'revoked', true,
    'id', v_code.id,
    'cohortId', v_code.cohort_id,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_rotate_class_join_code(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_revoke_class_join_code(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_rotate_class_join_code(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_revoke_class_join_code(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_class_join_codes IS
  'Server-only permanent class codes. They connect stable class identity and never activate semester membership.';
COMMENT ON FUNCTION plugin_data.csf_rotate_class_join_code(uuid, uuid, uuid) IS
  'Permission-checked, audited class-code create/rotation operation; rotation immediately invalidates the old code.';
COMMENT ON FUNCTION plugin_data.csf_revoke_class_join_code(uuid, uuid, uuid, text) IS
  'Permission-checked, audited class-code disable operation.';
