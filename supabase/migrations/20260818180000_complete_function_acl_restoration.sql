-- Complete the explicit execution ACLs for private helpers and trigger
-- functions introduced or replaced during the CSF/plugin release program.

ALTER FUNCTION plugin_data.csf_assert_point_submission_eligibility(uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_resubmit_point_submission(uuid, uuid, numeric, text, date, text, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_point_submission_receipt_state(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_merge_profiles_account_order_base(uuid, uuid, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid, uuid, uuid, text, text, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation() OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_lock_contextual_commit_population(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid, uuid, uuid, jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission(uuid, uuid, numeric, text, date, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_point_submission_receipt_state(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid, uuid, uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_lock_contextual_commit_population(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission(uuid, uuid, numeric, text, date, text, uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_point_submission_receipt_state(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(uuid, uuid, uuid, text, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid, uuid, uuid, text, text, uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_lock_contextual_commit_population(uuid, uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(uuid, uuid, uuid, jsonb) TO postgres;

ALTER FUNCTION private.enqueue_paper_signup_notification() OWNER TO postgres;
ALTER FUNCTION private.protect_paper_signup_notification_identity() OWNER TO postgres;
ALTER FUNCTION private.enforce_plugin_release_immutability() OWNER TO postgres;
ALTER FUNCTION private.enforce_catalog_published_plugin_release() OWNER TO postgres;
ALTER FUNCTION private.enforce_plugin_install_release() OWNER TO postgres;
ALTER FUNCTION private.enforce_plugin_entitlement_release() OWNER TO postgres;
ALTER FUNCTION private.project_hours_publish_key(text, jsonb, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.enqueue_paper_signup_notification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_paper_signup_notification_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_plugin_release_immutability() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_catalog_published_plugin_release() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_plugin_install_release() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_plugin_entitlement_release() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.project_hours_publish_key(text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.enqueue_paper_signup_notification() TO postgres;
GRANT EXECUTE ON FUNCTION private.protect_paper_signup_notification_identity() TO postgres;
GRANT EXECUTE ON FUNCTION private.enforce_plugin_release_immutability() TO postgres;
GRANT EXECUTE ON FUNCTION private.enforce_catalog_published_plugin_release() TO postgres;
GRANT EXECUTE ON FUNCTION private.enforce_plugin_install_release() TO postgres;
GRANT EXECUTE ON FUNCTION private.enforce_plugin_entitlement_release() TO postgres;
GRANT EXECUTE ON FUNCTION private.project_hours_publish_key(text, jsonb, text) TO postgres;
