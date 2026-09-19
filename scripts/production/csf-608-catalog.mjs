// Require attachment replacement to lock and validate the prepared publication
// request before it can change attachment metadata or mark the request saved.
export function csf608Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = pg_catalog.to_regprocedure(
        'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'
      )
        AND p.proowner = 'postgres'::regrole
        AND p.prosecdef
        AND p.prorettype = 'jsonb'::regtype
        AND l.lanname = 'plpgsql'
        AND p.prokind = 'f'
        AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=""']
        AND pg_catalog.strpos(
          p.prosrc,
          'FROM plugin_data.csf_post_publication_requests AS request'
        ) > 0
        AND pg_catalog.strpos(p.prosrc, 'FOR UPDATE;') >
          pg_catalog.strpos(
            p.prosrc,
            'FROM plugin_data.csf_post_publication_requests AS request'
          )
        AND pg_catalog.strpos(
          p.prosrc,
          'v_request.actor_user_id IS DISTINCT FROM p_actor_user_id'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_request.announcement_id IS DISTINCT FROM p_announcement_id'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_request.attachment_count IS DISTINCT FROM'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_request.attachment_total_bytes IS DISTINCT FROM v_total_size_bytes'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'v_receipt.after_data->>''requestFingerprint'' IS DISTINCT FROM v_request_fingerprint'
        ) > 0
        AND pg_catalog.strpos(
          p.prosrc,
          'FROM plugin_data.csf_post_publication_requests AS request'
        ) < pg_catalog.strpos(
          p.prosrc,
          'INSERT INTO plugin_data.csf_announcement_attachments'
        )
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
