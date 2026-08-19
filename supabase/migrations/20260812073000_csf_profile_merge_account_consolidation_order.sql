-- Consolidate duplicate profile-account bindings without transiently creating
-- two verified bindings for one organization user.
--
-- The historical merge promoted the target duplicate before revoking the
-- source. The final partial unique index correctly rejected that intermediate
-- state even though the intended final state was one verified target plus one
-- revoked source. Capture both rows under the existing identity hierarchy,
-- revoke the source first, then promote the target before delegating to the
-- historical reference-rewrite body.

BEGIN;

ALTER FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) RENAME TO csf_merge_profiles_account_order_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles_identity_base(
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
  v_account record;
  v_now timestamptz := pg_catalog.now();
BEGIN
  -- Reentrant when called through the canonical merge, and still the first
  -- lock if an owner-internal caller ever reaches this implementation.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  FOR v_account IN
    SELECT
      source_account.id AS source_id,
      source_account.user_id,
      source_account.status AS source_status,
      source_account.is_primary AS source_is_primary,
      source_account.linked_by AS source_linked_by,
      source_account.linked_at AS source_linked_at,
      target_account.id AS target_id,
      target_account.status AS target_status,
      target_account.is_primary AS target_is_primary,
      target_account.linked_by AS target_linked_by,
      target_account.linked_at AS target_linked_at,
      target_account.revoked_at AS target_revoked_at
    FROM plugin_data.csf_profile_accounts AS source_account
    JOIN plugin_data.csf_profile_accounts AS target_account
      ON target_account.organization_id = source_account.organization_id
     AND target_account.profile_id = p_target_profile_id
     AND target_account.user_id = source_account.user_id
    WHERE source_account.organization_id = p_organization_id
      AND source_account.profile_id = p_source_profile_id
    ORDER BY source_account.user_id, source_account.id, target_account.id
    FOR UPDATE OF source_account, target_account
  LOOP
    UPDATE plugin_data.csf_profile_accounts
    SET status = 'revoked',
        is_primary = false,
        revoked_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_account.source_id
      AND profile_id = p_source_profile_id;

    UPDATE plugin_data.csf_profile_accounts
    SET status = CASE
          WHEN v_account.source_status = 'verified' THEN 'verified'
          WHEN v_account.target_status = 'verified' THEN 'verified'
          WHEN v_account.source_status = 'pending' THEN 'pending'
          ELSE v_account.target_status
        END,
        is_primary = CASE
          WHEN v_account.source_status = 'verified'
            AND v_account.source_is_primary THEN true
          ELSE v_account.target_is_primary
        END,
        linked_by = coalesce(
          v_account.target_linked_by, v_account.source_linked_by
        ),
        linked_at = least(
          v_account.target_linked_at, v_account.source_linked_at
        ),
        revoked_at = CASE
          WHEN v_account.source_status = 'verified'
            OR v_account.target_status = 'verified' THEN NULL
          ELSE v_account.target_revoked_at
        END
    WHERE organization_id = p_organization_id
      AND id = v_account.target_id
      AND profile_id = p_target_profile_id;
  END LOOP;

  RETURN plugin_data.csf_merge_profiles_account_order_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(
  uuid, uuid, uuid, text, uuid
) IS 'Owner-internal historical profile-reference rewrite body; duplicate account bindings are ordered by csf_merge_profiles_identity_base before delegation.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles_identity_base(
  uuid, uuid, uuid, text, uuid
) IS 'Owner-internal profile merge implementation that retains identity-first locking and revokes a duplicate source account binding before promoting the captured target binding.';

-- The historical canonical merge receipt copied the full target preview and
-- free-form reason into the immutable audit row. Keep the receipt keys used by
-- request replay and operations, but reduce that one event to identifiers,
-- state, and counts before it becomes immutable.
CREATE OR REPLACE FUNCTION plugin_data.csf_sanitize_profile_merge_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.action = 'profile.merge'
     AND NEW.target_type = 'csf_profiles'
     AND NEW.reason_code = 'duplicate_profile_merged' THEN
    NEW.before_data := pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'targetProfileId', NEW.target_id,
        'recordStatus', coalesce(
          NEW.before_data -> 'recordStatus',
          NEW.before_data -> 'record_status'
        )
      )
    );
    NEW.after_data := pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'sourceProfileId', NEW.after_data -> 'sourceProfileId',
        'targetProfileId', NEW.after_data -> 'targetProfileId',
        'reviewId', NEW.after_data -> 'reviewId',
        'movedAccounts', NEW.after_data -> 'movedAccounts',
        'movedRecords', NEW.after_data -> 'movedRecords',
        'sourceProvenancePreserved',
          NEW.after_data -> 'sourceProvenancePreserved'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_sanitize_profile_merge_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_sanitize_profile_merge_audit
BEFORE INSERT ON plugin_data.csf_admin_audit_events
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_sanitize_profile_merge_audit();

COMMENT ON FUNCTION plugin_data.csf_sanitize_profile_merge_audit() IS
  'Owner-internal insert trigger that reduces the canonical profile-merge audit receipt to non-PII identifiers, state, and counts before immutable storage.';

COMMIT;
