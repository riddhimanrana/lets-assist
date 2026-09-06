BEGIN;

-- Point updates must use the audited, retry-safe SECURITY DEFINER actions.
-- The server may read submissions but cannot forge a decision with table DML.
REVOKE UPDATE ON TABLE plugin_data.csf_point_submissions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT UPDATE ON TABLE plugin_data.csf_point_submissions TO postgres;

COMMIT;
