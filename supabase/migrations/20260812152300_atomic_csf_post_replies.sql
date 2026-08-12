-- Make officer follow-up reply writes tenant-consistent, crash-atomic,
-- permission-rechecked, and replay-safe. The browser still has no direct
-- access: the private Server Actions call this service-only transaction.

BEGIN;

-- A globally unique announcement id did not prevent a row from carrying
-- organization A beside organization B's announcement id. Fail the migration
-- if such legacy corruption exists, then keep the tenant relationship true at
-- the storage boundary for every future writer.
ALTER TABLE plugin_data.csf_announcements
  ADD CONSTRAINT csf_announcements_organization_id_id_key
  UNIQUE (organization_id, id);

-- A parent delete must not become an unaudited reply-delete back door. The
-- service-role-only plugin teardown RPC is extended below to remove replies
-- explicitly before its existing caller deletes announcements.
ALTER TABLE plugin_data.csf_announcement_replies
  DROP CONSTRAINT csf_announcement_replies_announcement_id_fkey;

ALTER TABLE plugin_data.csf_announcement_replies
  ADD CONSTRAINT csf_announcement_replies_announcement_id_fkey
  FOREIGN KEY (announcement_id)
  REFERENCES plugin_data.csf_announcements (id)
  ON DELETE RESTRICT;

ALTER TABLE plugin_data.csf_announcement_replies
  ADD CONSTRAINT csf_announcement_replies_announcement_organization_fkey
  FOREIGN KEY (organization_id, announcement_id)
  REFERENCES plugin_data.csf_announcements (organization_id, id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE plugin_data.csf_announcement_replies
  VALIDATE CONSTRAINT csf_announcement_replies_announcement_organization_fkey;

CREATE UNIQUE INDEX csf_admin_audit_events_post_reply_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE source_type = 'post_reply_mutation_request'
    AND action IN ('post_reply_added', 'post_reply_deleted');

-- Preserve the teardown RPC's exact public signature and fourteen-key result
-- contract while making reply removal an explicit, reviewed uninstall action.
-- The old implementation remains owner-only and cannot be called directly by
-- service_role after the rename.
ALTER FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  RENAME TO csf_purge_recovery_foundations_without_post_replies;

REVOKE ALL ON FUNCTION
  plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_purge_recovery_foundations(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  -- Serialize against reply mutations. A mutation that already owns the lock
  -- commits first; one arriving after teardown starts cannot interleave with
  -- this delete. The later announcement delete remains RESTRICT-protected if a
  -- stale in-flight caller creates another reply after this transaction ends.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  DELETE FROM plugin_data.csf_announcement_replies AS reply
  WHERE reply.organization_id = p_organization_id;

  v_result :=
    plugin_data.csf_purge_recovery_foundations_without_post_replies(
      p_organization_id
    );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) IS
  'Service-role-only authorized teardown of one organization CSF recovery footprint. Explicitly removes post replies under the shared staff lock before delegating to the owner-only recovery purge, preserving the existing fourteen-key result contract.';

COMMENT ON FUNCTION
  plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid) IS
  'Owner-only prior recovery-foundation purge implementation. Direct execution is revoked; call plugin_data.csf_purge_recovery_foundations(uuid).';

CREATE FUNCTION plugin_data.csf_mutate_post_reply(
  p_organization_id uuid,
  p_operation text,
  p_post_id uuid,
  p_reply_id uuid,
  p_body text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_operation, '')));
  v_body text;
  v_body_hash text;
  v_request_fingerprint text;
  v_expected_action text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_reply plugin_data.csf_announcement_replies%ROWTYPE;
  v_post plugin_data.csf_announcements%ROWTYPE;
  v_actor_is_admin boolean := false;
  v_authored_by_actor boolean := false;
  v_reply_state jsonb;
BEGIN
  -- Auth first: do not reveal whether caller-controlled tenant or record ids
  -- exist to an actor who currently lacks the required capability.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_posts'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF post follow-ups.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable follow-up request identifier is required.';
  END IF;
  IF v_operation NOT IN ('add', 'delete') THEN
    RAISE EXCEPTION 'Choose a valid follow-up operation.';
  END IF;

  IF v_operation = 'add' THEN
    IF p_post_id IS NULL OR p_reply_id IS NOT NULL THEN
      RAISE EXCEPTION 'Choose one published post for the new follow-up.';
    END IF;
    v_body := pg_catalog.btrim(coalesce(p_body, ''));
    IF pg_catalog.char_length(v_body) NOT BETWEEN 1 AND 4000 THEN
      RAISE EXCEPTION 'A follow-up is 1 to 4000 characters.';
    END IF;
    v_expected_action := 'post_reply_added';
    v_body_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_body, 'UTF8'), 'sha256'),
      'hex'
    );
  ELSE
    IF p_reply_id IS NULL OR p_post_id IS NOT NULL OR p_body IS NOT NULL THEN
      RAISE EXCEPTION 'Choose one follow-up to remove.';
    END IF;
    v_expected_action := 'post_reply_deleted';
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'organizationId', p_organization_id,
          'operation', v_operation,
          'postId', p_post_id,
          'replyId', p_reply_id,
          'bodyHash', v_body_hash,
          'actorUserId', p_actor_user_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Every staff-access mutation uses this organization key. Hold it through
  -- commit and pin the host membership row so a capability or admin downgrade
  -- cannot race between the authorization decision and the reply/audit write.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.role = 'admin'
  INTO v_actor_is_admin
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_posts'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF post follow-ups.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_post_reply_mutation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'post_reply_mutation_request'
    AND audit.action IN ('post_reply_added', 'post_reply_deleted')
  LIMIT 1;

  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM v_expected_action
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_announcement_reply'
      OR v_receipt.target_id IS NULL
      OR v_receipt.after_data ->> 'operation' IS DISTINCT FROM v_operation
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That follow-up request identifier is already bound to a different change.';
    END IF;

    IF v_operation = 'add' THEN
      SELECT reply.*
      INTO v_reply
      FROM plugin_data.csf_announcement_replies AS reply
      WHERE reply.organization_id = p_organization_id
        AND reply.id = v_receipt.target_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The committed follow-up no longer exists. Reload the feed.';
      END IF;

      v_reply_state := pg_catalog.jsonb_build_object(
        'replyId', v_reply.id,
        'organizationId', v_reply.organization_id,
        'announcementId', v_reply.announcement_id,
        'bodyHash', pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(v_reply.body, 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'createdBy', v_reply.created_by
      );
      IF v_receipt.after_data -> 'replyState' IS DISTINCT FROM v_reply_state THEN
        RAISE EXCEPTION 'The committed follow-up is no longer current. Reload the feed.';
      END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'replyId', v_receipt.target_id,
      'idempotent', true
    );
  END IF;

  IF v_operation = 'add' THEN
    SELECT announcement.*
    INTO v_post
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.organization_id = p_organization_id
      AND announcement.id = p_post_id
    FOR SHARE;
    IF NOT FOUND OR v_post.status <> 'published' THEN
      RAISE EXCEPTION 'Follow-ups attach to published posts only.';
    END IF;

    INSERT INTO plugin_data.csf_announcement_replies (
      organization_id,
      announcement_id,
      body,
      created_by
    ) VALUES (
      p_organization_id,
      p_post_id,
      v_body,
      p_actor_user_id
    )
    RETURNING * INTO v_reply;

    v_reply_state := pg_catalog.jsonb_build_object(
      'replyId', v_reply.id,
      'organizationId', v_reply.organization_id,
      'announcementId', v_reply.announcement_id,
      'bodyHash', v_body_hash,
      'createdBy', v_reply.created_by
    );

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      before_data,
      after_data,
      correlation_id,
      source_type,
      source_id,
      reason_code
    ) VALUES (
      p_organization_id,
      p_actor_user_id,
      v_expected_action,
      'csf_announcement_reply',
      v_reply.id,
      NULL,
      pg_catalog.jsonb_build_object(
        'operation', v_operation,
        'requestFingerprint', v_request_fingerprint,
        'replyState', v_reply_state,
        'bodyLength', pg_catalog.char_length(v_body)
      ),
      p_request_id,
      'post_reply_mutation_request',
      v_reply.id::text,
      v_expected_action
    );
  ELSE
    SELECT reply.*
    INTO v_reply
    FROM plugin_data.csf_announcement_replies AS reply
    WHERE reply.organization_id = p_organization_id
      AND reply.id = p_reply_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That follow-up no longer exists.';
    END IF;

    v_authored_by_actor := v_reply.created_by = p_actor_user_id;
    IF NOT v_authored_by_actor AND NOT v_actor_is_admin THEN
      RAISE EXCEPTION 'Only the follow-up author or an organization admin can remove it.';
    END IF;

    DELETE FROM plugin_data.csf_announcement_replies AS reply
    WHERE reply.organization_id = p_organization_id
      AND reply.id = p_reply_id;

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      before_data,
      after_data,
      correlation_id,
      source_type,
      source_id,
      reason_code
    ) VALUES (
      p_organization_id,
      p_actor_user_id,
      v_expected_action,
      'csf_announcement_reply',
      v_reply.id,
      pg_catalog.jsonb_build_object(
        'announcementId', v_reply.announcement_id,
        'authoredByActor', v_authored_by_actor
      ),
      pg_catalog.jsonb_build_object(
        'operation', v_operation,
        'requestFingerprint', v_request_fingerprint
      ),
      p_request_id,
      'post_reply_mutation_request',
      v_reply.id::text,
      v_expected_action
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'replyId', v_reply.id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_mutate_post_reply(
  uuid, text, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_mutate_post_reply(
  uuid, text, uuid, uuid, text, uuid, uuid
) TO service_role;

-- Reads remain server-only. Consequential writes now have exactly one
-- permission-rechecked and audited transaction boundary.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE plugin_data.csf_announcement_replies
  FROM service_role;

COMMENT ON FUNCTION plugin_data.csf_mutate_post_reply(
  uuid, text, uuid, uuid, text, uuid, uuid
) IS
  'Service-only, tenant-scoped follow-up add/delete transaction. Rechecks manage_posts under the staff-access lock, pins active host membership, locks the parent or reply, enforces author-or-admin deletion, and commits an immutable replay receipt with the row mutation.';

NOTIFY pgrst, 'reload schema';

COMMIT;
